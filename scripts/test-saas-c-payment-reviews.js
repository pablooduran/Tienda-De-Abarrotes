const assert = require('assert');
const { REVIEW_MOTIVES, reviewBody, reviewQuery } = require('../config/saas-c-payment-review-contract');
const body = reviewBody({ motivo: REVIEW_MOTIVES[0], observacion: 'El comprobante no permite leer el monto.' });
assert.strictEqual(body.motivo, 'comprobante_ilegible');
assert.strictEqual(reviewQuery({ estado: 'pendiente_revision', orden: 'recientes', pagina: '1', limite: '20' }).limite, 20);
assert.throws(() => reviewBody({ motivo: 'comprobante_ilegible', observacion: 'ok', extra: true }));
assert.throws(() => reviewQuery({ orden: 'idInterno' }));
console.log('SAAS-C4 review contract checks: PASS');
