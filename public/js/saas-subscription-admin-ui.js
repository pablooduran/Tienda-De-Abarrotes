(function initializeSaasSubscriptionAdmin(global) {
  const root = document.getElementById('suscripciones-saas');
  if (!root || !global.SecurityHttp) return;

  const state = { page: 1, pages: 1, reference: null, loaded: false, processing: false };
  const byId = (id) => document.getElementById(id);
  const elements = {
    link: byId('saasSubscriptionsLink'), filters: byId('saasSubscriptionFilters'),
    body: byId('saasSubscriptionsTableBody'), empty: byId('emptySaasSubscriptions'),
    previous: byId('saasPreviousPage'), next: byId('saasNextPage'), page: byId('saasPageLabel'),
    detail: byId('saasSubscriptionDetail'), detailTitle: byId('saasDetailTitle'),
    detailMessage: byId('saasDetailMessage'), facts: byId('saasDetailFacts'),
    limits: byId('saasLimits'), plans: byId('saasPlans'), history: byId('saasHistory'),
    audit: byId('saasAuditActions'),
    actions: byId('saasDetailActions'), dialog: byId('saasSubscriptionActionDialog'),
    actionForm: byId('saasSubscriptionActionForm'), actionTitle: byId('saasActionTitle'),
    actionFields: byId('saasActionFields'), actionHelp: byId('saasActionHelp'),
    actionError: byId('saasActionError'), submit: byId('submitSaasAction')
  };

  async function request(path, options = {}) {
    const init = { ...options, headers: { ...(options.headers || {}) } };
    if (init.body && typeof init.body !== 'string') {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(init.body);
    }
    const response = await global.SecurityHttp.secureFetch(path, init);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw global.SecurityHttp.errorFromResponse(response, body, 'No se pudo completar la operacion.');
    return body;
  }

  function label(value) {
    return String(value || 'sin_suscripcion').replaceAll('_', ' ').replace(/^./, (character) => character.toUpperCase());
  }

  function date(value) {
    if (!value) return 'No aplica';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : new Intl.DateTimeFormat('es-BO', {
      dateStyle: 'medium', timeStyle: 'short', hour12: false
    }).format(parsed);
  }

  function cell(content, labelText = '') {
    const td = document.createElement('td');
    if (labelText) td.dataset.label = labelText;
    if (content instanceof Node) td.appendChild(content); else td.textContent = String(content ?? '');
    return td;
  }

  function badge(status) {
    const span = document.createElement('span');
    span.className = `status-badge ${status === 'activa' || status === 'completo' ? 'status-active' : status === 'gracia' || status === 'solo_lectura' ? 'status-suspended' : 'status-inactive'}`;
    span.textContent = label(status);
    return span;
  }

  function filters() {
    const data = new FormData(elements.filters);
    const params = new URLSearchParams({ pagina: String(state.page), limite: '20' });
    for (const [key, value] of data.entries()) if (String(value).trim()) params.set(key, String(value));
    if (elements.filters.elements.excedidos.checked) params.set('excedidos', 'true');
    if (elements.filters.elements.downgrade.checked) params.set('downgrade', 'true');
    return params;
  }

  function renderSummary(summary) {
    byId('saasTotalCount').textContent = summary.total;
    byId('saasActiveCount').textContent = summary.activas;
    byId('saasGraceCount').textContent = summary.gracia;
    byId('saasSuspendedCount').textContent = summary.suspendidas;
    byId('saasCancelledCount').textContent = summary.canceladas;
    byId('saasExceededCount').textContent = summary.limitesExcedidos;
    const plans = Object.entries(summary.porPlan || {}).map(([name, count]) => `${label(name)}: ${count}`);
    const types = Object.entries(summary.porTipo || {}).map(([name, count]) => `${label(name)}: ${count}`);
    byId('saasSummaryBreakdown').textContent = [...plans, ...types].join(' | ');
  }

  function renderList(data) {
    elements.body.replaceChildren();
    elements.empty.hidden = data.resultados.length > 0;
    for (const item of data.resultados) {
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'table-action';
      action.textContent = 'Gestionar';
      action.addEventListener('click', () => loadDetail(item.referencia));
      const row = document.createElement('tr');
      row.append(
        cell(item.tienda, 'Tienda'), cell(item.plan?.nombre || 'Sin plan', 'Plan'), cell(label(item.tipo), 'Tipo'),
        cell(badge(item.estadoEfectivo), 'Estado'), cell(badge(item.acceso), 'Acceso'), cell(date(item.fechaFin), 'Vencimiento'),
        cell(item.excesos.length ? item.excesos.join(', ') : 'Ninguno', 'Excesos'), cell(action, 'Accion')
      );
      elements.body.appendChild(row);
    }
    state.pages = data.paginacion.paginas;
    elements.page.textContent = `Pagina ${data.paginacion.pagina} de ${data.paginacion.paginas}`;
    elements.previous.disabled = state.page <= 1;
    elements.next.disabled = state.page >= state.pages;
  }

  async function loadList() {
    const planSelect = elements.filters.elements.plan;
    if (planSelect.options.length === 1) {
      const catalog = await request('/api/admin/planes');
      for (const plan of catalog.filter((item) => Number(item.activo) === 1)) {
        const option = document.createElement('option');
        option.value = plan.codigo;
        option.textContent = plan.nombre;
        planSelect.appendChild(option);
      }
    }
    const [summary, list] = await Promise.all([
      request('/api/admin/suscripciones/resumen'),
      request(`/api/admin/suscripciones?${filters()}`)
    ]);
    renderSummary(summary);
    renderList(list);
    state.loaded = true;
  }

  function fact(name, value) {
    const div = document.createElement('div');
    const span = document.createElement('span');
    const strong = document.createElement('strong');
    span.textContent = name;
    strong.textContent = value;
    div.append(span, strong);
    return div;
  }

  function actionButton(action, labelText, className = 'button-secondary') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `button ${className}`;
    button.textContent = labelText;
    button.addEventListener('click', () => openAction(action));
    return button;
  }

  function groupedActions(data) {
    const controls = document.createDocumentFragment();
    const secondary = [];
    if (data.estadoEfectivo === 'suspendida') controls.append(actionButton('reactivar', 'Reactivar', 'button-primary'));
    else if (data.estadoEfectivo !== 'cancelada') controls.append(actionButton('renovar', 'Renovar tecnicamente', 'button-primary'));
    if (!['suspendida', 'cancelada'].includes(data.estadoEfectivo)) secondary.push(actionButton('suspender', 'Suspender'));
    if (data.estadoEfectivo !== 'cancelada') {
      secondary.push(actionButton('upgrade', 'Cambiar a un plan superior'));
      secondary.push(actionButton('downgrade', 'Programar cambio de plan'));
      secondary.push(actionButton('cancelar', 'Cancelar', 'button-danger'));
    }
    if (secondary.length) {
      const details = document.createElement('details');
      details.className = 'saas-more-actions';
      const summary = document.createElement('summary');
      summary.textContent = 'Mas opciones';
      const list = document.createElement('div');
      list.className = 'button-row';
      list.append(...secondary);
      details.append(summary, list);
      controls.append(details);
    }
    return controls;
  }

  function renderDetail(data) {
    state.reference = data.referencia;
    state.detailData = data;
    elements.detailTitle.textContent = data.tienda;
    elements.detailMessage.textContent = `${label(data.estadoEfectivo)} - acceso ${label(data.acceso).toLowerCase()}`;
    elements.facts.replaceChildren(
      fact('Plan', data.plan?.nombre || 'Sin plan'), fact('Tipo', label(data.tipo)),
      fact('Inicio', date(data.fechaInicio)), fact('Vencimiento', date(data.fechaFin)),
      fact('Fin de gracia', date(data.fechaFinGracia)), fact('Suspendida', date(data.suspendidaEn)),
      fact('Reactivada', date(data.reactivadaEn)), fact('Cancelada', date(data.canceladaEn)),
      fact('Plan programado', data.planProgramado?.nombre || 'Ninguno'),
      fact('Siguiente accion', label(data.siguienteAccion))
    );
    elements.limits.replaceChildren();
    for (const [name, availability] of Object.entries(data.disponibilidad || {})) {
      const row = document.createElement('div');
      row.className = `saas-limit-row${availability.excedido ? ' saas-limit-exceeded' : ''}`;
      const strong = document.createElement('strong');
      const span = document.createElement('span');
      strong.textContent = label(name);
      span.textContent = `${availability.uso} / ${availability.limite === null ? 'Sin limite' : availability.limite}`;
      row.append(strong, span);
      elements.limits.appendChild(row);
    }
    elements.plans.replaceChildren();
    for (const plan of data.planes || []) {
      const row = document.createElement('div');
      row.className = 'saas-plan-row';
      const strong = document.createElement('strong');
      const span = document.createElement('span');
      strong.textContent = plan.nombre;
      span.textContent = label(plan.tipoCambio);
      row.append(strong, span);
      elements.plans.appendChild(row);
    }
    elements.history.replaceChildren();
    for (const item of data.historial.resultados) {
      const row = document.createElement('div');
      row.className = 'saas-history-item';
      const strong = document.createElement('strong');
      const span = document.createElement('span');
      strong.textContent = `${label(item.operacion)}: ${label(item.estadoAnterior)} a ${label(item.estadoNuevo)}`;
      span.textContent = `${date(item.fecha)} - ${item.actor}`;
      row.append(strong, span);
      elements.history.appendChild(row);
    }
    elements.audit.replaceChildren();
    for (const item of data.accionesAdministrativas || []) {
      const row = document.createElement('div');
      row.className = 'saas-history-item';
      const strong = document.createElement('strong');
      const span = document.createElement('span');
      strong.textContent = label(item.accion);
      span.textContent = `${date(item.fecha)}${item.metadata?.motivoCodigo ? ` - ${label(item.metadata.motivoCodigo)}` : ''}`;
      row.append(strong, span);
      elements.audit.appendChild(row);
    }
    elements.actions.replaceChildren(groupedActions(data));
    elements.detail.hidden = false;
    elements.detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function loadDetail(reference) {
    renderDetail(await request(`/api/admin/suscripciones/${encodeURIComponent(reference)}`));
  }

  function selectField(name, labelText, options) {
    const wrapper = document.createElement('label');
    wrapper.className = 'form-field full';
    const span = document.createElement('span');
    const select = document.createElement('select');
    span.textContent = labelText;
    select.name = name;
    select.required = true;
    for (const item of options) {
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      select.appendChild(option);
    }
    wrapper.append(span, select);
    return wrapper;
  }

  function openAction(action) {
    const data = state.detailData;
    elements.actionFields.replaceChildren();
    elements.actionError.hidden = true;
    elements.actionForm.dataset.action = action;
    const configs = {
      suspender: ['Suspender suscripcion', 'El acceso comercial quedara restringido y los datos se conservaran.'],
      cancelar: ['Cancelar suscripcion', 'La cancelacion es inmediata. Los datos se conservan y no se reactivara automaticamente.'],
      reactivar: ['Reactivar suscripcion', 'Si la vigencia termino, comenzara un nuevo periodo desde hoy.'],
      renovar: ['Renovar tecnicamente', 'Esta operacion no registra pagos.'],
      upgrade: ['Aplicar upgrade', 'El cambio es inmediato y conserva la fecha de finalizacion.'],
      downgrade: ['Programar downgrade', 'El cambio se aplicara al siguiente periodo y no eliminara datos.']
    };
    elements.actionTitle.textContent = configs[action][0];
    elements.actionHelp.textContent = `${data.tienda}. ${configs[action][1]}`;
    if (action === 'suspender' || action === 'cancelar') {
      elements.actionFields.append(selectField('motivo', 'Motivo', [
        { value: 'falta_pago', label: 'Falta de pago' }, { value: 'incumplimiento', label: 'Incumplimiento' },
        { value: 'solicitud_administrativa', label: 'Solicitud administrativa' }, { value: 'seguridad', label: 'Seguridad' },
        { value: 'otro_controlado', label: 'Otro motivo controlado' }
      ]));
    } else if (action === 'reactivar' || action === 'renovar') {
      elements.actionFields.append(selectField('periodo', 'Periodo', [
        { value: 'mensual', label: 'Mensual' }, { value: 'anual', label: 'Anual' }
      ]));
    } else {
      const choices = (data.planes || []).filter((plan) => (
        action === 'upgrade' ? plan.tipoCambio === 'upgrade' : plan.tipoCambio === 'downgrade'
      )).map((plan) => ({ value: plan.codigo, label: plan.nombre }));
      elements.actionFields.append(selectField('codigoPlan', 'Plan objetivo', choices));
      elements.submit.disabled = choices.length === 0;
    }
    elements.submit.disabled = elements.actionFields.querySelector('select option') === null;
    elements.dialog.showModal();
  }

  elements.actionForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.processing) return;
    state.processing = true;
    elements.submit.disabled = true;
    elements.actionError.hidden = true;
    try {
      const action = elements.actionForm.dataset.action;
      const body = Object.fromEntries(new FormData(elements.actionForm).entries());
      await request(`/api/admin/suscripciones/${encodeURIComponent(state.reference)}/${action}`, {
        method: 'POST', headers: { 'Idempotency-Key': `saas-admin:${global.crypto.randomUUID()}` }, body
      });
      elements.dialog.close();
      await Promise.all([loadList(), loadDetail(state.reference)]);
    } catch (error) {
      elements.actionError.textContent = error.message;
      elements.actionError.hidden = false;
    } finally {
      state.processing = false;
      elements.submit.disabled = false;
    }
  });

  elements.filters.addEventListener('submit', (event) => {
    event.preventDefault();
    state.page = 1;
    loadList().catch((error) => { elements.empty.textContent = error.message; elements.empty.hidden = false; });
  });
  elements.previous.addEventListener('click', () => { if (state.page > 1) { state.page -= 1; loadList(); } });
  elements.next.addEventListener('click', () => { if (state.page < state.pages) { state.page += 1; loadList(); } });
  byId('refreshSaasSubscriptions').addEventListener('click', () => loadList());
  byId('closeSaasAction').addEventListener('click', () => elements.dialog.close());
  byId('cancelSaasAction').addEventListener('click', () => elements.dialog.close());
  elements.link.addEventListener('click', () => { if (!state.loaded) loadList(); });
  if (global.location.hash === '#suscripciones-saas') loadList();
}(window));
