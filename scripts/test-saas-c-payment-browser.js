const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const PUBLIC = path.join(__dirname, '..', 'public');
const reference = 'payment-browser-reference-000000000001';
const observedReference = 'payment-browser-observed-00000000002';

function edge() {
  return [process.env.BROWSER_EXECUTABLE_PATH, 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((candidate) => candidate && fs.existsSync(candidate));
}
function json(response, status, body) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)); }
function readBody(request) { return new Promise((resolve) => { let body = ''; request.on('data', (chunk) => { body += chunk; }); request.on('end', () => resolve(body)); }); }
function ownerSubscription() { return { estado: 'activa', estadoEfectivo: 'activa', tipo: 'pagada', periodo: { tipo: 'mensual' }, fechaInicio: '2026-08-01 00:00:00', fechaFin: '2026-09-01 00:00:00', plan: { codigo: 'basico', nombre: 'Basic' }, acceso: { nivel: 'completo', mensaje: 'Acceso completo.' }, limites: {}, uso: {}, funcionalidades: [] }; }
function plans() { return { planActual: { codigo: 'basico', nombre: 'Basic' }, planes: [{ referencia: 'basico', nombre: 'Basic', descripcion: 'Plan familiar.', operacionesDisponibles: ['renovacion'], periodos: [{ periodo: 'mensual', monto: '3.00', meses: 1 }] }, { referencia: 'standard', nombre: 'Standard', descripcion: 'Más capacidad.', operacionesDisponibles: ['upgrade'], periodos: [{ periodo: 'mensual', monto: '6.00', meses: 1 }, { periodo: 'trimestral', monto: '16.50', meses: 3 }, { periodo: 'anual', monto: '60.00', meses: 12 }] }, { referencia: 'pro', nombre: 'Pro', descripcion: 'Capacidad completa.', operacionesDisponibles: ['upgrade'], periodos: [{ periodo: 'mensual', monto: '10.00', meses: 1 }] }] }; }
function summary(ref, state = 'pendiente_comprobante') { return { referencia: ref, operacion: 'renovacion', plan: { codigo: 'basico', nombre: 'Basic' }, periodo: 'mensual', precioBaseUSD: '3.00', montoBOB: '21.00', estado: state, creadaEn: '2026-08-12 08:00:00', venceEn: '2026-08-15 08:00:00', siguienteAccion: state === 'observada' ? 'corregir_comprobante' : 'cargar_comprobante' }; }
function detail(ref, state, withReceipt = false) { return { referencia: ref, planActual: { codigo: 'basico', nombre: 'Basic' }, planObjetivo: { codigo: 'basico', nombre: 'Basic' }, operacion: 'renovacion', periodo: 'mensual', meses: 1, precioBase: { moneda: 'USD', monto: '3.00' }, conversion: { valor: '7.00000000', fuente: 'Tasa de prueba', fechaEfectiva: '2026-08-12 08:00:00' }, montoCobro: { moneda: 'BOB', monto: '21.00' }, metodo: { codigo: 'qr_manual', nombre: 'QR manual', instrucciones: 'Usa el QR configurado y sube el comprobante.' }, limites: {}, funcionalidades: [], estado: state, creadaEn: '2026-08-12 08:00:00', venceEn: '2026-08-15 08:00:00', historial: [{ evento: state === 'observada' ? 'observada' : 'creada', fecha: '2026-08-12 08:00:00' }], siguienteAccion: 'cargar_comprobante', comprobante: withReceipt ? { referencia: 'receipt-browser-safe-reference-01', activo: true } : null }; }

function serverFixture() {
  const state = { created: false, uploaded: false, cancelCount: 0, mutations: [], rate: null, review: 'pendiente_revision', reviewQueries: [] };
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/suscripcion.html' || url.pathname === '/') { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return response.end(fs.readFileSync(path.join(PUBLIC, 'subscription.html'))); }
    if (url.pathname === '/admin.html') {
      const html = fs.readFileSync(path.join(PUBLIC, 'admin.html'), 'utf8')
        .replace('<script src="/js/administrative-audit-ui.js" defer></script>', '')
        .replace('<script src="/js/admin.js" defer></script>', '')
        .replace('<script src="/js/saas-subscription-admin-ui.js" defer></script>', '')
        .replace('<header class="page-header">', '<header class="page-header" hidden>')
        .replace('<section id="suscripciones-saas"', '<section id="suscripciones-saas" hidden')
        .replace('<section class="content-section" aria-labelledby="storesHeading">', '<section class="content-section" aria-labelledby="storesHeading" hidden>')
        .replace('<section id="catalogo"', '<section id="catalogo" hidden')
        .replace('<section id="auditoria"', '<section id="auditoria" hidden');
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return response.end(html);
    }
    if (url.pathname.startsWith('/js/') || url.pathname.startsWith('/css/')) { const file = path.join(PUBLIC, url.pathname.slice(1)); response.writeHead(200, { 'Content-Type': url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript' }); return fs.createReadStream(file).pipe(response); }
    if (url.pathname === '/api/suscripcion') return json(response, 200, ownerSubscription());
    if (url.pathname === '/api/suscripcion/planes') return json(response, 200, { planes: [] });
    if (url.pathname === '/api/pagos-suscripcion/planes') return json(response, 200, plans());
    if (url.pathname === '/api/pagos-suscripcion/metodos') return json(response, 200, { disponibles: true, metodos: [{ referencia: 'qr_manual', nombre: 'QR manual', requiereComprobante: true, instrucciones: 'Instrucciones seguras.' }] });
    if (url.pathname === '/api/pagos-suscripcion/cotizar' && request.method === 'POST') return json(response, 200, { precioBase: { moneda: 'USD', monto: '3.00' }, montoCobro: { moneda: 'BOB', monto: '21.00' }, vigenteHasta: '2026-08-15 08:00:00', efectoEsperado: { tipo: 'renovacion' } });
    if (url.pathname === '/api/pagos-suscripcion/solicitudes' && request.method === 'GET') return json(response, 200, { resultados: [summary(observedReference, 'observada'), ...(state.created ? [summary(reference, state.uploaded ? 'pendiente_revision' : 'pendiente_comprobante')] : [])], paginacion: { paginas: 1 } });
    if (url.pathname === '/api/pagos-suscripcion/solicitudes' && request.method === 'POST') { state.created = true; state.mutations.push({ kind: 'create', key: request.headers['idempotency-key'], body: await readBody(request) }); return json(response, 201, { ...summary(reference), created: true }); }
    if (url.pathname === `/api/pagos-suscripcion/solicitudes/${reference}`) return json(response, 200, detail(reference, state.uploaded ? 'pendiente_revision' : 'pendiente_comprobante', state.uploaded));
    if (url.pathname === `/api/pagos-suscripcion/solicitudes/${observedReference}`) return json(response, 200, detail(observedReference, 'observada', true));
    if (/^\/api\/pagos-suscripcion\/solicitudes\/[A-Za-z0-9_-]+\/comprobantes$/.test(url.pathname) && request.method === 'GET') {
      const isObserved = url.pathname.includes(observedReference);
      return json(response, 200, { comprobantes: state.uploaded || isObserved ? [{ referencia: 'receipt-browser-safe-reference-01', activo: true }] : [] });
    }
    if (/^\/api\/pagos-suscripcion\/solicitudes\/[A-Za-z0-9_-]+\/comprobantes$/.test(url.pathname) && request.method === 'POST') { state.uploaded = true; state.mutations.push({ kind: 'upload', key: request.headers['idempotency-key'] }); await readBody(request); return json(response, 201, { comprobante: { replayed: false } }); }
    if (/^\/api\/pagos-suscripcion\/solicitudes\/[A-Za-z0-9_-]+\/cancelar$/.test(url.pathname)) { state.cancelCount += 1; state.mutations.push({ kind: 'cancel', key: request.headers['idempotency-key'] }); return json(response, 200, summary(reference, 'cancelada')); }
    if (url.pathname === '/api/admin/pagos-suscripcion/tipos-cambio' && request.method === 'GET') return json(response, 200, { vigente: state.rate, historial: state.rate ? [state.rate] : [], paginacion: { paginas: 1 } });
    if (url.pathname === '/api/admin/pagos-suscripcion/tipos-cambio' && request.method === 'POST') { state.rate = { valor: '7.00000000', fuente: 'Fuente browser', vigenteDesde: '2026-08-12 08:00:00' }; state.mutations.push({ kind: 'rate', key: request.headers['idempotency-key'] }); return json(response, 201, state.rate); }
    if (url.pathname === '/api/admin/pagos-suscripcion/metodos' && request.method === 'GET') return json(response, 200, { metodos: [{ referencia: 'qr_manual', nombre: 'QR manual', activo: true, visiblePropietario: true, instrucciones: 'Instrucciones.', requiereComprobante: true, soloAdministracion: false }, { referencia: 'efectivo_administrativo', nombre: 'Efectivo administrativo', activo: true, visiblePropietario: false, instrucciones: 'Solo interno.', requiereComprobante: false, soloAdministracion: true }] });
    if (/^\/api\/admin\/pagos-suscripcion\/metodos\//.test(url.pathname) && request.method === 'PATCH') { state.mutations.push({ kind: 'method', key: request.headers['idempotency-key'] }); return json(response, 200, {}); }
    if (url.pathname === '/api/admin/pagos-suscripcion/revision' && request.method === 'GET') { state.reviewQueries.push(url.searchParams.toString()); return json(response, 200, { resultados: [{ referencia: reference, tienda: 'Tienda Browser', operacion: 'renovacion', plan: { nombre: 'Basic' }, monto: { moneda: 'BOB', valor: '21.00' }, metodo: 'QR manual', estado: state.review, comprobanteDisponible: true }], paginacion: { paginas: 1 } }); }
    if (url.pathname === `/api/admin/pagos-suscripcion/revision/${reference}` && request.method === 'GET') return json(response, 200, { referencia: reference, tienda: 'Tienda Browser', operacion: 'renovacion', plan: { nombre: 'Basic' }, planActual: { nombre: 'Basic' }, monto: { moneda: 'BOB', valor: '21.00' }, metodo: 'QR manual', estado: state.review, creadaEn: '2026-08-12 08:00:00', venceEn: '2026-08-15 08:00:00', tipoCambio: { valor: '7.00000000', fuente: 'Fuente browser' }, snapshot: { periodo: 'mensual', meses: 1, precioUSD: '3.00', monedaBase: 'USD' }, comprobante: { nombre: 'comprobante.pdf' }, historial: [], revisiones: [] });
    if (new RegExp(`^/api/admin/pagos-suscripcion/revision/${reference}/(observada|rechazada|aplicar)$`).test(url.pathname)) { const action = url.pathname.split('/').at(-1); state.review = action === 'aplicar' ? 'aplicada' : action; state.mutations.push({ kind: action, key: request.headers['idempotency-key'] }); return json(response, 200, { estado: state.review }); }
    if (url.pathname === '/favicon.ico') { response.writeHead(204); return response.end(); }
    return json(response, 404, { error: 'No encontrado.' });
  });
  return { server, state };
}

async function assertViewport(browser, baseUrl, url, selector, fixtureState) {
  for (const viewport of [{ width: 360, height: 800 }, { width: 768, height: 1024 }, { width: 1366, height: 768 }]) {
    const page = await browser.newPage({ viewport }); const errors = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); }); page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${baseUrl}${url}`); await page.locator(selector).waitFor();
    const overflow = await page.evaluate(() => ({
      active: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      width: [document.documentElement.clientWidth, document.documentElement.scrollWidth],
      elements: Array.from(document.querySelectorAll('body *')).filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 5).map((element) => `${element.tagName}.${element.className}`)
    }));
    assert.strictEqual(overflow.active, false, `Overflow ${viewport.width}: ${JSON.stringify(overflow)}`);
    await page.keyboard.press('Tab'); assert.notStrictEqual(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'none');
    if (url === '/suscripcion.html') {
      const detailButton = page.locator('[data-request-detail]').first();
      await detailButton.evaluate((node) => node.addEventListener('click', () => {
        window.__scrollAtOwnerDetailClick = window.scrollY;
      }, { capture: true, once: true }));
      await detailButton.click();
      await page.locator('[data-payment-detail][open]').waitFor();
      assert.strictEqual(await page.locator('[data-payment-detail]').evaluate((node) => node.matches(':modal')), true);
      assert.strictEqual(await page.evaluate(() => window.scrollY), await page.evaluate(() => window.__scrollAtOwnerDetailClick),
        'El detalle del propietario no debe desplazar la pagina.');
      assert.strictEqual(await page.evaluate(() => document.activeElement.hasAttribute('data-close-request')), true);
      assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true);
      await page.keyboard.press('Escape');
      await page.locator('[data-payment-detail][open]').waitFor({ state: 'detached' });
      await page.waitForFunction(() => document.activeElement === document.querySelector('[data-request-detail]'));
      await detailButton.click();
      await page.locator('[data-close-request]').click();
      assert.strictEqual(await page.locator('[data-payment-detail]').evaluate((node) => node.open), false);
    }
    if (url === '/admin.html#pagos-suscripcion') {
      const filterButton = page.locator('#openPaymentReviewFilters');
      const queriesBeforeCancel = fixtureState.reviewQueries.length;
      await filterButton.click();
      await page.locator('#paymentReviewFilterDialog[open]').waitFor();
      assert.strictEqual(await page.locator('#paymentReviewFilterDialog').evaluate((node) => node.matches(':modal')), true);
      await page.locator('#paymentReviewFilters select[name="estado"]').selectOption('observada');
      await page.keyboard.press('Escape');
      await page.locator('#paymentReviewFilterDialog[open]').waitFor({ state: 'detached' });
      await page.waitForFunction(() => document.querySelector('#paymentReviewFilters select[name="estado"]').value === '');
      assert.strictEqual(fixtureState.reviewQueries.length, queriesBeforeCancel, 'Cerrar no debe aplicar filtros.');
      assert.strictEqual(await page.locator('#paymentReviewFilters select[name="estado"]').inputValue(), '');
      assert.strictEqual(await filterButton.evaluate((node) => document.activeElement === node), true);
      await filterButton.click();
      await page.locator('#paymentReviewFilters select[name="estado"]').selectOption('observada');
      await page.locator('#paymentReviewFilters select[name="orden"]').selectOption('antiguas');
      await page.locator('#paymentReviewFilters button[type="submit"]').click();
      await page.locator('#paymentReviewFilterDialog[open]').waitFor({ state: 'detached' });
      assert.strictEqual(await filterButton.textContent(), 'Filtros (2)');
      assert.strictEqual(await filterButton.evaluate((node) => document.activeElement === node), true);
      assert.strictEqual(new URLSearchParams(fixtureState.reviewQueries.at(-1)).get('estado'), 'observada');
      assert.strictEqual(new URLSearchParams(fixtureState.reviewQueries.at(-1)).get('orden'), 'antiguas');
      assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true);
      const detailButton = page.locator('#paymentReviewTableBody .table-action');
      await detailButton.evaluate((node) => node.addEventListener('click', () => {
        window.__scrollAtPaymentClick = document.querySelector('.admin-main').scrollTop;
      }, { capture: true, once: true }));
      await detailButton.click();
      await page.locator('#paymentReviewDetail[open]').waitFor();
      assert.strictEqual(await page.locator('#paymentReviewDetail').evaluate((node) => node.matches(':modal')), true);
      assert.strictEqual(await page.locator('.admin-main').evaluate((node) => node.scrollTop),
        await page.evaluate(() => window.__scrollAtPaymentClick), 'Ver detalle no debe desplazar la lista.');
      assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'closePaymentReviewDetail');
      assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true);
      await page.keyboard.press('Escape');
      await page.locator('#paymentReviewDetail[open]').waitFor({ state: 'detached' });
      assert.strictEqual(await detailButton.evaluate((node) => document.activeElement === node), true);
      await detailButton.click();
      await page.locator('#closePaymentReviewDetail').click();
      assert.strictEqual(await page.locator('#paymentReviewDetail').evaluate((node) => node.open), false);
    }
    assert.deepStrictEqual(errors, []); await page.close();
  }
}

async function main() {
  const executablePath = edge(); if (!executablePath) throw new Error('No se encontró Edge local.');
  const fixture = serverFixture(); await new Promise((resolve) => fixture.server.listen(0, '127.0.0.1', resolve)); const baseUrl = `http://127.0.0.1:${fixture.server.address().port}`; const browser = await chromium.launch({ executablePath, headless: true });
  try {
    await assertViewport(browser, baseUrl, '/suscripcion.html', '[data-payment-form]', fixture.state); await assertViewport(browser, baseUrl, '/admin.html#pagos-suscripcion', '#paymentReviewTableBody tr', fixture.state);
    const failingFilters = await browser.newPage();
    await failingFilters.goto(`${baseUrl}/admin.html#pagos-suscripcion`);
    await failingFilters.locator('#paymentReviewTableBody tr').waitFor();
    await failingFilters.route('**/api/admin/pagos-suscripcion/revision?*', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Servicio temporalmente no disponible.' }) }));
    await failingFilters.locator('#openPaymentReviewFilters').click();
    await failingFilters.locator('#paymentReviewFilters select[name="estado"]').selectOption('observada');
    await failingFilters.locator('#paymentReviewFilters button[type="submit"]').click();
    await failingFilters.locator('#paymentReviewFilterError:not([hidden])').waitFor();
    assert.strictEqual(await failingFilters.locator('#paymentReviewFilterDialog').evaluate((node) => node.open), true);
    assert.strictEqual(await failingFilters.locator('#paymentReviewTableBody tr').count(), 1, 'La lista anterior debe conservarse si falla la carga.');
    await failingFilters.locator('#closePaymentReviewFilters').click();
    await failingFilters.waitForFunction(() => document.querySelector('#paymentReviewFilters select[name="estado"]').value === '');
    await failingFilters.close();
    const owner = await browser.newPage({ viewport: { width: 1366, height: 768 } }); await owner.goto(`${baseUrl}/suscripcion.html`); await owner.locator('[data-payment-form]').waitFor(); await owner.getByRole('button', { name: 'Cotizar' }).click(); await owner.locator('.payment-quote').waitFor(); await owner.getByRole('button', { name: 'Crear solicitud' }).click(); await owner.locator('[data-receipt-form]').waitFor(); await owner.locator('[data-receipt-form] input').setInputFiles({ name: 'comprobante.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') }); await owner.getByRole('button', { name: 'Enviar comprobante' }).click(); await owner.locator('[data-payment-detail] .payment-state[data-state="pendiente_revision"]').waitFor(); assert.strictEqual(await owner.locator('[data-payment-detail]').evaluate((node) => node.open), true); await owner.getByRole('button', { name: 'Cerrar detalle' }).click(); await owner.waitForFunction(() => document.activeElement?.dataset.requestDetail === 'payment-browser-reference-000000000001'); await owner.getByRole('button', { name: 'Ver detalle' }).first().click(); await owner.getByRole('button', { name: 'Reemplazar archivo' }).waitFor(); assert(!await owner.content().then((html) => /idTienda|idSuscripcion/.test(html))); await owner.close();
    const admin = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await admin.goto(`${baseUrl}/admin.html#pagos-suscripcion`);
    await admin.locator('#paymentReviewTableBody tr').waitFor();
    await admin.locator('#paymentRateForm input[name="valor"]').fill('7.00000000');
    await admin.locator('#paymentRateForm input[name="fuente"]').fill('Fuente browser');
    await admin.getByRole('button', { name: 'Registrar tasa' }).click();
    await admin.getByRole('button', { name: 'Guardar método' }).first().click();
    await admin.getByRole('button', { name: 'Ver detalle' }).click();
    await admin.locator('#paymentReviewDetail[open]').waitFor();
    await admin.getByRole('button', { name: 'Solicitar corrección' }).click();
    await admin.locator('textarea[name="observacion"]').fill('Corrige el archivo adjunto.');
    await admin.getByRole('button', { name: 'Confirmar' }).click();
    assert(fixture.state.mutations.some((item) => item.kind === 'observada'));
    await admin.locator('#paymentReviewActionDialog[open]').waitFor({ state: 'detached' });
    assert.strictEqual(await admin.locator('#paymentReviewDetail').evaluate((node) => node.open), true);
    await admin.locator('#closePaymentReviewDetail').click();
    await admin.waitForFunction(() => document.activeElement === document.querySelector('#paymentReviewTableBody .table-action'));
    assert.strictEqual(await admin.locator('#paymentReviewTableBody .table-action').evaluate((node) => document.activeElement === node), true);
    await admin.close();
    assert(fixture.state.mutations.every((item) => item.key === undefined || /:[0-9a-f-]{36}$/.test(item.key))); assert(!JSON.stringify(fixture.state.mutations).includes('idTienda')); console.log('test:saas-c-payment-browser OK');
  } finally { await browser.close(); await new Promise((resolve) => fixture.server.close(resolve)); }
}
main().catch((error) => { console.error(`test:saas-c-payment-browser FAIL: ${error.message}`); process.exitCode = 1; });
