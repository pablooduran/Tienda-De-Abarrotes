const assert = require('assert');
const http = require('http');
const fs = require('fs');
const { chromium } = require('playwright-core');

function executable() {
  return [
    process.env.BROWSER_EXECUTABLE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean).find((file) => fs.existsSync(file));
}

async function main() {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html lang="es"><head><style>
      body { margin: 0; font: 16px Arial, sans-serif; color: #17211d; }
      main { max-width: 860px; margin: 0 auto; padding: 16px; }
      .actions { display: flex; flex-wrap: wrap; gap: 8px; }
      button, summary { min-height: 40px; padding: 9px 14px; border: 1px solid #728277; border-radius: 6px; background: #fff; color: #17211d; font-weight: 600; cursor: pointer; }
      .primary { border-color: #286a59; background: #286a59; color: #fff; }
      .admin-more-actions[open] > .actions { margin-top: 8px; }
      :focus-visible { outline: 3px solid #286a59; outline-offset: 2px; }
    </style></head><body><main><h1>Mi plan</h1><div class="actions"><button class="primary">Cotizar</button><button>Crear solicitud de pago</button></div><h2>Administracion</h2><details class="admin-more-actions"><summary>Mas opciones</summary><div class="actions"><button>Suspender</button><button>Cancelar</button></div></details></main></body></html>`);
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
      await page.getByText('Mas opciones').focus();
      await page.keyboard.press('Enter');
      assert.strictEqual(await page.locator('.admin-more-actions').evaluate((element) => element.open), true);
      assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      assert.deepStrictEqual(errors, []);
      await page.close();
    }
    console.log('test:product-design-consistency-browser OK');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`test:product-design-consistency-browser FAIL: ${error.message}`);
  process.exitCode = 1;
});
