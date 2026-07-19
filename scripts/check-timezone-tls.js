const fs = require('fs');
const path = require('path');
const { createDatabaseConnection } = require('../config/database-connection');
const { databaseConfig, databaseTarget, logDatabaseTarget } = require('../config/env');
const {
  BUSINESS_TIME_ZONE,
  MYSQL_SESSION_TIME_ZONE,
  isProductionEnvironment
} = require('../config/database-options');
const { formatLocalDate } = require('../utils/local-datetime');

const ROOT = path.join(__dirname, '..');
const ACTIVE_FILES = [
  'routes/admin.js', 'routes/api.js', 'routes/finance.js', 'routes/customers-credit.js',
  'services/subscription-service.js', 'services/financial-service.js',
  'services/inventory-intelligence-service.js', 'services/pos-sale-service.js',
  'services/debt-collection-service.js', 'services/stock-movement-service.js',
  'services/lot-service.js', 'services/customer-credit-service.js'
];

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function activeTimeFindings() {
  const pattern = /\b(?:NOW|CURDATE|UTC_TIMESTAMP|CURRENT_TIMESTAMP)\s*\(|\bCURRENT_TIMESTAMP\b|toISOString\s*\(/ig;
  const findings = [];
  for (const file of ACTIVE_FILES) {
    const lines = source(file).split(/\r?\n/);
    lines.forEach((line, index) => {
      pattern.lastIndex = 0;
      if (pattern.test(line)) findings.push({ archivo: file, linea: index + 1 });
    });
  }
  return findings;
}

async function main() {
  const config = databaseConfig();
  logDatabaseTarget('Comprobacion de TLS y zona horaria', config);
  const production = isProductionEnvironment();
  const tlsState = {
    habilitado: Boolean(config.ssl),
    caPresente: Boolean(config.ssl?.ca),
    verificaCertificado: config.ssl ? config.ssl.rejectUnauthorized === true : null
  };
  const connection = await createDatabaseConnection(config);
  try {
    const nodeDateBefore = formatLocalDate();
    const [[clock]] = await connection.query(
      `SELECT DATABASE() baseActiva, @@session.time_zone zonaSesion,
              DATE_FORMAT(NOW(),'%Y-%m-%d %H:%i:%s') ahoraSesion,
              DATE_FORMAT(UTC_TIMESTAMP(),'%Y-%m-%d %H:%i:%s') ahoraUtc,
              DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','-04:00'),'%Y-%m-%d %H:%i:%s') ahoraNegocio`
    );
    const nodeDateAfter = formatLocalDate();
    const [columns] = await connection.query(
      `SELECT TABLE_NAME tabla, COLUMN_NAME columna, COLUMN_DEFAULT valorDefault, EXTRA extra
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA=DATABASE() AND DATA_TYPE IN ('date','datetime','timestamp')
         AND (UPPER(COALESCE(COLUMN_DEFAULT,'')) LIKE '%CURRENT_TIMESTAMP%'
              OR UPPER(COALESCE(EXTRA,'')) LIKE '%ON UPDATE CURRENT_TIMESTAMP%')
       ORDER BY TABLE_NAME, ORDINAL_POSITION`
    );
    const findings = activeTimeFindings();
    const sourceOptions = source('config/database-options.js');
    const insecureTlsLiteral = /rejectUnauthorized\s*:\s*false/.test(sourceOptions);
    const configurationValid = (!production || (tlsState.habilitado && tlsState.caPresente && tlsState.verificaCertificado))
      && !insecureTlsLiteral;
    const timeValid = clock.zonaSesion === MYSQL_SESSION_TIME_ZONE
      && clock.ahoraSesion === clock.ahoraNegocio
      && [nodeDateBefore, nodeDateAfter].includes(clock.ahoraNegocio.slice(0, 10))
      && findings.length === 0;
    const result = {
      entorno: process.env.APP_ENV || 'no_definido',
      base: clock.baseActiva,
      destino: databaseTarget(config),
      zonaNegocio: BUSINESS_TIME_ZONE,
      mysql: {
        timezoneCliente: config.timezone,
        dateStrings: config.dateStrings,
        zonaSesion: clock.zonaSesion,
        ahoraLocal: clock.ahoraSesion,
        ahoraUtc: clock.ahoraUtc,
        diferenciaUtcHoras: (Date.parse(`${clock.ahoraUtc.replace(' ', 'T')}Z`)
          - Date.parse(`${clock.ahoraNegocio.replace(' ', 'T')}Z`)) / 3600000
      },
      tls: tlsState,
      configuracionValida: configurationValid,
      tiempoValido: timeValid,
      usosActivosInseguros: findings,
      defaultsSqlHeredados: columns,
      defaultsSqlHeredadosTotal: columns.length,
      notaDefaults: 'Son compatibilidad heredada. Las escrituras activas deben enviar fechas locales explicitas.',
      datosValidos: configurationValid && timeValid
    };
    console.log(JSON.stringify(result, null, 2));
    if (!result.datosValidos) process.exitCode = 1;
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('No se pudo comprobar TLS y zona horaria.');
  console.error(error.message);
  process.exit(1);
});
