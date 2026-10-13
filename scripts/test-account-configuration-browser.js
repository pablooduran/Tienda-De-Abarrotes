const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const publicDir = path.resolve(__dirname, '..', 'public');

function browserPath() {
  const candidates = [process.env.BROWSER_EXECUTABLE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('Se requiere Edge o Chromium local.');
  return found;
}

const harness = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/styles.css"></head><body><main id="root"></main><script>
window.StoreTheme={get:()=> 'light',set:(value)=>value};
window.UiPatterns={messageFor:(error)=>error.message};
window.requests=[];
const configuration={configuracion:{nombreMostrado:'Tienda prueba',moneda:'BOB',zonaHoraria:'America/La_Paz',telefono:'+591 70000001',direccion:'Centro',datoFiscalBasico:''},onboardingCompletado:true};
let account={usuario:'pablo.prueba',rol:'dueno_tienda',correo:'actual@example.com',correoVerificado:true,correoPendiente:null,telefono:null};
async function api(url,options={}){
  const body=options.body?JSON.parse(options.body):{}; window.requests.push({url,method:options.method||'GET',body});
  if(url==='/api/configuracion-tienda') return configuration;
  if(url==='/auth/account'&&(!options.method||options.method==='GET')) return {cuenta:account};
  if(url==='/auth/account'&&options.method==='PATCH'){account={...account,telefono:body.telefono};return {message:'Teléfono actualizado.',cuenta:account};}
  if(url==='/auth/account/email'){account={...account,correoPendiente:body.correo};return {message:'Código enviado.',cuenta:account};}
  if(url==='/auth/account/email/confirm'){account={...account,correo:account.correoPendiente,correoPendiente:null,correoVerificado:true};return {message:'Correo verificado.',cuenta:account};}
  throw new Error('Ruta inesperada '+url);
}
</script><script src="/js/store-configuration-ui.js"></script><script>StoreConfigurationUI.create({root:document.getElementById('root'),api}).render();</script></body></html>`;

function fixture() {
  return http.createServer((request, response) => {
    if (request.url === '/harness') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return response.end(harness);
    }
    const file = path.resolve(publicDir, request.url.split('?')[0].slice(1));
    if (!file.startsWith(`${publicDir}${path.sep}`) || !fs.existsSync(file)) {
      response.writeHead(404); return response.end('No encontrado');
    }
    const ext = path.extname(file);
    response.writeHead(200, { 'Content-Type': ext === '.js' ? 'text/javascript' : 'text/css' });
    return fs.createReadStream(file).pipe(response);
  });
}

async function verify(browser, baseUrl, width) {
  const page = await browser.newPage({ viewport: { width, height: 820 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(`${baseUrl}/harness`);
    await page.locator('[data-configuration-panel]').waitFor();
    assert.match(await page.locator('.configuration-account-group').textContent(), /pablo\.prueba/);
    assert.match(await page.locator('.configuration-account-group').textContent(), /Correo verificado/);
    await page.locator('[name="telefonoCuenta"]').fill('+591 77000000');
    await page.locator('[data-account-phone]').click();
    await page.waitForFunction(() => window.requests.some((item) => item.method === 'PATCH'));
    assert.strictEqual(await page.locator('[name="telefonoCuenta"]').inputValue(), '+591 77000000');
    await page.locator('[name="correoCuenta"]').fill('nuevo@example.com');
    await page.locator('[data-account-email]').click();
    await page.locator('[name="codigoCorreoCuenta"]').waitFor();
    assert.match(await page.locator('.account-status-warning').textContent(), /Pendiente/);
    await page.locator('[name="codigoCorreoCuenta"]').fill('482731');
    await page.locator('[data-account-email-confirm]').click();
    await page.locator('.account-status-ok').waitFor();
    assert.strictEqual(await page.locator('[name="correoCuenta"]').inputValue(), 'nuevo@example.com');
    await page.locator('.account-password-panel summary').click();
    await page.locator('[data-account-show-passwords]').check();
    assert.strictEqual(await page.locator('[name="passwordNueva"]').getAttribute('type'), 'text');
    assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true);
    assert.deepStrictEqual(errors, []);
  } finally {
    await page.close();
  }
}

async function main() {
  const server = fixture();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: browserPath(), headless: true });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    await verify(browser, baseUrl, 360);
    await verify(browser, baseUrl, 768);
    await verify(browser, baseUrl, 1366);
    console.log('test:account-configuration-browser OK');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`test:account-configuration-browser FAIL: ${error.message}`);
  process.exitCode = 1;
});
