const { ensureDefaultExpenseCategories } = require('./financial-service');
const { ensureInventoryConfiguration } = require('./inventory-intelligence-service');

async function ensureBaseConfiguration(connection, idTienda, localDateTime) {
  await connection.query(
    `INSERT INTO configuracionTienda
     (idTienda, nombreMostrado, moneda, zonaHoraria, telefono, direccion,
      datoFiscalBasico, creadoEn, actualizadoEn)
     SELECT idTienda, nombre, 'BOB', 'America/La_Paz', NULL, NULL, NULL, ?, ?
     FROM tienda
     WHERE idTienda=?
     ON DUPLICATE KEY UPDATE idTienda=VALUES(idTienda)`,
    [localDateTime, localDateTime, idTienda]
  );
}

async function ensureCreditConfiguration(connection, idTienda, localDateTime) {
  await connection.query(
    `INSERT INTO configuracionCreditoTienda
     (idTienda, limiteCreditoDefault, diasCreditoDefault, diasAvisoVencimiento,
      politicaFiadoVencido, requiereTelefonoParaFiado, permiteFiadoSinFecha,
      codigoPaisWhatsApp, creadoEn, actualizadoEn, idAdministradorActualiza)
     VALUES (?, NULL, 30, 3, 'advertir', 0, 1, NULL, ?, ?, NULL)
     ON DUPLICATE KEY UPDATE idTienda=idTienda`,
    [idTienda, localDateTime, localDateTime]
  );
  const templates = [
    ['recordatorio_previo', 'Recordatorio previo', 'Hola {cliente}, {tienda} le recuerda que su saldo de {saldo} vence el {vencimiento}.'],
    ['deuda_vencida', 'Deuda vencida', 'Hola {cliente}, su saldo pendiente con {tienda} es {saldo} y tiene {dias_atraso} dias de atraso.'],
    ['confirmacion_pago', 'Confirmacion de pago', 'Hola {cliente}, {tienda} confirma la recepcion de su pago. Saldo pendiente: {saldo}.'],
    ['estado_cuenta', 'Estado de cuenta', 'Hola {cliente}, su estado de cuenta en {tienda} muestra un saldo pendiente de {saldo}. Comprobante: {comprobante}.']
  ];
  for (const [type, name, content] of templates) {
    await connection.query(
      `INSERT INTO plantillaCobranzaTienda
       (idTienda,tipo,nombre,contenido,activo,creadoEn,actualizadoEn,idAdministradorActualiza)
       VALUES (?, ?, ?, ?, 1, ?, ?, NULL)
       ON DUPLICATE KEY UPDATE idPlantillaCobranza=idPlantillaCobranza`,
      [idTienda, type, name, content, localDateTime, localDateTime]
    );
  }
}

async function bootstrapStore(connection, idTienda, localDateTime) {
  await ensureBaseConfiguration(connection, idTienda, localDateTime);
  await ensureDefaultExpenseCategories(connection, idTienda, localDateTime);
  await ensureInventoryConfiguration(connection, idTienda, localDateTime);
  await ensureCreditConfiguration(connection, idTienda, localDateTime);
}

module.exports = {
  bootstrapStore,
  ensureBaseConfiguration,
  ensureCreditConfiguration
};
