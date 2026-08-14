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

async function main() {
  const server = http.createServer((request, response) => {
    if (request.url === '/styles.css') {
      response.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
      fs.createReadStream(stylesheet).pipe(response);
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><main class="content"><section id="view"><h1>Productos</h1><p aria-live="polite">Sin cambios pendientes.</p><a href="#detalle">Ver detalle</a><details><summary>Mas opciones</summary><button type="button">Ocultar producto</button></details><form><label>Nombre<input required></label><label>Categoria<select><option>Almacen</option></select></label><button type="submit">Guardar cambios</button></form><div class="table-wrap"><table><thead><tr><th>Producto</th><th>Acciones</th></tr></thead><tbody><tr><td>Arroz familiar</td><td><button type="button">Editar</button></td></tr></tbody></table></div></section><div class="modal-backdrop"><form class="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><h2 id="dialog-title">Configurar producto</h2><label>Reposicion<input type="number"></label><div class="modal-actions"><button type="button">Cancelar</button><button type="submit">Guardar cambios</button></div></form></div></main></body></html>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: executable(), headless: true });
  try {
    for (const viewport of [{ width: 360, height: 800 }, { width: 768, height: 1024 }, { width: 1366, height: 768 }]) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('pageerror', (error) => errors.push(error.message));
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.getByText('Mas opciones').focus();
      await page.keyboard.press('Enter');
      assert.strictEqual(await page.locator('details').evaluate((element) => element.open), true);
      assert.strictEqual(await page.locator('[role="dialog"]').count(), 1);
      assert.strictEqual(await page.locator('input').evaluateAll((inputs) => inputs.every((input) => input.labels?.length > 0)), true);
      assert.strictEqual(await page.locator('button').evaluateAll((buttons) => buttons.every((button) => Boolean(button.textContent.trim() || button.getAttribute('aria-label')))), true);
      assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      assert.strictEqual(await page.locator('.modal').evaluate((element) => parseFloat(getComputedStyle(element).animationDuration) <= 0.01), true);
      assert.deepStrictEqual(errors, []);
      await page.close();
    }
    const zoomPage = await browser.newPage({ viewport: { width: 360, height: 800 } });
    await zoomPage.goto(`http://127.0.0.1:${server.address().port}/`);
    await zoomPage.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    assert.strictEqual(await zoomPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.strictEqual(await zoomPage.locator('[role="dialog"]').evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.left >= 0 && bounds.right <= window.innerWidth;
    }), true);
    await zoomPage.close();
    console.log('test:product-responsive-accessibility-browser OK');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`test:product-responsive-accessibility-browser FAIL: ${error.message}`);
  process.exitCode = 1;
});
