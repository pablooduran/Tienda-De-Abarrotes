const view = document.getElementById('view');
const title = document.getElementById('viewTitle');
const subtitle = document.getElementById('viewSubtitle');
const menu = document.getElementById('menu');
const message = document.getElementById('message');
const modalRoot = document.getElementById('modalRoot');

let state = { productos: [], clientes: [], proveedores: [], fiados: [], ventas: [], categorias: [] };

const sections = [
  ['inicio', 'Inicio', 'Resumen general del negocio'],
  ['productos', 'Productos', 'Catálogo, stock y presentaciones'],
  ['clientes', 'Clientes', 'Registro de clientes'],
  ['proveedores', 'Proveedores', 'Registro de proveedores'],
  ['ventas', 'Ventas', 'Venta pagada o fiada con buscador'],
  ['compras', 'Compras / stock', 'Abastecimiento por paquete o unidad'],
  ['historialVentas', 'Historial de ventas', 'Ventas realizadas y detalle'],
  ['pagos', 'Fiados / Pagos', 'Deudas, pagos parciales e historial'],
  ['reportes', 'Reportes', 'Consultas, filtros y ganancias']
];

function money(value) { return Number(value || 0).toFixed(2); }
function intValue(value) { return Number(value || 0).toFixed(0); }
function toUpperInput(value) { return String(value || '').toUpperCase(); }
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())} - ${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}
function showMessage(text, isError = false) {
  message.textContent = text || '';
  message.className = `message${isError ? ' error' : ''}`;
}
function stockBreakdown(product) {
  const total = Number(product?.stockUnidadesTotal ?? product?.stock ?? 0);
  const unitsPerPack = Math.max(1, Number(product?.unidadesPorPaquete || 1));
  const packs = Math.floor(total / unitsPerPack);
  const loose = total % unitsPerPack;
  return { total, packs, loose };
}
function stockLabel(product) {
  const data = stockBreakdown(product);
  if (Number(product?.unidadesPorPaquete || 1) > 1) {
    return `${data.packs} paquetes completos y ${data.loose} unidades sueltas (${data.total} unidades)`;
  }
  const unit = product?.unidadMedida === 'gramo' ? 'g' : product?.unidadMedida === 'mililitro' ? 'ml' : 'unidades';
  return `${data.total} ${unit}`;
}
function packageText(product) {
  if (!product) return '';
  return `${product.unidadesPorPaquete || 1} unidades por paquete`;
}
function statusBadge(status) {
  return `<span class="badge ${status || 'pagado'}">${escapeHtml(status || 'pagado')}</span>`;
}

function wireUppercase(scope = document) {
  scope.querySelectorAll('[data-uppercase]').forEach((input) => {
    input.addEventListener('input', () => { input.value = toUpperInput(input.value); });
  });
}
function validatePhoneValue(value) {
  return !value || /^\d+$/.test(String(value).trim());
}

function modal({ title: modalTitle, body, confirmText = 'Aceptar', cancelText = '', danger = false, wide = false, preserveOnConfirm = false, onOpen = null }) {
  return new Promise((resolve) => {
    modalRoot.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal ${wide ? 'modal-wide' : ''}">
          <h3>${escapeHtml(modalTitle)}</h3>
          <div class="modal-body">${body}</div>
          <div class="modal-actions">
            ${cancelText ? `<button type="button" class="secondary" data-modal-cancel>${escapeHtml(cancelText)}</button>` : ''}
            <button type="button" class="${danger ? 'danger' : ''}" data-modal-confirm>${escapeHtml(confirmText)}</button>
          </div>
        </div>
      </div>`;
    wireUppercase(modalRoot);
    if (typeof onOpen === 'function') onOpen(modalRoot);
    const close = (value) => {
      modalRoot.innerHTML = '';
      resolve(value);
    };
    modalRoot.querySelector('[data-modal-confirm]').addEventListener('click', () => {
      if (preserveOnConfirm) return resolve(true);
      close(true);
    });
    const cancel = modalRoot.querySelector('[data-modal-cancel]');
    if (cancel) cancel.addEventListener('click', () => close(false));
  });
}
function showError(text) { return modal({ title: 'No se pudo completar', body: `<p>${escapeHtml(text)}</p>`, confirmText: 'Entendido', danger: true }); }
function showSuccess(text) { return modal({ title: 'Listo', body: `<p>${escapeHtml(text)}</p>`, confirmText: 'Aceptar' }); }
function confirmAction(text, danger = false) { return modal({ title: 'Confirmar acción', body: `<p>${escapeHtml(text)}</p>`, confirmText: 'Confirmar', cancelText: 'Cancelar', danger }); }

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  if (response.status === 401) window.location.href = '/login.html';
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'No se pudo completar la operación.');
  return data;
}
function formData(form) { return Object.fromEntries(new FormData(form).entries()); }

sections.forEach(([id, label]) => {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.dataset.view = id;
  btn.addEventListener('click', () => loadView(id));
  menu.appendChild(btn);
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  if (!await confirmAction('¿Seguro que deseas cerrar sesión?')) return;
  await api('/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

async function refreshCatalogs() {
  const [productos, clientes, proveedores, fiados, ventas, categorias] = await Promise.all([
    api('/api/productos'),
    api('/api/clientes'),
    api('/api/proveedores'),
    api('/api/fiados'),
    api('/api/ventas'),
    api('/api/categorias')
  ]);
  state = { productos, clientes, proveedores, fiados, ventas, categorias };
}

function options(rows, id, label, empty = 'Seleccione', selected = '') {
  return `<option value="">${empty}</option>` + rows.map((row) => `<option value="${row[id]}" ${String(selected || '') === String(row[id]) ? 'selected' : ''}>${escapeHtml(row[label])}</option>`).join('');
}
function categoryOptions(value = '') {
  return state.categorias.map((cat) => `<option value="${cat}" ${value === cat ? 'selected' : ''}>${cat}</option>`).join('');
}

async function loadView(id) {
  showMessage('');
  document.querySelectorAll('#menu button').forEach((btn) => btn.classList.toggle('active', btn.dataset.view === id));
  const section = sections.find((item) => item[0] === id);
  title.textContent = section[1];
  subtitle.textContent = section[2];
  await refreshCatalogs();
  const handlers = { inicio, productos, clientes, proveedores, ventas, compras, historialVentas, pagos, reportes };
  await handlers[id]();
}

function drawChart(canvas, labels, values, color = '#286a59') {
  const ctx = canvas.getContext('2d');
  const width = canvas.width = canvas.clientWidth * devicePixelRatio;
  const height = canvas.height = 220 * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);
  ctx.clearRect(0, 0, width, height);
  const max = Math.max(...values.map(Number), 1);
  const barWidth = Math.max(18, (canvas.clientWidth - 50) / Math.max(values.length, 1) - 8);
  ctx.font = '12px Arial';
  ctx.fillStyle = '#6b7684';
  ctx.fillText('0', 8, 205);
  values.forEach((value, index) => {
    const x = 34 + index * (barWidth + 8);
    const h = (Number(value) / max) * 150;
    ctx.fillStyle = color;
    ctx.fillRect(x, 190 - h, barWidth, h);
    ctx.fillStyle = '#1d2733';
    ctx.fillText(String(Number(value).toFixed(0)), x, 182 - h);
    ctx.save();
    ctx.translate(x + 2, 210);
    ctx.rotate(-0.35);
    ctx.fillStyle = '#6b7684';
    ctx.fillText(String(labels[index] || '').slice(0, 12), 0, 0);
    ctx.restore();
  });
}

async function inicio() {
  const data = await api('/api/dashboard');
  const debtState = data.fiados || {
    pendiente: data.fiadosPendientes || data.fiadosActivos || 0,
    parcial: data.fiadosParciales || 0,
    pagado: data.fiadosPagados || 0
  };
  const days = Array.isArray(data.chartVentasDias) ? data.chartVentasDias : [];
  view.innerHTML = `
    <div class="cards">
      <div class="card">Ventas de hoy<strong>Bs ${money(data.ventasHoy)}</strong></div>
      <div class="card">Ventas de ayer<strong>Bs ${money(data.ventasAyer)}</strong></div>
      <div class="card">Mes actual<strong>Bs ${money(data.ventasMes)}</strong></div>
      <div class="card">Mes pasado<strong>Bs ${money(data.ventasMesPasado)}</strong></div>
      <div class="card">Ganancia hoy<strong>Bs ${money(data.gananciaHoy)}</strong></div>
      <div class="card">Ganancia mes<strong>Bs ${money(data.gananciaMes)}</strong></div>
      <div class="card">Bajo stock<strong>${data.bajoStock}</strong></div>
      <div class="card">Fiados activos<strong>${Number(debtState.pendiente || 0) + Number(debtState.parcial || 0)}</strong></div>
    </div>
    <div class="dashboard-grid">
      <div class="panel"><h3>Ventas hoy vs ayer</h3><canvas id="salesCompare"></canvas></div>
      <div class="panel"><h3>Mes actual vs mes pasado</h3><canvas id="monthCompare"></canvas></div>
      <div class="panel"><h3>Fiados por estado</h3><canvas id="debtsChart"></canvas></div>
      <div class="panel"><h3>Ventas últimos días</h3><canvas id="daysChart"></canvas></div>
    </div>`;
  drawChart(document.getElementById('salesCompare'), ['HOY', 'AYER'], [data.ventasHoy, data.ventasAyer], '#286a59');
  drawChart(document.getElementById('monthCompare'), ['MES ACTUAL', 'MES PASADO'], [data.ventasMes, data.ventasMesPasado], '#536471');
  drawChart(document.getElementById('debtsChart'), ['PENDIENTE', 'PARCIAL', 'PAGADO'], [debtState.pendiente || 0, debtState.parcial || 0, debtState.pagado || 0], '#b42318');
  drawChart(document.getElementById('daysChart'), days.map((r) => formatDate(r.dia).slice(8)), days.map((r) => r.total), '#18794e');
}

function renderCrud(type, rows, fields, idField) {
  const formHtml = (row = {}) => `
    <form class="grid" id="${type}Form" data-id="${row[idField] || ''}">
      ${fields.map((field) => `<label>${field.label}<input name="${field.name}" value="${escapeHtml(row[field.name] || '')}" ${field.upper ? 'data-uppercase' : ''} ${field.phone ? 'inputmode="numeric" pattern="[0-9]*"' : ''} ${field.required ? 'required' : ''}></label>`).join('')}
      <button type="submit">${row[idField] ? 'Actualizar' : 'Guardar'}</button>
    </form>`;
  view.innerHTML = `<div class="panel">${formHtml()}</div><div class="panel table-wrap"><table>
    <thead><tr>${fields.map((f) => `<th>${f.label}</th>`).join('')}<th>Acciones</th></tr></thead>
    <tbody>${rows.map((row) => `<tr>${fields.map((f) => `<td>${escapeHtml(row[f.name] || '')}</td>`).join('')}<td class="actions"><button class="small secondary" data-edit="${row[idField]}">Editar</button><button class="small danger" data-delete="${row[idField]}">Eliminar</button></td></tr>`).join('')}</tbody>
  </table></div>`;
  wireUppercase(view);
  view.querySelector(`#${type}Form`).addEventListener('submit', async (event) => saveCrud(event, type));
  view.querySelectorAll('[data-edit]').forEach((btn) => btn.addEventListener('click', () => {
    const row = rows.find((item) => String(item[idField]) === btn.dataset.edit);
    view.querySelector('.panel').innerHTML = formHtml(row);
    wireUppercase(view);
    view.querySelector(`#${type}Form`).addEventListener('submit', async (event) => saveCrud(event, type));
  }));
  view.querySelectorAll('[data-delete]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!await confirmAction('¿Deseas eliminar este registro?', true)) return;
    try {
      await api(`/api/${type}/${btn.dataset.delete}`, { method: 'DELETE' });
      await showSuccess('Registro eliminado.');
      loadView(type);
    } catch (error) { showError(error.message); }
  }));
}

async function saveCrud(event, type) {
  event.preventDefault();
  const form = event.target;
  const data = formData(form);
  if ('telefono' in data && !validatePhoneValue(data.telefono)) {
    await showError('El teléfono solo debe contener números.');
    return;
  }
  const id = form.dataset.id;
  try {
    await api(`/api/${type}${id ? `/${id}` : ''}`, { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) });
    await showSuccess('Registro guardado.');
    loadView(type);
  } catch (error) { showError(error.message); }
}

async function clientes() {
  renderCrud('clientes', state.clientes, [
    { name: 'nombre', label: 'Nombre', required: true, upper: true },
    { name: 'telefono', label: 'Teléfono', phone: true }
  ], 'idCliente');
}

async function proveedores() {
  renderCrud('proveedores', state.proveedores, [
    { name: 'nombre', label: 'Nombre', required: true, upper: true },
    { name: 'telefono', label: 'Teléfono', phone: true },
    { name: 'direccion', label: 'Dirección', upper: true }
  ], 'idProveedor');
}

function productForm(row = {}) {
  const checked = (value) => value ? 'checked' : '';
  const isPackagePurchase = Number(row.unidadesPorPaquete || 1) > 1 || row.permiteVentaPorPaquete;
  const packagePrice = Number(row.precioVenta || 0) * Number(row.unidadesPorPaquete || 1);
  return `
    <form class="grid product-form" id="productoForm" data-id="${row.idProducto || ''}">
      <input type="hidden" name="unidadMedida" value="${escapeHtml(row.unidadMedida || 'unidad')}">
      <input type="hidden" name="paquetesPorCaja" value="${row.paquetesPorCaja || 1}">
      <input type="hidden" name="stockUnidadesTotal" value="${row.stockUnidadesTotal ?? row.stock ?? 0}">
      <input type="hidden" name="ultimoPrecioCompra" value="${row.ultimoPrecioCompra || 0}">

      <div class="form-section wide">
        <h4>Datos principales</h4>
        <p class="hint">Registra lo que se ve en mostrador. El precio de compra se coloca después al registrar una compra.</p>
      </div>
      <label>Nombre del producto<input name="nombre" required data-uppercase value="${escapeHtml(row.nombre || '')}"></label>
      <label>Proveedor<select name="idProveedor">${options(state.proveedores, 'idProveedor', 'nombre', 'Sin proveedor', row.idProveedor)}</select></label>
      <label>Categoría<select name="categoria" required>${categoryOptions(row.categoria || 'OTROS')}</select></label>
      <label>Tipo de compra<select id="tipoCompraProducto">
        <option value="unidad" ${!isPackagePurchase ? 'selected' : ''}>Unidad</option>
        <option value="paquete" ${isPackagePurchase ? 'selected' : ''}>Paquete</option>
      </select></label>

      <div class="form-section wide">
        <h4>Precios y stock</h4>
      </div>
      <label id="unitsPerPackageField">Unidades por paquete<input name="unidadesPorPaquete" type="number" step="1" min="1" required value="${row.unidadesPorPaquete || 1}"></label>
      <label>Precio venta por unidad<input name="precioVenta" type="number" step="0.01" min="0" required value="${row.precioVenta || ''}"></label>
      <label id="packagePriceField">Precio venta por paquete<input id="precioVentaPaquete" type="number" step="0.01" min="0" value="${packagePrice ? money(packagePrice) : ''}"></label>
      <label>Stock mínimo<input name="stockMinimo" type="number" step="1" min="1" required value="${row.stockMinimo || 5}"></label>

      <div class="form-section wide">
        <h4>Venta permitida</h4>
        <p class="hint">La venta por unidad queda como opción principal. La venta por paquete aparece solo si el producto tiene varias unidades por paquete.</p>
      </div>
      <label class="check"><input name="permiteVentaPorUnidad" type="checkbox" ${checked(row.permiteVentaPorUnidad ?? true)}> Vender por unidad</label>
      <label class="check" id="salePackageField"><input name="permiteVentaPorPaquete" type="checkbox" ${checked(row.permiteVentaPorPaquete)}> Vender por paquete</label>
      <p class="hint wide">Los campos técnicos de stock se mantienen internamente para conservar la lógica actual.</p>
    </form>`;
}

function wireProductForm() {
  const form = document.getElementById('productoForm');
  if (!form) return;
  const type = form.querySelector('#tipoCompraProducto');
  const units = form.querySelector('[name="unidadesPorPaquete"]');
  const unitPrice = form.querySelector('[name="precioVenta"]');
  const packagePrice = form.querySelector('#precioVentaPaquete');
  const packageSale = form.querySelector('[name="permiteVentaPorPaquete"]');
  const toggle = () => {
    const isPackage = type.value === 'paquete';
    form.querySelector('#unitsPerPackageField').classList.toggle('is-hidden', !isPackage);
    form.querySelector('#packagePriceField').classList.toggle('is-hidden', !isPackage);
    form.querySelector('#salePackageField').classList.toggle('is-hidden', !isPackage);
    if (!isPackage) {
      units.value = 1;
      packagePrice.value = '';
      packageSale.checked = false;
    }
  };
  const syncPackagePrice = () => {
    if (type.value !== 'paquete') return;
    const value = Number(unitPrice.value || 0) * Number(units.value || 1);
    packagePrice.value = value ? money(value) : '';
  };
  const syncUnitPrice = () => {
    if (type.value !== 'paquete') return;
    const value = Number(packagePrice.value || 0) / Math.max(1, Number(units.value || 1));
    if (value) unitPrice.value = money(value);
  };
  type.addEventListener('change', () => { toggle(); syncPackagePrice(); });
  units.addEventListener('input', syncPackagePrice);
  unitPrice.addEventListener('input', syncPackagePrice);
  packagePrice.addEventListener('input', syncUnitPrice);
  toggle();
}

async function openProductModal(row = {}) {
  const isEdit = Boolean(row.idProducto);
  const ok = await modal({ title: isEdit ? 'Editar producto' : 'Añadir producto', body: productForm(row), confirmText: isEdit ? 'Actualizar' : 'Guardar', cancelText: 'Cancelar', wide: true, preserveOnConfirm: true, onOpen: wireProductForm });
  if (!ok) return;
  const form = document.getElementById('productoForm');
  const data = formData(form);
  data.permiteVentaPorPaquete = form.querySelector('[name="permiteVentaPorPaquete"]').checked;
  data.permiteVentaPorUnidad = form.querySelector('[name="permiteVentaPorUnidad"]').checked;
  if (!data.permiteVentaPorPaquete && !data.permiteVentaPorUnidad) return showError('El producto debe venderse por paquete o por unidad.');
  try {
    await api(`/api/productos${isEdit ? `/${row.idProducto}` : ''}`, { method: isEdit ? 'PUT' : 'POST', body: JSON.stringify(data) });
    modalRoot.innerHTML = '';
    await showSuccess('Producto guardado.');
    loadView('productos');
  } catch (error) { showError(error.message); }
}

function filterProductsLocal() {
  const q = toUpperInput(document.getElementById('productSearch')?.value || '');
  const categoria = document.getElementById('productCategory')?.value || '';
  const proveedor = document.getElementById('productProvider')?.value || '';
  const low = document.getElementById('productLowStock')?.checked;
  const sort = document.getElementById('productSort')?.value || '';
  let rows = state.productos.filter((p) => (!q || p.nombre.includes(q))
    && (!categoria || p.categoria === categoria)
    && (!proveedor || String(p.idProveedor || '') === proveedor)
    && (!low || p.bajoStock));
  if (sort === 'precio_desc') rows = rows.sort((a, b) => Number(b.precioVenta) - Number(a.precioVenta));
  if (sort === 'precio_asc') rows = rows.sort((a, b) => Number(a.precioVenta) - Number(b.precioVenta));
  renderProductTable(rows);
}

function renderProductTable(rows) {
  const target = document.getElementById('productTable');
  target.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Nombre</th><th>Proveedor</th><th>Categoría</th><th>Precio</th><th>Stock</th><th>Presentación</th><th>Estado</th><th>Acciones</th></tr></thead>
    <tbody>${rows.map((p) => `<tr class="${p.bajoStock ? 'low-stock' : ''}">
      <td>${escapeHtml(p.nombre)}</td><td>${escapeHtml(p.proveedor || 'SIN PROVEEDOR')}</td><td>${escapeHtml(p.categoria)}</td>
      <td>Bs ${money(p.precioVenta)}</td><td>${stockLabel(p)}</td><td>${packageText(p)}</td>
      <td>${p.bajoStock ? '<span class="badge pendiente">Bajo stock</span>' : '<span class="badge pagado">Normal</span>'}</td>
      <td class="actions"><button class="small secondary" data-edit="${p.idProducto}">Editar</button><button class="small danger" data-delete="${p.idProducto}">Eliminar</button></td>
    </tr>`).join('')}</tbody></table></div>`;
  target.querySelectorAll('[data-edit]').forEach((btn) => btn.addEventListener('click', () => openProductModal(state.productos.find((p) => String(p.idProducto) === btn.dataset.edit))));
  target.querySelectorAll('[data-delete]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!await confirmAction('¿Deseas eliminar este producto?', true)) return;
    try {
      await api(`/api/productos/${btn.dataset.delete}`, { method: 'DELETE' });
      await showSuccess('Producto eliminado.');
      loadView('productos');
    } catch (error) { showError(error.message); }
  }));
}

async function productos() {
  view.innerHTML = `
    <div class="panel toolbar">
      <button id="addProduct">Añadir producto</button>
      <label>Buscar<input id="productSearch" data-uppercase placeholder="Buscar producto"></label>
      <label>Categoría<select id="productCategory"><option value="">Todas</option>${categoryOptions()}</select></label>
      <label>Proveedor<select id="productProvider">${options(state.proveedores, 'idProveedor', 'nombre', 'Todos')}</select></label>
      <label class="check"><input id="productLowStock" type="checkbox"> Bajo stock</label>
      <label>Orden<select id="productSort"><option value="">Nombre</option><option value="precio_desc">Más caro</option><option value="precio_asc">Más barato</option></select></label>
    </div>
    <div class="panel" id="productTable"></div>`;
  wireUppercase(view);
  document.getElementById('addProduct').addEventListener('click', () => openProductModal());
  ['productSearch', 'productCategory', 'productProvider', 'productLowStock', 'productSort'].forEach((id) => {
    document.getElementById(id).addEventListener('input', filterProductsLocal);
    document.getElementById(id).addEventListener('change', filterProductsLocal);
  });
  renderProductTable(state.productos);
}

function autocompleteBox(kind) {
  return `
    <div class="autocomplete">
      <label>Buscar producto<input id="${kind}Search" data-uppercase placeholder="Escriba el producto"></label>
      <div id="${kind}Results" class="autocomplete-results"></div>
    </div>`;
}

function operationFilters(kind) {
  const q = toUpperInput(document.getElementById(`${kind}Search`)?.value || '');
  const category = document.getElementById(`${kind}Category`)?.value || '';
  const provider = document.getElementById(`${kind}Provider`)?.value || document.querySelector(`#${kind}Form [name="idProveedor"]`)?.value || '';
  const lowStock = document.getElementById(`${kind}LowStock`)?.checked || false;
  const showAll = kind === 'compras' ? document.getElementById('showAllProducts')?.checked : true;
  return { q, category, provider, lowStock, showAll };
}

function filteredOperationProducts(kind) {
  const filters = operationFilters(kind);
  return state.productos.filter((p) => {
    const byText = !filters.q || p.nombre.includes(filters.q);
    const byCategory = !filters.category || p.categoria === filters.category;
    const byProvider = !filters.provider || String(p.idProveedor || '') === filters.provider;
    const byLowStock = !filters.lowStock || p.bajoStock;
    const purchaseProvider = kind !== 'compras'
      || filters.showAll
      || (filters.provider ? String(p.idProveedor || '') === filters.provider : !p.idProveedor);
    return byText && byCategory && byLowStock && (kind === 'ventas' ? byProvider : purchaseProvider);
  }).slice(0, 24);
}

function renderAutocomplete(kind) {
  const rows = filteredOperationProducts(kind);
  const target = document.getElementById(`${kind}Results`);
  target.innerHTML = rows.length ? rows.map((p) => `<article class="product-result ${p.bajoStock ? 'is-low' : ''}">
    <div>
      <strong>${escapeHtml(p.nombre)}</strong>
      <span>${escapeHtml(p.categoria)} | ${escapeHtml(p.proveedor || 'SIN PROVEEDOR')}</span>
      <small>${stockLabel(p)}</small>
      <small>${kind === 'compras' ? `Última compra: Bs ${money(p.ultimoPrecioCompra)}` : `Precio: Bs ${money(p.precioVenta)}`}</small>
      <small>${packageText(p)}</small>
    </div>
    <button type="button" class="small" data-product="${p.idProducto}">AGREGAR</button>
  </article>`).join('') : '<p class="muted">Sin coincidencias.</p>';
  target.querySelectorAll('[data-product]').forEach((btn) => btn.addEventListener('click', () => addProductItem(kind, state.productos.find((p) => String(p.idProducto) === btn.dataset.product))));
}

function operationView(kind) {
  const isSale = kind === 'ventas';
  view.innerHTML = `
    <form id="${kind}Form" class="cart-layout">
      <section class="panel product-picker">
        <div class="form-grid compact-fields">
          ${isSale ? `
            <label>Proveedor<select id="${kind}Provider">${options(state.proveedores, 'idProveedor', 'nombre', 'Todos')}</select></label>
            <label>Categoría<select id="${kind}Category"><option value="">Todas</option>${categoryOptions()}</select></label>
            <label class="check"><input id="${kind}LowStock" type="checkbox"> Bajo stock</label>
          ` : `
            <label>Proveedor de la compra<select name="idProveedor" id="${kind}Provider">${options(state.proveedores, 'idProveedor', 'nombre', 'Sin proveedor')}</select></label>
            <label>Categoría<select id="${kind}Category"><option value="">Todas</option>${categoryOptions()}</select></label>
            <label class="check"><input id="showAllProducts" type="checkbox"> Mostrar otros proveedores</label>
          `}
        </div>
        ${isSale ? '' : '<p class="hint">El proveedor de la compra se usa para registrar el abastecimiento. Si queda en "Sin proveedor", se muestran productos sin proveedor asignado.</p>'}
        ${autocompleteBox(kind)}
      </section>
      <aside class="panel cart-panel">
        <div class="cart-head">
          <div>
            <h3>${isSale ? 'Carrito de venta' : 'Carrito de compra'}</h3>
            <p class="muted" id="cartCount">0 productos agregados</p>
          </div>
        </div>
        ${isSale ? `
          <div class="form-grid compact-fields">
            <label>Tipo de venta<select name="tipo"><option value="pagada">Venta pagada</option><option value="fiada">Venta fiada</option></select></label>
            <label>Cliente<select name="idCliente">${options(state.clientes, 'idCliente', 'nombre', 'Cliente ocasional')}</select></label>
          </div>
        ` : '<p class="hint">Agregue productos al carrito. Cada producto muestra su proveedor asociado para evitar confusiones.</p>'}
        <div id="items" class="cart-items"></div>
        <div id="cartWarnings" class="cart-warnings"></div>
        <div class="cart-total">
          <span>Total</span>
          <strong id="total">Bs 0.00</strong>
        </div>
        <button type="submit" class="wide-button">${isSale ? 'Registrar venta' : 'Registrar compra'}</button>
      </aside>
    </form>`;
  const search = document.getElementById(`${kind}Search`);
  wireUppercase(view);
  search.addEventListener('input', () => renderAutocomplete(kind));
  document.getElementById(`${kind}Category`).addEventListener('change', () => renderAutocomplete(kind));
  document.getElementById(`${kind}Provider`).addEventListener('change', () => renderAutocomplete(kind));
  const lowStockFilter = document.getElementById(`${kind}LowStock`);
  if (lowStockFilter) lowStockFilter.addEventListener('change', () => renderAutocomplete(kind));
  if (!isSale) {
    document.getElementById('showAllProducts').addEventListener('change', () => renderAutocomplete(kind));
  }
  document.getElementById(`${kind}Form`).addEventListener('submit', (event) => saveOperation(event, kind));
  renderAutocomplete(kind);
}

function addProductItem(kind, product) {
  if (!product) return;
  const existing = document.querySelector(`.cart-item[data-product="${product.idProducto}"]`);
  if (existing) {
    const qty = existing.querySelector('[name="cantidad"]');
    qty.value = Number(qty.value || 0) + 1;
    fillItemInfo(existing, kind);
    focusCartItem(existing);
    return;
  }
  const isPurchase = kind === 'compras';
  const saleOptions = [
    product.permiteVentaPorPaquete ? '<option value="paquete">Paquete</option>' : '',
    product.permiteVentaPorUnidad ? '<option value="unidad">Unidad</option>' : ''
  ].join('');
  const purchaseOptions = [
    '<option value="unidad">Unidad</option>',
    Number(product.unidadesPorPaquete || 1) > 1 ? '<option value="paquete">Paquete</option>' : ''
  ].join('');
  const row = document.createElement('div');
  row.className = 'cart-item';
  row.dataset.product = product.idProducto;
  row.innerHTML = `
    <div class="cart-item-title">
      <strong>${escapeHtml(product.nombre)}</strong>
      <span>${escapeHtml(product.categoria)} | ${escapeHtml(product.proveedor || 'Sin proveedor')} | ${stockLabel(product)}</span>
    </div>
    <div class="cart-item-controls">
      <label>Presentación<select name="presentacion">${isPurchase ? purchaseOptions : saleOptions}</select></label>
      <label>Cantidad<input name="cantidad" type="number" step="1" min="1" required value="1"></label>
      ${isPurchase ? '<label>Precio compra<input name="precioCompra" type="number" step="0.01" min="0" required></label>' : '<label>Precio<input name="precioVenta" readonly></label>'}
    </div>
    <div class="cart-item-footer">
      <span class="item-info muted"></span>
      <strong class="item-subtotal">Bs 0.00</strong>
      <button type="button" class="danger small">QUITAR</button>
    </div>`;
  row.querySelector('button').addEventListener('click', () => { row.remove(); calculateTotal(kind); });
  row.querySelectorAll('input, select').forEach((input) => input.addEventListener('input', () => fillItemInfo(row, kind)));
  document.getElementById('items').appendChild(row);
  fillItemInfo(row, kind);
  focusCartItem(row);
}

function focusCartItem(row) {
  if (window.matchMedia('(max-width: 900px)').matches) {
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function equivalentUnitsClient(product, qty, presentation, isPurchase) {
  if (isPurchase && presentation === 'caja') return qty * Number(product.paquetesPorCaja || 1) * Number(product.unidadesPorPaquete || 1);
  if (presentation === 'paquete') return qty * Number(product.unidadesPorPaquete || 1);
  return qty;
}

function fillItemInfo(row, kind) {
  const product = state.productos.find((p) => String(p.idProducto) === row.dataset.product);
  const qty = Number(row.querySelector('[name="cantidad"]').value || 0);
  const presentation = row.querySelector('[name="presentacion"]').value;
  const units = equivalentUnitsClient(product, qty, presentation, kind === 'compras');
  const unitPrice = kind === 'compras'
    ? Number(row.querySelector('[name="precioCompra"]')?.value || 0)
    : Number(product.precioVenta || 0) * (presentation === 'paquete' ? Number(product.unidadesPorPaquete || 1) : 1);
  const subtotal = qty * unitPrice;
  if (kind === 'ventas') row.querySelector('[name="precioVenta"]').value = money(unitPrice);
  const stockWarning = kind === 'ventas' && units > Number(product.stockUnidadesTotal || 0);
  row.classList.toggle('has-warning', stockWarning);
  row.querySelector('.item-info').textContent = stockWarning
    ? `Stock insuficiente: requiere ${units}, disponible ${product.stockUnidadesTotal}`
    : `${units} unidades equivalentes`;
  row.querySelector('.item-subtotal').textContent = `Bs ${money(subtotal)}`;
  calculateTotal(kind);
}

function collectItems(kind) {
  return [...document.querySelectorAll('.cart-item')].map((row) => {
    const item = {
      idProducto: row.dataset.product,
      cantidad: row.querySelector('[name="cantidad"]').value,
      presentacion: row.querySelector('[name="presentacion"]').value
    };
    if (kind === 'compras') item.precioCompra = row.querySelector('[name="precioCompra"]').value;
    return item;
  });
}

function calculateTotal(kind) {
  const rows = [...document.querySelectorAll('.cart-item')];
  const total = rows.reduce((sum, row) => {
    const product = state.productos.find((p) => String(p.idProducto) === row.dataset.product);
    const qty = Number(row.querySelector('[name="cantidad"]').value || 0);
    const presentation = row.querySelector('[name="presentacion"]').value;
    const price = kind === 'compras' ? Number(row.querySelector('[name="precioCompra"]')?.value || 0) : Number(product.precioVenta || 0) * (presentation === 'paquete' ? Number(product.unidadesPorPaquete || 1) : 1);
    return sum + qty * price;
  }, 0);
  const invalidRows = rows.filter((row) => row.classList.contains('has-warning'));
  document.getElementById('cartCount').textContent = `${rows.length} producto${rows.length === 1 ? '' : 's'} agregado${rows.length === 1 ? '' : 's'}`;
  document.getElementById('cartWarnings').innerHTML = invalidRows.length ? '<p class="text-danger">Hay productos con stock insuficiente.</p>' : '';
  document.getElementById('total').textContent = `Bs ${money(total)}`;
}

async function saveOperation(event, kind) {
  event.preventDefault();
  const form = event.target;
  const body = formData(form);
  body.items = collectItems(kind);
  if (body.items.length === 0) return showError('Debe agregar al menos un producto.');
  const invalidItem = body.items.some((item) => Number(item.cantidad) <= 0 || (kind === 'compras' && Number(item.precioCompra) <= 0));
  if (invalidItem) return showError('Revise cantidades y precios. Deben ser mayores a cero.');
  if ([...document.querySelectorAll('.cart-item.has-warning')].length) return showError('Hay productos con stock insuficiente. Ajuste cantidades antes de registrar.');
  if (body.tipo === 'fiada' && !body.idCliente) return showError('Una venta fiada debe tener cliente registrado.');
  const label = kind === 'ventas' ? (body.tipo === 'fiada' ? 'venta fiada' : 'venta pagada') : 'compra';
  if (!await confirmAction(`¿Deseas registrar esta ${label}?`)) return;
  try {
    await api(`/api/${kind}`, { method: 'POST', body: JSON.stringify(body) });
    await showSuccess('Operación registrada.');
    loadView(kind);
  } catch (error) { showError(error.message); }
}

async function ventas() { operationView('ventas'); }
async function compras() { operationView('compras'); }

async function historialVentas() {
  view.innerHTML = `<div class="panel table-wrap"><table>
    <thead><tr><th>Fecha</th><th>Cliente</th><th>Tipo</th><th>Total</th><th>Estado</th><th>Acciones</th></tr></thead>
    <tbody>${state.ventas.map((v) => `<tr><td>${formatDate(v.fecha)}</td><td>${escapeHtml(v.cliente)}</td><td>${v.tipo === 'fiada' ? 'FIADA' : 'PAGADA'}</td><td>Bs ${money(v.total)}</td><td>${v.tipo === 'fiada' ? statusBadge(v.estadoFiado) : statusBadge('pagado')}</td><td><button class="small secondary" data-detail="${v.idVenta}">Detalle</button></td></tr>`).join('')}</tbody>
  </table></div>`;
  view.querySelectorAll('[data-detail]').forEach((btn) => btn.addEventListener('click', () => showSaleDetail(btn.dataset.detail)));
}

async function showSaleDetail(idVenta) {
  try {
    const data = await api(`/api/ventas/${idVenta}`);
    const v = data.venta;
    await modal({ title: `Venta #${v.idVenta}`, wide: true, confirmText: 'Cerrar', body: `
      <p>${formatDate(v.fecha)} - ${escapeHtml(v.cliente)} - Bs ${money(v.total)}</p>
      ${v.tipo === 'fiada' ? `<p>Saldo: <strong class="${Number(v.saldoPendiente) > 0 ? 'text-danger' : 'text-ok'}">Bs ${money(v.saldoPendiente)}</strong> ${statusBadge(v.estadoFiado)}</p>` : ''}
      <div class="table-wrap"><table><thead><tr><th>Producto</th><th>Cantidad</th><th>Presentación</th><th>Unidades</th><th>Precio</th><th>Costo</th><th>Ganancia</th></tr></thead>
      <tbody>${data.detalle.map((d) => `<tr><td>${escapeHtml(d.nombre)}</td><td>${intValue(d.cantidad)}</td><td>${escapeHtml(d.presentacionVenta)}</td><td>${intValue(d.cantidadEquivalenteUnidades)}</td><td>Bs ${money(d.subtotal)}</td><td>Bs ${money(d.subtotalCosto)}</td><td>Bs ${money(d.ganancia)}</td></tr>`).join('')}</tbody></table></div>` });
  } catch (error) { showError(error.message); }
}

async function pagos() {
  view.innerHTML = `
    <div class="panel">
      <form class="grid" id="pagoForm">
        <label>Fiado activo<select name="idFiado" required>${state.fiados.filter((f) => f.estado !== 'pagado').map((f) => `<option value="${f.idFiado}">${escapeHtml(f.cliente)} - saldo Bs ${money(f.saldoPendiente)}</option>`).join('')}</select></label>
        <label>Monto<input name="monto" type="number" step="0.01" min="0.01" required></label>
        <label>Observación<input name="observacion" data-uppercase></label>
        <button type="submit">Registrar pago</button>
      </form>
    </div>
    <div class="panel filter-bar">
      <label>Cliente<select id="debtClient">${options(state.clientes, 'idCliente', 'nombre', 'TODOS')}</select></label>
      <label>Estado<select id="debtStatus"><option value="">TODOS</option><option value="pendiente">PENDIENTE</option><option value="parcial">PARCIAL</option><option value="pagado">PAGADO</option></select></label>
      <label>Desde<input id="debtFrom" type="date"></label>
      <label>Hasta<input id="debtTo" type="date"></label>
    </div>
    <div class="panel table-wrap" id="debtTable"></div>`;
  wireUppercase(view);
  document.getElementById('pagoForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!await confirmAction('¿Deseas registrar este pago de fiado?')) return;
    try {
      await api('/api/pagos-fiado', { method: 'POST', body: JSON.stringify(formData(event.target)) });
      await showSuccess('Pago registrado.');
      loadView('pagos');
    } catch (error) { showError(error.message); }
  });
  ['debtClient', 'debtStatus', 'debtFrom', 'debtTo'].forEach((id) => document.getElementById(id).addEventListener('change', loadDebtFilters));
  renderDebtTable(state.fiados);
}

async function loadDebtFilters() {
  const query = new URLSearchParams({
    idCliente: document.getElementById('debtClient').value,
    estado: document.getElementById('debtStatus').value,
    desde: document.getElementById('debtFrom').value,
    hasta: document.getElementById('debtTo').value
  });
  const rows = await api(`/api/fiados?${query.toString()}`);
  renderDebtTable(rows);
}

function renderDebtTable(rows) {
  const target = document.getElementById('debtTable');
  target.innerHTML = `<table><thead><tr><th>Cliente</th><th>Fecha</th><th>Total</th><th>Pagado</th><th>Saldo</th><th>Estado</th><th>Historial</th></tr></thead>
    <tbody>${rows.map((f) => `<tr><td>${escapeHtml(f.cliente)}</td><td>${formatDate(f.fechaVenta || f.fechaInicio)}</td><td>Bs ${money(f.totalFiado)}</td><td>Bs ${money(f.totalPagado)}</td><td class="${Number(f.saldoPendiente) > 0 ? 'text-danger' : 'text-ok'}">Bs ${money(f.saldoPendiente)}</td><td>${statusBadge(f.estado)}</td><td><button class="small secondary" data-fiado="${f.idFiado}">Ver</button></td></tr>`).join('')}</tbody></table>`;
  target.querySelectorAll('[data-fiado]').forEach((btn) => btn.addEventListener('click', () => showDebtDetail(btn.dataset.fiado)));
}

async function showDebtDetail(idFiado) {
  try {
    const data = await api(`/api/fiados/${idFiado}`);
    const f = data.fiado;
    await modal({ title: `Fiado de ${f.cliente}`, wide: true, confirmText: 'Cerrar', body: `
      <p>Total: Bs ${money(f.totalFiado)} | Pagado: Bs ${money(f.totalPagado)} | Saldo: Bs ${money(f.saldoPendiente)} | ${statusBadge(f.estado)}</p>
      <h4>Productos</h4><div class="table-wrap"><table><thead><tr><th>Producto</th><th>Cantidad</th><th>Presentación</th><th>Subtotal</th></tr></thead>
      <tbody>${data.detalle.map((d) => `<tr><td>${escapeHtml(d.nombre)}</td><td>${intValue(d.cantidad)}</td><td>${escapeHtml(d.presentacionVenta || 'unidad')}</td><td>Bs ${money(d.subtotal)}</td></tr>`).join('') || '<tr><td colspan="4">Sin detalle disponible</td></tr>'}</tbody></table></div>
      <h4>Pagos</h4><div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Monto</th><th>Observación</th></tr></thead>
      <tbody>${data.pagos.map((p) => `<tr><td>${formatDate(p.fechaPago)}</td><td>Bs ${money(p.monto)}</td><td>${escapeHtml(p.observacion || '')}</td></tr>`).join('') || '<tr><td colspan="3">Sin pagos registrados</td></tr>'}</tbody></table></div>` });
  } catch (error) { showError(error.message); }
}

function reportFilters(type) {
  const dateRange = '<label>Desde<input name="desde" type="date"></label><label>Hasta<input name="hasta" type="date"></label>';
  if (type === 'ventasRango') return dateRange;
  if (type === 'comprasProveedor') return `<label>Proveedor<select name="idProveedor">${options(state.proveedores, 'idProveedor', 'nombre', 'TODOS')}</select></label>${dateRange}`;
  if (type === 'fiados') return `<label>Cliente<select name="idCliente">${options(state.clientes, 'idCliente', 'nombre', 'TODOS')}</select></label><label>Estado<select name="estado"><option value="">TODOS</option><option value="pendiente">PENDIENTE</option><option value="parcial">PARCIAL</option><option value="pagado">PAGADO</option></select></label>${dateRange}`;
  if (type === 'ganancias') return `<label>Periodo<select name="periodo"><option value="dia">Día</option><option value="semana">Semana</option><option value="mes">Mes</option><option value="anio">Año</option><option value="rango">Rango</option></select></label>${dateRange}`;
  return '';
}

async function reportes() {
  view.innerHTML = `
    <div class="panel">
      <form class="grid" id="reportForm">
        <label>Reporte<select name="tipo" id="reportType">
          <option value="ventasDia">Ventas del día</option>
          <option value="ventasRango">Ventas por rango</option>
          <option value="bajoStock">Productos con bajo stock</option>
          <option value="masVendidos">Productos más vendidos</option>
          <option value="fiados">Fiados</option>
          <option value="pagosFiado">Historial de pagos</option>
          <option value="compras">Compras realizadas</option>
          <option value="comprasProveedor">Compras por proveedor</option>
          <option value="ganancias">Ganancias</option>
        </select></label>
        <span id="dynamicFilters" class="filter-inline"></span>
        <button type="submit">Consultar</button>
      </form>
    </div>
    <div class="panel"><canvas id="reportChart"></canvas></div>
    <div class="panel" id="reportResult"><p class="muted">Seleccione un reporte para consultar.</p></div>`;
  const type = document.getElementById('reportType');
  const updateFilters = () => { document.getElementById('dynamicFilters').innerHTML = reportFilters(type.value); };
  type.addEventListener('change', updateFilters);
  updateFilters();
  document.getElementById('reportForm').addEventListener('submit', loadReport);
}

async function loadReport(event) {
  event.preventDefault();
  const data = formData(event.target);
  const query = new URLSearchParams(data);
  try {
    const result = await api(`/api/reportes/${data.tipo}?${query.toString()}`);
    const rows = result.rows || [];
    const keys = rows[0] ? Object.keys(rows[0]) : [];
    if (result.chart && rows.length) drawChart(document.getElementById('reportChart'), result.chart.labels.map(formatDate), result.chart.values, '#286a59');
    document.getElementById('reportResult').innerHTML = rows.length ? `
      ${result.summary ? `<div class="summary-row"><strong>Vendido: Bs ${money(result.summary.totalVendido)}</strong><strong>Costo: Bs ${money(result.summary.totalCosto)}</strong><strong>Ganancia: Bs ${money(result.summary.gananciaNeta)}</strong></div>` : ''}
      <div class="table-wrap"><table><thead><tr>${keys.map((key) => `<th>${escapeHtml(key)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((row) => `<tr>${keys.map((key) => `<td>${key.toLowerCase().includes('fecha') ? formatDate(row[key]) : escapeHtml(row[key] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class="muted">No hay datos para mostrar.</p>';
  } catch (error) { showError(error.message); }
}

loadView('inicio').catch((error) => showError(error.message));
