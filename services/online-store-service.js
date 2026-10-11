const crypto = require('crypto');
const pool = require('../config/db');
const { resolveSubscriptionAccess } = require('./subscription-access-service');
const { enforcePlanLimit } = require('./subscription-service');
const { formatLocalDateTime } = require('../utils/local-datetime');
const { AppError } = require('../utils/app-error');
const { insertStockMovement, movementKey } = require('./stock-movement-service');
const { applyLotExit, insertLotMovement, prepareLotExit } = require('./lot-service');

function positiveId(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new AppError(400, `${label} no es valido.`, 'ONLINE_STORE_INPUT_INVALID');
  }
  return parsed;
}

function cleanText(value, maximum, label, { nullable = true } = {}) {
  const text = String(value ?? '').trim();
  if (!text && nullable) return null;
  if (!text || text.length > maximum) {
    throw new AppError(400, `${label} debe tener entre 1 y ${maximum} caracteres.`, 'ONLINE_STORE_INPUT_INVALID');
  }
  return text;
}

function booleanValue(value, label) {
  if (value === true || value === 1 || value === '1') return 1;
  if (value === false || value === 0 || value === '0') return 0;
  throw new AppError(400, `${label} no es valido.`, 'ONLINE_STORE_INPUT_INVALID');
}

function decimalValue(value, label, maximum = 999999.99) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > maximum) {
    throw new AppError(400, `${label} no es valido.`, 'ONLINE_STORE_INPUT_INVALID');
  }
  return Math.round(parsed * 100) / 100;
}

function integerValue(value, label, minimum, maximum, { nullable = false } = {}) {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new AppError(400, `${label} debe estar entre ${minimum} y ${maximum}.`, 'ONLINE_STORE_INPUT_INVALID');
  }
  return parsed;
}

function normalizePhone(value) {
  const original = cleanText(value, 30, 'El telefono', { nullable: false });
  const normalized = original.replace(/\D/g, '');
  if (normalized.length < 7 || normalized.length > 15) {
    throw new AppError(400, 'Ingresa un numero de telefono valido.', 'ONLINE_STORE_PHONE_INVALID');
  }
  return { original, normalized };
}

function phoneCandidates(normalized, countryCode = '591') {
  const code = String(countryCode || '591').replace(/\D/g, '') || '591';
  const candidates = new Set([normalized]);
  if (normalized.startsWith(code) && normalized.length > code.length + 5) candidates.add(normalized.slice(code.length));
  else candidates.add(`${code}${normalized}`);
  return [...candidates];
}

function normalizedIdentityName(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, ' ').trim().toLowerCase();
}

function enumValue(value, allowed, label) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!allowed.includes(normalized)) throw new AppError(400, `${label} no es valido.`, 'ONLINE_STORE_INPUT_INVALID');
  return normalized;
}

function publicConfiguration(row) {
  return {
    activa: Boolean(row.activa),
    mensajeBienvenida: row.mensajeBienvenida || '',
    permiteRecojo: Boolean(row.permiteRecojo),
    permiteEntrega: Boolean(row.permiteEntrega),
    permiteEfectivo: Boolean(row.permiteEfectivo),
    permiteQr: Boolean(row.permiteQr),
    pedidoMinimo: Number(row.pedidoMinimo || 0),
    entregaGratisDesde: Number(row.pedidoMinimo || 0),
    costoEntrega: Number(row.costoEntrega || 0),
    tiempoPreparacionMinutos: Number(row.tiempoPreparacionMinutos || 30)
  };
}

function ownerProduct(row) {
  return {
    idProducto: Number(row.idProducto),
    nombre: row.nombre,
    categoria: row.categoria,
    unidadMedida: row.unidadMedida,
    precioVenta: Number(row.precioVenta),
    stockUnidadesTotal: Number(row.stockUnidadesTotal),
    stockMinimo: Number(row.stockMinimo),
    publicado: Boolean(row.publicado)
  };
}

function availabilityFor(row) {
  const stock = Number(row.stockUnidadesTotal);
  if (stock <= 0) return 'agotado';
  if (stock <= Number(row.stockMinimo)) return 'pocas_unidades';
  return 'disponible';
}

function publicProduct(row) {
  return {
    idProducto: Number(row.idProducto),
    nombre: row.nombre,
    categoria: row.categoria,
    unidadMedida: row.unidadMedida,
    precioVenta: Number(row.precioVenta),
    disponibilidad: availabilityFor(row)
  };
}

function createOnlineStoreService({
  database = pool,
  subscriptionResolver = resolveSubscriptionAccess,
  planLimitEnforcer = enforcePlanLimit,
  clock = () => formatLocalDateTime()
} = {}) {
  async function resolvePublicStore(slugValue) {
    const slug = String(slugValue || '').trim().toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 120) {
      throw new AppError(404, 'La tienda no esta disponible.', 'PUBLIC_STORE_NOT_FOUND');
    }
    const [stores] = await database.query(
      `SELECT t.idTienda,t.slug,t.nombre,c.nombreMostrado,COALESCE(cc.codigoPaisWhatsApp,'591') codigoPaisTelefono,
              o.activa,o.mensajeBienvenida,o.permiteRecojo,o.permiteEntrega,
              o.permiteEfectivo,o.permiteQr,o.pedidoMinimo,o.costoEntrega,o.tiempoPreparacionMinutos
       FROM tienda t
       JOIN configuracionTienda c ON c.idTienda=t.idTienda
       JOIN configuracionTiendaOnline o ON o.idTienda=t.idTienda
       LEFT JOIN configuracionCreditoTienda cc ON cc.idTienda=t.idTienda
       WHERE t.slug=? AND t.activo=1 AND t.estado='activa' LIMIT 1`,
      [slug]
    );
    const store = stores[0];
    if (!store || !Number(store.activa)) throw new AppError(404, 'La tienda no esta disponible.', 'PUBLIC_STORE_NOT_FOUND');
    const subscription = await subscriptionResolver(database, Number(store.idTienda), { materialize: false });
    if (subscription.estadoAcceso !== 'completo' || !subscription.caracteristicas?.includes('portal_clientes')) {
      throw new AppError(404, 'La tienda no esta disponible.', 'PUBLIC_STORE_NOT_FOUND');
    }
    return { store, subscription };
  }

  async function getConfiguration(idTienda) {
    const storeId = positiveId(idTienda, 'La tienda');
    const [rows] = await database.query(
      `SELECT t.slug,c.*
       FROM tienda t
       JOIN configuracionTiendaOnline c ON c.idTienda=t.idTienda
       WHERE t.idTienda=? LIMIT 1`,
      [storeId]
    );
    if (!rows[0]) throw new AppError(404, 'La configuracion de la tienda online no esta disponible.', 'ONLINE_STORE_NOT_FOUND');
    return { enlacePublico: `/tienda/${rows[0].slug}`, configuracion: publicConfiguration(rows[0]) };
  }

  async function updateConfiguration(context, body = {}) {
    const idTienda = positiveId(context?.idTienda, 'La tienda');
    const idAdministrador = positiveId(context?.idAdministrador, 'El administrador');
    const patch = {
      activa: booleanValue(body.activa, 'El estado de la tienda online'),
      mensajeBienvenida: cleanText(body.mensajeBienvenida, 300, 'El mensaje de bienvenida'),
      permiteRecojo: booleanValue(body.permiteRecojo, 'La opcion de recojo'),
      permiteEntrega: booleanValue(body.permiteEntrega, 'La opcion de entrega'),
      permiteEfectivo: booleanValue(body.permiteEfectivo, 'La opcion de efectivo'),
      permiteQr: booleanValue(body.permiteQr, 'La opcion de QR'),
      pedidoMinimo: decimalValue(body.entregaGratisDesde ?? body.pedidoMinimo, 'El monto para entrega sin costo'),
      costoEntrega: decimalValue(body.costoEntrega, 'El costo de entrega'),
      tiempoPreparacionMinutos: integerValue(body.tiempoPreparacionMinutos, 'El tiempo de preparacion', 5, 1440)
    };
    if (!patch.permiteRecojo && !patch.permiteEntrega) {
      throw new AppError(400, 'Habilita recojo o entrega para recibir pedidos.', 'ONLINE_STORE_DELIVERY_REQUIRED');
    }
    if (!patch.permiteEfectivo && !patch.permiteQr) {
      throw new AppError(400, 'Habilita efectivo o QR como forma de pago.', 'ONLINE_STORE_PAYMENT_REQUIRED');
    }
    await database.query(
      `UPDATE configuracionTiendaOnline
       SET activa=?,mensajeBienvenida=?,permiteRecojo=?,permiteEntrega=?,permiteEfectivo=?,permiteQr=?,
           pedidoMinimo=?,costoEntrega=?,tiempoPreparacionMinutos=?,actualizadoEn=?,idAdministradorActualiza=?
       WHERE idTienda=?`,
      [patch.activa, patch.mensajeBienvenida, patch.permiteRecojo, patch.permiteEntrega,
        patch.permiteEfectivo, patch.permiteQr, patch.pedidoMinimo, patch.costoEntrega,
        patch.tiempoPreparacionMinutos, clock(), idAdministrador, idTienda]
    );
    return getConfiguration(idTienda);
  }

  async function listProducts(idTienda) {
    const storeId = positiveId(idTienda, 'La tienda');
    const [rows] = await database.query(
      `SELECT p.idProducto,p.nombre,p.categoria,p.unidadMedida,p.precioVenta,
              p.stockUnidadesTotal,p.stockMinimo,
              COALESCE(o.publicado,1) publicado
       FROM producto p
       LEFT JOIN productoCatalogoOnline o ON o.idTienda=p.idTienda AND o.idProducto=p.idProducto
       WHERE p.idTienda=? AND p.activo=1
       ORDER BY p.nombre`,
      [storeId]
    );
    return { productos: rows.map(ownerProduct) };
  }

  async function updateProduct(context, idProducto, body = {}) {
    const idTienda = positiveId(context?.idTienda, 'La tienda');
    const idAdministrador = positiveId(context?.idAdministrador, 'El administrador');
    const productId = positiveId(idProducto, 'El producto');
    const published = booleanValue(body.publicado, 'La publicacion');
    const [products] = await database.query(
      'SELECT idProducto FROM producto WHERE idTienda=? AND idProducto=? AND activo=1 LIMIT 1',
      [idTienda, productId]
    );
    if (!products[0]) throw new AppError(404, 'El producto no pertenece a esta tienda o ya no esta activo.', 'ONLINE_STORE_PRODUCT_NOT_FOUND');
    const now = clock();
    await database.query(
      `INSERT INTO productoCatalogoOnline
       (idTienda,idProducto,publicado,destacado,descripcionPublica,cantidadMaximaPedido,
        permiteSustitucion,creadoEn,actualizadoEn,idAdministradorActualiza)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE publicado=VALUES(publicado),destacado=VALUES(destacado),
         descripcionPublica=VALUES(descripcionPublica),cantidadMaximaPedido=VALUES(cantidadMaximaPedido),
         permiteSustitucion=VALUES(permiteSustitucion),actualizadoEn=VALUES(actualizadoEn),
         idAdministradorActualiza=VALUES(idAdministradorActualiza)`,
      [idTienda, productId, published, 0, null, null, 0, now, now, idAdministrador]
    );
    const data = await listProducts(idTienda);
    return { producto: data.productos.find((product) => product.idProducto === productId) };
  }

  async function getPublicCatalog(slugValue) {
    const { store, subscription } = await resolvePublicStore(slugValue);
    const [rows] = await database.query(
      `SELECT p.idProducto,p.nombre,p.categoria,p.unidadMedida,p.precioVenta,
              p.stockUnidadesTotal,p.stockMinimo
       FROM producto p
       LEFT JOIN productoCatalogoOnline o ON o.idTienda=p.idTienda AND o.idProducto=p.idProducto
       WHERE p.idTienda=? AND COALESCE(o.publicado,1)=1 AND p.activo=1
       ORDER BY p.nombre`,
      [store.idTienda]
    );
    return {
      tienda: {
        nombre: store.nombreMostrado || store.nombre,
        slug: store.slug,
        codigoPaisTelefono: store.codigoPaisTelefono || '591',
        mensajeBienvenida: store.mensajeBienvenida || '',
        opciones: {
          recojo: Boolean(store.permiteRecojo),
          entrega: Boolean(store.permiteEntrega),
          efectivo: Boolean(store.permiteEfectivo),
          qr: Boolean(store.permiteQr)
        },
        pedidoMinimo: Number(store.pedidoMinimo || 0),
        entregaGratisDesde: Number(store.pedidoMinimo || 0),
        costoEntrega: Number(store.costoEntrega || 0),
        tiempoPreparacionMinutos: Number(store.tiempoPreparacionMinutos || 30)
      },
      plan: {
        codigo: subscription.plan?.codigo || null,
        limitePedidosMes: subscription.plan?.codigo === 'standard' ? 30 : null
      },
      categorias: [...new Set(rows.map((row) => row.categoria))].sort((a, b) => a.localeCompare(b, 'es')),
      productos: rows.map(publicProduct)
    };
  }

  async function identifyPublicCustomer(slugValue, phoneValue) {
    const { store } = await resolvePublicStore(slugValue);
    const phone = normalizePhone(phoneValue);
    const candidates = phoneCandidates(phone.normalized, store.codigoPaisTelefono);
    const [rows] = await database.query(
      `SELECT nombre,direccion FROM cliente
       WHERE idTienda=? AND telefonoNormalizado IN (${candidates.map(() => '?').join(',')}) AND activo=1 LIMIT 1`,
      [store.idTienda, ...candidates]
    );
    return rows[0]
      ? { encontrado: true, cliente: { nombre: rows[0].nombre, direccion: rows[0].direccion || '' } }
      : { encontrado: false, cliente: null };
  }

  async function createPublicOrder(slugValue, body = {}) {
    const { store, subscription } = await resolvePublicStore(slugValue);
    const phone = normalizePhone(body.telefono);
    const customerName = cleanText(body.nombre, 100, 'El nombre', { nullable: false });
    const fulfillment = enumValue(body.tipoEntrega, ['recojo', 'entrega'], 'La forma de entrega');
    const slot = enumValue(body.franjaEntrega, ['manana', 'tarde', 'noche'], 'El horario');
    const payment = enumValue(body.metodoPago, ['efectivo', 'qr'], 'La forma de pago');
    const address = cleanText(body.direccionEntrega, 255, 'La direccion');
    const notes = cleanText(body.notas, 500, 'Las notas');
    if (fulfillment === 'recojo' && !Number(store.permiteRecojo)) throw new AppError(400, 'El recojo no esta habilitado.', 'ONLINE_STORE_DELIVERY_INVALID');
    if (fulfillment === 'entrega' && (!Number(store.permiteEntrega) || !address)) throw new AppError(400, 'Ingresa una direccion para la entrega.', 'ONLINE_STORE_DELIVERY_INVALID');
    if (payment === 'efectivo' && !Number(store.permiteEfectivo)) throw new AppError(400, 'El pago en efectivo no esta habilitado.', 'ONLINE_STORE_PAYMENT_INVALID');
    if (payment === 'qr' && !Number(store.permiteQr)) throw new AppError(400, 'El pago por QR no esta habilitado.', 'ONLINE_STORE_PAYMENT_INVALID');
    const rawItems = Array.isArray(body.productos) ? body.productos : [];
    if (!rawItems.length || rawItems.length > 100) throw new AppError(400, 'El pedido debe incluir entre 1 y 100 productos.', 'ONLINE_STORE_ITEMS_INVALID');
    const items = rawItems.map((item) => ({
      idProducto: positiveId(item.idProducto, 'El producto'),
      cantidad: integerValue(item.cantidad, 'La cantidad', 1, 10000)
    }));
    if (new Set(items.map((item) => item.idProducto)).size !== items.length) throw new AppError(400, 'No repitas productos en el pedido.', 'ONLINE_STORE_ITEMS_INVALID');

    const connection = database.getConnection ? await database.getConnection() : database;
    try {
      await connection.beginTransaction?.();
      await connection.query('SELECT idTienda FROM tienda WHERE idTienda=? FOR UPDATE', [store.idTienda]);
      const [sequenceRows] = await connection.query(
        'SELECT COUNT(*) total FROM pedidoTiendaOnline WHERE idTienda=?',
        [store.idTienda]
      );
      const orderNumber = Number(sequenceRows[0]?.total || 0) + 1;
      if (subscription.plan?.codigo === 'standard') {
        const [quotaRows] = await connection.query(
          `SELECT COUNT(*) total FROM pedidoTiendaOnline
           WHERE idTienda=? AND creadoEn>=DATE_FORMAT(?, '%Y-%m-01 00:00:00') AND estado<>'cancelado'`,
          [store.idTienda, clock()]
        );
        if (Number(quotaRows[0]?.total || 0) >= 30) throw new AppError(403, 'El plan Standard alcanzo sus 30 pedidos online del mes. Puedes pasar a Pro para recibir pedidos sin limite.', 'ONLINE_STORE_MONTHLY_LIMIT');
      }
      const placeholders = items.map(() => '?').join(',');
      const [products] = await connection.query(
        `SELECT p.idProducto,p.nombre,p.unidadMedida,p.precioVenta,p.stockUnidadesTotal,
                COALESCE(o.publicado,1) publicado
         FROM producto p
         LEFT JOIN productoCatalogoOnline o ON o.idTienda=p.idTienda AND o.idProducto=p.idProducto
         WHERE p.idTienda=? AND p.idProducto IN (${placeholders}) AND p.activo=1 FOR UPDATE`,
        [store.idTienda, ...items.map((item) => item.idProducto)]
      );
      const byId = new Map(products.map((product) => [Number(product.idProducto), product]));
      let subtotalCents = 0;
      const stockProblems = [];
      for (const item of items) {
        const product = byId.get(item.idProducto);
        const available = Math.max(0, Number(product?.stockUnidadesTotal || 0));
        if (!product || !Number(product.publicado) || available < item.cantidad) {
          stockProblems.push({
            nombre: product?.nombre || `Producto ${item.idProducto}`,
            solicitado: item.cantidad,
            disponible: product && Number(product.publicado) ? available : 0
          });
          continue;
        }
        subtotalCents += Math.round(Number(product.precioVenta) * 100) * item.cantidad;
      }
      if (stockProblems.length) {
        const detail = stockProblems.map((problem) => `${problem.nombre}: pediste ${problem.solicitado} y solo quedan ${problem.disponible}.`).join(' ');
        throw new AppError(409, `No alcanza el stock. ${detail} Reduce la cantidad en el carrito e intenta nuevamente.`, 'ONLINE_STORE_STOCK_CHANGED');
      }
      const subtotal = subtotalCents / 100;
      const freeFrom = Number(store.pedidoMinimo || 0);
      const deliveryCost = fulfillment === 'entrega' && (freeFrom <= 0 || subtotal < freeFrom) ? Number(store.costoEntrega || 0) : 0;
      const [customers] = await connection.query(
        `SELECT idCliente,nombre,direccion FROM cliente
         WHERE idTienda=? AND telefonoNormalizado IN (${phoneCandidates(phone.normalized, store.codigoPaisTelefono).map(() => '?').join(',')})
           AND activo=1 LIMIT 1 FOR UPDATE`,
        [store.idTienda, ...phoneCandidates(phone.normalized, store.codigoPaisTelefono)]
      );
      let customerId = customers[0]?.idCliente || null;
      if (customerId && normalizedIdentityName(customerName) !== normalizedIdentityName(customers[0].nombre)) {
        throw new AppError(409, 'El nombre no coincide con el cliente registrado para este teléfono.', 'ONLINE_STORE_CUSTOMER_NAME_MISMATCH');
      }
      if (!customerId) {
        await planLimitEnforcer(connection, store.idTienda, 'clientes');
        const now = clock();
        const [createdCustomer] = await connection.query(
          `INSERT INTO cliente (idTienda,nombre,telefono,direccion,telefonoNormalizado,permiteFiado,canalPreferido,aceptaRecordatorios,activo,creadoEn,actualizadoEn)
           VALUES (?,?,?,?,?,1,'whatsapp',1,1,?,?)`,
          [store.idTienda, customerName, phone.original, address, phone.normalized, now, now]
        );
        customerId = createdCustomer.insertId;
      }
      const code = crypto.randomBytes(6).toString('hex').toUpperCase();
      const now = clock();
      const [created] = await connection.query(
        `INSERT INTO pedidoTiendaOnline
         (idTienda,codigoPublico,idCliente,nombreCliente,telefonoCliente,telefonoNormalizado,direccionEntrega,tipoEntrega,franjaEntrega,metodoPago,estado,estadoPago,subtotal,costoEntrega,total,notasCliente,creadoEn,actualizadoEn)
         VALUES (?,?,?,?,?,?,?,?,?,?,'pendiente','pendiente',?,?,?,?,?,?)`,
        [store.idTienda, code, customerId, customers[0]?.nombre || customerName, phone.original, phone.normalized,
          fulfillment === 'entrega' ? address : null, fulfillment, slot, payment, subtotal, deliveryCost,
          subtotal + deliveryCost, notes, now, now]
      );
      for (const item of items) {
        const product = byId.get(item.idProducto);
        const price = Number(product.precioVenta);
        await connection.query(
          `INSERT INTO detallePedidoTiendaOnline
           (idTienda,idPedidoOnline,idProducto,nombreProductoSnapshot,unidadMedidaSnapshot,cantidad,precioUnitario,subtotal)
           VALUES (?,?,?,?,?,?,?,?)`,
          [store.idTienda, created.insertId, item.idProducto, product.nombre, product.unidadMedida, item.cantidad, price, price * item.cantidad]
        );
      }
      await connection.commit?.();
      return { pedido: { codigo: String(orderNumber).padStart(3, '0'), numero: orderNumber, estado: 'pendiente', total: subtotal + deliveryCost } };
    } catch (error) {
      await connection.rollback?.();
      throw error;
    } finally {
      connection.release?.();
    }
  }

  async function listOrders(idTienda, query = {}) {
    const storeId = positiveId(idTienda, 'La tienda');
    const status = String(query.estado || 'activos');
    const condition = status === 'todos' ? '' : status === 'activos' ? "AND p.estado NOT IN ('entregado','cancelado')" : 'AND p.estado=?';
    const params = status === 'todos' || status === 'activos' ? [storeId] : [storeId, enumValue(status, ['pendiente','confirmado','preparando','listo','entregado','cancelado'], 'El estado')];
    const [rows] = await database.query(
      `SELECT p.*,
              (SELECT COUNT(*) FROM pedidoTiendaOnline secuencia
               WHERE secuencia.idTienda=p.idTienda AND secuencia.idPedidoOnline<=p.idPedidoOnline) numeroPedido
       FROM pedidoTiendaOnline p WHERE p.idTienda=? ${condition} ORDER BY p.creadoEn DESC LIMIT 200`, params
    );
    if (!rows.length) return { pedidos: [] };
    const [details] = await database.query(
      `SELECT * FROM detallePedidoTiendaOnline WHERE idTienda=? AND idPedidoOnline IN (${rows.map(() => '?').join(',')}) ORDER BY idDetallePedidoOnline`,
      [storeId, ...rows.map((row) => row.idPedidoOnline)]
    );
    return { pedidos: rows.map((row) => ({ ...row, productos: details.filter((item) => Number(item.idPedidoOnline) === Number(row.idPedidoOnline)) })) };
  }

  async function lockOrderItems(connection, idTienda, orderId) {
    const [items] = await connection.query(
      `SELECT d.idDetallePedidoOnline,d.idProducto,d.nombreProductoSnapshot,d.cantidad,
              p.nombre,p.stockUnidadesTotal,p.controlaLotes,p.controlaVencimiento,p.activo
       FROM detallePedidoTiendaOnline d
       JOIN producto p ON p.idTienda=d.idTienda AND p.idProducto=d.idProducto
       WHERE d.idTienda=? AND d.idPedidoOnline=?
       ORDER BY d.idProducto FOR UPDATE`,
      [idTienda, orderId]
    );
    if (!items.length) throw new AppError(409, 'El pedido no tiene productos para descontar.', 'ONLINE_STORE_ORDER_ITEMS_MISSING');
    return items;
  }

  async function deductOrderInventory(connection, { idTienda, idAdministrador, orderId, now }) {
    const items = await lockOrderItems(connection, idTienda, orderId);
    const prepared = [];
    for (const item of items) {
      const available = Number(item.stockUnidadesTotal || 0);
      const quantity = Number(item.cantidad);
      if (!Number(item.activo) || available < quantity) {
        throw new AppError(409,
          `${item.nombreProductoSnapshot}: el pedido necesita ${quantity}, pero solo quedan ${Math.max(0, available)} unidades. Repón stock o cancela el pedido.`,
          'ONLINE_STORE_READY_STOCK_INSUFFICIENT');
      }
      prepared.push({
        item,
        lotExit: await prepareLotExit(connection, { idTienda, product: item, cantidad: quantity })
      });
    }
    for (let index = 0; index < prepared.length; index += 1) {
      const { item, lotExit } = prepared[index];
      const stockBefore = Number(item.stockUnidadesTotal);
      const stockAfter = stockBefore - Number(item.cantidad);
      const [updated] = await connection.query(
        `UPDATE producto SET stockUnidadesTotal=?,stock=?
         WHERE idTienda=? AND idProducto=? AND activo=1 AND stockUnidadesTotal=?`,
        [stockAfter, stockAfter, idTienda, item.idProducto, stockBefore]
      );
      if (!updated.affectedRows) {
        throw new AppError(409, `${item.nombreProductoSnapshot}: el stock cambió mientras se preparaba el pedido. Intenta nuevamente.`, 'ONLINE_STORE_READY_STOCK_CHANGED');
      }
      const stockMovementId = await insertStockMovement(connection, {
        idTienda,
        idProducto: item.idProducto,
        tipoMovimiento: 'salida',
        origen: 'otro',
        cantidad: -Number(item.cantidad),
        stockAnterior: stockBefore,
        stockPosterior: stockAfter,
        cantidadOperacion: Number(item.cantidad),
        unidadOperacion: 'unidad_base',
        motivo: 'Salida por pedido de tienda online listo.',
        observacion: `Pedido online ${orderId}.`,
        referenciaTipo: 'pedido_tienda_online',
        referenciaId: orderId,
        claveOperacion: movementKey('pedido-online', `${orderId}:salida:${item.idDetallePedidoOnline}`),
        idAdministrador,
        creadoEn: now
      });
      await applyLotExit(connection, {
        prepared: lotExit,
        idTienda,
        idProducto: item.idProducto,
        idMovimientoStock: stockMovementId,
        operation: `pedido-online:${orderId}:salida`,
        detailIndex: index + 1,
        creadoEn: now,
        idAdministrador
      });
    }
  }

  async function restoreOrderLots(connection, { item, sourceMovementId, returnMovementId, idTienda, idAdministrador, orderId, detailIndex, now }) {
    if (!Number(item.controlaLotes)) return;
    const [allocations] = await connection.query(
      `SELECT ml.idMovimientoLote,ml.idLoteProducto,ml.cantidad,lp.cantidadRestante
       FROM movimientoLote ml
       JOIN loteProducto lp ON lp.idTienda=ml.idTienda AND lp.idProducto=ml.idProducto AND lp.idLoteProducto=ml.idLoteProducto
       WHERE ml.idTienda=? AND ml.idProducto=? AND ml.idMovimientoStock=? AND ml.cantidad<0
       ORDER BY ml.idMovimientoLote FOR UPDATE`,
      [idTienda, item.idProducto, sourceMovementId]
    );
    const allocated = allocations.reduce((sum, allocation) => sum + Math.abs(Number(allocation.cantidad)), 0);
    if (allocated !== Number(item.cantidad)) {
      throw new AppError(409, `${item.nombreProductoSnapshot}: no se pudo reconstruir la salida original de lotes.`, 'ONLINE_STORE_LOT_RESTORE_INCOMPLETE');
    }
    for (let index = 0; index < allocations.length; index += 1) {
      const allocation = allocations[index];
      const quantity = Math.abs(Number(allocation.cantidad));
      const before = Number(allocation.cantidadRestante);
      const after = before + quantity;
      const [updated] = await connection.query(
        `UPDATE loteProducto SET cantidadRestante=?,actualizadoEn=?,idAdministradorActualiza=?
         WHERE idTienda=? AND idProducto=? AND idLoteProducto=? AND cantidadRestante=?`,
        [after, now, idAdministrador, idTienda, item.idProducto, allocation.idLoteProducto, before]
      );
      if (!updated.affectedRows) throw new AppError(409, `${item.nombreProductoSnapshot}: un lote cambió durante la reposición.`, 'ONLINE_STORE_LOT_RESTORE_CHANGED');
      await insertLotMovement(connection, {
        idTienda,
        idProducto: item.idProducto,
        idLoteProducto: allocation.idLoteProducto,
        idMovimientoStock: returnMovementId,
        tipoRegistro: 'movimiento_stock',
        cantidad: quantity,
        cantidadAnterior: before,
        cantidadPosterior: after,
        claveOperacion: `ml:pedido-online:${orderId}:reintegro:d${detailIndex}:l${index + 1}`,
        creadoEn: now,
        idAdministrador
      });
    }
  }

  async function restoreOrderInventory(connection, { idTienda, idAdministrador, orderId, now }) {
    const items = await lockOrderItems(connection, idTienda, orderId);
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const sourceKey = movementKey('pedido-online', `${orderId}:salida:${item.idDetallePedidoOnline}`);
      const [sourceRows] = await connection.query(
        `SELECT idMovimientoStock FROM movimientoStock
         WHERE idTienda=? AND idProducto=? AND claveOperacion=? LIMIT 1 FOR UPDATE`,
        [idTienda, item.idProducto, sourceKey]
      );
      if (!sourceRows[0]) throw new AppError(409, `${item.nombreProductoSnapshot}: no se encontró la salida de inventario original.`, 'ONLINE_STORE_STOCK_MOVEMENT_MISSING');
      const stockBefore = Number(item.stockUnidadesTotal);
      const stockAfter = stockBefore + Number(item.cantidad);
      const [updated] = await connection.query(
        `UPDATE producto SET stockUnidadesTotal=?,stock=?
         WHERE idTienda=? AND idProducto=? AND stockUnidadesTotal=?`,
        [stockAfter, stockAfter, idTienda, item.idProducto, stockBefore]
      );
      if (!updated.affectedRows) throw new AppError(409, `${item.nombreProductoSnapshot}: el stock cambió durante la reposición.`, 'ONLINE_STORE_RESTORE_STOCK_CHANGED');
      const returnMovementId = await insertStockMovement(connection, {
        idTienda,
        idProducto: item.idProducto,
        tipoMovimiento: 'entrada',
        origen: 'otro',
        cantidad: Number(item.cantidad),
        stockAnterior: stockBefore,
        stockPosterior: stockAfter,
        cantidadOperacion: Number(item.cantidad),
        unidadOperacion: 'unidad_base',
        motivo: 'Reposición por cancelación de pedido de tienda online.',
        observacion: `Pedido online ${orderId}.`,
        referenciaTipo: 'pedido_tienda_online',
        referenciaId: orderId,
        claveOperacion: movementKey('pedido-online', `${orderId}:reintegro:${item.idDetallePedidoOnline}`),
        idAdministrador,
        creadoEn: now
      });
      await restoreOrderLots(connection, {
        item,
        sourceMovementId: sourceRows[0].idMovimientoStock,
        returnMovementId,
        idTienda,
        idAdministrador,
        orderId,
        detailIndex: index + 1,
        now
      });
    }
  }

  async function updateOrder(context, idPedidoOnline, body = {}) {
    const idTienda = positiveId(context?.idTienda, 'La tienda');
    const idAdministrador = positiveId(context?.idAdministrador, 'El administrador');
    const orderId = positiveId(idPedidoOnline, 'El pedido');
    const status = enumValue(body.estado, ['pendiente','confirmado','preparando','listo','entregado','cancelado'], 'El estado');
    const connection = database.getConnection ? await database.getConnection() : database;
    try {
      await connection.beginTransaction?.();
      const [orders] = await connection.query(
        'SELECT estado FROM pedidoTiendaOnline WHERE idTienda=? AND idPedidoOnline=? LIMIT 1 FOR UPDATE',
        [idTienda, orderId]
      );
      if (!orders.length) throw new AppError(404, 'El pedido no existe.', 'ONLINE_STORE_ORDER_NOT_FOUND');
      const currentStatus = orders[0].estado;
      const nextStatus = { pendiente: 'preparando', confirmado: 'preparando', preparando: 'listo', listo: 'entregado' }[currentStatus];
      if (status !== 'cancelado' && status !== nextStatus) {
        throw new AppError(409, 'El pedido debe avanzar al siguiente paso.', 'ONLINE_STORE_ORDER_INVALID_TRANSITION');
      }
      if (['entregado', 'cancelado'].includes(currentStatus)) {
        throw new AppError(409, 'Este pedido ya está cerrado.', 'ONLINE_STORE_ORDER_CLOSED');
      }
      const now = clock();
      if (currentStatus === 'preparando' && status === 'listo') {
        await deductOrderInventory(connection, { idTienda, idAdministrador, orderId, now });
      } else if (currentStatus === 'listo' && status === 'cancelado') {
        await restoreOrderInventory(connection, { idTienda, idAdministrador, orderId, now });
      }
      const paymentStatus = status === 'entregado' ? 'pagado' : 'pendiente';
      const [result] = await connection.query(
        `UPDATE pedidoTiendaOnline SET estado=?,estadoPago=?,actualizadoEn=?,idAdministradorActualiza=?
         WHERE idTienda=? AND idPedidoOnline=? AND estado=?`,
        [status, paymentStatus, now, idAdministrador, idTienda, orderId, currentStatus]
      );
      if (!result.affectedRows) throw new AppError(409, 'El pedido no pudo actualizarse.', 'ONLINE_STORE_ORDER_UPDATE_CONFLICT');
      await connection.commit?.();
      return { actualizado: true, inventario: status === 'listo' ? 'descontado' : (currentStatus === 'listo' && status === 'cancelado' ? 'repuesto' : 'sin_cambios') };
    } catch (error) {
      await connection.rollback?.();
      throw error;
    } finally {
      connection.release?.();
    }
  }

  return Object.freeze({ getConfiguration, updateConfiguration, listProducts, updateProduct, getPublicCatalog, identifyPublicCustomer, createPublicOrder, listOrders, updateOrder });
}

const onlineStoreService = createOnlineStoreService();
module.exports = { createOnlineStoreService, onlineStoreService, publicConfiguration, publicProduct };
