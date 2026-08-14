const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const stylesheet = path.join(root, 'public/css/styles.css');
const patterns = path.join(root, 'public/js/ui-patterns.js');
const longText = 'Producto familiar de inventario con nombre muy largo y descriptivo para revisar reflow operativo '.repeat(4);
const escapedText = '&lt;script&gt;window.__xss = true&lt;/script&gt; &amp; &quot; &#39; Emoji 🧾';

function executable() {
  return [
    process.env.BROWSER_EXECUTABLE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean).find((file) => fs.existsSync(file));
}

function pageMarkup() {
  const rows = Array.from({ length: 48 }, (_, index) => `<tr><td>${longText} ${index + 1}</td><td>Bs 999999999.99</td><td><details class="row-actions"><summary>Más opciones</summary><button type="button">Ocultar</button></details></td></tr>`).join('');
  return `<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"><script defer src="/ui-patterns.js"></script></head><body><main class="content"><section class="topbar"><h1>Prueba P7D</h1><p id="feedback" class="message" aria-live="polite"></p></section><nav aria-label="Superficies"><button type="button">Inicio</button><button type="button">POS</button><button type="button">Inventario</button><button type="button">Clientes</button><button type="button">Configuración</button><button type="button">Mi plan</button><button type="button">Superadmin</button></nav><section class="panel"><h2>POS e inventario</h2><label>Buscar producto<input id="search" value="${longText}"></label><button id="emptyFilter" type="button">Aplicar filtros</button><p id="empty" hidden role="status">No hay resultados para estos filtros.</p><div class="table-wrap"><table><thead><tr><th>Producto</th><th>Importe</th><th>Acciones</th></tr></thead><tbody>${rows}</tbody></table></div></section><section class="panel"><h2>Estados de solicitud</h2><p id="escaped">${escapedText}</p><button id="slowSave" type="button">Guardar cambios</button><button id="readonly" type="button" disabled>Registrar venta</button><button id="error400" type="button">Simular 400</button><button id="error401" type="button">Simular 401</button><button id="error403" type="button">Simular 403</button><button id="error404" type="button">Simular 404</button><button id="error429" type="button">Simular 429</button><button id="error500" type="button">Simular 500</button><button id="network" type="button">Simular red lenta</button></section><section class="panel ui-empty" id="emptyState" role="status"><strong>Sin solicitudes</strong><p>Aún no tienes solicitudes de pago.</p></section></main><script>window.__submits=0;window.__releaseSlow=null;const feedback=document.getElementById('feedback');const messageFor=(code)=>window.UiPatterns.messageFor({code,message:'SQL SELECT /private/path #123'});['400','401','403','404','500'].forEach((code)=>document.getElementById('error'+code).addEventListener('click',()=>{feedback.textContent=messageFor(code);}));document.getElementById('error429').addEventListener('click',()=>{feedback.textContent=messageFor('RATE_LIMITED');});document.getElementById('network').addEventListener('click',()=>{feedback.textContent=window.UiPatterns.messageFor({message:'Failed to fetch /private/path'});});document.getElementById('emptyFilter').addEventListener('click',()=>{document.getElementById('empty').hidden=false;});document.getElementById('slowSave').addEventListener('click',()=>{const button=document.getElementById('slowSave');if(button.disabled)return;window.__submits+=1;const restore=window.UiPatterns.mutation(button,'Guardando...');window.__releaseSlow=()=>{restore();feedback.textContent='Cambios guardados.';};});</script></body></html>`;
}

async function main() {
  const server = http.createServer((request, response) => {
    if (request.url === '/styles.css') return fs.createReadStream(stylesheet).pipe(response);
    if (request.url === '/ui-patterns.js') return fs.createReadStream(patterns).pipe(response);
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(pageMarkup());
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
      assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      assert.strictEqual(await page.locator('#escaped').textContent(), '<script>window.__xss = true</script> & " \' Emoji 🧾');
      assert.strictEqual(await page.evaluate(() => window.__xss === true), false);
      await page.getByText('Más opciones').first().focus();
      await page.keyboard.press('Enter');
      assert.strictEqual(await page.locator('details').first().evaluate((item) => item.open), true);
      await page.locator('#emptyFilter').click();
      assert.strictEqual(await page.locator('#empty').isVisible(), true);
      await page.locator('#slowSave').click();
      assert.strictEqual(await page.locator('#slowSave').isDisabled(), true);
      assert.strictEqual(await page.locator('#slowSave').getAttribute('aria-busy'), 'true');
      await page.evaluate(() => { for (let index = 0; index < 10; index += 1) document.getElementById('slowSave').click(); });
      assert.strictEqual(await page.evaluate(() => window.__submits), 1);
      await page.evaluate(() => window.__releaseSlow());
      assert.strictEqual(await page.locator('#slowSave').isDisabled(), false);
      assert.strictEqual(await page.locator('#slowSave').getAttribute('aria-busy'), null);
      assert.strictEqual(await page.locator('#readonly').isDisabled(), true);
      for (const code of ['400', '401', '403', '404', '500']) {
        await page.locator(`#error${code}`).click();
        assert.strictEqual(await page.locator('#feedback').textContent(), 'No pudimos completar la operación. Inténtalo nuevamente.');
      }
      await page.locator('#error429').click();
      assert.match(await page.locator('#feedback').textContent(), /muchas solicitudes/i);
      await page.locator('#network').click();
      assert.match(await page.locator('#feedback').textContent(), /conexión/i);
      assert.deepStrictEqual(errors, []);
      await page.close();
    }
    console.log('test:product-ui-hardening-browser OK');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`test:product-ui-hardening-browser FAIL: ${error.message}`);
  process.exitCode = 1;
});
