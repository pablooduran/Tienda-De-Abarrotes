const view = document.getElementById('view');
const title = document.getElementById('viewTitle');
const subtitle = document.getElementById('viewSubtitle');
const menu = document.getElementById('menu');
const message = document.getElementById('message');

let state = { productos: [], clientes: [], proveedores: [], fiados: [] };

const sections = [
  ['inicio', 'Inicio', 'Resumen general del negocio'],
  ['productos', 'Productos', 'Control de stock, precios y unidades'],
  ['clientes', 'Clientes', 'Registro de clientes'],
  ['proveedores', 'Proveedores', 'Registro de proveedores'],
  ['ventas', 'Ventas', 'Registrar ventas y descontar stock'],
  ['compras', 'Compras', 'Registrar compras y aumentar stock'],
  ['fiado', 'Fiado', 'Registrar productos fiados por cliente'],
  ['pagos', 'Pagos de Fiado', 'Abonos parciales o totales'],
  ['reportes', 'Reportes', 'Consultas basicas del negocio']
];

function money(value) { return Number(value || 0).toFixed(2); }
function showMessage(text, isError = false) {
  message.textContent = text || '';
  message.className = `message${isError ? ' error' : ''}`;
}
async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  if (response.status === 401) window.location.href = '/login.html';
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'No se pudo completar la operacion.');
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
  await api('/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

async function refreshCatalogs() {
  const [productos, clientes, proveedores, fiados] = await Promise.all([
    api('/api/productos'),
    api('/api/clientes'),
    api('/api/proveedores'),
    api('/api/fiados/activos')
  ]);
  state = { productos, clientes, proveedores, fiados };
}

function options(rows, id, label, empty = 'Seleccione') {
  return `<option value="">${empty}</option>` + rows.map((row) => `<option value="${row[id]}">${row[label]}</option>`).join('');
}

function productOptions() {
  return options(state.productos, 'idProducto', 'nombre', 'Producto');
}

async function loadView(id) {
  showMessage('');
  document.querySelectorAll('#menu button').forEach((btn) => btn.classList.toggle('active', btn.dataset.view === id));
  const section = sections.find((item) => item[0] === id);
  title.textContent = section[1];
  subtitle.textContent = section[2];
  await refreshCatalogs();
  const handlers = { inicio, productos, clientes, proveedores, ventas, compras, fiado, pagos, reportes };
  await handlers[id]();
}

async function inicio() {
  const data = await api('/api/dashboard');
  view.innerHTML = `
    <div class="cards">
      <div class="card">Ventas de hoy<strong>Bs ${money(data.ventasHoy)}</strong></div>
      <div class="card">Productos con bajo stock<strong>${data.bajoStock}</strong></div>
      <div class="card">Fiados activos<strong>${data.fiadosActivos}</strong></div>
      <div class="card">Productos registrados<strong>${data.productos}</strong></div>
    </div>`;
}

function renderCrud(type, rows, fields, idField) {
  const isEdit = (row) => row ? 'Actualizar' : 'Guardar';
  const formHtml = (row = {}) => `
    <form class="grid" id="${type}Form" data-id="${row[idField] || ''}">
      ${fields.map((field) => `<label>${field.label}<input name="${field.name}" value="${row[field.name] || ''}" ${field.required ? 'required' : ''}></label>`).join('')}
      <button type="submit">${isEdit(row[idField] ? row : null)}</button>
    </form>`;
  const table = `
    <div class="table-wrap"><table>
      <thead><tr>${fields.map((f) => `<th>${f.label}</th>`).join('')}<th>Acciones</th></tr></thead>
      <tbody>${rows.map((row) => `
        <tr>
          ${fields.map((f) => `<td>${row[f.name] || ''}</td>`).join('')}
          <td class="actions">
            <button class="small secondary" data-edit="${row[idField]}">Editar</button>
            <button class="small danger" data-delete="${row[idField]}">Eliminar</button>
          </td>
        </tr>`).join('')}</tbody>
    </table></div>`;
  view.innerHTML = `<div class="panel">${formHtml()}</div><div class="panel">${table}</div>`;

  view.querySelector(`#${type}Form`).addEventListener('submit', async (event) => saveCrud(event, type));
  view.querySelectorAll('[data-edit]').forEach((btn) => btn.addEventListener('click', () => {
    const row = rows.find((item) => String(item[idField]) === btn.dataset.edit);
    view.querySelector('.panel').innerHTML = formHtml(row);
    view.querySelector(`#${type}Form`).addEventListener('submit', async (event) => saveCrud(event, type));
  }));
  view.querySelectorAll('[data-delete]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('Desea eliminar este registro?')) return;
    try {
      await api(`/api/${type}/${btn.dataset.delete}`, { method: 'DELETE' });
      showMessage('Registro eliminado.');
      loadView(type);
    } catch (error) { showMessage(error.message, true); }
  }));
}

async function saveCrud(event, type) {
  event.preventDefault();
  const form = event.target;
  const id = form.dataset.id;
  try {
    await api(`/api/${type}${id ? `/${id}` : ''}`, {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(formData(form))
    });
    showMessage('Registro guardado.');
    loadView(type);
  } catch (error) { showMessage(error.message, true); }
}

async function clientes() {
  renderCrud('clientes', state.clientes, [
    { name: 'nombre', label: 'Nombre', required: true },
    { name: 'telefono', label: 'Telefono' }
  ], 'idCliente');
}

async function proveedores() {
  renderCrud('proveedores', state.proveedores, [
    { name: 'nombre', label: 'Nombre', required: true },
    { name: 'telefono', label: 'Telefono' },
    { name: 'direccion', label: 'Direccion' }
  ], 'idProveedor');
}

async function productos() {
  const unitOptions = ['unidad','paquete','kilo','gramo','litro','mililitro','caja','docena','bolsa'];
  const formHtml = (row = {}) => `
    <form class="grid" id="productoForm" data-id="${row.idProducto || ''}">
      <label>Nombre<input name="nombre" required value="${row.nombre || ''}"></label>
      <label>Unidad<select name="unidadMedida" required>${unitOptions.map((u) => `<option ${row.unidadMedida === u ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
      <label>Precio venta<input name="precioVenta" type="number" step="0.01" min="0" required value="${row.precioVenta || ''}"></label>
      <label>Stock<input name="stock" type="number" step="0.01" min="0" value="${row.stock || 0}"></label>
      <label>Stock minimo<input name="stockMinimo" type="number" step="0.01" min="0" required value="${row.stockMinimo || 5}"></label>
      <button type="submit">${row.idProducto ? 'Actualizar' : 'Guardar'}</button>
    </form>`;
  view.innerHTML = `
    <div class="panel">${formHtml()}</div>
    <div class="panel table-wrap"><table>
      <thead><tr><th>Nombre</th><th>Unidad</th><th>Precio</th><th>Stock</th><th>Stock minimo</th><th>Estado</th><th>Acciones</th></tr></thead>
      <tbody>${state.productos.map((p) => `
        <tr class="${p.bajoStock ? 'low-stock' : ''}">
          <td>${p.nombre}</td><td>${p.unidadMedida}</td><td>Bs ${money(p.precioVenta)}</td>
          <td>${Number(p.stock)} ${p.unidadMedida}</td><td>${Number(p.stockMinimo)} ${p.unidadMedida}</td>
          <td>${p.bajoStock ? 'Bajo stock' : 'Normal'}</td>
          <td class="actions"><button class="small secondary" data-edit="${p.idProducto}">Editar</button><button class="small danger" data-delete="${p.idProducto}">Eliminar</button></td>
        </tr>`).join('')}</tbody>
    </table></div>`;
  view.querySelector('#productoForm').addEventListener('submit', saveProduct);
  view.querySelectorAll('[data-edit]').forEach((btn) => btn.addEventListener('click', () => {
    const row = state.productos.find((p) => String(p.idProducto) === btn.dataset.edit);
    view.querySelector('.panel').innerHTML = formHtml(row);
    view.querySelector('#productoForm').addEventListener('submit', saveProduct);
  }));
  view.querySelectorAll('[data-delete]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('Desea eliminar este producto?')) return;
    try {
      await api(`/api/productos/${btn.dataset.delete}`, { method: 'DELETE' });
      showMessage('Producto eliminado.');
      loadView('productos');
    } catch (error) { showMessage(error.message, true); }
  }));
}

async function saveProduct(event) {
  event.preventDefault();
  const form = event.target;
  const id = form.dataset.id;
  try {
    await api(`/api/productos${id ? `/${id}` : ''}`, { method: id ? 'PUT' : 'POST', body: JSON.stringify(formData(form)) });
    showMessage('Producto guardado.');
    loadView('productos');
  } catch (error) { showMessage(error.message, true); }
}

function operationView(kind) {
  const isSale = kind === 'ventas';
  const isFiado = kind === 'fiado';
  view.innerHTML = `
    <div class="panel">
      <form id="${kind}Form">
        <div class="form-grid">
          ${isSale ? `<label>Cliente opcional<select name="idCliente">${options(state.clientes, 'idCliente', 'nombre', 'Cliente ocasional')}</select></label>` : ''}
          ${isFiado ? `<label>Cliente<select name="idCliente" required>${options(state.clientes, 'idCliente', 'nombre')}</select></label>` : ''}
          ${kind === 'compras' ? `<label>Proveedor<select name="idProveedor">${options(state.proveedores, 'idProveedor', 'nombre', 'Sin proveedor')}</select></label>` : ''}
        </div>
        <h3>Productos</h3>
        <div id="items" class="items"></div>
        <p>Total: <strong id="total">Bs 0.00</strong></p>
        <button type="button" id="addItem">Agregar producto</button>
        <button type="submit">Guardar</button>
      </form>
    </div>`;
  document.getElementById('addItem').addEventListener('click', () => addItem(kind));
  document.getElementById(`${kind}Form`).addEventListener('submit', (event) => saveOperation(event, kind));
  addItem(kind);
}

function addItem(kind) {
  const priceField = kind === 'compras'
    ? '<label>Precio compra<input name="precioCompra" type="number" step="0.01" min="0" required></label>'
    : '<label>Precio<input name="precioVenta" readonly></label>';
  const row = document.createElement('div');
  row.className = 'item-row';
  row.innerHTML = `
    <label>Producto<select name="idProducto" required>${productOptions()}</select></label>
    <label>Cantidad<input name="cantidad" type="number" step="0.01" min="0.01" required></label>
    ${priceField}
    <button type="button" class="danger small">Quitar</button>`;
  row.querySelector('button').addEventListener('click', () => { row.remove(); calculateTotal(kind); });
  row.querySelector('select').addEventListener('change', () => fillPrice(row, kind));
  row.querySelectorAll('input').forEach((input) => input.addEventListener('input', () => calculateTotal(kind)));
  document.getElementById('items').appendChild(row);
}

function fillPrice(row, kind) {
  if (kind === 'compras') return;
  const product = state.productos.find((p) => String(p.idProducto) === row.querySelector('select').value);
  row.querySelector('[name="precioVenta"]').value = product ? money(product.precioVenta) : '';
  calculateTotal(kind);
}

function collectItems(kind) {
  return [...document.querySelectorAll('.item-row')].map((row) => {
    const item = {
      idProducto: row.querySelector('[name="idProducto"]').value,
      cantidad: row.querySelector('[name="cantidad"]').value
    };
    if (kind === 'compras') item.precioCompra = row.querySelector('[name="precioCompra"]').value;
    return item;
  });
}

function calculateTotal(kind) {
  const total = [...document.querySelectorAll('.item-row')].reduce((sum, row) => {
    const qty = Number(row.querySelector('[name="cantidad"]').value || 0);
    const product = state.productos.find((p) => String(p.idProducto) === row.querySelector('select').value);
    const price = kind === 'compras' ? Number(row.querySelector('[name="precioCompra"]').value || 0) : Number(product?.precioVenta || 0);
    return sum + qty * price;
  }, 0);
  document.getElementById('total').textContent = `Bs ${money(total)}`;
}

async function saveOperation(event, kind) {
  event.preventDefault();
  const form = event.target;
  const body = formData(form);
  body.items = collectItems(kind);
  try {
    await api(`/api/${kind === 'fiado' ? 'fiados' : kind}`, { method: 'POST', body: JSON.stringify(body) });
    showMessage('Operacion registrada.');
    loadView(kind);
  } catch (error) { showMessage(error.message, true); }
}

async function ventas() { operationView('ventas'); }
async function compras() { operationView('compras'); }
async function fiado() { operationView('fiado'); }

async function pagos() {
  view.innerHTML = `
    <div class="panel">
      <form class="grid" id="pagoForm">
        <label>Fiado<select name="idFiado" required>${state.fiados.map((f) => `<option value="${f.idFiado}">${f.cliente} - saldo Bs ${money(f.saldoPendiente)}</option>`).join('')}</select></label>
        <label>Monto<input name="monto" type="number" step="0.01" min="0.01" required></label>
        <label>Observacion<input name="observacion"></label>
        <button type="submit">Registrar pago</button>
      </form>
    </div>
    <div class="panel table-wrap"><table>
      <thead><tr><th>Cliente</th><th>Total</th><th>Pagado</th><th>Saldo</th><th>Estado</th></tr></thead>
      <tbody>${state.fiados.map((f) => `<tr><td>${f.cliente}</td><td>Bs ${money(f.totalFiado)}</td><td>Bs ${money(f.totalPagado)}</td><td>Bs ${money(f.saldoPendiente)}</td><td>${f.estado}</td></tr>`).join('')}</tbody>
    </table></div>`;
  document.getElementById('pagoForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api('/api/pagos-fiado', { method: 'POST', body: JSON.stringify(formData(event.target)) });
      showMessage('Pago registrado.');
      loadView('pagos');
    } catch (error) { showMessage(error.message, true); }
  });
}

async function reportes() {
  view.innerHTML = `
    <div class="panel">
      <form class="grid" id="reportForm">
        <label>Reporte<select name="tipo">
          <option value="ventasDia">Ventas del dia</option>
          <option value="ventasRango">Ventas por rango</option>
          <option value="bajoStock">Productos con bajo stock</option>
          <option value="masVendidos">Productos mas vendidos</option>
          <option value="fiadosPendientes">Fiados pendientes</option>
          <option value="fiadosParciales">Fiados parcialmente pagados</option>
          <option value="pagosFiado">Historial de pagos</option>
          <option value="compras">Compras realizadas</option>
          <option value="comprasProveedor">Compras por proveedor</option>
        </select></label>
        <label>Desde<input name="desde" type="date"></label>
        <label>Hasta<input name="hasta" type="date"></label>
        <label>Proveedor<select name="idProveedor">${options(state.proveedores, 'idProveedor', 'nombre', 'Todos')}</select></label>
        <button type="submit">Consultar</button>
      </form>
    </div>
    <div class="panel" id="reportResult"></div>`;
  document.getElementById('reportForm').addEventListener('submit', loadReport);
}

async function loadReport(event) {
  event.preventDefault();
  const data = formData(event.target);
  const query = new URLSearchParams(data);
  try {
    const rows = await api(`/api/reportes/${data.tipo}?${query.toString()}`);
    const keys = rows[0] ? Object.keys(rows[0]) : [];
    document.getElementById('reportResult').innerHTML = rows.length ? `
      <div class="table-wrap"><table>
        <thead><tr>${keys.map((key) => `<th>${key}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((row) => `<tr>${keys.map((key) => `<td>${row[key] ?? ''}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>` : '<p class="muted">No hay datos para mostrar.</p>';
  } catch (error) { showMessage(error.message, true); }
}

loadView('inicio').catch((error) => showMessage(error.message, true));
