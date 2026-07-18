const view = document.getElementById('view');
const title = document.getElementById('viewTitle');
const subtitle = document.getElementById('viewSubtitle');
const menu = document.getElementById('menu');
const message = document.getElementById('message');
const modalRoot = document.getElementById('modalRoot');

let state = { productos: [], clientes: [], proveedores: [], fiados: [], ventas: [], categorias: [], context: null };
let debtFocus = null;
let posCart = [];
let posOperationKey = null;
let posSearchTimer = null;
let lastBarcodeScan = { value: '', at: 0 };

const sections = [
  ['inicio', 'Inicio', 'Resumen general del negocio'],
  ['productos', 'Productos', 'Catálogo, stock y presentaciones'],
  ['movimientosStock', 'Movimientos de stock', 'Entradas, salidas y ajustes del inventario'],
  ['clientes', 'Clientes', 'Registro de clientes'],
  ['proveedores', 'Proveedores', 'Registro de proveedores'],
  ['ventas', 'Punto de venta', 'Cobro rápido, pagos mixtos y comprobantes'],
  ['compras', 'Compras / stock', 'Abastecimiento por paquete o unidad'],
  ['historialVentas', 'Historial de ventas', 'Ventas realizadas y detalle'],
  ['pagos', 'Fiados / Pagos', 'Deudas, pagos parciales e historial'],
  ['reportes', 'Reportes', 'Consultas, filtros y ganancias']
];

function money(value) { return Number(value || 0).toFixed(2); }
function intValue(value) { return Number(value || 0).toFixed(0); }
function newOperationKey() {
  return window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function normalizeSearch(value) { return String(value || '').trim().toLocaleLowerCase(); }
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

function wireUppercase() {}
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

function requestAdminPassword(actionText) {
  return new Promise((resolve) => {
    modalRoot.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal">
          <h3>Confirmar eliminación segura</h3>
          <div class="modal-body">
            <p>${escapeHtml(actionText)}</p>
            <p class="delete-warning">Esta acción no borrará el historial. El registro dejará de aparecer en las listas principales.</p>
            <label class="password-confirm">Contraseña del administrador<input type="password" id="adminDeletePassword" autocomplete="current-password"></label>
          </div>
          <div class="modal-actions">
            <button type="button" class="secondary" data-modal-cancel>Cancelar</button>
            <button type="button" class="danger" data-modal-confirm>Eliminar</button>
          </div>
        </div>
      </div>`;
    const input = modalRoot.querySelector('#adminDeletePassword');
    input.focus();
    const close = (value) => {
      modalRoot.innerHTML = '';
      resolve(value);
    };
    modalRoot.querySelector('[data-modal-cancel]').addEventListener('click', () => close(null));
    modalRoot.querySelector('[data-modal-confirm]').addEventListener('click', () => {
      const password = input.value.trim();
      if (!password) {
        input.classList.add('input-error');
        input.focus();
        return;
      }
      close(password);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        modalRoot.querySelector('[data-modal-confirm]').click();
      }
    });
  });
}

async function api(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  if (url.startsWith('/api/')
    && state.context?.soloLectura
    && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    throw new Error('La suscripción está en modo de solo lectura. Puedes consultar los datos, pero no realizar cambios.');
  }
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

function renderSubscriptionContext() {
  const context = state.context;
  if (!context) return;
  document.getElementById('storeName').textContent = context.tienda?.nombre || 'Mi tienda';
  const summary = document.getElementById('subscriptionSummary');
  const banner = document.getElementById('subscriptionBanner');
  const planName = context.plan?.nombre || 'Sin plan';
  const expiration = context.suscripcion?.fechaFin ? formatDate(context.suscripcion.fechaFin) : 'Sin fecha';
  summary.textContent = `${planName} · vence ${expiration}`;
  summary.hidden = false;

  if (context.soloLectura) {
    const status = context.suscripcion?.estadoEfectivo || 'sin suscripción';
    banner.innerHTML = `<strong>Cuenta en modo de solo lectura.</strong> Estado de suscripción: ${escapeHtml(status)}. Puedes consultar tus datos, pero las operaciones y cambios están temporalmente deshabilitados.`;
    banner.className = 'subscription-banner subscription-blocked';
    banner.hidden = false;
    document.body.classList.add('subscription-readonly');
  } else if (context.suscripcion?.diasRestantes !== null && context.suscripcion.diasRestantes <= 7) {
    banner.innerHTML = `<strong>Tu suscripción vence pronto.</strong> Quedan ${context.suscripcion.diasRestantes} días. Vencimiento: ${escapeHtml(expiration)}.`;
    banner.className = 'subscription-banner subscription-warning';
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
}

function applyReadOnlyUi() {
  if (!state.context?.soloLectura) return;
  const selectors = [
    '#view form:not(#reportForm) button[type="submit"]',
    '#modalRoot form button[type="submit"]',
    '#addProduct',
    '#addFromCatalog',
    '[data-edit]',
    '[data-delete]',
    '[data-adjust-stock]',
    '[data-restore-product]',
    '[data-restore-client]',
    '[data-restore-debt]',
    '[data-delete-fiado]',
    '[data-product]',
    '[data-pos-favorite]',
    '#payClientTotal'
  ];
  document.querySelectorAll(selectors.join(',')).forEach((control) => {
    if (!control.disabled) {
      control.disabled = true;
      control.title = 'Acción deshabilitada mientras la cuenta está en modo de solo lectura.';
    }
  });
}

async function loadContext() {
  state.context = await api('/api/contexto');
  renderSubscriptionContext();
}

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
  state = { ...state, productos, clientes, proveedores, fiados, ventas, categorias };
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
  const handlers = { inicio, productos, movimientosStock, clientes, proveedores, ventas, compras, historialVentas, pagos, reportes };
  await handlers[id]();
  applyReadOnlyUi();
}

function chartTooltip(canvas) {
  const panel = canvas.closest('.panel') || canvas.parentElement;
  if (!panel) return null;
  panel.style.position = panel.style.position || 'relative';
  let tooltip = panel.querySelector('.chart-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'chart-tooltip';
    panel.appendChild(tooltip);
  }
  return tooltip;
}

function bindChartTooltip(canvas, hitAreas) {
  const tooltip = chartTooltip(canvas);
  if (!tooltip) return;
  canvas.onmousemove = (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const hit = hitAreas.find((area) => {
      if (area.type === 'circle') {
        const dx = x - area.x;
        const dy = y - area.y;
        return Math.sqrt(dx * dx + dy * dy) <= area.r;
      }
      return x >= area.x && x <= area.x + area.w && y >= area.y && y <= area.y + area.h;
    });
    if (!hit) {
      tooltip.classList.remove('show');
      return;
    }
    tooltip.innerHTML = hit.text;
    tooltip.style.left = `${Math.min(x + 14, rect.width - 130)}px`;
    tooltip.style.top = `${Math.max(10, y - 34)}px`;
    tooltip.classList.add('show');
  };
  canvas.onmouseleave = () => tooltip.classList.remove('show');
}

function drawChart(canvas, labels, values, color = '#286a59', tooltips = []) {
  const ctx = canvas.getContext('2d');
  const ratio = devicePixelRatio || 1;
  const displayWidth = canvas.clientWidth || 320;
  canvas.width = displayWidth * ratio;
  canvas.height = 240 * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, displayWidth, 240);
  const max = Math.max(...values.map(Number), 1);
  const chartHeight = 150;
  const bottom = 190;
  const left = 34;
  const gap = 10;
  const barWidth = Math.max(18, (displayWidth - 58) / Math.max(values.length, 1) - gap);
  const hitAreas = [];
  ctx.font = '12px "Segoe UI", Arial';
  ctx.fillStyle = '#6b7684';
  ctx.fillText('0', 8, bottom + 5);
  values.forEach((value, index) => {
    const x = left + index * (barWidth + gap);
    const h = (Number(value) / max) * chartHeight;
    const y = bottom - h;
    ctx.fillStyle = color;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, barWidth, h || 2, 6);
    } else {
      ctx.rect(x, y, barWidth, h || 2);
    }
    ctx.fill();
    ctx.fillStyle = '#1d2733';
    ctx.fillText(String(Number(value).toFixed(0)), x, Math.max(18, y - 8));
    ctx.save();
    ctx.translate(x + 2, 216);
    ctx.rotate(-0.35);
    ctx.fillStyle = '#6b7684';
    ctx.fillText(String(labels[index] || '').slice(0, 12), 0, 0);
    ctx.restore();
    hitAreas.push({
      x,
      y: Math.min(y, bottom - 2),
      w: barWidth,
      h: Math.max(h, 10),
      text: tooltips[index] || `<strong>${escapeHtml(labels[index] || '')}</strong><br>Bs ${money(value)}`
    });
  });
  bindChartTooltip(canvas, hitAreas);
}

function drawPieChart(canvas, labels, values, colors, tooltips = []) {
  const ctx = canvas.getContext('2d');
  const ratio = devicePixelRatio || 1;
  const displayWidth = canvas.clientWidth || 320;
  canvas.width = displayWidth * ratio;
  canvas.height = 240 * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, displayWidth, 240);
  const total = values.reduce((sum, value) => sum + Number(value || 0), 0);
  const cx = Math.min(116, displayWidth * 0.38);
  const cy = 112;
  const radius = 78;
  const hitAreas = [];
  if (!total) {
    ctx.fillStyle = '#e9eef1';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6b7684';
    ctx.font = '13px "Segoe UI", Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Sin ventas', cx, cy + 4);
    ctx.textAlign = 'left';
  } else {
    let start = -Math.PI / 2;
    values.forEach((value, index) => {
      const slice = (Number(value || 0) / total) * Math.PI * 2;
      const end = start + slice;
      ctx.fillStyle = colors[index % colors.length];
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, start, end);
      ctx.closePath();
      ctx.fill();
      const mid = start + slice / 2;
      hitAreas.push({
        type: 'circle',
        x: cx + Math.cos(mid) * (radius * 0.55),
        y: cy + Math.sin(mid) * (radius * 0.55),
        r: Math.max(18, radius * Math.max(0.2, slice / (Math.PI * 2))),
        text: tooltips[index] || `<strong>${escapeHtml(labels[index] || '')}</strong><br>Bs ${money(value)}`
      });
      start = end;
    });
  }
  const legendX = Math.min(displayWidth - 150, cx + radius + 28);
  ctx.font = '12px "Segoe UI", Arial';
  labels.forEach((label, index) => {
    const y = 42 + index * 28;
    ctx.fillStyle = colors[index % colors.length];
    ctx.fillRect(legendX, y, 10, 10);
    ctx.fillStyle = '#1d2733';
    ctx.fillText(String(label).slice(0, 16), legendX + 16, y + 9);
  });
  bindChartTooltip(canvas, hitAreas);
}

function dateKey(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dateOffsetKey(offset) {
  const date = new Date();
  date.setDate(date.getDate() - offset);
  return dateKey(date);
}

function dayLabel(offset) {
  if (offset === 0) return 'Hoy';
  if (offset === 1) return 'Ayer';
  if (offset === 2) return 'Anteayer';
  return `Hace ${offset} días`;
}

function buildSalesDays(rows) {
  const map = new Map(rows.map((row) => [dateKey(row.dia), Number(row.total || 0)]));
  return [4, 3, 2, 1, 0].map((offset) => ({
    label: dayLabel(offset),
    key: dateOffsetKey(offset),
    total: map.get(dateOffsetKey(offset)) || 0
  }));
}

async function inicioLegacy() {
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

async function inicio() {
  const data = await api('/api/dashboard');
  const debtState = data.fiados || {
    pendiente: data.fiadosPendientes || data.fiadosActivos || 0,
    parcial: data.fiadosParciales || 0,
    pagado: data.fiadosPagados || 0
  };
  const days = Array.isArray(data.chartVentasDias) ? data.chartVentasDias : [];
  const salesDays = buildSalesDays(days);
  const dayLabels = salesDays.map((day) => day.label);
  const dayValues = salesDays.map((day) => day.total);
  const dayTooltips = salesDays.map((day) => `<strong>${escapeHtml(day.label)}</strong><br>${escapeHtml(day.key)}<br>Ventas: Bs ${money(day.total)}`);
  const activeDebts = Number(debtState.pendiente || 0) + Number(debtState.parcial || 0);

  view.innerHTML = `
    <div class="dashboard-hero">
      <div>
        <span class="eyebrow">Resumen de ventas</span>
        <h3>Movimiento del negocio</h3>
        <p>Comparación visual con datos reales de ventas registradas.</p>
      </div>
      <div class="hero-total">
        <span>Ventas de hoy</span>
        <strong>Bs ${money(data.ventasHoy)}</strong>
      </div>
    </div>
    <div class="cards dashboard-cards">
      <div class="card metric-card"><span>Ventas de ayer</span><strong>Bs ${money(data.ventasAyer)}</strong></div>
      <div class="card metric-card"><span>Semana actual</span><strong>Bs ${money(data.ventasSemana)}</strong></div>
      <div class="card metric-card"><span>Mes actual</span><strong>Bs ${money(data.ventasMes)}</strong></div>
      <div class="card metric-card"><span>Ganancia hoy</span><strong>Bs ${money(data.gananciaHoy)}</strong></div>
      <div class="card metric-card"><span>Bajo stock</span><strong>${data.bajoStock}</strong></div>
      <div class="card metric-card"><span>Fiados activos</span><strong>${activeDebts}</strong></div>
    </div>
    <div class="dashboard-grid modern-dashboard">
      <div class="panel chart-panel chart-panel-wide">
        <div class="panel-title"><div><h3>Ventas de los últimos 5 días</h3><p class="muted">Hoy, ayer y los 3 días anteriores.</p></div></div>
        <canvas id="dailyBars"></canvas>
      </div>
      <div class="panel chart-panel">
        <div class="panel-title"><div><h3>Proporción por día</h3><p class="muted">Participación de cada día en el total.</p></div></div>
        <canvas id="dailyPie"></canvas>
      </div>
      <div class="panel chart-panel">
        <div class="panel-title"><div><h3>Comparativa semanal</h3><p class="muted">Semana actual frente a la anterior.</p></div></div>
        <canvas id="weekCompare"></canvas>
      </div>
      <div class="panel chart-panel">
        <div class="panel-title"><div><h3>Comparativa mensual</h3><p class="muted">Mes actual frente al mes pasado.</p></div></div>
        <canvas id="monthCompare"></canvas>
      </div>
    </div>`;

  drawChart(document.getElementById('dailyBars'), dayLabels, dayValues, '#286a59', dayTooltips);
  drawPieChart(document.getElementById('dailyPie'), dayLabels, dayValues, ['#286a59', '#5f9f8c', '#8a6500', '#b42318', '#536471'], dayTooltips);
  drawChart(document.getElementById('weekCompare'), ['Semana pasada', 'Semana actual'], [data.ventasSemanaPasada, data.ventasSemana], '#536471', [
    `<strong>Semana pasada</strong><br>Ventas: Bs ${money(data.ventasSemanaPasada)}`,
    `<strong>Semana actual</strong><br>Ventas: Bs ${money(data.ventasSemana)}`
  ]);
  drawChart(document.getElementById('monthCompare'), ['Mes pasado', 'Mes actual'], [data.ventasMesPasado, data.ventasMes], '#18794e', [
    `<strong>Mes pasado</strong><br>Ventas: Bs ${money(data.ventasMesPasado)}`,
    `<strong>Mes actual</strong><br>Ventas: Bs ${money(data.ventasMes)}`
  ]);
}

function renderCrud(type, rows, fields, idField) {
  const hiddenButton = type === 'clientes'
    ? '<div class="safe-delete-tools"><button type="button" class="secondary small" id="showHiddenClients">Ver clientes ocultos</button></div>'
    : '';
  const formHtml = (row = {}) => `
    <form class="grid" id="${type}Form" data-id="${row[idField] || ''}">
      ${fields.map((field) => `<label>${field.label}<input name="${field.name}" value="${escapeHtml(row[field.name] || '')}" ${field.phone ? 'inputmode="numeric" pattern="[0-9]*"' : ''} ${field.required ? 'required' : ''}></label>`).join('')}
      <button type="submit">${row[idField] ? 'Actualizar' : 'Guardar'}</button>
    </form>`;
  view.innerHTML = `<div class="panel">${formHtml()}${hiddenButton}</div><div class="panel table-wrap"><table>
    <thead><tr>${fields.map((f) => `<th>${f.label}</th>`).join('')}<th>Acciones</th></tr></thead>
    <tbody>${rows.map((row) => `<tr>${fields.map((f) => `<td>${escapeHtml(row[f.name] || '')}</td>`).join('')}<td class="actions"><button class="small secondary" data-edit="${row[idField]}">Editar</button><button class="small danger" data-delete="${row[idField]}">Eliminar</button></td></tr>`).join('')}</tbody>
  </table></div>`;
  wireUppercase(view);
  if (type === 'clientes') document.getElementById('showHiddenClients').addEventListener('click', showHiddenClients);
  view.querySelector(`#${type}Form`).addEventListener('submit', async (event) => saveCrud(event, type));
  view.querySelectorAll('[data-edit]').forEach((btn) => btn.addEventListener('click', () => {
    const row = rows.find((item) => String(item[idField]) === btn.dataset.edit);
    view.querySelector('.panel').innerHTML = formHtml(row);
    wireUppercase(view);
    view.querySelector(`#${type}Form`).addEventListener('submit', async (event) => saveCrud(event, type));
  }));
  view.querySelectorAll('[data-delete]').forEach((btn) => btn.addEventListener('click', async () => {
    let requestOptions = { method: 'DELETE' };
    if (type === 'clientes') {
      const row = rows.find((item) => String(item[idField]) === btn.dataset.delete);
      const password = await requestAdminPassword(`¿Deseas ocultar el cliente ${row?.nombre || ''}?`);
      if (!password) return;
      requestOptions = {
        method: 'DELETE',
        body: JSON.stringify({ passwordAdministrador: password })
      };
    } else if (!await confirmAction('¿Deseas eliminar este registro?', true)) {
      return;
    }
    try {
      await api(`/api/${type}/${btn.dataset.delete}`, requestOptions);
      await showSuccess(type === 'clientes' ? 'Cliente ocultado. El historial se conserva.' : 'Registro eliminado.');
      loadView(type);
    } catch (error) { showError(error.message); }
  }));
}

async function showHiddenClients() {
  try {
    const rows = await api('/api/clientes/ocultos');
    modalRoot.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal modal-wide">
          <h3>Clientes ocultos</h3>
          <div class="modal-body">
            ${rows.length ? `<div class="hidden-record-list">${rows.map((client) => `
              <article class="hidden-record">
                <div>
                  <strong>${escapeHtml(client.nombre)}</strong>
                  <p class="muted">Oculto${client.eliminadoEn ? `: ${formatDate(client.eliminadoEn)}` : ''}</p>
                  <p class="hint">Teléfono: ${escapeHtml(client.telefono || 'Sin teléfono')}</p>
                </div>
                <button type="button" class="small secondary" data-restore-client="${client.idCliente}">Restaurar</button>
              </article>`).join('')}</div>` : '<p class="muted empty-state">No hay clientes ocultos.</p>'}
          </div>
          <div class="modal-actions">
            <button type="button" class="secondary" data-modal-cancel>Cerrar</button>
          </div>
        </div>
      </div>`;
    modalRoot.querySelector('[data-modal-cancel]').addEventListener('click', () => { modalRoot.innerHTML = ''; });
    modalRoot.querySelectorAll('[data-restore-client]').forEach((btn) => btn.addEventListener('click', async () => {
      const client = rows.find((item) => String(item.idCliente) === btn.dataset.restoreClient);
      const password = await requestAdminPassword(`¿Deseas restaurar el cliente ${client?.nombre || ''}?`);
      if (!password) return showHiddenClients();
      try {
        await api(`/api/clientes/${btn.dataset.restoreClient}/restaurar`, {
          method: 'PATCH',
          body: JSON.stringify({ passwordAdministrador: password })
        });
        await refreshCatalogs();
        await showSuccess('Cliente restaurado.');
        loadView('clientes');
      } catch (error) { showError(error.message); }
    }));
  } catch (error) { showError(error.message); }
}

async function showHiddenDebts() {
  try {
    const rows = await api('/api/fiados/ocultos');
    modalRoot.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal modal-wide">
          <h3>Fiados ocultos</h3>
          <div class="modal-body">
            ${rows.length ? `<div class="hidden-record-list">${rows.map((debt) => `
              <article class="hidden-record">
                <div>
                  <strong>${escapeHtml(debt.cliente)} · Fiado #${debt.idFiado}</strong>
                  <p class="muted">Oculto${debt.eliminadoEn ? `: ${formatDate(debt.eliminadoEn)}` : ''}</p>
                  <p class="hint">Total: Bs ${money(debt.totalFiado)} · Pagado: Bs ${money(debt.totalPagado)} · Saldo: Bs ${money(debt.saldoPendiente)} · ${debt.estado}</p>
                </div>
                <button type="button" class="small secondary" data-restore-debt="${debt.idFiado}">Restaurar</button>
              </article>`).join('')}</div>` : '<p class="muted empty-state">No hay fiados ocultos.</p>'}
          </div>
          <div class="modal-actions">
            <button type="button" class="secondary" data-modal-cancel>Cerrar</button>
          </div>
        </div>
      </div>`;
    modalRoot.querySelector('[data-modal-cancel]').addEventListener('click', () => { modalRoot.innerHTML = ''; });
    modalRoot.querySelectorAll('[data-restore-debt]').forEach((btn) => btn.addEventListener('click', async () => {
      const debt = rows.find((item) => String(item.idFiado) === btn.dataset.restoreDebt);
      const password = await requestAdminPassword(`¿Deseas restaurar el fiado #${debt?.idFiado || ''} de ${debt?.cliente || ''}?`);
      if (!password) return showHiddenDebts();
      try {
        await api(`/api/fiados/${btn.dataset.restoreDebt}/restaurar`, {
          method: 'PATCH',
          body: JSON.stringify({ passwordAdministrador: password })
        });
        await refreshCatalogs();
        await showSuccess('Fiado restaurado.');
        await pagos();
      } catch (error) { showError(error.message); }
    }));
  } catch (error) { showError(error.message); }
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
  const isEdit = Boolean(row.idProducto);
  const checked = (value) => value ? 'checked' : '';
  const isPackagePurchase = Number(row.unidadesPorPaquete || 1) > 1 || row.permiteVentaPorPaquete;
  const packagePrice = row.precioVentaPaquete ?? (Number(row.precioVenta || 0) * Number(row.unidadesPorPaquete || 1));
  return `
    <form class="grid product-form" id="productoForm" data-id="${row.idProducto || ''}">
      <input type="hidden" name="unidadMedida" value="${escapeHtml(row.unidadMedida || 'unidad')}">
      <input type="hidden" name="paquetesPorCaja" value="${row.paquetesPorCaja || 1}">

      <div class="form-section wide">
        <h4>Datos principales</h4>
        <p class="hint">Registra lo que se ve en mostrador. El precio de compra se coloca después al registrar una compra.</p>
      </div>
      <label>Nombre del producto<input name="nombre" required value="${escapeHtml(row.nombre || '')}"></label>
      <label>Código de barras (opcional)<input name="codigoBarras" maxlength="64" value="${escapeHtml(row.codigoBarras || '')}"></label>
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
      <label>Precio venta por unidad<input name="precioVenta" type="number" step="0.01" min="0.01" required value="${row.precioVenta || ''}"></label>
      <label id="packagePriceField">Precio venta por paquete<input name="precioVentaPaquete" id="precioVentaPaquete" data-price-mode="${row.precioVentaPaquete == null ? 'auto' : 'manual'}" type="number" step="0.01" min="0.01" value="${packagePrice ? money(packagePrice) : ''}"></label>
      <label>Stock mínimo<input name="stockMinimo" type="number" step="1" min="1" required value="${row.stockMinimo || 5}"></label>
      ${isEdit
        ? `<label>Stock actual<input type="number" readonly value="${Number(row.stockUnidadesTotal ?? row.stock ?? 0)}"></label>`
        : '<label>Stock inicial<input name="stockUnidadesTotal" type="number" step="1" min="0" required value="0"></label>'}

      <div class="form-section wide">
        <h4>Venta permitida</h4>
        <p class="hint">La venta por unidad queda como opción principal. La venta por paquete aparece solo si el producto tiene varias unidades por paquete.</p>
      </div>
      <label class="check"><input name="permiteVentaPorUnidad" type="checkbox" ${checked(row.permiteVentaPorUnidad ?? true)}> Vender por unidad</label>
      <label class="check" id="salePackageField"><input name="permiteVentaPorPaquete" type="checkbox" ${checked(row.permiteVentaPorPaquete)}> Vender por paquete</label>
      <p class="hint wide">Después de crear el producto, el stock solo cambia mediante compras, ventas o un ajuste manual.</p>
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
  let autoPackagePrice = packagePrice.dataset.priceMode === 'auto';
  const toggle = () => {
    const isPackage = type.value === 'paquete';
    form.querySelector('#unitsPerPackageField').classList.toggle('is-hidden', !isPackage);
    form.querySelector('#packagePriceField').classList.toggle('is-hidden', !isPackage);
    form.querySelector('#salePackageField').classList.toggle('is-hidden', !isPackage);
    if (!isPackage) {
      units.value = 1;
      packagePrice.value = '';
      packageSale.checked = false;
      autoPackagePrice = true;
    }
  };
  const syncPackagePrice = () => {
    if (type.value !== 'paquete' || !autoPackagePrice) return;
    const value = Number(unitPrice.value || 0) * Number(units.value || 1);
    packagePrice.value = value ? money(value) : '';
  };
  type.addEventListener('change', () => {
    toggle();
    if (type.value === 'paquete' && !packagePrice.value) autoPackagePrice = true;
    syncPackagePrice();
  });
  units.addEventListener('input', syncPackagePrice);
  unitPrice.addEventListener('input', syncPackagePrice);
  packagePrice.addEventListener('input', () => { autoPackagePrice = false; });
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

function suggestedLocalCategory(masterCategory) {
  const normalized = String(masterCategory || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  return state.categorias.includes(normalized) ? normalized : 'OTROS';
}

async function openMasterCatalogPicker() {
  const picker = { page: 1, pages: 1, rows: [], categories: [], brands: [], selected: new Map() };
  modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal modal-wide catalog-picker-modal">
        <h3>Agregar desde catálogo</h3>
        <div class="modal-body catalog-picker-layout">
          <section class="catalog-browser">
            <div class="catalog-picker-filters">
              <label>Buscar<input id="catalogPickerSearch" type="search" placeholder="Nombre, marca o código"></label>
              <label>Categoría<select id="catalogPickerCategory"><option value="">Todas</option></select></label>
              <label>Marca<select id="catalogPickerBrand"><option value="">Todas</option></select></label>
            </div>
            <div id="catalogPickerResults" class="catalog-picker-results"></div>
            <div class="catalog-picker-pagination"><button type="button" class="secondary" id="catalogPickerPrevious">Anterior</button><span id="catalogPickerPage">Página 1</span><button type="button" class="secondary" id="catalogPickerNext">Siguiente</button></div>
          </section>
          <section class="catalog-selection">
            <div class="panel-title"><div><h4>Productos seleccionados</h4><p class="hint">Completa precio, stock y organización local.</p></div><strong id="catalogSelectedCount">0</strong></div>
            <div id="catalogSelectedProducts" class="catalog-selected-products"><p class="muted">Todavía no seleccionaste productos.</p></div>
          </section>
          <p id="catalogPickerError" class="text-danger wide" hidden></p>
        </div>
        <div class="modal-actions"><button type="button" class="secondary" data-modal-cancel>Cancelar</button><button type="button" id="catalogAddSelected">Agregar al inventario</button></div>
      </div>
    </div>`;
  const root = modalRoot;
  const search = root.querySelector('#catalogPickerSearch');
  const category = root.querySelector('#catalogPickerCategory');
  const brand = root.querySelector('#catalogPickerBrand');
  const results = root.querySelector('#catalogPickerResults');
  const selectedTarget = root.querySelector('#catalogSelectedProducts');
  const pickerError = root.querySelector('#catalogPickerError');
  const showPickerError = (text = '') => {
    pickerError.textContent = text;
    pickerError.hidden = !text;
  };

  const captureSelectedConfiguration = () => {
    selectedTarget.querySelectorAll('[data-master-config]').forEach((card) => {
      const product = picker.selected.get(Number(card.dataset.masterConfig));
      if (!product) return;
      product.localConfig = {
        nombreLocal: card.querySelector('[name="nombreLocal"]').value,
        categoriaLocal: card.querySelector('[name="categoriaLocal"]').value,
        idProveedor: card.querySelector('[name="idProveedor"]').value,
        precioCompra: card.querySelector('[name="precioCompra"]').value,
        precioVenta: card.querySelector('[name="precioVenta"]').value,
        stockInicial: card.querySelector('[name="stockInicial"]').value,
        stockMinimo: card.querySelector('[name="stockMinimo"]').value,
        unidadesPorPaquete: card.querySelector('[name="unidadesPorPaquete"]').value,
        permiteVentaPorUnidad: card.querySelector('[name="permiteVentaPorUnidad"]').checked,
        permiteVentaPorPaquete: card.querySelector('[name="permiteVentaPorPaquete"]').checked
      };
    });
  };

  const renderSelected = () => {
    captureSelectedConfiguration();
    root.querySelector('#catalogSelectedCount').textContent = String(picker.selected.size);
    if (!picker.selected.size) {
      selectedTarget.innerHTML = '<p class="muted">Todavía no seleccionaste productos.</p>';
      return;
    }
    selectedTarget.innerHTML = [...picker.selected.values()].map((product) => {
      const config = product.localConfig || {
        nombreLocal: product.nombre,
        categoriaLocal: suggestedLocalCategory(product.categoriaMaestra),
        idProveedor: '',
        precioCompra: '0',
        precioVenta: '',
        stockInicial: '0',
        stockMinimo: '5',
        unidadesPorPaquete: String(Number(product.unidadesPorPaquete || 1)),
        permiteVentaPorUnidad: Boolean(product.permiteVentaPorUnidad),
        permiteVentaPorPaquete: Boolean(product.permiteVentaPorPaquete)
      };
      return `
      <article class="catalog-selected-item" data-master-config="${product.idProductoMaestro}">
        <div class="catalog-selected-heading"><div><strong>${escapeHtml(product.nombre)}</strong><span>${escapeHtml(product.marca || 'Sin marca')} · ${escapeHtml(product.presentacion || 'Sin presentación')}</span></div><button type="button" class="small danger" data-remove-master="${product.idProductoMaestro}">Quitar</button></div>
        <div class="catalog-config-grid">
          <label>Nombre local<input name="nombreLocal" required value="${escapeHtml(config.nombreLocal)}"></label>
          <label>Categoría local<select name="categoriaLocal">${categoryOptions(config.categoriaLocal)}</select></label>
          <label>Proveedor<select name="idProveedor">${options(state.proveedores, 'idProveedor', 'nombre', 'Sin proveedor', config.idProveedor)}</select></label>
          <label>Precio de compra<input name="precioCompra" type="number" min="0" step="0.01" value="${escapeHtml(config.precioCompra)}" required></label>
          <label>Precio de venta<input name="precioVenta" type="number" min="0.01" step="0.01" value="${escapeHtml(config.precioVenta)}" required></label>
          <label>Stock inicial (unidades)<input name="stockInicial" type="number" min="0" step="1" value="${escapeHtml(config.stockInicial)}" required></label>
          <label>Stock mínimo (unidades)<input name="stockMinimo" type="number" min="1" step="1" value="${escapeHtml(config.stockMinimo)}" required></label>
          <label>Unidades por paquete<input name="unidadesPorPaquete" type="number" min="1" step="1" value="${escapeHtml(config.unidadesPorPaquete)}" required></label>
          <label class="check"><input name="permiteVentaPorUnidad" type="checkbox" ${config.permiteVentaPorUnidad ? 'checked' : ''}> Vender por unidad</label>
          <label class="check"><input name="permiteVentaPorPaquete" type="checkbox" ${config.permiteVentaPorPaquete ? 'checked' : ''}> Vender por paquete</label>
        </div>
      </article>`;
    }).join('');
    selectedTarget.querySelectorAll('[data-remove-master]').forEach((button) => button.addEventListener('click', () => {
      picker.selected.delete(Number(button.dataset.removeMaster));
      renderSelected();
      renderResults();
    }));
  };

  const renderResults = () => {
    results.innerHTML = picker.rows.length ? picker.rows.map((product) => {
      const chosen = picker.selected.has(Number(product.idProductoMaestro));
      const unavailable = Boolean(product.agregadoEnTienda);
      const content = product.contenidoCantidad ? `${Number(product.contenidoCantidad)} ${product.contenidoUnidad || ''}` : '';
      return `<article class="catalog-master-result">
        <div><strong>${escapeHtml(product.nombre)}</strong><span>${escapeHtml(product.marca || 'Sin marca')} · ${escapeHtml(product.categoriaMaestra || 'Sin categoría')}</span><small>${escapeHtml([product.presentacion, content, product.codigoBarras].filter(Boolean).join(' · ') || 'Sin datos adicionales')}</small></div>
        <button type="button" class="small ${chosen ? 'secondary' : ''}" data-select-master="${product.idProductoMaestro}" ${unavailable || chosen ? 'disabled' : ''}>${unavailable ? 'Ya agregado' : chosen ? 'Seleccionado' : 'Agregar'}</button>
      </article>`;
    }).join('') : '<p class="muted">No hay coincidencias.</p>';
    root.querySelector('#catalogPickerPage').textContent = `Página ${picker.page} de ${picker.pages}`;
    root.querySelector('#catalogPickerPrevious').disabled = picker.page <= 1;
    root.querySelector('#catalogPickerNext').disabled = picker.page >= picker.pages;
    results.querySelectorAll('[data-select-master]').forEach((button) => button.addEventListener('click', () => {
      const product = picker.rows.find((row) => String(row.idProductoMaestro) === button.dataset.selectMaster);
      if (product) picker.selected.set(Number(product.idProductoMaestro), product);
      renderSelected();
      renderResults();
    }));
  };

  const loadRows = async (page = 1) => {
    const query = new URLSearchParams({ page: String(page), limit: '20' });
    if (search.value.trim()) query.set('q', search.value.trim());
    if (category.value) query.set('idCategoriaMaestra', category.value);
    if (brand.value) query.set('idMarcaMaestra', brand.value);
    const response = await api(`/api/catalogo-maestro?${query}`);
    picker.rows = response.rows;
    picker.page = response.page;
    picker.pages = response.pages;
    renderResults();
  };

  try {
    [picker.categories, picker.brands] = await Promise.all([
      api('/api/catalogo-maestro/categorias'),
      api('/api/catalogo-maestro/marcas')
    ]);
    category.innerHTML = options(picker.categories, 'idCategoriaMaestra', 'nombre', 'Todas');
    brand.innerHTML = options(picker.brands, 'idMarcaMaestra', 'nombre', 'Todas');
    await loadRows(1);
  } catch (error) {
    modalRoot.innerHTML = '';
    return showError(error.message);
  }

  let searchTimer;
  search.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => loadRows(1).catch((error) => showPickerError(error.message)), 250);
  });
  [category, brand].forEach((filter) => filter.addEventListener('change', () => loadRows(1).catch((error) => showPickerError(error.message))));
  root.querySelector('#catalogPickerPrevious').addEventListener('click', () => loadRows(picker.page - 1).catch((error) => showPickerError(error.message)));
  root.querySelector('#catalogPickerNext').addEventListener('click', () => loadRows(picker.page + 1).catch((error) => showPickerError(error.message)));
  root.querySelector('[data-modal-cancel]').addEventListener('click', () => { modalRoot.innerHTML = ''; });
  root.querySelector('#catalogAddSelected').addEventListener('click', async () => {
    if (!picker.selected.size) return showPickerError('Selecciona al menos un producto maestro.');
    const invalidInput = selectedTarget.querySelector(':invalid');
    if (invalidInput) {
      invalidInput.reportValidity();
      return showPickerError('Revisa los datos comerciales de los productos seleccionados.');
    }
    showPickerError();
    const items = [...selectedTarget.querySelectorAll('[data-master-config]')].map((card) => ({
      idProductoMaestro: Number(card.dataset.masterConfig),
      nombreLocal: card.querySelector('[name="nombreLocal"]').value.trim(),
      categoriaLocal: card.querySelector('[name="categoriaLocal"]').value,
      idProveedor: card.querySelector('[name="idProveedor"]').value || null,
      precioCompra: Number(card.querySelector('[name="precioCompra"]').value),
      precioVenta: Number(card.querySelector('[name="precioVenta"]').value),
      stockInicial: Number(card.querySelector('[name="stockInicial"]').value),
      stockMinimo: Number(card.querySelector('[name="stockMinimo"]').value),
      unidadesPorPaquete: Number(card.querySelector('[name="unidadesPorPaquete"]').value),
      permiteVentaPorUnidad: card.querySelector('[name="permiteVentaPorUnidad"]').checked,
      permiteVentaPorPaquete: card.querySelector('[name="permiteVentaPorPaquete"]').checked,
      unidadMedida: 'unidad',
      activo: true
    }));
    try {
      const result = await api('/api/catalogo-maestro/agregar', { method: 'POST', body: JSON.stringify({ items }) });
      modalRoot.innerHTML = '';
      await showSuccess(result.message);
      await loadView('productos');
    } catch (error) {
      showPickerError(error.message);
    }
  });
}

function filterProductsLocal() {
  const q = normalizeSearch(document.getElementById('productSearch')?.value || '');
  const categoria = document.getElementById('productCategory')?.value || '';
  const proveedor = document.getElementById('productProvider')?.value || '';
  const low = document.getElementById('productLowStock')?.checked;
  const sort = document.getElementById('productSort')?.value || '';
  let rows = state.productos.filter((p) => (!q || normalizeSearch(p.nombre).includes(q))
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
      <td class="actions"><button class="small secondary" data-edit="${p.idProducto}">Editar</button><button class="small" data-adjust-stock="${p.idProducto}">Ajustar stock</button><button class="small secondary" data-product-movements="${p.idProducto}">Ver movimientos</button><button class="small danger" data-delete="${p.idProducto}">Ocultar</button></td>
    </tr>`).join('')}</tbody></table></div>`;
  target.querySelectorAll('[data-edit]').forEach((btn) => btn.addEventListener('click', () => openProductModal(state.productos.find((p) => String(p.idProducto) === btn.dataset.edit))));
  target.querySelectorAll('[data-adjust-stock]').forEach((btn) => btn.addEventListener('click', () => openStockAdjustment(state.productos.find((p) => String(p.idProducto) === btn.dataset.adjustStock))));
  target.querySelectorAll('[data-product-movements]').forEach((btn) => btn.addEventListener('click', () => openProductMovements(btn.dataset.productMovements)));
  target.querySelectorAll('[data-delete]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!await confirmAction('¿Deseas ocultar este producto? Su stock y movimientos se conservarán.', true)) return;
    try {
      await api(`/api/productos/${btn.dataset.delete}`, { method: 'DELETE' });
      await showSuccess('Producto ocultado.');
      loadView('productos');
    } catch (error) { showError(error.message); }
  }));
}

async function productos() {
  view.innerHTML = `
    <div class="panel toolbar">
      <button id="addProduct">Añadir producto</button>
      <button id="addFromCatalog" class="secondary">Agregar desde catálogo</button>
      <button id="showHiddenProducts" class="secondary">Ver productos ocultos</button>
      <label>Buscar<input id="productSearch" placeholder="Buscar producto"></label>
      <label>Categoría<select id="productCategory"><option value="">Todas</option>${categoryOptions()}</select></label>
      <label>Proveedor<select id="productProvider">${options(state.proveedores, 'idProveedor', 'nombre', 'Todos')}</select></label>
      <label class="check"><input id="productLowStock" type="checkbox"> Bajo stock</label>
      <label>Orden<select id="productSort"><option value="">Nombre</option><option value="precio_desc">Más caro</option><option value="precio_asc">Más barato</option></select></label>
    </div>
    <div class="panel" id="productTable"></div>`;
  wireUppercase(view);
  document.getElementById('addProduct').addEventListener('click', () => openProductModal());
  document.getElementById('addFromCatalog').addEventListener('click', openMasterCatalogPicker);
  document.getElementById('showHiddenProducts').addEventListener('click', openHiddenProducts);
  ['productSearch', 'productCategory', 'productProvider', 'productLowStock', 'productSort'].forEach((id) => {
    document.getElementById(id).addEventListener('input', filterProductsLocal);
    document.getElementById(id).addEventListener('change', filterProductsLocal);
  });
  renderProductTable(state.productos);
}

function movementTypeLabel(value) {
  return ({
    entrada: 'Entrada', salida: 'Salida', ajuste_positivo: 'Ajuste positivo',
    ajuste_negativo: 'Ajuste negativo', inventario_inicial: 'Inventario inicial'
  })[value] || value;
}

function movementOriginLabel(value) {
  return ({
    compra: 'Compra', venta: 'Venta', ajuste_manual: 'Ajuste manual', alta_producto: 'Alta de producto',
    migracion_inicial: 'Migración inicial', correccion_sistema: 'Corrección del sistema', otro: 'Otro'
  })[value] || value;
}

function movementReference(row) {
  if (row.idVenta) return `Venta #${row.idVenta}`;
  if (row.idCompra) return `Compra #${row.idCompra}`;
  if (row.referenciaTipo === 'producto') return `Producto #${row.referenciaId}`;
  return 'Sin documento';
}

function movementTable(rows, { includeProduct = true } = {}) {
  if (!rows.length) return '<p class="muted">No hay movimientos para mostrar.</p>';
  return `<div class="table-wrap"><table class="movement-table">
    <thead><tr><th>Fecha</th>${includeProduct ? '<th>Producto</th>' : ''}<th>Movimiento</th><th>Cantidad</th><th>Stock</th><th>Motivo</th><th>Referencia</th><th>Responsable</th></tr></thead>
    <tbody>${rows.map((row) => {
      const positive = Number(row.cantidad) > 0;
      return `<tr class="movement-row ${positive ? 'movement-positive' : 'movement-negative'}">
        <td>${formatDate(row.creadoEn)}</td>${includeProduct ? `<td><strong>${escapeHtml(row.producto)}</strong></td>` : ''}
        <td><span class="movement-badge ${positive ? 'positive' : 'negative'}">${escapeHtml(movementTypeLabel(row.tipoMovimiento))}</span><small>${escapeHtml(movementOriginLabel(row.origen))}</small></td>
        <td><strong>${positive ? '+' : ''}${intValue(row.cantidad)}</strong>${row.cantidadOperacion ? `<small>${escapeHtml(row.cantidadOperacion)} ${escapeHtml(row.unidadOperacion || '')}</small>` : ''}</td>
        <td>${intValue(row.stockAnterior)} → <strong>${intValue(row.stockPosterior)}</strong></td>
        <td>${escapeHtml(row.motivo)}${row.observacion ? `<small>${escapeHtml(row.observacion)}</small>` : ''}</td>
        <td>${escapeHtml(movementReference(row))}</td><td>${escapeHtml(row.responsable || 'Sistema')}</td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
}

function requestStockAdjustment(product) {
  return new Promise((resolve) => {
    modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal">
      <h3>Ajustar stock de ${escapeHtml(product.nombre)}</h3>
      <div class="modal-body"><form id="stockAdjustmentForm" class="grid">
        <p class="wide stock-adjustment-summary">Stock actual: <strong>${intValue(product.stockUnidadesTotal)} unidades base</strong></p>
        <label>Nuevo stock contado<input name="nuevoStock" type="number" min="0" step="1" required value="${Number(product.stockUnidadesTotal || 0)}"></label>
        <label>Motivo<input name="motivo" minlength="5" maxlength="160" required placeholder="Ej. Conteo físico de inventario"></label>
        <label class="wide">Observación<textarea name="observacion" maxlength="500" rows="3"></textarea></label>
        <label class="wide">Tu contraseña actual<input name="password" type="password" autocomplete="current-password" required></label>
        <p class="hint wide">El sistema calculará la diferencia y conservará un registro permanente del ajuste.</p>
      </form></div>
      <div class="modal-actions"><button type="button" class="secondary" data-modal-cancel>Cancelar</button><button type="button" data-modal-confirm>Registrar ajuste</button></div>
    </div></div>`;
    const form = document.getElementById('stockAdjustmentForm');
    const passwordInput = form.querySelector('[name="password"]');
    const close = (value) => {
      passwordInput.value = '';
      modalRoot.innerHTML = '';
      resolve(value);
    };
    modalRoot.querySelector('[data-modal-cancel]').addEventListener('click', () => close(null));
    modalRoot.querySelector('[data-modal-confirm]').addEventListener('click', () => {
      if (!form.reportValidity()) return;
      close(formData(form));
    });
  });
}

async function openStockAdjustment(product) {
  if (!product) return;
  const data = await requestStockAdjustment(product);
  if (!data) return;
  data.nuevoStock = Number(data.nuevoStock);
  data.claveOperacion = newOperationKey();
  try {
    const result = await api(`/api/productos/${product.idProducto}/ajustar-stock`, {
      method: 'POST', body: JSON.stringify(data)
    });
    await showSuccess(`${result.message} Stock: ${result.stockAnterior} → ${result.stockPosterior}.`);
    await loadView('productos');
  } catch (error) {
    await showError(error.message);
  }
}

async function openProductMovements(idProducto) {
  try {
    const data = await api(`/api/productos/${idProducto}/movimientos?limit=50`);
    await modal({
      title: `Movimientos de ${data.producto.nombre}`,
      confirmText: 'Cerrar',
      wide: true,
      body: `<p>Stock actual: <strong>${intValue(data.producto.stockUnidadesTotal)} unidades base</strong></p>${movementTable(data.rows, { includeProduct: false })}`
    });
  } catch (error) { showError(error.message); }
}

async function openHiddenProducts() {
  try {
    const rows = await api('/api/productos/ocultos');
    await modal({
      title: 'Productos ocultos',
      confirmText: 'Cerrar',
      wide: true,
      body: rows.length ? `<div class="hidden-product-list">${rows.map((product) => `
        <article class="hidden-product-item"><div><strong>${escapeHtml(product.nombre)}</strong><span>${stockLabel(product)}</span></div><button type="button" class="secondary small" data-restore-product="${product.idProducto}">Restaurar</button></article>`).join('')}</div>` : '<p class="muted">No hay productos ocultos.</p>',
      onOpen: (root) => root.querySelectorAll('[data-restore-product]').forEach((button) => button.addEventListener('click', async () => {
        try {
          await api(`/api/productos/${button.dataset.restoreProduct}/restaurar`, { method: 'PATCH' });
          modalRoot.innerHTML = '';
          await showSuccess('Producto restaurado sin modificar su stock.');
          await loadView('productos');
        } catch (error) { showError(error.message); }
      }))
    });
  } catch (error) { showError(error.message); }
}

async function movimientosStock() {
  view.innerHTML = `
    <div class="panel movement-filters">
      <label>Producto<input id="movementSearch" type="search" placeholder="Buscar producto"></label>
      <label>Tipo<select id="movementType"><option value="">Todos</option><option value="entrada">Entrada</option><option value="salida">Salida</option><option value="ajuste_positivo">Ajuste positivo</option><option value="ajuste_negativo">Ajuste negativo</option><option value="inventario_inicial">Inventario inicial</option></select></label>
      <label>Origen<select id="movementOrigin"><option value="">Todos</option><option value="compra">Compra</option><option value="venta">Venta</option><option value="ajuste_manual">Ajuste manual</option><option value="alta_producto">Alta de producto</option><option value="migracion_inicial">Migración inicial</option></select></label>
      <label>Desde<input id="movementFrom" type="date"></label><label>Hasta<input id="movementTo" type="date"></label>
      <label>Responsable<select id="movementOwner"><option value="">Todos</option></select></label>
    </div>
    <div class="panel" id="movementResults"><p class="muted">Cargando movimientos...</p></div>
    <div class="movement-pagination"><button id="movementPrevious" class="secondary">Anterior</button><span id="movementPage">Página 1</span><button id="movementNext" class="secondary">Siguiente</button></div>`;
  let currentPage = 1;
  let searchTimer;
  const load = async (page = 1) => {
    const query = new URLSearchParams({ page: String(page), limit: '25' });
    const values = {
      q: document.getElementById('movementSearch').value.trim(),
      tipo: document.getElementById('movementType').value,
      origen: document.getElementById('movementOrigin').value,
      desde: document.getElementById('movementFrom').value,
      hasta: document.getElementById('movementTo').value,
      idAdministrador: document.getElementById('movementOwner').value
    };
    Object.entries(values).forEach(([key, value]) => { if (value) query.set(key, value); });
    const data = await api(`/api/movimientos-stock?${query}`);
    currentPage = data.page;
    document.getElementById('movementResults').innerHTML = movementTable(data.rows);
    const owner = document.getElementById('movementOwner');
    const selected = owner.value;
    owner.innerHTML = options(data.responsables, 'idAdministrador', 'usuario', 'Todos', selected);
    document.getElementById('movementPage').textContent = `Página ${data.page} de ${data.pages}`;
    document.getElementById('movementPrevious').disabled = data.page <= 1;
    document.getElementById('movementNext').disabled = data.page >= data.pages;
  };
  document.getElementById('movementSearch').addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => load(1).catch((error) => showError(error.message)), 250);
  });
  ['movementType', 'movementOrigin', 'movementFrom', 'movementTo', 'movementOwner'].forEach((id) => {
    document.getElementById(id).addEventListener('change', () => load(1).catch((error) => showError(error.message)));
  });
  document.getElementById('movementPrevious').addEventListener('click', () => load(currentPage - 1).catch((error) => showError(error.message)));
  document.getElementById('movementNext').addEventListener('click', () => load(currentPage + 1).catch((error) => showError(error.message)));
  await load(1);
}

function autocompleteBox(kind) {
  return `
    <div class="autocomplete">
      <label>Buscar producto<input id="${kind}Search" placeholder="Escriba el producto"></label>
      <div id="${kind}Results" class="autocomplete-results"></div>
    </div>`;
}

function operationFilters(kind) {
  const q = normalizeSearch(document.getElementById(`${kind}Search`)?.value || '');
  const category = document.getElementById(`${kind}Category`)?.value || '';
  const provider = document.getElementById(`${kind}Provider`)?.value || document.querySelector(`#${kind}Form [name="idProveedor"]`)?.value || '';
  const lowStock = document.getElementById(`${kind}LowStock`)?.checked || false;
  const showAll = kind === 'compras' ? document.getElementById('showAllProducts')?.checked : true;
  return { q, category, provider, lowStock, showAll };
}

function filteredOperationProducts(kind) {
  const filters = operationFilters(kind);
  return state.productos.filter((p) => {
    const byText = !filters.q || normalizeSearch(p.nombre).includes(filters.q);
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
    <form id="${kind}Form" class="cart-layout" data-operation-key="${newOperationKey()}">
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
  body.claveOperacion = form.dataset.operationKey;
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

function posLinePrice(line) {
  if (line.presentacion === 'paquete') {
    return Number(line.producto.precioVentaPaquete ?? (Number(line.producto.precioVenta) * Number(line.producto.unidadesPorPaquete || 1)));
  }
  return Number(line.producto.precioVenta || 0);
}

function posLineUnits(line) {
  return Number(line.cantidad || 0) * (line.presentacion === 'paquete' ? Number(line.producto.unidadesPorPaquete || 1) : 1);
}

function posSubtotal() {
  return posCart.reduce((sum, line) => sum + Number(line.cantidad || 0) * posLinePrice(line), 0);
}

function posTotals() {
  const subtotal = posSubtotal();
  const discount = Math.min(subtotal, Math.max(0, Number(document.getElementById('posDiscount')?.value || 0)));
  return { subtotal, discount, total: Math.max(0, subtotal - discount) };
}

function posProductCard(product) {
  const packagePrice = Number(product.precioVentaPaquete ?? (Number(product.precioVenta) * Number(product.unidadesPorPaquete || 1)));
  const presentations = [
    product.permiteVentaPorUnidad ? `Unidad Bs ${money(product.precioVenta)}` : '',
    product.permiteVentaPorPaquete && Number(product.unidadesPorPaquete) > 1
      ? `Paquete Bs ${money(packagePrice)} (${product.unidadesPorPaquete} u.)`
      : ''
  ].filter(Boolean).join(' · ');
  return `
    <article class="pos-product" data-pos-product="${product.idProducto}">
      <button type="button" class="pos-favorite ${product.favoritoPos ? 'is-favorite' : ''}" data-pos-favorite="${product.idProducto}" title="${product.favoritoPos ? 'Quitar de favoritos' : 'Agregar a favoritos'}" aria-label="Favorito">★</button>
      <div>
        <strong>${escapeHtml(product.nombre)}</strong>
        <span>${escapeHtml(product.categoria)} · ${escapeHtml(product.proveedor || 'Sin proveedor')}</span>
        <small>${escapeHtml(stockLabel(product))}</small>
        <small>${escapeHtml(presentations)}</small>
      </div>
      <button type="button" data-pos-add="${product.idProducto}">Agregar</button>
    </article>`;
}

async function loadPosProducts(viewMode = '') {
  const results = document.getElementById('posResults');
  if (!results) return;
  const search = document.getElementById('posSearch').value.trim();
  const category = document.getElementById('posCategory').value;
  const query = new URLSearchParams({ limit: '30' });
  if (search) query.set('q', search);
  if (category) query.set('categoria', category);
  const path = viewMode === 'recientes'
    ? '/api/pos/recientes'
    : viewMode === 'mas_vendidos'
      ? '/api/pos/mas-vendidos'
      : viewMode === 'favoritos'
        ? '/api/pos/favoritos'
        : '/api/pos/productos';
  try {
    const data = await api(`${path}?${query}`);
    results.dataset.products = JSON.stringify(data.productos);
    results.innerHTML = data.productos.length
      ? data.productos.map(posProductCard).join('')
      : '<p class="muted empty-state">No se encontraron productos disponibles.</p>';
    results.querySelectorAll('[data-pos-add]').forEach((button) => button.addEventListener('click', () => {
      const product = data.productos.find((item) => String(item.idProducto) === button.dataset.posAdd);
      addPosProduct(product);
    }));
    results.querySelectorAll('[data-pos-favorite]').forEach((button) => button.addEventListener('click', async () => {
      const product = data.productos.find((item) => String(item.idProducto) === button.dataset.posFavorite);
      try {
        await api(`/api/pos/favoritos/${product.idProducto}`, { method: product.favoritoPos ? 'DELETE' : 'POST' });
        await loadPosProducts(viewMode);
      } catch (error) { showError(error.message); }
    }));
  } catch (error) {
    results.innerHTML = `<p class="text-danger">${escapeHtml(error.message)}</p>`;
  }
}

function addPosProduct(product) {
  if (!product) return;
  const existing = posCart.find((line) => Number(line.producto.idProducto) === Number(product.idProducto));
  if (existing) existing.cantidad += 1;
  else {
    const presentacion = product.permiteVentaPorUnidad ? 'unidad' : 'paquete';
    posCart.push({ producto: product, cantidad: 1, presentacion });
  }
  renderPosCart();
}

function renderPosCart() {
  const container = document.getElementById('posCartItems');
  if (!container) return;
  container.innerHTML = posCart.length ? posCart.map((line, index) => {
    const units = posLineUnits(line);
    const insufficient = units > Number(line.producto.stockUnidadesTotal || 0);
    const packageOption = line.producto.permiteVentaPorPaquete && Number(line.producto.unidadesPorPaquete || 1) > 1
      ? `<option value="paquete" ${line.presentacion === 'paquete' ? 'selected' : ''}>Paquete</option>` : '';
    const unitOption = line.producto.permiteVentaPorUnidad
      ? `<option value="unidad" ${line.presentacion === 'unidad' ? 'selected' : ''}>Unidad</option>` : '';
    return `
      <article class="pos-cart-line ${insufficient ? 'has-warning' : ''}" data-pos-line="${index}">
        <div class="pos-cart-line-head">
          <strong>${escapeHtml(line.producto.nombre)}</strong>
          <button type="button" class="icon-button danger" data-pos-remove="${index}" title="Quitar producto" aria-label="Quitar">×</button>
        </div>
        <div class="pos-line-controls">
          <label>Presentación<select data-pos-presentation="${index}">${unitOption}${packageOption}</select></label>
          <label>Cantidad<span class="pos-stepper"><button type="button" data-pos-minus="${index}" title="Disminuir">−</button><input data-pos-quantity="${index}" type="number" min="1" step="1" value="${line.cantidad}"><button type="button" data-pos-plus="${index}" title="Aumentar">+</button></span></label>
        </div>
        <div class="pos-line-summary">
          <span>${units} unidades · Bs ${money(posLinePrice(line))} c/u</span>
          <strong>Bs ${money(Number(line.cantidad) * posLinePrice(line))}</strong>
        </div>
        ${insufficient ? `<p class="text-danger">Requiere ${units}; disponibles ${line.producto.stockUnidadesTotal}.</p>` : ''}
      </article>`;
  }).join('') : '<p class="muted empty-state">El carrito esta vacio.</p>';
  container.querySelectorAll('[data-pos-remove]').forEach((button) => button.addEventListener('click', () => {
    posCart.splice(Number(button.dataset.posRemove), 1);
    renderPosCart();
  }));
  container.querySelectorAll('[data-pos-minus]').forEach((button) => button.addEventListener('click', () => {
    const line = posCart[Number(button.dataset.posMinus)];
    line.cantidad = Math.max(1, Number(line.cantidad) - 1);
    renderPosCart();
  }));
  container.querySelectorAll('[data-pos-plus]').forEach((button) => button.addEventListener('click', () => {
    posCart[Number(button.dataset.posPlus)].cantidad += 1;
    renderPosCart();
  }));
  container.querySelectorAll('[data-pos-quantity]').forEach((input) => input.addEventListener('change', () => {
    posCart[Number(input.dataset.posQuantity)].cantidad = Math.max(1, Number.parseInt(input.value, 10) || 1);
    renderPosCart();
  }));
  container.querySelectorAll('[data-pos-presentation]').forEach((select) => select.addEventListener('change', () => {
    posCart[Number(select.dataset.posPresentation)].presentacion = select.value;
    renderPosCart();
  }));
  document.getElementById('posCartCount').textContent = `${posCart.length} producto${posCart.length === 1 ? '' : 's'}`;
  renderPosPaymentSummary();
}

function renderPosPaymentFields() {
  const mode = document.getElementById('posPaymentMode')?.value || 'efectivo';
  const fields = document.getElementById('posPaymentFields');
  if (!fields) return;
  const { total } = posTotals();
  if (mode === 'efectivo') {
    fields.innerHTML = `<label>Efectivo recibido<input id="posCashReceived" data-auto-cash="true" type="number" min="0" step="0.01" value="${money(total)}"></label>`;
  } else if (mode === 'qr') {
    fields.innerHTML = `<label>Referencia QR (opcional)<input id="posQrReference" maxlength="120" placeholder="Número o nota del pago"></label>`;
  } else if (mode === 'mixto') {
    fields.innerHTML = `
      <label>Monto en efectivo<input id="posCashApplied" type="number" min="0" step="0.01" value="0"></label>
      <label>Efectivo recibido<input id="posCashReceived" type="number" min="0" step="0.01" value="0"></label>
      <label>Monto por QR<input id="posQrApplied" type="number" min="0" step="0.01" value="0"></label>
      <label>Referencia QR (opcional)<input id="posQrReference" maxlength="120"></label>`;
  } else {
    fields.innerHTML = '<p class="pos-credit-note">El total quedara pendiente. Debes seleccionar un cliente registrado.</p>';
  }
  fields.querySelectorAll('input').forEach((input) => input.addEventListener('input', () => {
    if (input.id === 'posCashReceived') input.dataset.autoCash = 'false';
    renderPosPaymentSummary();
  }));
  renderPosPaymentSummary();
}

function posPaymentDraft() {
  const { total } = posTotals();
  const mode = document.getElementById('posPaymentMode')?.value || 'efectivo';
  const payments = [];
  let cashReceived = 0;
  if (mode === 'efectivo') {
    if (total > 0) payments.push({ metodoPago: 'efectivo', monto: total });
    cashReceived = Number(document.getElementById('posCashReceived')?.value || 0);
  } else if (mode === 'qr') {
    if (total > 0) payments.push({ metodoPago: 'qr', monto: total, referencia: document.getElementById('posQrReference')?.value || '' });
  } else if (mode === 'mixto') {
    const cash = Math.max(0, Number(document.getElementById('posCashApplied')?.value || 0));
    const qr = Math.max(0, Number(document.getElementById('posQrApplied')?.value || 0));
    if (cash > 0) payments.push({ metodoPago: 'efectivo', monto: cash });
    if (qr > 0) payments.push({ metodoPago: 'qr', monto: qr, referencia: document.getElementById('posQrReference')?.value || '' });
    cashReceived = Number(document.getElementById('posCashReceived')?.value || 0);
  }
  const paid = payments.reduce((sum, payment) => sum + Number(payment.monto), 0);
  return { payments, paid, balance: Math.max(0, total - paid), cashReceived, change: Math.max(0, cashReceived - (payments.find((payment) => payment.metodoPago === 'efectivo')?.monto || 0)) };
}

function renderPosPaymentSummary() {
  const summary = document.getElementById('posPaymentSummary');
  if (!summary) return;
  const totals = posTotals();
  const automaticCash = document.querySelector('#posCashReceived[data-auto-cash="true"]');
  if (automaticCash) automaticCash.value = money(totals.total);
  const payment = posPaymentDraft();
  document.getElementById('posSubtotal').textContent = `Bs ${money(totals.subtotal)}`;
  document.getElementById('posTotal').textContent = `Bs ${money(totals.total)}`;
  summary.innerHTML = `
    <span>Pagado <strong>Bs ${money(payment.paid)}</strong></span>
    <span>Saldo <strong class="${payment.balance > 0 ? 'text-danger' : 'text-ok'}">Bs ${money(payment.balance)}</strong></span>
    <span>Cambio <strong>Bs ${money(payment.change)}</strong></span>`;
}

function receiptText(receipt) {
  const sale = receipt.venta;
  const lines = [
    sale.tienda,
    `Comprobante ${sale.codigoComprobante || `Venta #${sale.idVenta}`}`,
    formatDate(sale.fecha),
    sale.idCliente ? `Cliente: ${sale.cliente}` : 'Cliente ocasional',
    ''
  ];
  receipt.detalle.forEach((item) => {
    lines.push(`${item.nombre} - ${intValue(item.cantidad)} ${item.presentacionVenta} x Bs ${money(item.precioVenta)} = Bs ${money(item.subtotal)}`);
  });
  lines.push('', `Subtotal: Bs ${money(sale.subtotal)}`);
  if (Number(sale.descuento) > 0) lines.push(`Descuento: Bs ${money(sale.descuento)}`);
  lines.push(`Total: Bs ${money(sale.total)}`);
  receipt.pagos.forEach((payment) => {
    lines.push(`${payment.metodoPago}: Bs ${money(payment.monto)}${payment.referencia ? ` (${payment.referencia})` : ''}`);
    if (payment.metodoPago === 'efectivo' && Number(payment.cambio) > 0) {
      lines.push(`Efectivo recibido: Bs ${money(payment.montoRecibido)}`, `Cambio: Bs ${money(payment.cambio)}`);
    }
  });
  lines.push(`Pagado: Bs ${money(sale.montoPagado)}`, `Saldo actual: Bs ${money(sale.saldoActualFiado ?? sale.saldoPendiente)}`);
  lines.push('', 'Gracias por su compra.', 'Comprobante interno, no fiscal.');
  return lines.join('\n');
}

function receiptHtml(receipt) {
  const sale = receipt.venta;
  return `
    <section class="receipt" id="saleReceipt">
      <header><h2>${escapeHtml(sale.tienda)}</h2><strong>${escapeHtml(sale.codigoComprobante || `Venta #${sale.idVenta}`)}</strong><span>${escapeHtml(formatDate(sale.fecha))}</span></header>
      <p>${sale.idCliente ? `Cliente: <strong>${escapeHtml(sale.cliente)}</strong>` : 'Cliente ocasional'}</p>
      <div class="receipt-lines">${receipt.detalle.map((item) => `
        <div><span>${escapeHtml(item.nombre)}<small>${intValue(item.cantidad)} ${escapeHtml(item.presentacionVenta)} × Bs ${money(item.precioVenta)}</small></span><strong>Bs ${money(item.subtotal)}</strong></div>`).join('')}</div>
      <div class="receipt-totals">
        <span>Subtotal <strong>Bs ${money(sale.subtotal)}</strong></span>
        ${Number(sale.descuento) > 0 ? `<span>Descuento <strong>Bs ${money(sale.descuento)}</strong></span>` : ''}
        <span class="receipt-grand-total">Total <strong>Bs ${money(sale.total)}</strong></span>
        ${receipt.pagos.map((payment) => `<span>${escapeHtml(payment.metodoPago)} <strong>Bs ${money(payment.monto)}</strong></span>${payment.metodoPago === 'efectivo' && Number(payment.cambio) > 0 ? `<span>Efectivo recibido <strong>Bs ${money(payment.montoRecibido)}</strong></span><span>Cambio <strong>Bs ${money(payment.cambio)}</strong></span>` : ''}`).join('')}
        <span>Saldo pendiente <strong class="${Number(sale.saldoActualFiado ?? sale.saldoPendiente) > 0 ? 'text-danger' : 'text-ok'}">Bs ${money(sale.saldoActualFiado ?? sale.saldoPendiente)}</strong></span>
      </div>
      <footer>Gracias por su compra.<small>Comprobante interno, no fiscal.</small></footer>
    </section>`;
}

async function copyReceiptText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const area = document.createElement('textarea');
  area.value = text;
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}

function showSaleReceipt(receipt) {
  const text = receiptText(receipt);
  const phone = String(receipt.venta.telefono || '').replace(/\D/g, '');
  modalRoot.innerHTML = `
    <div class="modal-backdrop"><div class="modal receipt-modal">
      <h3>Venta confirmada</h3>
      <div class="modal-body">${receiptHtml(receipt)}</div>
      <div class="modal-actions receipt-actions">
        <button type="button" class="secondary" data-receipt-copy>Copiar texto</button>
        <button type="button" class="secondary" data-receipt-print>Imprimir</button>
        <button type="button" ${phone ? '' : 'disabled'} data-receipt-whatsapp>WhatsApp</button>
        <button type="button" data-modal-confirm>Cerrar</button>
      </div>
    </div></div>`;
  modalRoot.querySelector('[data-modal-confirm]').addEventListener('click', () => { modalRoot.innerHTML = ''; });
  modalRoot.querySelector('[data-receipt-copy]').addEventListener('click', async () => {
    try { await copyReceiptText(text); showMessage('Comprobante copiado.'); } catch { showError('No se pudo copiar el comprobante.'); }
  });
  modalRoot.querySelector('[data-receipt-whatsapp]').addEventListener('click', () => {
    if (phone) window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  });
  modalRoot.querySelector('[data-receipt-print]').addEventListener('click', () => {
    const printWindow = window.open('', '_blank', 'width=520,height=720');
    if (!printWindow) return showError('El navegador bloqueó la ventana de impresión.');
    printWindow.opener = null;
    printWindow.document.write(`<html><head><title>${escapeHtml(receipt.venta.codigoComprobante)}</title><style>body{font-family:Arial,sans-serif;max-width:420px;margin:20px auto}.receipt header,.receipt footer{text-align:center}.receipt header>*{display:block;margin:4px}.receipt-lines>div,.receipt-totals span{display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid #ddd}.receipt-lines small{display:block;color:#555}.receipt-grand-total{font-size:1.2rem;font-weight:bold}</style></head><body>${receiptHtml(receipt)}</body></html>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  });
}

async function submitPosSale(event) {
  event.preventDefault();
  if (!posCart.length) return showError('Debe agregar al menos un producto.');
  if (posCart.some((line) => posLineUnits(line) > Number(line.producto.stockUnidadesTotal || 0))) {
    return showError('Hay productos con stock insuficiente.');
  }
  const totals = posTotals();
  const payment = posPaymentDraft();
  if (payment.paid > totals.total + 0.001) return showError('Los pagos no pueden superar el total.');
  if (payment.payments.some((item) => item.metodoPago === 'efectivo') && payment.cashReceived < (payment.payments.find((item) => item.metodoPago === 'efectivo')?.monto || 0)) {
    return showError('El efectivo recibido no alcanza para el monto aplicado.');
  }
  const idCliente = document.getElementById('posClient').value;
  if (payment.balance > 0 && !idCliente) return showError('Selecciona un cliente para dejar saldo pendiente.');
  if (!await confirmAction(`Registrar venta por Bs ${money(totals.total)}${payment.balance > 0 ? ` con saldo Bs ${money(payment.balance)}` : ''}?`)) return;
  const button = document.getElementById('posSubmit');
  button.disabled = true;
  try {
    const data = await api('/api/pos/ventas', {
      method: 'POST',
      body: JSON.stringify({
        claveOperacion: posOperationKey,
        idCliente: idCliente || null,
        descuento: totals.discount,
        pagos: payment.payments,
        efectivoRecibido: payment.cashReceived,
        saldoFiado: payment.balance,
        items: posCart.map((line) => ({ idProducto: line.producto.idProducto, cantidad: line.cantidad, presentacion: line.presentacion }))
      })
    });
    posCart = [];
    posOperationKey = newOperationKey();
    renderPosCart();
    showSaleReceipt(data.comprobante);
    refreshCatalogs().catch(() => {});
  } catch (error) {
    showError(error.message);
  } finally {
    button.disabled = Boolean(state.context?.soloLectura);
  }
}

async function ventas() {
  posOperationKey = posOperationKey || newOperationKey();
  view.innerHTML = `
    <form id="posForm" class="pos-layout">
      <section class="panel pos-picker">
        <div class="pos-search-row">
          <label class="pos-search-label">Buscar o escanear producto<input id="posSearch" autocomplete="off" placeholder="Nombre o código de barras"></label>
          <label>Categoría<select id="posCategory"><option value="">Todas</option>${categoryOptions()}</select></label>
        </div>
        <div class="pos-quick-tabs" role="group" aria-label="Vistas rapidas">
          <button type="button" class="secondary" data-pos-view="">Buscar</button>
          <button type="button" class="secondary" data-pos-view="recientes">Recientes</button>
          <button type="button" class="secondary" data-pos-view="mas_vendidos">Más vendidos</button>
          <button type="button" class="secondary" data-pos-view="favoritos">Favoritos</button>
        </div>
        <div id="posResults" class="pos-results"></div>
      </section>
      <aside class="panel pos-cart-panel">
        <div class="cart-head"><div><h3>Venta actual</h3><p class="muted" id="posCartCount">0 productos</p></div></div>
        <div id="posCartItems" class="pos-cart-items"></div>
        <div class="pos-customer-grid">
          <label>Buscar cliente<input id="posClientSearch" placeholder="Nombre o teléfono"></label>
          <label>Cliente<select id="posClient"><option value="">Cliente ocasional</option>${state.clientes.map((client) => `<option value="${client.idCliente}">${escapeHtml(client.nombre)}</option>`).join('')}</select></label>
        </div>
        <div class="pos-charge-box">
          <label>Descuento general (Bs)<input id="posDiscount" type="number" min="0" step="0.01" value="0"></label>
          <label>Forma de cobro<select id="posPaymentMode">
            <option value="efectivo">Efectivo</option><option value="qr">QR</option>
            <option value="mixto">Mixto o parcial</option><option value="fiado">Totalmente fiado</option>
          </select></label>
          <div id="posPaymentFields" class="pos-payment-fields"></div>
          <div class="pos-total-grid"><span>Subtotal <strong id="posSubtotal">Bs 0.00</strong></span><span>Total <strong id="posTotal">Bs 0.00</strong></span></div>
          <div id="posPaymentSummary" class="pos-payment-summary"></div>
        </div>
        <button type="submit" id="posSubmit" class="wide-button">Registrar y cobrar</button>
      </aside>
    </form>`;
  const search = document.getElementById('posSearch');
  search.focus();
  search.addEventListener('input', () => {
    clearTimeout(posSearchTimer);
    posSearchTimer = setTimeout(() => loadPosProducts(), 180);
  });
  search.addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const code = search.value.trim();
    if (!code) return;
    const now = Date.now();
    if (lastBarcodeScan.value === code && now - lastBarcodeScan.at < 500) return;
    lastBarcodeScan = { value: code, at: now };
    try {
      const data = await api(`/api/pos/productos?q=${encodeURIComponent(code)}&limit=20`);
      const exact = data.productos.find((product) => String(product.codigoBarrasDisponible || product.codigoBarras || '') === code);
      if (exact) {
        addPosProduct(exact);
        search.value = '';
        loadPosProducts();
      } else if (data.productos.length === 1) addPosProduct(data.productos[0]);
      else showError('No se encontró un producto con ese código.');
    } catch (error) { showError(error.message); }
  });
  document.getElementById('posCategory').addEventListener('change', () => loadPosProducts());
  view.querySelectorAll('[data-pos-view]').forEach((button) => button.addEventListener('click', () => loadPosProducts(button.dataset.posView)));
  document.getElementById('posPaymentMode').addEventListener('change', renderPosPaymentFields);
  document.getElementById('posDiscount').addEventListener('input', renderPosPaymentSummary);
  document.getElementById('posClientSearch').addEventListener('input', async (event) => {
    try {
      const clients = await api(`/api/pos/clientes?q=${encodeURIComponent(event.target.value)}`);
      const select = document.getElementById('posClient');
      const selected = select.value;
      select.innerHTML = `<option value="">Cliente ocasional</option>${clients.map((client) => `<option value="${client.idCliente}" ${String(client.idCliente) === selected ? 'selected' : ''}>${escapeHtml(client.nombre)}${client.telefono ? ` · ${escapeHtml(client.telefono)}` : ''}</option>`).join('')}`;
    } catch (error) { showMessage(error.message, true); }
  });
  document.getElementById('posForm').addEventListener('submit', submitPosSale);
  renderPosCart();
  renderPosPaymentFields();
  await loadPosProducts('recientes');
}
async function compras() { operationView('compras'); }

async function historialVentas() {
  view.innerHTML = `<div class="panel table-wrap"><table>
    <thead><tr><th>Comprobante</th><th>Fecha</th><th>Cliente</th><th>Total</th><th>Pagado</th><th>Saldo</th><th>Métodos</th><th>Estado</th><th>Acciones</th></tr></thead>
    <tbody>${state.ventas.map((v) => `<tr><td>${escapeHtml(v.codigoComprobante || `Venta #${v.idVenta}`)}</td><td>${formatDate(v.fecha)}</td><td>${escapeHtml(v.cliente)}</td><td>Bs ${money(v.total)}</td><td>Bs ${money(v.montoPagado)}</td><td class="${Number(v.saldoActualFiado ?? v.saldoPendiente) > 0 ? 'text-danger' : 'text-ok'}">Bs ${money(v.saldoActualFiado ?? v.saldoPendiente)}</td><td>${escapeHtml(String(v.metodosPago || 'No especificado').replaceAll(',', ', '))}</td><td>${statusBadge(v.estadoPago === 'pagada' ? 'pagado' : v.estadoPago)}</td><td><div class="actions"><button class="small secondary" data-detail="${v.idVenta}">Detalle</button><button class="small" data-receipt="${v.idVenta}">Comprobante</button></div></td></tr>`).join('')}</tbody>
  </table></div>`;
  view.querySelectorAll('[data-detail]').forEach((btn) => btn.addEventListener('click', () => showSaleDetail(btn.dataset.detail)));
  view.querySelectorAll('[data-receipt]').forEach((btn) => btn.addEventListener('click', async () => {
    try { showSaleReceipt(await api(`/api/ventas/${btn.dataset.receipt}/comprobante`)); } catch (error) { showError(error.message); }
  }));
}

async function showSaleDetailLegacy(idVenta) {
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

async function showSaleDetail(idVenta) {
  try {
    const data = await api(`/api/ventas/${idVenta}`);
    const v = data.venta;
    await modal({
      title: `Venta #${v.idVenta}`,
      wide: true,
      confirmText: 'Cerrar',
      body: `
        <p>${escapeHtml(v.codigoComprobante || `Venta #${v.idVenta}`)} · ${formatDate(v.fecha)} · ${escapeHtml(v.cliente)} · Bs ${money(v.total)}</p>
        <p>Pagado: <strong>Bs ${money(v.montoPagado)}</strong> · Saldo actual: <strong class="${Number(v.saldoActualFiado ?? v.saldoPendiente) > 0 ? 'text-danger' : 'text-ok'}">Bs ${money(v.saldoActualFiado ?? v.saldoPendiente)}</strong> ${statusBadge(v.estadoPago === 'pagada' ? 'pagado' : v.estadoPago)}</p>
        <p>${data.pagos.length ? data.pagos.map((payment) => `${escapeHtml(payment.metodoPago)}: <strong>Bs ${money(payment.monto)}</strong>${payment.referencia ? ` (${escapeHtml(payment.referencia)})` : ''}`).join(' · ') : 'Sin desglose de pagos para esta venta histórica.'}</p>
        ${v.idFiado ? `<p><button type="button" class="secondary" data-open-debt="${v.idFiado}" data-client="${v.idCliente || ''}" data-client-name="${escapeHtml(v.cliente)}">Ver en Fiados/Pagos</button></p>` : ''}
        <p><button type="button" class="secondary" data-open-receipt="${v.idVenta}">Ver comprobante</button></p>
        <div class="table-wrap"><table><thead><tr><th>Producto</th><th>Cantidad</th><th>Presentación</th><th>Unidades</th><th>Precio</th><th>Costo</th><th>Ganancia</th></tr></thead>
        <tbody>${data.detalle.map((d) => `<tr><td>${escapeHtml(d.nombre)}</td><td>${intValue(d.cantidad)}</td><td>${escapeHtml(d.presentacionVenta)}</td><td>${intValue(d.cantidadEquivalenteUnidades)}</td><td>Bs ${money(d.subtotal)}</td><td>Bs ${money(d.subtotalCosto)}</td><td>Bs ${money(d.ganancia)}</td></tr>`).join('')}</tbody></table></div>`,
      onOpen: (root) => {
        const button = root.querySelector('[data-open-debt]');
        if (button) button.addEventListener('click', () => {
          debtFocus = {
            idFiado: button.dataset.openDebt,
            idCliente: button.dataset.client,
            cliente: button.dataset.clientName
          };
          modalRoot.innerHTML = '';
          loadView('pagos').catch((error) => showError(error.message));
        });
        root.querySelector('[data-open-receipt]').addEventListener('click', async () => {
          try { showSaleReceipt(await api(`/api/ventas/${v.idVenta}/comprobante`)); } catch (error) { showError(error.message); }
        });
      }
    });
  } catch (error) { showError(error.message); }
}

async function pagos() {
  view.innerHTML = `
    <div class="panel">
      <form class="grid" id="pagoForm">
        <label>Fiado activo<select name="idFiado" required>${state.fiados.filter((f) => f.estado !== 'pagado').map((f) => `<option value="${f.idFiado}">${escapeHtml(f.cliente)} - saldo Bs ${money(f.saldoPendiente)}</option>`).join('')}</select></label>
        <label>Monto<input name="monto" type="number" step="0.01" min="0.01" required></label>
        <label>Observación<input name="observacion"></label>
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

function sortDebtRows(rows) {
  const priority = { pendiente: 1, parcial: 2, pagado: 3 };
  return [...rows].sort((a, b) => {
    const stateDiff = (priority[a.estado] || 9) - (priority[b.estado] || 9);
    if (stateDiff) return stateDiff;
    const dateA = new Date(a.fechaVenta || a.fechaInicio || 0).getTime();
    const dateB = new Date(b.fechaVenta || b.fechaInicio || 0).getTime();
    return dateB - dateA;
  });
}

function debtTotalsByClient(rows) {
  return rows.reduce((acc, row) => {
    const key = String(row.idCliente || row.cliente || '');
    if (!acc[key]) acc[key] = { cliente: row.cliente, totalFiado: 0, totalPagado: 0, saldo: 0, items: [] };
    acc[key].totalFiado += Number(row.totalFiado || 0);
    acc[key].totalPagado += Number(row.totalPagado || 0);
    acc[key].saldo += Number(row.saldoPendiente || 0);
    acc[key].items.push(row);
    return acc;
  }, {});
}

function renderDebtCards(rows) {
  const target = document.getElementById('debtTable');
  const sorted = sortDebtRows(rows);
  if (!sorted.length) {
    target.innerHTML = '<p class="muted empty-state">No hay fiados para mostrar.</p>';
    return;
  }
  const totals = debtTotalsByClient(sorted);
  target.innerHTML = sorted.map((f) => {
    const clientTotal = totals[String(f.idCliente || f.cliente || '')] || { saldo: 0, items: [] };
    const focused = debtFocus?.idFiado && String(debtFocus.idFiado) === String(f.idFiado);
    const paid = f.estado === 'pagado';
    return `<article class="debt-card estado-${escapeHtml(f.estado)} ${paid ? 'is-paid' : 'is-active'} ${focused ? 'is-focused' : ''}">
      <div class="debt-card-main">
        <div>
          <strong>${escapeHtml(f.cliente)}</strong>
          <p class="muted">${formatDate(f.fechaVenta || f.fechaInicio)} · Fiado #${f.idFiado}</p>
          <p class="hint">Este cliente tiene ${clientTotal.items.length} fiado${clientTotal.items.length === 1 ? '' : 's'} · Saldo acumulado: <strong>Bs ${money(clientTotal.saldo)}</strong></p>
        </div>
        <div class="debt-card-state">${statusBadge(f.estado)}</div>
      </div>
      <div class="debt-card-values">
        <span>Total<strong>Bs ${money(f.totalFiado)}</strong></span>
        <span>Pagado<strong>Bs ${money(f.totalPagado)}</strong></span>
        <span>Saldo<strong class="${Number(f.saldoPendiente) > 0 ? 'text-danger' : 'text-ok'}">Bs ${money(f.saldoPendiente)}</strong></span>
      </div>
      <div class="debt-card-actions">
        <button class="small secondary" data-fiado="${f.idFiado}">Ver historial</button>
        <button class="small danger" data-delete-fiado="${f.idFiado}">Ocultar fiado</button>
      </div>
    </article>`;
  }).join('');
  target.querySelectorAll('[data-fiado]').forEach((btn) => btn.addEventListener('click', () => showDebtDetail(btn.dataset.fiado)));
  target.querySelectorAll('[data-delete-fiado]').forEach((btn) => btn.addEventListener('click', async () => {
    const row = sorted.find((item) => String(item.idFiado) === btn.dataset.deleteFiado);
    const password = await requestAdminPassword(`¿Deseas ocultar el fiado #${row?.idFiado || ''} de ${row?.cliente || ''}?`);
    if (!password) return;
    try {
      await api(`/api/fiados/${btn.dataset.deleteFiado}`, {
        method: 'DELETE',
        body: JSON.stringify({ passwordAdministrador: password })
      });
      debtFocus = null;
      await refreshCatalogs();
      await showSuccess('Fiado ocultado. Los pagos e historial se conservan.');
      if (document.getElementById('debtClient')) await loadDebtFilters();
      else renderDebtCards(state.fiados);
    } catch (error) { showError(error.message); }
  }));
}

async function loadDebtFilters() {
  const query = new URLSearchParams({
    idCliente: document.getElementById('debtClient').value,
    estado: document.getElementById('debtStatus').value,
    desde: document.getElementById('debtFrom').value,
    hasta: document.getElementById('debtTo').value
  });
  const rows = await api(`/api/fiados?${query.toString()}`);
  renderDebtCards(rows);
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

async function pagos() {
  const pendingRows = sortDebtRows(state.fiados.filter((f) => f.estado !== 'pagado'));
  const selectedDebt = debtFocus?.idFiado || '';
  const selectedClient = debtFocus?.idCliente || '';
  const pendingOptions = pendingRows.length
    ? pendingRows.map((f) => `<option value="${f.idFiado}" ${String(selectedDebt) === String(f.idFiado) ? 'selected' : ''}>${escapeHtml(f.cliente)} - saldo Bs ${money(f.saldoPendiente)}</option>`).join('')
    : '<option value="">No hay fiados pendientes</option>';
  view.innerHTML = `
    <div class="panel payment-panel">
      <div class="panel-title">
        <div>
          <h3>Registrar pago</h3>
          <p class="muted">Selecciona un fiado pendiente o parcial para registrar un pago.</p>
        </div>
      </div>
      <form class="grid" id="pagoForm">
        <label>Fiado pendiente<select name="idFiado" required>${pendingOptions}</select></label>
        <label>Monto<input name="monto" type="number" step="0.01" min="0.01" required></label>
        <label>Observación<input name="observacion"></label>
        <button type="submit">Registrar pago</button>
      </form>
    </div>
    <div class="panel debt-tools">
      <div class="panel-title">
        <div>
          <h3>Fiados / Pagos</h3>
          <p class="muted">Pendientes y parciales aparecen primero. Los pagados quedan como historial.</p>
        </div>
        <div class="debt-tool-actions">
          <button type="button" class="secondary small" id="showHiddenDebts">Ver fiados ocultos</button>
          <button type="button" class="secondary small" id="toggleDebtFilters">Mostrar filtros</button>
        </div>
      </div>
      ${debtFocus ? `<p class="focus-note">Mostrando fiados relacionados con ${escapeHtml(debtFocus.cliente || 'el cliente seleccionado')}.</p>` : ''}
      <div class="filter-bar is-hidden" id="debtFilters">
        <label>Cliente<select id="debtClient">${options(state.clientes, 'idCliente', 'nombre', 'Todos', selectedClient)}</select></label>
        <label>Estado<select id="debtStatus"><option value="">Todos</option><option value="pendiente">Pendiente</option><option value="parcial">Parcial</option><option value="pagado">Pagado</option></select></label>
        <label>Desde<input id="debtFrom" type="date"></label>
        <label>Hasta<input id="debtTo" type="date"></label>
      </div>
    </div>
    <div class="debt-list" id="debtTable"></div>`;
  wireUppercase(view);
  document.getElementById('pagoForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!event.target.idFiado.value) return showError('No hay fiados pendientes para registrar pago.');
    if (!await confirmAction('¿Deseas registrar este pago de fiado?')) return;
    try {
      await api('/api/pagos-fiado', { method: 'POST', body: JSON.stringify(formData(event.target)) });
      debtFocus = null;
      await showSuccess('Pago registrado.');
      loadView('pagos');
    } catch (error) { showError(error.message); }
  });
  document.getElementById('toggleDebtFilters').addEventListener('click', () => {
    const filters = document.getElementById('debtFilters');
    const hidden = filters.classList.toggle('is-hidden');
    document.getElementById('toggleDebtFilters').textContent = hidden ? 'Mostrar filtros' : 'Ocultar filtros';
  });
  ['debtClient', 'debtStatus', 'debtFrom', 'debtTo'].forEach((id) => document.getElementById(id).addEventListener('change', () => {
    debtFocus = null;
    loadDebtFilters();
  }));
  if (selectedClient) {
    await loadDebtFilters();
  } else {
    renderDebtCards(state.fiados);
  }
}

function clientPendingDebts(idCliente) {
  return sortDebtRows(state.fiados.filter((f) => String(f.idCliente || '') === String(idCliente || '') && f.estado !== 'pagado'));
}

function clientDebtSummary(idCliente) {
  const rows = clientPendingDebts(idCliente);
  const total = rows.reduce((sum, row) => sum + Number(row.saldoPendiente || 0), 0);
  return { rows, total };
}

function renderClientPaymentSummary() {
  const clientSelect = document.getElementById('clientPaymentId');
  const amountInput = document.getElementById('clientPaymentAmount');
  const target = document.getElementById('clientDebtSummary');
  if (!clientSelect || !target) return;
  const { rows, total } = clientDebtSummary(clientSelect.value);
  if (!clientSelect.value) {
    target.innerHTML = '<p class="muted">Selecciona un cliente para ver su deuda acumulada.</p>';
    if (amountInput) amountInput.value = '';
    return;
  }
  if (!rows.length) {
    target.innerHTML = '<p class="muted">Este cliente no tiene fiados pendientes o parciales.</p>';
    if (amountInput) amountInput.value = '';
    return;
  }
  target.innerHTML = `
    <div class="accumulated-summary">
      <span>Fiados pendientes/parciales<strong>${rows.length}</strong></span>
      <span>Saldo acumulado<strong>Bs ${money(total)}</strong></span>
      <button type="button" class="secondary small" id="payClientTotal">Pagar total acumulado</button>
    </div>
    <div class="mini-debt-list">
      ${rows.slice(0, 5).map((f) => `<div><strong>#${f.idFiado}</strong><span>${formatDate(f.fechaVenta || f.fechaInicio)}</span><span>Saldo Bs ${money(f.saldoPendiente)}</span>${statusBadge(f.estado)}</div>`).join('')}
      ${rows.length > 5 ? `<p class="hint">Y ${rows.length - 5} fiado${rows.length - 5 === 1 ? '' : 's'} más en el mismo orden.</p>` : ''}
    </div>`;
  document.getElementById('payClientTotal').addEventListener('click', () => {
    amountInput.value = money(total);
  });
}

async function pagos() {
  const pendingRows = sortDebtRows(state.fiados.filter((f) => f.estado !== 'pagado'));
  const selectedDebt = debtFocus?.idFiado || '';
  const selectedClient = debtFocus?.idCliente || '';
  const pendingOptions = pendingRows.length
    ? pendingRows.map((f) => `<option value="${f.idFiado}" ${String(selectedDebt) === String(f.idFiado) ? 'selected' : ''}>${escapeHtml(f.cliente)} - saldo Bs ${money(f.saldoPendiente)}</option>`).join('')
    : '<option value="">No hay fiados pendientes</option>';
  view.innerHTML = `
    <div class="panel payment-panel">
      <div class="panel-title">
        <div>
          <h3>Registrar pago</h3>
          <p class="muted">Puedes pagar una cuenta específica o el acumulado de un cliente.</p>
        </div>
      </div>
      <form class="grid payment-form" id="pagoForm">
        <label>Modo de pago<select name="modoPago" id="paymentMode">
          <option value="fiado">Pagar fiado específico</option>
          <option value="cliente">Pagar acumulado por cliente</option>
        </select></label>

        <div class="payment-mode-section wide" id="specificPaymentFields">
          <div class="form-grid compact-fields">
            <label>Fiado pendiente<select name="idFiado">${pendingOptions}</select></label>
            <label>Monto<input name="monto" type="number" step="0.01" min="0.01"></label>
            <label>Observación<input name="observacion"></label>
          </div>
          <button type="submit">Registrar pago</button>
        </div>

        <div class="payment-mode-section wide is-hidden" id="clientPaymentFields">
          <div class="form-grid compact-fields">
            <label>Cliente<select name="idCliente" id="clientPaymentId">${options(state.clientes, 'idCliente', 'nombre', 'Seleccione cliente', selectedClient)}</select></label>
            <label>Monto acumulado<input name="montoCliente" id="clientPaymentAmount" type="number" step="0.01" min="0.01"></label>
            <label>Observación<input name="observacionCliente" value="Pago acumulado"></label>
          </div>
          <div id="clientDebtSummary" class="client-debt-summary"></div>
          <button type="submit">Registrar pago acumulado</button>
        </div>
      </form>
    </div>
    <div class="panel debt-tools">
      <div class="panel-title">
        <div>
          <h3>Fiados / Pagos</h3>
          <p class="muted">Pendientes y parciales aparecen primero. Los pagados quedan como historial.</p>
        </div>
        <div class="debt-tool-actions">
          <button type="button" class="secondary small" id="showHiddenDebts">Ver fiados ocultos</button>
          <button type="button" class="secondary small" id="toggleDebtFilters">Mostrar filtros</button>
        </div>
      </div>
      ${debtFocus ? `<p class="focus-note">Mostrando fiados relacionados con ${escapeHtml(debtFocus.cliente || 'el cliente seleccionado')}.</p>` : ''}
      <div class="filter-bar is-hidden" id="debtFilters">
        <label>Cliente<select id="debtClient">${options(state.clientes, 'idCliente', 'nombre', 'Todos', selectedClient)}</select></label>
        <label>Estado<select id="debtStatus"><option value="">Todos</option><option value="pendiente">Pendiente</option><option value="parcial">Parcial</option><option value="pagado">Pagado</option></select></label>
        <label>Desde<input id="debtFrom" type="date"></label>
        <label>Hasta<input id="debtTo" type="date"></label>
      </div>
    </div>
    <div class="debt-list" id="debtTable"></div>`;
  wireUppercase(view);

  const mode = document.getElementById('paymentMode');
  const specificFields = document.getElementById('specificPaymentFields');
  const clientFields = document.getElementById('clientPaymentFields');
  const togglePaymentMode = () => {
    const clientMode = mode.value === 'cliente';
    specificFields.classList.toggle('is-hidden', clientMode);
    clientFields.classList.toggle('is-hidden', !clientMode);
    if (clientMode) renderClientPaymentSummary();
  };
  mode.addEventListener('change', togglePaymentMode);
  document.getElementById('clientPaymentId').addEventListener('change', renderClientPaymentSummary);
  document.getElementById('showHiddenDebts').addEventListener('click', showHiddenDebts);

  document.getElementById('pagoForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    const data = formData(form);
    const clientMode = data.modoPago === 'cliente';
    if (clientMode) {
      if (!data.idCliente) return showError('Selecciona un cliente para registrar el pago acumulado.');
      const summary = clientDebtSummary(data.idCliente);
      if (!summary.rows.length) return showError('Este cliente no tiene deudas pendientes.');
      if (Number(data.montoCliente) <= 0) return showError('El pago debe ser mayor a cero.');
      if (Number(data.montoCliente) > summary.total) return showError(`El pago no puede superar el saldo acumulado de Bs ${money(summary.total)}.`);
      if (!await confirmAction('¿Deseas registrar este pago acumulado?')) return;
      try {
        await api('/api/pagos-fiado/cliente', {
          method: 'POST',
          body: JSON.stringify({ idCliente: data.idCliente, monto: data.montoCliente, observacion: data.observacionCliente })
        });
        debtFocus = null;
        await refreshCatalogs();
        await showSuccess('Pago acumulado registrado.');
        await pagos();
      } catch (error) { showError(error.message); }
      return;
    }

    if (!data.idFiado) return showError('No hay fiados pendientes para registrar pago.');
    if (Number(data.monto) <= 0) return showError('El pago debe ser mayor a cero.');
    if (!await confirmAction('¿Deseas registrar este pago de fiado?')) return;
    try {
      await api('/api/pagos-fiado', { method: 'POST', body: JSON.stringify({ idFiado: data.idFiado, monto: data.monto, observacion: data.observacion }) });
      debtFocus = null;
      await refreshCatalogs();
      await showSuccess('Pago registrado.');
      await pagos();
    } catch (error) { showError(error.message); }
  });

  document.getElementById('toggleDebtFilters').addEventListener('click', () => {
    const filters = document.getElementById('debtFilters');
    const hidden = filters.classList.toggle('is-hidden');
    document.getElementById('toggleDebtFilters').textContent = hidden ? 'Mostrar filtros' : 'Ocultar filtros';
  });
  ['debtClient', 'debtStatus', 'debtFrom', 'debtTo'].forEach((id) => document.getElementById(id).addEventListener('change', () => {
    debtFocus = null;
    loadDebtFilters();
  }));

  togglePaymentMode();
  if (selectedClient) await loadDebtFilters();
  else renderDebtCards(state.fiados);
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

const readOnlyObserver = new MutationObserver(() => applyReadOnlyUi());
readOnlyObserver.observe(view, { childList: true, subtree: true });
readOnlyObserver.observe(modalRoot, { childList: true, subtree: true });

async function initializeApp() {
  await loadContext();
  await loadView('inicio');
}

initializeApp().catch((error) => showError(error.message));
