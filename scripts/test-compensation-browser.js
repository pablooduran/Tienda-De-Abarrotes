const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function edgeExecutable() {
  const candidates = [
    process.env.BROWSER_EXECUTABLE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  ].filter(Boolean);
  const executable = candidates.find((candidate) => fs.existsSync(candidate));
  if (!executable) throw new Error('No se encontro Edge o Chrome para la prueba C4B.');
  return executable;
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(JSON.stringify(body));
}

function harness() {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <link rel="stylesheet" href="/css/styles.css"><title>Prueba C4B</title></head>
    <body style="overflow:auto"><main class="content" style="height:auto">
      <div id="message" class="message" aria-live="polite"></div>
      <section id="view" aria-live="polite"></section></main><div id="modalRoot"></div>
      <script src="/js/compensation-ui.js"></script><script>
      (() => {
        const params = new URLSearchParams(location.search);
        const plan = params.get('plan') || 'advanced';
        const featureSets = {
          advanced: ['anulaciones_operativas','exportacion_reportes'],
          basic: ['anulaciones_operativas'],
          denied: []
        };
        const state = { context: { soloLectura: params.get('readonly') === '1',
          caracteristicas: featureSets[plan] || [] } };
        const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g,
          (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
        const api = async (url, options={}) => {
          const response = await fetch(url, { ...options, headers: {
            'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest',
            'X-Test-Origin':'browser', ...(options.headers || {}) } });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            const error = new Error(data.error || 'Error controlado.');
            error.code = data.code;
            throw error;
          }
          return data;
        };
        const show = (text) => { document.getElementById('message').textContent = text; };
        window.__printCalls = 0;
        window.print = () => { window.__printCalls += 1; };
        document.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') document.querySelector('[data-modal-cancel]')?.click();
        });
        window.__state = state;
        if (!state.context.caracteristicas.includes('anulaciones_operativas')) {
          document.getElementById('view').innerHTML =
            '<div class="error-state" role="alert">No tienes acceso a compensaciones.</div>';
          return;
        }
        window.__compensation = window.CompensationUI.create({
          api, view: document.getElementById('view'), modalRoot: document.getElementById('modalRoot'),
          getState: () => state,
          hasFeature: (code) => state.context.caracteristicas.includes(code),
          escapeHtml, money: (value) => Number(value || 0).toFixed(2),
          formatDate: (value) => String(value || ''),
          showError: async (text) => show(text),
          showSuccess: async (text) => show(text),
          showMessage: show,
          newOperationKey: () => crypto.randomUUID(),
          secureFetch: fetch,
          errorFromResponse: (_response, body, fallback) => {
            const error = new Error(body.error || fallback);
            error.code = body.code;
            return error;
          }
        });
        window.__compensation.render();
      })();
      </script></body></html>`;
}

function fixtures() {
  return {
    operation: {
      idOperacionCompensatoria: 9,
      tipoOperacion: 'devolucion_venta',
      estado: 'aplicada',
      motivoCodigo: 'devolucion_cliente',
      observacion: '<img src=x onerror="window.__xss=1">',
      fechaSolicitud: '2026-07-26 10:00:00',
      administrador: '<script>window.__xss=1</script>',
      idVenta: 31,
      codigoVenta: 'V-000031',
      cliente: '<b>Cliente seguro</b>',
      idCompensacionVenta: 8,
      montoCompensado: 12.5,
      tipoComprobante: 'venta',
      idComprobante: 8
    },
    sale: {
      venta: {
        idVenta: 31, codigoComprobante: 'V-000031', fecha: '2026-07-26 09:00:00',
        subtotal: 30, descuento: 0, total: 30, montoPagado: 20,
        montoCompensado: 0, saldoPendiente: 10, estadoPago: 'parcial',
        estadoOperacion: 'vigente', cliente: 'Cliente temporal'
      },
      detalles: [{
        idDetalleVenta: 71, idProducto: 4, producto: 'Producto <seguro>',
        unidadesVendidas: 3, unidadesDevueltas: 0, cantidad: 3,
        presentacionVenta: 'unidad', precioVenta: 10, subtotal: 30,
        montoNetoLinea: '30.00', montoCompensableMaximo: '30.00', controlaLotes: 1
      }],
      pagos: [{
        idPagoVenta: 91, metodoPago: 'efectivo', monto: 20,
        montoRecibido: 20, cambio: 0, referencia: null, creadoEn: '2026-07-26 09:00:00'
      }],
      cobros: [{
        idCobroFiado: 101, fechaCobro: '2026-07-26 09:30:00',
        montoTotal: 5, metodoPago: 'qr', estadoOperacion: 'vigente'
      }]
    }
  };
}

async function createServer(runtime) {
  const data = fixtures();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/harness') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(harness());
    }
    if (url.pathname === '/favicon.ico') {
      res.writeHead(204);
      return res.end();
    }
    if (url.pathname === '/css/styles.css' || url.pathname === '/js/compensation-ui.js') {
      const file = path.join(publicDir, url.pathname.replace(/^\//, ''));
      res.writeHead(200, { 'Content-Type': url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript' });
      return res.end(fs.readFileSync(file));
    }
    if (url.pathname === '/api/compensaciones/opciones') {
      return json(res, 200, {
        tipos: ['anulacion_venta', 'devolucion_venta', 'correccion_pago_venta', 'anulacion_cobro_fiado'],
        estados: ['solicitada', 'aplicada', 'rechazada', 'fallida'],
        motivos: [], administradores: []
      });
    }
    if (url.pathname === '/api/compensaciones') {
      return json(res, 200, {
        resumen: { total: 1, compensacionComercial: 12.5, liquidacionesMateriales: 0, aplicadas: 1, pendientes: 0 },
        resultados: [data.operation],
        paginacion: { page: 1, pageSize: 25, total: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false }
      });
    }
    if (url.pathname === '/api/compensaciones/9') return json(res, 200, data.operation);
    if (url.pathname === '/api/compensaciones/ventas/31/contexto') return json(res, 200, data.sale);
    if (url.pathname === '/api/compensaciones/pendientes') {
      return json(res, 200, {
        liquidaciones: [{
          idLiquidacionCompensacionVenta: 5, idVenta: 31, codigoComprobante: 'V-000031',
          cliente: 'Cliente temporal', montoReduccionDeudaPendiente: 10,
          montoReembolsoPendiente: 2.5
        }],
        reembolsos: [{
          idObligacionReembolsoVenta: 6, idVenta: 31, codigoComprobante: 'V-000031',
          cliente: 'Cliente temporal', monto: 2.5, montoLiquidado: 0, montoPendiente: 2.5
        }]
      });
    }
    if (url.pathname === '/api/compensaciones/ventas/8/comprobante') {
      return json(res, 200, {
        comprobante: {
          numero: 'COMP-VTA-00000008', tipo: 'devolucion_parcial',
          operacionOriginal: 'V-000031', fecha: '2026-07-26 10:00:00',
          monto: 12.5, motivo: 'devolucion_cliente', estadoVenta: 'devuelta_parcial',
          observacion: '<script>window.__xss=2</script>',
          tratamientoFinanciero: { reduccionDeuda: 10, reembolsoPendiente: 2.5 }
        },
        tienda: { nombre: 'Tienda <segura>' }, cliente: { nombre: 'Cliente <seguro>' },
        responsable: 'Owner',
        detalles: [{
          producto: '<img src=x onerror="window.__xss=3">', unidadesDevueltas: 1,
          montoCompensado: 12.5, tratamientoInventario: 'reintegrar_vendible'
        }]
      });
    }
    if (/^\/api\/compensaciones\/exportaciones\//.test(url.pathname)) {
      const extension = url.pathname.endsWith('.csv') ? 'csv' : 'xlsx';
      res.writeHead(200, {
        'Content-Type': extension === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="compensaciones-prueba.${extension}"`
      });
      return res.end(extension === 'csv' ? 'Tipo,Monto\r\nDevolucion,12.50\r\n' : Buffer.from('xlsx-test'));
    }
    if (req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      runtime.posts.push({ path: url.pathname, body: JSON.parse(body || '{}') });
      await new Promise((resolve) => setTimeout(resolve, 120));
      return json(res, 201, { message: 'Compensacion aplicada.', repetida: false });
    }
    return json(res, 404, { error: 'Ruta no encontrada.', code: 'NOT_FOUND' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

async function main() {
  const runtime = { posts: [] };
  const server = await createServer(runtime);
  const port = server.address().port;
  const browser = await chromium.launch({ executablePath: edgeExecutable(), headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  try {
    await page.goto(`http://127.0.0.1:${port}/harness?plan=advanced`);
    await page.locator('[data-compensation-tab]').first().waitFor();
    assert(await page.locator('[data-compensation-tab]').count() === 4,
      'No se mostraron las cuatro vistas.');
    assert(await page.locator('[data-compensation-export]').count() === 0,
      'Las exportaciones solo deben aparecer en su pestana.');
    assert(await page.evaluate(() => window.__xss) === undefined,
      'Se ejecuto contenido dinamico del historial.');
    console.log('OK: navegacion e historial seguro.');

    const detailButton = page.locator('[data-operation-detail]').first();
    await detailButton.focus();
    await detailButton.click();
    assert(await page.locator('[role="dialog"]').getAttribute('aria-labelledby') === 'compensationDialogTitle',
      'El dialogo no tiene titulo asociado.');
    await page.keyboard.press('Escape');
    assert(await detailButton.evaluate((node) => document.activeElement === node),
      'El foco no regreso al disparador.');
    console.log('OK: teclado, Escape y retorno de foco.');

    await page.locator('[data-compensation-receipt]').first().click();
    assert((await page.locator('[data-print-compensation]').textContent()).includes('No es una factura fiscal'),
      'El comprobante no aclara su naturaleza.');
    assert((await page.locator('[data-print-compensation]').textContent()).includes('Cliente <seguro>'),
      'El comprobante no muestra el cliente como texto.');
    assert(await page.evaluate(() => window.__xss) === undefined,
      'Se ejecuto contenido dinamico del comprobante.');
    await page.locator('[data-compensation-print]').click();
    assert(await page.evaluate(() => window.__printCalls === 1),
      'La impresion no se activo.');
    await page.locator('[data-modal-cancel]').click();
    console.log('OK: comprobante imprimible y XSS bloqueado.');

    await page.locator('[data-compensation-tab="ventas"]').click();
    await page.locator('[data-sale-search] input').fill('31');
    await page.locator('[data-sale-search]').press('Enter');
    await page.locator('[data-sale-return]').waitFor();
    await page.locator('[data-sale-return]').click();
    await page.locator('[data-return-detail]').check();
    assert((await page.locator('[data-compensation-expected]').textContent()).includes('10.00'),
      'El resumen previo no actualizo el importe seleccionado.');
    await page.locator('select[name="motivoCodigo"]').selectOption('devolucion_cliente');
    await page.locator('input[name="confirmar"]').check();
    const submit = page.locator('[data-compensation-submit]');
    await page.evaluate(() => {
      const button = document.querySelector('[data-compensation-submit]');
      button.click();
      button.click();
    });
    await page.waitForTimeout(250);
    assert(runtime.posts.filter((item) => item.path === '/api/ventas/31/compensaciones').length === 1,
      'El doble clic genero mas de una solicitud.');
    const request = runtime.posts.find((item) => item.path === '/api/ventas/31/compensaciones');
    assert(request.body.claveOperacion && !JSON.stringify(request.body).includes('idTienda'),
      'Falta idempotencia o se envio idTienda.');
    assert(request.body.detalles[0].tratamientoInventario === 'reintegrar_vendible',
      'No se envio el tratamiento de inventario.');
    console.log('OK: devolucion real, resumen, idempotencia y tratamiento de inventario.');

    await page.locator('[data-compensation-tab="pendientes"]').click();
    await page.locator('[data-settle-refund]').click();
    assert((await page.locator('[role="dialog"]').textContent()).includes('credito a favor no esta disponible'),
      'La limitacion de credito a favor no es visible.');
    await page.locator('[data-modal-cancel]').click();
    console.log('OK: liquidaciones pendientes y limitacion explicita.');

    await page.locator('[data-compensation-tab="exportaciones"]').click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-compensation-export="historial:csv"]').click();
    const download = await downloadPromise;
    assert(download.suggestedFilename() === 'compensaciones-prueba.csv',
      'No se preservo el nombre del backend.');
    assert(await page.locator('[data-compensation-export="historial:csv"]').isEnabled(),
      'El boton de descarga quedo bloqueado.');
    console.log('OK: descarga CSV con nombre y bloqueo temporal.');

    for (const viewport of [
      { width: 360, height: 800 },
      { width: 768, height: 1024 },
      { width: 1366, height: 768 }
    ]) {
      await page.setViewportSize(viewport);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert(overflow <= 2, `Overflow global en ${viewport.width}x${viewport.height}: ${overflow}px.`);
    }
    console.log('OK: responsive 360x800, 768x1024 y 1366x768.');

    const basic = await context.newPage();
    await basic.goto(`http://127.0.0.1:${port}/harness?plan=basic`);
    await basic.locator('[data-compensation-tab="exportaciones"]').click();
    assert(await basic.locator('[data-compensation-export]').count() === 0,
      'El plan basico recibio botones de exportacion.');
    assert((await basic.locator('[data-compensation-content]').textContent()).includes('requieren la funcionalidad'),
      'El plan basico no recibio explicacion.');
    await basic.close();

    const denied = await context.newPage();
    await denied.goto(`http://127.0.0.1:${port}/harness?plan=denied`);
    assert(await denied.locator('[data-compensation-tab]').count() === 0,
      'Un usuario sin funcionalidad vio la interfaz.');
    await denied.close();
    console.log('OK: visibilidad por funcionalidad y exportacion por plan.');

    const suspended = await context.newPage();
    await suspended.goto(`http://127.0.0.1:${port}/harness?plan=advanced&readonly=1`);
    await suspended.locator('[data-compensation-tab="exportaciones"]').click();
    assert(await suspended.locator('[data-compensation-export]').count() === 0
      && (await suspended.locator('[data-compensation-content]').textContent()).includes('suscripcion debe estar activa'),
    'La suscripcion suspendida ofrecio una exportacion.');
    await suspended.locator('[data-compensation-tab="ventas"]').click();
    await suspended.locator('[data-sale-search] input').fill('31');
    await suspended.locator('[data-sale-search]').press('Enter');
    assert(await suspended.locator('[data-sale-return]').isDisabled(),
      'La suscripcion suspendida ofrecio una compensacion de escritura.');
    await suspended.close();
    console.log('OK: modo de solo lectura conserva consulta y bloquea escritura/exportacion.');

    const labelsMissing = await page.evaluate(() => [...document.querySelectorAll('input,select,textarea')]
      .filter((control) => !control.closest('label') && !control.getAttribute('aria-label')).length);
    assert(labelsMissing === 0, 'Hay controles sin nombre accesible.');
    assert(consoleErrors.length === 0, `Errores en consola: ${consoleErrors.join(' | ')}`);
    console.log('OK: nombres accesibles y consola limpia.');
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
  console.log('\nPruebas reales de navegador C4B completadas; servidor y navegador cerrados.');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
