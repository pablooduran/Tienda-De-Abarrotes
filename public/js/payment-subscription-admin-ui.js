(function initializePaymentSubscriptionAdminUi(global) {
  'use strict';

  const MOTIVES = Object.freeze([
    ['comprobante_ilegible', 'Comprobante ilegible'], ['datos_incompletos', 'Datos incompletos'],
    ['monto_incorrecto', 'Monto incorrecto'], ['metodo_no_valido', 'Método no válido'], ['otro_controlado', 'Otro motivo controlado']
  ]);
  const label = (value) => String(value || 'No disponible').replaceAll('_', ' ');
  const date = (value) => value ? new Intl.DateTimeFormat('es-BO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/La_Paz' }).format(new Date(`${String(value).replace(' ', 'T')}-04:00`)) : 'No disponible';
  const operationKey = (scope) => `${scope}:${global.crypto.randomUUID()}`;

  function create() {
    const byId = (id) => global.document.getElementById(id);
    const elements = {
      link: byId('paymentSubscriptionsLink'), refresh: byId('refreshPaymentAdmin'), feedback: byId('paymentAdminFeedback'), rateForm: byId('paymentRateForm'), rate: byId('paymentCurrentRate'), rates: byId('paymentRateHistory'), methods: byId('paymentAdminMethods'), filters: byId('paymentReviewFilters'), table: byId('paymentReviewTableBody'), empty: byId('emptyPaymentReviews'), previous: byId('paymentPreviousPage'), next: byId('paymentNextPage'), page: byId('paymentPageLabel'), detail: byId('paymentReviewDetail'), detailTitle: byId('paymentReviewDetailTitle'), detailMessage: byId('paymentReviewDetailMessage'), facts: byId('paymentReviewFacts'), snapshot: byId('paymentReviewSnapshot'), history: byId('paymentReviewHistory'), notes: byId('paymentReviewNotes'), actions: byId('paymentReviewDetailActions'), dialog: byId('paymentReviewActionDialog'), form: byId('paymentReviewActionForm'), title: byId('paymentReviewActionTitle'), fields: byId('paymentReviewActionFields'), help: byId('paymentReviewActionHelp'), error: byId('paymentReviewActionError'), close: byId('closePaymentReviewAction'), cancel: byId('cancelPaymentReviewAction'), submit: byId('submitPaymentReviewAction')
    };
    if (!elements.link) return null;
    const state = { page: 1, pages: 1, detail: null, processing: false, loaded: false };

    async function request(url, options = {}) {
      const response = await global.SecurityHttp.secureFetch(url, options);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw global.SecurityHttp.errorFromResponse(response, body, 'No se pudo completar la operación administrativa.');
      return body;
    }
    function createNode(tag, text, className) { const node = global.document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; }
    function feedback(message) { if (elements.feedback) elements.feedback.textContent = message; }
    function query() { const values = Object.fromEntries(new FormData(elements.filters).entries()); values.pagina = String(state.page); values.limite = '10'; return new URLSearchParams(Object.entries(values).filter(([, value]) => value !== '')).toString(); }
    function fact(name, value) { const div = global.document.createElement('div'); div.append(createNode('span', name), createNode('strong', value)); return div; }

    function renderRates(data) {
      elements.rate.textContent = data.vigente ? `Vigente: 1 USD = BOB ${data.vigente.valor}. Fuente: ${data.vigente.fuente}.` : 'No hay una tasa USD/BOB vigente. Las cotizaciones no estarán disponibles.';
      elements.rates.replaceChildren(...(data.historial || []).map((item) => { const row = createNode('p', ''); row.append(createNode('strong', `BOB ${item.valor}`), createNode('span', `${date(item.vigenteDesde)} · ${item.fuente}`)); return row; }));
    }
    function renderMethods(data) {
      elements.methods.replaceChildren(...(data.metodos || []).map((item) => {
        const form = global.document.createElement('form'); form.className = 'payment-method-config'; form.dataset.reference = item.referencia;
        const heading = createNode('strong', item.nombre); const detail = createNode('span', `${item.soloAdministracion ? 'Solo administración' : 'Visible al propietario'} · ${item.requiereComprobante ? 'requiere comprobante' : 'sin comprobante'}`);
        const active = global.document.createElement('input'); active.type = 'checkbox'; active.name = 'activo'; active.checked = item.activo;
        const visible = global.document.createElement('input'); visible.type = 'checkbox'; visible.name = 'visiblePropietario'; visible.checked = item.visiblePropietario; visible.disabled = item.soloAdministracion;
        const instructions = global.document.createElement('textarea'); instructions.name = 'instrucciones'; instructions.maxLength = 500; instructions.value = item.instrucciones || ''; instructions.setAttribute('aria-label', `Instrucciones para ${item.nombre}`);
        const button = createNode('button', 'Guardar método', 'button button-secondary'); button.type = 'submit';
        form.append(heading, detail);
        const activeLabel = createNode('label', ''); activeLabel.append(active, global.document.createTextNode(' Activo'));
        const visibleLabel = createNode('label', ''); visibleLabel.append(visible, global.document.createTextNode(' Visible al propietario'));
        form.append(activeLabel, visibleLabel, instructions, button);
        form.addEventListener('submit', (event) => { event.preventDefault(); void saveMethod(form, button); }); return form;
      }));
    }
    function renderList(data) {
      state.pages = data.paginacion?.paginas || 1; elements.table.replaceChildren();
      for (const item of data.resultados || []) {
        const row = global.document.createElement('tr');
        for (const value of [item.tienda, label(item.operacion), item.plan.nombre, `${item.monto.moneda} ${item.monto.valor}`]) row.append(createNode('td', value));
        const stateCell = global.document.createElement('td'); stateCell.append(createNode('span', label(item.estado), 'payment-state')); stateCell.firstChild.dataset.state = item.estado; row.append(stateCell);
        row.append(createNode('td', item.comprobanteDisponible ? 'Disponible' : 'No disponible'));
        const action = global.document.createElement('td'); const button = createNode('button', 'Ver detalle', 'button button-secondary table-action'); button.type = 'button'; button.addEventListener('click', () => { void loadDetail(item.referencia); }); action.append(button); row.append(action); elements.table.append(row);
      }
      elements.empty.hidden = Boolean((data.resultados || []).length); elements.page.textContent = `Página ${state.page} de ${state.pages}`; elements.previous.disabled = state.page <= 1; elements.next.disabled = state.page >= state.pages;
    }
    async function loadList() { renderList(await request(`/api/admin/pagos-suscripcion/revision?${query()}`)); state.loaded = true; }
    async function loadConfiguration() { const [rates, methods] = await Promise.all([request('/api/admin/pagos-suscripcion/tipos-cambio'), request('/api/admin/pagos-suscripcion/metodos')]); renderRates(rates); renderMethods(methods); }
    function actionButton(action, text, style = 'button-secondary') { const button = createNode('button', text, `button ${style}`); button.type = 'button'; button.addEventListener('click', () => openAction(action)); return button; }
    function renderDetail(data) {
      state.detail = data; elements.detailTitle.textContent = `${data.tienda} · ${data.plan.nombre}`; elements.detailMessage.textContent = `${label(data.operacion)} · ${label(data.estado)}`;
      elements.facts.replaceChildren(fact('Monto', `${data.monto.moneda} ${data.monto.valor}`), fact('Método', data.metodo), fact('Creada', date(data.creadaEn)), fact('Vence', date(data.venceEn)), fact('Plan actual', data.planActual.nombre), fact('Tipo de cambio', `USD/BOB ${data.tipoCambio.valor}`));
      elements.snapshot.replaceChildren(...[ `Periodo: ${label(data.snapshot.periodo)} (${data.snapshot.meses} meses)`, `Precio: ${data.snapshot.monedaBase} ${data.snapshot.precioUSD}`, `Fuente de cambio: ${data.tipoCambio.fuente}`, `Comprobante: ${data.comprobante ? data.comprobante.nombre : 'No disponible'}` ].map((text) => createNode('p', text)));
      if (data.comprobante) { const download = global.document.createElement('a'); download.href = `/api/admin/pagos-suscripcion/revision/${encodeURIComponent(data.referencia)}/comprobante`; download.className = 'button-link'; download.textContent = 'Descargar comprobante'; elements.snapshot.append(download); }
      elements.history.replaceChildren(...(data.historial || []).map((item) => createNode('p', `${label(item.evento)} · ${date(item.fecha)}`)));
      elements.notes.replaceChildren(...(data.revisiones || []).map((item) => createNode('p', `${label(item.decision)}: ${item.observacion}`)));
      elements.actions.replaceChildren(); if (data.estado === 'pendiente_revision') elements.actions.append(actionButton('observada', 'Solicitar corrección'), actionButton('rechazada', 'Rechazar', 'button-danger'), actionButton('aplicar', 'Aprobar y aplicar', 'button-primary')); else if (data.estado === 'observada') elements.actions.append(actionButton('rechazada', 'Rechazar', 'button-danger'));
      elements.detail.hidden = false; elements.detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    async function loadDetail(reference) { renderDetail(await request(`/api/admin/pagos-suscripcion/revision/${encodeURIComponent(reference)}`)); }
    function openAction(action) {
      elements.form.dataset.action = action; elements.fields.replaceChildren(); elements.error.hidden = true;
      const isApply = action === 'aplicar'; elements.title.textContent = isApply ? 'Aprobar y aplicar' : action === 'observada' ? 'Solicitar corrección' : 'Rechazar solicitud'; elements.help.textContent = isApply ? 'Esta acción aplica el pago a la suscripción usando las condiciones congeladas. No puede deshacerse desde esta pantalla.' : 'La observación o rechazo conserva el historial y el comprobante.';
      if (!isApply) { const motive = global.document.createElement('select'); motive.name = 'motivo'; motive.required = true; for (const [value, text] of MOTIVES) motive.append(Object.assign(global.document.createElement('option'), { value, textContent: text })); const observation = global.document.createElement('textarea'); observation.name = 'observacion'; observation.required = true; observation.minLength = 4; observation.maxLength = 500; const motiveLabel = createNode('label', ''); motiveLabel.append(createNode('span', 'Motivo'), motive); const observationLabel = createNode('label', ''); observationLabel.append(createNode('span', 'Observación'), observation); elements.fields.append(motiveLabel, observationLabel); }
      elements.submit.className = `button ${action === 'rechazada' ? 'button-danger' : 'button-primary'}`; elements.dialog.showModal();
    }
    async function submitAction(event) {
      event.preventDefault(); if (state.processing || !state.detail) return; state.processing = true; elements.submit.disabled = true; elements.error.hidden = true;
      try { const action = elements.form.dataset.action; const body = action === 'aplicar' ? {} : Object.fromEntries(new FormData(elements.form).entries()); await request(`/api/admin/pagos-suscripcion/revision/${encodeURIComponent(state.detail.referencia)}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operationKey(`payment-review-${action}`) }, body: JSON.stringify(body) }); elements.dialog.close(); await loadList(); await loadDetail(state.detail.referencia); } catch (error) { elements.error.textContent = error.message; elements.error.hidden = false; } finally { state.processing = false; elements.submit.disabled = false; }
    }
    async function saveMethod(form, button) { const restore = global.UiPatterns?.mutation(button, 'Guardando...'); if (!restore) return; try { const body = { activo: form.elements.activo.checked, visiblePropietario: form.elements.visiblePropietario.checked, instrucciones: form.elements.instrucciones.value || null }; await request(`/api/admin/pagos-suscripcion/metodos/${encodeURIComponent(form.dataset.reference)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operationKey('payment-method') }, body: JSON.stringify(body) }); feedback('Metodo actualizado.'); await loadConfiguration(); } catch (error) { feedback(global.UiPatterns?.messageFor(error) || 'No se pudo actualizar el metodo.'); } finally { restore(); } }
    elements.rateForm.addEventListener('submit', async (event) => { event.preventDefault(); const button = elements.rateForm.querySelector('button'); const restore = global.UiPatterns?.mutation(button, 'Registrando...'); if (!restore) return; try { await request('/api/admin/pagos-suscripcion/tipos-cambio', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operationKey('payment-rate') }, body: JSON.stringify(Object.fromEntries(new FormData(elements.rateForm).entries())) }); elements.rateForm.reset(); feedback('Tipo de cambio registrado.'); await loadConfiguration(); } catch (error) { feedback(global.UiPatterns?.messageFor(error) || 'No se pudo registrar el tipo de cambio.'); } finally { restore(); } });
    elements.filters.addEventListener('submit', (event) => { event.preventDefault(); state.page = 1; void loadList(); }); elements.previous.addEventListener('click', () => { if (state.page > 1) { state.page -= 1; void loadList(); } }); elements.next.addEventListener('click', () => { if (state.page < state.pages) { state.page += 1; void loadList(); } }); elements.refresh.addEventListener('click', () => { void Promise.all([loadConfiguration(), loadList()]); }); elements.link.addEventListener('click', () => { if (!state.loaded) void Promise.all([loadConfiguration(), loadList()]); }); elements.form.addEventListener('submit', submitAction); elements.close.addEventListener('click', () => elements.dialog.close()); elements.cancel.addEventListener('click', () => elements.dialog.close());
    if (global.location.hash === '#pagos-suscripcion') void Promise.all([loadConfiguration(), loadList()]);
    return Object.freeze({ loadConfiguration, loadList });
  }
  global.PaymentSubscriptionAdminUI = Object.freeze({ create });
  create();
}(window));
