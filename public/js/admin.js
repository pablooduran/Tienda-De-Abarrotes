const state = {
  stores: [],
  storeFilters: { estado: '', suscripcion: '' },
  selectedStore: null,
  owners: [],
  subscriptions: [],
  plans: [],
  masterCategories: [],
  masterBrands: [],
  masterProducts: [],
  masterPage: 1,
  masterPages: 1,
  catalogFilters: { category: '', brand: '', status: '' },
  catalogFilterApplying: false,
  importRows: [],
  importSelection: new Set(),
  supplierSourceReady: false,
  formAction: null,
  formFields: [],
  auditUi: null
};

const elements = {
  currentAdmin: document.getElementById('currentAdmin'),
  storeCount: document.getElementById('storeCount'),
  activeStoreCount: document.getElementById('activeStoreCount'),
  inactiveStoreCount: document.getElementById('inactiveStoreCount'),
  ownerCount: document.getElementById('ownerCount'),
  expiringStoreCount: document.getElementById('expiringStoreCount'),
  attentionStoreCount: document.getElementById('attentionStoreCount'),
  platformOverviewSummary: document.getElementById('platformOverviewSummary'),
  platformAlertList: document.getElementById('platformAlertList'),
  storeSearch: document.getElementById('storeSearch'),
  storeFilterButton: document.getElementById('openStoreFilters'),
  storeFilterDialog: document.getElementById('storeFilterDialog'),
  storeFilterForm: document.getElementById('storeFilters'),
  storesTableBody: document.getElementById('storesTableBody'),
  emptyStores: document.getElementById('emptyStores'),
  storeDetail: document.getElementById('storeDetail'),
  storeDetailTitle: document.getElementById('storeDetailTitle'),
  storeDetailMeta: document.getElementById('storeDetailMeta'),
  detailStoreStatus: document.getElementById('detailStoreStatus'),
  detailPlan: document.getElementById('detailPlan'),
  detailSubscription: document.getElementById('detailSubscription'),
  detailExpiration: document.getElementById('detailExpiration'),
  detailProductCount: document.getElementById('detailProductCount'),
  detailClientCount: document.getElementById('detailClientCount'),
  detailLastActivity: document.getElementById('detailLastActivity'),
  detailHealthStatus: document.getElementById('detailHealthStatus'),
  detailHealthMessage: document.getElementById('detailHealthMessage'),
  detailUsage: document.getElementById('detailUsage'),
  toggleStoreButton: document.getElementById('toggleStoreButton'),
  ownersTableBody: document.getElementById('ownersTableBody'),
  emptyOwners: document.getElementById('emptyOwners'),
  subscriptionsTableBody: document.getElementById('subscriptionsTableBody'),
  emptySubscriptions: document.getElementById('emptySubscriptions'),
  formDialog: document.getElementById('formDialog'),
  formDialogEyebrow: document.getElementById('formDialogEyebrow'),
  formDialogIntro: document.getElementById('formDialogIntro'),
  formDialogLogo: document.getElementById('formDialogLogo'),
  dynamicForm: document.getElementById('dynamicForm'),
  formDialogTitle: document.getElementById('formDialogTitle'),
  formFields: document.getElementById('formFields'),
  formError: document.getElementById('formError'),
  formSubmitButton: document.getElementById('formSubmitButton'),
  confirmDialog: document.getElementById('confirmDialog'),
  confirmTitle: document.getElementById('confirmTitle'),
  confirmMessage: document.getElementById('confirmMessage'),
  confirmAccept: document.getElementById('confirmAccept'),
  confirmCancel: document.getElementById('confirmCancel'),
  toast: document.getElementById('toast'),
  adminShell: document.querySelector('.admin-shell'),
  adminSidebarToggle: document.getElementById('adminSidebarToggle'),
  adminSidebarScrim: document.getElementById('adminSidebarScrim')
};

Object.assign(elements, {
  masterProductCount: document.getElementById('masterProductCount'),
  activeMasterProductCount: document.getElementById('activeMasterProductCount'),
  masterCategoryCount: document.getElementById('masterCategoryCount'),
  masterBrandCount: document.getElementById('masterBrandCount'),
  masterProductSearch: document.getElementById('masterProductSearch'),
  masterFilterButton: document.getElementById('openMasterCatalogFilters'),
  masterFilterDialog: document.getElementById('masterCatalogFilterDialog'),
  masterFilterForm: document.getElementById('masterCatalogFilters'),
  masterFilterError: document.getElementById('masterCatalogFilterError'),
  masterCategoryFilter: document.getElementById('masterCategoryFilter'),
  masterBrandFilter: document.getElementById('masterBrandFilter'),
  masterStatusFilter: document.getElementById('masterStatusFilter'),
  masterProductsTableBody: document.getElementById('masterProductsTableBody'),
  emptyMasterProducts: document.getElementById('emptyMasterProducts'),
  masterPageLabel: document.getElementById('masterPageLabel'),
  masterPreviousPage: document.getElementById('masterPreviousPage'),
  masterNextPage: document.getElementById('masterNextPage'),
  masterCategoriesList: document.getElementById('masterCategoriesList'),
  masterBrandsList: document.getElementById('masterBrandsList'),
  catalogImportDialog: document.getElementById('catalogImportDialog'),
  catalogImportFile: document.getElementById('catalogImportFile'),
  catalogImportSummary: document.getElementById('catalogImportSummary'),
  catalogImportPreview: document.getElementById('catalogImportPreview'),
  catalogImportError: document.getElementById('catalogImportError'),
  confirmCatalogImport: document.getElementById('confirmCatalogImport'),
  supplierSourceImportDialog: document.getElementById('supplierSourceImportDialog'),
  supplierSourceImportFile: document.getElementById('supplierSourceImportFile'),
  supplierSourceImportSummary: document.getElementById('supplierSourceImportSummary'),
  supplierSourceImportError: document.getElementById('supplierSourceImportError'),
  confirmSupplierSourceImport: document.getElementById('confirmSupplierSourceImport')
});

function isActive(value) {
  return Number(value) === 1;
}

function isCommercialPlan(plan) {
  return isActive(plan?.activo)
    && ['basico', 'standard', 'pro'].includes(String(plan.codigo || '').toLowerCase());
}

function setAdminSidebarExpanded(expanded, { restoreFocus = false } = {}) {
  const mobile = window.matchMedia('(max-width: 760px)').matches;
  const visible = mobile && Boolean(expanded);
  elements.adminShell.classList.toggle('sidebar-expanded', visible);
  elements.adminSidebarToggle.setAttribute('aria-expanded', String(visible));
  elements.adminSidebarToggle.setAttribute('aria-label', visible
    ? 'Cerrar navegación administrativa' : 'Abrir navegación administrativa');
  elements.adminSidebarToggle.title = visible ? 'Cerrar navegación' : 'Abrir navegación';
  elements.adminSidebarToggle.firstElementChild.textContent = visible ? '×' : '☰';
  elements.adminSidebarScrim.hidden = !visible;
  if (restoreFocus) elements.adminSidebarToggle.focus();
}

function formatDate(value) {
  if (!value) return 'Sin actividad registrada';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('es-BO', {
    dateStyle: 'short',
    timeStyle: 'short',
    hour12: false
  }).format(date);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[character]));
}

function statusLabel(status) {
  return {
    activa: 'Activa',
    suspendida: 'Suspendida',
    inactiva: 'Inactiva'
  }[status] || status;
}

function statusBadge(status) {
  const badge = document.createElement('span');
  badge.className = `status-badge status-${status === 'activa' ? 'active' : status === 'suspendida' ? 'suspended' : 'inactive'}`;
  badge.textContent = statusLabel(status);
  return badge;
}

function subscriptionBadge(status) {
  const badge = document.createElement('span');
  const positive = status === 'activa';
  const warning = status === 'pendiente';
  badge.className = `status-badge ${positive ? 'status-active' : warning ? 'status-suspended' : 'status-inactive'}`;
  badge.textContent = {
    activa: 'Activa', pendiente: 'Pendiente', vencida: 'Vencida', suspendida: 'Suspendida',
    cancelada: 'Cancelada', sin_suscripcion: 'Sin suscripción'
  }[status] || status;
  return badge;
}

function showToast(message, type = 'success') {
  elements.toast.textContent = message;
  elements.toast.className = `toast${type === 'error' ? ' error' : ''}`;
  elements.toast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 3800);
}

async function api(path, options = {}) {
  const request = { ...options, headers: { ...(options.headers || {}) } };
  if (request.body && typeof request.body !== 'string' && !(request.body instanceof FormData)) {
    request.headers['Content-Type'] = 'application/json';
    request.body = JSON.stringify(request.body);
  }
  const response = await SecurityHttp.secureFetch(path, request);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (response.status === 401) {
    window.location.href = '/login.html';
    throw new Error('La sesión finalizó.');
  }
  if (!response.ok) {
    const error = SecurityHttp.errorFromResponse(response, body, 'No se pudo completar la operación.');
    error.body = body;
    throw error;
  }
  return body;
}

function updateSummary() {
  elements.storeCount.textContent = state.stores.length;
  elements.activeStoreCount.textContent = state.stores.filter((store) => isActive(store.activo)).length;
  elements.inactiveStoreCount.textContent = state.stores.filter((store) => !isActive(store.activo)).length;
  elements.ownerCount.textContent = state.stores.reduce(
    (total, store) => total + Number(store.cantidadPropietarios || 0),
    0
  );
  const alerts = platformAlerts();
  elements.expiringStoreCount.textContent = String(alerts.filter((alert) => alert.kind === 'expiry').length);
  elements.attentionStoreCount.textContent = String(alerts.filter((alert) => alert.priority === 'high').length);
  renderPlatformAlerts(alerts);
}

function localDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  const date = new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(text) ? text : `${text.replace(' ', 'T')}-04:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysToExpiry(value) {
  const date = localDate(value);
  if (!date) return null;
  return Math.ceil((date.getTime() - Date.now()) / 86400000);
}

function planFor(store) {
  return state.plans.find((plan) => plan.codigo === store.planCodigo) || null;
}

function storeLimitAlerts(store) {
  const plan = planFor(store);
  if (!plan) return [];
  return [
    ['productos', 'Productos', 'cantidadProductos', 'limiteProductos'],
    ['clientes', 'Clientes', 'cantidadClientes', 'limiteClientes'],
    ['propietarios', 'Propietarios', 'cantidadPropietarios', 'limitePropietarios']
  ].flatMap(([key, label, usageKey, limitKey]) => {
    const limit = plan[limitKey];
    const used = Number(store[usageKey] || 0);
    if (limit === null || limit === undefined || Number(limit) <= 0 || used < Number(limit)) return [];
    return [{ store, kind: 'limit', priority: used > Number(limit) ? 'high' : 'medium', title: `${label}: límite alcanzado`, description: `${store.nombre} usa ${used} de ${limit} incluidos en ${plan.nombre}.`, key }];
  });
}

function platformAlerts() {
  return state.stores.flatMap((store) => {
    const subscription = store.estadoSuscripcionEfectivo || 'sin_suscripcion';
    const alerts = [];
    if (!isActive(store.activo) || store.estado !== 'activa') {
      alerts.push({ store, kind: 'store', priority: 'high', title: 'Tienda sin acceso activo', description: `${store.nombre} está ${statusLabel(store.estado).toLowerCase()}.` });
    }
    if (['sin_suscripcion', 'vencida', 'suspendida', 'cancelada'].includes(subscription)) {
      alerts.push({ store, kind: 'subscription', priority: 'high', title: 'Suscripción requiere revisión', description: `${store.nombre}: ${subscriptionBadgeText(subscription)}.` });
    }
    const remaining = daysToExpiry(store.fechaFinSuscripcion);
    if (subscription === 'activa' && remaining !== null && remaining >= 0 && remaining <= 7) {
      alerts.push({ store, kind: 'expiry', priority: remaining <= 1 ? 'high' : 'medium', title: `Vence ${remaining === 0 ? 'hoy' : `en ${remaining} día${remaining === 1 ? '' : 's'}`}`, description: `${store.nombre} · ${store.planNombre || 'Sin plan'}.` });
    }
    return [...alerts, ...storeLimitAlerts(store)];
  }).sort((left, right) => Number(right.priority === 'high') - Number(left.priority === 'high'));
}

function subscriptionBadgeText(status) {
  return { sin_suscripcion: 'sin suscripción', vencida: 'suscripción vencida', suspendida: 'suscripción suspendida', cancelada: 'suscripción cancelada' }[status] || status;
}

function renderPlatformAlerts(alerts) {
  elements.platformAlertList.replaceChildren();
  const visible = alerts.slice(0, 6);
  elements.platformOverviewSummary.textContent = visible.length
    ? `${alerts.length} aviso${alerts.length === 1 ? '' : 's'} detectado${alerts.length === 1 ? '' : 's'}. Atiende primero los marcados como prioritarios.`
    : 'Todo en orden: no hay vencimientos, límites alcanzados ni accesos que requieran revisión.';
  if (!visible.length) {
    const good = document.createElement('div');
    good.className = 'platform-alert platform-alert-good';
    good.innerHTML = '<span aria-hidden="true">✓</span><div><strong>La plataforma está al día</strong><p>No hay acciones administrativas urgentes.</p></div>';
    elements.platformAlertList.appendChild(good);
    return;
  }
  visible.forEach((alert) => {
    const item = document.createElement('article');
    item.className = `platform-alert platform-alert-${alert.priority}`;
    const text = document.createElement('div');
    const title = document.createElement('strong');
    const description = document.createElement('p');
    title.textContent = alert.title;
    description.textContent = alert.description;
    text.append(title, description);
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'button button-secondary';
    action.textContent = 'Revisar tienda';
    action.addEventListener('click', () => selectStore(alert.store.idTienda));
    item.append(text, action);
    elements.platformAlertList.appendChild(item);
  });
}

function renderStoreHealth(store) {
  const plan = planFor(store);
  const subscription = store.estadoSuscripcionEfectivo || 'sin_suscripcion';
  const remaining = daysToExpiry(store.fechaFinSuscripcion);
  const hasAccessIssue = !isActive(store.activo) || store.estado !== 'activa' || subscription !== 'activa';
  const nearExpiry = subscription === 'activa' && remaining !== null && remaining <= 7;
  elements.detailHealthStatus.className = `status-badge ${hasAccessIssue ? 'status-inactive' : nearExpiry ? 'status-suspended' : 'status-active'}`;
  elements.detailHealthStatus.textContent = hasAccessIssue ? 'Requiere revisión' : nearExpiry ? 'Vence pronto' : 'Operación saludable';
  elements.detailHealthMessage.textContent = hasAccessIssue
    ? 'Revisa el estado administrativo y la suscripción antes de continuar con cambios operativos.'
    : nearExpiry ? `La suscripción vence ${remaining === 0 ? 'hoy' : `en ${remaining} día${remaining === 1 ? '' : 's'}`}.`
    : 'La tienda tiene acceso activo. Revisa el uso de límites antes de cambiar de plan.';
  elements.detailUsage.replaceChildren();
  [
    ['Propietarios', 'cantidadPropietarios', 'limitePropietarios'],
    ['Productos', 'cantidadProductos', 'limiteProductos'],
    ['Clientes', 'cantidadClientes', 'limiteClientes']
  ].forEach(([label, usageKey, limitKey]) => {
    const used = Number(store[usageKey] || 0);
    const rawLimit = plan?.[limitKey];
    const unlimited = rawLimit === null || rawLimit === undefined;
    const limit = unlimited ? null : Number(rawLimit);
    const percent = unlimited ? 0 : Math.min(100, Math.round((used / Math.max(limit, 1)) * 100));
    const row = document.createElement('div');
    row.className = `store-usage${!unlimited && used >= limit ? ' is-full' : ''}`;
    row.innerHTML = `<div><span>${label}</span><strong>${unlimited ? `${used} · Ilimitado` : `${used} de ${limit}`}</strong></div><i><b style="width:${percent}%"></b></i>`;
    elements.detailUsage.appendChild(row);
  });
}

function tableCell(content, className = '') {
  const cell = document.createElement('td');
  if (className) cell.className = className;
  if (content instanceof Node) cell.appendChild(content);
  else cell.textContent = content;
  return cell;
}

function renderStores() {
  const search = elements.storeSearch.value.trim().toLocaleLowerCase('es');
  const stores = state.stores.filter((store) => (
    (store.nombre.toLocaleLowerCase('es').includes(search)
      || store.slug.toLocaleLowerCase('es').includes(search))
    && (!state.storeFilters.estado || store.estado === state.storeFilters.estado)
    && (!state.storeFilters.suscripcion
      || (store.estadoSuscripcionEfectivo || 'sin_suscripcion') === state.storeFilters.suscripcion)
  ));
  elements.storesTableBody.replaceChildren();
  elements.emptyStores.hidden = stores.length > 0;

  stores.forEach((store) => {
    const row = document.createElement('tr');
    const name = document.createElement('div');
    name.className = 'store-name';
    const strong = document.createElement('strong');
    strong.textContent = store.nombre;
    const slug = document.createElement('span');
    slug.textContent = store.slug;
    name.append(strong, slug);

    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'table-action';
    action.textContent = 'Ver detalle';
    action.addEventListener('click', () => selectStore(store.idTienda));

    row.append(
      tableCell(name, 'store-name-cell'),
      tableCell(statusBadge(store.estado)),
      tableCell(store.planNombre || 'Sin plan'),
      tableCell(subscriptionBadge(store.estadoSuscripcionEfectivo || 'sin_suscripcion')),
      tableCell(String(store.cantidadPropietarios || 0)),
      tableCell(String(store.cantidadProductos || 0)),
      tableCell(String(store.cantidadClientes || 0)),
      tableCell(formatDate(store.ultimaActividad)),
      tableCell(action)
    );
    elements.storesTableBody.appendChild(row);
  });
}

function renderSubscriptions() {
  elements.subscriptionsTableBody.replaceChildren();
  elements.emptySubscriptions.hidden = state.subscriptions.length > 0;
  state.subscriptions.forEach((subscription) => {
    const actions = document.createElement('div');
    actions.className = 'button-row';
    const secondary = [];
    if (['activa', 'pendiente'].includes(subscription.estado)) {
      secondary.push(ownerAction('Suspender', 'button-secondary', () => changeSubscriptionStatus(subscription, 'suspender')));
    }
    if (subscription.estado !== 'cancelada') {
      secondary.push(ownerAction('Cancelar', 'button-danger', () => changeSubscriptionStatus(subscription, 'cancelar')));
    }
    if (secondary.length) actions.append(adminMoreActions(secondary));
    const row = document.createElement('tr');
    row.append(
      tableCell(subscription.planNombre),
      tableCell(subscription.tipo),
      tableCell(subscriptionBadge(subscription.estadoEfectivo)),
      tableCell(formatDate(subscription.fechaInicio)),
      tableCell(formatDate(subscription.fechaFin)),
      tableCell(subscription.observacion || ''),
      tableCell(actions)
    );
    elements.subscriptionsTableBody.appendChild(row);
  });
}

function ownerAction(label, className, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `button ${className}`;
  button.textContent = label;
  button.addEventListener('click', action);
  return button;
}

function adminMoreActions(buttons) {
  const details = document.createElement('details');
  details.className = 'admin-more-actions';
  const summary = document.createElement('summary');
  summary.textContent = 'Mas opciones';
  const list = document.createElement('div');
  list.className = 'button-row';
  list.append(...buttons);
  details.append(summary, list);
  return details;
}

function renderOwners() {
  elements.ownersTableBody.replaceChildren();
  elements.emptyOwners.hidden = state.owners.length > 0;
  state.owners.forEach((owner) => {
    const row = document.createElement('tr');
    const access = document.createElement('span');
    access.className = `status-badge ${isActive(owner.activo) ? 'status-active' : 'status-inactive'}`;
    access.textContent = isActive(owner.activo) ? 'Activo' : 'Inactivo';
    const actions = document.createElement('div');
    actions.className = 'button-row';
    actions.append(ownerAction('Editar usuario', 'button-secondary', () => editOwner(owner)));
    actions.append(adminMoreActions([
      ownerAction('Nueva contraseña', 'button-secondary', () => resetOwnerPassword(owner)),
      ownerAction(
        isActive(owner.activo) ? 'Desactivar' : 'Activar',
        isActive(owner.activo) ? 'button-danger' : 'button-primary',
        () => toggleOwner(owner)
      )
    ]));
    row.append(tableCell(owner.usuario), tableCell(access), tableCell(actions));
    elements.ownersTableBody.appendChild(row);
  });
}

async function loadStores(selectedId = state.selectedStore?.idTienda) {
  state.stores = await api('/api/admin/tiendas');
  updateSummary();
  renderStores();
  if (selectedId && state.stores.some((store) => Number(store.idTienda) === Number(selectedId))) {
    await selectStore(selectedId, false);
  } else {
    state.selectedStore = null;
    state.owners = [];
    state.subscriptions = [];
    if (elements.storeDetail.open) elements.storeDetail.close();
    elements.storeDetail.hidden = true;
  }
}

let storeDetailReturnFocus = null;
elements.storeDetail.addEventListener('close', () => {
  elements.storeDetail.hidden = true;
  document.body.classList.remove('admin-detail-open');
  const target = storeDetailReturnFocus?.isConnected && storeDetailReturnFocus.getClientRects().length
    ? storeDetailReturnFocus : document.querySelector('.admin-sidebar .nav-link.active');
  target?.focus();
  storeDetailReturnFocus = null;
});
document.getElementById('closeStoreDetail').addEventListener('click', () => elements.storeDetail.close());

async function selectStore(idTienda, openDetail = true) {
  const returnFocus = document.activeElement;
  const [store, owners, subscriptions] = await Promise.all([
    api(`/api/admin/tiendas/${idTienda}`),
    api(`/api/admin/tiendas/${idTienda}/propietarios`),
    api(`/api/admin/tiendas/${idTienda}/suscripciones`)
  ]);
  state.selectedStore = store;
  state.owners = owners;
  state.subscriptions = subscriptions;
  elements.storeDetailTitle.textContent = store.nombre;
  elements.storeDetailMeta.textContent = `${store.slug} · Creada ${formatDate(store.creadoEn)}`;
  elements.detailStoreStatus.replaceChildren(statusBadge(store.estado));
  elements.detailPlan.textContent = store.planNombre || 'Sin plan';
  elements.detailSubscription.replaceChildren(subscriptionBadge(store.estadoSuscripcionEfectivo || 'sin_suscripcion'));
  elements.detailExpiration.textContent = store.fechaFinSuscripcion ? formatDate(store.fechaFinSuscripcion) : 'Sin fecha';
  document.getElementById('manageSubscriptionButton').textContent = store.estadoSuscripcionEfectivo === 'activa'
    ? 'Renovar o cambiar plan'
    : 'Reactivar suscripción';
  elements.detailProductCount.textContent = String(store.cantidadProductos || 0);
  elements.detailClientCount.textContent = String(store.cantidadClientes || 0);
  elements.detailLastActivity.textContent = formatDate(store.ultimaActividad);
  renderStoreHealth(store);
  elements.toggleStoreButton.textContent = isActive(store.activo) ? 'Suspender tienda' : 'Activar tienda';
  elements.toggleStoreButton.className = `button ${isActive(store.activo) ? 'button-danger' : 'button-primary'}`;
  renderOwners();
  renderSubscriptions();
  if (openDetail && !elements.storeDetail.open) {
    storeDetailReturnFocus = returnFocus;
    elements.storeDetail.hidden = false;
    elements.storeDetail.showModal();
    document.body.classList.add('admin-detail-open');
    document.getElementById('closeStoreDetail').focus();
  }
}

function createField(definition) {
  const label = document.createElement('label');
  label.className = `form-field${definition.full ? ' full' : ''}${definition.type === 'checkbox' ? ' checkbox-field' : ''}`;
  const input = definition.type === 'select'
    ? document.createElement('select')
    : definition.type === 'textarea' ? document.createElement('textarea') : document.createElement('input');
  input.name = definition.name;
  input.required = Boolean(definition.required);

  if (definition.type === 'select') {
    definition.options.forEach((optionDefinition) => {
      const option = document.createElement('option');
      option.value = optionDefinition.value;
      option.textContent = optionDefinition.label;
      option.selected = optionDefinition.value === definition.value;
      option.disabled = Boolean(optionDefinition.disabled);
      input.appendChild(option);
    });
  } else if (definition.type !== 'textarea') {
    input.type = definition.type || 'text';
    input.value = definition.type === 'checkbox' ? '' : definition.value || '';
    if (definition.type === 'checkbox') input.checked = Boolean(definition.value);
    if (definition.autocomplete) input.autocomplete = definition.autocomplete;
    if (definition.placeholder) input.placeholder = definition.placeholder;
    if (definition.minLength) input.minLength = definition.minLength;
    if (definition.min !== undefined) input.min = definition.min;
    if (definition.max !== undefined) input.max = definition.max;
    if (definition.step !== undefined) input.step = definition.step;
  } else {
    input.value = definition.value || '';
    if (definition.placeholder) input.placeholder = definition.placeholder;
  }

  const labelText = document.createElement('span');
  labelText.textContent = definition.label;
  if (definition.type === 'checkbox') label.append(input, labelText);
  else {
    label.append(labelText, input);
    if (definition.hint) {
      const hint = document.createElement('small');
      hint.className = 'field-help';
      hint.textContent = definition.hint;
      label.append(hint);
    }
  }
  return label;
}

function formNodes(fields) {
  let section = null;
  return fields.flatMap((field) => {
    const nodes = [];
    if (field.section && field.section !== section) {
      section = field.section;
      const heading = document.createElement('div');
      heading.className = 'form-section-heading';
      heading.innerHTML = `<span>${escapeHtml(field.section)}</span>${field.sectionHint ? `<small>${escapeHtml(field.sectionHint)}</small>` : ''}`;
      nodes.push(heading);
    }
    nodes.push(createField(field));
    return nodes;
  });
}

function openForm({ title, submitLabel = 'Guardar', fields, action, eyebrow = 'Administración', intro = '', formClass = '' }) {
  state.formFields = fields;
  state.formAction = action;
  elements.formDialogTitle.textContent = title;
  elements.formDialogEyebrow.textContent = eyebrow;
  elements.formDialogIntro.textContent = intro;
  elements.formDialogIntro.hidden = !intro;
  elements.formDialogLogo.hidden = !formClass;
  elements.formDialog.className = `modal ${formClass}`.trim();
  elements.formSubmitButton.textContent = submitLabel;
  elements.formError.hidden = true;
  elements.formFields.replaceChildren(...formNodes(fields));
  elements.formDialog.showModal();
}

function formValues() {
  return Object.fromEntries(state.formFields.map((field) => {
    const input = elements.dynamicForm.elements[field.name];
    return [field.name, field.type === 'checkbox' ? input.checked : input.value.trim()];
  }));
}

function openConfirmation(title, message, acceptLabel = 'Confirmar') {
  elements.confirmTitle.textContent = title;
  elements.confirmMessage.textContent = message;
  elements.confirmAccept.textContent = acceptLabel;
  elements.confirmDialog.showModal();
  return new Promise((resolve) => {
    const finish = (value) => {
      elements.confirmDialog.removeEventListener('cancel', cancel);
      elements.confirmDialog.close();
      elements.confirmAccept.onclick = null;
      elements.confirmCancel.onclick = null;
      resolve(value);
    };
    const cancel = (event) => {
      event.preventDefault();
      finish(false);
    };
    elements.confirmDialog.addEventListener('cancel', cancel);
    elements.confirmAccept.onclick = () => finish(true);
    elements.confirmCancel.onclick = () => finish(false);
  });
}

function createStore() {
  const planOptions = state.plans.filter((plan) => isCommercialPlan(plan)).map((plan) => ({
    value: plan.codigo, label: plan.nombre
  }));
  openForm({
    title: 'Crear tienda y propietario',
    submitLabel: 'Crear tienda',
    fields: [
      { name: 'nombre', label: 'Nombre de la tienda', required: true, full: true },
      { name: 'slug', label: 'Slug (opcional)', placeholder: 'Se genera desde el nombre', full: true },
      {
        name: 'estado', label: 'Estado inicial', type: 'select', value: 'activa',
        options: [
          { value: 'activa', label: 'Activa' },
          { value: 'suspendida', label: 'Suspendida' },
          { value: 'inactiva', label: 'Inactiva' }
        ]
      },
      { name: 'propietarioActivo', label: 'Propietario activo', type: 'checkbox', value: true },
      { name: 'planCodigo', label: 'Plan', type: 'select', value: 'basico', options: planOptions, required: true },
      {
        name: 'tipoSuscripcion', label: 'Tipo de suscripción', type: 'select', value: 'prueba',
        options: [
          { value: 'prueba', label: 'Prueba gratuita' },
          { value: 'pagada', label: 'Pagada manualmente' },
          { value: 'cortesia', label: 'Cortesía' }
        ]
      },
      { name: 'duracionDias', label: 'Duración en días', type: 'number', value: '14', min: 1, max: 3650, required: true },
      { name: 'usuario', label: 'Usuario del propietario', required: true, autocomplete: 'off', full: true },
      { name: 'password', label: 'Contraseña', type: 'password', required: true, minLength: 12, autocomplete: 'new-password' },
      { name: 'confirmacionPassword', label: 'Confirmar contraseña', type: 'password', required: true, minLength: 12, autocomplete: 'new-password' }
    ],
    action: async (values) => {
      const result = await api('/api/admin/tiendas', {
        method: 'POST',
        body: {
          nombre: values.nombre,
          slug: values.slug,
          estado: values.estado,
          activo: values.estado === 'activa',
          propietario: {
            usuario: values.usuario,
            password: values.password,
            confirmacionPassword: values.confirmacionPassword,
            activo: values.propietarioActivo
          },
          suscripcion: {
            planCodigo: values.planCodigo,
            tipo: values.tipoSuscripcion,
            duracionDias: Number(values.duracionDias),
            observacion: 'Alta inicial de tienda.'
          }
        }
      });
      showToast(result.message);
      await loadStores(result.tienda.idTienda);
    }
  });
}

function manageSubscription() {
  const store = state.selectedStore;
  if (!store) return;
  const planOptions = state.plans.filter((plan) => isCommercialPlan(plan)).map((plan) => ({
    value: plan.codigo, label: plan.nombre
  }));
  openForm({
    title: `Nueva suscripción para ${store.nombre}`,
    submitLabel: 'Registrar suscripción',
    fields: [
      { name: 'planCodigo', label: 'Plan', type: 'select', value: store.planCodigo || 'basico', options: planOptions, required: true },
      {
        name: 'tipo', label: 'Tipo', type: 'select', value: 'pagada',
        options: [
          { value: 'pagada', label: 'Pagada manualmente' },
          { value: 'prueba', label: 'Prueba gratuita' },
          { value: 'cortesia', label: 'Cortesía' }
        ]
      },
      { name: 'duracionDias', label: 'Duración en días', type: 'number', value: '30', min: 1, max: 3650, required: true },
      { name: 'fechaInicio', label: 'Inicio personalizado (opcional)', type: 'datetime-local' },
      { name: 'fechaFin', label: 'Vencimiento personalizado (opcional)', type: 'datetime-local' },
      { name: 'observacion', label: 'Observación administrativa', full: true }
    ],
    action: async (values) => {
      const result = await api(`/api/admin/tiendas/${store.idTienda}/suscripciones`, {
        method: 'POST',
        body: { ...values, duracionDias: Number(values.duracionDias) }
      });
      showToast(result.message);
      await loadStores(store.idTienda);
    }
  });
}

async function changeSubscriptionStatus(subscription, action) {
  const confirmed = await openConfirmation(
    action === 'suspender' ? 'Suspender suscripción' : 'Cancelar suscripción',
    'La tienda conservará sus datos y podrá consultarlos en modo de solo lectura.',
    action === 'suspender' ? 'Suspender' : 'Cancelar'
  );
  if (!confirmed) return;
  const result = await api(`/api/admin/suscripciones/${subscription.idSuscripcion}/${action}`, { method: 'PATCH' });
  showToast(result.message);
  await loadStores(state.selectedStore.idTienda);
}

function editStore() {
  const store = state.selectedStore;
  if (!store) return;
  openForm({
    title: 'Editar tienda',
    submitLabel: 'Guardar cambios',
    fields: [
      { name: 'nombre', label: 'Nombre de la tienda', required: true, value: store.nombre, full: true },
      { name: 'slug', label: 'Slug', required: true, value: store.slug, full: true },
      {
        name: 'estado', label: 'Estado', type: 'select', value: store.estado, full: true,
        options: [
          { value: 'activa', label: 'Activa' },
          { value: 'suspendida', label: 'Suspendida' },
          { value: 'inactiva', label: 'Inactiva' }
        ]
      }
    ],
    action: async (values) => {
      const result = await api(`/api/admin/tiendas/${store.idTienda}`, {
        method: 'PUT',
        body: { ...values, activo: values.estado === 'activa' }
      });
      showToast(result.message);
      await loadStores(store.idTienda);
    }
  });
}

function addOwner() {
  const store = state.selectedStore;
  if (!store) return;
  openForm({
    title: `Agregar propietario a ${store.nombre}`,
    submitLabel: 'Agregar propietario',
    fields: [
      { name: 'usuario', label: 'Usuario', required: true, autocomplete: 'off', full: true },
      { name: 'password', label: 'Contraseña', type: 'password', required: true, minLength: 12, autocomplete: 'new-password' },
      { name: 'confirmacionPassword', label: 'Confirmar contraseña', type: 'password', required: true, minLength: 12, autocomplete: 'new-password' },
      { name: 'activo', label: 'Propietario activo', type: 'checkbox', value: true, full: true }
    ],
    action: async (values) => {
      const result = await api(`/api/admin/tiendas/${store.idTienda}/propietarios`, {
        method: 'POST', body: values
      });
      showToast(result.message);
      await loadStores(store.idTienda);
    }
  });
}

function editOwner(owner) {
  openForm({
    title: 'Editar usuario del propietario',
    submitLabel: 'Guardar usuario',
    fields: [{ name: 'usuario', label: 'Usuario', value: owner.usuario, required: true, full: true }],
    action: async (values) => {
      const result = await api(`/api/admin/propietarios/${owner.idAdministrador}`, {
        method: 'PUT', body: values
      });
      showToast(result.message);
      await loadStores(state.selectedStore.idTienda);
    }
  });
}

function resetOwnerPassword(owner) {
  openForm({
    title: `Restablecer contraseña de ${owner.usuario}`,
    submitLabel: 'Restablecer contraseña',
    fields: [
      { name: 'password', label: 'Nueva contraseña', type: 'password', required: true, minLength: 12, autocomplete: 'new-password' },
      { name: 'confirmacionPassword', label: 'Confirmar contraseña', type: 'password', required: true, minLength: 12, autocomplete: 'new-password' }
    ],
    action: async (values) => {
      const result = await api(`/api/admin/propietarios/${owner.idAdministrador}/restablecer-password`, {
        method: 'PATCH', body: values
      });
      showToast(result.message);
    }
  });
}

async function toggleStore() {
  const store = state.selectedStore;
  if (!store) return;
  const active = isActive(store.activo);
  const confirmed = await openConfirmation(
    active ? 'Suspender tienda' : 'Activar tienda',
    active
      ? `Los propietarios de ${store.nombre} no podrán iniciar sesión. Sus datos comerciales se conservarán.`
      : `Los propietarios activos de ${store.nombre} podrán volver a iniciar sesión.`,
    active ? 'Suspender' : 'Activar'
  );
  if (!confirmed) return;
  const result = await api(`/api/admin/tiendas/${store.idTienda}/${active ? 'desactivar' : 'activar'}`, {
    method: 'PATCH',
    body: active ? { estado: 'suspendida' } : undefined
  });
  showToast(result.message);
  await loadStores(store.idTienda);
}

async function toggleOwner(owner) {
  const active = isActive(owner.activo);
  const confirmed = await openConfirmation(
    active ? 'Desactivar propietario' : 'Activar propietario',
    active
      ? `${owner.usuario} dejará de poder iniciar sesión. La tienda y sus datos no se modificarán.`
      : `${owner.usuario} recuperará el acceso si la tienda también está activa.`,
    active ? 'Desactivar' : 'Activar'
  );
  if (!confirmed) return;
  const result = await api(`/api/admin/propietarios/${owner.idAdministrador}/${active ? 'desactivar' : 'activar'}`, {
    method: 'PATCH'
  });
  showToast(result.message);
  await loadStores(state.selectedStore.idTienda);
}

function optionList(rows, idField, includeEmpty = true) {
  const list = rows.map((row) => ({
    value: String(row[idField]),
    label: `${row.nombre}${isActive(row.activo) ? '' : ' (inactiva)'}`,
    disabled: !isActive(row.activo)
  }));
  return includeEmpty ? [{ value: '', label: 'Sin asignar' }, ...list] : list;
}

function masterPresentation(product) {
  const content = product.contenidoCantidad
    ? `${Number(product.contenidoCantidad)} ${product.contenidoUnidad || ''}`.trim()
    : '';
  return [product.presentacion, content].filter(Boolean).join(' · ') || 'Sin presentación';
}

function renderMasterProducts() {
  elements.masterProductsTableBody.replaceChildren();
  elements.emptyMasterProducts.hidden = state.masterProducts.length > 0;
  state.masterProducts.forEach((product) => {
    const name = document.createElement('div');
    name.className = 'store-name';
    const strong = document.createElement('strong');
    strong.textContent = product.nombre;
    const description = document.createElement('span');
    description.textContent = product.descripcion || 'Sin descripción';
    name.append(strong, description);
    const actions = document.createElement('div');
    actions.className = 'button-row';
    actions.append(ownerAction('Editar', 'button-secondary', () => openMasterProduct(product)));
    actions.append(adminMoreActions([
      ownerAction(isActive(product.activo) ? 'Desactivar' : 'Activar',
        isActive(product.activo) ? 'button-danger' : 'button-primary', () => toggleMasterProduct(product))
    ]));
    const row = document.createElement('tr');
    row.append(
      tableCell(name),
      tableCell(product.marca || 'Sin marca'),
      tableCell(product.categoria || 'Sin categoría'),
      tableCell(masterPresentation(product)),
      tableCell(product.codigoBarras || 'Sin código'),
      tableCell(String(product.tiendasQueLoUsan || 0)),
      tableCell(statusBadge(isActive(product.activo) ? 'activa' : 'inactiva')),
      tableCell(actions)
    );
    elements.masterProductsTableBody.appendChild(row);
  });
  elements.masterPageLabel.textContent = `Página ${state.masterPage} de ${state.masterPages}`;
  elements.masterPreviousPage.disabled = state.masterPage <= 1;
  elements.masterNextPage.disabled = state.masterPage >= state.masterPages;
}

function renderTaxonomy(kind) {
  const isCategory = kind === 'categoria';
  const rows = isCategory ? state.masterCategories : state.masterBrands;
  const target = isCategory ? elements.masterCategoriesList : elements.masterBrandsList;
  target.replaceChildren();
  rows.forEach((row) => {
    const item = document.createElement('div');
    item.className = `taxonomy-item${isActive(row.activo) ? '' : ' is-inactive'}`;
    const name = document.createElement('span');
    name.textContent = row.nombre;
    const actions = document.createElement('div');
    actions.className = 'taxonomy-actions';
    actions.append(ownerAction('Editar', 'button-secondary', () => openTaxonomy(kind, row)));
    actions.append(adminMoreActions([
      ownerAction(isActive(row.activo) ? 'Desactivar' : 'Activar',
        isActive(row.activo) ? 'button-danger' : 'button-primary', () => toggleTaxonomy(kind, row))
    ]));
    item.append(name, actions);
    target.appendChild(item);
  });
}

function fillTaxonomyFilters() {
  const currentCategory = elements.masterCategoryFilter.value;
  const currentBrand = elements.masterBrandFilter.value;
  elements.masterCategoryFilter.replaceChildren(new Option('Todas', ''),
    ...state.masterCategories.map((row) => new Option(row.nombre, row.idCategoriaMaestra)));
  elements.masterBrandFilter.replaceChildren(new Option('Todas', ''),
    ...state.masterBrands.map((row) => new Option(row.nombre, row.idMarcaMaestra)));
  elements.masterCategoryFilter.value = currentCategory;
  elements.masterBrandFilter.value = currentBrand;
}

async function loadMasterCatalog(page = state.masterPage) {
  const query = new URLSearchParams({ page: String(page), limit: '25' });
  const filters = [
    ['q', elements.masterProductSearch.value.trim()],
    ['idCategoriaMaestra', state.catalogFilters.category],
    ['idMarcaMaestra', state.catalogFilters.brand],
    ['activo', state.catalogFilters.status]
  ];
  filters.forEach(([key, value]) => { if (value) query.set(key, value); });
  const [summary, categories, brands, products] = await Promise.all([
    api('/api/admin/catalogo/resumen'),
    api('/api/admin/catalogo/categorias'),
    api('/api/admin/catalogo/marcas'),
    api(`/api/admin/catalogo/productos?${query}`)
  ]);
  state.masterCategories = categories;
  state.masterBrands = brands;
  state.masterProducts = products.rows;
  state.masterPage = products.page;
  state.masterPages = products.pages;
  elements.masterProductCount.textContent = summary.productos;
  elements.activeMasterProductCount.textContent = summary.productosActivos;
  elements.masterCategoryCount.textContent = summary.categorias;
  elements.masterBrandCount.textContent = summary.marcas;
  fillTaxonomyFilters();
  renderTaxonomy('categoria');
  renderTaxonomy('marca');
  renderMasterProducts();
}

function openTaxonomy(kind, row = null) {
  const plural = kind === 'categoria' ? 'categorias' : 'marcas';
  openForm({
    title: `${row ? 'Editar' : 'Nueva'} ${kind} maestra`,
    fields: [{ name: 'nombre', label: 'Nombre', value: row?.nombre || '', required: true, full: true }],
    action: async (values) => {
      const result = await api(`/api/admin/catalogo/${plural}${row ? `/${row[kind === 'categoria' ? 'idCategoriaMaestra' : 'idMarcaMaestra']}` : ''}`, {
        method: row ? 'PUT' : 'POST', body: values
      });
      showToast(result.message);
      await loadMasterCatalog();
    }
  });
}

async function toggleTaxonomy(kind, row) {
  const active = isActive(row.activo);
  if (!await openConfirmation(
    `${active ? 'Desactivar' : 'Activar'} ${kind}`,
    'Los productos maestros vinculados se conservarán sin modificar inventarios locales.',
    active ? 'Desactivar' : 'Activar'
  )) return;
  const plural = kind === 'categoria' ? 'categorias' : 'marcas';
  const id = row[kind === 'categoria' ? 'idCategoriaMaestra' : 'idMarcaMaestra'];
  const result = await api(`/api/admin/catalogo/${plural}/${id}/estado`, {
    method: 'PATCH', body: { activo: !active }
  });
  showToast(result.message);
  await loadMasterCatalog();
}

function masterProductFields(product = {}) {
  return [
    { name: 'nombre', label: 'Nombre del producto', value: product.nombre || '', required: true, full: true, section: '1. Identifica el producto', sectionHint: 'Usa un nombre claro para que todas las tiendas lo encuentren al buscar.', hint: 'Ejemplo: Galletas María paquete 120 g.' },
    { name: 'codigoBarras', label: 'Código de barras', value: product.codigoBarras || '', hint: 'Opcional. Ayuda a encontrarlo con un escáner.' },
    { name: 'idCategoriaMaestra', label: 'Categoría', type: 'select', value: String(product.idCategoriaMaestra || ''), options: optionList(state.masterCategories, 'idCategoriaMaestra'), hint: 'Ordena el catálogo global.' },
    { name: 'idMarcaMaestra', label: 'Marca', type: 'select', value: String(product.idMarcaMaestra || ''), options: optionList(state.masterBrands, 'idMarcaMaestra') },
    { name: 'proveedorSugerido', label: 'Proveedor sugerido', value: product.proveedorSugerido || '', placeholder: 'Opcional', hint: 'Cada tienda podrá elegir o cambiar su proveedor.' },
    { name: 'presentacion', label: 'Presentación', value: product.presentacion || '', placeholder: 'Botella, bolsa, paquete', section: '2. Define cómo se presenta', sectionHint: 'Estos datos guían el alta del producto en cada tienda.' },
    { name: 'contenidoCantidad', label: 'Cantidad', type: 'number', step: '0.001', min: 0.001, value: product.contenidoCantidad || '', placeholder: 'Ej. 500' },
    { name: 'contenidoUnidad', label: 'Unidad', value: product.contenidoUnidad || '', placeholder: 'g, kg, ml, l' },
    { name: 'unidadesPorPaquete', label: 'Unidades por paquete', type: 'number', min: 1, step: 1, value: product.unidadesPorPaquete || 1, required: true, hint: 'Usa 1 si se vende individualmente.' },
    { name: 'permiteVentaPorUnidad', label: 'Se puede vender por unidad', type: 'checkbox', value: product.permiteVentaPorUnidad ?? true, section: '3. Habilita las ventas', sectionHint: 'Marca solo las modalidades que estarán disponibles para las tiendas.' },
    { name: 'permiteVentaPorPaquete', label: 'Se puede vender por paquete', type: 'checkbox', value: product.permiteVentaPorPaquete ?? false },
    { name: 'activo', label: 'Disponible para las tiendas', type: 'checkbox', value: product.activo ?? true, section: '4. Información adicional' },
    { name: 'confirmarDuplicado', label: 'Crear aunque parezca duplicado', type: 'checkbox', value: false },
    { name: 'descripcion', label: 'Descripción o aclaración', type: 'textarea', value: product.descripcion || '', full: true, placeholder: 'Opcional: sabor, condición o información útil para quien lo agregue.' }
  ];
}

function openMasterProduct(product = null) {
  openForm({
    title: product ? 'Editar producto maestro' : 'Nuevo producto maestro',
    submitLabel: product ? 'Guardar cambios' : 'Crear producto',
    eyebrow: 'Catálogo de Administrau',
    intro: product ? 'Actualiza la información compartida. No modifica los precios ni el stock de las tiendas.' : 'Crea una ficha reutilizable. Los precios, el stock y los proveedores reales se completan dentro de cada tienda.',
    formClass: 'modal-product',
    fields: masterProductFields(product || {}),
    action: async (values) => {
      try {
        const result = await api(`/api/admin/catalogo/productos${product ? `/${product.idProductoMaestro}` : ''}`, {
          method: product ? 'PUT' : 'POST',
          body: { ...values, unidadesPorPaquete: Number(values.unidadesPorPaquete) }
        });
        showToast(result.message);
        await loadMasterCatalog();
      } catch (error) {
        if (error.body?.code === 'POSSIBLE_DUPLICATE') {
          const names = (error.body.duplicados || []).map((row) => row.nombre).join(', ');
          throw new Error(`${error.message} Coincidencias: ${names || 'sin detalle'}. Revisa los datos y marca la confirmación si deseas continuar.`);
        }
        throw error;
      }
    }
  });
}

async function toggleMasterProduct(product) {
  const active = isActive(product.activo);
  if (!await openConfirmation(
    `${active ? 'Desactivar' : 'Activar'} producto maestro`,
    'Los productos ya agregados por las tiendas conservarán sus datos locales.',
    active ? 'Desactivar' : 'Activar'
  )) return;
  const result = await api(`/api/admin/catalogo/productos/${product.idProductoMaestro}/estado`, {
    method: 'PATCH', body: { activo: !active }
  });
  showToast(result.message);
  await loadMasterCatalog();
}

function openCatalogImport() {
  state.importRows = [];
  state.importSelection = new Set();
  elements.catalogImportFile.value = '';
  elements.catalogImportSummary.textContent = '';
  elements.catalogImportPreview.replaceChildren();
  elements.catalogImportError.hidden = true;
  elements.confirmCatalogImport.disabled = true;
  elements.catalogImportDialog.showModal();
}

function renderImportPreview(result) {
  elements.catalogImportSummary.textContent = `${result.total} filas · ${result.validos} válidas · ${result.duplicados} duplicadas · ${result.invalidos} inválidas`;
  const table = document.createElement('table');
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  ['Importar', 'Fila', 'Producto', 'Marca', 'Categoría', 'Estado'].forEach((label) => {
    const cell = document.createElement('th');
    cell.textContent = label;
    headRow.appendChild(cell);
  });
  head.appendChild(headRow);
  const body = document.createElement('tbody');
  result.filas.forEach((row) => {
    const tr = document.createElement('tr');
    const selectable = row.valido || row.duplicadoConfirmable;
    const selectorCell = document.createElement('td');
    const selector = document.createElement('input');
    selector.type = 'checkbox';
    selector.disabled = !selectable;
    selector.checked = state.importSelection.has(Number(row.fila));
    selector.setAttribute('aria-label', `Importar fila ${row.fila}`);
    selector.addEventListener('change', () => {
      if (selector.checked) state.importSelection.add(Number(row.fila));
      else state.importSelection.delete(Number(row.fila));
      row.confirmarDuplicado = Boolean(selector.checked && row.duplicadoConfirmable);
      elements.confirmCatalogImport.disabled = state.importSelection.size === 0;
    });
    selectorCell.appendChild(selector);
    tr.appendChild(selectorCell);
    const status = row.valido
      ? 'Lista para importar'
      : row.duplicadoConfirmable
        ? 'Posible duplicado; requiere confirmación'
        : row.duplicado ? 'Código o fila duplicada' : row.errores.join('; ');
    [row.fila, row.nombre, row.marca || 'Sin marca', row.categoria || 'Sin categoría', status].forEach((value, index) => {
      const cell = document.createElement('td');
      cell.textContent = String(value ?? '');
      if (index === 4 && !row.valido) cell.className = 'import-row-error';
      tr.appendChild(cell);
    });
    body.appendChild(tr);
  });
  table.append(head, body);
  elements.catalogImportPreview.replaceChildren(table);
}

async function previewCatalogImport() {
  const file = elements.catalogImportFile.files[0];
  if (!file) {
    elements.catalogImportError.textContent = 'Selecciona un archivo .xlsx.';
    elements.catalogImportError.hidden = false;
    return;
  }
  const data = new FormData();
  data.append('archivo', file);
  elements.catalogImportError.hidden = true;
  try {
    const result = await api('/api/admin/catalogo/importaciones/previsualizar', { method: 'POST', body: data });
    state.importRows = result.filas;
    state.importSelection = new Set(result.filas.filter((row) => row.valido).map((row) => Number(row.fila)));
    renderImportPreview(result);
    elements.confirmCatalogImport.disabled = state.importSelection.size === 0;
  } catch (error) {
    elements.catalogImportError.textContent = error.message;
    elements.catalogImportError.hidden = false;
    elements.confirmCatalogImport.disabled = true;
  }
}

async function confirmCatalogImport() {
  const selectedRows = state.importRows.filter((row) => state.importSelection.has(Number(row.fila))).map((row) => {
    const copy = { ...row };
    delete copy.valido;
    delete copy.duplicado;
    delete copy.tipoDuplicado;
    delete copy.duplicadoConfirmable;
    delete copy.errores;
    delete copy.coincidencias;
    delete copy.erroresLectura;
    return copy;
  });
  if (!selectedRows.length) return;
  elements.confirmCatalogImport.disabled = true;
  try {
    const result = await api('/api/admin/catalogo/importaciones/confirmar', {
      method: 'POST', body: { filas: selectedRows }
    });
    showToast(`${result.creados} productos creados; ${result.omitidos} omitidos.`);
    elements.catalogImportDialog.close();
    await loadMasterCatalog(1);
  } catch (error) {
    elements.catalogImportError.textContent = error.message;
    elements.catalogImportError.hidden = false;
    elements.confirmCatalogImport.disabled = false;
  }
}

function openSupplierSourceImport() {
  state.supplierSourceReady = false;
  elements.supplierSourceImportFile.value = '';
  elements.supplierSourceImportSummary.textContent = '';
  elements.supplierSourceImportError.hidden = true;
  elements.confirmSupplierSourceImport.disabled = true;
  elements.supplierSourceImportDialog.showModal();
}

async function previewSupplierSourceImport() {
  const file = elements.supplierSourceImportFile.files[0];
  if (!file) {
    elements.supplierSourceImportError.textContent = 'Selecciona el archivo base .xlsx.';
    elements.supplierSourceImportError.hidden = false;
    return;
  }
  const data = new FormData();
  data.append('archivo', file);
  elements.supplierSourceImportError.hidden = true;
  elements.confirmSupplierSourceImport.disabled = true;
  try {
    const result = await api('/api/admin/catalogo/importaciones/proveedores/previsualizar', { method: 'POST', body: data });
    elements.supplierSourceImportSummary.textContent = `${result.proveedoresFuente} proveedores · ${result.productosConProveedor} productos con proveedor · ${result.productosCoincidentes} coinciden con el catálogo · ${result.productosAActualizar} sugerencias para actualizar${result.productosConAlternativas ? ` · ${result.productosConAlternativas} con proveedor alternativo` : ''}.`;
    state.supplierSourceReady = true;
    elements.confirmSupplierSourceImport.disabled = result.productosAActualizar === 0;
  } catch (error) {
    state.supplierSourceReady = false;
    elements.supplierSourceImportError.textContent = error.message;
    elements.supplierSourceImportError.hidden = false;
  }
}

async function confirmSupplierSourceImport() {
  const file = elements.supplierSourceImportFile.files[0];
  if (!state.supplierSourceReady || !file) return;
  const data = new FormData();
  data.append('archivo', file);
  elements.confirmSupplierSourceImport.disabled = true;
  try {
    const result = await api('/api/admin/catalogo/importaciones/proveedores/confirmar', { method: 'POST', body: data });
    showToast(`${result.productosAActualizar} productos ahora tienen proveedor sugerido.`);
    elements.supplierSourceImportDialog.close();
    await loadMasterCatalog();
  } catch (error) {
    elements.supplierSourceImportError.textContent = error.message;
    elements.supplierSourceImportError.hidden = false;
    elements.confirmSupplierSourceImport.disabled = false;
  }
}

async function logout() {
  const confirmed = await openConfirmation(
    'Cerrar sesión',
    '¿Seguro que deseas cerrar la sesión administrativa?',
    'Cerrar sesión'
  );
  if (!confirmed) return;
  await SecurityHttp.secureFetch('/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
}

elements.dynamicForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.formAction) return;
  elements.formError.hidden = true;
  elements.formSubmitButton.disabled = true;
  try {
    await state.formAction(formValues());
    elements.formDialog.close();
  } catch (error) {
    elements.formError.textContent = error.message;
    elements.formError.hidden = false;
  } finally {
    elements.formSubmitButton.disabled = false;
  }
});

document.querySelectorAll('[data-close-dialog]').forEach((button) => {
  button.addEventListener('click', () => elements.formDialog.close());
});
elements.storeSearch.addEventListener('input', renderStores);
elements.storeFilterButton.addEventListener('click', () => {
  elements.storeFilterDialog.showModal();
  elements.storeFilterForm.elements.estado.focus();
});
document.getElementById('closeStoreFilters').addEventListener('click', () => elements.storeFilterDialog.close());
elements.storeFilterDialog.addEventListener('close', () => {
  elements.storeFilterForm.elements.estado.value = state.storeFilters.estado;
  elements.storeFilterForm.elements.suscripcion.value = state.storeFilters.suscripcion;
  const target = document.querySelector('.admin-main')?.dataset.activeView === 'tiendas'
    ? elements.storeFilterButton : document.querySelector('.admin-sidebar .nav-link.active');
  target?.focus();
});
elements.storeFilterForm.addEventListener('submit', (event) => {
  event.preventDefault();
  state.storeFilters = {
    estado: elements.storeFilterForm.elements.estado.value,
    suscripcion: elements.storeFilterForm.elements.suscripcion.value
  };
  const count = Number(Boolean(state.storeFilters.estado)) + Number(Boolean(state.storeFilters.suscripcion));
  elements.storeFilterButton.textContent = count ? `Filtros (${count})` : 'Filtros';
  renderStores();
  elements.storeFilterDialog.close();
});
document.getElementById('createStoreButton').addEventListener('click', createStore);
document.getElementById('editStoreButton').addEventListener('click', editStore);
document.getElementById('manageSubscriptionButton').addEventListener('click', manageSubscription);
document.getElementById('addOwnerButton').addEventListener('click', addOwner);
document.getElementById('toggleStoreButton').addEventListener('click', toggleStore);
document.getElementById('logoutButton').addEventListener('click', logout);
elements.adminSidebarToggle.addEventListener('click', () => {
  setAdminSidebarExpanded(!elements.adminShell.classList.contains('sidebar-expanded'));
});
elements.adminSidebarScrim.addEventListener('click', () => setAdminSidebarExpanded(false, { restoreFocus: true }));
document.querySelectorAll('.admin-sidebar .nav-link').forEach((link) => {
  link.addEventListener('click', () => setAdminSidebarExpanded(false));
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && elements.adminShell.classList.contains('sidebar-expanded')) {
    setAdminSidebarExpanded(false, { restoreFocus: true });
  }
});
window.addEventListener('resize', () => {
  if (!window.matchMedia('(max-width: 760px)').matches) setAdminSidebarExpanded(false);
});
document.getElementById('addMasterProductButton').addEventListener('click', () => openMasterProduct());
document.getElementById('addMasterCategoryButton').addEventListener('click', () => openTaxonomy('categoria'));
document.getElementById('addMasterBrandButton').addEventListener('click', () => openTaxonomy('marca'));
document.getElementById('importCatalogButton').addEventListener('click', openCatalogImport);
document.getElementById('previewCatalogImport').addEventListener('click', previewCatalogImport);
elements.confirmCatalogImport.addEventListener('click', confirmCatalogImport);
document.getElementById('closeCatalogImport').addEventListener('click', () => elements.catalogImportDialog.close());
document.getElementById('cancelCatalogImport').addEventListener('click', () => elements.catalogImportDialog.close());
document.getElementById('importSupplierSourceButton').addEventListener('click', openSupplierSourceImport);
document.getElementById('previewSupplierSourceImport').addEventListener('click', previewSupplierSourceImport);
elements.confirmSupplierSourceImport.addEventListener('click', confirmSupplierSourceImport);
document.getElementById('closeSupplierSourceImport').addEventListener('click', () => elements.supplierSourceImportDialog.close());
document.getElementById('cancelSupplierSourceImport').addEventListener('click', () => elements.supplierSourceImportDialog.close());
elements.masterPreviousPage.addEventListener('click', () => loadMasterCatalog(state.masterPage - 1));
elements.masterNextPage.addEventListener('click', () => loadMasterCatalog(state.masterPage + 1));
let catalogSearchTimer;
elements.masterProductSearch.addEventListener('input', () => {
  window.clearTimeout(catalogSearchTimer);
  catalogSearchTimer = window.setTimeout(() => loadMasterCatalog(1).catch((error) => showToast(error.message, 'error')), 250);
});
function restoreCatalogFilterDraft() {
  elements.masterCategoryFilter.value = state.catalogFilters.category;
  elements.masterBrandFilter.value = state.catalogFilters.brand;
  elements.masterStatusFilter.value = state.catalogFilters.status;
}
elements.masterFilterButton.addEventListener('click', () => {
  elements.masterFilterError.hidden = true;
  elements.masterFilterDialog.showModal();
  elements.masterCategoryFilter.focus();
});
document.getElementById('closeMasterCatalogFilters').addEventListener('click', () => {
  if (!state.catalogFilterApplying) elements.masterFilterDialog.close();
});
elements.masterFilterDialog.addEventListener('cancel', (event) => {
  if (state.catalogFilterApplying) event.preventDefault();
});
elements.masterFilterDialog.addEventListener('close', () => {
  restoreCatalogFilterDraft();
  const target = document.querySelector('.admin-main')?.dataset.activeView === 'catalogo'
    ? elements.masterFilterButton : document.querySelector('.admin-sidebar .nav-link.active');
  target?.focus();
});
elements.masterFilterForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.catalogFilterApplying) return;
  state.catalogFilterApplying = true;
  const previousFilters = state.catalogFilters;
  const submit = elements.masterFilterForm.querySelector('[type="submit"]');
  submit.disabled = true;
  elements.masterFilterForm.setAttribute('aria-busy', 'true');
  state.catalogFilters = {
    category: elements.masterCategoryFilter.value,
    brand: elements.masterBrandFilter.value,
    status: elements.masterStatusFilter.value
  };
  elements.masterFilterError.hidden = true;
  try {
    await loadMasterCatalog(1);
    const count = Object.values(state.catalogFilters).filter(Boolean).length;
    elements.masterFilterButton.textContent = count ? `Filtros (${count})` : 'Filtros';
    elements.masterFilterDialog.close();
  } catch (error) {
    state.catalogFilters = previousFilters;
    elements.masterFilterError.textContent = error.message;
    elements.masterFilterError.hidden = false;
  } finally {
    state.catalogFilterApplying = false;
    submit.disabled = false;
    elements.masterFilterForm.removeAttribute('aria-busy');
  }
});
function loadAuditView() {
  if (!state.auditUi) {
    state.auditUi = window.AdministrativeAuditUI.create({
      api,
      root: document.getElementById('adminAuditRoot'),
      mode: 'admin',
      escapeHtml,
      formatDate
    });
  }
  state.auditUi.render().catch((error) => showToast(error.message, 'error'));
}
window.addEventListener('admin:viewchange', (event) => {
  if (event.detail !== 'tiendas' && elements.storeDetail.open) elements.storeDetail.close();
  if (event.detail !== 'tiendas' && elements.storeFilterDialog.open) elements.storeFilterDialog.close();
  if (event.detail !== 'catalogo' && elements.masterFilterDialog.open) elements.masterFilterDialog.close();
  if (event.detail === 'auditoria') loadAuditView();
});
if (window.location.hash === '#auditoria') loadAuditView();

async function initialize() {
  try {
    const response = await SecurityHttp.secureFetch('/auth/status');
    const status = await response.json();
    if (!status.authenticated) {
      window.location.href = '/login.html';
      return;
    }
    if (status.admin.rol !== 'superadmin') {
      window.location.href = '/app.html';
      return;
    }
    elements.currentAdmin.textContent = status.admin.usuario;
    state.plans = await api('/api/admin/planes');
    await Promise.all([loadStores(), loadMasterCatalog(1)]);
  } catch (error) {
    showToast(error.message || 'No se pudo cargar la administración.', 'error');
  }
}

initialize();
