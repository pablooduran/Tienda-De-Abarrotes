const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');
const uiFile = path.resolve(__dirname, '..', 'public/js/ui-patterns.js');
function executable() { return [process.env.BROWSER_EXECUTABLE_PATH, 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean).find((file) => fs.existsSync(file)); }
async function main() {
  const server = http.createServer((request, response) => {
    if (request.url === '/ui-patterns.js') { response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); return fs.createReadStream(uiFile).pipe(response); }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><html><body><main id="root"></main><script src="/ui-patterns.js"></script><script>root.innerHTML=UiPatterns.skeleton("rows",3)+UiPatterns.empty("Sin proveedores","Registra tu primer proveedor.");</script></body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: executable(), headless: true });
  const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
  try { const errors = []; page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); }); page.on('pageerror', (error) => errors.push(error.message)); await page.goto(`http://127.0.0.1:${server.address().port}/`); await page.locator('.ui-empty').waitFor(); assert.strictEqual(await page.locator('.ui-skeleton span').count(), 3); assert.strictEqual(await page.locator('.ui-empty strong').textContent(), 'Sin proveedores'); assert.deepStrictEqual(errors, []); console.log('test:product-ux-browser OK'); }
  finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
}
main().catch((error) => { console.error(`test:product-ux-browser FAIL: ${error.message}`); process.exitCode = 1; });
