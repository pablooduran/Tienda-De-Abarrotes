const state = {
  stores: [],
  selectedStore: null,
  owners: [],
  subscriptions: [],
  plans: [],
  masterCategories: [],
  masterBrands: [],
  masterProducts: [],
  masterPage: 1,
  masterPages: 1,
  importRows: [],
  importSelection: new Set(),
  formAction: null,
  formFields: []
};

const elements = {
  currentAdmin: document.getElementById('currentAdmin'),
  storeCount: document.getElementById('storeCount'),
  activeStoreCount: document.getElementById('activeStoreCount'),
  inactiveStoreCount: document.getElementById('inactiveStoreCount'),
  ownerCount: document.getElementById('ownerCount'),
  storeSearch: document.getElementById('storeSearch'),
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
  toggleStoreButton: document.getElementById('toggleStoreButton'),
  ownersTableBody: document.getElementById('ownersTableBody'),
  emptyOwners: document.getElementById('emptyOwners'),
  subscriptionsTableBody: document.getElementById('subscriptionsTableBody'),
  emptySubscriptions: document.getElementById('emptySubscriptions'),
  formDialog: document.getElementById('formDialog'),
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
  toast: document.getElementById('toast')
};

Object.assign(elements, {
  masterProductCount: document.getElementById('masterProductCount'),
  activeMasterProductCount: document.getElementById('activeMasterProductCount'),
  masterCategoryCount: document.getElementById('masterCategoryCount'),
  masterBrandCount: document.getElementById('masterBrandCount'),
  masterProductSearch: document.getElementById('masterProductSearch'),
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
  confirmCatalogImport: document.getElementById('confirmCatalogImport')
});

function isActive(value) {
  return Number(value) === 1;
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
    store.nombre.toLocaleLowerCase('es').includes(search)
      || store.slug.toLocaleLowerCase('es').includes(search)
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
    if (['activa', 'pendiente'].includes(subscription.estado)) {
      actions.append(ownerAction('Suspender', 'button-secondary', () => changeSubscriptionStatus(subscription, 'suspender')));
    }
    if (subscription.estado !== 'cancelada') {
      actions.append(ownerAction('Cancelar', 'button-danger', () => changeSubscriptionStatus(subscription, 'cancelar')));
    }
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
    actions.append(
      ownerAction('Editar usuario', 'button-secondary', () => editOwner(owner)),
      ownerAction('Nueva contraseña', 'button-secondary', () => resetOwnerPassword(owner)),
      ownerAction(
        isActive(owner.activo) ? 'Desactivar' : 'Activar',
        isActive(owner.activo) ? 'button-danger' : 'button-primary',
        () => toggleOwner(owner)
      )
    );
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
    elements.storeDetail.hidden = true;
  }
}

async function selectStore(idTienda, scroll = true) {
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
  elements.toggleStoreButton.textContent = isActive(store.activo) ? 'Suspender tienda' : 'Activar tienda';
  elements.toggleStoreButton.className = `button ${isActive(store.activo) ? 'button-danger' : 'button-primary'}`;
  elements.storeDetail.hidden = false;
  renderOwners();
  renderSubscriptions();
  if (scroll) elements.storeDetail.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  else label.append(labelText, input);
  return label;
}

function openForm({ title, submitLabel = 'Guardar', fields, action }) {
  state.formFields = fields;
  state.formAction = action;
  elements.formDialogTitle.textContent = title;
  elements.formSubmitButton.textContent = submitLabel;
  elements.formError.hidden = true;
  elements.formFields.replaceChildren(...fields.map(createField));
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
  const planOptions = state.plans.filter((plan) => isActive(plan.activo)).map((plan) => ({
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
  const planOptions = state.plans.filter((plan) => isActive(plan.activo)).map((plan) => ({
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
    actions.append(
      ownerAction('Editar', 'button-secondary', () => openMasterProduct(product)),
      ownerAction(isActive(product.activo) ? 'Desactivar' : 'Activar',
        isActive(product.activo) ? 'button-danger' : 'button-primary', () => toggleMasterProduct(product))
    );
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
    actions.append(
      ownerAction('Editar', 'button-secondary', () => openTaxonomy(kind, row)),
      ownerAction(isActive(row.activo) ? 'Desactivar' : 'Activar',
        isActive(row.activo) ? 'button-danger' : 'button-primary', () => toggleTaxonomy(kind, row))
    );
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
    ['idCategoriaMaestra', elements.masterCategoryFilter.value],
    ['idMarcaMaestra', elements.masterBrandFilter.value],
    ['activo', elements.masterStatusFilter.value]
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
    { name: 'nombre', label: 'Nombre', value: product.nombre || '', required: true, full: true },
    { name: 'idCategoriaMaestra', label: 'Categoría maestra', type: 'select', value: String(product.idCategoriaMaestra || ''), options: optionList(state.masterCategories, 'idCategoriaMaestra') },
    { name: 'idMarcaMaestra', label: 'Marca maestra', type: 'select', value: String(product.idMarcaMaestra || ''), options: optionList(state.masterBrands, 'idMarcaMaestra') },
    { name: 'codigoBarras', label: 'Código de barras opcional', value: product.codigoBarras || '' },
    { name: 'presentacion', label: 'Presentación', value: product.presentacion || '', placeholder: 'Botella, bolsa, paquete' },
    { name: 'contenidoCantidad', label: 'Contenido', type: 'number', step: '0.001', min: 0.001, value: product.contenidoCantidad || '' },
    { name: 'contenidoUnidad', label: 'Unidad de contenido', value: product.contenidoUnidad || '', placeholder: 'g, kg, ml, l' },
    { name: 'unidadesPorPaquete', label: 'Unidades por paquete', type: 'number', min: 1, step: 1, value: product.unidadesPorPaquete || 1, required: true },
    { name: 'permiteVentaPorUnidad', label: 'Permite venta por unidad', type: 'checkbox', value: product.permiteVentaPorUnidad ?? true },
    { name: 'permiteVentaPorPaquete', label: 'Permite venta por paquete', type: 'checkbox', value: product.permiteVentaPorPaquete ?? false },
    { name: 'activo', label: 'Producto maestro activo', type: 'checkbox', value: product.activo ?? true },
    { name: 'confirmarDuplicado', label: 'Confirmar posible duplicado advertido', type: 'checkbox', value: false },
    { name: 'descripcion', label: 'Descripción', type: 'textarea', value: product.descripcion || '', full: true }
  ];
}

function openMasterProduct(product = null) {
  openForm({
    title: product ? 'Editar producto maestro' : 'Nuevo producto maestro',
    submitLabel: product ? 'Guardar cambios' : 'Crear producto',
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
document.getElementById('createStoreButton').addEventListener('click', createStore);
document.getElementById('editStoreButton').addEventListener('click', editStore);
document.getElementById('manageSubscriptionButton').addEventListener('click', manageSubscription);
document.getElementById('addOwnerButton').addEventListener('click', addOwner);
document.getElementById('toggleStoreButton').addEventListener('click', toggleStore);
document.getElementById('logoutButton').addEventListener('click', logout);
document.getElementById('addMasterProductButton').addEventListener('click', () => openMasterProduct());
document.getElementById('addMasterCategoryButton').addEventListener('click', () => openTaxonomy('categoria'));
document.getElementById('addMasterBrandButton').addEventListener('click', () => openTaxonomy('marca'));
document.getElementById('importCatalogButton').addEventListener('click', openCatalogImport);
document.getElementById('previewCatalogImport').addEventListener('click', previewCatalogImport);
elements.confirmCatalogImport.addEventListener('click', confirmCatalogImport);
document.getElementById('closeCatalogImport').addEventListener('click', () => elements.catalogImportDialog.close());
document.getElementById('cancelCatalogImport').addEventListener('click', () => elements.catalogImportDialog.close());
elements.masterPreviousPage.addEventListener('click', () => loadMasterCatalog(state.masterPage - 1));
elements.masterNextPage.addEventListener('click', () => loadMasterCatalog(state.masterPage + 1));
let catalogSearchTimer;
elements.masterProductSearch.addEventListener('input', () => {
  window.clearTimeout(catalogSearchTimer);
  catalogSearchTimer = window.setTimeout(() => loadMasterCatalog(1).catch((error) => showToast(error.message, 'error')), 250);
});
[elements.masterCategoryFilter, elements.masterBrandFilter, elements.masterStatusFilter].forEach((input) => {
  input.addEventListener('change', () => loadMasterCatalog(1).catch((error) => showToast(error.message, 'error')));
});
document.querySelectorAll('.admin-sidebar .nav-link').forEach((link) => {
  link.addEventListener('click', () => {
    document.querySelectorAll('.admin-sidebar .nav-link').forEach((item) => item.classList.remove('active'));
    link.classList.add('active');
  });
});

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
