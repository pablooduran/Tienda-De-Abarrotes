const view = document.getElementById('view');
const title = document.getElementById('viewTitle');
const subtitle = document.getElementById('viewSubtitle');
const menu = document.getElementById('menu');
const message = document.getElementById('message');
const modalRoot = document.getElementById('modalRoot');

let state = { productos: [], clientes: [], proveedores: [], fiados: [], ventas: [], categorias: [], context: null, lotAccess: null };
let debtFocus = null;
let posCart = [];
let posOperationKey = null;
let posSearchTimer = null;
let posClientSearchTimer = null;
let posClientSearchRequest = 0;
let posClientSearchOptions = [];
let posClientActiveIndex = -1;
let lastBarcodeScan = { value: '', at: 0 };
let inventoryUi = { activeTab: 'resumen', rankingMode: 'ingresos', movementClass: '', page: 1, request: 0, data: {} };
let lotUi = { page: 1, pages: 1, activeTab: 'lotes' };
let customerCreditUi = null;
let compensationUi = null;
let administrativeAuditUi = null;
let inventoryAdjustmentUi = null;
let storeConfigurationUi = null;

const sections = [
  ['inicio', 'Inicio', 'Resumen general del negocio'],
  ['productos', 'Productos', 'Catálogo, stock y presentaciones'],
  ['movimientosStock', 'Movimientos de stock', 'Entradas, salidas y ajustes del inventario'],
  ['inventarioInteligente', 'Inteligencia de inventario', 'Alertas, rotación y decisiones de abastecimiento'],
  ['inventarioOperativo', 'Conciliación de inventario', 'Stock físico, vendible y ajustes trazables'],
  ['lotesVencimientos', 'Lotes y vencimientos', 'Trazabilidad, alertas y stock vendible'],
  ['clientes', 'Clientes', 'Perfiles, credito y estados de cuenta'],
  ['proveedores', 'Proveedores', 'Registro de proveedores'],
  ['ventas', 'Punto de venta', 'Cobro rápido, pagos mixtos y comprobantes'],
  ['compras', 'Compras / stock', 'Abastecimiento por paquete o unidad'],
  ['historialVentas', 'Historial de ventas', 'Ventas realizadas y detalle'],
  ['pagos', 'Cobranza', 'Deudas, pagos, promesas y recordatorios'],
  ['gastos', 'Gastos', 'Egresos operativos y categorias'],
  ['finanzas', 'Finanzas', 'Ventas, cobros, costos y ganancias'],
  ['compensaciones', 'Devoluciones y anulaciones', 'Anulaciones, devoluciones y ajustes trazables'],
  ['configuracion', 'Configuracion', 'Datos operativos de la tienda'],
  ['auditoria', 'Auditoria', 'Acciones administrativas y resultados'],
  ['cierreCaja', 'Cierre de caja', 'Control de efectivo por periodo'],
  ['reportes', 'Reportes', 'Consultas, filtros y ganancias']
];

const navigationFamilies = [
  { id: 'inicio', label: 'Inicio', sections: ['inicio'] },
  { id: 'ventas', label: 'Ventas', sections: ['ventas', 'historialVentas', 'pagos', 'compensaciones'] },
  { id: 'inventario', label: 'Inventario', sections: ['productos', 'movimientosStock', 'compras', 'proveedores', 'inventarioInteligente', 'inventarioOperativo', 'lotesVencimientos'] },
  { id: 'clientes', label: 'Clientes', sections: ['clientes'] },
  { id: 'reportes', label: 'Reportes', sections: ['reportes', 'finanzas', 'gastos', 'cierreCaja'] },
  { id: 'administracion', label: 'Administracion y configuracion', sections: ['configuracion', 'auditoria'] },
  { id: 'plan', label: 'Mi plan', links: [{ href: '/suscripcion.html', label: 'Suscripcion, planes y pagos' }] }
];

const inventoryWorkspaceSections = ['productos', 'compras', 'movimientosStock', 'proveedores', 'lotesVencimientos', 'inventarioInteligente', 'inventarioOperativo'];
const salesWorkspaceSections = ['ventas', 'historialVentas', 'pagos', 'compensaciones'];

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

function modal({ title: modalTitle, body, confirmText = 'Cerrar', cancelText = '', danger = false, wide = false, preserveOnConfirm = false, onOpen = null }) {
  return new Promise((resolve) => {
    const returnFocus = document.activeElement;
    modalRoot.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true" aria-label="${escapeHtml(modalTitle)}">
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
      returnFocus?.focus?.();
      resolve(value);
    };
    modalRoot.querySelector('[data-modal-confirm]').addEventListener('click', () => {
      if (preserveOnConfirm) return resolve(true);
      close(true);
    });
    const cancel = modalRoot.querySelector('[data-modal-cancel]');
    if (cancel) cancel.addEventListener('click', () => close(false));
    modalRoot.querySelector('button, input, select, textarea')?.focus();
  });
}

function modalFocusableElements() {
  return Array.from(modalRoot.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
  )).filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
}

document.addEventListener('keydown', (event) => {
  if (!modalRoot.firstElementChild) return;
  if (event.key === 'Escape') {
    const close = modalRoot.querySelector('[data-modal-cancel], [data-modal-confirm]');
    if (close) {
      event.preventDefault();
      close.click();
    }
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = modalFocusableElements();
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});
function showError(error) { return modal({ title: 'No se pudo completar', body: `<p>${escapeHtml(UiPatterns.messageFor(error))}</p>`, confirmText: 'Entendido', danger: true }); }
function showSuccess(text) { return modal({ title: 'Listo', body: `<p>${escapeHtml(text)}</p>`, confirmText: 'Cerrar' }); }
function confirmAction(text, danger = false) { return modal({ title: 'Confirmar acción', body: `<p>${escapeHtml(text)}</p>`, confirmText: 'Confirmar', cancelText: 'Cancelar', danger }); }

function requestAdminPassword(actionText) {
  return new Promise((resolve) => {
    const returnFocus = document.activeElement;
    modalRoot.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal" role="dialog" aria-modal="true" aria-label="Confirmar cambio de visibilidad">
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
      returnFocus?.focus?.();
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
  const allowReadOnlyWrite = options.allowReadOnlyWrite === true;
  if (url.startsWith('/api/')
    && state.context?.soloLectura
    && !allowReadOnlyWrite
    && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    throw new Error('La suscripción está en modo de solo lectura. Puedes consultar los datos, pero no realizar cambios.');
  }
  const { allowReadOnlyWrite: _allowReadOnlyWrite, ...fetchOptions } = options;
  const response = await SecurityHttp.secureFetch(url, {
    ...fetchOptions,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = SecurityHttp.errorFromResponse(response, data, 'No se pudo completar la operación.');
    if (response.status === 401) window.location.href = '/login.html';
    if (['SUBSCRIPTION_SUSPENDED', 'SUBSCRIPTION_CANCELLED', 'SUBSCRIPTION_RESTRICTED'].includes(error.code)) {
      window.location.href = '/suscripcion.html';
    }
    throw error;
  }
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
    '[data-customer-hide]',
    '[data-customer-restore]',
    '[data-profile-restore]',
    '[data-restore-debt]',
    '[data-delete-fiado]',
    '[data-product]',
    '[data-pos-favorite]',
    '[data-finance-write]',
    '[data-inventory-write]',
    '[data-inventory-product-config]',
    '[data-lot-write]'
  ];
  document.querySelectorAll(selectors.join(',')).forEach((control) => {
    if (control.closest('[data-readonly-operational]')) return;
    if (!control.disabled) {
      control.disabled = true;
      control.title = 'Acción deshabilitada mientras la cuenta está en modo de solo lectura.';
    }
  });
}

async function loadContext() {
  state.context = await api('/api/contexto');
  state.lotAccess = await api('/api/lotes/acceso').catch(() => ({ productosControlados: 0 }));
  renderSubscriptionContext();
}

function hasFeature(code) {
  return Boolean(state.context?.caracteristicas?.includes(code));
}

function creditUi() {
  if (!customerCreditUi) {
    customerCreditUi = window.CustomerCreditUI.create({
      api,
      view,
      modalRoot,
      getState: () => state,
      hasFeature,
      escapeHtml,
      money,
      formatDate,
      showError,
      showSuccess,
      showMessage,
      newOperationKey,
      localDateValue,
      requestAdminPassword,
      refreshCatalogs,
      patterns: UiPatterns,
      secureFetch: SecurityHttp.secureFetch,
      errorFromResponse: SecurityHttp.errorFromResponse
    });
  }
  return customerCreditUi;
}

function operationalCompensationUi() {
  if (!compensationUi) {
    compensationUi = window.CompensationUI.create({
      api,
      view,
      modalRoot,
      getState: () => state,
      hasFeature,
      escapeHtml,
      money,
      formatDate,
      showError,
      showSuccess,
      showMessage,
      newOperationKey,
      secureFetch: SecurityHttp.secureFetch,
      errorFromResponse: SecurityHttp.errorFromResponse
    });
  }
  return compensationUi;
}

function auditUi() {
  if (!administrativeAuditUi) {
    administrativeAuditUi = window.AdministrativeAuditUI.create({
      api,
      root: view,
      mode: 'tenant',
      escapeHtml,
      formatDate
    });
  }
  return administrativeAuditUi;
}

function configurationUi() {
  if (!storeConfigurationUi) {
    storeConfigurationUi = window.StoreConfigurationUI.create({
      api, root: view, isReadOnly: () => Boolean(state.context?.soloLectura), patterns: UiPatterns
    });
  }
  return storeConfigurationUi;
}

async function configuracion() {
  await configurationUi().render();
}

async function auditoria() {
  await auditUi().render();
}

function inventoryOperationsUi() {
  if (!inventoryAdjustmentUi) {
    inventoryAdjustmentUi = window.InventoryAdjustmentUI.create({
      api,
      root: view,
      getProducts: () => state.productos,
      hasFeature,
      isReadOnly: () => Boolean(state.context?.soloLectura),
      escapeHtml,
      formatDate,
      newOperationKey,
      showSuccess,
      patterns: UiPatterns
    });
  }
  return inventoryAdjustmentUi;
}

async function inventarioOperativo() {
  await inventoryOperationsUi().render();
}

function hasLotOperationalAccess() {
  return ['control_lotes', 'alertas_vencimiento', 'trazabilidad_lotes', 'exportacion_lotes', 'vencimientos_lote']
    .some(hasFeature) || Number(state.lotAccess?.productosControlados || 0) > 0;
}

function sectionAllowed(id) {
  const features = state.context?.caracteristicas || [];
  if (id === 'gastos') return features.includes('gastos');
  if (id === 'finanzas') return features.includes('reportes_financieros');
  if (id === 'compensaciones') return features.includes('anulaciones_operativas');
  if (id === 'cierreCaja') return features.includes('cierre_caja');
  if (id === 'inventarioInteligente') return features.includes('inventario_resumen');
  if (id === 'inventarioOperativo') {
    return features.includes('inventario_resumen')
      || features.includes('historial_stock')
      || features.includes('ajuste_stock');
  }
  if (id === 'lotesVencimientos') return hasLotOperationalAccess();
  if (id === 'clientes') return features.includes('clientes_basico');
  if (id === 'pagos') return features.includes('fiados_basico') || features.includes('pagos_fiado');
  return true;
}

function sectionById(id) {
  return sections.find((section) => section[0] === id);
}

function familyForSection(id) {
  return navigationFamilies.find((family) => family.sections?.includes(id))?.id || null;
}

function renderMenu(activeView = 'inicio') {
  menu.innerHTML = '';
  const activeFamily = familyForSection(activeView);
  navigationFamilies.forEach((family) => {
    const destinations = (family.sections || [])
      .map((id) => sectionById(id))
      .filter((section) => section && sectionAllowed(section[0]));
    if (!destinations.length && !family.links?.length) return;

    const group = document.createElement('details');
    group.className = 'nav-family';
    group.dataset.navigationFamily = family.id;
    group.open = family.id === activeFamily;

    const summary = document.createElement('summary');
    summary.textContent = family.label;
    if (family.id === activeFamily) summary.classList.add('active');
    group.appendChild(summary);

    const items = document.createElement('div');
    items.className = 'nav-family-items';
    destinations.forEach(([id, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.dataset.view = id;
      button.className = 'nav-destination';
      button.classList.toggle('active', id === activeView);
      button.addEventListener('click', () => loadView(id));
      items.appendChild(button);
    });
    (family.links || []).forEach((link) => {
      const anchor = document.createElement('a');
      anchor.href = link.href;
      anchor.textContent = link.label;
      anchor.className = 'nav-destination nav-link';
      items.appendChild(anchor);
    });
    group.appendChild(items);
    menu.appendChild(group);
  });
}

document.getElementById('logoutBtn').addEventListener('click', async () => {
  if (!await confirmAction('¿Seguro que deseas cerrar sesión?')) return;
  await api('/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

async function refreshCatalogs({ includeClients = true } = {}) {
  const [productos, clientes, proveedores, fiados, ventas, categorias] = await Promise.all([
    api('/api/productos'),
    includeClients ? api('/api/clientes') : Promise.resolve(state.clientes),
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
  const section = sectionById(id);
  if (!section || !sectionAllowed(id)) {
    if (id !== 'inicio') return loadView('inicio');
    return;
  }
  renderMenu(id);
  title.textContent = section[1];
  subtitle.textContent = section[2];
  if (!['ventas', 'clientes', 'configuracion'].includes(id)) {
    await refreshCatalogs({ includeClients: !['ventas', 'clientes'].includes(id) });
  }
  const handlers = { inicio, productos, movimientosStock, inventarioInteligente, inventarioOperativo, lotesVencimientos, clientes, proveedores, ventas, compras, historialVentas, pagos, gastos, finanzas, compensaciones, configuracion, auditoria, cierreCaja, reportes };
  if (!handlers[id]) return loadView('inicio');
  await handlers[id]();
  renderInventoryWorkspace(id);
  renderSalesWorkspace(id);
  applyReadOnlyUi();
}

function renderInventoryWorkspace(activeId) {
  if (!inventoryWorkspaceSections.includes(activeId) || view.querySelector('.inventory-workspace-nav')) return;
  const destinations = inventoryWorkspaceSections
    .filter((id) => sectionAllowed(id))
    .map((id) => {
      const section = sectionById(id);
      return `<button type="button" data-inventory-workspace="${id}" class="${id === activeId ? 'active' : ''}" aria-current="${id === activeId ? 'page' : 'false'}">${escapeHtml(section?.[1] || id)}</button>`;
    }).join('');
  if (!destinations) return;
  view.insertAdjacentHTML('afterbegin', `<nav class="inventory-workspace-nav" aria-label="Herramientas de inventario">${destinations}</nav>`);
  view.querySelectorAll('[data-inventory-workspace]').forEach((button) => button.addEventListener('click', () => loadView(button.dataset.inventoryWorkspace)));
}

function renderSalesWorkspace(activeId) {
  if (!salesWorkspaceSections.includes(activeId) || view.querySelector('.sales-workspace-nav')) return;
  const destinations = salesWorkspaceSections
    .filter((id) => sectionAllowed(id))
    .map((id) => {
      const section = sectionById(id);
      return `<button type="button" data-sales-workspace="${id}" class="${id === activeId ? 'active' : ''}" aria-current="${id === activeId ? 'page' : 'false'}">${escapeHtml(section?.[1] || id)}</button>`;
    }).join('');
  if (!destinations) return;
  view.insertAdjacentHTML('afterbegin', `<nav class="sales-workspace-nav" aria-label="Ciclo de ventas">${destinations}</nav>`);
  view.querySelectorAll('[data-sales-workspace]').forEach((button) => button.addEventListener('click', () => loadView(button.dataset.salesWorkspace)));
}

async function compensaciones() {
  await operationalCompensationUi().render();
}

function chartTooltip(canvas) {
  const panel = canvas.closest('.panel') || canvas.parentElement;
  if (!panel) return null;
  panel.classList.add('chart-tooltip-host');
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
  const [data, financeData] = await Promise.all([
    api('/api/dashboard'),
    state.context?.caracteristicas?.includes('dashboard_financiero')
      ? api('/api/dashboard/financiero?periodo=hoy').catch(() => null)
      : Promise.resolve(null)
  ]);
  const finance = financeData?.resumen || null;
  const financeNet = finance
    ? (finance.rentabilidadCompleta ? finance.gananciaNeta : finance.gananciaNetaCalculable)
    : 0;
  const financeGross = finance
    ? (finance.rentabilidadCompleta ? finance.gananciaBruta : finance.gananciaBrutaCalculable)
    : Number(data.gananciaHoy || 0);
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
        <h3>Resumen de hoy</h3>
        <p>Ventas, cobros, inventario y alertas para decidir que revisar.</p>
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
      <div class="card metric-card"><span>${finance?.rentabilidadCompleta === false ? 'Ganancia bruta calculable' : 'Ganancia bruta hoy'}</span><strong>Bs ${money(financeGross)}</strong></div>
      ${finance ? `<div class="card metric-card collected"><span>Cobrado hoy</span><strong>Bs ${money(finance.dineroCobrado)}</strong></div>
      <div class="card metric-card debt"><span>Fiado generado hoy</span><strong>Bs ${money(finance.fiadoGenerado)}</strong></div>
      <div class="card metric-card expense"><span>Gastos hoy</span><strong>Bs ${money(finance.gastos)}</strong></div>
      <div class="card metric-card net ${Number(financeNet) < 0 ? 'negative' : ''}"><span>${finance.rentabilidadCompleta ? 'Ganancia neta hoy' : 'Ganancia neta calculable'}</span><strong>Bs ${money(financeNet)}</strong></div>` : ''}
      <div class="card metric-card"><span>Bajo stock</span><strong>${data.bajoStock}</strong></div>
      <div class="card metric-card"><span>Fiados activos</span><strong>${activeDebts}</strong></div>
    </div>
    <div class="dashboard-grid modern-dashboard">
      <div class="panel chart-panel chart-panel-wide">
        <div class="panel-title"><div><h3>Ventas de los últimos 5 días</h3><p class="muted">Hoy, ayer y los 3 días anteriores.</p></div></div>
        <canvas id="dailyBars"></canvas>
      </div>
      <details class="dashboard-period-detail">
        <summary><span>Ver detalle del período</span><small>Participación de cada día en el total.</small></summary>
        <div class="dashboard-period-detail-body"><canvas id="dailyPie"></canvas></div>
      </details>
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

function renderCrud(type, rows, fields, idField, ui = {}) {
  const primaryAction = ui.primaryAction || 'Guardar';
  const groupedActions = Boolean(ui.groupedActions);
  const formHtml = (row = {}) => `
    <form class="grid" id="${type}Form" data-id="${row[idField] || ''}">
      ${fields.map((field) => `<label>${field.label}<input name="${field.name}" value="${escapeHtml(row[field.name] || '')}" ${field.phone ? 'inputmode="numeric" pattern="[0-9]*"' : ''} ${field.required ? 'required' : ''}></label>`).join('')}
      <button type="submit">${row[idField] ? 'Guardar cambios' : primaryAction}</button>
    </form>`;
  const table = rows.length ? `<div class="panel table-wrap"><table>
      <thead><tr>${fields.map((f) => `<th>${f.label}</th>`).join('')}<th>Acciones</th></tr></thead>
      <tbody>${rows.map((row) => `<tr>${fields.map((f) => `<td>${escapeHtml(row[f.name] || '')}</td>`).join('')}<td class="actions"><button class="small secondary" data-edit="${row[idField]}">Editar</button>${groupedActions ? `<details class="row-actions"><summary>Más opciones</summary><button class="small danger" data-delete="${row[idField]}">Eliminar</button></details>` : `<button class="small danger" data-delete="${row[idField]}">Eliminar</button>`}</td></tr>`).join('')}</tbody>
    </table></div>` : `<div class="panel">${UiPatterns.empty(ui.emptyTitle || 'Sin registros', ui.emptyDescription || 'Aún no hay registros para mostrar.')}</div>`;
  view.innerHTML = `<section class="inventory-crud-heading"><div><h3>${escapeHtml(ui.title || '')}</h3><p>${escapeHtml(ui.description || '')}</p></div></section><div class="panel">${formHtml()}</div>${table}`;
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
  const restoreMutation = UiPatterns.mutation(form.querySelector('button[type="submit"]'), form.dataset.id ? 'Guardando...' : 'Guardando...');
  if (!restoreMutation) return;
  const data = formData(form);
  if ('telefono' in data && !validatePhoneValue(data.telefono)) {
    await showError('El teléfono solo debe contener números.');
    restoreMutation();
    return;
  }
  const id = form.dataset.id;
  try {
    await api(`/api/${type}${id ? `/${id}` : ''}`, { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) });
    await showSuccess('Registro guardado.');
    loadView(type);
  } catch (error) { showError(error); } finally { restoreMutation(); }
}

async function clientes() {
  return creditUi().renderCustomers();
}

async function proveedores() {
  renderCrud('proveedores', state.proveedores, [
    { name: 'nombre', label: 'Nombre', required: true, upper: true },
    { name: 'telefono', label: 'Teléfono', phone: true },
    { name: 'direccion', label: 'Dirección', upper: true }
  ], 'idProveedor', {
    title: 'Proveedores',
    description: 'Mantén los contactos de abastecimiento junto a tus productos y compras.',
    primaryAction: 'Agregar proveedor',
    groupedActions: true,
    emptyTitle: 'Aún no tienes proveedores',
    emptyDescription: 'Registra un proveedor cuando necesites asociarlo a una compra o producto.'
  });
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
  const ok = await modal({ title: isEdit ? 'Editar producto' : 'Añadir producto', body: productForm(row), confirmText: isEdit ? 'Guardar cambios' : 'Agregar producto', cancelText: 'Cancelar', wide: true, preserveOnConfirm: true, onOpen: wireProductForm });
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
    await loadView('productos');
    document.querySelector(isEdit ? `[data-edit="${row.idProducto}"]` : '#addProduct')?.focus();
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
  if (!rows.length) {
    target.innerHTML = UiPatterns.empty('Aún no tienes productos', 'Registra tu primer producto para comenzar a controlar existencias.',
      !state.context?.soloLectura ? '<button type="button" data-empty-add-product>Agregar producto</button>' : '');
    target.querySelector('[data-empty-add-product]')?.addEventListener('click', () => openProductModal());
    return;
  }
  target.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Nombre</th><th>Proveedor</th><th>Categoría</th><th>Precio</th><th>Stock</th><th>Presentación</th><th>Estado</th><th>Acciones</th></tr></thead>
    <tbody>${rows.map((p) => `<tr class="${p.bajoStock ? 'low-stock' : ''}">
      <td>${escapeHtml(p.nombre)}</td><td>${escapeHtml(p.proveedor || 'SIN PROVEEDOR')}</td><td>${escapeHtml(p.categoria)}</td>
      <td>Bs ${money(p.precioVenta)}</td><td>${stockLabel(p)}</td><td>${packageText(p)}</td>
      <td>${p.bajoStock ? '<span class="badge pendiente">Bajo stock</span>' : '<span class="badge pagado">Normal</span>'}${Number(p.controlaLotes) ? `<span class="lot-control-label">Lotes${Number(p.controlaVencimiento) ? ' y vencimiento' : ''}</span>` : ''}</td>
      <td class="actions"><button class="small secondary" data-edit="${p.idProducto}">Editar</button><details class="row-actions"><summary>Más opciones</summary>${hasFeature('ajuste_stock') && !state.context?.soloLectura ? `<button class="small" data-adjust-stock="${p.idProducto}">Ajustar stock</button>` : ''}<button class="small secondary" data-product-movements="${p.idProducto}">Ver movimientos</button>${Number(p.controlaLotes) || hasFeature('control_lotes') ? `<button class="small secondary" data-lot-config="${p.idProducto}">${Number(p.controlaLotes) ? 'Configurar lotes' : 'Activar lotes'}</button>` : ''}<button class="small danger" data-delete="${p.idProducto}">Ocultar</button></details></td>
    </tr>`).join('')}</tbody></table></div>`;
  target.querySelectorAll('[data-edit]').forEach((btn) => btn.addEventListener('click', () => openProductModal(state.productos.find((p) => String(p.idProducto) === btn.dataset.edit))));
  target.querySelectorAll('[data-adjust-stock]').forEach((btn) => btn.addEventListener('click', () => openStockAdjustment(state.productos.find((p) => String(p.idProducto) === btn.dataset.adjustStock))));
  target.querySelectorAll('[data-product-movements]').forEach((btn) => btn.addEventListener('click', () => openProductMovements(btn.dataset.productMovements)));
  target.querySelectorAll('[data-lot-config]').forEach((btn) => btn.addEventListener('click', () => openLotProductConfiguration(state.productos.find((p) => String(p.idProducto) === btn.dataset.lotConfig))));
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
    <section class="inventory-product-heading"><div><h3>Productos</h3><p>Tu punto principal para consultar el catálogo y decidir el siguiente paso de inventario.</p></div>${state.context?.soloLectura ? '<span class="muted">Modo solo lectura</span>' : '<button id="addProduct">Agregar producto</button>'}</section>
    <div class="panel toolbar inventory-product-toolbar">
      <details class="inventory-secondary-actions"><summary>Más opciones</summary><div><button id="addFromCatalog" class="secondary">Agregar desde catálogo</button><button id="showHiddenProducts" class="secondary">Ver productos ocultos</button>${hasLotOperationalAccess() ? '<button id="openLots" class="secondary">Lotes y vencimientos</button>' : ''}</div></details>
      <label>Buscar<input id="productSearch" placeholder="Buscar producto"></label>
      <label>Categoría<select id="productCategory"><option value="">Todas</option>${categoryOptions()}</select></label>
      <label>Proveedor<select id="productProvider">${options(state.proveedores, 'idProveedor', 'nombre', 'Todos')}</select></label>
      <label class="check"><input id="productLowStock" type="checkbox"> Bajo stock</label>
      <label>Orden<select id="productSort"><option value="">Nombre</option><option value="precio_desc">Más caro</option><option value="precio_asc">Más barato</option></select></label>
    </div>
    <div class="panel" id="productTable"></div>`;
  wireUppercase(view);
  document.getElementById('addProduct')?.addEventListener('click', () => openProductModal());
  document.getElementById('addFromCatalog').addEventListener('click', openMasterCatalogPicker);
  document.getElementById('showHiddenProducts').addEventListener('click', openHiddenProducts);
  document.getElementById('openLots')?.addEventListener('click', () => loadView('lotesVencimientos'));
  ['productSearch', 'productCategory', 'productProvider', 'productLowStock', 'productSort'].forEach((id) => {
    document.getElementById(id).addEventListener('input', updateProductFilterCount);
    document.getElementById(id).addEventListener('change', updateProductFilterCount);
  });
  collapseProductFilters();
  renderProductTable(state.productos);
}

function updateProductFilterCount() {
  const count = ['productSearch', 'productCategory', 'productProvider', 'productLowStock', 'productSort']
    .map((id) => document.getElementById(id))
    .filter((control) => control && (control.type === 'checkbox' ? control.checked : control.value)).length;
  const target = document.querySelector('[data-filter-count]');
  if (target) target.textContent = count;
}

function collapseProductFilters() {
  const toolbar = document.querySelector('#productSearch')?.closest('.toolbar');
  if (!toolbar || toolbar.querySelector('.filter-disclosure')) return;
  const controls = ['productSearch', 'productCategory', 'productProvider', 'productLowStock', 'productSort']
    .map((id) => document.getElementById(id)?.closest('label')).filter(Boolean);
  if (!controls.length) return;
  const disclosure = document.createElement('details');
  disclosure.className = 'filter-disclosure';
  disclosure.innerHTML = '<summary>Filtros <span class="filter-count" data-filter-count>0</span></summary><div class="filter-disclosure-body"><div class="filter-actions"><button type="button" class="secondary" data-clear-product-filters>Limpiar filtros</button><button type="button" data-apply-product-filters>Aplicar</button></div></div>';
  const body = disclosure.querySelector('.filter-disclosure-body');
  controls.forEach((control) => body.insertBefore(control, body.firstChild));
  toolbar.appendChild(disclosure);
  document.querySelector('[data-apply-product-filters]').addEventListener('click', filterProductsLocal);
  document.querySelector('[data-clear-product-filters]').addEventListener('click', () => {
    ['productSearch', 'productCategory', 'productProvider', 'productSort'].forEach((id) => { document.getElementById(id).value = ''; });
    document.getElementById('productLowStock').checked = false;
    updateProductFilterCount();
    filterProductsLocal();
  });
  updateProductFilterCount();
}

function compactInventoryFilters(form, controlIds, ignoredValues = {}) {
  if (!form || form.querySelector('.filter-disclosure')) return () => {};
  const controlFor = (id) => document.getElementById(id) || form.elements[id];
  const controls = controlIds.map((id) => controlFor(id)?.closest('label')).filter(Boolean);
  if (!controls.length) return () => {};
  const disclosure = document.createElement('details');
  disclosure.className = 'filter-disclosure inventory-filter-disclosure';
  disclosure.innerHTML = '<summary>Filtros <span class="filter-count" data-filter-count>0</span></summary><div class="filter-disclosure-body"></div>';
  const body = disclosure.querySelector('.filter-disclosure-body');
  controls.forEach((control) => body.appendChild(control));
  const firstAction = form.querySelector('.filter-actions');
  if (firstAction) form.insertBefore(disclosure, firstAction);
  else form.appendChild(disclosure);
  const update = () => {
    const count = controlIds.map((id) => controlFor(id)).filter((control) => {
      if (!control) return false;
      if (control.type === 'checkbox') return control.checked;
      return Boolean(control.value) && control.value !== String(ignoredValues[control.name] ?? '');
    }).length;
    disclosure.querySelector('[data-filter-count]').textContent = String(count);
  };
  controlIds.forEach((id) => controlFor(id)?.addEventListener('input', update));
  controlIds.forEach((id) => controlFor(id)?.addEventListener('change', update));
  update();
  return update;
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
  if (!rows.length) return UiPatterns.empty('Aún no hay movimientos', 'Las compras, ventas y ajustes aparecerán aquí sin cambiar el stock actual.');
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
    const returnFocus = document.activeElement;
    modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="stockAdjustmentTitle">
      <h3 id="stockAdjustmentTitle">Ajustar stock de ${escapeHtml(product.nombre)}</h3>
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
      returnFocus?.focus?.();
      resolve(value);
    };
    modalRoot.querySelector('[data-modal-cancel]').addEventListener('click', () => close(null));
    modalRoot.querySelector('[data-modal-confirm]').addEventListener('click', () => {
      if (!form.reportValidity()) return;
      close(formData(form));
    });
    form.querySelector('[name="nuevoStock"]')?.focus();
  });
}

async function requestLotStockAdjustment(product) {
  const returnFocus = document.activeElement;
  const snapshot = await api(`/api/productos/${product.idProducto}/lotes-disponibles`);
  const operationKey = newOperationKey();
  const expiredStock = snapshot.lotes.filter((lot) => lot.motivoNoVendible === 'vencido')
    .reduce((sum, lot) => sum + Number(lot.cantidadRestante || 0), 0);
  const blockedStock = snapshot.lotes.filter((lot) => lot.motivoNoVendible === 'bloqueado')
    .reduce((sum, lot) => sum + Number(lot.cantidadRestante || 0), 0);
  return new Promise((resolve) => {
    modalRoot.innerHTML = `<div class="modal-backdrop"><form class="modal modal-wide" id="lotStockAdjustmentForm" role="dialog" aria-modal="true" aria-labelledby="lotAdjustmentTitle">
      <h3 id="lotAdjustmentTitle">Ajustar lotes de ${escapeHtml(product.nombre)}</h3><div class="modal-body">
        <div class="lot-balance-strip"><span>Stock general<strong>${escapeHtml(snapshot.stockGeneral)}</strong></span><span>Stock trazado<strong>${escapeHtml(snapshot.stockTrazado)}</strong></span><span>Stock vendible<strong>${escapeHtml(snapshot.stockVendible)}</strong></span><span>Stock vencido<strong>${escapeHtml(expiredStock)}</strong></span><span>Stock bloqueado<strong>${escapeHtml(blockedStock)}</strong></span></div>
        <div class="form-grid"><label>Tipo de ajuste<select name="modoLotes"><option value="ajuste_positivo">Agregar stock con nuevos lotes</option><option value="ajuste_negativo">Retirar stock por FEFO/FIFO</option></select></label><label>Cantidad en unidades base<input name="cantidadAjuste" type="number" min="1" step="1" value="1" required></label></div>
        <div data-positive-lots><div class="purchase-lot-heading"><div><strong>Nuevos lotes</strong><p>La suma debe coincidir con la cantidad agregada.</p></div><button type="button" class="secondary small" data-add-adjustment-lot>Agregar lote</button></div><div class="lot-entry-list" data-adjustment-lot-rows>${lotEntryRow(0, { requiresExpiration: Number(product.controlaVencimiento) === 1, quantity: 1 })}</div><strong data-adjustment-lot-summary></strong></div>
        <div class="inventory-note" data-negative-note hidden><strong>Salida automática</strong><p>El sistema retirará primero los lotes según ${Number(product.controlaVencimiento) ? 'FEFO' : 'FIFO'}. No puede usarse un conteo objetivo ambiguo.</p></div>
        <div class="form-grid"><label>Motivo<input name="motivo" minlength="5" maxlength="160" required></label><label>Contraseña actual<input name="password" type="password" autocomplete="current-password" required></label><label class="wide">Observación<textarea name="observacion" maxlength="500" rows="3"></textarea></label></div>
        <div class="inventory-note" data-adjustment-confirm hidden><strong>Confirme el ajuste</strong><p>El stock general y los lotes se actualizarán en la misma operación.</p></div>
        <p class="form-error" data-adjustment-error aria-live="polite"></p>
      </div><div class="modal-actions"><button type="button" class="secondary" data-modal-cancel>Cancelar</button><button type="submit" data-lot-write>Revisar ajuste</button></div>
    </form></div>`;
    const form = document.getElementById('lotStockAdjustmentForm');
    const rows = form.querySelector('[data-adjustment-lot-rows]');
    let nextIndex = 1;
    const update = () => {
      const quantity = Number(form.elements.cantidadAjuste.value || 0);
      const total = collectLotEntryRows(rows).reduce((sum, entry) => sum + Number(entry.cantidad || 0), 0);
      const summary = form.querySelector('[data-adjustment-lot-summary]');
      summary.textContent = `Distribuido: ${total} · requerido: ${quantity}`;
      summary.classList.toggle('text-danger', total !== quantity);
      summary.classList.toggle('text-ok', total === quantity);
    };
    const wireRow = (row) => {
      row.querySelectorAll('input').forEach((input) => input.addEventListener('input', update));
      row.querySelector('[data-remove-lot]').addEventListener('click', () => { row.remove(); update(); });
    };
    rows.querySelectorAll('[data-lot-entry]').forEach(wireRow);
    form.querySelector('[data-add-adjustment-lot]').addEventListener('click', () => {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = lotEntryRow(nextIndex++, { requiresExpiration: Number(product.controlaVencimiento) === 1 });
      const row = wrapper.firstElementChild;
      rows.appendChild(row);
      wireRow(row);
      update();
    });
    const setMode = () => {
      const positive = form.elements.modoLotes.value === 'ajuste_positivo';
      form.querySelector('[data-positive-lots]').hidden = !positive;
      form.querySelector('[data-negative-note]').hidden = positive;
      update();
    };
    form.elements.modoLotes.addEventListener('change', setMode);
    form.elements.cantidadAjuste.addEventListener('input', () => {
      const entries = rows.querySelectorAll('[data-lot-entry]');
      if (entries.length === 1) entries[0].querySelector('[name="cantidad"]').value = form.elements.cantidadAjuste.value;
      update();
    });
    form.addEventListener('input', () => {
      delete form.dataset.confirmed;
      form.querySelector('[data-adjustment-confirm]').hidden = true;
      form.querySelector('button[type="submit"]').textContent = 'Revisar ajuste';
    });
    const close = (value) => {
      form.elements.password.value = '';
      modalRoot.innerHTML = '';
      returnFocus?.focus?.();
      resolve(value);
    };
    form.querySelector('[data-modal-cancel]').addEventListener('click', () => close(null));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const errorTarget = form.querySelector('[data-adjustment-error]');
      errorTarget.textContent = '';
      const quantity = Number(form.elements.cantidadAjuste.value);
      const positive = form.elements.modoLotes.value === 'ajuste_positivo';
      if (!Number.isInteger(quantity) || quantity <= 0) { errorTarget.textContent = 'La cantidad debe ser un entero mayor a cero.'; return; }
      if (!positive && quantity > Number(snapshot.stockVendible)) { errorTarget.textContent = 'La cantidad supera el stock vendible disponible.'; return; }
      const lots = positive ? collectLotEntryRows(rows) : [];
      if (positive && (!lots.length || lots.some((entry) => !Number.isInteger(entry.cantidad) || entry.cantidad <= 0)
        || lots.reduce((sum, entry) => sum + entry.cantidad, 0) !== quantity)) {
        errorTarget.textContent = 'Los nuevos lotes deben sumar exactamente la cantidad agregada.';
        return;
      }
      if (positive && Number(product.controlaVencimiento) && lots.some((entry) => !entry.fechaVencimiento)) {
        errorTarget.textContent = 'Todos los lotes requieren fecha de vencimiento.';
        return;
      }
      if (form.dataset.confirmed !== 'true') {
        form.dataset.confirmed = 'true';
        form.querySelector('[data-adjustment-confirm]').hidden = false;
        form.querySelector('button[type="submit"]').textContent = 'Registrar ajuste ahora';
        return;
      }
      close({
        nuevoStock: Number(snapshot.stockGeneral) + (positive ? quantity : -quantity),
        modoLotes: form.elements.modoLotes.value,
        lotes: positive ? lots : undefined,
        motivo: form.elements.motivo.value,
        observacion: form.elements.observacion.value,
        password: form.elements.password.value,
        claveOperacion: operationKey
      });
    });
    setMode();
    form.elements.cantidadAjuste.focus();
  });
}

async function openStockAdjustment(product) {
  if (!product) return;
  inventoryOperationsUi().openAdjustment(product.idProducto, document.activeElement);
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
    <section class="inventory-section-heading"><div><h3>Stock y movimientos</h3><p>Consulta el stock actual en Productos; aquí revisa solamente su historial de entradas, salidas y ajustes.</p></div></section>
    <form class="panel movement-filters" id="movementFilters">
      <label>Producto<input id="movementSearch" name="q" type="search" placeholder="Buscar producto"></label>
      <label>Tipo<select id="movementType" name="tipo"><option value="">Todos</option><option value="entrada">Entrada</option><option value="salida">Salida</option><option value="ajuste_positivo">Ajuste positivo</option><option value="ajuste_negativo">Ajuste negativo</option><option value="inventario_inicial">Inventario inicial</option></select></label>
      <label>Origen<select id="movementOrigin" name="origen"><option value="">Todos</option><option value="compra">Compra</option><option value="venta">Venta</option><option value="ajuste_manual">Ajuste manual</option><option value="alta_producto">Alta de producto</option><option value="migracion_inicial">Migración inicial</option></select></label>
      <label>Desde<input id="movementFrom" name="desde" type="date"></label><label>Hasta<input id="movementTo" name="hasta" type="date"></label>
      <label>Responsable<select id="movementOwner" name="idAdministrador"><option value="">Todos</option></select></label>
      <div class="filter-actions"><button type="submit">Aplicar filtros</button><button type="button" class="secondary" id="clearMovementFilters">Limpiar filtros</button></div>
    </form>
    <div class="panel" id="movementResults">${UiPatterns.skeleton('rows', 4)}</div>
    <div class="movement-pagination"><button id="movementPrevious" class="secondary">Anterior</button><span id="movementPage">Página 1</span><button id="movementNext" class="secondary">Siguiente</button></div>`;
  let currentPage = 1;
  const load = async (page = 1) => {
    const results = document.getElementById('movementResults');
    results.innerHTML = UiPatterns.skeleton('rows', 4);
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
    try {
      const data = await api(`/api/movimientos-stock?${query}`);
      currentPage = data.page;
      results.innerHTML = movementTable(data.rows);
      const owner = document.getElementById('movementOwner');
      const selected = owner.value;
      owner.innerHTML = options(data.responsables, 'idAdministrador', 'usuario', 'Todos', selected);
      document.getElementById('movementPage').textContent = `Página ${data.page} de ${data.pages}`;
      document.getElementById('movementPrevious').disabled = data.page <= 1;
      document.getElementById('movementNext').disabled = data.page >= data.pages;
    } catch (error) {
      results.innerHTML = UiPatterns.empty('No se pudieron cargar los movimientos', UiPatterns.messageFor(error), '<button type="button" class="secondary" data-retry-movements>Reintentar</button>');
      results.querySelector('[data-retry-movements]')?.addEventListener('click', () => load(page));
    }
  };
  const form = document.getElementById('movementFilters');
  const updateMovementFilters = compactInventoryFilters(form, ['movementType', 'movementOrigin', 'movementFrom', 'movementTo', 'movementOwner']);
  form.addEventListener('submit', (event) => { event.preventDefault(); load(1); });
  document.getElementById('clearMovementFilters').addEventListener('click', () => { form.reset(); updateMovementFilters(); load(1); });
  document.getElementById('movementPrevious').addEventListener('click', () => load(currentPage - 1));
  document.getElementById('movementNext').addEventListener('click', () => load(currentPage + 1));
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
  const isPurchase = kind === 'compras';
  view.innerHTML = `
    ${isPurchase ? '<section class="inventory-section-heading purchase-flow-heading"><div><h3>Registrar compra</h3><p>Completa el proveedor, agrega productos con sus cantidades y costos, y confirma el abastecimiento.</p></div></section>' : ''}
    <form id="${kind}Form" class="cart-layout ${isPurchase ? 'inventory-purchase-flow' : ''}" data-operation-key="${newOperationKey()}">
      <section class="panel product-picker">
        ${isPurchase ? '<p class="purchase-step"><strong>1. Proveedor y productos</strong><span>Busca y agrega los productos que recibiste.</span></p>' : ''}
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
        ` : '<p class="purchase-step"><strong>2. Cantidades y costos</strong><span>Revisa cada producto antes de confirmar la compra.</span></p><p class="hint">Cada producto muestra su proveedor asociado para evitar confusiones.</p>'}
        <div id="items" class="cart-items"></div>
        <div id="cartWarnings" class="cart-warnings"></div>
        <div class="cart-total">
          <span>Total</span>
          <strong id="total">Bs 0.00</strong>
        </div>
        ${isPurchase ? '<p class="purchase-step purchase-confirmation"><strong>3. Confirmación</strong><span>La compra registrará sus movimientos de inventario.</span></p>' : ''}
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

function purchaseLotRow(product, quantity = '') {
  return `<div class="purchase-lot-row" data-purchase-lot-entry>
    <label>Código<input name="lotCodigo" maxlength="80" placeholder="Opcional"></label>
    <label>Vencimiento<input name="lotVencimiento" type="date" min="${localDateValue(new Date())}" ${Number(product.controlaVencimiento) ? 'required' : ''}></label>
    <label>Unidades base<input name="lotCantidad" type="number" min="1" step="1" required value="${escapeHtml(quantity)}"></label>
    <button type="button" class="danger small" data-remove-purchase-lot aria-label="Eliminar lote">Eliminar</button>
  </div>`;
}

function wirePurchaseLotEditor(row, product) {
  const editor = row.querySelector('[data-purchase-lot-editor]');
  if (!editor) return;
  const rows = editor.querySelector('[data-purchase-lot-rows]');
  const summary = editor.querySelector('[data-purchase-lot-summary]');
  const expected = () => equivalentUnitsClient(
    product,
    Number(row.querySelector('[name="cantidad"]').value || 0),
    row.querySelector('[name="presentacion"]').value,
    true
  );
  const update = () => {
    const total = [...rows.querySelectorAll('[name="lotCantidad"]')]
      .reduce((sum, input) => sum + Number(input.value || 0), 0);
    const needed = expected();
    summary.textContent = `Requerido: ${needed} unidades · distribuido: ${total} · pendiente: ${needed - total}`;
    summary.classList.toggle('text-danger', total !== needed);
    summary.classList.toggle('text-ok', total === needed);
  };
  const wire = (lotRow) => {
    lotRow.querySelector('[name="lotCantidad"]').addEventListener('input', () => {
      lotRow.dataset.edited = 'true';
      update();
    });
    lotRow.querySelector('[data-remove-purchase-lot]').addEventListener('click', () => { lotRow.remove(); update(); });
  };
  rows.querySelectorAll('[data-purchase-lot-entry]').forEach(wire);
  editor.querySelector('[data-add-purchase-lot]').addEventListener('click', () => {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = purchaseLotRow(product);
    const lotRow = wrapper.firstElementChild;
    rows.appendChild(lotRow);
    wire(lotRow);
    update();
  });
  editor.updateLotSummary = () => {
    const entries = rows.querySelectorAll('[data-purchase-lot-entry]');
    if (entries.length === 1 && entries[0].dataset.edited !== 'true') {
      entries[0].querySelector('[name="lotCantidad"]').value = expected();
    }
    const price = Number(row.querySelector('[name="precioCompra"]')?.value || 0);
    const units = expected();
    editor.querySelector('[data-purchase-unit-cost]').textContent = price > 0 && units > 0
      ? `Costo estimado por unidad base: Bs ${money((price * Number(row.querySelector('[name="cantidad"]').value || 0)) / units)}`
      : 'Ingrese el precio de compra para ver el costo unitario.';
    update();
  };
  editor.updateLotSummary();
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
    </div>
    ${isPurchase && Number(product.controlaLotes) ? `<section class="purchase-lot-editor" data-purchase-lot-editor>
      <div class="purchase-lot-heading"><div><strong>Distribución por lotes obligatoria</strong><p>${Number(product.controlaVencimiento) ? 'Cada lote requiere vencimiento.' : 'El código y vencimiento son opcionales.'}</p></div><button type="button" class="secondary small" data-add-purchase-lot>Agregar lote</button></div>
      <div class="purchase-lot-rows" data-purchase-lot-rows>${purchaseLotRow(product, 1)}</div>
      <div class="purchase-lot-summary"><span data-purchase-lot-summary></span><small data-purchase-unit-cost></small></div>
    </section>` : ''}`;
  row.querySelector('button').addEventListener('click', () => { row.remove(); calculateTotal(kind); });
  row.querySelectorAll('input, select').forEach((input) => input.addEventListener('input', () => fillItemInfo(row, kind)));
  document.getElementById('items').appendChild(row);
  if (isPurchase && Number(product.controlaLotes)) wirePurchaseLotEditor(row, product);
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
  row.querySelector('[data-purchase-lot-editor]')?.updateLotSummary?.();
  calculateTotal(kind);
}

function collectItems(kind) {
  return [...document.querySelectorAll('.cart-item')].map((row) => {
    const item = {
      idProducto: row.dataset.product,
      cantidad: row.querySelector('[name="cantidad"]').value,
      presentacion: row.querySelector('[name="presentacion"]').value
    };
    if (kind === 'compras') {
      item.precioCompra = row.querySelector('[name="precioCompra"]').value;
      const lotRows = [...row.querySelectorAll('[data-purchase-lot-entry]')];
      if (lotRows.length) {
        item.lotes = lotRows.map((lotRow) => ({
          codigoLote: lotRow.querySelector('[name="lotCodigo"]').value.trim() || null,
          fechaVencimiento: lotRow.querySelector('[name="lotVencimiento"]').value || null,
          cantidad: Number(lotRow.querySelector('[name="lotCantidad"]').value)
        }));
      }
    }
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
  if (kind === 'compras') {
    const invalidLots = body.items.some((item) => {
      const product = state.productos.find((row) => String(row.idProducto) === String(item.idProducto));
      if (!Number(product?.controlaLotes)) return false;
      const expected = equivalentUnitsClient(product, Number(item.cantidad), item.presentacion, true);
      return !Array.isArray(item.lotes) || item.lotes.length === 0
        || item.lotes.some((lot) => !Number.isInteger(lot.cantidad) || lot.cantidad <= 0
          || (Number(product.controlaVencimiento) === 1 && !lot.fechaVencimiento))
        || item.lotes.reduce((sum, lot) => sum + lot.cantidad, 0) !== expected;
    });
    if (invalidLots) return showError('La distribución por lotes debe cubrir exactamente todas las unidades base y completar los vencimientos obligatorios.');
  }
  if ([...document.querySelectorAll('.cart-item.has-warning')].length) return showError('Hay productos con stock insuficiente. Ajuste cantidades antes de registrar.');
  if (body.tipo === 'fiada' && !body.idCliente) return showError('Una venta fiada debe tener cliente registrado.');
  const label = kind === 'ventas' ? (body.tipo === 'fiada' ? 'venta fiada' : 'venta pagada') : 'compra';
  if (!await confirmAction(`¿Deseas registrar esta ${label}?`)) return;
  const restoreMutation = UiPatterns.mutation(form.querySelector('button[type="submit"]'), kind === 'compras' ? 'Registrando compra...' : 'Registrando venta...');
  if (!restoreMutation) return;
  try {
    await api(`/api/${kind}`, { method: 'POST', body: JSON.stringify(body) });
    await showSuccess('Operación registrada.');
    loadView(kind);
  } catch (error) { showError(error); } finally { restoreMutation(); }
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

function posAvailableStock(product) {
  return Number(product?.controlaLotes)
    ? Number(product.stockVendible || 0)
    : Number(product?.stockUnidadesTotal || 0);
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
        ${Number(product.controlaLotes) ? `<small class="lot-pos-stock">Vendible: ${escapeHtml(posAvailableStock(product))} unidades · salida ${Number(product.controlaVencimiento) ? 'FEFO' : 'FIFO'}</small>${Number(product.stockUnidadesTotal) > posAvailableStock(product) ? '<small class="text-danger">Parte del stock está vencida o bloqueada.</small>' : ''}` : ''}
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
    const available = posAvailableStock(line.producto);
    const insufficient = units > available;
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
        ${insufficient ? `<p class="text-danger">Requiere ${units}; vendibles ${available}.${Number(line.producto.controlaLotes) ? ' Hay stock físico vencido o bloqueado que no puede venderse.' : ''}</p>` : ''}
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
  creditUi().refreshPosCredit(payment.balance);
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
      ${receipt.credito && Number(receipt.credito.nuevoSaldoFiado || 0) > 0 ? `<div class="receipt-credit-summary"><strong>Resumen de crédito</strong><span>Deuda anterior: Bs ${money(receipt.credito.deudaAnterior)}</span><span>Nuevo saldo: Bs ${money(receipt.credito.nuevoSaldoFiado)}</span><span>Deuda posterior: Bs ${money(receipt.credito.deudaPosterior)}</span><span>Crédito disponible: ${receipt.credito.creditoDisponiblePosterior == null ? 'Sin límite' : `Bs ${money(receipt.credito.creditoDisponiblePosterior)}`}</span><span>Vencimiento: ${escapeHtml(receipt.credito.fechaVencimiento || 'Sin fecha')}</span>${receipt.credito.advertencias?.length ? `<small>${receipt.credito.advertencias.map(escapeHtml).join(' ')}</small>` : ''}</div>` : ''}
      <footer>Gracias por su compra.<small>Comprobante interno, no fiscal.</small></footer>
    </section>`;
}

async function copyReceiptText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const area = document.createElement('textarea');
  area.value = text;
  area.className = 'clipboard-fallback';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}

function showSaleReceipt(receipt) {
  const returnFocus = document.activeElement;
  const text = receiptText(receipt);
  const whatsappUrl = receipt.whatsappUrl || '';
  modalRoot.innerHTML = `
    <div class="modal-backdrop"><div class="modal receipt-modal" role="dialog" aria-modal="true" aria-label="Venta confirmada">
      <h3>Venta confirmada</h3>
      <div class="modal-body">${receiptHtml(receipt)}</div>
      <div class="modal-actions receipt-actions">
        <button type="button" class="secondary" data-receipt-copy>Copiar texto</button>
        <button type="button" class="secondary" data-receipt-print>Imprimir</button>
        <button type="button" ${whatsappUrl ? '' : 'disabled'} data-receipt-whatsapp>WhatsApp</button>
        <button type="button" data-modal-confirm>Cerrar</button>
      </div>
    </div></div>`;
  modalRoot.querySelector('[data-modal-confirm]').addEventListener('click', () => {
    modalRoot.innerHTML = '';
    returnFocus?.focus?.();
  });
  modalRoot.querySelector('[data-receipt-copy]').addEventListener('click', async () => {
    try { await copyReceiptText(text); showMessage('Comprobante copiado.'); } catch { showError('No se pudo copiar el comprobante.'); }
  });
  modalRoot.querySelector('[data-receipt-whatsapp]').addEventListener('click', () => {
    if (whatsappUrl) window.open(whatsappUrl, '_blank', 'noopener');
  });
  modalRoot.querySelector('[data-receipt-print]').addEventListener('click', () => {
    document.body.classList.add('printing-receipt');
    window.addEventListener('afterprint', () => document.body.classList.remove('printing-receipt'), { once: true });
    window.print();
  });
  modalRoot.querySelector('button:not([disabled])')?.focus();
}

async function submitPosSale(event) {
  event.preventDefault();
  if (!posCart.length) return showError('Debe agregar al menos un producto.');
  if (posCart.some((line) => posLineUnits(line) > posAvailableStock(line.producto))) {
    return showError('Hay productos sin stock vendible suficiente. Parte del stock puede estar vencida o bloqueada.');
  }
  const totals = posTotals();
  const payment = posPaymentDraft();
  if (payment.paid > totals.total + 0.001) return showError('Los pagos no pueden superar el total.');
  if (payment.payments.some((item) => item.metodoPago === 'efectivo') && payment.cashReceived < (payment.payments.find((item) => item.metodoPago === 'efectivo')?.monto || 0)) {
    return showError('El efectivo recibido no alcanza para el monto aplicado.');
  }
  const idCliente = document.getElementById('posClient').value;
  if (payment.balance > 0 && !idCliente) return showError('Selecciona un cliente para dejar saldo pendiente.');
  let creditPayload = {};
  try {
    creditPayload = creditUi().posCreditPayload(payment.balance);
  } catch (error) {
    return showError(error.message);
  }
  if (!await confirmAction(`Registrar venta por Bs ${money(totals.total)}${payment.balance > 0 ? ` con saldo Bs ${money(payment.balance)}` : ''}?`)) return;
  const button = document.getElementById('posSubmit');
  const restoreMutation = UiPatterns.mutation(button, 'Procesando venta...');
  if (!restoreMutation) return;
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
        ...creditPayload,
        items: posCart.map((line) => ({ idProducto: line.producto.idProducto, cantidad: line.cantidad, presentacion: line.presentacion }))
      })
    });
    data.comprobante.credito = {
      advertencias: data.advertencias || [],
      deudaAnterior: data.deudaAnterior,
      nuevoSaldoFiado: data.nuevoSaldoFiado,
      deudaPosterior: data.deudaPosterior,
      creditoDisponiblePosterior: data.creditoDisponiblePosterior,
      fechaVencimiento: data.fechaVencimiento
    };
    posCart = [];
    posOperationKey = newOperationKey();
    creditUi().resetPosCredit();
    renderPosCart();
    showSaleReceipt(data.comprobante);
    refreshCatalogs({ includeClients: false }).catch(() => {});
  } catch (error) {
    showError(error.code === 'INSUFFICIENT_SELLABLE_LOT_STOCK'
      ? 'Hay stock físico, pero parte está vencida o bloqueada.'
      : error);
  } finally {
    restoreMutation();
    button.disabled = Boolean(state.context?.soloLectura);
  }
}

function posCustomerLabel(customer) {
  return `${customer.nombre}${customer.telefono ? ` · ${customer.telefono}` : ''}`;
}

function setPosCustomerSelection(customer = null) {
  const selected = document.getElementById('posClient');
  const search = document.getElementById('posClientSearch');
  const summary = document.getElementById('posClientSelection');
  const clear = document.getElementById('posClientClear');
  if (!selected || !search || !summary || !clear) return;
  selected.value = customer?.idCliente ? String(customer.idCliente) : '';
  search.value = customer ? posCustomerLabel(customer) : '';
  summary.textContent = customer ? `Cliente seleccionado: ${posCustomerLabel(customer)}` : 'Cliente ocasional';
  clear.hidden = !customer;
  clear.disabled = !customer;
  posClientSearchOptions = [];
  posClientActiveIndex = -1;
  renderPosCustomerResults();
  selected.dispatchEvent(new Event('change'));
}

function clearPosCustomerSelection() {
  const selected = document.getElementById('posClient');
  const summary = document.getElementById('posClientSelection');
  const clear = document.getElementById('posClientClear');
  if (!selected || !summary || !clear) return;
  selected.value = '';
  summary.textContent = 'Cliente ocasional';
  clear.hidden = true;
  clear.disabled = true;
  selected.dispatchEvent(new Event('change'));
}

function renderPosCustomerResults({ loading = false, message = '' } = {}) {
  const search = document.getElementById('posClientSearch');
  const results = document.getElementById('posClientResults');
  const status = document.getElementById('posClientStatus');
  if (!search || !results || !status) return;
  if (loading) {
    results.hidden = false;
    results.innerHTML = UiPatterns.skeleton('rows', 2);
    status.textContent = 'Buscando clientes...';
    search.setAttribute('aria-expanded', 'true');
    return;
  }
  if (message) {
    results.hidden = false;
    results.innerHTML = `<p class="pos-customer-empty">${escapeHtml(message)}</p>`;
    status.textContent = message;
    search.setAttribute('aria-expanded', 'true');
    search.removeAttribute('aria-activedescendant');
    return;
  }
  if (!posClientSearchOptions.length) {
    results.hidden = true;
    results.innerHTML = '';
    status.textContent = '';
    search.setAttribute('aria-expanded', 'false');
    search.removeAttribute('aria-activedescendant');
    return;
  }
  results.hidden = false;
  results.innerHTML = posClientSearchOptions.map((customer, index) => `<button type="button" role="option" id="pos-client-option-${index}" aria-selected="${index === posClientActiveIndex}" class="pos-customer-option ${index === posClientActiveIndex ? 'active' : ''}" data-pos-client-option="${index}"><strong>${escapeHtml(customer.nombre)}</strong><span>${escapeHtml(customer.telefono || 'Sin teléfono')}</span></button>`).join('');
  results.querySelectorAll('[data-pos-client-option]').forEach((button) => button.addEventListener('click', () => {
    setPosCustomerSelection(posClientSearchOptions[Number(button.dataset.posClientOption)]);
  }));
  status.textContent = `${posClientSearchOptions.length} cliente${posClientSearchOptions.length === 1 ? '' : 's'} encontrado${posClientSearchOptions.length === 1 ? '' : 's'}.`;
  search.setAttribute('aria-expanded', 'true');
  if (posClientActiveIndex >= 0) search.setAttribute('aria-activedescendant', `pos-client-option-${posClientActiveIndex}`);
  else search.removeAttribute('aria-activedescendant');
}

async function searchPosCustomers(query) {
  const normalized = String(query || '').trim();
  const request = ++posClientSearchRequest;
  if (normalized.length < 2) {
    posClientSearchOptions = [];
    posClientActiveIndex = -1;
    renderPosCustomerResults({ message: normalized ? 'Escribe al menos 2 caracteres para buscar.' : '' });
    return;
  }
  renderPosCustomerResults({ loading: true });
  try {
    const data = await api(`/api/pos/clientes?q=${encodeURIComponent(normalized)}&page=1&limit=15`);
    if (request !== posClientSearchRequest) return;
    posClientSearchOptions = data.clientes || [];
    posClientActiveIndex = -1;
    renderPosCustomerResults({ message: posClientSearchOptions.length ? '' : 'No encontramos clientes con esos datos.' });
  } catch (error) {
    if (request !== posClientSearchRequest) return;
    posClientSearchOptions = [];
    posClientActiveIndex = -1;
    renderPosCustomerResults({ message: UiPatterns.messageFor(error) });
  }
}

async function ventas() {
  posOperationKey = posOperationKey || newOperationKey();
  posClientSearchOptions = [];
  posClientActiveIndex = -1;
  view.innerHTML = `
    <section class="sales-section-heading"><div><h3>Registrar venta</h3><p>Agrega productos, confirma la forma de cobro y registra la venta sin pasos innecesarios.</p></div></section>
    <form id="posForm" class="pos-layout sales-pos-layout">
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
        <div class="pos-customer-picker">
          <label for="posClientSearch">Cliente opcional</label>
          <div class="pos-customer-search-control"><input id="posClientSearch" type="search" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="posClientResults" autocomplete="off" placeholder="Busca por nombre o teléfono"><button type="button" class="secondary" id="posClientClear" hidden disabled>Limpiar</button></div>
          <input id="posClient" type="hidden" value="">
          <p id="posClientSelection" class="pos-customer-selection">Cliente ocasional</p>
          <p id="posClientStatus" class="sr-only" role="status" aria-live="polite"></p>
          <div id="posClientResults" class="pos-customer-results" role="listbox" aria-label="Resultados de clientes" hidden></div>
        </div>
        <div id="posCreditSummary" class="pos-credit-summary" aria-live="polite"></div>
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
        <button type="submit" id="posSubmit" class="wide-button">Registrar venta</button>
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
  document.getElementById('posClient').addEventListener('change', () => {
    creditUi().resetPosCredit();
    creditUi().refreshPosCredit(posPaymentDraft().balance);
  });
  const clientSearch = document.getElementById('posClientSearch');
  clientSearch.addEventListener('input', (event) => {
    const query = event.target.value;
    if (document.getElementById('posClient').value) clearPosCustomerSelection();
    clearTimeout(posClientSearchTimer);
    posClientSearchTimer = setTimeout(() => searchPosCustomers(query), 250);
  });
  clientSearch.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      clearTimeout(posClientSearchTimer);
      posClientSearchRequest += 1;
      posClientSearchOptions = [];
      posClientActiveIndex = -1;
      renderPosCustomerResults();
      return;
    }
    if (!posClientSearchOptions.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      posClientActiveIndex = (posClientActiveIndex + direction + posClientSearchOptions.length) % posClientSearchOptions.length;
      renderPosCustomerResults();
      return;
    }
    if (event.key === 'Enter' && posClientActiveIndex >= 0) {
      event.preventDefault();
      setPosCustomerSelection(posClientSearchOptions[posClientActiveIndex]);
    }
  });
  document.getElementById('posClientClear').addEventListener('click', () => {
    clientSearch.value = '';
    clearPosCustomerSelection();
    clearTimeout(posClientSearchTimer);
    posClientSearchRequest += 1;
    posClientSearchOptions = [];
    posClientActiveIndex = -1;
    renderPosCustomerResults();
    clientSearch.focus();
  });
  document.getElementById('posForm').addEventListener('submit', submitPosSale);
  renderPosCart();
  renderPosPaymentFields();
  await loadPosProducts('recientes');
}
async function compras() { operationView('compras'); }

async function historialVentas() {
  const rows = state.ventas || [];
  view.innerHTML = `<section class="sales-section-heading"><div><h3>Historial de ventas</h3><p>Revisa comprobantes, cobros y saldos sin perder el contexto de cada venta.</p></div></section>${rows.length ? `<div class="panel table-wrap"><table>
    <thead><tr><th>Comprobante</th><th>Fecha</th><th>Cliente</th><th>Total</th><th>Pagado</th><th>Saldo</th><th>Métodos</th><th>Estado</th><th>Acciones</th></tr></thead>
    <tbody>${rows.map((v) => `<tr><td>${escapeHtml(v.codigoComprobante || `Venta #${v.idVenta}`)}</td><td>${formatDate(v.fecha)}</td><td>${escapeHtml(v.cliente)}</td><td>Bs ${money(v.total)}</td><td>Bs ${money(v.montoPagado)}</td><td class="${Number(v.saldoActualFiado ?? v.saldoPendiente) > 0 ? 'text-danger' : 'text-ok'}">Bs ${money(v.saldoActualFiado ?? v.saldoPendiente)}</td><td>${escapeHtml(String(v.metodosPago || 'No especificado').replaceAll(',', ', '))}</td><td>${statusBadge(v.estadoPago === 'pagada' ? 'pagado' : v.estadoPago)}</td><td><button class="small secondary" data-detail="${v.idVenta}">Ver detalle</button><details class="row-actions"><summary>Más opciones</summary><button type="button" class="small" data-receipt="${v.idVenta}">Comprobante</button></details></td></tr>`).join('')}</tbody>
  </table></div>` : UiPatterns.empty('Aún no hay ventas registradas', 'Cuando completes una venta, su comprobante y estado de cobro aparecerán aquí.')}`;
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
    const [data, lotTrace] = await Promise.all([
      api(`/api/ventas/${idVenta}`),
      hasLotOperationalAccess()
        ? api(`/api/ventas/${idVenta}/lotes-utilizados`).catch(() => ({ rows: [] }))
        : Promise.resolve({ rows: [] })
    ]);
    const v = data.venta;
    await modal({
      title: `Venta #${v.idVenta}`,
      wide: true,
      confirmText: 'Cerrar',
      body: `
        <p>${escapeHtml(v.codigoComprobante || `Venta #${v.idVenta}`)} · ${formatDate(v.fecha)} · ${escapeHtml(v.cliente)} · Bs ${money(v.total)}</p>
        <p>Pagado: <strong>Bs ${money(v.montoPagado)}</strong> · Saldo actual: <strong class="${Number(v.saldoActualFiado ?? v.saldoPendiente) > 0 ? 'text-danger' : 'text-ok'}">Bs ${money(v.saldoActualFiado ?? v.saldoPendiente)}</strong> ${statusBadge(v.estadoPago === 'pagada' ? 'pagado' : v.estadoPago)}</p>
        <p>${data.pagos.length ? data.pagos.map((payment) => `${escapeHtml(payment.metodoPago)}: <strong>Bs ${money(payment.monto)}</strong>${payment.referencia ? ` (${escapeHtml(payment.referencia)})` : ''}`).join(' · ') : 'Sin desglose de pagos para esta venta histórica.'}</p>
        ${v.idFiado ? `<p><button type="button" class="secondary" data-open-debt="${v.idFiado}" data-client="${v.idCliente || ''}" data-client-name="${escapeHtml(v.cliente)}">Ver en Cobranza</button></p>` : ''}
        <p><button type="button" class="secondary" data-open-receipt="${v.idVenta}">Ver comprobante</button></p>
        <div class="table-wrap"><table><thead><tr><th>Producto</th><th>Cantidad</th><th>Presentación</th><th>Unidades</th><th>Precio</th><th>Costo</th><th>Ganancia</th></tr></thead>
        <tbody>${data.detalle.map((d) => `<tr><td>${escapeHtml(d.nombre)}</td><td>${intValue(d.cantidad)}</td><td>${escapeHtml(d.presentacionVenta)}</td><td>${intValue(d.cantidadEquivalenteUnidades)}</td><td>Bs ${money(d.subtotal)}</td><td>Bs ${money(d.subtotalCosto)}</td><td>Bs ${money(d.ganancia)}</td></tr>`).join('')}</tbody></table></div>
        ${lotTrace.rows.length ? `<h4>Lotes utilizados</h4><div class="table-wrap"><table><thead><tr><th>Producto</th><th>Lote</th><th>Vencimiento</th><th>Unidades</th><th>Costo del lote</th></tr></thead><tbody>${lotTrace.rows.map((row) => `<tr><td>${escapeHtml(row.producto)}</td><td><button type="button" class="link-button" data-lot-detail="${row.idLoteProducto}">${escapeHtml(row.codigoLote || 'Sin código')}</button></td><td>${lotDate(row.fechaVencimiento)}</td><td>${escapeHtml(row.cantidadUnidades)}</td><td>${row.costoUnitarioBase === null ? 'Desconocido' : `Bs ${money(row.costoUnitarioBase)}`}</td></tr>`).join('')}</tbody></table></div>` : ''}`,
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
        wireLotRowActions(root);
      }
    });
  } catch (error) { showError(error.message); }
}

async function pagos() {
  return creditUi().renderCollections(debtFocus);
}

function localDateValue(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localDateTimeValue(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const pad = (number) => String(number).padStart(2, '0');
  return `${localDateValue(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function monthStartValue() {
  const now = new Date();
  return localDateValue(new Date(now.getFullYear(), now.getMonth(), 1));
}

function financeQuery(form) {
  const data = formData(form);
  const query = new URLSearchParams({ periodo: data.periodo || 'mes' });
  if (data.periodo === 'rango') {
    query.set('desde', data.desde || '');
    query.set('hasta', data.hasta || '');
  }
  return query;
}

async function requestReason(modalTitle, label) {
  return new Promise((resolve) => {
    const returnFocus = document.activeElement;
    modalRoot.innerHTML = `<div class="modal-backdrop"><form class="modal" id="reasonForm" role="dialog" aria-modal="true" aria-labelledby="reasonFormTitle">
      <h3 id="reasonFormTitle">${escapeHtml(modalTitle)}</h3>
      <div class="modal-body"><label>${escapeHtml(label)}<textarea name="motivo" minlength="8" maxlength="300" required></textarea></label></div>
      <div class="modal-actions"><button type="button" class="secondary" data-cancel>Cancelar</button><button type="submit" class="danger">Confirmar</button></div>
    </form></div>`;
    const close = (value) => {
      modalRoot.innerHTML = '';
      returnFocus?.focus?.();
      resolve(value);
    };
    modalRoot.querySelector('[data-cancel]').addEventListener('click', () => close(null));
    modalRoot.querySelector('#reasonForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const reason = new FormData(event.target).get('motivo').trim();
      if (reason.length >= 8) close(reason);
    });
    modalRoot.querySelector('[name="motivo"]')?.focus();
  });
}

async function expenseEditor(expense = null) {
  const categories = await api('/api/gastos/categorias');
  return new Promise((resolve) => {
    const returnFocus = document.activeElement;
    modalRoot.innerHTML = `<div class="modal-backdrop"><form class="modal modal-wide" id="expenseForm" role="dialog" aria-modal="true" aria-labelledby="expenseFormTitle">
      <h3 id="expenseFormTitle">${expense ? 'Editar gasto' : 'Registrar gasto'}</h3>
      <div class="modal-body form-grid">
        <label>Categoría<select name="idCategoriaGasto" required>${options(categories, 'idCategoriaGasto', 'nombre', 'Seleccione', expense?.idCategoriaGasto)}</select></label>
        <label>Fecha y hora<input name="fechaGasto" type="datetime-local" step="1" required value="${expense ? localDateTimeValue(expense.fechaGasto) : localDateTimeValue()}"></label>
        <label class="wide">Concepto<input name="concepto" maxlength="160" required value="${escapeHtml(expense?.concepto || '')}"></label>
        <label>Monto (Bs)<input name="monto" type="number" min="0.01" step="0.01" required value="${expense ? money(expense.monto) : ''}"></label>
        <label>Método<select name="metodoPago" required>
          ${['efectivo', 'qr', 'transferencia', 'otro'].map((method) => `<option value="${method}" ${expense?.metodoPago === method ? 'selected' : ''}>${method}</option>`).join('')}
        </select></label>
        <label>Referencia<input name="referencia" maxlength="120" value="${escapeHtml(expense?.referencia || '')}"></label>
        <label class="check"><input name="recurrente" type="checkbox" ${expense?.recurrente ? 'checked' : ''}> Gasto recurrente</label>
        <label class="wide">Observación<textarea name="observacion" maxlength="500">${escapeHtml(expense?.observacion || '')}</textarea></label>
        <p class="form-error wide" data-form-error></p>
      </div>
      <div class="modal-actions"><button type="button" class="secondary" data-cancel>Cancelar</button><button type="submit">Guardar</button></div>
    </form></div>`;
    const close = (value) => {
      modalRoot.innerHTML = '';
      returnFocus?.focus?.();
      resolve(value);
    };
    modalRoot.querySelector('[data-cancel]').addEventListener('click', () => close(false));
    modalRoot.querySelector('#expenseForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = formData(event.target);
      data.recurrente = event.target.elements.recurrente.checked;
      try {
        await api(expense ? `/api/gastos/${expense.idGasto}` : '/api/gastos', {
          method: expense ? 'PUT' : 'POST', body: JSON.stringify(data)
        });
        close(true);
      } catch (error) { modalRoot.querySelector('[data-form-error]').textContent = error.message; }
    });
    modalRoot.querySelector('[name="idCategoriaGasto"]')?.focus();
  });
}

async function manageExpenseCategories() {
  return new Promise(async (resolve) => {
    modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal modal-wide">
      <h3>Categorías de gasto</h3><div class="modal-body" id="expenseCategoryBody"></div>
      <div class="modal-actions"><button type="button" data-close>Listo</button></div>
    </div></div>`;
    const body = modalRoot.querySelector('#expenseCategoryBody');
    const render = async (selected = null) => {
      const rows = await api('/api/gastos/categorias?incluirInactivas=1');
      body.innerHTML = `<form id="expenseCategoryForm" class="category-editor">
        <input type="hidden" name="idCategoriaGasto" value="${selected?.idCategoriaGasto || ''}">
        <label>Nombre<input name="nombre" maxlength="100" required value="${escapeHtml(selected?.nombre || '')}"></label>
        <label>Descripción<input name="descripcion" maxlength="255" value="${escapeHtml(selected?.descripcion || '')}"></label>
        <label class="check"><input name="activo" type="checkbox" ${selected ? (selected.activo ? 'checked' : '') : 'checked'}> Activa</label>
        <button type="submit" data-finance-write>${selected ? 'Actualizar' : 'Añadir'}</button><p class="form-error" data-category-error></p>
      </form>
      <div class="compact-list">${rows.map((row) => `<div><span><strong>${escapeHtml(row.nombre)}</strong><small>${row.activo ? 'Activa' : 'Inactiva'}</small></span><button type="button" class="small secondary" data-category-edit="${row.idCategoriaGasto}">Editar</button></div>`).join('')}</div>`;
      body.querySelector('#expenseCategoryForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = formData(event.target);
        data.activo = event.target.elements.activo.checked;
        try {
          await api(data.idCategoriaGasto ? `/api/gastos/categorias/${data.idCategoriaGasto}` : '/api/gastos/categorias', {
            method: data.idCategoriaGasto ? 'PUT' : 'POST', body: JSON.stringify(data)
          });
          await render();
        } catch (error) { body.querySelector('[data-category-error]').textContent = error.message; }
      });
      body.querySelectorAll('[data-category-edit]').forEach((button) => button.addEventListener('click', () => {
        render(rows.find((row) => String(row.idCategoriaGasto) === button.dataset.categoryEdit));
      }));
      applyReadOnlyUi();
    };
    modalRoot.querySelector('[data-close]').addEventListener('click', () => { modalRoot.innerHTML = ''; resolve(); });
    try { await render(); } catch (error) { modalRoot.innerHTML = ''; resolve(); showError(error.message); }
  });
}

async function loadExpenses() {
  const form = document.getElementById('expenseFilters');
  const query = new URLSearchParams(formData(form));
  const data = await api(`/api/gastos?${query}`);
  const container = document.getElementById('expenseList');
  container.innerHTML = UiPatterns.skeleton('rows', 4);
  container.innerHTML = `<div class="summary-row"><strong>Total vigente: Bs ${money(data.montoVigente)}</strong><span>${data.total} registros</span></div>
    ${data.gastos.length ? `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Categoría</th><th>Concepto</th><th>Método</th><th>Monto</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>
      ${data.gastos.map((expense) => `<tr class="${expense.estado === 'anulado' ? 'row-muted' : ''}"><td>${formatDate(expense.fechaGasto)}</td><td>${escapeHtml(expense.categoria)}</td><td><strong>${escapeHtml(expense.concepto)}</strong>${expense.recurrente ? '<small>Recurrente</small>' : ''}</td><td>${escapeHtml(expense.metodoPago)}</td><td>Bs ${money(expense.monto)}</td><td>${statusBadge(expense.estado)}</td><td><div class="actions">${expense.estado === 'registrado' ? `<button class="small secondary" data-expense-edit="${expense.idGasto}" data-finance-write>Editar</button><button class="small danger" data-expense-cancel="${expense.idGasto}" data-finance-write>Anular</button>` : ''}</div></td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">No hay gastos en el período seleccionado.</p>'}`;
  container.querySelectorAll('[data-expense-edit]').forEach((button) => button.addEventListener('click', async () => {
    const expense = await api(`/api/gastos/${button.dataset.expenseEdit}`);
    if (await expenseEditor(expense)) { await loadExpenses(); showSuccess('Gasto actualizado.'); }
  }));
  container.querySelectorAll('[data-expense-cancel]').forEach((button) => button.addEventListener('click', async () => {
    const reason = await requestReason('Anular gasto', 'Motivo de la anulación');
    if (!reason) return;
    try {
      await api(`/api/gastos/${button.dataset.expenseCancel}/anular`, { method: 'POST', body: JSON.stringify({ motivo: reason }) });
      await loadExpenses(); showSuccess('Gasto anulado sin borrar el historial.');
    } catch (error) { showError(error.message); }
  }));
  applyReadOnlyUi();
}

async function gastos() {
  const categories = await api('/api/gastos/categorias');
  view.innerHTML = `<div class="toolbar"><div><h3>Gastos operativos</h3><p class="muted">Compras de mercadería y gastos del negocio se mantienen separados.</p></div><div class="actions"><button id="expenseCategories" class="secondary">Categorías</button><button id="addExpense" data-finance-write>Añadir gasto</button></div></div>
    <div class="panel"><form id="expenseFilters" class="filter-bar">
      <label>Desde<input name="desde" type="date" value="${monthStartValue()}"></label><label>Hasta<input name="hasta" type="date" value="${localDateValue()}"></label>
      <label>Categoría<select name="idCategoriaGasto">${options(categories, 'idCategoriaGasto', 'nombre', 'Todas')}</select></label>
      <label>Método<select name="metodoPago"><option value="">Todos</option><option value="efectivo">Efectivo</option><option value="qr">QR</option><option value="transferencia">Transferencia</option><option value="otro">Otro</option></select></label>
      <label>Estado<select name="estado"><option value="">Todos</option><option value="registrado">Registrado</option><option value="anulado">Anulado</option></select></label>
      <button type="submit">Consultar</button>
    </form></div><div class="panel" id="expenseList"><p class="muted">Cargando gastos...</p></div>`;
  document.getElementById('expenseFilters').addEventListener('submit', (event) => { event.preventDefault(); loadExpenses().catch((error) => showError(error.message)); });
  document.getElementById('addExpense').addEventListener('click', async () => {
    if (await expenseEditor()) { await loadExpenses(); showSuccess('Gasto registrado.'); }
  });
  document.getElementById('expenseCategories').addEventListener('click', async () => { await manageExpenseCategories(); await loadExpenses(); });
  await loadExpenses();
}

async function downloadFinancialExport(type, query, button = null) {
  const originalLabel = button?.textContent;
  try {
    if (button) { button.disabled = true; button.textContent = 'Generando...'; }
    const response = await SecurityHttp.secureFetch(`/api/exportaciones/${type}.xlsx?${query}`);
    if (response.status === 401) return (window.location.href = '/login.html');
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw SecurityHttp.errorFromResponse(response, data, 'No se pudo generar la exportación.');
    }
    const blob = await response.blob();
    const disposition = response.headers.get('content-disposition') || '';
    const fileName = disposition.match(/filename="([^"]+)"/)?.[1] || `${type}.xlsx`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = fileName; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { showError(error.message); }
  finally {
    if (button) { button.disabled = false; button.textContent = originalLabel; }
  }
}

function financialCards(summary) {
  const displayedGross = summary.rentabilidadCompleta ? summary.gananciaBruta : summary.gananciaBrutaCalculable;
  const grossLabel = summary.rentabilidadExacta
    ? 'Ganancia bruta'
    : (summary.rentabilidadCompleta ? 'Ganancia bruta estimada' : 'Ganancia bruta calculable');
  const displayedNet = summary.rentabilidadCompleta ? summary.gananciaNeta : summary.gananciaNetaCalculable;
  const netLabel = summary.rentabilidadExacta
    ? 'Ganancia neta'
    : (summary.rentabilidadCompleta ? 'Ganancia neta estimada' : 'Ganancia neta calculable');
  return `<div class="cards financial-cards">
    <div class="card metric-card sales"><span>Ventas netas</span><strong>Bs ${money(summary.ventasNetas)}</strong><small>Descuentos: Bs ${money(summary.descuentos)}</small></div>
    <div class="card metric-card collected"><span>Dinero cobrado</span><strong>Bs ${money(summary.dineroCobrado)}</strong><small>Fiados cobrados: Bs ${money(summary.cobrosFiado)}</small></div>
    <div class="card metric-card profit"><span>${grossLabel}</span><strong>Bs ${money(displayedGross)}</strong><small>Costo vendido: Bs ${money(summary.costoVendido)}</small></div>
    <div class="card metric-card expense"><span>Gastos</span><strong>Bs ${money(summary.gastos)}</strong><small>${summary.cantidadGastos} registros vigentes</small></div>
    <div class="card metric-card net ${Number(displayedNet) < 0 ? 'negative' : ''}"><span>${netLabel}</span><strong>Bs ${money(displayedNet)}</strong><small>Confirmada: Bs ${money(summary.gananciaBrutaConfirmada)} · Estimada: Bs ${money(summary.gananciaBrutaEstimada)}</small></div>
    <div class="card metric-card debt"><span>Cuentas por cobrar</span><strong>Bs ${money(summary.cuentasPorCobrar)}</strong><small>Fiado generado: Bs ${money(summary.fiadoGenerado)}</small></div>
  </div>`;
}

async function loadFinancialDashboard() {
  const form = document.getElementById('financeFilters');
  const query = financeQuery(form);
  const [data, receivableData, purchaseData] = await Promise.all([
    api(`/api/dashboard/financiero?${query}`),
    api('/api/reportes/finanzas/cuentas-por-cobrar'),
    api(`/api/reportes/finanzas/compras?${query}`)
  ]);
  const summary = data.resumen;
  document.getElementById('financeContent').innerHTML = `${financialCards(summary)}
    <div class="finance-explain"><span><strong>Ganancia bruta</strong> Venta neta menos costo vendido.</span><span><strong>Ganancia neta</strong> Ganancia bruta menos gastos.</span><span><strong>Flujo conocido</strong> Cobros registrados menos gastos; las compras se muestran aparte.</span></div>
    ${summary.detallesCostoDesconocido ? `<div class="subscription-banner subscription-warning"><strong>Costos incompletos:</strong> ${summary.detallesCostoDesconocido} detalles, por Bs ${money(summary.ventasSinCosto)}, no tienen costo conocido y se excluyen de la ganancia calculable.</div>` : ''}
    ${Number(summary.costoEstimado) > 0 ? `<div class="subscription-banner subscription-warning"><strong>Costo estimado:</strong> Bs ${money(summary.costoEstimado)} del costo vendido proviene de datos anteriores a la migración.</div>` : ''}
    <div class="dashboard-grid financial-dashboard-grid">
      <div class="panel chart-panel"><h3>Ventas por día</h3><canvas id="financeSalesChart"></canvas></div>
      <div class="panel chart-panel"><h3>Ganancia calculable por día</h3><canvas id="financeProfitChart"></canvas></div>
      <div class="panel chart-panel"><h3>Cobros por método</h3><canvas id="financeMethodsChart"></canvas></div>
      <div class="panel chart-panel"><h3>Gastos por categoría</h3><canvas id="financeExpensesChart"></canvas></div>
    </div>
    ${data.productosRentables ? `<div class="panel"><h3>Productos más rentables</h3>${data.productosRentables.length ? `<div class="table-wrap"><table><thead><tr><th>Producto</th><th>Ventas netas</th><th>Costo</th><th>Ganancia conocida</th><th>Margen</th></tr></thead><tbody>${data.productosRentables.map((row) => `<tr><td>${escapeHtml(row.nombre)}</td><td>Bs ${money(row.ventasNetas)}</td><td>Bs ${money(row.costoVendido)}</td><td>Bs ${money(row.gananciaConCosto)}</td><td>${row.margenPorcentaje === null ? 'Costo incompleto' : `${money(row.margenPorcentaje)}%${row.margenEstimado ? ' estimado' : ''}`}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Sin ventas para analizar.</p>'}</div>` : ''}
    <div class="finance-detail-grid">
      <div class="panel"><h3>Cuentas por cobrar</h3><strong class="large-number">Bs ${money(receivableData.total)}</strong><p>${receivableData.totalRegistros} cuentas con saldo.</p></div>
      <div class="panel"><h3>Compras de mercadería</h3><strong class="large-number">Bs ${money(purchaseData.total)}</strong><p>No se restan nuevamente de la ganancia neta.</p></div>
      <div class="panel"><h3>Flujo de efectivo conocido</h3><strong class="large-number">Bs ${money(summary.flujoEfectivoConocido)}</strong><p>No incluye compras sin método de pago registrado.</p></div>
    </div>`;
  drawChart(document.getElementById('financeSalesChart'), data.ventasPorDia.map((row) => row.fecha), data.ventasPorDia.map((row) => row.ventasNetas), '#286a59');
  drawChart(document.getElementById('financeProfitChart'), data.ventasPorDia.map((row) => row.fecha), data.ventasPorDia.map((row) => row.gananciaCalculable), '#18794e');
  drawChart(document.getElementById('financeMethodsChart'), data.metodosPago.map((row) => row.metodoPago), data.metodosPago.map((row) => row.total), '#536471');
  drawChart(document.getElementById('financeExpensesChart'), data.gastosPorCategoria.map((row) => row.categoria), data.gastosPorCategoria.map((row) => row.total), '#b42318');
}

async function finanzas() {
  const advanced = state.context?.caracteristicas?.includes('rentabilidad_producto');
  view.innerHTML = `<div class="panel"><form id="financeFilters" class="finance-filter-bar">
      <label>Período<select name="periodo"><option value="hoy">Hoy</option><option value="ayer">Ayer</option><option value="semana">Esta semana</option><option value="mes" selected>Este mes</option><option value="mes_anterior">Mes anterior</option><option value="anio">Este año</option><option value="rango">Rango personalizado</option></select></label>
      <span class="finance-range" hidden><label>Desde<input name="desde" type="date" value="${monthStartValue()}"></label><label>Hasta<input name="hasta" type="date" value="${localDateValue()}"></label></span>
      <button type="submit">Actualizar</button>
      <div class="export-menu"><button type="button" class="secondary" data-export="resumen-financiero">Resumen XLSX</button><button type="button" class="secondary" data-export="ventas">Ventas XLSX</button><button type="button" class="secondary" data-export="pagos">Pagos XLSX</button><button type="button" class="secondary" data-export="gastos">Gastos XLSX</button>${advanced ? '<button type="button" class="secondary" data-export="rentabilidad">Rentabilidad XLSX</button>' : ''}</div>
    </form></div><div id="financeContent"><p class="muted">Cargando información financiera...</p></div>`;
  const form = document.getElementById('financeFilters');
  const toggleRange = () => { form.querySelector('.finance-range').hidden = form.elements.periodo.value !== 'rango'; };
  form.elements.periodo.addEventListener('change', toggleRange);
  form.addEventListener('submit', (event) => { event.preventDefault(); loadFinancialDashboard().catch((error) => showError(error.message)); });
  form.querySelectorAll('[data-export]').forEach((button) => button.addEventListener('click', () => downloadFinancialExport(button.dataset.export, financeQuery(form), button)));
  toggleRange();
  await loadFinancialDashboard();
}

async function loadCashClosures() {
  const data = await api('/api/caja/cierres');
  const container = document.getElementById('cashClosureHistory');
  container.innerHTML = data.cierres.length ? `<div class="table-wrap"><table><thead><tr><th>Período</th><th>Esperado</th><th>Contado</th><th>Diferencia</th><th>QR</th><th>Estado</th><th></th></tr></thead><tbody>
    ${data.cierres.map((row) => `<tr class="${row.estado === 'anulado' ? 'row-muted' : ''}"><td>${formatDate(row.fechaInicio)}<small>hasta ${formatDate(row.fechaFin)}</small></td><td>Bs ${money(row.efectivoEsperado)}</td><td>Bs ${money(row.efectivoContado)}</td><td class="${Number(row.diferencia) === 0 ? 'text-ok' : 'text-danger'}">Bs ${money(row.diferencia)}</td><td>Bs ${money(row.totalQR)}</td><td>${statusBadge(row.estado)}</td><td>${row.estado === 'cerrado' ? `<button class="small danger" data-close-cancel="${row.idCierreCaja}" data-finance-write>Anular</button>` : ''}</td></tr>`).join('')}
  </tbody></table></div>` : '<p class="muted">Todavía no hay cierres de caja.</p>';
  container.querySelectorAll('[data-close-cancel]').forEach((button) => button.addEventListener('click', async () => {
    const reason = await requestReason('Anular cierre de caja', 'Motivo de la anulación');
    if (!reason) return;
    try {
      await api(`/api/caja/cierres/${button.dataset.closeCancel}/anular`, { method: 'POST', body: JSON.stringify({ motivo: reason }) });
      await loadCashClosures(); showSuccess('Cierre anulado. Puedes registrar un cierre corregido.');
    } catch (error) { showError(error.message); }
  }));
  applyReadOnlyUi();
}

async function calculateClosurePreview() {
  const form = document.getElementById('cashClosureForm');
  const data = formData(form);
  const query = new URLSearchParams({ fechaInicio: data.fechaInicio, fechaFin: data.fechaFin, efectivoInicial: data.efectivoInicial || 0 });
  const result = await api(`/api/caja/cierres/calcular?${query}`);
  const counted = Number(data.efectivoContado || 0);
  document.getElementById('cashClosurePreview').innerHTML = `<div class="closure-calculation">
    <span>Efectivo de ventas<strong>Bs ${money(result.efectivoVentasEsperado)}</strong></span><span>Cobros de fiado<strong>Bs ${money(result.efectivoFiadosCobrado)}</strong></span><span>Gastos en efectivo<strong>- Bs ${money(result.gastosEfectivo)}</strong></span><span>Efectivo esperado<strong>Bs ${money(result.efectivoEsperado)}</strong></span><span>QR registrado<strong>Bs ${money(result.totalQR)}</strong></span><span>Diferencia estimada<strong>Bs ${money(counted - Number(result.efectivoEsperado))}</strong></span>
  </div><p class="muted">Las compras no reducen el efectivo esperado porque todavía no registran un método de pago fiable.</p>`;
  return result;
}

async function cierreCaja() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let operationKey = newOperationKey();
  view.innerHTML = `<div class="panel"><div class="panel-title"><div><h3>Nuevo cierre de caja</h3><p>El cierre es opcional y no modifica ventas, pagos, gastos ni stock.</p></div><button id="exportClosures" class="secondary">Exportar XLSX</button></div>
    <form id="cashClosureForm" class="form-grid">
      <label>Desde<input name="fechaInicio" type="datetime-local" step="1" required value="${localDateTimeValue(start)}"></label>
      <label>Hasta<input name="fechaFin" type="datetime-local" step="1" required value="${localDateTimeValue(now)}"></label>
      <label>Efectivo inicial<input name="efectivoInicial" type="number" min="0" step="0.01" value="0"></label>
      <label>Efectivo contado<input name="efectivoContado" type="number" min="0" step="0.01" required value="0"></label>
      <label class="wide">Observación<textarea name="observacion" maxlength="500"></textarea></label>
      <div class="actions wide"><button type="button" id="calculateClosure" class="secondary">Calcular</button><button type="submit" data-finance-write>Guardar cierre</button></div>
    </form><div id="cashClosurePreview"></div></div>
    <div class="panel"><h3>Historial de cierres</h3><div id="cashClosureHistory"><p class="muted">Cargando cierres...</p></div></div>`;
  const form = document.getElementById('cashClosureForm');
  document.getElementById('calculateClosure').addEventListener('click', () => calculateClosurePreview().catch((error) => showError(error.message)));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await calculateClosurePreview();
      const body = { ...formData(form), claveOperacion: operationKey };
      await api('/api/caja/cierres', { method: 'POST', body: JSON.stringify(body) });
      operationKey = newOperationKey();
      await loadCashClosures(); showSuccess('Cierre de caja registrado.');
    } catch (error) { showError(error.message); }
  });
  document.getElementById('exportClosures').addEventListener('click', () => {
    const data = formData(form);
    const query = new URLSearchParams({ desde: data.fechaInicio.slice(0, 10), hasta: data.fechaFin.slice(0, 10) });
    downloadFinancialExport('cierres', query, document.getElementById('exportClosures'));
  });
  await loadCashClosures();
}

function inventoryFeature(code) {
  return Boolean(state.context?.caracteristicas?.includes(code));
}

function inventoryAdvancedAvailable() {
  return ['compras_sugeridas', 'rotacion_inventario', 'inventario_sin_movimiento', 'exportacion_inventario']
    .some((code) => inventoryFeature(code));
}

function inventoryTabs() {
  const tabs = [
    ['resumen', 'Resumen', 'inventario_resumen'],
    ['alertas', 'Alertas', 'alertas_stock'],
    ['ranking', 'Ranking', 'ranking_productos'],
    ['valoracion', 'Valoración', 'valor_inventario_basico'],
    ['sugerencias', 'Compras sugeridas', 'compras_sugeridas'],
    ['rotacion', 'Rotación y cobertura', 'rotacion_inventario'],
    ['sinMovimiento', 'Sin movimiento', 'inventario_sin_movimiento']
  ];
  if (inventoryAdvancedAvailable()) tabs.push(['configuracion', 'Configuración', 'inventario_resumen']);
  return tabs.filter(([, , feature]) => inventoryFeature(feature));
}

function inventoryStateBadge(value) {
  const labels = {
    agotado: 'Agotado', bajo: 'Stock bajo', en_minimo: 'En mínimo', suficiente: 'Suficiente', inactivo: 'Inactivo'
  };
  const symbol = { agotado: '!', bajo: '↓', en_minimo: '=', suficiente: '✓', inactivo: '–' }[value] || '•';
  return `<span class="inventory-status inventory-status-${escapeHtml(value || 'desconocido')}"><span aria-hidden="true">${symbol}</span> ${escapeHtml(labels[value] || value || 'Sin estado')}</span>`;
}

function inventoryConfidenceBadge(row) {
  const sufficient = row?.historialSuficiente === true || row?.confianza === 'suficiente';
  return `<span class="inventory-confidence ${sufficient ? 'confidence-ok' : 'confidence-low'}">${sufficient ? 'Historial suficiente' : 'Historial insuficiente'}</span>`;
}

function inventoryMetric(value, decimals = 2, empty = 'No calculable') {
  const number = Number(value);
  return value === null || value === undefined || !Number.isFinite(number) ? empty : number.toFixed(decimals);
}

function inventoryDate(value, empty = 'Sin registro') {
  if (!value) return empty;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : escapeHtml(value);
}

function inventoryPeriod(period) {
  if (!period) return '';
  const note = period.limitadoPorConfiguracion ? ' · limitado por la configuración de la tienda' : '';
  return `Período: ${inventoryDate(period.desde)} hasta ${inventoryDate(period.hastaExclusivo)}${note}`;
}

function inventoryEmpty(text) {
  return UiPatterns.empty('Sin datos', escapeHtml(text));
}

function inventoryErrorState(error) {
  return `<div class="inventory-empty inventory-error" role="alert"><strong>No se pudo cargar este bloque</strong><p>${escapeHtml(UiPatterns.messageFor(error))}</p><button type="button" class="secondary" data-inventory-retry>Reintentar</button></div>`;
}

function inventoryLoading(text = 'Cargando información del inventario...') {
  return `<div class="inventory-loading" role="status" aria-live="polite"><span class="sr-only">${escapeHtml(text)}</span>${UiPatterns.skeleton('rows', 4)}</div>`;
}

function localDateFromInput(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1
    && date.getDate() === Number(match[3]) ? date : null;
}

function inventoryFilterQuery() {
  const form = document.getElementById('inventoryFilters');
  form.elements.ventana.addEventListener('change', () => {
    if (!form.elements.ventana.value) return;
    form.elements.desde.value = '';
    form.elements.hasta.value = '';
  });
  ['desde', 'hasta'].forEach((field) => form.elements[field].addEventListener('change', () => {
    if (form.elements[field].value) form.elements.ventana.value = '';
  }));
  const data = formData(form);
  const from = data.desde ? localDateFromInput(data.desde) : null;
  const until = data.hasta ? localDateFromInput(data.hasta) : null;
  if ((data.desde && !from) || (data.hasta && !until)) throw new Error('Revise las fechas del período.');
  if (from && until) {
    if (from > until) throw new Error('La fecha desde no puede ser posterior a la fecha hasta.');
    const inclusiveDays = Math.floor((until.getTime() - from.getTime()) / 86400000) + 1;
    if (inclusiveDays > 365) throw new Error('El período no puede superar 365 días.');
  }
  const query = new URLSearchParams();
  ['desde', 'hasta', 'ventana', 'categoria', 'proveedor', 'producto', 'estado', 'prioridad', 'tipoAlerta', 'estadoSugerencia', 'limite'].forEach((field) => {
    if (data[field] !== undefined && data[field] !== '') query.set(field, data[field]);
  });
  query.set('pagina', String(inventoryUi.page || 1));
  return query;
}

function inventoryRenderSummary() {
  const summary = inventoryUi.data.resumen;
  const valuation = inventoryUi.data.resumenValoracion?.resumen;
  const lots = inventoryUi.data.resumenLotes;
  if (!summary || !valuation) return inventoryEmpty('No se pudo completar el resumen para los filtros seleccionados.');
  const cards = [
    ['Productos activos', summary.productosActivos, 'neutral'],
    ['Agotados', summary.estados?.agotado || 0, 'danger'],
    ['Stock bajo', summary.estados?.bajo || 0, 'warning'],
    ['En mínimo', summary.estados?.en_minimo || 0, 'attention'],
    ['Stock suficiente', summary.estados?.suficiente || 0, 'success'],
    ['Valor a costo conocido', `Bs ${money(valuation.valorCostoConocido)}`, 'neutral'],
    ['Valor potencial de venta', `Bs ${money(valuation.valorVenta)}`, 'neutral'],
    ['Ganancia potencial conocida', `Bs ${money(valuation.gananciaPotencialConocida)}`, 'success'],
    ['Costo desconocido', `${valuation.productosConCostoDesconocido} productos`, valuation.productosConCostoDesconocido ? 'warning' : 'success']
  ];
  return `<section aria-labelledby="inventorySummaryTitle">
    <div class="inventory-section-heading"><div><h3 id="inventorySummaryTitle">Panorama del inventario</h3><p>${escapeHtml(inventoryPeriod(summary.periodo))}</p></div></div>
    <div class="inventory-metrics">${cards.map(([label, value, tone]) => `<article class="inventory-metric metric-${tone}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`).join('')}</div>
    <div class="inventory-note"><strong>Lectura responsable de costos</strong><p>${escapeHtml(`Costo conocido en ${valuation.productosConCostoConocido} productos. ${valuation.productosConCostoDesconocido ? `Falta costo en ${valuation.productosConCostoDesconocido} productos (${valuation.unidadesConCostoDesconocido} unidades).` : 'Todos los productos analizados tienen un costo conocido.'}`)}</p></div>
    ${lots ? `<div class="inventory-note"><strong>Productos controlados por lotes</strong><p>Stock general trazado: ${escapeHtml(lots.stockTrazado)} · vendible: ${escapeHtml(lots.stockVendible)} · vencido: ${escapeHtml(lots.stockVencido)} · bloqueado: ${escapeHtml(lots.stockBloqueado)}.</p><button type="button" class="secondary small" data-open-lot-dashboard>Ver lotes y vencimientos</button></div>` : ''}
  </section>`;
}

function inventoryPagination(data) {
  if (!data || Number(data.paginas || 1) <= 1) return '';
  const page = Number(data.pagina || 1);
  return `<nav class="inventory-pagination" aria-label="Paginación de inventario"><button type="button" data-inventory-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>Anterior</button><span>Página ${escapeHtml(page)} de ${escapeHtml(data.paginas)}</span><button type="button" data-inventory-page="${page + 1}" ${page >= Number(data.paginas) ? 'disabled' : ''}>Siguiente</button></nav>`;
}

function inventoryRenderAlertsLegacy() {
  const data = inventoryUi.data.alertas;
  if (!data?.rows?.length) return inventoryEmpty('No hay productos agotados, bajos o en mínimo para estos filtros.');
  const canWrite = !state.context?.soloLectura;
  return `<div class="inventory-section-heading"><div><h3>Alertas que requieren atención</h3><p>${escapeHtml(inventoryPeriod(data.periodo))} · ${data.total} resultados</p></div></div>
    <div class="table-wrap"><table class="inventory-table"><caption class="sr-only">Productos con alertas de inventario</caption><thead><tr><th>Producto</th><th>Categoría</th><th>Stock actual</th><th>Stock mínimo</th><th>Estado</th><th>Proveedor</th><th>Acción</th></tr></thead><tbody>
    ${data.rows.map((row) => { const product = state.productos.find((item) => Number(item.idProducto) === Number(row.idProducto)); return `<tr><td><strong>${escapeHtml(row.nombre)}</strong></td><td>${escapeHtml(row.categoria)}</td><td>${escapeHtml(row.stockActual)} ${escapeHtml(row.unidadBase)}${Number(product?.controlaLotes) ? '<small>Controlado por lotes</small>' : ''}</td><td>${escapeHtml(row.stockMinimo)}</td><td>${inventoryStateBadge(row.estadoInventario)}</td><td>${escapeHtml(row.proveedor || 'Sin proveedor')}</td><td><div class="actions">${canWrite ? `<button type="button" class="small secondary" data-inventory-product-config="${escapeHtml(row.idProducto)}">Configurar análisis</button>` : '<span class="muted">Solo lectura</span>'}${Number(product?.controlaLotes) ? `<button type="button" class="small secondary" data-inventory-product-lots="${escapeHtml(row.idProducto)}">Ver lotes</button>` : ''}</div></td></tr>`; }).join('')}
    </tbody></table></div>`;
}

function inventoryRenderAlerts() {
  const data = inventoryUi.data.alertas;
  if (!data?.rows?.length) return inventoryEmpty('No hay alertas de inventario para estos filtros.');
  const canWrite = !state.context?.soloLectura;
  return `<div class="inventory-section-heading"><div><h3>Alertas priorizadas</h3><p>${escapeHtml(inventoryPeriod(data.periodo))} · ${escapeHtml(data.total)} resultados</p></div></div>
    <div class="table-wrap"><table class="inventory-table"><caption class="sr-only">Alertas priorizadas de inventario</caption><thead><tr><th>Prioridad</th><th>Producto</th><th>Alerta</th><th>Stock físico / vendible</th><th>Lectura</th><th>Acción</th></tr></thead><tbody>${data.rows.map((row) => `<tr><td><span class="inventory-status inventory-status-${escapeHtml(row.prioridad)}">${escapeHtml(row.prioridad)}</span></td><td><strong>${escapeHtml(row.nombre)}</strong><small>${escapeHtml(row.categoria)}</small></td><td>${escapeHtml(row.tipo)}</td><td>${escapeHtml(row.stockFisico)} / ${escapeHtml(row.stockVendible)}<small>No vendible: ${escapeHtml(row.stockNoVendible)}</small></td><td>${escapeHtml(row.mensaje)}</td><td>${canWrite ? `<button type="button" class="small secondary" data-inventory-product-config="${escapeHtml(row.idProducto)}">Configurar</button>` : '<span class="muted">Solo lectura</span>'}</td></tr>`).join('')}</tbody></table></div>${inventoryPagination(data)}`;
}

function inventoryRankingRows() {
  const data = inventoryUi.data.ranking || {};
  if (inventoryUi.rankingMode === 'unidades') return data.masVendidosUnidades || [];
  if (inventoryUi.rankingMode === 'menos') return data.menosVendidos || [];
  return data.masVendidosIngresos || [];
}

function inventoryRenderRanking() {
  const data = inventoryUi.data.ranking;
  if (!data) return inventoryEmpty('No hay información de ventas disponible.');
  const rows = inventoryRankingRows();
  return `<div class="inventory-section-heading"><div><h3>Ranking de productos</h3><p>${escapeHtml(inventoryPeriod(data.periodo))}</p></div></div>
    <div class="inventory-segmented" role="tablist" aria-label="Tipo de ranking">
      <button type="button" data-ranking-mode="ingresos" class="${inventoryUi.rankingMode === 'ingresos' ? 'active' : ''}" aria-selected="${inventoryUi.rankingMode === 'ingresos'}">Más vendidos por ingresos</button>
      <button type="button" data-ranking-mode="unidades" class="${inventoryUi.rankingMode === 'unidades' ? 'active' : ''}" aria-selected="${inventoryUi.rankingMode === 'unidades'}">Más vendidos por unidades</button>
      <button type="button" data-ranking-mode="menos" class="${inventoryUi.rankingMode === 'menos' ? 'active' : ''}" aria-selected="${inventoryUi.rankingMode === 'menos'}">Menos vendidos con ventas</button>
    </div>
    ${inventoryUi.rankingMode === 'unidades' ? `<p class="inventory-note-inline">${escapeHtml(data.advertenciaUnidades)}</p>` : ''}
    ${rows.length ? `<div class="table-wrap"><table class="inventory-table"><caption class="sr-only">Ranking de productos</caption><thead><tr><th>Posición</th><th>Producto</th><th>Cantidad vendida</th><th>Unidad base</th><th>Ingresos</th></tr></thead><tbody>${rows.map((row, index) => `<tr><td><strong>${index + 1}</strong></td><td>${escapeHtml(row.nombre)}</td><td>${escapeHtml(row.unidadesVendidas)}</td><td>${escapeHtml(row.unidadBase)}</td><td>Bs ${money(row.ingresos)}</td></tr>`).join('')}</tbody></table></div>` : inventoryEmpty('No hubo productos vendidos dentro del período.')}`;
}

function inventoryRenderValuation() {
  const data = inventoryUi.data.valoracion;
  if (!data) return inventoryEmpty('No hay datos para valorar el inventario.');
  const summary = data.resumen;
  return `<div class="inventory-section-heading"><div><h3>Valoración del inventario</h3><p>${escapeHtml(inventoryPeriod(data.periodo))}</p></div></div>
    <div class="inventory-metrics inventory-metrics-compact">
      <article class="inventory-metric"><span>Valor a costo conocido</span><strong>Bs ${money(summary.valorCostoConocido)}</strong></article>
      <article class="inventory-metric"><span>Valor potencial de venta</span><strong>Bs ${money(summary.valorVenta)}</strong></article>
      <article class="inventory-metric metric-success"><span>Ganancia potencial conocida</span><strong>Bs ${money(summary.gananciaPotencialConocida)}</strong></article>
      <article class="inventory-metric ${summary.productosConCostoDesconocido ? 'metric-warning' : 'metric-success'}"><span>Costo desconocido</span><strong>${escapeHtml(summary.productosConCostoDesconocido)} productos</strong><small>${escapeHtml(summary.unidadesConCostoDesconocido)} unidades</small></article>
    </div>
    <div class="inventory-note"><strong>Importante</strong><p>La ganancia potencial no descuenta gastos ni garantiza la venta del inventario.</p></div>
    ${data.rows?.length ? `<div class="table-wrap"><table class="inventory-table"><caption class="sr-only">Valoración por producto</caption><thead><tr><th>Producto</th><th>Stock</th><th>Valor a costo</th><th>Valor de venta</th><th>Ganancia potencial</th></tr></thead><tbody>${data.rows.map((row) => `<tr><td>${escapeHtml(row.nombre)}</td><td>${escapeHtml(row.stockActual)} ${escapeHtml(row.unidadBase)}</td><td>${row.costoConocido ? `Bs ${money(row.valorCosto)}` : '<span class="muted">Costo desconocido</span>'}</td><td>Bs ${money(row.valorVenta)}</td><td>${row.costoConocido ? `Bs ${money(row.gananciaPotencial)}` : '<span class="muted">No calculable</span>'}</td></tr>`).join('')}</tbody></table></div>` : inventoryEmpty('No hay productos para valorar.')}`;
}

function inventoryRenderSuggestionsLegacy() {
  const data = inventoryUi.data.sugerencias;
  if (!data?.rows?.length) return `${inventoryEmpty('No hay compras sugeridas para los filtros actuales.')}<div class="inventory-note"><strong>Recomendación informativa</strong><p>Esta sección nunca registra una compra ni modifica el stock.</p></div>`;
  const canWrite = !state.context?.soloLectura;
  return `<div class="inventory-section-heading"><div><h3>Compras sugeridas</h3><p>${escapeHtml(inventoryPeriod(data.periodo))} · ${data.total} recomendaciones</p></div></div>
    <div class="inventory-note"><strong>Esta es una recomendación</strong><p>No registra una compra ni modifica el stock. Revise precios, proveedor y espacio disponible antes de abastecerse.</p></div>
    <div class="inventory-suggestion-list">${data.rows.map((row) => `<article class="inventory-suggestion"><header><div><h4>${escapeHtml(row.nombre)}</h4><p>${escapeHtml(row.categoria)} · ${escapeHtml(row.proveedor || 'Sin proveedor')}</p></div>${inventoryConfidenceBadge(row)}</header><dl><div><dt>Stock</dt><dd>${escapeHtml(row.stockActual)}</dd></div><div><dt>Mínimo</dt><dd>${escapeHtml(row.stockMinimo)}</dd></div><div><dt>Promedio diario</dt><dd>${inventoryMetric(row.promedioDiario, 2, 'Sin demanda suficiente')}</dd></div><div><dt>Reposición</dt><dd>${escapeHtml(row.configuracionEfectiva?.diasReposicion)} días</dd></div><div><dt>Cobertura</dt><dd>${escapeHtml(row.configuracionEfectiva?.diasCoberturaObjetivo)} días</dd></div><div><dt>Stock objetivo</dt><dd>${escapeHtml(row.stockObjetivo)}</dd></div><div><dt>Cantidad sugerida</dt><dd><strong>${escapeHtml(row.cantidadCompraSugerida)} ${escapeHtml(row.presentacionCompraSugerida === 'paquete' ? 'paquetes' : 'unidades')}</strong></dd></div>${row.presentacionCompraSugerida === 'paquete' ? `<div><dt>Unidades finales</dt><dd>${escapeHtml(row.cantidadSugeridaUnidades)}</dd></div>` : ''}</dl><p class="inventory-reason">${escapeHtml(row.motivo)}</p>${canWrite ? `<button type="button" class="small secondary" data-inventory-product-config="${escapeHtml(row.idProducto)}">Ajustar parámetros</button>` : ''}</article>`).join('')}</div>`;
}

function inventoryRenderSuggestions() {
  const data = inventoryUi.data.sugerencias;
  if (!data?.rows?.length) return inventoryEmpty('No hay sugerencias para los filtros actuales.');
  const canWrite = !state.context?.soloLectura;
  const summary = data.resumen || {};
  return `<div class="inventory-section-heading"><div><h3>Sugerencias de compra</h3><p>${escapeHtml(inventoryPeriod(data.periodo))} · ${escapeHtml(data.total)} resultados</p></div></div>
    <div class="inventory-note"><strong>Lectura informativa</strong><p>Urgente: sin stock o cobertura menor a la reposición. Recomendada: falta para el objetivo. Exceso: más de 150% del objetivo. No registra compras ni modifica stock.</p></div>
    <p class="inventory-summary-line">Urgentes: ${escapeHtml(summary.urgente || 0)} · Recomendadas: ${escapeHtml(summary.recomendada || 0)} · Suficientes: ${escapeHtml(summary.suficiente || 0)} · Exceso: ${escapeHtml(summary.exceso || 0)} · Sin datos: ${escapeHtml(summary.sin_datos || 0)}</p>
    <div class="inventory-suggestion-list">${data.rows.map((row) => `<article class="inventory-suggestion"><header><div><h4>${escapeHtml(row.nombre)}</h4><p>${escapeHtml(row.categoria)} · ${escapeHtml(row.proveedor || 'Sin proveedor')}</p></div><span class="inventory-status inventory-status-${escapeHtml(row.estadoSugerencia)}">${escapeHtml(row.estadoSugerencia)}</span></header><dl><div><dt>Físico / vendible</dt><dd>${escapeHtml(row.stockFisico)} / ${escapeHtml(row.stockVendible)}</dd></div><div><dt>No vendible</dt><dd>${escapeHtml(row.stockNoVendible)}</dd></div><div><dt>Promedio diario</dt><dd>${inventoryMetric(row.promedioDiario, 2, 'Sin datos suficientes')}</dd></div><div><dt>Cobertura</dt><dd>${row.diasRestantes === null ? 'No calculable' : `${inventoryMetric(row.diasRestantes, 1)} días`}</dd></div><div><dt>Stock objetivo</dt><dd>${escapeHtml(row.stockObjetivo)}</dd></div><div><dt>Cantidad sugerida</dt><dd><strong>${escapeHtml(row.cantidadCompraSugerida)} ${escapeHtml(row.presentacionCompraSugerida === 'paquete' ? 'paquetes' : 'unidades')}</strong></dd></div></dl><p class="inventory-reason">${escapeHtml(row.motivo)}</p>${canWrite ? `<button type="button" class="small secondary" data-inventory-product-config="${escapeHtml(row.idProducto)}">Configurar</button>` : ''}</article>`).join('')}</div>${inventoryPagination(data)}`;
}

function inventoryRenderRotationLegacy() {
  const data = inventoryUi.data.rotacion;
  if (!data?.rows?.length) return inventoryEmpty('No hay productos para analizar en este período.');
  return `<div class="inventory-section-heading"><div><h3>Rotación y cobertura</h3><p>${escapeHtml(inventoryPeriod(data.periodo))}</p></div></div>
    <div class="table-wrap"><table class="inventory-table"><caption class="sr-only">Rotación y días restantes del inventario</caption><thead><tr><th>Producto</th><th>Unidades vendidas</th><th>Stock promedio</th><th>Rotación estimada</th><th>Días restantes</th><th>Días observados</th><th>Lectura</th></tr></thead><tbody>${data.rows.map((row) => `<tr><td><strong>${escapeHtml(row.nombre)}</strong><small>${escapeHtml(row.categoria)}</small></td><td>${escapeHtml(row.unidadesVendidasPeriodo)} ${escapeHtml(row.unidadBase)}</td><td>${inventoryMetric(row.stockPromedio, 2)}</td><td>${inventoryMetric(row.rotacion, 2)}</td><td>${row.diasRestantes === null ? '<span class="muted">Sin demanda suficiente</span>' : `${inventoryMetric(row.diasRestantes, 1)} días`}</td><td>${inventoryMetric(row.diasObservados, 1)} días</td><td>${inventoryConfidenceBadge(row)}${row.advertencia ? `<small>${escapeHtml(row.advertencia)}</small>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
}

function inventoryRenderRotation() {
  const data = inventoryUi.data.rotacion;
  if (!data?.rows?.length) return inventoryEmpty('No hay productos para analizar en este período.');
  return `<div class="inventory-section-heading"><div><h3>Rotación y cobertura</h3><p>${escapeHtml(inventoryPeriod(data.periodo))}</p></div></div>
    <div class="inventory-note"><strong>Regla</strong><p>Alta: rotación neta desde 1. Media: 0,25 a menor de 1. Baja: mayor que cero y menor de 0,25. Sin movimiento: cero unidades netas.</p></div>
    <div class="table-wrap"><table class="inventory-table"><caption class="sr-only">Rotación y cobertura del inventario</caption><thead><tr><th>Producto</th><th>Ventas netas</th><th>Días con venta</th><th>Frecuencia</th><th>Última venta</th><th>Físico / vendible</th><th>Rotación</th><th>Cobertura</th><th>Clasificación</th></tr></thead><tbody>${data.rows.map((row) => `<tr><td><strong>${escapeHtml(row.nombre)}</strong><small>${escapeHtml(row.categoria)}</small></td><td>${escapeHtml(row.unidadesVendidasPeriodo)} ${escapeHtml(row.unidadBase)}</td><td>${escapeHtml(row.diasConVentaPeriodo)}</td><td>${inventoryMetric(row.frecuenciaVentaDiaria, 2)}</td><td>${inventoryDate(row.ultimaVenta)}</td><td>${escapeHtml(row.stockFisico)} / ${escapeHtml(row.stockVendible)}<small>No vendible: ${escapeHtml(row.stockNoVendible)}</small></td><td>${inventoryMetric(row.rotacion, 2)}</td><td>${row.diasRestantes === null ? '<span class="muted">No calculable</span>' : `${inventoryMetric(row.diasRestantes, 1)} días`}</td><td><span class="inventory-status inventory-status-${escapeHtml(row.clasificacionRotacion)}">${escapeHtml(row.clasificacionRotacion)}</span></td></tr>`).join('')}</tbody></table></div>${inventoryPagination(data)}`;
}

function inventoryMovementLabel(value) {
  return ({ nuevo: 'Nuevo', nunca_vendido: 'Nunca vendido', sin_movimiento_30: '30 días o más', sin_movimiento_60: '60 días o más', sin_movimiento_90: '90 días o más' })[value] || value;
}

function inventoryRenderWithoutMovement() {
  const data = inventoryUi.data.sinMovimiento;
  if (!data) return inventoryEmpty('No hay información de movimiento disponible.');
  const rows = (data.rows || []).filter((row) => !inventoryUi.movementClass || row.clasificacionMovimiento === inventoryUi.movementClass);
  return `<div class="inventory-section-heading"><div><h3>Productos sin movimiento</h3><p>${escapeHtml(inventoryPeriod(data.periodo))}</p></div><label>Clasificación<select id="inventoryMovementClass"><option value="">Todas</option><option value="nuevo" ${inventoryUi.movementClass === 'nuevo' ? 'selected' : ''}>Nuevos</option><option value="nunca_vendido" ${inventoryUi.movementClass === 'nunca_vendido' ? 'selected' : ''}>Nunca vendidos</option><option value="sin_movimiento_30" ${inventoryUi.movementClass === 'sin_movimiento_30' ? 'selected' : ''}>30 días</option><option value="sin_movimiento_60" ${inventoryUi.movementClass === 'sin_movimiento_60' ? 'selected' : ''}>60 días</option><option value="sin_movimiento_90" ${inventoryUi.movementClass === 'sin_movimiento_90' ? 'selected' : ''}>90 días</option></select></label></div>
    ${rows.length ? `<div class="table-wrap"><table class="inventory-table"><caption class="sr-only">Productos sin movimiento comercial</caption><thead><tr><th>Producto</th><th>Última venta</th><th>Días sin venta</th><th>Seguimiento desde</th><th>Clasificación</th><th>Stock</th><th>Valor inmovilizado</th></tr></thead><tbody>${rows.map((row) => { const knownCost = Number(row.ultimoPrecioCompra) > 0; const immobilized = knownCost ? Number(row.stockActual) * Number(row.ultimoPrecioCompra) : null; return `<tr><td><strong>${escapeHtml(row.nombre)}</strong></td><td>${inventoryDate(row.ultimaVenta)}</td><td>${row.diasSinVenta === null ? 'Nunca vendido' : `${inventoryMetric(row.diasSinVenta, 0)} días`}</td><td>${inventoryDate(row.fechaInicioSeguimiento)}</td><td><span class="inventory-classification">${escapeHtml(inventoryMovementLabel(row.clasificacionMovimiento))}</span></td><td>${escapeHtml(row.stockActual)} ${escapeHtml(row.unidadBase)}</td><td>${immobilized === null ? '<span class="muted">Costo desconocido</span>' : `Bs ${money(immobilized)}`}</td></tr>`; }).join('')}</tbody></table></div>` : inventoryEmpty('No hay productos en esta clasificación. No se consideran paralizados los productos nuevos.')}`;
}

function inventoryConfigurationInput(name, label, value, min, max, help) {
  return `<label>${escapeHtml(label)}<input type="number" name="${name}" value="${escapeHtml(value)}" min="${min}" max="${max}" step="1" required ${state.context?.soloLectura ? 'disabled' : ''}><small>${escapeHtml(help)}</small></label>`;
}

function inventoryRenderConfiguration() {
  const data = inventoryUi.data.configuracion;
  const config = data?.configuracionTienda;
  if (!config) return inventoryEmpty('No se encontró la configuración de inventario de la tienda.');
  return `<div class="inventory-section-heading"><div><h3>Configuración de análisis</h3><p>Estos valores se usan cuando un producto no tiene parámetros propios.</p></div></div>
    ${state.context?.soloLectura ? '<div class="inventory-note"><strong>Modo solo lectura</strong><p>Puede consultar estos valores, pero no guardarlos hasta reactivar la suscripción.</p></div>' : ''}
    <form id="inventoryConfigurationForm" class="inventory-config-form">
      ${inventoryConfigurationInput('periodoAnalisisDias', 'Período de análisis', config.periodoAnalisisDias, 7, 365, 'Entre 7 y 365 días.')}
      ${inventoryConfigurationInput('diasHistorialMinimo', 'Historial mínimo', config.diasHistorialMinimo, 1, 365, 'No puede superar el período de análisis.')}
      ${inventoryConfigurationInput('diasReposicionDefault', 'Reposición por defecto', config.diasReposicionDefault, 0, 365, 'Tiempo habitual del proveedor.')}
      ${inventoryConfigurationInput('diasCoberturaDefault', 'Cobertura por defecto', config.diasCoberturaDefault, 1, 365, 'Días adicionales de inventario.')}
      ${inventoryConfigurationInput('diasProductoNuevo', 'Producto nuevo durante', config.diasProductoNuevo, 1, 365, 'Evita marcar productos recientes como paralizados.')}
      <div class="actions wide"><button type="submit" data-inventory-write ${state.context?.soloLectura ? 'disabled' : ''}>Guardar configuración</button></div>
      <p class="form-error wide" data-inventory-config-error aria-live="polite"></p>
    </form>`;
}

function renderInventoryActiveTab() {
  const target = document.getElementById('inventoryContent');
  if (!target) return;
  const renderers = {
    resumen: inventoryRenderSummary, alertas: inventoryRenderAlerts, ranking: inventoryRenderRanking,
    valoracion: inventoryRenderValuation, sugerencias: inventoryRenderSuggestions,
    rotacion: inventoryRenderRotation, sinMovimiento: inventoryRenderWithoutMovement,
    configuracion: inventoryRenderConfiguration
  };
  target.innerHTML = renderers[inventoryUi.activeTab]?.() || inventoryEmpty('Seleccione una sección de inventario.');
  target.querySelector('[data-inventory-retry]')?.addEventListener('click', () => loadInventoryActiveTab(true));
  target.querySelectorAll('[data-inventory-product-config]').forEach((button) => button.addEventListener('click', () => openInventoryProductConfiguration(button.dataset.inventoryProductConfig)));
  target.querySelectorAll('[data-inventory-product-lots]').forEach((button) => button.addEventListener('click', () => openProductLotAvailability(button.dataset.inventoryProductLots)));
  target.querySelector('[data-open-lot-dashboard]')?.addEventListener('click', () => loadView('lotesVencimientos'));
  target.querySelectorAll('[data-ranking-mode]').forEach((button) => button.addEventListener('click', () => {
    inventoryUi.rankingMode = button.dataset.rankingMode;
    renderInventoryActiveTab();
  }));
  document.getElementById('inventoryMovementClass')?.addEventListener('change', (event) => {
    inventoryUi.movementClass = event.target.value;
    renderInventoryActiveTab();
  });
  target.querySelectorAll('[data-inventory-page]').forEach((button) => button.addEventListener('click', async () => {
    inventoryUi.page = Number(button.dataset.inventoryPage);
    inventoryUi.data[inventoryUi.activeTab] = null;
    await loadInventoryActiveTab(true);
  }));
  document.getElementById('inventoryConfigurationForm')?.addEventListener('submit', saveInventoryConfiguration);
  applyReadOnlyUi();
}

async function loadInventoryActiveTab(force = false) {
  const tab = inventoryUi.activeTab;
  const content = document.getElementById('inventoryContent');
  if (!content) return;
  if (!force && inventoryUi.data[tab]) return renderInventoryActiveTab();
  content.innerHTML = inventoryLoading();
  content.setAttribute('aria-busy', 'true');
  const request = ++inventoryUi.request;
  try {
    const query = inventoryFilterQuery().toString();
    if (tab === 'resumen') {
      const [summary, valuation, lots] = await Promise.all([
        api(`/api/inventario-inteligente/resumen?${query}`),
        api(`/api/inventario-inteligente/valoracion?${query}`),
        hasLotOperationalAccess() ? api('/api/lotes/resumen') : Promise.resolve(null)
      ]);
      inventoryUi.data.resumen = summary;
      inventoryUi.data.resumenValoracion = valuation;
      inventoryUi.data.resumenLotes = lots;
    } else {
      const endpoints = {
        alertas: 'alertas', ranking: 'ranking', valoracion: 'valoracion', sugerencias: 'compras-sugeridas',
        rotacion: 'rotacion', sinMovimiento: 'sin-movimiento', configuracion: 'configuracion'
      };
      inventoryUi.data[tab] = await api(`/api/inventario-inteligente/${endpoints[tab]}?${tab === 'configuracion' ? 'limite=100' : query}`);
    }
    if (request === inventoryUi.request && inventoryUi.activeTab === tab) renderInventoryActiveTab();
  } catch (error) {
    if (request === inventoryUi.request && inventoryUi.activeTab === tab) {
      content.innerHTML = inventoryErrorState(error);
      content.querySelector('[data-inventory-retry]')?.addEventListener('click', () => loadInventoryActiveTab(true));
    }
  } finally {
    if (request === inventoryUi.request) content.removeAttribute('aria-busy');
  }
}

async function saveInventoryConfiguration(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const errorTarget = form.querySelector('[data-inventory-config-error]');
  const values = Object.fromEntries([...new FormData(form).entries()].map(([key, value]) => [key, Number(value)]));
  if (!Number.isInteger(values.periodoAnalisisDias) || values.periodoAnalisisDias < 7 || values.periodoAnalisisDias > 365
    || !Number.isInteger(values.diasHistorialMinimo) || values.diasHistorialMinimo < 1
    || values.diasHistorialMinimo > values.periodoAnalisisDias
    || !Number.isInteger(values.diasReposicionDefault) || values.diasReposicionDefault < 0 || values.diasReposicionDefault > 365
    || !Number.isInteger(values.diasCoberturaDefault) || values.diasCoberturaDefault < 1 || values.diasCoberturaDefault > 365
    || !Number.isInteger(values.diasProductoNuevo) || values.diasProductoNuevo < 1 || values.diasProductoNuevo > 365) {
    errorTarget.textContent = 'Revise los rangos. El historial mínimo no puede superar el período de análisis.';
    return;
  }
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  errorTarget.textContent = '';
  try {
    const result = await api('/api/inventario-inteligente/configuracion', { method: 'PUT', body: JSON.stringify(values) });
    inventoryUi.data = { configuracion: { ...inventoryUi.data.configuracion, configuracionTienda: result.configuracion } };
    await showSuccess('Configuración de inventario actualizada.');
    renderInventoryActiveTab();
  } catch (error) {
    errorTarget.textContent = error.message;
  } finally {
    submit.disabled = Boolean(state.context?.soloLectura);
  }
}

async function openInventoryProductConfiguration(idProducto) {
  if (state.context?.soloLectura) return showError('La cuenta está en modo de solo lectura.');
  try {
    const returnFocus = document.activeElement;
    const data = await api(`/api/inventario-inteligente/configuracion?producto=${encodeURIComponent(idProducto)}&limite=1`);
    const product = data.productos?.rows?.[0];
    if (!product) throw new Error('No se encontró el producto dentro de esta tienda.');
    const packageAvailable = Number(product.unidadesPorPaquete) > 1;
    modalRoot.innerHTML = `<div class="modal-backdrop"><form class="modal" id="inventoryProductConfigurationForm" role="dialog" aria-modal="true" aria-labelledby="inventoryProductConfigurationTitle">
      <h3 id="inventoryProductConfigurationTitle">Configurar ${escapeHtml(product.nombre)}</h3>
      <div class="modal-body inventory-product-config">
        <p class="muted">Deje un campo vacío para usar la configuración general de la tienda.</p>
        <label>Días de reposición<input name="diasReposicion" type="number" min="0" max="365" step="1" value="${escapeHtml(product.diasReposicion ?? '')}" placeholder="Automático"></label>
        <label>Días de cobertura objetivo<input name="diasCoberturaObjetivo" type="number" min="1" max="365" step="1" value="${escapeHtml(product.diasCoberturaObjetivo ?? '')}" placeholder="Automático"></label>
        <label>Presentación sugerida<select name="presentacionCompraSugerida"><option value="">Automático</option><option value="unidad" ${product.presentacionCompraSugerida === 'unidad' ? 'selected' : ''}>Unidad</option>${packageAvailable ? `<option value="paquete" ${product.presentacionCompraSugerida === 'paquete' ? 'selected' : ''}>Paquete de ${escapeHtml(product.unidadesPorPaquete)} unidades</option>` : ''}</select></label>
        <p class="hint">Este formulario no modifica stock, precio, actividad ni la fecha de seguimiento.</p>
        <p class="form-error" data-product-config-error aria-live="polite"></p>
      </div>
      <div class="modal-actions"><button type="button" class="secondary" data-modal-cancel>Cancelar</button><button type="submit" data-inventory-write>Guardar</button></div>
    </form></div>`;
    const form = document.getElementById('inventoryProductConfigurationForm');
    const close = () => {
      modalRoot.innerHTML = '';
      returnFocus?.focus?.();
    };
    modalRoot.querySelector('[data-modal-cancel]').addEventListener('click', close);
    form.querySelector('input, select')?.focus();
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const values = formData(form);
      const optionalInteger = (value, minimum) => {
        if (value === '') return null;
        const number = Number(value);
        if (!Number.isInteger(number) || number < minimum || number > 365) throw new Error(`Use números enteros entre ${minimum} y 365.`);
        return number;
      };
      const submit = form.querySelector('button[type="submit"]');
      const errorTarget = form.querySelector('[data-product-config-error]');
      try {
        const body = {
          diasReposicion: optionalInteger(values.diasReposicion, 0),
          diasCoberturaObjetivo: optionalInteger(values.diasCoberturaObjetivo, 1),
          presentacionCompraSugerida: values.presentacionCompraSugerida || null
        };
        submit.disabled = true;
        await api(`/api/productos/${encodeURIComponent(idProducto)}/configuracion-inventario`, { method: 'PATCH', body: JSON.stringify(body) });
        close();
        inventoryUi.data = {};
        await showSuccess('Configuración del producto actualizada.');
        await loadInventoryActiveTab(true);
        document.querySelector('[data-inventory-tab].active')?.focus();
      } catch (error) {
        errorTarget.textContent = error.message;
        submit.disabled = false;
      }
    });
  } catch (error) {
    showError(error.message);
  }
}

async function downloadInventoryExport() {
  const button = document.getElementById('exportInventory');
  if (!button) return;
  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = 'Generando archivo...';
  try {
    const query = inventoryFilterQuery();
    const types = { alertas: 'alertas', sugerencias: 'sugerencias', rotacion: 'rotacion' };
    query.set('tipoExportacion', types[inventoryUi.activeTab] || 'completo');
    const response = await SecurityHttp.secureFetch(`/api/inventario-inteligente/exportacion.xlsx?${query.toString()}`);
    if (response.status === 401) window.location.href = '/login.html';
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw SecurityHttp.errorFromResponse(response, body, 'No se pudo generar la exportación.');
    }
    const blob = await response.blob();
    const disposition = response.headers.get('content-disposition') || '';
    const rawName = disposition.match(/filename="([^"]+)"/)?.[1] || 'inteligencia-inventario.xlsx';
    const fileName = rawName.replace(/[^a-zA-Z0-9._-]/g, '-');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    showError(error.message);
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function inventarioInteligente() {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29);
  inventoryUi = { activeTab: 'resumen', rankingMode: 'ingresos', movementClass: '', page: 1, request: 0, data: {} };
  const tabs = inventoryTabs();
  view.innerHTML = `<div class="panel inventory-filter-panel">
    <form id="inventoryFilters" class="inventory-filters">
      <label>Desde<input type="date" name="desde" value="${localDateValue(start)}"></label>
      <label>Hasta<input type="date" name="hasta" value="${localDateValue(today)}"></label>
      <label>Ventana rápida<select name="ventana"><option value="">Fechas manuales</option><option value="7">7 días</option><option value="30">30 días</option><option value="90">90 días</option></select></label>
      <label>Categoría<select name="categoria"><option value="">Todas</option>${categoryOptions()}</select></label>
      <label>Proveedor<select name="proveedor">${options(state.proveedores, 'idProveedor', 'nombre', 'Todos')}</select></label>
      <label>Producto<select name="producto">${options(state.productos, 'idProducto', 'nombre', 'Todos')}</select></label>
      <label>Estado<select name="estado"><option value="">Todos</option><option value="agotado">Agotado</option><option value="bajo">Stock bajo</option><option value="en_minimo">En mínimo</option><option value="suficiente">Suficiente</option><option value="inactivo">Inactivo</option></select></label>
      <label>Prioridad<select name="prioridad"><option value="">Todas</option><option value="critical">Crítica</option><option value="warning">Advertencia</option><option value="info">Informativa</option></select></label>
      <label>Alerta<select name="tipoAlerta"><option value="">Todas</option><option value="stock_vendible_bajo">Stock bajo</option><option value="sin_stock_vendible">Sin stock</option><option value="exceso_inventario">Exceso</option><option value="baja_rotacion">Baja rotación</option><option value="sin_movimiento">Sin movimiento</option><option value="proximo_vencimiento">Próximo vencimiento</option><option value="vencido">Vencido</option><option value="stock_no_vendible_alto">No vendible alto</option><option value="conciliacion">Conciliación</option></select></label>
      <label>Sugerencias<select name="estadoSugerencia"><option value="todos">Todas</option><option value="urgente">Urgentes</option><option value="recomendada">Recomendadas</option><option value="suficiente">Suficientes</option><option value="exceso">Exceso</option><option value="sin_datos">Sin datos</option></select></label>
      <label>Resultados<select name="limite"><option value="25">25</option><option value="50" selected>50</option><option value="100">100</option></select></label>
      <div class="inventory-filter-actions"><button type="submit">Aplicar filtros</button><button type="button" class="secondary" id="clearInventoryFilters">Limpiar</button>${inventoryFeature('exportacion_inventario') ? '<button type="button" class="secondary" id="exportInventory">Exportar inventario</button>' : ''}</div>
    </form>
    <p class="hint">El período incluye el día “Hasta” y se procesa internamente como un rango seguro de inicio incluido y fin excluido. Máximo 365 días.</p>
  </div>
  <div class="inventory-tabs" role="tablist" aria-label="Análisis de inventario">${tabs.map(([id, label], index) => `<button type="button" role="tab" data-inventory-tab="${id}" aria-selected="${index === 0}" class="${index === 0 ? 'active' : ''}">${escapeHtml(label)}</button>`).join('')}</div>
  ${!inventoryAdvancedAvailable() ? '<div class="inventory-plan-note"><strong>Análisis avanzado</strong><span>Compras sugeridas, rotación, productos sin movimiento y exportación están disponibles en el plan avanzado.</span></div>' : ''}
  <div class="panel inventory-content" id="inventoryContent"></div>`;
  const form = document.getElementById('inventoryFilters');
  const updateInventoryFilters = compactInventoryFilters(form,
    ['desde', 'hasta', 'ventana', 'categoria', 'proveedor', 'producto', 'estado', 'prioridad', 'tipoAlerta', 'estadoSugerencia', 'limite'],
    { desde: form.elements.desde.value, hasta: form.elements.hasta.value, estadoSugerencia: 'todos', limite: '50' });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      inventoryFilterQuery();
      inventoryUi.page = 1;
      inventoryUi.data = {};
      await loadInventoryActiveTab(true);
    } catch (error) { showError(error.message); }
  });
  document.getElementById('clearInventoryFilters').addEventListener('click', async () => {
    form.reset();
    form.elements.desde.value = localDateValue(start);
    form.elements.hasta.value = localDateValue(today);
    form.elements.ventana.value = '';
    updateInventoryFilters();
    inventoryUi.page = 1;
    inventoryUi.data = {};
    await loadInventoryActiveTab(true);
  });
  document.getElementById('exportInventory')?.addEventListener('click', downloadInventoryExport);
  document.querySelectorAll('[data-inventory-tab]').forEach((button) => button.addEventListener('click', async () => {
    inventoryUi.activeTab = button.dataset.inventoryTab;
    inventoryUi.page = 1;
    document.querySelectorAll('[data-inventory-tab]').forEach((item) => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
    });
    await loadInventoryActiveTab();
  }));
  await loadInventoryActiveTab();
}

function lotDate(value) {
  if (!value) return 'Sin vencimiento';
  const text = String(value).slice(0, 10);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : escapeHtml(text);
}

function lotStatusLabel(value) {
  return ({
    vencido: 'Vencido', vence_hoy: 'Vence hoy', proximo_a_vencer: 'Próximo a vencer',
    vigente: 'Vigente', bloqueado: 'Bloqueado', aislado: 'Aislado',
    tecnico: 'Tecnico', agotado: 'Agotado',
    disponible: 'Disponible', anulado: 'Anulado'
  })[value] || value || 'Sin estado';
}

function lotBadge(value) {
  return `<span class="lot-badge lot-${escapeHtml(value || 'vigente')}">${escapeHtml(lotStatusLabel(value))}</span>`;
}

function lotCost(value) {
  return value === null || value === undefined || value === ''
    ? '<span class="muted">Costo desconocido</span>'
    : `Bs ${money(value)}`;
}

function lotLoading(text = 'Cargando lotes...') {
  return `<div class="inventory-loading" role="status" aria-live="polite"><span class="sr-only">${escapeHtml(text)}</span>${UiPatterns.skeleton('rows', 4)}</div>`;
}

function lotEmpty(text) {
  return UiPatterns.empty('Sin datos', escapeHtml(text));
}

function lotFilterQuery(page = lotUi.page) {
  const form = document.getElementById('lotFilters');
  const values = form ? formData(form) : {};
  const query = new URLSearchParams({ pagina: String(page), limite: values.limite || '25' });
  ['producto', 'proveedor', 'codigoLote', 'estadoOperativo', 'estadoCalculado', 'venceDesde', 'venceHasta']
    .forEach((key) => { if (values[key]) query.set(key, values[key]); });
  if (form?.querySelector('[name="soloConSaldo"]')?.checked) query.set('soloConSaldo', 'true');
  return query;
}

function renderLotSummary(summary) {
  const metrics = [
    ['Productos controlados', summary.productosControlados, 'neutral'],
    ['Stock trazado', summary.stockTrazado, 'neutral'],
    ['Stock vendible', summary.stockVendible, 'success'],
    ['Stock no vendible', summary.stockNoVendible, 'warning'],
    ['Stock vencido', summary.stockVencido, 'danger'],
    ['Stock bloqueado', summary.stockBloqueado, 'warning'],
    ['Stock aislado', summary.stockAislado, 'warning'],
    ['Stock tecnico', summary.stockTecnico, 'neutral'],
    ['Próximos a vencer', summary.lotesProximos, 'attention'],
    ['Valor conocido por lotes', `Bs ${money(summary.valorTotalRestante)}`, 'neutral']
  ];
  const alerts = [
    ['Vencidos', summary.lotesVencidos, 'vencido'], ['Vencen hoy', summary.lotesVencenHoy, 'vence_hoy'],
    ['Próximos', summary.lotesProximos, 'proximo_a_vencer'], ['Bloqueados', summary.lotesBloqueados, 'bloqueado'],
    ['Agotados', summary.lotesAgotados, 'agotado']
  ];
  return `<div class="lot-summary-grid">${metrics.map(([label, value, tone]) => `
    <article class="inventory-metric metric-${tone}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`).join('')}</div>
    <div class="lot-alert-strip" aria-label="Resumen de alertas">${alerts.map(([label, value, status]) => `<span>${lotBadge(status)}<strong>${escapeHtml(value)}</strong><small>${escapeHtml(label)}</small></span>`).join('')}</div>
    ${Number(summary.lotesCostoDesconocido) > 0 ? `<p class="inventory-note-inline">Costo desconocido en ${escapeHtml(summary.lotesCostoDesconocido)} lotes con saldo.</p>` : ''}`;
}

function lotRowActions(row) {
  return `<div class="actions">
    <button type="button" class="small secondary" data-lot-detail="${row.idLoteProducto}">Ver detalle</button>
    <button type="button" class="small secondary" data-lot-product-config="${row.idProducto}">Configurar producto</button>
  </div>`;
}

function renderLotRows(rows) {
  if (!rows.length) return lotEmpty('No hay lotes para los filtros seleccionados.');
  const desktop = `<div class="table-wrap lot-desktop-table"><table><caption class="sr-only">Lotes de productos</caption>
    <thead><tr><th>Producto</th><th>Lote</th><th>Proveedor</th><th>Vencimiento</th><th>Estado</th><th>Cantidades</th><th>Costo y valor</th><th>Origen</th><th>Acciones</th></tr></thead>
    <tbody>${rows.map((row) => `<tr>
      <td><strong>${escapeHtml(row.producto)}</strong><small>${escapeHtml(row.categoria || 'Sin categoría')}</small></td>
      <td>${escapeHtml(row.codigoLote || 'Sin código')}</td><td>${escapeHtml(row.proveedor || 'Sin proveedor')}</td>
      <td>${lotDate(row.fechaVencimiento)}</td><td>${lotBadge(row.estadoCalculado)}<small>${escapeHtml(lotStatusLabel(row.estadoOperativo))}</small></td>
      <td><strong>${escapeHtml(row.cantidadRestante)}</strong> restantes<small>Inicial: ${escapeHtml(row.cantidadInicial)}</small></td>
      <td>${lotCost(row.costoUnitarioBase)}<small>Valor: ${row.valorRestante === null ? 'desconocido' : `Bs ${money(row.valorRestante)}`}</small></td>
      <td>${escapeHtml(lotStatusLabel(row.origen))}</td><td>${lotRowActions(row)}</td>
    </tr>`).join('')}</tbody></table></div>`;
  const mobile = `<div class="lot-mobile-list">${rows.map((row) => `<article class="lot-card">
    <header><div><strong>${escapeHtml(row.producto)}</strong><span>${escapeHtml(row.codigoLote || 'Sin código')}</span></div>${lotBadge(row.estadoCalculado)}</header>
    <dl><div><dt>Vencimiento</dt><dd>${lotDate(row.fechaVencimiento)}</dd></div><div><dt>Saldo</dt><dd>${escapeHtml(row.cantidadRestante)} unidades</dd></div>
      <div><dt>Proveedor</dt><dd>${escapeHtml(row.proveedor || 'Sin proveedor')}</dd></div><div><dt>Valor</dt><dd>${row.valorRestante === null ? 'Costo desconocido' : `Bs ${money(row.valorRestante)}`}</dd></div></dl>
    ${lotRowActions(row)}</article>`).join('')}</div>`;
  return desktop + mobile;
}

function wireLotRowActions(root) {
  root.querySelectorAll('[data-lot-detail]').forEach((button) => button.addEventListener('click', () => openLotDetail(button.dataset.lotDetail)));
  root.querySelectorAll('[data-lot-product-config]').forEach((button) => button.addEventListener('click', () => {
    openLotProductConfiguration(state.productos.find((product) => String(product.idProducto) === button.dataset.lotProductConfig));
  }));
}

async function loadLotsPanel(page = 1) {
  const target = document.getElementById('lotContent');
  if (!target) return;
  target.innerHTML = lotLoading(lotUi.activeTab === 'alertas' ? 'Cargando alertas...' : 'Cargando lotes...');
  try {
    const query = lotFilterQuery(page);
    const [summary, data] = await Promise.all([
      api(`/api/lotes/resumen?${query}`),
      api(`/api/lotes?${query}`)
    ]);
    lotUi.page = Number(data.page || 1);
    lotUi.pages = Number(data.pages || 1);
    const alertNote = lotUi.activeTab === 'alertas'
      ? '<div class="inventory-note"><strong>Alertas de vencimiento</strong><p>Use el filtro de estado para revisar vencidos, los que vencen hoy, próximos, bloqueados o agotados.</p><div class="inventory-segmented"><button type="button" data-lot-alert-days="7">Próximos 7 días</button><button type="button" data-lot-alert-days="15">15 días</button><button type="button" data-lot-alert-days="30">30 días</button><button type="button" class="secondary" data-lot-alert-days="all">Limpiar período</button></div></div>' : '';
    target.innerHTML = `${renderLotSummary(summary)}${alertNote}<div class="lot-results-heading"><strong>${escapeHtml(data.total)} lotes</strong><span>Página ${lotUi.page} de ${lotUi.pages}</span></div>${renderLotRows(data.rows)}
      <div class="movement-pagination"><button type="button" class="secondary" id="lotPrevious">Anterior</button><span>Página ${lotUi.page} de ${lotUi.pages}</span><button type="button" class="secondary" id="lotNext">Siguiente</button></div>`;
    document.getElementById('lotPrevious').disabled = lotUi.page <= 1;
    document.getElementById('lotNext').disabled = lotUi.page >= lotUi.pages;
    document.getElementById('lotPrevious').addEventListener('click', () => loadLotsPanel(lotUi.page - 1));
    document.getElementById('lotNext').addEventListener('click', () => loadLotsPanel(lotUi.page + 1));
    wireLotRowActions(target);
    target.querySelectorAll('[data-lot-alert-days]').forEach((button) => button.addEventListener('click', () => {
      const form = document.getElementById('lotFilters');
      if (button.dataset.lotAlertDays === 'all') {
        form.elements.venceDesde.value = '';
        form.elements.venceHasta.value = '';
        form.elements.estadoCalculado.value = '';
      } else {
        const today = new Date();
        const days = Number(button.dataset.lotAlertDays);
        form.elements.venceDesde.value = localDateValue(today);
        form.elements.venceHasta.value = localDateValue(new Date(today.getFullYear(), today.getMonth(), today.getDate() + days));
        form.elements.estadoCalculado.value = 'proximo_a_vencer';
      }
      loadLotsPanel(1);
    }));
  } catch (error) {
    target.innerHTML = `<div class="inventory-empty inventory-error"><strong>No se pudo cargar</strong><p>${escapeHtml(error.message)}</p><button type="button" id="retryLots">Reintentar</button></div>`;
    document.getElementById('retryLots').addEventListener('click', () => loadLotsPanel(page));
  }
}

async function openLotDetail(idLote) {
  const trigger = document.activeElement;
  try {
    const data = await api(`/api/lotes/${encodeURIComponent(idLote)}`);
    const lot = data.lote;
    const movements = data.movimientos || [];
    await modal({
      title: `Lote de ${lot.producto}`,
      wide: true,
      confirmText: 'Cerrar',
      body: `<div class="lot-detail-grid">
        <div><span>Producto</span><strong>${escapeHtml(lot.producto)}</strong></div><div><span>Código</span><strong>${escapeHtml(lot.codigoLote || 'Sin código')}</strong></div>
        <div><span>Estado</span>${lotBadge(lot.estadoOperativo)}</div>
        <div><span>Clasificacion</span>${lotBadge(lot.clasificacionInventario)}</div>
        <div><span>Vencimiento</span><strong>${lotDate(lot.fechaVencimiento)}</strong></div>
        <div><span>Ingreso</span><strong>${escapeHtml(formatDate(lot.fechaIngreso))}</strong></div><div><span>Proveedor</span><strong>${escapeHtml(lot.proveedor || 'Sin proveedor')}</strong></div>
        <div><span>Cantidad inicial</span><strong>${escapeHtml(lot.cantidadInicial)}</strong></div><div><span>Cantidad restante</span><strong>${escapeHtml(lot.cantidadRestante)}</strong></div>
        <div><span>Costo unitario</span><strong>${lot.costoUnitarioBase === null ? 'Desconocido' : `Bs ${money(lot.costoUnitarioBase)}`}</strong></div><div><span>Valor restante</span><strong>${lot.valorRestante === null ? 'Desconocido' : `Bs ${money(lot.valorRestante)}`}</strong></div>
        <div><span>Compra</span><strong>${lot.idCompra ? `#${escapeHtml(lot.idCompra)} · ${escapeHtml(formatDate(lot.fechaCompra))}` : 'Sin compra relacionada'}</strong></div><div><span>Creado por</span><strong>${escapeHtml(lot.creadoPor || 'Sistema')}</strong></div>
      </div>
      <div class="inventory-note"><strong>Saldo del producto</strong><p>General: ${escapeHtml(data.stock.stockGeneral)} · trazado: ${escapeHtml(data.stock.stockTrazado)} · vendible: ${escapeHtml(data.stock.stockVendible)}</p></div>
      <h4>Movimientos y trazabilidad</h4>${movements.length ? `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Cantidad</th><th>Saldo del lote</th><th>Referencia</th><th>Responsable</th></tr></thead><tbody>${movements.map((movement) => `<tr><td>${escapeHtml(formatDate(movement.creadoEn))}</td><td>${escapeHtml(lotStatusLabel(movement.tipoRegistro))}</td><td>${Number(movement.cantidad) > 0 ? '+' : ''}${escapeHtml(movement.cantidad)}</td><td>${escapeHtml(movement.cantidadAnterior)} → ${escapeHtml(movement.cantidadPosterior)}</td><td>${movement.idVenta ? `Venta #${escapeHtml(movement.idVenta)}` : movement.origen === 'compra' ? 'Compra' : escapeHtml(movement.origen || 'Distribución inicial')}</td><td>${escapeHtml(movement.responsable || 'Sistema')}</td></tr>`).join('')}</tbody></table></div>` : lotEmpty('Este lote todavía no tiene movimientos posteriores.')}`
    });
  } catch (error) { await showError(error.message); }
  trigger?.focus?.();
}

async function openProductLotAvailability(idProducto) {
  try {
    const data = await api(`/api/productos/${encodeURIComponent(idProducto)}/lotes-disponibles`);
    await modal({
      title: `Lotes disponibles de ${data.producto.nombre}`,
      wide: true,
      confirmText: 'Cerrar',
      body: `<div class="lot-balance-strip"><span>Stock general<strong>${escapeHtml(data.stockGeneral)}</strong></span><span>Stock trazado<strong>${escapeHtml(data.stockTrazado)}</strong></span><span>Stock vendible<strong>${escapeHtml(data.stockVendible)}</strong></span></div>
        <p class="inventory-note-inline">La salida se asigna automáticamente por ${Number(data.producto.controlaVencimiento) ? 'FEFO' : 'FIFO'}.</p>
        ${data.lotes.length ? `<div class="lot-mobile-list always-visible">${data.lotes.map((lot) => `<article class="lot-card"><header><div><strong>${escapeHtml(lot.codigoLote || 'Sin código')}</strong><span>${lotDate(lot.fechaVencimiento)}</span></div>${lotBadge(lot.vendible ? 'vigente' : lot.motivoNoVendible)}</header><dl><div><dt>Saldo</dt><dd>${escapeHtml(lot.cantidadRestante)}</dd></div><div><dt>Ingreso</dt><dd>${escapeHtml(formatDate(lot.fechaIngreso))}</dd></div><div><dt>Costo</dt><dd>${lot.costoUnitarioBase === null ? 'Desconocido' : `Bs ${money(lot.costoUnitarioBase)}`}</dd></div></dl><button type="button" class="secondary small" data-lot-detail="${lot.idLoteProducto}">Ver trazabilidad</button></article>`).join('')}</div>` : lotEmpty('Este producto todavía no tiene lotes.')}`,
      onOpen: wireLotRowActions
    });
  } catch (error) { showError(error.message); }
}

async function downloadLotExport() {
  const button = document.getElementById('exportLots');
  if (!button) return;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Generando archivo...';
  try {
    const response = await SecurityHttp.secureFetch(`/api/lotes/exportacion.xlsx?${lotFilterQuery(1)}`);
    if (response.status === 401) window.location.href = '/login.html';
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw SecurityHttp.errorFromResponse(response, body, 'No se pudo generar la exportación.');
    }
    const blob = await response.blob();
    const disposition = response.headers.get('content-disposition') || '';
    const name = (disposition.match(/filename="([^"]+)"/)?.[1] || 'lotes-vencimientos.xlsx').replace(/[^a-zA-Z0-9._-]/g, '-');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) { showError(error.message); }
  finally { button.disabled = false; button.textContent = original; }
}

async function lotesVencimientos() {
  lotUi = { page: 1, pages: 1, activeTab: 'lotes' };
  const canAlert = hasFeature('alertas_vencimiento');
  const canExport = hasFeature('exportacion_lotes');
  const downgraded = !hasFeature('trazabilidad_lotes') && Number(state.lotAccess?.productosControlados || 0) > 0;
  view.innerHTML = `${downgraded ? '<div class="inventory-plan-note"><strong>Trazabilidad protegida</strong><span>La tienda conserva productos controlados. Puede consultar sus lotes, pero las funciones avanzadas dependen del plan actual.</span></div>' : ''}
    <div class="panel lot-filter-panel"><form id="lotFilters" class="lot-filters">
      <label>Producto<select name="producto">${options(state.productos, 'idProducto', 'nombre', 'Todos')}</select></label>
      <label>Proveedor<select name="proveedor">${options(state.proveedores, 'idProveedor', 'nombre', 'Todos')}</select></label>
      <label>Código de lote<input name="codigoLote" maxlength="80" placeholder="Buscar código"></label>
      <label>Estado operativo<select name="estadoOperativo"><option value="">Todos</option><option value="disponible">Disponible</option><option value="bloqueado">Bloqueado</option><option value="anulado">Anulado</option></select></label>
      <label>Estado calculado<select name="estadoCalculado"><option value="">Todos</option><option value="vencido">Vencido</option><option value="vence_hoy">Vence hoy</option><option value="proximo_a_vencer">Próximo a vencer</option><option value="vigente">Vigente</option><option value="bloqueado">Bloqueado</option><option value="agotado">Agotado</option></select></label>
      <label>Vence desde<input name="venceDesde" type="date"></label><label>Vence hasta<input name="venceHasta" type="date"></label>
      <label>Resultados<select name="limite"><option value="25">25</option><option value="50">50</option><option value="100">100</option></select></label>
      <label class="check"><input name="soloConSaldo" type="checkbox"> Solo con saldo</label>
      <div class="lot-filter-actions"><button type="submit">Aplicar filtros</button><button type="button" class="secondary" id="clearLotFilters">Limpiar</button>${canExport ? '<button type="button" class="secondary" id="exportLots">Exportar XLSX</button>' : ''}</div>
    </form></div>
    <div class="inventory-tabs" role="tablist" aria-label="Vistas de lotes"><button type="button" class="active" role="tab" data-lot-tab="lotes" aria-selected="true">Todos los lotes</button>${canAlert ? '<button type="button" role="tab" data-lot-tab="alertas" aria-selected="false">Alertas</button>' : ''}</div>
    <div class="panel" id="lotContent"></div>`;
  const form = document.getElementById('lotFilters');
  const updateLotFilters = compactInventoryFilters(form,
    ['producto', 'proveedor', 'codigoLote', 'estadoOperativo', 'estadoCalculado', 'venceDesde', 'venceHasta', 'limite', 'soloConSaldo'],
    { limite: '25' });
  form.addEventListener('submit', (event) => { event.preventDefault(); loadLotsPanel(1); });
  document.getElementById('clearLotFilters').addEventListener('click', () => { form.reset(); updateLotFilters(); loadLotsPanel(1); });
  document.getElementById('exportLots')?.addEventListener('click', downloadLotExport);
  document.querySelectorAll('[data-lot-tab]').forEach((button) => button.addEventListener('click', () => {
    lotUi.activeTab = button.dataset.lotTab;
    document.querySelectorAll('[data-lot-tab]').forEach((tab) => {
      const active = tab === button;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    if (lotUi.activeTab === 'alertas' && !form.elements.estadoCalculado.value) form.elements.estadoCalculado.value = 'proximo_a_vencer';
    loadLotsPanel(1);
  }));
  await loadLotsPanel(1);
}

function lotEntryRow(index, { requiresExpiration = false, quantity = '' } = {}) {
  return `<div class="lot-entry" data-lot-entry="${index}">
    <label>Código de lote<input name="codigoLote" maxlength="80" placeholder="Opcional"></label>
    <label>Vencimiento<input name="fechaVencimiento" type="date" min="${localDateValue(new Date())}" ${requiresExpiration ? 'required' : ''}></label>
    <label>Cantidad en unidades base<input name="cantidad" type="number" min="1" step="1" required value="${escapeHtml(quantity)}"></label>
    <label>Costo unitario base<input name="costoUnitarioBase" type="number" min="0" step="0.000001" placeholder="Opcional"></label>
    <button type="button" class="danger small" data-remove-lot aria-label="Eliminar fila de lote">Eliminar</button>
  </div>`;
}

function collectLotEntryRows(container) {
  return [...container.querySelectorAll('[data-lot-entry]')].map((row) => ({
    codigoLote: row.querySelector('[name="codigoLote"]').value.trim() || null,
    fechaVencimiento: row.querySelector('[name="fechaVencimiento"]').value || null,
    cantidad: Number(row.querySelector('[name="cantidad"]').value),
    costoUnitarioBase: row.querySelector('[name="costoUnitarioBase"]').value || null
  }));
}

function wireLotEntryEditor(container, { totalTarget, expectedTotal, requiresExpiration }) {
  let nextIndex = container.querySelectorAll('[data-lot-entry]').length;
  const update = () => {
    const total = collectLotEntryRows(container).reduce((sum, row) => sum + (Number.isFinite(row.cantidad) ? row.cantidad : 0), 0);
    if (totalTarget) {
      totalTarget.textContent = `Distribuido: ${total} · pendiente: ${expectedTotal - total}`;
      totalTarget.classList.toggle('text-danger', total !== expectedTotal);
      totalTarget.classList.toggle('text-ok', total === expectedTotal);
    }
  };
  const wireRow = (row) => {
    row.querySelectorAll('input').forEach((input) => input.addEventListener('input', update));
    row.querySelector('[data-remove-lot]').addEventListener('click', () => { row.remove(); update(); });
  };
  container.querySelectorAll('[data-lot-entry]').forEach(wireRow);
  return {
    add(quantity = '') {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = lotEntryRow(nextIndex++, { requiresExpiration, quantity });
      const row = wrapper.firstElementChild;
      container.appendChild(row);
      wireRow(row);
      update();
    },
    update
  };
}

async function openInitialLotDistribution(product) {
  const returnFocus = document.activeElement;
  if (!hasFeature('control_lotes')) return showError('El control de lotes no está incluido en el plan actual.');
  if (state.context?.soloLectura) return showError('La cuenta está en modo de solo lectura.');
  const stock = Number(product.stockUnidadesTotal || 0);
  if (stock <= 0) return openLotProductConfiguration(product);
  const operationKey = newOperationKey();
  modalRoot.innerHTML = `<div class="modal-backdrop"><form class="modal modal-wide" id="initialLotForm" role="dialog" aria-modal="true" aria-labelledby="initialLotTitle">
    <h3 id="initialLotTitle">Distribuir stock de ${escapeHtml(product.nombre)}</h3><div class="modal-body">
      <div class="inventory-note"><strong>${stock} unidades base existentes</strong><p>La distribución debe coincidir exactamente. Esta operación no modifica el stock general.</p></div>
      <div class="form-grid"><label class="check"><input name="controlaVencimiento" type="checkbox"> Controlar vencimientos</label><label>Días de alerta<input name="diasAlertaVencimiento" type="number" min="1" max="365" value="${escapeHtml(product.diasAlertaVencimiento || state.lotAccess?.diasAlertaVencimientoDefault || 30)}"></label></div>
      <div id="initialLotRows" class="lot-entry-list">${lotEntryRow(0, { quantity: stock })}</div>
      <div class="lot-editor-footer"><strong id="initialLotTotal"></strong><button type="button" class="secondary" id="addInitialLot">Agregar lote</button></div>
      <div class="inventory-note" id="initialLotConfirmation" hidden><strong>Confirme la distribución</strong><p>Se crearán los lotes indicados sin cambiar el stock general.</p></div>
      <p class="form-error" id="initialLotError" aria-live="polite"></p>
    </div><div class="modal-actions"><button type="button" class="secondary" data-modal-cancel>Cancelar</button><button type="submit" data-lot-write>Confirmar distribución</button></div>
  </form></div>`;
  const form = document.getElementById('initialLotForm');
  const container = document.getElementById('initialLotRows');
  let editor = wireLotEntryEditor(container, { totalTarget: document.getElementById('initialLotTotal'), expectedTotal: stock, requiresExpiration: false });
  editor.update();
  const close = () => { modalRoot.innerHTML = ''; returnFocus?.focus?.(); };
  modalRoot.querySelector('[data-modal-cancel]').addEventListener('click', close);
  document.getElementById('addInitialLot').addEventListener('click', () => editor.add());
  form.elements.controlaVencimiento.addEventListener('change', () => {
    container.querySelectorAll('[name="fechaVencimiento"]').forEach((input) => { input.required = form.elements.controlaVencimiento.checked; });
  });
  form.addEventListener('input', () => {
    delete form.dataset.confirmed;
    document.getElementById('initialLotConfirmation').hidden = true;
    form.querySelector('button[type="submit"]').textContent = 'Confirmar distribución';
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorTarget = document.getElementById('initialLotError');
    try {
      const lots = collectLotEntryRows(container);
      if (!lots.length || lots.some((row) => !Number.isInteger(row.cantidad) || row.cantidad <= 0)) throw new Error('Cada lote debe tener una cantidad entera mayor a cero.');
      if (lots.reduce((sum, row) => sum + row.cantidad, 0) !== stock) throw new Error(`La distribución debe sumar exactamente ${stock} unidades.`);
      if (form.elements.controlaVencimiento.checked && lots.some((row) => !row.fechaVencimiento)) throw new Error('Todos los lotes requieren fecha de vencimiento.');
      if (form.dataset.confirmed !== 'true') {
        form.dataset.confirmed = 'true';
        document.getElementById('initialLotConfirmation').hidden = false;
        form.querySelector('button[type="submit"]').textContent = 'Registrar distribución ahora';
        return;
      }
      await api('/api/lotes/distribucion-inicial', { method: 'POST', body: JSON.stringify({
        idProducto: product.idProducto,
        controlaVencimiento: form.elements.controlaVencimiento.checked,
        diasAlertaVencimiento: Number(form.elements.diasAlertaVencimiento.value),
        lotes: lots,
        claveOperacion: operationKey
      }) });
      close();
      state.lotAccess = { ...state.lotAccess, productosControlados: Number(state.lotAccess?.productosControlados || 0) + 1 };
      await refreshCatalogs();
      renderMenu();
      await showSuccess('Distribución inicial registrada. El stock general no fue modificado.');
      await loadView('lotesVencimientos');
    } catch (error) { errorTarget.textContent = error.message; }
  });
  form.querySelector('input, select, button')?.focus();
}

async function openLotProductConfiguration(product) {
  const returnFocus = document.activeElement;
  if (!product) return showError('Producto no encontrado.');
  const canConfigure = hasFeature('control_lotes') && !state.context?.soloLectura;
  const controlled = Number(product.controlaLotes) === 1;
  if (!controlled && Number(product.stockUnidadesTotal) > 0) return openInitialLotDistribution(product);
  modalRoot.innerHTML = `<div class="modal-backdrop"><form class="modal" id="lotProductConfigForm" role="dialog" aria-modal="true" aria-labelledby="lotConfigTitle">
    <h3 id="lotConfigTitle">Lotes de ${escapeHtml(product.nombre)}</h3><div class="modal-body inventory-product-config">
      ${!canConfigure ? '<div class="inventory-plan-note"><strong>Modo consulta</strong><span>La configuración no puede modificarse con el plan o estado actual.</span></div>' : ''}
      <label class="check"><input name="controlaLotes" type="checkbox" ${controlled ? 'checked disabled' : ''}> Controlar lotes</label>
      <label class="check"><input name="controlaVencimiento" type="checkbox" ${Number(product.controlaVencimiento) ? 'checked' : ''} ${canConfigure ? '' : 'disabled'}> Controlar vencimientos</label>
      <label>Días de alerta<input name="diasAlertaVencimiento" type="number" min="1" max="365" value="${escapeHtml(product.diasAlertaVencimiento || state.lotAccess?.diasAlertaVencimientoDefault || 30)}" ${canConfigure ? '' : 'disabled'}></label>
      <p class="hint">${controlled ? `Activado: ${escapeHtml(formatDate(product.lotesActivadosEn))}. No puede desactivarse porque su historial es inmutable.` : 'El producto no tiene stock y puede activarse directamente.'}</p>
      <div class="inventory-note" data-lot-activation-confirm hidden><strong>Confirme la activación</strong><p>Desde este momento, las compras, ventas y ajustes deberán conservar trazabilidad por lotes.</p></div>
      <p class="form-error" data-lot-config-error aria-live="polite"></p>
    </div><div class="modal-actions"><button type="button" class="secondary" data-modal-cancel>${canConfigure ? 'Cancelar' : 'Cerrar'}</button>${canConfigure ? '<button type="submit" data-lot-write>Guardar configuración</button>' : ''}</div>
  </form></div>`;
  const form = document.getElementById('lotProductConfigForm');
  const close = () => { modalRoot.innerHTML = ''; returnFocus?.focus?.(); };
  modalRoot.querySelector('[data-modal-cancel]').addEventListener('click', close);
  if (!canConfigure) return;
  if (!controlled) form.elements.controlaLotes.addEventListener('change', () => {
    if (!form.elements.controlaLotes.checked) form.elements.controlaVencimiento.checked = false;
  });
  form.addEventListener('input', () => {
    delete form.dataset.confirmed;
    form.querySelector('[data-lot-activation-confirm]').hidden = true;
    form.querySelector('button[type="submit"]').textContent = 'Guardar configuración';
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorTarget = form.querySelector('[data-lot-config-error]');
    try {
      if (!controlled && !form.elements.controlaLotes.checked) throw new Error('Active el control de lotes para guardar esta configuración.');
      if (!controlled && form.dataset.confirmed !== 'true') {
        form.dataset.confirmed = 'true';
        form.querySelector('[data-lot-activation-confirm]').hidden = false;
        form.querySelector('button[type="submit"]').textContent = 'Activar control ahora';
        return;
      }
      const result = await api(`/api/productos/${product.idProducto}/configuracion-lotes`, { method: 'PATCH', body: JSON.stringify({
        controlaLotes: true,
        controlaVencimiento: form.elements.controlaVencimiento.checked,
        diasAlertaVencimiento: Number(form.elements.diasAlertaVencimiento.value)
      }) });
      close();
      await refreshCatalogs();
      state.lotAccess = { ...state.lotAccess, productosControlados: Math.max(1, Number(state.lotAccess?.productosControlados || 0)) };
      renderMenu();
      await showSuccess(result.message);
      await loadView('productos');
    } catch (error) { errorTarget.textContent = error.message; }
  });
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
  renderMenu();
  await loadView('inicio');
}

initializeApp().catch((error) => showError(error.message));
