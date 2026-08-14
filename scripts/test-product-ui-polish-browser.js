const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const stylesheet = path.resolve(__dirname, '..', 'public/css/styles.css');

function executable() {
  return [
    process.env.BROWSER_EXECUTABLE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean).find((file) => fs.existsSync(file));
}

function markup() {
  return `<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><main class="content"><section class="dashboard-hero"><div><span class="eyebrow">Resumen de ventas</span><h1>Resumen de hoy</h1><p>Ventas, cobros, inventario y alertas para decidir qué revisar.</p></div><div class="hero-total"><span>Ventas de hoy</span><strong>Bs 1250000.50</strong></div></section><section class="cards dashboard-cards"><article class="card metric-card"><span>Ventas de ayer</span><strong>Bs 999999.99</strong></article><article class="card metric-card"><span>Fiados activos</span><strong>42</strong></article></section><section class="dashboard-grid modern-dashboard"><article class="panel chart-panel chart-panel-wide"><div class="panel-title"><div><h2>Ventas de los últimos 5 días</h2><p class="muted">Hoy, ayer y los 3 días anteriores.</p></div></div><canvas id="dailyBars" width="600" height="240"></canvas></article><details class="dashboard-period-detail"><summary><span>Ver detalle del período</span><small>Participación de cada día en el total.</small></summary><div class="dashboard-period-detail-body"><canvas id="dailyPie" width="300" height="240"></canvas></div></details><article class="panel chart-panel"><div class="panel-title"><div><h2>Comparativa semanal</h2><p class="muted">Semana actual frente a la anterior.</p></div></div><canvas width="300" height="240"></canvas></article><article class="panel"><h2>Productos recientes</h2><div class="table-wrap"><table><thead><tr><th>Producto</th><th>Ventas</th></tr></thead><tbody><tr><td>Arroz familiar integral de grano largo</td><td>99999</td></tr></tbody></table></div></article></section></main></body></html>`;
}

async function main() {
  const server = http.createServer((request, response) => {
    if (request.url === '/styles.css') return fs.createReadStream(stylesheet).pipe(response);
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(markup());
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: executable(), headless: true });
  try {
    for (const viewport of [{ width: 360, height: 800 }, { width: 768, height: 1024 }, { width: 1366, height: 768 }]) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `overflow inicial en ${viewport.width}`);
      assert.strictEqual(await page.locator('#dailyBars').isVisible(), true, `resumen oculto en ${viewport.width}`);
      assert.strictEqual(await page.locator('#dailyPie').isVisible(), false, `detalle visible sin abrir en ${viewport.width}`);
      const summary = page.locator('.dashboard-period-detail > summary');
      await summary.focus();
      await summary.press('Enter');
      assert.strictEqual(await page.locator('.dashboard-period-detail').evaluate((element) => element.open), true, `detalle no abre con teclado en ${viewport.width}`);
      assert.strictEqual(await page.locator('#dailyPie').isVisible(), true, `canvas secundario no visible al abrir en ${viewport.width}`);
      assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `overflow con detalle abierto en ${viewport.width}`);
      assert.deepStrictEqual(errors, []);
      await page.close();
    }
    console.log('test:product-ui-polish-browser OK');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`test:product-ui-polish-browser FAIL: ${error.message}`);
  process.exitCode = 1;
});
