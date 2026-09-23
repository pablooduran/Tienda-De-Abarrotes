const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
const edge = [process.env.BROWSER_EXECUTABLE_PATH, 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((file) => file && fs.existsSync(file));

function json(response, body) {
  response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function context(plan = 'full') {
  const basicFeatures = ['inventario_resumen', 'alertas_stock', 'ranking_productos', 'valor_inventario_basico'];
  return {
    tienda: { nombre: 'Tienda ventas' },
    plan: { nombre: plan === 'basic' ? 'Basic' : 'Pro' },
    suscripcion: { fechaFin: '2026-12-31 00:00:00', diasRestantes: 120 },
    caracteristicas: plan === 'minimal' ? ['inventario_resumen', 'alertas_stock'] : plan === 'basic' ? basicFeatures : ['punto_venta', 'clientes_basico', 'fiados_basico', 'pagos_fiado', 'anulaciones_operativas',
      'inventario_resumen', 'alertas_stock', 'ranking_productos', 'valor_inventario_basico',
      'compras_sugeridas', 'rotacion_inventario', 'inventario_sin_movimiento', 'reportes_financieros']
  };
}

function product() {
  return {
    idProducto: 1, nombre: 'Arroz prueba', categoria: 'Granos', proveedor: 'Proveedor prueba', precioVenta: 10,
    stockUnidadesTotal: 8, unidadesPorPaquete: 1, activo: 1, bajoStock: false, controlaLotes: 0,
    permiteVentaPorUnidad: 1, permiteVentaPorPaquete: 0, favoritoPos: 0, unidadMedida: 'unidad'
  };
}

function purchaseProduct() {
  return { ...product(), idProveedor: 2, unidadesPorPaquete: 6, ultimoPrecioCompra: 8, proveedor: 'Proveedor prueba' };
}

function serverFor(requests) {
  return http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    requests.push({ path: url.pathname, search: url.search, plan: request.headers['x-test-plan'] || 'full' });
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/contexto') return json(response, context(request.headers['x-test-plan'] || 'full'));
      if (url.pathname === '/api/lotes/acceso') return json(response, { productosControlados: 0 });
      if (url.pathname === '/api/dashboard') return json(response, { ventasHoy: 0, ventasAyer: 0, ventasMes: 0, ventasMesPasado: 0, gananciaHoy: 0, gananciaMes: 0, bajoStock: 0, fiados: {}, chartVentasDias: [] });
      if (url.pathname === '/api/ventas') return json(response, [{ idVenta: 31, codigoComprobante: 'V-000031', fecha: '2026-09-22 10:00:00', cliente: 'Cliente ocasional', total: 20, montoPagado: 20, saldoPendiente: 0, metodosPago: 'efectivo', estadoPago: 'pagada' }]);
      if (url.pathname === '/api/ventas/31') return json(response, { venta: { idVenta: 31, codigoComprobante: 'V-000031', fecha: '2026-09-22 10:00:00', cliente: 'Cliente ocasional', total: 20, montoPagado: 20, saldoPendiente: 0, estadoPago: 'pagada' }, detalle: [{ nombre: 'Arroz prueba', cantidad: 2, presentacionVenta: 'unidad', cantidadEquivalenteUnidades: 2, subtotal: 20, subtotalCosto: 12, ganancia: 8 }], pagos: [{ metodoPago: 'efectivo', monto: 20 }] });
      if (url.pathname === '/api/ventas/31/comprobante') return json(response, { venta: { idVenta: 31, codigoComprobante: 'V-000031', tienda: 'Tienda ventas', fecha: '2026-09-22 10:00:00', subtotal: 20, total: 20, montoPagado: 20, saldoPendiente: 0 }, detalle: [{ nombre: 'Arroz prueba', cantidad: 2, presentacionVenta: 'unidad', precioVenta: 10, subtotal: 20 }], pagos: [{ metodoPago: 'efectivo', monto: 20 }] });
      if (url.pathname === '/api/compensaciones/opciones') return json(response, { tipos: [], estados: [] });
      if (url.pathname === '/api/compensaciones/ventas/31/contexto') return json(response, { venta: { idVenta: 31, codigoComprobante: 'V-000031', cliente: 'Cliente ocasional', fecha: '2026-09-22 10:00:00', estadoOperacion: 'vigente', total: 20 }, detalle: [], pagos: [], cobros: [] });
      if (url.pathname === '/api/compensaciones') return json(response, { resultados: [], resumen: { total: 0, compensacionComercial: 0, liquidacionesMateriales: 0, pendientes: 0 }, paginacion: { page: 1, totalPages: 1, total: 0, hasPreviousPage: false, hasNextPage: false } });
      if (url.pathname === '/api/catalogo-maestro/categorias' || url.pathname === '/api/catalogo-maestro/marcas') return json(response, []);
      if (url.pathname === '/api/catalogo-maestro') {
        const page = Number(url.searchParams.get('page') || 1);
        return json(response, { page, pages: 2, total: 21, rows: [{
          idProductoMaestro: page === 1 ? 1 : 21, nombre: page === 1 ? 'Arroz maestro' : 'Aceite maestro',
          marca: 'Marca prueba', categoriaMaestra: 'Abarrotes', presentacion: 'Unidad', unidadesPorPaquete: 1,
          permiteVentaPorUnidad: 1, permiteVentaPorPaquete: 0, agregadoEnTienda: 0
        }] });
      }
      const period = { desde: '2026-09-01', hastaExclusivo: '2026-09-23' };
      if (url.pathname === '/api/inventario-inteligente/resumen') return json(response, {
        periodo: period, productosActivos: 6, estados: { agotado: 1, bajo: 2, en_minimo: 1, suficiente: 2 }
      });
      if (url.pathname === '/api/inventario-inteligente/valoracion') return json(response, {
        periodo: period, resumen: { valorCostoConocido: 50, valorVenta: 90, gananciaPotencialConocida: 40,
          productosConCostoDesconocido: 0, productosConCostoConocido: 6, unidadesConCostoDesconocido: 0 }, rows: []
      });
      if (url.pathname === '/api/inventario-inteligente/alertas') return json(response, {
        periodo: period, total: 1, pagina: 1, paginas: 1, rows: [{ idProducto: 1, nombre: 'Arroz prueba',
          tipo: 'stock_vendible_bajo', mensaje: 'Hay pocas unidades disponibles.', stockVendible: 2, stockNoVendible: 0,
          prioridad: 'warning' }]
      });
      if (url.pathname === '/api/inventario-inteligente/sin-movimiento') return json(response, {
        periodo: period, total: 0, pagina: 1, paginas: 1, rows: []
      });
      if (url.pathname === '/api/reportes/ventasDia') return json(response, {
        rows: [{ idVenta: 31, fecha: '2026-09-22', total: 12 }], chart: { labels: ['2026-09-22'], values: [12] }
      });
      if (url.pathname === '/api/reportes/bajoStock') return json(response, { rows: [], chart: null });
      if (url.pathname === '/api/reportes/fiados') return json(response, {
        rows: [{ idFiado: 17, idTienda: 3, idCliente: 7, cliente: 'Ana Cliente',
          fechaInicio: '2026-09-22', fechaVencimiento: '2026-10-22',
          totalFiado: 20, totalPagado: 0, saldoPendiente: 20, estado: 'pendiente', activo: 1 }],
        chart: null
      });
      if (url.pathname === '/api/dashboard/financiero') return json(response, {
        resumen: { ventasNetas: 12, dineroCobrado: 12, descuentos: 0, cobrosFiado: 0,
          rentabilidadCompleta: true, rentabilidadExacta: true, gananciaBruta: 5,
          gananciaNeta: 5, costoVendido: 7, gastos: 0, cantidadGastos: 0,
          gananciaBrutaConfirmada: 5, gananciaBrutaEstimada: 0, cuentasPorCobrar: 0,
          fiadoGenerado: 0, flujoEfectivoConocido: 12 },
        ventasPorDia: [{ fecha: '2026-09-22', ventasNetas: 12, gananciaCalculable: 5 }],
        metodosPago: [{ metodoPago: 'Efectivo', total: 12 }], gastosPorCategoria: []
      });
      if (url.pathname === '/api/reportes/finanzas/cuentas-por-cobrar' || url.pathname === '/api/reportes/finanzas/compras') return json(response, { total: 0, totalRegistros: 0 });
      if (url.pathname === '/api/fiados/17') return json(response, { fiado: { idFiado: 17, idCliente: 7, saldoPendiente: 20 } });
      if (url.pathname === '/api/clientes/7/resumen') return json(response, { cliente: { idCliente: 7, nombre: 'Ana Cliente', deudaActual: 20 } });
      if (url.pathname === '/api/fiados') return json(response, [{ idFiado: 17, idCliente: 7, cliente: 'Ana Cliente', clienteActivo: true, telefono: '70000000', saldoPendiente: 20, fechaVencimiento: null, fechaPrometidaPago: null, estadoCobranza: 'al_dia' }]);
      if (url.pathname === '/api/productos') return json(response, [purchaseProduct()]);
      if (url.pathname === '/api/proveedores') return json(response, [{ idProveedor: 2, nombre: 'Proveedor prueba' }]);
      if (['/api/clientes', '/api/categorias'].includes(url.pathname)) return json(response, []);
      if (url.pathname === '/api/pos/recientes' || url.pathname === '/api/pos/productos') return json(response, { productos: [product()] });
      if (url.pathname === '/api/pos/clientes') return json(response, { clientes: [{ idCliente: 7, nombre: 'Ana Cliente', telefono: '70000000' }], pagina: 1, limite: 15, total: 1, hayMas: false });
      return json(response, { rows: [], resultados: [], paginas: 1, page: 1, pages: 1, resumen: {}, paginacion: { page: 1, totalPages: 1 } });
    }
    if (url.pathname === '/favicon.ico') { response.writeHead(204); return response.end(); }
    const relative = url.pathname === '/' ? 'app.html' : url.pathname.slice(1);
    const file = path.resolve(publicDir, relative);
    if (!file.startsWith(`${publicDir}${path.sep}`) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { response.writeHead(404); return response.end(); }
    const extension = path.extname(file);
    response.writeHead(200, { 'Content-Type': extension === '.html' ? 'text/html; charset=utf-8' : extension === '.css' ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(response);
  });
}

async function salesView(page, id) {
  const family = page.locator('[data-navigation-family="ventas"]');
  if (!await family.evaluate((node) => node.open)) await family.locator('> summary').click();
  await page.locator(`[data-view="${id}"]`).click();
  await page.locator(`[data-navigation-family="ventas"] [data-view="${id}"].active`).waitFor();
}

async function verifyViewport(browser, baseUrl, viewport) {
  const context = await browser.newContext({ viewport, isMobile: viewport.width === 360, hasTouch: viewport.width !== 1366 });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(`${baseUrl}/app.html`);
    await salesView(page, 'ventas');
    await page.locator('#posClient').waitFor({ state: 'attached' });
    await page.locator('.sales-workspace-nav').waitFor({ state: 'attached' });
    assert.strictEqual(await page.locator('.sales-workspace-nav').isVisible(), viewport.width <= 900,
      'La subnavegacion de ventas solo debe mostrarse cuando el menu lateral pasa arriba.');
    assert.strictEqual(await page.locator('#posClient').getAttribute('type'), 'hidden');
    assert.strictEqual(await page.locator('#posClientSearch').getAttribute('role'), 'combobox');
    await page.locator('#posClientSearch').fill('A');
    await page.waitForFunction(() => document.getElementById('posClientStatus').textContent === 'Escribe al menos 2 caracteres para buscar.');
    assert.strictEqual(await page.locator('#posClientStatus').textContent(), 'Escribe al menos 2 caracteres para buscar.');
    await page.locator('#posClientSearch').fill('Ana');
    await page.locator('[data-pos-client-option="0"]').waitFor();
    await page.locator('#posClientSearch').press('ArrowDown');
    await page.locator('#posClientSearch').press('Enter');
    assert.strictEqual(await page.locator('#posClient').inputValue(), '7');
    assert.strictEqual(await page.locator('#posClientClear').isVisible(), true);
    await page.locator('#posPaymentMode').selectOption('fiado');
    assert((await page.locator('#posCreditNote').textContent()).includes('cliente seleccionado'),
      'El mensaje de fiado reconoce al cliente seleccionado.');
    await page.locator('#posClientClear').click();
    assert.strictEqual(await page.locator('#posClient').inputValue(), '');
    assert((await page.locator('#posCreditNote').textContent()).includes('Selecciona un cliente registrado'),
      'El mensaje de fiado pide cliente solo cuando falta.');
    await salesView(page, 'historialVentas');
    assert.strictEqual(await page.locator('text=Historial de ventas').count() > 0, true);
    await page.locator('#view [data-detail="31"]').waitFor();
    assert.strictEqual(await page.locator('#view .row-actions').count(), 0, 'Historial no debe ocultar la unica accion tras Mas opciones.');
    assert.strictEqual(await page.locator('#view [data-detail="31"]').isVisible(), true, 'Ver detalle debe ser visible en la fila.');
    assert.strictEqual(await page.locator('#view [data-receipt="31"]').isVisible(), true, 'Comprobante debe ser visible en la fila.');
    await page.locator('#view [data-receipt="31"]').click();
    await page.locator('[role="dialog"] #saleReceipt').waitFor();
    assert.strictEqual(await page.locator('#saleReceipt').textContent().then((text) => text.includes('V-000031')), true, 'El comprobante debe corresponder a la venta.');
    await page.locator('[role="dialog"] [data-modal-confirm]').click();
    await page.locator('#view [data-detail="31"]').click();
    await page.locator('[role="dialog"] [data-open-receipt="31"]').waitFor();
    await page.locator('[role="dialog"] [data-modal-confirm]').click();
    await salesView(page, 'pagos');
    await page.locator('#collectionFilters').waitFor();
    await page.locator('[data-open-collection-filters]').click();
    await page.locator('#collectionAdvancedFilters [name="estado"]').selectOption('vencido');
    await page.locator('#collectionAdvancedFilters [data-modal-cancel]').click();
    assert.strictEqual(await page.evaluate(() => document.body.style.overflow), '', 'Cerrar restaura el desplazamiento de fondo.');
    await page.locator('[data-open-collection-filters]').click();
    assert.strictEqual(await page.locator('#collectionAdvancedFilters [name="estado"]').inputValue(), '', 'Cerrar no debe aplicar filtros.');
    await page.locator('#collectionAdvancedFilters [name="estado"]').selectOption('vencido');
    const filtered = page.waitForResponse((response) => response.url().includes('/api/fiados?') && response.url().includes('estado=vencido'));
    await page.locator('#collectionAdvancedFilters button[type="submit"]').click();
    await filtered;
    assert.strictEqual(await page.locator('#collectionFilters [name="busqueda"]').isVisible(), true, 'La busqueda principal permanece visible.');
    const searched = page.waitForResponse((response) => response.url().includes('/api/fiados?') && response.url().includes('estado=vencido') && response.url().includes('busqueda=Ana'));
    await page.locator('#collectionFilters [name="busqueda"]').fill('Ana');
    await searched;
    await page.locator('[data-open-collection-filters]').click();
    assert.strictEqual(await page.locator('#collectionAdvancedFilters [name="estado"]').inputValue(), 'vencido');
    await page.locator('#collectionAdvancedFilters [data-clear-collection-filters]').click();
    await page.locator('#collectionFilters').waitFor();
    assert.strictEqual(await page.locator('#collectionFilters [name="busqueda"]').inputValue(), 'Ana', 'Limpiar criterios avanzados conserva la busqueda visible.');
    await page.locator('[data-debt-pay="17"]:visible').first().click();
    await page.locator('[data-credit-modal]').waitFor();
    assert.strictEqual((await page.locator('[data-credit-modal]').textContent()).includes('Este pago se aplicara solo a la deuda seleccionada.'), true);
    assert.strictEqual((await page.locator('[data-credit-modal]').textContent()).includes('Referencia (opcional)'), true);
    await page.locator('[data-credit-modal] [data-modal-cancel]').click();
    await page.locator('[data-customer-pay-accum="7"]:visible').first().click();
    await page.locator('[data-credit-modal]').waitFor();
    assert.strictEqual((await page.locator('[data-credit-modal]').textContent()).includes('Este pago se repartira entre las deudas del cliente'), true);
    await page.locator('[data-credit-modal] [data-modal-cancel]').click();
    await salesView(page, 'compensaciones');
    await page.locator('[data-compensation-tab="ventas"]').click();
    await page.locator('[data-recent-sale-search]').fill('V-000031');
    assert.strictEqual(await page.locator('[data-select-sale="31"]').count(), 1, 'Se puede buscar por comprobante sin recordar el ID.');
    await page.locator('[data-recent-sale-search]').fill('No existe');
    assert.strictEqual(await page.locator('[data-select-sale]').count(), 0, 'La búsqueda vacía informa que no hay coincidencias.');
    await page.locator('[data-recent-sale-search]').fill('Cliente ocasional');
    await page.locator('[data-select-sale="31"]').click();
    await page.locator('[data-sale-context] .compensation-sale-context').waitFor();
    assert.strictEqual((await page.locator('[data-sale-context]').textContent()).includes('V-000031'), true);
    const inventoryFamily = page.locator('[data-navigation-family="inventario"]');
    if (!await inventoryFamily.evaluate((node) => node.open)) await inventoryFamily.locator('> summary').click();
    await page.locator('[data-view="compras"]').click();
    await page.locator('#comprasProvider').selectOption('2');
    await page.locator('#comprasResults [data-product="1"]').click();
    assert.strictEqual((await page.locator('[data-purchase-price-label]').textContent()).includes('por unidad'), true);
    await page.locator('.cart-item [name="presentacion"]').selectOption('paquete');
    assert.strictEqual((await page.locator('[data-purchase-price-label]').textContent()).includes('por paquete'), true);
    await page.locator('.cart-item [name="precioCompra"]').fill('30');
    assert.strictEqual((await page.locator('[data-purchase-cost-preview]').textContent()).includes('Bs 5.00'), true, 'Costo unitario base calculado sin cambiar el precio registrado.');
    assert.strictEqual(await page.locator('#total').textContent(), 'Bs 30.00');
    await page.locator('[data-view="productos"]').click();
    await page.locator('.inventory-secondary-actions summary').click();
    await page.locator('#addFromCatalog').click();
    await page.locator('#catalogPickerResults [data-select-master="1"]').waitFor();
    assert.strictEqual(await page.locator('#catalogPickerPage').textContent(), 'Página 1 de 2 · 21 productos');
    await page.locator('#catalogPickerResults [data-select-master="1"]').check();
    assert.strictEqual(await page.locator('#catalogSelectedCount').textContent(), '1 de 50');
    await page.locator('#catalogSelectedProducts [name="nombreLocal"]').fill('Arroz de mi tienda');
    await page.locator('#catalogPickerNext').click();
    await page.locator('#catalogPickerResults [data-select-master="21"]').waitFor();
    await page.locator('#catalogPickerResults [data-select-master="21"]').check();
    assert.strictEqual(await page.locator('#catalogSelectedCount').textContent(), '2 de 50');
    assert.strictEqual(await page.locator('#catalogSelectedProducts [name="nombreLocal"]').first().inputValue(), 'Arroz de mi tienda', 'La configuración local sobrevive al cambio de página.');
    await page.locator('#catalogPickerPrevious').click();
    assert.strictEqual(await page.locator('#catalogPickerResults [data-select-master="1"]').isChecked(), true);
    await page.locator('#catalogPickerResults [data-select-master="1"]').uncheck();
    assert.strictEqual(await page.locator('#catalogSelectedCount').textContent(), '1 de 50');
    await page.locator('.catalog-picker-modal [data-modal-cancel]').click();
    await page.locator('[data-view="inventarioInteligente"]').click();
    await page.locator('#inventorySimpleTitle').waitFor();
    assert.strictEqual((await page.locator('#inventoryContent').textContent()).includes('Se está agotando'), true);
    assert.strictEqual((await page.locator('#inventoryContent').textContent()).includes('hasta 22/09/2026'), true,
      'El período visible termina en el último día incluido.');
    assert.strictEqual(await page.locator('[data-inventory-tab="rotacion"]').count(), 0,
      'La vista simple no mezcla las métricas avanzadas.');
    await page.locator('[data-inventory-simple-destination="alertas"]').click();
    await page.locator('.inventory-simple-alert').waitFor();
    assert.strictEqual((await page.locator('.inventory-simple-alert').textContent()).includes('Hay pocas unidades disponibles.'), true);
    await page.locator('[data-inventory-level="avanzado"]').click();
    await page.locator('[data-inventory-tab="rotacion"]').waitFor();
    await page.locator('#inventoryContent').getByText('Valor a costo conocido').first().waitFor();
    assert.strictEqual((await page.locator('#inventoryContent').textContent()).includes('Valor a costo conocido'), true);
    await page.locator('[data-inventory-level="simple"]').click();
    assert.strictEqual(await page.locator('[data-inventory-tab="rotacion"]').count(), 0);
    await page.locator('[data-inventory-simple-destination="sinMovimiento"]').click();
    await page.locator('#inventoryContent').getByText('Productos sin movimiento').waitFor();
    assert.strictEqual(await page.locator('[data-inventory-level="avanzado"]').getAttribute('aria-pressed'), 'true',
      'La consulta de productos sin movimiento abre el nivel avanzado autorizado.');
    const reportsFamily = page.locator('[data-navigation-family="reportes"]');
    if (!await reportsFamily.evaluate((node) => node.open)) await reportsFamily.locator('> summary').click();
    await page.locator('[data-view="reportes"]').click();
    await page.locator('#reportChartPanel').waitFor({ state: 'attached' });
    assert.strictEqual(await page.locator('#reportChartPanel').isVisible(), false, 'El gráfico no aparece antes de consultar.');
    await page.locator('#reportForm button[type="submit"]').click();
    await page.locator('#reportResult table').waitFor();
    assert.strictEqual(await page.locator('#reportResult th').allTextContents().then((labels) => labels.join('|')), 'Fecha|Total (Bs)',
      'El reporte usa columnas claras y oculta el identificador interno.');
    assert.strictEqual(await page.locator('#reportChartPanel').isVisible(), true);
    assert.strictEqual((await page.locator('#reportChart').getAttribute('aria-label')).includes('12.00'), true,
      'El valor del gráfico también está disponible como texto.');
    await page.locator('#reportType').selectOption('bajoStock');
    await page.locator('#reportForm button[type="submit"]').click();
    await page.locator('#reportResult').getByText('No hay datos para mostrar.').waitFor();
    assert.strictEqual(await page.locator('#reportChartPanel').isVisible(), false,
      'Un reporte vacío no conserva el gráfico anterior.');
    await page.locator('#reportType').selectOption('fiados');
    await page.locator('#reportForm button[type="submit"]').click();
    await page.locator('#reportResult table').waitFor();
    assert.strictEqual(await page.locator('#reportResult th').allTextContents().then((labels) => labels.join('|')),
      'Cliente|Inicio|Vencimiento|Fiado (Bs)|Pagado (Bs)|Saldo pendiente (Bs)|Estado',
      'El reporte de fiados oculta identificadores y campos internos.');
    await page.locator('[data-view="finanzas"]').click();
    await page.locator('#financeSalesChart').waitFor();
    assert.strictEqual(await page.locator('#financeSalesChart').getAttribute('role'), 'img');
    assert.strictEqual(await page.locator('#financeMethodsChart').getAttribute('role'), 'img');
    assert.strictEqual(await page.locator('#financeMethodsChart').evaluate((canvas) => canvas.style.height), '196px');
    assert.strictEqual(await page.locator('#financeMethodsChart').evaluate((canvas) => {
      const rect = canvas.getBoundingClientRect();
      canvas.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, pointerType: 'touch', clientX: rect.left + rect.width / 2 + 11, clientY: rect.top + 80
      }));
      return canvas.closest('.panel').querySelector('.chart-tooltip').classList.contains('show');
    }), true, 'Los valores del gráfico también se consultan con toque.');
    assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), true, `Overflow a ${viewport.width}px.`);
    assert.deepStrictEqual(errors, [], `Consola limpia a ${viewport.width}x${viewport.height}.`);
  } finally {
    await context.close();
  }
}

async function verifyLimitedInventory(browser, baseUrl, plan) {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-test-plan': plan } });
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/app.html`);
    const family = page.locator('[data-navigation-family="inventario"]');
    if (!await family.evaluate((node) => node.open)) await family.locator('> summary').click();
    await page.locator('[data-view="inventarioInteligente"]').click();
    await page.locator('#inventorySimpleTitle').waitFor();
    assert.strictEqual((await page.locator('#inventoryContent').textContent()).includes('Se está agotando'), true);
    await page.locator('[data-inventory-level="avanzado"]').click();
    await page.locator('#inventorySummaryTitle').waitFor();
    if (plan === 'basic') await page.locator('#inventoryContent').getByText('Valor a costo conocido').first().waitFor();
    assert.strictEqual((await page.locator('#inventoryContent').textContent()).includes('Valor a costo conocido'), plan === 'basic',
      'La valoración se muestra solo cuando la función está incluida.');
    assert.strictEqual(await page.locator('[data-inventory-tab="rotacion"]').count(), 0,
      'Las funciones de reposición no aparecen en planes sin ese permiso.');
  } finally {
    await context.close();
  }
}

async function main() {
  if (!edge) throw new Error('No se encontro Edge local para PRODUCTO-1 P4.');
  const requests = [];
  const server = serverFor(requests);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    for (const viewport of [{ width: 360, height: 800 }, { width: 768, height: 1024 }, { width: 1366, height: 768 }]) await verifyViewport(browser, baseUrl, viewport);
    await verifyLimitedInventory(browser, baseUrl, 'basic');
    await verifyLimitedInventory(browser, baseUrl, 'minimal');
    assert.strictEqual(requests.some((request) => request.plan === 'basic' && request.path === '/api/inventario-inteligente/valoracion'), true,
      'Basic conserva la valoración que sí incluye su contrato actual.');
    assert.strictEqual(requests.some((request) => request.plan === 'minimal' && request.path === '/api/inventario-inteligente/valoracion'), false,
      'El resumen esencial no debe solicitar la valoración restringida.');
    const searches = requests.filter((request) => request.path === '/api/pos/clientes');
    assert(searches.length >= 3, 'No se consulto el buscador POS.');
    assert(searches.every((request) => request.search.includes('page=1') && request.search.includes('limit=15') && !request.search.includes('idTienda')), 'Busqueda POS sin paginacion segura.');
    console.log('test:product-sales-clients-browser OK');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(`test:product-sales-clients-browser FAIL: ${error.message}`); process.exitCode = 1; });
