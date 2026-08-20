(function initializePaymentSubscriptionUi(global) {
  'use strict';

  const STATES = Object.freeze({
    pendiente_comprobante: 'Pendiente de comprobante',
    pendiente_revision: 'Pendiente de revisión',
    observada: 'Requiere corrección',
    rechazada: 'Rechazada',
    aplicada: 'Aplicada',
    cancelada: 'Cancelada',
    vencida: 'Vencida'
  });

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function label(value) { return STATES[value] || String(value || '').replaceAll('_', ' '); }
  function operationLabel(value) {
    return ({ renovacion: 'Renovacion', reactivacion: 'Reactivacion', upgrade: 'Cambio a un plan superior' })[value]
      || String(value || '').replaceAll('_', ' ');
  }

  function date(value) {
    if (!value) return 'No disponible';
    const parsed = new Date(`${String(value).replace(' ', 'T')}-04:00`);
    return Number.isNaN(parsed.getTime()) ? 'No disponible' : new Intl.DateTimeFormat('es-BO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/La_Paz' }).format(parsed);
  }

  function money(value, currency) { return `${escapeHtml(currency)} ${escapeHtml(value)}`; }
  function operationKey(scope) { return `${scope}:${global.crypto.randomUUID()}`; }

  function create({ root, api = null } = {}) {
    if (!root) throw new Error('El contenedor de pagos es obligatorio.');
    const state = { plans: [], methods: [], requests: [], page: 1, pages: 1, selected: null, loading: false };

    async function request(url, options = {}) {
      const response = api ? await api(url, options) : await global.SecurityHttp.secureFetch(url, options);
      const body = response && typeof response.json === 'function' ? await response.json().catch(() => ({})) : response;
      if (response && response.ok === false) throw global.SecurityHttp.errorFromResponse(response, body, 'No se pudo completar la operación de pago.');
      return body;
    }

    function selectedPlan() { return state.plans.find((item) => item.referencia === root.querySelector('[name="plan"]')?.value) || null; }
    function selectedMethod() { return state.methods.find((item) => item.referencia === root.querySelector('[name="metodo"]')?.value) || null; }

    function renderPlanOptions() {
      const plan = selectedPlan();
      const operations = plan?.operacionesDisponibles || [];
      const operationSelect = root.querySelector('[name="operacion"]');
      operationSelect.replaceChildren(...operations.map((value) => Object.assign(document.createElement('option'), { value, textContent: value === 'renovacion' ? 'Renovar suscripción' : value === 'reactivacion' ? 'Reactivar suscripción' : 'Cambiar a un plan superior' })));
      const periodSelect = root.querySelector('[name="periodo"]');
      periodSelect.replaceChildren(...(plan?.periodos || []).map((item) => Object.assign(document.createElement('option'), { value: item.periodo, textContent: `${item.periodo[0].toUpperCase()}${item.periodo.slice(1)} · USD ${item.monto}` })));
      root.querySelector('[data-payment-plan-description]').textContent = plan?.descripcion || 'Selecciona un plan disponible.';
      root.querySelector('[data-payment-form]').querySelectorAll('button[type="submit"]').forEach((button) => { button.disabled = !operations.length || !state.methods.length; });
    }

    function requestRow(item) {
      return `<article class="payment-request-row"><div><strong>${escapeHtml(item.plan.nombre)}</strong><span>${escapeHtml(operationLabel(item.operacion))} · ${escapeHtml(item.periodo)}</span></div><div><strong>${money(item.montoBOB, 'BOB')}</strong><span>USD ${escapeHtml(item.precioBaseUSD)}</span></div><div><span class="payment-state" data-state="${escapeHtml(item.estado)}">${escapeHtml(label(item.estado))}</span><span>Vence: ${escapeHtml(date(item.venceEn))}</span></div><button type="button" class="button-link" data-request-detail="${escapeHtml(item.referencia)}">Ver detalle</button></article>`;
    }

    function detailMarkup(data, receipts) {
      const active = (receipts?.comprobantes || []).find((item) => item.activo) || null;
      const canUpload = ['pendiente_comprobante', 'observada'].includes(data.estado);
      const canCancel = data.estado === 'pendiente_comprobante';
      const observation = (data.historial || []).filter((item) => item.evento === 'observada').at(-1);
      return `<section class="payment-request-detail" aria-labelledby="payment-request-title"><div class="payment-detail-heading"><div><p class="subscription-eyebrow">Solicitud</p><h3 id="payment-request-title">${escapeHtml(data.planObjetivo.nombre)}</h3><p><span class="payment-state" data-state="${escapeHtml(data.estado)}">${escapeHtml(label(data.estado))}</span></p></div><button type="button" class="button-link" data-close-request>Cerrar detalle</button></div>${observation ? '<div class="payment-observation" role="status">La revision solicito una correccion. Sube un comprobante actualizado para enviarlo nuevamente.</div>' : ''}<dl class="subscription-details"><div><dt>Operacion</dt><dd>${escapeHtml(operationLabel(data.operacion))}</dd></div><div><dt>Periodo</dt><dd>${escapeHtml(data.periodo)} (${escapeHtml(data.meses)} meses)</dd></div><div><dt>Precio comercial</dt><dd>${money(data.precioBase.monto, data.precioBase.moneda)}</dd></div><div><dt>Cobro</dt><dd>${money(data.montoCobro.monto, data.montoCobro.moneda)}</dd></div><div><dt>Metodo</dt><dd>${escapeHtml(data.metodo.nombre)}</dd></div><div><dt>Vence</dt><dd>${escapeHtml(date(data.venceEn))}</dd></div></dl><div class="payment-instructions"><strong>Instrucciones</strong><p>${escapeHtml(data.metodo.instrucciones || 'El metodo todavia no tiene instrucciones disponibles.')}</p></div>${active ? `<p><a class="button-link" href="/api/pagos-suscripcion/solicitudes/${encodeURIComponent(data.referencia)}/comprobantes/${encodeURIComponent(active.referencia)}">Descargar comprobante</a></p>` : ''}${canUpload ? `<form data-receipt-form class="payment-upload-form"><label><span>${active ? 'Reemplazar comprobante' : 'Subir comprobante'}</span><input name="comprobante" type="file" accept=".pdf,image/jpeg,image/png" required><small>PDF, JPEG o PNG. Maximo 5 MiB.</small></label><button class="button-link" type="submit">${active ? 'Reemplazar archivo' : 'Enviar comprobante'}</button></form>` : ''}${canCancel ? '<button type="button" class="button-link payment-danger" data-cancel-request>Cancelar solicitud</button>' : ''}<div class="payment-history"><h4>Historial</h4>${(data.historial || []).map((item) => `<p><strong>${escapeHtml(label(item.evento))}</strong><span>${escapeHtml(date(item.fecha))}</span></p>`).join('') || '<p>Sin movimientos visibles.</p>'}</div><p data-request-feedback role="status" aria-live="polite"></p></section>`;
    }

    async function showDetail(reference) {
      const [data, receipts] = await Promise.all([
        request(`/api/pagos-suscripcion/solicitudes/${encodeURIComponent(reference)}`),
        request(`/api/pagos-suscripcion/solicitudes/${encodeURIComponent(reference)}/comprobantes`)
      ]);
      state.selected = data;
      root.querySelector('[data-payment-detail]').innerHTML = detailMarkup(data, receipts);
      const detail = root.querySelector('[data-payment-detail]');
      detail.querySelector('[data-close-request]').addEventListener('click', () => { detail.replaceChildren(); state.selected = null; });
      const receiptForm = detail.querySelector('[data-receipt-form]');
      if (receiptForm) receiptForm.addEventListener('submit', (event) => { event.preventDefault(); void uploadReceipt(receiptForm); });
      const cancel = detail.querySelector('[data-cancel-request]');
      if (cancel) cancel.addEventListener('click', () => { if (global.confirm('La solicitud se cancelará y no podrá reactivarse.')) void cancelRequest(); });
      detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    async function uploadReceipt(form) {
      const feedback = root.querySelector('[data-request-feedback]');
      const button = form.querySelector('button'); const file = form.querySelector('input').files[0];
      if (!file) return;
      button.disabled = true; feedback.textContent = 'Cargando comprobante...';
      try {
        const body = new FormData(); body.append('comprobante', file);
        await request(`/api/pagos-suscripcion/solicitudes/${encodeURIComponent(state.selected.referencia)}/comprobantes`, { method: 'POST', headers: { 'Idempotency-Key': operationKey('payment-receipt') }, body });
        await loadRequests(); await showDetail(state.selected.referencia);
      } catch (error) { feedback.textContent = error.message || 'No se pudo cargar el comprobante.'; button.disabled = false; }
    }

    async function cancelRequest() {
      const feedback = root.querySelector('[data-request-feedback]');
      feedback.textContent = 'Cancelando solicitud...';
      try {
        await request(`/api/pagos-suscripcion/solicitudes/${encodeURIComponent(state.selected.referencia)}/cancelar`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operationKey('payment-cancel') }, body: '{}' });
        await loadRequests(); await showDetail(state.selected.referencia);
      } catch (error) { feedback.textContent = error.message || 'No se pudo cancelar la solicitud.'; }
    }

    async function quoteOrCreate(event) {
      event.preventDefault();
      const form = event.currentTarget; const action = form.dataset.paymentAction;
      const feedback = root.querySelector('[data-payment-feedback]'); const button = form.querySelector('button[type="submit"]');
      const body = Object.fromEntries(new FormData(form).entries());
      const restore = global.UiPatterns?.mutation(button, action === 'quote' ? 'Cotizando...' : 'Creando...');
      if (!restore) return;
      feedback.textContent = action === 'quote' ? 'Calculando cotización...' : 'Creando solicitud...';
      try {
        if (action === 'quote') {
          global.ProductAnalytics?.track('quote_started', {
            module: 'subscription_payments',
            operation: form.elements.operacion.value,
            plan: selectedPlan()?.referencia
          });
          const quote = await request('/api/pagos-suscripcion/cotizar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          root.querySelector('[data-payment-quote]').innerHTML = `<div class="payment-quote"><strong>${money(quote.montoCobro.monto, quote.montoCobro.moneda)}</strong><span>Referencia comercial: ${money(quote.precioBase.monto, quote.precioBase.moneda)} · válida hasta ${escapeHtml(date(quote.vigenteHasta))}</span><p>${escapeHtml(quote.efectoEsperado.tipo.replaceAll('_', ' '))}. El monto se congelará al crear la solicitud.</p></div>`;
          feedback.textContent = 'Cotización actualizada.';
        } else {
          const result = await request('/api/pagos-suscripcion/solicitudes', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operationKey('payment-request') }, body: JSON.stringify(body) });
          feedback.textContent = result.created ? 'Solicitud creada. Continúa cargando el comprobante.' : 'Ya existe una solicitud abierta para esta tienda.';
          await loadRequests(); await showDetail(result.referencia);
        }
      } catch (error) { feedback.textContent = global.UiPatterns?.messageFor(error) || error.message || 'No se pudo completar la operacion.'; } finally { restore(); }
    }

    async function loadRequests() {
      const data = await request(`/api/pagos-suscripcion/solicitudes?pagina=${state.page}&limite=10&orden=recientes`);
      state.requests = data.resultados || []; state.pages = data.paginacion?.paginas || 1;
      root.querySelector('[data-payment-requests]').innerHTML = state.requests.length ? state.requests.map(requestRow).join('') : '<p class="payment-empty">Todavía no tienes solicitudes de pago.</p>';
      root.querySelector('[data-payment-page]').textContent = `Página ${state.page} de ${state.pages}`;
      root.querySelector('[data-payment-previous]').disabled = state.page <= 1;
      root.querySelector('[data-payment-next]').disabled = state.page >= state.pages;
      root.querySelectorAll('[data-request-detail]').forEach((button) => button.addEventListener('click', () => { void showDetail(button.dataset.requestDetail); }));
    }

    function renderShell() {
      root.innerHTML = `<div class="payment-subscription-shell"><div class="payment-section-heading"><div><p class="subscription-eyebrow">Pagos manuales</p><h2>Renovar o cambiar plan</h2><p>Crear solicitud, realizar el pago, adjuntar comprobante y esperar la revision. No hay verificacion automatica.</p></div></div><ol class="payment-flow" aria-label="Pasos del pago manual"><li>Crear solicitud</li><li>Realizar pago</li><li>Adjuntar comprobante</li><li>Esperar revision</li></ol><form data-payment-form data-payment-action="quote" class="payment-config-form"><label><span>Plan</span><select name="plan" required></select></label><label><span>Operacion</span><select name="operacion" required></select></label><label><span>Periodo</span><select name="periodo" required></select></label><label><span>Metodo</span><select name="metodo" required></select></label><p data-payment-plan-description class="payment-muted"></p><div class="payment-form-actions"><button type="submit" class="button-link payment-primary">Cotizar</button><button type="button" class="button-link secondary" data-create-payment>Crear solicitud de pago</button></div></form><div data-payment-quote></div><p data-payment-feedback role="status" aria-live="polite"></p><section class="payment-request-list" aria-labelledby="payment-request-list-title"><div class="payment-section-heading"><h3 id="payment-request-list-title">Mis solicitudes</h3><div><button type="button" class="button-link" data-payment-previous>Anterior</button><span data-payment-page></span><button type="button" class="button-link" data-payment-next>Siguiente</button></div></div><div data-payment-requests></div></section><div data-payment-detail></div></div>`;
      const planSelect = root.querySelector('[name="plan"]');
      planSelect.replaceChildren(...state.plans.map((item) => Object.assign(document.createElement('option'), { value: item.referencia, textContent: item.nombre })));
      const methodSelect = root.querySelector('[name="metodo"]');
      methodSelect.replaceChildren(...state.methods.map((item) => Object.assign(document.createElement('option'), { value: item.referencia, textContent: item.nombre })));
      planSelect.addEventListener('change', renderPlanOptions);
      root.querySelector('[data-payment-form]').addEventListener('submit', quoteOrCreate);
      root.querySelector('[data-create-payment]').addEventListener('click', () => { const form = root.querySelector('[data-payment-form]'); form.dataset.paymentAction = 'create'; form.requestSubmit(); form.dataset.paymentAction = 'quote'; });
      root.querySelector('[data-payment-previous]').addEventListener('click', () => { if (state.page > 1) { state.page -= 1; void loadRequests(); } });
      root.querySelector('[data-payment-next]').addEventListener('click', () => { if (state.page < state.pages) { state.page += 1; void loadRequests(); } });
      renderPlanOptions();
    }

    async function render() {
      root.setAttribute('aria-busy', 'true'); root.innerHTML = '<p class="subscription-loading" role="status">Cargando pagos...</p>';
      try {
        const [plans, methods] = await Promise.all([request('/api/pagos-suscripcion/planes'), request('/api/pagos-suscripcion/metodos')]);
        state.plans = plans.planes || []; state.methods = methods.metodos || [];
        renderShell(); await loadRequests();
      } catch (error) { root.innerHTML = `<p class="payment-error" role="alert">${escapeHtml(error.message || 'No se pudieron cargar los pagos.')}</p>`; }
      finally { root.removeAttribute('aria-busy'); }
    }
    return Object.freeze({ render });
  }

  global.PaymentSubscriptionUI = Object.freeze({ create });
  function mount() {
    const root = global.document && global.document.getElementById('paymentSubscriptionRoot');
    if (!root || root.dataset.paymentMounted) return Boolean(root);
    root.dataset.paymentMounted = 'true';
    void create({ root }).render();
    return true;
  }
  if (global.document) {
    mount();
    // La pantalla de suscripción puede reconstruirse después de un cambio de plan.
    const observer = new MutationObserver(mount);
    observer.observe(global.document.documentElement, { childList: true, subtree: true });
  }
}(window));
