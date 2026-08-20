(function initializeSubscriptionUi(global) {
  'use strict';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function formatDate(value) {
    if (!value) return 'No aplica';
    const date = new Date(`${String(value).replace(' ', 'T')}-04:00`);
    if (Number.isNaN(date.getTime())) return 'No disponible';
    return new Intl.DateTimeFormat('es-BO', {
      dateStyle: 'medium',
      timeZone: 'America/La_Paz'
    }).format(date);
  }

  function label(value) {
    return String(value || 'no disponible').replaceAll('_', ' ');
  }

  const STATUS_LABELS = Object.freeze({
    prueba: 'Prueba gratuita', activa: 'Activa', gracia: 'Periodo de gracia',
    suspendida: 'Suspendida', cancelada: 'Cancelada', pendiente: 'Pendiente',
    completo: 'Acceso completo', solo_lectura: 'Solo lectura', restringido: 'Acceso restringido',
    upgrade: 'Cambio inmediato', downgrade: 'Cambio proximo periodo',
    mismo_plan: 'Plan actual', cambio_invalido: 'No disponible'
  });

  const FEATURE_LABELS = Object.freeze({
    ventas: 'Ventas', inventario: 'Inventario', productos: 'Productos', clientes: 'Clientes',
    proveedores: 'Proveedores', compras: 'Compras', punto_venta: 'Punto de venta',
    reportes_financieros: 'Reportes financieros', exportaciones: 'Exportaciones',
    rentabilidad_producto: 'Rentabilidad por producto', rotacion_inventario: 'Rotacion de inventario',
    recordatorios_fiado: 'Mensajes preparados de cobranza'
  });

  function statusLabel(value) { return STATUS_LABELS[value] || label(value); }
  function featureLabel(value) { return FEATURE_LABELS[value] || label(value); }

  function create({ root, api = null, navigate = (path) => { global.location.href = path; } } = {}) {
    if (!root) throw new Error('El contenedor de suscripcion es obligatorio.');
    const viewedPlans = new Set();

    function trackPlanViewed(data) {
      const plan = data?.plan?.codigo;
      if (!['basico', 'standard', 'pro'].includes(plan) || viewedPlans.has(plan)) return;
      viewedPlans.add(plan);
      global.ProductAnalytics?.track('plan_viewed', { module: 'subscription', plan });
    }

    async function request(url, options = {}) {
      if (api) return api(url, options);
      const response = await global.SecurityHttp.secureFetch(url, options);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401) navigate('/login.html');
        throw global.SecurityHttp.errorFromResponse(response, body, 'No se pudo consultar la suscripcion.');
      }
      return body;
    }

    function operationKey() {
      return `plan-change:${global.crypto.randomUUID()}`;
    }

    async function logout() {
      try {
        await request('/auth/logout', { method: 'POST', body: JSON.stringify({}) });
      } finally {
        navigate('/login.html');
      }
    }

    function metric(labelText, limit, usage) {
      const visibleLimit = limit === null || limit === undefined ? 'Sin limite' : String(limit);
      return `<article class="subscription-metric"><span>${escapeHtml(labelText)}</span><strong>${escapeHtml(usage ?? 0)} / ${escapeHtml(visibleLimit)}</strong></article>`;
    }

    function planChoices(data) {
      if (!data || !Array.isArray(data.planes)) return '';
      const scheduled = data.planProgramado
        ? `<p class="subscription-plan-scheduled" role="status">Cambio programado a <strong>${escapeHtml(data.planProgramado.nombre)}</strong> para ${escapeHtml(formatDate(data.planProgramado.fechaAplicacion))}.</p>`
        : '';
      const choices = data.planes.filter((plan) => plan.codigo !== 'avanzado').map((plan) => {
        const action = plan.tipoCambio === 'upgrade' ? 'upgrade'
          : (plan.tipoCambio === 'downgrade' ? 'downgrade' : null);
        const exceeded = Object.entries(plan.disponibilidad || {})
          .filter(([, value]) => value.excedido)
          .map(([key]) => label(key));
        const message = plan.tipoCambio === 'upgrade'
          ? 'Se aplica inmediatamente y conserva la fecha de finalizacion actual.'
          : (plan.tipoCambio === 'downgrade'
            ? 'Se aplicara en el siguiente periodo. Tus datos no se eliminaran.'
            : (plan.tipoCambio === 'mismo_plan' ? 'Este es tu plan actual.' : 'Este cambio combina ampliaciones y reducciones y no esta disponible.'));
        return `<article class="subscription-plan" data-plan-code="${escapeHtml(plan.codigo)}">
          <header><h3>${escapeHtml(plan.nombre)}</h3><strong>${escapeHtml(statusLabel(plan.tipoCambio))}</strong></header>
          <p>${escapeHtml(plan.descripcion || message)}</p>
          <p class="subscription-plan-help">${escapeHtml(message)}</p>
          ${exceeded.length ? `<p class="subscription-plan-excess">Limites excedidos: ${escapeHtml(exceeded.join(', '))}. Se conservaran los datos y se bloquearan nuevas altas.</p>` : ''}
          <button type="button" data-plan-action="${escapeHtml(action || '')}" data-plan-code="${escapeHtml(plan.codigo)}" ${action ? '' : 'disabled'}>${action === 'upgrade' ? `Cambiar a ${escapeHtml(plan.nombre)}` : (action === 'downgrade' ? 'Programar cambio' : 'No disponible')}</button>
        </article>`;
      }).join('');
      return `<section class="subscription-section" aria-labelledby="subscription-plans-title">
        <h2 id="subscription-plans-title">Planes disponibles</h2>
        ${scheduled}
        <div class="subscription-plans">${choices}</div>
        <p data-plan-feedback role="status" aria-live="polite"></p>
      </section>`;
    }

    function bindPlanActions() {
      root.querySelectorAll('[data-plan-action]:not([disabled])').forEach((button) => {
        button.addEventListener('click', async () => {
          const action = button.dataset.planAction;
          const feedback = root.querySelector('[data-plan-feedback]');
          const key = button.dataset.operationKey || operationKey();
          button.dataset.operationKey = key;
          button.disabled = true;
          feedback.textContent = action === 'upgrade' ? 'Aplicando cambio...' : 'Programando cambio...';
          try {
            const result = await request(`/api/suscripcion/${action}`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': key
              },
              body: JSON.stringify({ codigoPlan: button.dataset.planCode })
            });
            feedback.textContent = action === 'upgrade'
              ? 'El plan se actualizo correctamente.'
              : `El cambio quedo programado para ${formatDate(result.fechaAplicacion)}.`;
            await render();
          } catch (error) {
            feedback.textContent = error.message || 'No se pudo cambiar el plan.';
            button.disabled = false;
          }
        });
      });
    }

    function renderData(data, plans = null) {
      const access = data.acceso || {};
      const restricted = access.nivel === 'restringido';
      const grace = access.nivel === 'solo_lectura';
      const visibleStatus = data.estadoEfectivo === 'activa' && data.tipo === 'prueba'
        ? 'prueba'
        : data.estadoEfectivo;
      const relevantDate = grace && data.fechaFinGracia
        ? { label: 'Fin de gracia', value: data.fechaFinGracia }
        : { label: 'Fin de vigencia', value: data.fechaFin };
      const graceRow = data.fechaFinGracia
        ? `<div><dt>Fin del periodo de gracia</dt><dd>${escapeHtml(formatDate(data.fechaFinGracia))}</dd></div>`
        : '';
      const featureItems = Array.isArray(data.funcionalidades) ? data.funcionalidades : [];
      const visibleFeatures = featureItems.slice(0, 6);
      const remainingFeatures = featureItems.slice(6);
      const features = visibleFeatures.length
        ? visibleFeatures.map((feature) => `<li>${escapeHtml(featureLabel(feature))}</li>`).join('')
        : '<li>No hay funcionalidades visibles.</li>';
      const featureDetail = remainingFeatures.length
        ? `<details class="subscription-feature-detail"><summary>Ver todas las funcionalidades (${escapeHtml(remainingFeatures.length + visibleFeatures.length)})</summary><ul>${remainingFeatures.map((feature) => `<li>${escapeHtml(featureLabel(feature))}</li>`).join('')}</ul></details>`
        : '';
      root.innerHTML = `
        <div class="subscription-shell" data-subscription-view data-access="${escapeHtml(access.nivel)}">
          <header class="subscription-heading">
            <div>
              <p class="subscription-eyebrow">Mi plan</p>
              <h1>${escapeHtml(data.plan?.nombre || 'Sin plan asignado')}</h1>
              <p>${escapeHtml(access.mensaje || 'Consulta el estado de tu suscripcion.')}</p>
            </div>
            <span class="subscription-status" data-status="${escapeHtml(visibleStatus)}">${escapeHtml(statusLabel(visibleStatus))}</span>
          </header>
          <section class="subscription-overview" aria-label="Resumen de mi plan">
            <article><span>Plan actual</span><strong>${escapeHtml(data.plan?.nombre || 'Sin plan asignado')}</strong></article>
            <article><span>Estado</span><strong>${escapeHtml(statusLabel(visibleStatus))}</strong></article>
            <article><span>${escapeHtml(relevantDate.label)}</span><strong>${escapeHtml(formatDate(relevantDate.value))}</strong></article>
          </section>
          ${grace ? '<div class="subscription-notice" role="status"><strong>Periodo de gracia: solo lectura</strong><span>Puedes consultar la informacion permitida y gestionar tu suscripcion, pero no registrar operaciones comerciales.</span></div>' : ''}
          ${restricted ? '<div class="subscription-notice subscription-notice-critical" role="status"><strong>Acceso comercial restringido</strong><span>Tus datos permanecen conservados. Consulta esta pagina para conocer la siguiente accion permitida.</span></div>' : ''}
          <section class="subscription-section" aria-labelledby="subscription-period-title">
            <h2 id="subscription-period-title">Periodo actual</h2>
            <dl class="subscription-details">
              <div><dt>Tipo</dt><dd>${escapeHtml(statusLabel(data.tipo))}</dd></div>
              <div><dt>Periodo</dt><dd>${escapeHtml(statusLabel(data.periodo?.tipo))}</dd></div>
              <div><dt>Inicio</dt><dd>${escapeHtml(formatDate(data.fechaInicio))}</dd></div>
              <div><dt>Fin</dt><dd>${escapeHtml(formatDate(data.fechaFin))}</dd></div>
              ${graceRow}
              <div><dt>Acceso</dt><dd>${escapeHtml(statusLabel(access.nivel))}</dd></div>
            </dl>
          </section>
          <section class="subscription-section" aria-labelledby="subscription-limits-title">
            <h2 id="subscription-limits-title">Limites y uso</h2>
            <div class="subscription-metrics">
              ${metric('Propietarios', data.limites?.propietarios, data.uso?.propietarios)}
              ${metric('Productos', data.limites?.productos, data.uso?.productos)}
              ${metric('Clientes', data.limites?.clientes, data.uso?.clientes)}
              ${metric('Proveedores', data.limites?.proveedores, data.uso?.proveedores)}
            </div>
          </section>
          <section class="subscription-section" aria-labelledby="subscription-features-title">
            <h2 id="subscription-features-title">Funcionalidades incluidas</h2>
            <ul class="subscription-features">${features}</ul>
            ${featureDetail}
          </section>
          ${planChoices(plans)}
          <section id="paymentSubscriptionRoot" class="subscription-section payment-subscription-section" aria-live="polite"></section>
          <div class="subscription-actions">
            ${restricted ? '' : '<a class="button-link secondary" href="/app.html" data-subscription-panel>Volver al panel</a>'}
            <a class="button-link secondary" href="/app.html?help=mi-plan">Ayuda sobre Mi plan</a>
            <span id="future-action-help">Usa el flujo de pagos manuales para renovar o reactivar cuando tu estado lo permita.</span>
            <button type="button" class="secondary" data-subscription-logout>Cerrar sesion</button>
          </div>
        </div>`;
      root.querySelector('[data-subscription-logout]').addEventListener('click', () => { void logout(); });
      bindPlanActions();
      trackPlanViewed(data);
    }

    async function render() {
      root.setAttribute('aria-busy', 'true');
      root.innerHTML = '<p class="subscription-loading" role="status">Cargando suscripcion...</p>';
      try {
        const data = await request('/api/suscripcion');
        const plans = data.acceso?.nivel === 'completo'
          ? await request('/api/suscripcion/planes')
          : null;
        renderData(data, plans);
      } catch (error) {
        root.innerHTML = `<section class="subscription-error" role="alert"><h1>No se pudo cargar la suscripcion</h1><p>${escapeHtml(error.message || 'Intenta nuevamente.')}</p><button type="button" data-subscription-retry>Reintentar</button><button type="button" class="secondary" data-subscription-logout>Cerrar sesion</button></section>`;
        root.querySelector('[data-subscription-retry]').addEventListener('click', () => { void render(); });
        root.querySelector('[data-subscription-logout]').addEventListener('click', () => { void logout(); });
      } finally {
        root.removeAttribute('aria-busy');
      }
    }

    return Object.freeze({ render });
  }

  global.SubscriptionUI = Object.freeze({ create });
  const root = global.document && global.document.getElementById('subscriptionRoot');
  if (root) void create({ root }).render();
}(window));
