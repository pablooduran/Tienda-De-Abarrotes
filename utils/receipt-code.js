function compactSaleReceiptCode(code) {
  const value = String(code || '').trim();
  const legacy = /^V-\d+-(\d+)$/i.exec(value);
  if (!legacy) return value;
  return `V-${String(Number(legacy[1])).padStart(4, '0')}`;
}

function compactCollectionReceiptCode(idCobroFiado) {
  return `COB-${String(Number(idCobroFiado)).padStart(4, '0')}`;
}

module.exports = { compactCollectionReceiptCode, compactSaleReceiptCode };
