const CHURN_REASONS = Object.freeze([
  'demasiado_caro', 'dificil_de_usar', 'falta_funcion', 'problemas_tecnicos',
  'uso_otra_solucion', 'negocio_cerrado', 'ya_no_lo_necesito', 'otro'
]);

function validateChurnInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('CHURN_PAYLOAD_INVALID');
  const keys = Object.keys(input);
  if (keys.some((key) => !['reason', 'comment'].includes(key))) throw new Error('CHURN_PAYLOAD_INVALID');
  const reason = String(input.reason || '').trim();
  if (!CHURN_REASONS.includes(reason)) throw new Error('CHURN_REASON_INVALID');
  const comment = input.comment === undefined ? null : String(input.comment).trim();
  if (comment !== null && (comment.length > 300 || /[<>]/.test(comment))) throw new Error('CHURN_COMMENT_INVALID');
  return { reason, comment: comment || null };
}

module.exports = { CHURN_REASONS, validateChurnInput };
