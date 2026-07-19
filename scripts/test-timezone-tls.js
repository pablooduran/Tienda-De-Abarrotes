const fs = require('fs');
const path = require('path');
const tls = require('tls');
const { spawnSync } = require('child_process');
const { createDatabaseConnection } = require('../config/database-connection');
const { requireLocalhostDatabase } = require('../config/env');
const {
  BUSINESS_TIME_ZONE,
  MYSQL_SESSION_TIME_ZONE,
  buildDatabaseOptions
} = require('../config/database-options');
const {
  addLocalDays,
  buildSemiOpenDateRange,
  formatLocalDate,
  formatLocalDateTime,
  parseLocalDate,
  parseLocalDateTime,
  startOfLocalDay
} = require('../utils/local-datetime');
const { effectiveStatus } = require('../services/subscription-service');
const { collectionState } = require('../services/customer-credit-service');
const { closeRange } = require('../services/financial-service');
const { validLocalDate } = require('../services/lot-service');

const ROOT = path.join(__dirname, '..');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectThrow(work, fragment) {
  let thrown = null;
  try { work(); } catch (error) { thrown = error; }
  assert(thrown && String(thrown.message).includes(fragment), `Se esperaba un rechazo que incluyera: ${fragment}`);
}

function syntheticEnvironment(overrides = {}) {
  return {
    APP_ENV: 'local',
    NODE_ENV: 'development',
    DB_HOST: 'localhost',
    DB_PORT: '3306',
    DB_USER: 'usuario-prueba-configuracion',
    DB_PASSWORD: 'valor-no-utilizado',
    DB_NAME: 'base_pruebas_configuracion',
    ...overrides
  };
}

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function checkTlsConfiguration() {
  const local = buildDatabaseOptions(syntheticEnvironment());
  assert(local.ssl === undefined, 'La configuracion local no debe habilitar TLS por defecto.');
  assert(local.timezone === MYSQL_SESSION_TIME_ZONE, 'La conexion no conserva la zona horaria MySQL acordada.');
  assert(Array.isArray(local.dateStrings) && local.dateStrings.includes('DATE') && local.dateStrings.includes('DATETIME'),
    'DATE y DATETIME deben recuperarse como texto.');
  const pinned = buildDatabaseOptions(syntheticEnvironment(), {
    host: 'host-no-autorizado',
    timezone: 'Z',
    ssl: { ca: 'CA no autorizada' }
  });
  assert(pinned.host === 'localhost' && pinned.timezone === MYSQL_SESSION_TIME_ZONE && pinned.ssl === undefined,
    'Las opciones auxiliares pudieron reemplazar el destino, la zona horaria o la politica TLS.');

  expectThrow(() => buildDatabaseOptions(syntheticEnvironment({
    APP_ENV: 'production', NODE_ENV: 'production', DB_SSL_ENABLED: 'false'
  })), 'DB_SSL_ENABLED debe ser true');
  expectThrow(() => buildDatabaseOptions(syntheticEnvironment({
    APP_ENV: 'production', NODE_ENV: 'production', DB_SSL_ENABLED: 'true'
  })), 'requiere una CA');

  const trustedCa = tls.rootCertificates[0];
  assert(trustedCa, 'Node no expuso una CA de confianza para la prueba de configuracion.');
  const production = buildDatabaseOptions(syntheticEnvironment({
    APP_ENV: 'production',
    NODE_ENV: 'production',
    DB_SSL_ENABLED: 'true',
    DB_SSL_CA: trustedCa.replace(/\n/g, '\\n')
  }));
  assert(production.ssl?.rejectUnauthorized === true, 'TLS debe verificar siempre el certificado del servidor.');
  assert(production.ssl.ca.includes('\n') && !production.ssl.ca.includes('\\n'),
    'Los saltos de linea escapados de la CA no se normalizaron.');
  assert(!/rejectUnauthorized\s*:\s*false/.test(source('config/database-options.js')),
    'Existe un fallback TLS inseguro.');
  assert(source('config/db.js').includes('databaseConfig(')
    && source('config/database-connection.js').includes('databaseConfig()')
    && source('scripts/db-utils.js').includes('createDatabaseConnection'),
  'Servidor, migrador y comprobadores no comparten la configuracion MySQL central.');
}

function checkDateHelpers() {
  const nearMidnightUtc = new Date('2026-07-20T03:30:00.000Z');
  assert(formatLocalDate(nearMidnightUtc) === '2026-07-19', 'La fecha civil de La Paz se desplazo en medianoche.');
  assert(formatLocalDateTime(nearMidnightUtc) === '2026-07-19 23:30:00', 'El DATETIME local no usa America/La_Paz.');
  assert(formatLocalDateTime(new Date('2026-07-20T04:00:00.000Z')) === '2026-07-20 00:00:00',
    'El cambio de dia local es incorrecto.');
  assert(formatLocalDateTime(parseLocalDateTime('2026-07-19 23:30:00')) === '2026-07-19 23:30:00',
    'El parseo de DATETIME local no conserva el valor civil.');
  assert(formatLocalDate(parseLocalDate('2026-07-19')) === '2026-07-19', 'El parseo de DATE desplazo el dia.');
  assert(formatLocalDateTime(startOfLocalDay(nearMidnightUtc)) === '2026-07-19 00:00:00',
    'El inicio del dia local es incorrecto.');
  assert(formatLocalDate(addLocalDays(parseLocalDate('2026-02-28'), 1)) === '2026-03-01',
    'La suma de dias locales es incorrecta.');
  expectThrow(() => parseLocalDate('2026-02-30'), 'no es valida');

  const range = buildSemiOpenDateRange('2026-07-18', '2026-07-19');
  assert(range.inicio === '2026-07-18 00:00:00' && range.finExclusivo === '2026-07-20 00:00:00',
    'El rango semiabierto local es incorrecto.');
  assert(effectiveStatus({
    idSuscripcion: 1,
    estado: 'activa',
    fechaInicio: '2026-07-01 00:00:00',
    fechaFin: '2026-07-20 00:00:00'
  }, parseLocalDateTime('2026-07-19 23:59:59')) === 'activa', 'La suscripcion vencio antes de la hora local.');
  assert(collectionState({ saldoPendiente: 10, fechaVencimiento: '2026-07-19' }, '2026-07-20', 3) === 'vencido',
    'La alerta de cobranza no usa la fecha civil local.');
  assert(validLocalDate('2026-07-19', 'El vencimiento') === '2026-07-19',
    'El vencimiento de lote no conserva la fecha civil local.');
  expectThrow(() => closeRange({
    fechaInicio: '2099-01-01 00:00:00',
    fechaFin: '2099-01-01 00:00:01'
  }), 'no puede estar en el futuro');
}

function checkOperatingSystemIndependence() {
  const helperPath = path.join(ROOT, 'utils', 'local-datetime.js');
  const snippet = `const h=require(${JSON.stringify(helperPath)});process.stdout.write(h.formatLocalDateTime(new Date('2026-07-20T03:30:00.000Z')));`;
  const outputs = ['UTC', 'Pacific/Auckland'].map((timezone) => spawnSync(process.execPath, ['-e', snippet], {
    encoding: 'utf8',
    env: { ...process.env, TZ: timezone }
  }));
  outputs.forEach((result) => assert(result.status === 0, 'No se pudo validar la independencia de la zona del sistema.'));
  assert(outputs[0].stdout === outputs[1].stdout && outputs[0].stdout === '2026-07-19 23:30:00',
    'El helper temporal depende de TZ del sistema operativo.');
}

function checkBusinessSources() {
  const activeFiles = [
    'routes/admin.js', 'routes/api.js', 'routes/finance.js',
    'services/subscription-service.js', 'services/financial-service.js',
    'services/pos-sale-service.js', 'services/debt-collection-service.js',
    'services/stock-movement-service.js', 'services/lot-service.js'
  ];
  const forbidden = /\b(?:NOW|CURDATE|UTC_TIMESTAMP|CURRENT_TIMESTAMP)\s*\(|\bCURRENT_TIMESTAMP\b|toISOString\s*\(/i;
  activeFiles.forEach((file) => assert(!forbidden.test(source(file)), `${file} conserva un reloj inseguro activo.`));
  assert(source('services/pos-sale-service.js').includes('operationDateTime'), 'La venta no conserva una marca local explicita.');
  assert(/INSERT INTO pagoVenta[\s\S]*creadoEn[\s\S]*operationDateTime/.test(source('services/pos-sale-service.js')),
    'El pago inicial no conserva la hora local de la venta.');
  assert(source('services/debt-collection-service.js').includes('operationDateTime'), 'El cobro no conserva una marca local explicita.');
  assert(source('routes/finance.js').includes('formatLocalDateTime()'), 'El cierre no conserva una marca local explicita.');
  assert(!source('services/inventory-intelligence-service.js').includes('Date.now() + 1000'),
    'El rango de inventario aun fabrica una fecha futura.');
}

async function checkDatabaseRoundTrip() {
  const config = requireLocalhostDatabase('La prueba de TLS y zona horaria');
  if (!/(prueba|test)/i.test(config.database)) {
    throw new Error('La prueba requiere una base local cuyo nombre contenga prueba o test.');
  }
  const connection = await createDatabaseConnection(config);
  try {
    const nodeDateBefore = formatLocalDate();
    const [[clock]] = await connection.query(
      `SELECT @@session.time_zone zonaSesion,
              DATE_FORMAT(NOW(),'%Y-%m-%d %H:%i:%s') ahoraSesion,
              DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','-04:00'),'%Y-%m-%d %H:%i:%s') ahoraLaPaz`
    );
    const nodeDateAfter = formatLocalDate();
    assert(clock.zonaSesion === MYSQL_SESSION_TIME_ZONE, 'La conexion no fijo la zona de sesion MySQL.');
    assert(clock.ahoraSesion === clock.ahoraLaPaz, 'MySQL y la conversion explicita de La Paz no coinciden.');
    assert([nodeDateBefore, nodeDateAfter].includes(clock.ahoraSesion.slice(0, 10)),
      'MySQL y Node no producen el mismo dia local.');

    const [[roundTrip]] = await connection.query(
      'SELECT CAST(? AS DATETIME) fechaHora, CAST(? AS DATE) fechaCivil',
      ['2026-07-19 23:30:00', '2026-07-19']
    );
    assert(roundTrip.fechaHora === '2026-07-19 23:30:00', 'mysql2 desplazo un DATETIME local.');
    assert(roundTrip.fechaCivil === '2026-07-19', 'mysql2 desplazo un DATE civil.');

    const [grouped] = await connection.query(
      `SELECT DATE(m.fecha) fecha, COUNT(*) cantidad
       FROM (SELECT CAST(? AS DATETIME) fecha UNION ALL SELECT CAST(? AS DATETIME) fecha) m
       GROUP BY DATE(m.fecha) ORDER BY DATE(m.fecha)`,
      ['2026-07-19 10:00:00', '2026-07-19 11:00:00']
    );
    assert(grouped.length === 1 && Number(grouped[0].cantidad) === 2,
      'La consulta temporal no es compatible con ONLY_FULL_GROUP_BY.');
  } finally {
    await connection.end();
  }
}

async function main() {
  assert(BUSINESS_TIME_ZONE === 'America/La_Paz', 'La zona de negocio configurada no es la aprobada.');
  checkTlsConfiguration();
  checkDateHelpers();
  checkOperatingSystemIndependence();
  checkBusinessSources();
  await checkDatabaseRoundTrip();
  console.log('Prueba de TLS y zona horaria completada correctamente.');
}

main().catch((error) => {
  console.error('La prueba de TLS y zona horaria fallo.');
  console.error(error.message);
  process.exit(1);
});
