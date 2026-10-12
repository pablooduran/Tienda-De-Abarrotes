function compactSaleReceiptCode(code) {
  const value = String(code || '').trim();
  const legacy = /^V-\d+-(\d+)$/i.exec(value);
  if (!legacy) return value;
  return `V-${String(Number(legacy[1])).padStart(4, '0')}`;
}

function compactCollectionReceiptCode(idCobroFiado) {
  return `COB-${String(Number(idCobroFiado)).padStart(4, '0')}`;
}

const SALE_CHANNEL_PREFIXES = Object.freeze({
  tienda: 'T',
  online: 'O'
});

async function nextSaleReceiptCode(connection, idTienda, channel) {
  const prefix = SALE_CHANNEL_PREFIXES[channel];
  if (!prefix) throw new Error('El canal del comprobante no es valido.');
  const [rows] = await connection.query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(codigoComprobante,3) AS UNSIGNED)),0) ultimo
     FROM venta
     WHERE idTienda=? AND canalVenta=? AND codigoComprobante LIKE ?`,
    [idTienda, channel, `${prefix}-%`]
  );
  const next = Number(rows[0]?.ultimo || 0) + 1;
  return `${prefix}-${String(next).padStart(3, '0')}`;
}

module.exports = {
  SALE_CHANNEL_PREFIXES,
  compactCollectionReceiptCode,
  compactSaleReceiptCode,
  nextSaleReceiptCode
};
