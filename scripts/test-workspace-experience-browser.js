const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const files = {
  '/styles.css': path.join(root, 'public/css/styles.css'),
  '/workspace.js': path.join(root, 'public/js/workspace-experience.js')
};

function executable() {
  return [
    process.env.BROWSER_EXECUTABLE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean).find((file) => fs.existsSync(file));
}

function markup() {
  return `<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body>
    <div id="storeName">Tienda de prueba</div><header class="topbar"><div><h1>Inicio</h1></div><div id="workspaceTools"></div></header>
    <main class="content"><section id="view"><div class="dashboard-hero"><div><h2>Resumen de hoy</h2></div></div><section data-dashboard-widget="ventas" data-dashboard-label="Ventas"><h3>Ventas</h3></section><form><label>Nombre<input></label><div><button type="submit">Guardar</button></div></form></section></main>
    <div id="workspaceExperienceRoot"></div><script src="/workspace.js"></script><script>
      const appState = { productos: [{ idProducto: 1, nombre: 'PAN', categoria: 'ABARROTES', stockUnidadesTotal: 0, stockMinimo: 2 }], clientes: [{ idCliente: 1, nombre: 'ANA', telefono: '70000000' }], fiados: [{ saldoPendiente: 10 }] };
      window.lastNavigation = '';
      window.experience = WorkspaceExperience.create({ sections: [['inicio', 'Inicio', 'Resumen'], ['ventas', 'Vender', 'Punto de venta'], ['productos', 'Productos', 'Inventario'], ['clientes', 'Clientes', 'Personas'], ['pagos', 'Fiados', 'Cobranza'], ['auditoria', 'Auditoría', 'Actividad'], ['ayuda', 'Ayuda', 'Centro de ayuda']], navigate: (id) => { window.lastNavigation = id; }, getState: () => appState, api: async () => ({ resultados: [{ accion: 'registro_venta', categoria: 'venta', resultado: 'correcto' }] }), escapeHtml: (value) => String(value).replace(/[&<>"']/g, '') });
      experience.init(); experience.afterView('inicio');
    </script></body></html>`;
}

async function main() {
  const server = http.createServer((request, response) => {
    if (files[request.url]) {
      response.writeHead(200, { 'Content-Type': request.url.endsWith('.css') ? 'text/css' : 'text/javascript' });
      fs.createReadStream(files[request.url]).pipe(response);
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(markup());
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: executable(), headless: true });
  try {
    for (const viewport of [{ width: 360, height: 800 }, { width: 768, height: 1024 }, { width: 1366, height: 768 }]) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.locator('[data-workspace-search]').click();
      await page.locator('.workspace-search-field input').fill('PAN');
      assert.strictEqual(await page.locator('.workspace-search-result').count(), 1);
      await page.keyboard.press('Escape');
      assert.strictEqual(await page.locator('.workspace-command').count(), 0);
      await page.locator('[data-workspace-notifications]').click();
      assert.strictEqual(await page.locator('.workspace-notification').count(), 2);
      assert.strictEqual(await page.locator('.workspace-activity-item').count(), 1);
      await page.keyboard.press('Escape');
      await page.locator('[data-customize-dashboard]').click();
      await page.locator('.workspace-widget-list input').uncheck();
      await page.locator('[data-save-dashboard]').click();
      assert.strictEqual(await page.locator('[data-dashboard-widget="ventas"]').isHidden(), true);
      assert.strictEqual(await page.locator('.workspace-sticky-action').count(), 1);
      assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `overflow en ${viewport.width}`);
      assert.deepStrictEqual(errors, []);
      await page.close();
    }
    console.log('test:workspace-experience-browser OK');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`test:workspace-experience-browser FAIL: ${error.message}`);
  process.exitCode = 1;
});
