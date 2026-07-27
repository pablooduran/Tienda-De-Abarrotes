const INVENTORY_ADJUSTMENT_FEATURE = 'ajuste_stock';
const INVENTORY_RECONCILIATION_FEATURE = 'inventario_resumen';
const INVENTORY_HISTORY_FEATURE = 'historial_stock';

const ADJUSTMENT_TYPES = Object.freeze(['positivo', 'negativo']);
const INVENTORY_CLASSIFICATIONS = Object.freeze([
  'vendible',
  'bloqueado',
  'aislado',
  'tecnico'
]);
const MANUAL_INVENTORY_CLASSIFICATIONS = Object.freeze([
  'vendible',
  'bloqueado',
  'aislado'
]);
const LOT_SELECTION_MODES = Object.freeze([
  'no_aplica',
  'fefo_fifo',
  'lote_explicito',
  'lote_nuevo'
]);
const INVENTORY_ADJUSTMENT_REASONS = Object.freeze([
  'conteo_fisico',
  'merma',
  'danio',
  'vencimiento',
  'correccion_registro',
  'otro_controlado'
]);

const INVENTORY_RECONCILIATION_CODES = Object.freeze([
  'INVENTORY_OK',
  'STOCK_NEGATIVE',
  'LOT_QUANTITY_NEGATIVE',
  'LOT_PHYSICAL_MISMATCH',
  'STOCK_LEDGER_MISMATCH',
  'STOCK_MOVEMENT_REFERENCE_INVALID',
  'LOT_MOVEMENT_ORPHAN',
  'LOT_ASSIGNMENT_DUPLICATED',
  'TECHNICAL_LOT_SELLABLE',
  'UNSELLABLE_STOCK_PRESENT'
]);

module.exports = {
  ADJUSTMENT_TYPES,
  INVENTORY_ADJUSTMENT_FEATURE,
  INVENTORY_ADJUSTMENT_REASONS,
  INVENTORY_CLASSIFICATIONS,
  INVENTORY_HISTORY_FEATURE,
  INVENTORY_RECONCILIATION_CODES,
  INVENTORY_RECONCILIATION_FEATURE,
  LOT_SELECTION_MODES,
  MANUAL_INVENTORY_CLASSIFICATIONS
};
