const crypto = require('crypto');
const pool = require('../config/db');
const {
  COMMERCIAL_CURRENCIES,
  EXCLUDED_PUBLIC_FEATURES,
  OPEN_PAYMENT_REQUEST_STATES,
  PAYMENT_PERIODS,
  PAYMENT_REQUEST_TTL_HOURS,
  PUBLIC_PLAN_CODES
} = require('../config/saas-c-payment-contract');
const {
  OWNER_CANCELLABLE_STATES,
  exchangeRateBody,
  exchangeRateQuery,
  listQuery,
  methodReference,
  paymentMethodBody,
  quoteBody,
  requestReference
} = require('../config/saas-c-payment-request-contract');
const { PLAN_CHANGE_TYPES, comparePlanEntitlements } = require('../config/subscription-plan-change-contract');
const { canonicalPayload, computeEffectiveStatus } = require('./subscription-lifecycle-service');
const { administrativeAuditService } = require('./administrative-audit-service');
const { businessAnalytics } = require('./product-analytics');
const { sha256 } = require('../config/subscription-lifecycle-contract');
const {
  addLocalDays,
  formatLocalDateTime,
  getLocalNow,
  parseLocalDateTime
} = require('../utils/local-datetime');

const OPERATION_TTL_DAYS = 2;
const RATE_SCALE = 8;
const MONEY_SCALE = 2;
const OPEN_STATES_SQL = OPEN_PAYMENT_REQUEST_STATES.map(() => '?').join(',');
const PUBLIC_FEATURE_EXCLUSIONS_SQL = EXCLUDED_PUBLIC_FEATURES.map(() => '?').join(',');

function paymentError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function positiveId(value, label) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw paymentError(400, `${label} no es valido.`, 'INVALID_PAYMENT_CONTEXT');
  }
  return id;
}

function normalizeNow(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value.getTime());
  if (value === undefined || value === null) return getLocalNow();
  try { return parseLocalDateTime(value); } catch {
    throw paymentError(400, 'La fecha de operacion no es valida.', 'INVALID_PAYMENT_DATE');
  }
}

function addHours(value, hours) {
  return new Date(normalizeNow(value).getTime() + hours * 60 * 60 * 1000);
}

function decimalUnits(value, scale, label) {
  const text = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw paymentError(500, `${label} no es valido.`, 'PAYMENT_DECIMAL_INVALID');
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > scale) throw paymentError(500, `${label} excede la precision permitida.`, 'PAYMENT_DECIMAL_INVALID');
  return BigInt(whole) * (10n ** BigInt(scale)) + BigInt((fraction.padEnd(scale, '0') || '0'));
}

function decimalText(units, scale) {
  const factor = 10n ** BigInt(scale);
  const whole = units / factor;
  const fraction = String(units % factor).padStart(scale, '0');
  return `${whole}.${fraction}`;
}

function normalizedDecimal(value, scale, label) {
  return decimalText(decimalUnits(value, scale, label), scale);
}

function convertedAmount(priceUsd, exchangeRate) {
  const price = decimalUnits(priceUsd, MONEY_SCALE, 'El precio');
  const rate = decimalUnits(exchangeRate, RATE_SCALE, 'El tipo de cambio');
  const divisor = 10n ** BigInt(RATE_SCALE);
  const product = price * rate;
  let rounded = product / divisor;
  if ((product % divisor) * 2n >= divisor) rounded += 1n;
  if (rounded <= 0n) throw paymentError(409, 'El monto calculado no es valido.', 'PAYMENT_AMOUNT_INVALID');
  return decimalText(rounded, MONEY_SCALE);
}

async function withTransaction(database, callback) {
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try { await connection.rollback(); } catch { /* La conexion puede estar cerrada. */ }
    throw error;
  } finally {
    connection.release();
  }
}

async function lockStore(connection, idTienda) {
  const [rows] = await connection.query('SELECT idTienda FROM tienda WHERE idTienda=? FOR UPDATE', [idTienda]);
  if (!rows.length) throw paymentError(404, 'La tienda no existe.', 'STORE_NOT_FOUND');
}

async function validateActor(connection, input, forUpdate = false) {
  const idAdministrador = positiveId(input.idAdministrador, 'El administrador');
  const [rows] = await connection.query(
    `SELECT idTienda,rol,activo,estadoAcceso FROM administrador
     WHERE idAdministrador=?${forUpdate ? ' FOR UPDATE' : ''}`,
    [idAdministrador]
  );
  if (!rows.length || !Number(rows[0].activo) || rows[0].estadoAcceso !== 'activo') {
    throw paymentError(403, 'La cuenta no puede ejecutar esta operacion.', 'PAYMENT_ACTOR_NOT_ALLOWED');
  }
  if (input.actorTipo === 'superadmin') {
    if (rows[0].rol !== 'superadmin' || rows[0].idTienda !== null) {
      throw paymentError(403, 'La operacion requiere un superadministrador.', 'SUPERADMIN_REQUIRED');
    }
  } else if (rows[0].rol !== 'dueno_tienda' || Number(rows[0].idTienda) !== Number(input.idTienda)) {
    throw paymentError(403, 'La cuenta no pertenece a la tienda de la operacion.', 'PAYMENT_TENANT_MISMATCH');
  }
  return idAdministrador;
}

async function lockGlobalPaymentConfiguration(connection) {
  const [rows] = await connection.query(
    "SELECT idMetodoPagoSuscripcion FROM metodoPagoSuscripcion WHERE codigo='efectivo_administrativo' FOR UPDATE"
  );
  if (!rows.length) throw paymentError(500, 'La configuracion de pagos no esta disponible.', 'PAYMENT_CONFIGURATION_MISSING');
}

async function claimPaymentOperation(connection, input, now) {
  const keyHash = sha256(input.idempotencyKey);
  const payloadHash = sha256(canonicalPayload(input.payload));
  const tenantKey = input.idTienda === null ? 0 : Number(input.idTienda);
  const [existing] = await connection.query(
    `SELECT idOperacionPago,huellaPayload,estado,resultadoReferencia,codigoResultado,
            idSolicitudPago,idTipoCambioResultado,idMetodoPagoResultado
     FROM operacionPagoSuscripcion
     WHERE idTiendaClave=? AND actorTipo=? AND idActorClave=? AND alcance=? AND claveHash=?
     FOR UPDATE`,
    [tenantKey, input.actorTipo, input.idAdministrador, input.alcance, keyHash]
  );
  if (existing.length) {
    if (existing[0].huellaPayload !== payloadHash) {
      throw paymentError(409, 'La clave de operacion ya fue utilizada con otros datos.', 'PAYMENT_OPERATION_KEY_CONFLICT');
    }
    if (existing[0].estado === 'completada') {
      return { replayed: true, id: Number(existing[0].idOperacionPago), result: existing[0] };
    }
    throw paymentError(409, 'La operacion ya esta en proceso.', 'PAYMENT_OPERATION_IN_PROGRESS');
  }
  const nowText = formatLocalDateTime(now);
  const [created] = await connection.query(
    `INSERT INTO operacionPagoSuscripcion
      (idTienda,idSolicitudPago,actorTipo,idAdministradorActor,alcance,claveHash,
       huellaPayload,estado,creadaEn,completadaEn,fallidaEn,expiraEn,actualizadaEn)
     VALUES (?,NULL,?,?,?, ?,?,'en_proceso',?,NULL,NULL,?,?)`,
    [input.idTienda, input.actorTipo, input.idAdministrador, input.alcance,
      keyHash, payloadHash, nowText, formatLocalDateTime(addLocalDays(now, OPERATION_TTL_DAYS)), nowText]
  );
  return { replayed: false, id: Number(created.insertId), result: null };
}

async function completePaymentOperation(connection, operationId, result, now) {
  await connection.query(
    `UPDATE operacionPagoSuscripcion
     SET estado='completada',idSolicitudPago=?,resultadoReferencia=?,codigoResultado=?,
         idTipoCambioResultado=?,idMetodoPagoResultado=?,completadaEn=?,actualizadaEn=?
     WHERE idOperacionPago=?`,
    [result.idSolicitudPago || null, result.referencia || null, result.codigo,
      result.idTipoCambio || null, result.idMetodo || null,
      formatLocalDateTime(now), formatLocalDateTime(now), operationId]
  );
}

function limitsFrom(row) {
  const value = (name) => row[name] === null || row[name] === undefined ? null : Number(row[name]);
  return Object.freeze({
    propietarios: value('limitePropietarios'),
    productos: value('limiteProductos'),
    clientes: value('limiteClientes'),
    proveedores: value('limiteProveedores')
  });
}

async function planFeatures(connection, idPlan, forUpdate = false) {
  const [rows] = await connection.query(
    `SELECT f.codigo,f.nombre
     FROM planFuncionalidad pf
     JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad
     WHERE pf.idPlan=? AND pf.habilitada=1 AND f.activo=1
       AND f.codigo NOT IN (${PUBLIC_FEATURE_EXCLUSIONS_SQL})
     ORDER BY f.codigo${forUpdate ? ' FOR UPDATE' : ''}`,
    [idPlan, ...EXCLUDED_PUBLIC_FEATURES]
  );
  return rows.map((row) => Object.freeze({ codigo: row.codigo, nombre: row.nombre }));
}

async function subscriptionFeatures(connection, subscription) {
  const [rows] = await connection.query(
    `SELECT codigoFuncionalidad codigo,nombreFuncionalidad nombre
     FROM suscripcionFuncionalidadSnapshot
     WHERE idTienda=? AND idSuscripcion=? ORDER BY codigoFuncionalidad`,
    [subscription.idTienda, subscription.idSuscripcion]
  );
  return rows;
}

async function publicPlan(connection, code, forUpdate = false) {
  const [rows] = await connection.query(
    `SELECT idPlan,codigo,nombre,descripcion,ordenComercial,
            limitePropietarios,limiteProductos,limiteClientes,limiteProveedores
     FROM plan
     WHERE codigo=? AND activo=1 AND visiblePublicamente=1 AND esLegado=0
       AND codigo IN (${PUBLIC_PLAN_CODES.map(() => '?').join(',')})
     LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [code, ...PUBLIC_PLAN_CODES]
  );
  if (!rows.length) throw paymentError(400, 'El plan seleccionado no esta disponible.', 'PUBLIC_PLAN_NOT_AVAILABLE');
  const features = await planFeatures(connection, rows[0].idPlan, forUpdate);
  return { ...rows[0], limites: limitsFrom(rows[0]), funcionalidades: features };
}

async function activePrice(connection, idPlan, period, nowText, forUpdate = false) {
  const [rows] = await connection.query(
    `SELECT idPrecioPlanPeriodo,periodo,monedaBase,monto,cantidadMeses,versionPrecio,
            vigenteDesde,vigenteHasta
     FROM precioPlanPeriodo
     WHERE idPlan=? AND periodo=? AND monedaBase='USD' AND activo=1
       AND vigenteDesde<=? AND (vigenteHasta IS NULL OR vigenteHasta>?)
     LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [idPlan, period, nowText, nowText]
  );
  if (!rows.length) throw paymentError(409, 'El precio seleccionado no esta disponible.', 'PAYMENT_PRICE_NOT_AVAILABLE');
  return rows[0];
}

async function activeRate(connection, nowText, forUpdate = false) {
  const [rows] = await connection.query(
    `SELECT idTipoCambioSuscripcion,valor,fuente,fechaEfectiva,vigenteDesde,vigenteHasta,
            versionTipoCambio
     FROM tipoCambioSuscripcion
     WHERE monedaOrigen='USD' AND monedaDestino='BOB' AND activo=1
       AND vigenteDesde<=? AND (vigenteHasta IS NULL OR vigenteHasta>?)
     LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [nowText, nowText]
  );
  if (!rows.length) {
    throw paymentError(409, 'El tipo de cambio USD/BOB no esta disponible.', 'EXCHANGE_RATE_NOT_AVAILABLE');
  }
  return rows[0];
}

async function ownerMethod(connection, code, forUpdate = false) {
  const [rows] = await connection.query(
    `SELECT idMetodoPagoSuscripcion,codigo,tipo,nombre,instrucciones,
            requiereComprobante,soloAdministracion
     FROM metodoPagoSuscripcion
     WHERE codigo=? AND activo=1 AND configurado=1 AND visiblePropietario=1
       AND soloAdministracion=0
     LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [code]
  );
  if (!rows.length) throw paymentError(409, 'El metodo de pago no esta disponible.', 'PAYMENT_METHOD_NOT_AVAILABLE');
  return rows[0];
}

async function currentSubscription(connection, idTienda, idSuscripcion, forUpdate = false) {
  const [rows] = await connection.query(
    `SELECT * FROM suscripcionTienda WHERE idTienda=? AND idSuscripcion=?
     LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [idTienda, idSuscripcion]
  );
  if (!rows.length) throw paymentError(404, 'La suscripcion no existe.', 'SUBSCRIPTION_NOT_FOUND');
  return rows[0];
}

async function operationAllowed(connection, subscription, target, operation, now) {
  if (subscription.estado === 'cancelada') {
    throw paymentError(409, 'La suscripcion cancelada no admite solicitudes de pago.', 'SUBSCRIPTION_CANCELLED');
  }
  const effective = computeEffectiveStatus(subscription, now);
  const samePlan = subscription.planCodigoSnapshot === target.codigo;
  const automaticSuspension = effective === 'suspendida'
    && (subscription.estado !== 'suspendida' || subscription.motivoTransicion === 'fin_gracia');
  if (operation === 'renovacion') {
    if (!samePlan) throw paymentError(409, 'La renovacion debe conservar el plan actual.', 'RENEWAL_PLAN_MISMATCH');
    if (!['activa', 'gracia'].includes(effective) && !automaticSuspension) {
      throw paymentError(409, 'El estado actual no permite renovar.', 'RENEWAL_NOT_ALLOWED');
    }
    return effective;
  }
  if (operation === 'reactivacion') {
    if (!samePlan) throw paymentError(409, 'La reactivacion debe conservar el plan actual.', 'REACTIVATION_PLAN_MISMATCH');
    if (!automaticSuspension) {
      throw paymentError(409, 'La suscripcion no admite reactivacion mediante pago.', 'REACTIVATION_NOT_ALLOWED');
    }
    return effective;
  }
  if (effective !== 'activa') {
    throw paymentError(409, 'El estado actual no permite solicitar un upgrade.', 'UPGRADE_NOT_ALLOWED');
  }
  const currentFeatures = await subscriptionFeatures(connection, subscription);
  const comparison = comparePlanEntitlements({
    codigo: subscription.planCodigoSnapshot,
    limites: {
      propietarios: subscription.limitePropietariosSnapshot,
      productos: subscription.limiteProductosSnapshot,
      clientes: subscription.limiteClientesSnapshot,
      proveedores: subscription.limiteProveedoresSnapshot
    },
    funcionalidades: currentFeatures.map((item) => item.codigo)
  }, {
    codigo: target.codigo,
    limites: target.limites,
    funcionalidades: target.funcionalidades.map((item) => item.codigo)
  });
  if (comparison.tipo !== PLAN_CHANGE_TYPES.UPGRADE) {
    throw paymentError(409, 'El plan seleccionado no representa un upgrade valido.', 'UPGRADE_DIRECTION_INVALID');
  }
  return effective;
}

function expectedEffect(subscription, operation, effective) {
  if (operation === 'upgrade') {
    return Object.freeze({ tipo: 'upgrade_inmediato', conservaFechaFin: true, fechaFinActual: subscription.fechaFin });
  }
  const startsToday = effective === 'suspendida';
  return Object.freeze({
    tipo: operation,
    baseNuevaVigencia: startsToday ? 'fecha_actual' : 'fecha_fin_actual',
    fechaFinActual: subscription.fechaFin
  });
}

async function quoteData(connection, input, now, options = {}) {
  const nowText = formatLocalDateTime(now);
  const subscription = options.subscription || await currentSubscription(
    connection, input.idTienda, input.idSuscripcion, Boolean(options.forUpdate)
  );
  const target = await publicPlan(connection, input.body.plan, Boolean(options.forUpdate));
  const effective = await operationAllowed(connection, subscription, target, input.body.operacion, now);
  const price = await activePrice(connection, target.idPlan, input.body.periodo, nowText, Boolean(options.forUpdate));
  const rate = await activeRate(connection, nowText, Boolean(options.forUpdate));
  const method = await ownerMethod(connection, input.body.metodo, Boolean(options.forUpdate));
  const priceText = normalizedDecimal(price.monto, MONEY_SCALE, 'El precio');
  const rateText = normalizedDecimal(rate.valor, RATE_SCALE, 'El tipo de cambio');
  const amount = convertedAmount(priceText, rateText);
  return {
    subscription,
    target,
    price,
    rate,
    method,
    effective,
    priceText,
    rateText,
    amount,
    expiresAt: formatLocalDateTime(addHours(now, PAYMENT_REQUEST_TTL_HOURS)),
    effect: expectedEffect(subscription, input.body.operacion, effective)
  };
}

function safeQuote(quote) {
  return Object.freeze({
    operacion: quote.operation,
    planActual: Object.freeze({ codigo: quote.subscription.planCodigoSnapshot, nombre: quote.subscription.planNombreSnapshot }),
    planObjetivo: Object.freeze({ codigo: quote.target.codigo, nombre: quote.target.nombre }),
    periodo: quote.price.periodo,
    meses: Number(quote.price.cantidadMeses),
    precioBase: Object.freeze({ moneda: COMMERCIAL_CURRENCIES.base, monto: quote.priceText }),
    conversion: Object.freeze({
      monedaOrigen: COMMERCIAL_CURRENCIES.base,
      monedaDestino: COMMERCIAL_CURRENCIES.charge,
      valor: quote.rateText,
      fuente: quote.rate.fuente,
      fechaEfectiva: quote.rate.fechaEfectiva
    }),
    montoCobro: Object.freeze({ moneda: COMMERCIAL_CURRENCIES.charge, monto: quote.amount }),
    metodo: Object.freeze({ codigo: quote.method.codigo, nombre: quote.method.nombre, requiereComprobante: Boolean(quote.method.requiereComprobante) }),
    vigenteHasta: quote.expiresAt,
    efectoEsperado: quote.effect,
    aviso: 'La solicitud recalculara y congelara las condiciones vigentes al momento de crearla.'
  });
}

async function insertPaymentHistory(connection, input) {
  const [result] = await connection.query(
    `INSERT INTO historialSolicitudPagoSuscripcion
      (idTienda,idSolicitudPago,evento,estadoAnterior,estadoNuevo,actorTipo,
       idAdministradorActor,metadatos,creadoEn)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.idTienda, input.idSolicitudPago, input.evento, input.estadoAnterior || null,
      input.estadoNuevo, input.actorTipo, input.idAdministrador || null,
      input.metadatos && Object.keys(input.metadatos).length ? JSON.stringify(input.metadatos) : null,
      formatLocalDateTime(input.now)]
  );
  return Number(result.insertId);
}

async function materializeExpiredInConnection(connection, idTienda, now) {
  const nowText = formatLocalDateTime(now);
  const [rows] = await connection.query(
    `SELECT idSolicitudPago FROM solicitudPagoSuscripcion
     WHERE idTienda=? AND estado='pendiente_comprobante' AND venceEn<=?
     ORDER BY idSolicitudPago FOR UPDATE`,
    [idTienda, nowText]
  );
  for (const row of rows) {
    const [updated] = await connection.query(
      `UPDATE solicitudPagoSuscripcion
       SET estado='vencida',ultimaTransicionEn=?,actualizadoEn=?
       WHERE idTienda=? AND idSolicitudPago=? AND estado='pendiente_comprobante'`,
      [nowText, nowText, idTienda, row.idSolicitudPago]
    );
    if (updated.affectedRows) {
      await insertPaymentHistory(connection, {
        idTienda, idSolicitudPago: row.idSolicitudPago, evento: 'vencida',
        estadoAnterior: 'pendiente_comprobante', estadoNuevo: 'vencida',
        actorTipo: 'sistema', now, metadatos: {}
      });
    }
  }
  return rows.length;
}

async function materializeExpiredRequests(database, idTienda, now) {
  return withTransaction(database, async (connection) => {
    await lockStore(connection, idTienda);
    return materializeExpiredInConnection(connection, idTienda, now);
  });
}

function nextAction(state) {
  if (state === 'pendiente_comprobante') return 'cargar_comprobante';
  if (state === 'observada') return 'corregir_comprobante';
  if (state === 'pendiente_revision') return 'esperar_revision';
  if (state === 'aplicada') return 'completada';
  return 'crear_nueva_solicitud';
}

function requestSummary(row, replayed = false, created = false) {
  return Object.freeze({
    referencia: row.referenciaPublica,
    operacion: row.operacion,
    plan: Object.freeze({ codigo: row.planCodigoSnapshot, nombre: row.planNombreSnapshot }),
    periodo: row.periodo,
    precioBaseUSD: normalizedDecimal(row.precioBaseUSD, MONEY_SCALE, 'El precio'),
    montoBOB: normalizedDecimal(row.montoFinalBOB, MONEY_SCALE, 'El monto'),
    estado: row.estado,
    creadaEn: row.creadaEn,
    venceEn: row.venceEn,
    siguienteAccion: nextAction(row.estado),
    replayed,
    created
  });
}

async function requestByReference(connection, idTienda, reference, forUpdate = false) {
  const [rows] = await connection.query(
    `SELECT * FROM solicitudPagoSuscripcion
     WHERE idTienda=? AND referenciaPublica=? LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [idTienda, reference]
  );
  if (!rows.length) throw paymentError(404, 'La solicitud no existe.', 'PAYMENT_REQUEST_NOT_FOUND');
  return rows[0];
}

async function listPublicPlans(database, input) {
  const now = normalizeNow(input.now);
  const nowText = formatLocalDateTime(now);
  const subscription = await currentSubscription(database, input.idTienda, input.idSuscripcion);
  const [rows] = await database.query(
    `SELECT idPlan,codigo,nombre,descripcion,ordenComercial,
            limitePropietarios,limiteProductos,limiteClientes,limiteProveedores
     FROM plan
     WHERE activo=1 AND visiblePublicamente=1 AND esLegado=0
       AND codigo IN (${PUBLIC_PLAN_CODES.map(() => '?').join(',')})
     ORDER BY ordenComercial,codigo`,
    PUBLIC_PLAN_CODES
  );
  const currentFeatures = await subscriptionFeatures(database, subscription);
  const plans = [];
  for (const row of rows) {
    const features = await planFeatures(database, row.idPlan);
    const [prices] = await database.query(
      `SELECT periodo,monto,cantidadMeses FROM precioPlanPeriodo
       WHERE idPlan=? AND monedaBase='USD' AND activo=1 AND vigenteDesde<=?
         AND (vigenteHasta IS NULL OR vigenteHasta>?)
       ORDER BY FIELD(periodo,'mensual','trimestral','anual')`,
      [row.idPlan, nowText, nowText]
    );
    if (!prices.length) continue;
    const limits = limitsFrom(row);
    const comparison = comparePlanEntitlements({
      codigo: subscription.planCodigoSnapshot,
      limites: {
        propietarios: subscription.limitePropietariosSnapshot,
        productos: subscription.limiteProductosSnapshot,
        clientes: subscription.limiteClientesSnapshot,
        proveedores: subscription.limiteProveedoresSnapshot
      },
      funcionalidades: currentFeatures.map((item) => item.codigo)
    }, { codigo: row.codigo, limites: limits, funcionalidades: features.map((item) => item.codigo) });
    const effective = computeEffectiveStatus(subscription, now);
    const automaticSuspension = effective === 'suspendida'
      && (subscription.estado !== 'suspendida' || subscription.motivoTransicion === 'fin_gracia');
    const availableOperations = [];
    if (row.codigo === subscription.planCodigoSnapshot && ['activa', 'gracia'].includes(effective)) {
      availableOperations.push('renovacion');
    }
    if (row.codigo === subscription.planCodigoSnapshot && automaticSuspension) {
      availableOperations.push('renovacion', 'reactivacion');
    }
    if (comparison.tipo === PLAN_CHANGE_TYPES.UPGRADE && effective === 'activa') {
      availableOperations.push('upgrade');
    }
    plans.push(Object.freeze({
      referencia: row.codigo,
      nombre: row.nombre,
      descripcion: row.descripcion,
      limites: limits,
      funcionalidades: Object.freeze(features),
      periodos: Object.freeze(prices.map((price) => Object.freeze({
        periodo: price.periodo,
        meses: Number(price.cantidadMeses),
        moneda: COMMERCIAL_CURRENCIES.base,
        monto: normalizedDecimal(price.monto, MONEY_SCALE, 'El precio')
      }))),
      comparacion: comparison.tipo,
      operacionesDisponibles: Object.freeze([...new Set(availableOperations)])
    }));
  }
  return Object.freeze({
    planActual: Object.freeze({ codigo: subscription.planCodigoSnapshot, nombre: subscription.planNombreSnapshot }),
    monedaComercial: COMMERCIAL_CURRENCIES.base,
    monedaCobro: COMMERCIAL_CURRENCIES.charge,
    planes: Object.freeze(plans)
  });
}

async function listOwnerMethods(database) {
  const [rows] = await database.query(
    `SELECT codigo,nombre,tipo,instrucciones,requiereComprobante
     FROM metodoPagoSuscripcion
     WHERE activo=1 AND configurado=1 AND visiblePropietario=1 AND soloAdministracion=0
     ORDER BY orden,codigo`
  );
  return Object.freeze({
    disponibles: rows.length > 0,
    metodos: Object.freeze(rows.map((row) => Object.freeze({
      referencia: row.codigo,
      nombre: row.nombre,
      tipo: row.tipo,
      instrucciones: row.instrucciones,
      requiereComprobante: Boolean(row.requiereComprobante)
    })))
  });
}

async function quote(database, input) {
  const now = normalizeNow(input.now);
  await materializeExpiredRequests(database, input.idTienda, now);
  const data = await quoteData(database, input, now);
  return safeQuote({ ...data, operation: input.body.operacion });
}

async function auditPayment(connection, input) {
  return administrativeAuditService.recordCritical(connection, {
    action: input.action,
    result: 'correcto',
    resultCode: input.resultCode,
    origin: input.origin || 'web',
    actorType: 'administrador',
    administratorId: input.idAdministrador,
    storeId: input.idTienda ?? null,
    reference: input.idSuscripcion ? `suscripcion:${input.idSuscripcion}` : null,
    requestId: input.requestId || null,
    before: input.before || null,
    after: input.after || null,
    metadata: input.metadata || null,
    createdAt: formatLocalDateTime(input.now)
  });
}

async function createPaymentRequest(database, input, analytics) {
  const idTienda = positiveId(input.idTienda, 'La tienda');
  const idSuscripcion = positiveId(input.idSuscripcion, 'La suscripcion');
  const now = normalizeNow(input.now);
  const result = await withTransaction(database, async (connection) => {
    await lockStore(connection, idTienda);
    const subscription = await currentSubscription(connection, idTienda, idSuscripcion, true);
    const idAdministrador = await validateActor(connection, {
      actorTipo: 'propietario', idAdministrador: input.idAdministrador, idTienda
    }, true);
    await materializeExpiredInConnection(connection, idTienda, now);
    const operation = await claimPaymentOperation(connection, {
      idTienda, actorTipo: 'propietario', idAdministrador, alcance: 'crear_solicitud',
      idempotencyKey: input.idempotencyKey, payload: input.body
    }, now);
    if (operation.replayed) {
      const replay = await requestByReference(connection, idTienda, operation.result.resultadoReferencia);
      return requestSummary(replay, true);
    }
    const [open] = await connection.query(
      `SELECT * FROM solicitudPagoSuscripcion
       WHERE idTienda=? AND estado IN (${OPEN_STATES_SQL})
       ORDER BY idSolicitudPago LIMIT 1 FOR UPDATE`,
      [idTienda, ...OPEN_PAYMENT_REQUEST_STATES]
    );
    if (open.length) {
      await completePaymentOperation(connection, operation.id, {
        idSolicitudPago: open[0].idSolicitudPago,
        referencia: open[0].referenciaPublica,
        codigo: 'PAYMENT_REQUEST_ALREADY_OPEN'
      }, now);
      return requestSummary(open[0]);
    }
    const data = await quoteData(connection, input, now, { subscription, forUpdate: true });
    const nowText = formatLocalDateTime(now);
    const reference = crypto.randomBytes(32).toString('base64url');
    const [created] = await connection.query(
      `INSERT INTO solicitudPagoSuscripcion
        (referenciaPublica,idTienda,idSuscripcion,idPlanActual,idPlanObjetivo,
         idPrecioPlanPeriodo,idTipoCambioSuscripcion,idMetodoPagoSuscripcion,
         operacion,periodo,cantidadMeses,planActualCodigoSnapshot,
         planActualNombreSnapshot,planCodigoSnapshot,planNombreSnapshot,
         versionPrecioSnapshot,precioBaseUSD,tipoCambioUsdBob,
         fuenteTipoCambioSnapshot,fechaEfectivaTipoCambioSnapshot,
         montoCalculadoBOB,montoFinalBOB,monedaBase,monedaCobro,
         limitePropietariosSnapshot,limiteProductosSnapshot,limiteClientesSnapshot,
         limiteProveedoresSnapshot,metodoCodigoSnapshot,metodoNombreSnapshot,
         instruccionesMetodoSnapshot,estado,creadaPor,creadaEn,venceEn,
         enviadaEn,aplicadaEn,canceladaEn,ultimaTransicionEn,actualizadoEn)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, 'USD','BOB', ?, ?, ?, ?, ?, ?, ?, 'pendiente_comprobante', ?, ?, ?,
         NULL,NULL,NULL,?,?)`,
      [reference, idTienda, idSuscripcion, subscription.idPlan, data.target.idPlan,
        data.price.idPrecioPlanPeriodo, data.rate.idTipoCambioSuscripcion,
        data.method.idMetodoPagoSuscripcion, input.body.operacion, data.price.periodo,
        data.price.cantidadMeses, subscription.planCodigoSnapshot,
        subscription.planNombreSnapshot, data.target.codigo, data.target.nombre,
        data.price.versionPrecio, data.priceText, data.rateText, data.rate.fuente,
        data.rate.fechaEfectiva, data.amount, data.amount,
        data.target.limitePropietarios, data.target.limiteProductos,
        data.target.limiteClientes, data.target.limiteProveedores,
        data.method.codigo, data.method.nombre, data.method.instrucciones,
        idAdministrador, nowText, data.expiresAt, nowText, nowText]
    );
    const idSolicitudPago = Number(created.insertId);
    if (data.target.funcionalidades.length) {
      await connection.query(
        `INSERT INTO solicitudPagoFuncionalidadSnapshot
          (idTienda,idSolicitudPago,codigoFuncionalidad,nombreFuncionalidad,creadoEn)
         VALUES ${data.target.funcionalidades.map(() => '(?,?,?,?,?)').join(',')}`,
        data.target.funcionalidades.flatMap((feature) => [
          idTienda, idSolicitudPago, feature.codigo, feature.nombre, nowText
        ])
      );
    }
    await insertPaymentHistory(connection, {
      idTienda, idSolicitudPago, evento: 'creada', estadoAnterior: null,
      estadoNuevo: 'pendiente_comprobante', actorTipo: 'propietario', idAdministrador,
      now, metadatos: { operacion: input.body.operacion, planCodigo: data.target.codigo, periodo: data.price.periodo }
    });
    await auditPayment(connection, {
      action: 'creacion_solicitud_pago_suscripcion', resultCode: 'PAYMENT_REQUEST_CREATED',
      idTienda, idSuscripcion, idAdministrador, requestId: input.requestId, now,
      after: { estado: 'pendiente_comprobante' },
      metadata: { tipoOperacion: input.body.operacion, planCodigo: data.target.codigo, periodo: data.price.periodo, metodoPago: data.method.codigo }
    });
    await completePaymentOperation(connection, operation.id, {
      idSolicitudPago, referencia: reference, codigo: 'PAYMENT_REQUEST_CREATED'
    }, now);
    return requestSummary({
      referenciaPublica: reference,
      operacion: input.body.operacion,
      planCodigoSnapshot: data.target.codigo,
      planNombreSnapshot: data.target.nombre,
      periodo: data.price.periodo,
      precioBaseUSD: data.priceText,
      montoFinalBOB: data.amount,
      estado: 'pendiente_comprobante',
      creadaEn: nowText,
      venceEn: data.expiresAt
    }, false, true);
  });
  analytics.paymentRequestCreated({
    created: result.created,
    replayed: result.replayed,
    operation: result.operacion,
    plan: result.plan.codigo,
    currency: COMMERCIAL_CURRENCIES.charge
  });
  return result;
}

async function listPaymentRequests(database, input) {
  const idTienda = positiveId(input.idTienda, 'La tienda');
  const now = normalizeNow(input.now);
  await materializeExpiredRequests(database, idTienda, now);
  const filters = listQuery(input.query);
  const conditions = ['idTienda=?'];
  const values = [idTienda];
  if (filters.estado) { conditions.push('estado=?'); values.push(filters.estado); }
  const [[count]] = await database.query(
    `SELECT COUNT(*) total FROM solicitudPagoSuscripcion WHERE ${conditions.join(' AND ')}`,
    values
  );
  const order = filters.orden === 'antiguas'
    ? 'creadaEn ASC,idSolicitudPago ASC'
    : filters.orden === 'vencimiento'
      ? 'venceEn ASC,idSolicitudPago ASC'
      : 'creadaEn DESC,idSolicitudPago DESC';
  const offset = (filters.pagina - 1) * filters.limite;
  const [rows] = await database.query(
    `SELECT referenciaPublica,operacion,planCodigoSnapshot,planNombreSnapshot,
            periodo,precioBaseUSD,montoFinalBOB,estado,creadaEn,venceEn
     FROM solicitudPagoSuscripcion WHERE ${conditions.join(' AND ')}
     ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...values, filters.limite, offset]
  );
  return Object.freeze({
    resultados: Object.freeze(rows.map((row) => requestSummary(row))),
    paginacion: Object.freeze({
      pagina: filters.pagina,
      limite: filters.limite,
      total: Number(count.total),
      paginas: Math.max(1, Math.ceil(Number(count.total) / filters.limite))
    })
  });
}

async function paymentRequestDetail(database, input) {
  const idTienda = positiveId(input.idTienda, 'La tienda');
  const reference = requestReference(input.reference);
  const now = normalizeNow(input.now);
  await materializeExpiredRequests(database, idTienda, now);
  const row = await requestByReference(database, idTienda, reference);
  const [features] = await database.query(
    `SELECT codigoFuncionalidad codigo,nombreFuncionalidad nombre
     FROM solicitudPagoFuncionalidadSnapshot
     WHERE idTienda=? AND idSolicitudPago=? ORDER BY codigoFuncionalidad`,
    [idTienda, row.idSolicitudPago]
  );
  const [history] = await database.query(
    `SELECT evento,estadoAnterior,estadoNuevo,creadoEn
     FROM historialSolicitudPagoSuscripcion
     WHERE idTienda=? AND idSolicitudPago=?
     ORDER BY creadoEn,idHistorialSolicitudPago`,
    [idTienda, row.idSolicitudPago]
  );
  return Object.freeze({
    referencia: row.referenciaPublica,
    planActual: Object.freeze({ codigo: row.planActualCodigoSnapshot, nombre: row.planActualNombreSnapshot }),
    planObjetivo: Object.freeze({ codigo: row.planCodigoSnapshot, nombre: row.planNombreSnapshot }),
    operacion: row.operacion,
    periodo: row.periodo,
    meses: Number(row.cantidadMeses),
    precioBase: Object.freeze({ moneda: row.monedaBase, monto: normalizedDecimal(row.precioBaseUSD, MONEY_SCALE, 'El precio') }),
    conversion: Object.freeze({
      valor: normalizedDecimal(row.tipoCambioUsdBob, RATE_SCALE, 'El tipo de cambio'),
      fuente: row.fuenteTipoCambioSnapshot,
      fechaEfectiva: row.fechaEfectivaTipoCambioSnapshot
    }),
    montoCobro: Object.freeze({ moneda: row.monedaCobro, monto: normalizedDecimal(row.montoFinalBOB, MONEY_SCALE, 'El monto') }),
    metodo: Object.freeze({
      codigo: row.metodoCodigoSnapshot,
      nombre: row.metodoNombreSnapshot,
      instrucciones: row.instruccionesMetodoSnapshot
    }),
    limites: Object.freeze({
      propietarios: row.limitePropietariosSnapshot,
      productos: row.limiteProductosSnapshot,
      clientes: row.limiteClientesSnapshot,
      proveedores: row.limiteProveedoresSnapshot
    }),
    funcionalidades: Object.freeze(features),
    estado: row.estado,
    creadaEn: row.creadaEn,
    venceEn: row.venceEn,
    historial: Object.freeze(history.map((item) => Object.freeze({
      evento: item.evento,
      estadoAnterior: item.estadoAnterior,
      estadoNuevo: item.estadoNuevo,
      fecha: item.creadoEn
    }))),
    siguienteAccion: nextAction(row.estado)
  });
}

async function cancelPaymentRequest(database, input) {
  const idTienda = positiveId(input.idTienda, 'La tienda');
  const idSuscripcion = positiveId(input.idSuscripcion, 'La suscripcion');
  const reference = requestReference(input.reference);
  const now = normalizeNow(input.now);
  return withTransaction(database, async (connection) => {
    await lockStore(connection, idTienda);
    await currentSubscription(connection, idTienda, idSuscripcion, true);
    const idAdministrador = await validateActor(connection, {
      actorTipo: 'propietario', idAdministrador: input.idAdministrador, idTienda
    }, true);
    await materializeExpiredInConnection(connection, idTienda, now);
    const operation = await claimPaymentOperation(connection, {
      idTienda, actorTipo: 'propietario', idAdministrador, alcance: 'cancelar',
      idempotencyKey: input.idempotencyKey, payload: { referencia: reference }
    }, now);
    if (operation.replayed) {
      return requestSummary(await requestByReference(connection, idTienda, operation.result.resultadoReferencia), true);
    }
    const request = await requestByReference(connection, idTienda, reference, true);
    if (Number(request.idSuscripcion) !== idSuscripcion) {
      throw paymentError(404, 'La solicitud no existe.', 'PAYMENT_REQUEST_NOT_FOUND');
    }
    if (request.estado === 'cancelada') {
      await completePaymentOperation(connection, operation.id, {
        idSolicitudPago: request.idSolicitudPago, referencia: reference,
        codigo: 'PAYMENT_REQUEST_ALREADY_CANCELLED'
      }, now);
      return requestSummary(request);
    }
    if (!OWNER_CANCELLABLE_STATES.includes(request.estado)) {
      throw paymentError(409, 'La solicitud ya no puede cancelarse.', 'PAYMENT_REQUEST_CANCELLATION_NOT_ALLOWED');
    }
    const nowText = formatLocalDateTime(now);
    await connection.query(
      `UPDATE solicitudPagoSuscripcion
       SET estado='cancelada',canceladaEn=?,ultimaTransicionEn=?,actualizadoEn=?
       WHERE idTienda=? AND idSolicitudPago=?`,
      [nowText, nowText, nowText, idTienda, request.idSolicitudPago]
    );
    await insertPaymentHistory(connection, {
      idTienda, idSolicitudPago: request.idSolicitudPago, evento: 'cancelada',
      estadoAnterior: request.estado, estadoNuevo: 'cancelada', actorTipo: 'propietario',
      idAdministrador, now, metadatos: {}
    });
    await auditPayment(connection, {
      action: 'cancelacion_solicitud_pago_suscripcion', resultCode: 'PAYMENT_REQUEST_CANCELLED',
      idTienda, idSuscripcion, idAdministrador, requestId: input.requestId, now,
      before: { estado: request.estado }, after: { estado: 'cancelada' },
      metadata: { tipoOperacion: request.operacion }
    });
    await completePaymentOperation(connection, operation.id, {
      idSolicitudPago: request.idSolicitudPago, referencia: reference,
      codigo: 'PAYMENT_REQUEST_CANCELLED'
    }, now);
    return requestSummary({ ...request, estado: 'cancelada', canceladaEn: nowText });
  });
}

function safeRate(row, replayed = false) {
  return Object.freeze({
    monedaOrigen: row.monedaOrigen || COMMERCIAL_CURRENCIES.base,
    monedaDestino: row.monedaDestino || COMMERCIAL_CURRENCIES.charge,
    valor: normalizedDecimal(row.valor, RATE_SCALE, 'El tipo de cambio'),
    fuente: row.fuente,
    fechaEfectiva: row.fechaEfectiva,
    vigenteDesde: row.vigenteDesde,
    vigenteHasta: row.vigenteHasta,
    version: Number(row.versionTipoCambio),
    activo: Boolean(row.activo),
    replayed
  });
}

async function rateById(connection, id) {
  const [rows] = await connection.query('SELECT * FROM tipoCambioSuscripcion WHERE idTipoCambioSuscripcion=?', [id]);
  if (!rows.length) throw paymentError(500, 'El resultado del tipo de cambio no esta disponible.', 'PAYMENT_RESULT_NOT_FOUND');
  return rows[0];
}

async function registerExchangeRate(database, input) {
  const body = exchangeRateBody(input.body);
  const now = normalizeNow(input.now);
  const effective = body.fechaEfectiva ? normalizeNow(body.fechaEfectiva) : now;
  const validFrom = body.vigenteDesde ? normalizeNow(body.vigenteDesde) : now;
  if (validFrom < effective || validFrom > now) {
    throw paymentError(400, 'La vigencia del tipo de cambio no es valida.', 'INVALID_EXCHANGE_RATE_VALIDITY');
  }
  return withTransaction(database, async (connection) => {
    await lockGlobalPaymentConfiguration(connection);
    const idAdministrador = await validateActor(connection, {
      actorTipo: 'superadmin', idAdministrador: input.idAdministrador
    }, true);
    const operation = await claimPaymentOperation(connection, {
      idTienda: null, actorTipo: 'superadmin', idAdministrador,
      alcance: 'registrar_tipo_cambio', idempotencyKey: input.idempotencyKey,
      payload: body
    }, now);
    if (operation.replayed) {
      return safeRate(await rateById(connection, operation.result.idTipoCambioResultado), true);
    }
    const [rates] = await connection.query(
      `SELECT idTipoCambioSuscripcion,vigenteDesde,versionTipoCambio
       FROM tipoCambioSuscripcion
       WHERE monedaOrigen='USD' AND monedaDestino='BOB'
       ORDER BY versionTipoCambio DESC FOR UPDATE`
    );
    const current = rates.find((row) => row.idTipoCambioSuscripcion && row.vigenteDesde && row.versionTipoCambio && row);
    if (current && validFrom <= parseLocalDateTime(current.vigenteDesde)) {
      throw paymentError(409, 'La nueva vigencia debe ser posterior a la vigente.', 'EXCHANGE_RATE_VALIDITY_CONFLICT');
    }
    const validText = formatLocalDateTime(validFrom);
    await connection.query(
      `UPDATE tipoCambioSuscripcion
       SET activo=0,vigenteHasta=?,actualizadoEn=?
       WHERE monedaOrigen='USD' AND monedaDestino='BOB' AND activo=1`,
      [validText, formatLocalDateTime(now)]
    );
    const version = rates.length ? Math.max(...rates.map((row) => Number(row.versionTipoCambio))) + 1 : 1;
    const [created] = await connection.query(
      `INSERT INTO tipoCambioSuscripcion
        (monedaOrigen,monedaDestino,valor,direccion,fuente,fechaEfectiva,
         vigenteDesde,vigenteHasta,versionTipoCambio,activo,registradoPor)
       VALUES ('USD','BOB',?,'destino_por_unidad_origen',?,?,?,NULL,?,1,?)`,
      [normalizedDecimal(body.valor, RATE_SCALE, 'El tipo de cambio'), body.fuente,
        formatLocalDateTime(effective), validText, version, idAdministrador]
    );
    const idTipoCambio = Number(created.insertId);
    await auditPayment(connection, {
      action: 'registro_tipo_cambio_suscripcion', resultCode: 'PAYMENT_EXCHANGE_RATE_REGISTERED',
      idAdministrador, requestId: input.requestId, now,
      metadata: { monedaOrigen: 'usd', monedaDestino: 'bob' }
    });
    await completePaymentOperation(connection, operation.id, {
      idTipoCambio, codigo: 'PAYMENT_EXCHANGE_RATE_REGISTERED'
    }, now);
    return safeRate(await rateById(connection, idTipoCambio));
  });
}

async function listExchangeRates(database, query) {
  const filters = exchangeRateQuery(query);
  const [[count]] = await database.query(
    "SELECT COUNT(*) total FROM tipoCambioSuscripcion WHERE monedaOrigen='USD' AND monedaDestino='BOB'"
  );
  const offset = (filters.pagina - 1) * filters.limite;
  const [[active]] = await database.query(
    `SELECT tc.*,a.usuario actor
     FROM tipoCambioSuscripcion tc
     JOIN administrador a ON a.idAdministrador=tc.registradoPor
     WHERE tc.monedaOrigen='USD' AND tc.monedaDestino='BOB' AND tc.activo=1
     LIMIT 1`
  );
  const [rows] = await database.query(
    `SELECT tc.*,a.usuario actor
     FROM tipoCambioSuscripcion tc
     JOIN administrador a ON a.idAdministrador=tc.registradoPor
     WHERE tc.monedaOrigen='USD' AND tc.monedaDestino='BOB'
     ORDER BY tc.versionTipoCambio DESC LIMIT ? OFFSET ?`,
    [filters.limite, offset]
  );
  return Object.freeze({
    vigente: active ? safeRate(active) : null,
    historial: Object.freeze(rows.map((row) => Object.freeze({ ...safeRate(row), actor: row.actor }))),
    paginacion: Object.freeze({
      pagina: filters.pagina,
      limite: filters.limite,
      total: Number(count.total),
      paginas: Math.max(1, Math.ceil(Number(count.total) / filters.limite))
    })
  });
}

function safeAdminMethod(row, replayed = false) {
  return Object.freeze({
    referencia: row.codigo,
    tipo: row.tipo,
    nombre: row.nombre,
    instrucciones: row.instrucciones,
    configurado: Boolean(row.configurado),
    visiblePropietario: Boolean(row.visiblePropietario),
    activo: Boolean(row.activo),
    requiereComprobante: Boolean(row.requiereComprobante),
    soloAdministracion: Boolean(row.soloAdministracion),
    orden: Number(row.orden),
    replayed
  });
}

async function adminMethodByCode(connection, code, forUpdate = false) {
  const [rows] = await connection.query(
    `SELECT * FROM metodoPagoSuscripcion WHERE codigo=? LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [code]
  );
  if (!rows.length) throw paymentError(404, 'El metodo de pago no existe.', 'PAYMENT_METHOD_NOT_FOUND');
  return rows[0];
}

async function listAdminMethods(database) {
  const [rows] = await database.query('SELECT * FROM metodoPagoSuscripcion ORDER BY orden,codigo');
  return Object.freeze({ metodos: Object.freeze(rows.map((row) => safeAdminMethod(row))) });
}

async function configurePaymentMethod(database, input) {
  const code = methodReference(input.reference);
  const body = paymentMethodBody(input.body);
  const now = normalizeNow(input.now);
  return withTransaction(database, async (connection) => {
    const method = await adminMethodByCode(connection, code, true);
    const idAdministrador = await validateActor(connection, {
      actorTipo: 'superadmin', idAdministrador: input.idAdministrador
    }, true);
    const operation = await claimPaymentOperation(connection, {
      idTienda: null, actorTipo: 'superadmin', idAdministrador,
      alcance: 'configurar_metodo', idempotencyKey: input.idempotencyKey,
      payload: { codigo: code, ...body }
    }, now);
    if (operation.replayed) {
      return safeAdminMethod(await adminMethodByCode(connection, code), true);
    }
    const administrative = Boolean(method.soloAdministracion);
    const instructions = body.instrucciones;
    const configured = administrative || Boolean(instructions);
    const active = configured && body.activo;
    const visible = !administrative && active && body.visiblePropietario;
    if (!configured && (body.activo || body.visiblePropietario)) {
      throw paymentError(409, 'El metodo requiere instrucciones antes de activarse.', 'PAYMENT_METHOD_CONFIGURATION_INCOMPLETE');
    }
    if (administrative && body.visiblePropietario) {
      throw paymentError(400, 'El metodo administrativo no puede mostrarse al propietario.', 'ADMIN_PAYMENT_METHOD_NOT_PUBLIC');
    }
    await connection.query(
      `UPDATE metodoPagoSuscripcion
       SET instrucciones=?,configurado=?,visiblePropietario=?,activo=?,configuradoPor=?,actualizadoEn=?
       WHERE idMetodoPagoSuscripcion=?`,
      [instructions, configured ? 1 : 0, visible ? 1 : 0, active ? 1 : 0,
        idAdministrador, formatLocalDateTime(now), method.idMetodoPagoSuscripcion]
    );
    await auditPayment(connection, {
      action: 'configuracion_metodo_pago_suscripcion', resultCode: 'PAYMENT_METHOD_CONFIGURED',
      idAdministrador, requestId: input.requestId, now,
      before: { activo: Boolean(method.activo) }, after: { activo: active },
      metadata: { metodoPago: code }
    });
    await completePaymentOperation(connection, operation.id, {
      idMetodo: method.idMetodoPagoSuscripcion, codigo: 'PAYMENT_METHOD_CONFIGURED'
    }, now);
    return safeAdminMethod(await adminMethodByCode(connection, code));
  });
}

function createSaasCPaymentService({
  database = pool,
  clock = getLocalNow,
  analytics = businessAnalytics
} = {}) {
  const at = (input) => input?.now ?? clock();
  return Object.freeze({
    listPublicPlans: (input) => listPublicPlans(database, { ...input, now: at(input) }),
    listOwnerMethods: () => listOwnerMethods(database),
    quote: (input) => quote(database, { ...input, body: quoteBody(input.body), now: at(input) }),
    createRequest: (input) => createPaymentRequest(
      database,
      { ...input, body: quoteBody(input.body), now: at(input) },
      analytics
    ),
    listRequests: (input) => listPaymentRequests(database, { ...input, now: at(input) }),
    requestDetail: (input) => paymentRequestDetail(database, { ...input, now: at(input) }),
    cancelRequest: (input) => cancelPaymentRequest(database, { ...input, now: at(input) }),
    registerExchangeRate: (input) => registerExchangeRate(database, { ...input, now: at(input) }),
    listExchangeRates: (query) => listExchangeRates(database, query),
    listAdminMethods: () => listAdminMethods(database),
    configurePaymentMethod: (input) => configurePaymentMethod(database, { ...input, now: at(input) })
  });
}

module.exports = {
  convertedAmount,
  createSaasCPaymentService,
  materializeExpiredRequests,
  nextAction,
  normalizedDecimal,
  paymentError
};
