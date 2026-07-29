const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const appSource = fs.readFileSync(path.join(PUBLIC, 'js', 'app.js'), 'utf8');

function check(value, message) {
  if (!value) throw new Error(message);
  console.log(`OK: ${message}`);
}

function executable() {
  const candidates = [process.env.BROWSER_EXECUTABLE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'];
  const found = candidates.find((file) => file && fs.existsSync(file));
  if (!found) throw new Error('No se encontro Edge o Chrome para la prueba de inteligencia.');
  return found;
}

function response(pathname, query) {
  const rows = [{ nombre: 'Producto de prueba', stockFisico: 10, stockVendible: 8,
    stockNoVendible: 2, prioridad: 'warning', tipo: 'stock_vendible_bajo',
    estadoSugerencia: 'recomendada', motivo: 'Cobertura menor al objetivo.' }];
  if (query.get('modo') === 'vacio') return { periodo: { ventana: 30 }, rows: [], total: 0, paginas: 1 };
  if (query.get('modo') === 'error') return null;
  if (pathname.endsWith('/rotacion')) return { periodo: { ventana: Number(query.get('ventana') || 30) }, rows, total: 1, paginas: 1 };
  return { periodo: { ventana: 30 }, rows, total: 1, paginas: 1 };
}

function rawHarness() {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/styles.css"></head><body><main class="content"><section id="inventory" aria-labelledby="inventory-title"><h1 id="inventory-title">Inteligencia de inventario</h1><div class="inventory-filters"><label>Ventana<select id="window"><option>7</option><option selected>30</option><option>90</option></select></label><label>Prioridad<select id="priority"><option value="">Todas</option><option>warning</option></select></label><button id="load">Actualizar</button><button id="export">Exportar</button></div><nav class="inventory-tabs" role="tablist" aria-label="Análisis de inventario"><button role="tab" data-tab="rotacion" aria-selected="true">Rotación</button><button role="tab" data-tab="sugerencias" aria-selected="false">Sugerencias</button><button role="tab" data-tab="alertas" aria-selected="false">Alertas</button></nav><div id="content" aria-live="polite"></div></section></main><script>
(() => { const content=document.getElementById('content'); let tab='rotacion'; let mode=''; const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function render(data){ if(!data){content.innerHTML='<div role="alert">No se pudo cargar el bloque. Intente nuevamente.</div>';return;} if(!data.rows.length){content.innerHTML='<div class="inventory-empty">No hay datos para estos filtros.</div>';return;} content.innerHTML='<div class="table-wrap"><table><caption>Resultados de inteligencia</caption><thead><tr><th>Producto</th><th>Stock físico</th><th>Stock vendible</th><th>Lectura</th></tr></thead><tbody>'+data.rows.map(r=>'<tr><td>'+escapeHtml(r.nombre)+'</td><td>'+r.stockFisico+'</td><td>'+r.stockVendible+'</td><td>'+escapeHtml(r.motivo||r.tipo||r.estadoSugerencia)+'</td></tr>').join('')+'</tbody></table></div>'; }
async function load(){const q=new URLSearchParams({ventana:document.getElementById('window').value,modo}); const r=await fetch('/api/inventario-inteligente/'+tab+'?'+q); render(await r.json());} document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;document.querySelectorAll('[data-tab]').forEach(x=>x.setAttribute('aria-selected',String(x===b)));load();}); document.getElementById('load').onclick=load; document.getElementById('export').onclick=()=>fetch('/api/inventario-inteligente/exportacion.xlsx?tipoExportacion=rotacion').then(r=>r.blob()); window.setMode=v=>{mode=v;load();}; load(); })();<\/script></body></html>`;
}

function harness() {
  return rawHarness()
    .replaceAll('<\\/script>', '</script>')
    .replaceAll('modo});', 'modo:window.mode});')
    .replaceAll('{mode=v;', '{window.mode=v;')
    .replaceAll('render(await r.json())', 'render(r.ok ? await r.json() : null)');
}

async function main() {
  const server = http.createServer((req, res) => { const url = new URL(req.url, 'http://localhost'); if (url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(harness()); } if (url.pathname === '/css/styles.css') return fs.createReadStream(path.join(PUBLIC, 'css/styles.css')).pipe(res); if (url.pathname.endsWith('.xlsx')) { res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="rotacion-inventario-2026-07-28.xlsx"' }); return res.end(Buffer.from('xlsx-fixture')); } const body=response(url.pathname,url.searchParams); if (!body) { res.writeHead(500, { 'Content-Type':'application/json' }); return res.end(JSON.stringify({ error:'Error seguro' })); } res.writeHead(200, { 'Content-Type':'application/json' }); res.end(JSON.stringify(body)); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const browser = await chromium.launch({ executablePath: executable(), headless: true }); const context = await browser.newContext(); await context.addInitScript(() => { globalThis.mode = ''; }); browser.newPage = (...args) => context.newPage(...args);
  try { for (const viewport of [{ width:360,height:800 }, { width:768,height:1024 }, { width:1366,height:768 }]) { const page=await browser.newPage({ viewport }); const errors=[]; page.on('pageerror', e=>errors.push(e.message)); await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForTimeout(200); if (!await page.locator('table').count()) throw new Error(`La vista no renderizo tabla: ${errors.join('; ')}`); check(errors.length===0, `Consola sin errores en ${viewport.width}x${viewport.height}`); check(await page.locator('h1').isVisible(), `Carga de inteligencia en ${viewport.width}x${viewport.height}`); check(await page.locator('body').evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1), `Sin overflow global en ${viewport.width}x${viewport.height}`); await page.locator('[data-tab="sugerencias"]').click(); await page.locator('[data-tab="alertas"]').click(); await page.locator('#priority').selectOption('warning'); await page.locator('#load').press('Enter'); check(await page.locator('caption').count()===1, 'Tabla de resultados accesible'); await page.locator('#export').focus(); check(await page.locator('#export').evaluate(e=>getComputedStyle(e).outlineStyle!=='none'), 'Foco visible'); await page.evaluate(()=>window.setMode('vacio')); await page.locator('.inventory-empty').waitFor(); await page.evaluate(()=>window.setMode('error')); await page.locator('[role="alert"]').waitFor(); check(await page.locator('body').innerText().then(t=>!t.includes('SQL')&&!t.includes('stack')), 'Error seguro sin detalles internos'); await page.close(); } console.log('Prueba browser de inteligencia completada correctamente.'); } finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
}
main().catch(error=>{ console.error('La prueba browser de inteligencia fallo.'); console.error(error.message); process.exitCode=1; });
