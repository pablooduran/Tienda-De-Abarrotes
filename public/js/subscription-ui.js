(function initializeSubscriptionUi(global) {
  'use strict';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function formatDate(value) {
    if (!value) return 'Sin fecha registrada';
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
    upgrade: 'Después de confirmar el pago', downgrade: 'Cambio próximo periodo',
    mismo_plan: 'Plan actual', cambio_invalido: 'No disponible'
  });

  const FEATURE_LABELS = Object.freeze({
    ajuste_stock: 'Ajustes protegidos de stock', alertas_stock: 'Alertas de stock',
    alertas_vencimiento: 'Alertas de vencimiento', anulaciones_operativas: 'Anulaciones y devoluciones protegidas',
    catalogo_maestro: 'Catálogo guiado de productos', cierre_caja: 'Cierre de caja',
    clientes_basico: 'Clientes', compras_sugeridas: 'Compras sugeridas', control_lotes: 'Control de lotes',
    dashboard_financiero: 'Resumen financiero', dias_cobertura: 'Días de cobertura',
    equipo_colaborativo: 'Equipo y permisos para tu personal',
    estado_cuenta_basico: 'Estado de cuenta de clientes', exportacion_clientes_fiados: 'Exportación de clientes y fiados',
    exportacion_inventario: 'Exportación de inventario', exportacion_lotes: 'Exportación de lotes',
    exportacion_reportes: 'Exportación de reportes', fiados_basico: 'Ventas a crédito y fiados',
    gastos: 'Registro de gastos', historial_stock: 'Historial de stock',
    inventario_resumen: 'Resumen de inventario', inventario_sin_movimiento: 'Productos sin movimiento',
    limites_credito: 'Límites y plazos de crédito', pagos_fiado: 'Cobranza de fiados',
    pagos_multiples: 'Pagos en efectivo, QR o combinados', punto_venta: 'Punto de venta',
    ranking_productos: 'Ranking de productos', portal_clientes: 'Tienda online con catálogo público', recibos_whatsapp: 'Comprobantes para compartir por WhatsApp',
    recordatorios_fiado: 'Mensajes preparados de cobranza', rentabilidad_producto: 'Rentabilidad por producto',
    reportes_financieros: 'Reportes financieros', rotacion_inventario: 'Rotación de inventario',
    segmentacion_clientes: 'Segmentación de clientes', seguimiento_cobranza: 'Seguimiento de cobranza',
    trazabilidad_lotes: 'Trazabilidad de lotes', valor_inventario_basico: 'Valoración de inventario',
    vencimientos_lote: 'Vencimientos por lote'
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
      const numericLimit = Number(limit);
      const numericUsage = Number(usage || 0);
      const percentage = Number.isFinite(numericLimit) && numericLimit > 0
        ? Math.min(100, Math.max(0, (numericUsage / numericLimit) * 100))
        : null;
      return `<article class="subscription-metric"><span>${escapeHtml(labelText)}</span><strong>${escapeHtml(usage ?? 0)} / ${escapeHtml(visibleLimit)}</strong>${percentage === null ? '<small>Capacidad ilimitada</small>' : `<div class="subscription-usage-bar" role="progressbar" aria-label="${escapeHtml(labelText)}" aria-valuemin="0" aria-valuemax="${escapeHtml(limit)}" aria-valuenow="${escapeHtml(usage ?? 0)}"><span style="width:${percentage.toFixed(2)}%"></span></div>`}</article>`;
    }

    function planChoices(data, paymentPlans = null) {
      if (!data || !Array.isArray(data.planes)) return '';
      const scheduled = data.planProgramado
        ? `<p class="subscription-plan-scheduled" role="status">Cambio programado a <strong>${escapeHtml(data.planProgramado.nombre)}</strong> para ${escapeHtml(formatDate(data.planProgramado.fechaAplicacion))}.</p>`
        : '';
      const visiblePlans = data.planes.filter((plan) => plan.codigo !== 'avanzado');
      const choices = visiblePlans.map((plan, index) => {
        const paymentPlan = paymentPlans?.planes?.find((item) => item.referencia === plan.codigo);
        const payable = paymentPlan?.operacionesDisponibles?.includes('upgrade');
        const action = plan.tipoCambio === 'upgrade' && payable ? 'payment'
          : (plan.tipoCambio === 'downgrade' ? 'downgrade' : null);
        const monthly = paymentPlan?.periodos?.find((item) => item.periodo === 'mensual');
        const startingPrice = monthly ? `<p class="subscription-plan-price">Desde <strong>USD ${escapeHtml(monthly.monto)}</strong> al mes</p>` : '';
        const exceeded = Object.entries(plan.disponibilidad || {})
          .filter(([, value]) => value.excedido)
          .map(([key]) => label(key));
        const planFeatures = Array.isArray(plan.funcionalidades) ? plan.funcionalidades : [];
        const previousPlan = visiblePlans[index - 1];
        const previousFeatures = new Set(Array.isArray(previousPlan?.funcionalidades) ? previousPlan.funcionalidades : []);
        const additionalFeatures = previousPlan
          ? planFeatures.filter((feature) => !previousFeatures.has(feature))
          : planFeatures;
        const inheritance = previousPlan
          ? `Incluye lo de ${previousPlan.nombre} y agrega:`
          : 'Incluye lo esencial para comenzar:';
        const featureItems = additionalFeatures.length
          ? additionalFeatures.map((feature) => `<li>${escapeHtml(featureLabel(feature))}</li>`).join('')
          : '<li>Consulta el detalle de funciones disponibles.</li>';
        const limits = Object.entries(plan.limites || {}).slice(0, 4).map(([key, value]) => `<span><strong>${escapeHtml(value === null ? 'Ilimitado' : value)}</strong> ${escapeHtml(label(key))}</span>`).join('');
        const message = plan.tipoCambio === 'upgrade'
          ? 'Puedes solicitar este plan. Se aplicará después de verificar el pago.'
          : (plan.tipoCambio === 'downgrade'
            ? 'Se aplicara en el siguiente periodo. Tus datos no se eliminaran.'
            : (plan.tipoCambio === 'mismo_plan' ? 'Este es tu plan actual.' : 'Este cambio combina ampliaciones y reducciones y no esta disponible.'));
        return `<article class="subscription-plan ${plan.tipoCambio === 'mismo_plan' ? 'subscription-plan-current' : ''}" data-plan-code="${escapeHtml(plan.codigo)}">
          <header><div><p class="subscription-plan-kicker">${plan.tipoCambio === 'mismo_plan' ? 'Tu plan actual' : 'Plan disponible'}</p><h3>${escapeHtml(plan.nombre)}</h3></div><strong>${escapeHtml(statusLabel(plan.tipoCambio))}</strong></header>
          <p>${escapeHtml(plan.descripcion || message)}</p>
          ${startingPrice}
          <div class="subscription-plan-limits" aria-label="Limites del plan">${limits || '<span>Consulta las funciones incluidas</span>'}</div>
          <div class="subscription-plan-features"><strong>${escapeHtml(inheritance)}</strong><ul>${featureItems}</ul></div>
          <p class="subscription-plan-help">${escapeHtml(message)}</p>
          ${exceeded.length ? `<p class="subscription-plan-excess">Limites excedidos: ${escapeHtml(exceeded.join(', '))}. Se conservaran los datos y se bloquearan nuevas altas.</p>` : ''}
          <button type="button" data-plan-action="${escapeHtml(action || '')}" data-plan-code="${escapeHtml(plan.codigo)}" ${action ? '' : 'disabled'}>${action === 'payment' ? `Mejorar a ${escapeHtml(plan.nombre)}` : (action === 'downgrade' ? `Cambiar a ${escapeHtml(plan.nombre)}` : (plan.tipoCambio === 'mismo_plan' ? 'Plan actual' : 'Cambio no permitido'))}</button>
        </article>`;
      }).join('');
      return `<section class="subscription-section" aria-labelledby="subscription-plans-title">
        <h2 id="subscription-plans-title">Elige el plan que necesitas</h2>
        <p class="subscription-section-intro">Cada plan incluye lo anterior y suma más capacidad o herramientas. Puedes cambiarlo cuando lo necesites.</p>
        ${paymentPlans ? '' : '<p class="subscription-plan-excess" role="status">No pudimos cargar los precios. Actualiza la página antes de elegir un plan.</p>'}
        ${scheduled}
        <div class="subscription-plans">${choices}</div>
        <p data-plan-feedback role="status" aria-live="polite"></p>
      </section>`;
    }

    function checkoutScreen(data, plans, paymentPlans, code) {
      const plan = plans?.planes?.find((item) => item.codigo === code);
      const paymentPlan = paymentPlans?.planes?.find((item) => item.referencia === code);
      if (!plan || !paymentPlan?.operacionesDisponibles?.includes('upgrade')) return false;
      const features = Array.isArray(plan.funcionalidades) ? plan.funcionalidades : [];
      const periods = (paymentPlan.periodos || []).map((item) => `<article class="subscription-checkout-period"><strong>${escapeHtml(item.periodo[0].toUpperCase() + item.periodo.slice(1))}</strong><span>USD ${escapeHtml(item.monto)}</span><small>${escapeHtml(item.meses)} ${Number(item.meses) === 1 ? 'mes' : 'meses'}</small></article>`).join('');
      root.innerHTML = `<div class="subscription-shell subscription-checkout-shell"><header class="subscription-heading subscription-current-card"><div><a class="button-link secondary subscription-back-link" href="/subscription.html">← Volver a planes</a><p class="subscription-eyebrow">Mejorar plan</p><div class="subscription-title-row"><h1>${escapeHtml(plan.nombre)}</h1><span class="subscription-status" data-status="activa">Plan seleccionado</span></div><p>${escapeHtml(plan.descripcion || 'Revisa las funciones y elige el periodo de pago.')}</p></div></header><section class="subscription-checkout-overview"><article><h2>Lo que incluye</h2><ul class="subscription-features">${features.map((feature) => `<li>${escapeHtml(featureLabel(feature))}</li>`).join('') || '<li>Consulta las funciones disponibles al solicitar el plan.</li>'}</ul></article><article><h2>Periodos disponibles</h2><div class="subscription-checkout-periods">${periods}</div></article></section><section id="paymentSubscriptionRoot" class="subscription-section payment-subscription-section subscription-checkout-payment" aria-live="polite"></section></div>`;
      return true;
    }

    function bindPlanActions() {
      root.querySelectorAll('[data-plan-action]:not([disabled])').forEach((button) => {
        button.addEventListener('click', async () => {
          const action = button.dataset.planAction;
          if (action === 'payment') {
            navigate(`/subscription.html?checkout=${encodeURIComponent(button.dataset.planCode)}`);
            return;
          }
          const feedback = root.querySelector('[data-plan-feedback]');
          if (action === 'downgrade' && !global.confirm('El cambio se aplicará en el próximo periodo. Tus datos se conservarán y no se eliminarán. ¿Deseas continuar?')) return;
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

    function renderData(data, plans = null, paymentPlans = null) {
      const checkoutPlan = new URLSearchParams(global.location.search).get('checkout');
      if (checkoutPlan && checkoutScreen(data, plans, paymentPlans, checkoutPlan)) return;
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
      const features = featureItems.length
        ? featureItems.map((feature) => `<li>${escapeHtml(featureLabel(feature))}</li>`).join('')
        : '<li>No hay funcionalidades visibles.</li>';
      root.innerHTML = `
        <div class="subscription-shell" data-subscription-view data-access="${escapeHtml(access.nivel)}">
          <header class="subscription-heading subscription-current-card">
            <div>
              <p class="subscription-eyebrow">Mi plan</p>
              <div class="subscription-title-row"><h1>${escapeHtml(data.plan?.nombre || 'Sin plan asignado')}</h1><span class="subscription-status" data-status="${escapeHtml(visibleStatus)}">${escapeHtml(statusLabel(visibleStatus))}</span></div>
              <p>${escapeHtml(access.mensaje || 'Consulta el estado de tu suscripcion.')}</p>
              <dl class="subscription-current-meta">
                <div><dt>${escapeHtml(relevantDate.label)}</dt><dd>${escapeHtml(formatDate(relevantDate.value))}</dd></div>
                <div><dt>Periodo</dt><dd>${escapeHtml(statusLabel(data.periodo?.tipo))}</dd></div>
                <div><dt>Acceso</dt><dd>${escapeHtml(statusLabel(access.nivel))}</dd></div>
              </dl>
            </div>
            <div class="subscription-heading-actions">
              ${restricted ? '' : '<a class="button-link secondary subscription-back-link" href="/app.html" data-subscription-panel>← Volver al panel</a>'}
            </div>
          </header>
          ${grace ? '<div class="subscription-notice" role="status"><strong>Periodo de gracia: solo lectura</strong><span>Puedes consultar la informacion permitida y gestionar tu suscripcion, pero no registrar operaciones comerciales.</span></div>' : ''}
          ${restricted ? '<div class="subscription-notice subscription-notice-critical" role="status"><strong>Acceso comercial restringido</strong><span>Tus datos permanecen conservados. Consulta esta pagina para conocer la siguiente accion permitida.</span></div>' : ''}
          <div class="subscription-disclosures">
            <details class="subscription-section subscription-disclosure"><summary><span><strong>Ver uso de tu plan</strong><small>Consulta cuánto estás utilizando y cuánto queda disponible.</small></span></summary><div class="subscription-metrics">${metric('Propietarios', data.limites?.propietarios, data.uso?.propietarios)}${metric('Productos', data.limites?.productos, data.uso?.productos)}${metric('Clientes', data.limites?.clientes, data.uso?.clientes)}${metric('Proveedores', data.limites?.proveedores, data.uso?.proveedores)}</div></details>
            <details class="subscription-section subscription-disclosure"><summary><span><strong>Ver lo que incluye tu plan</strong><small>${escapeHtml(featureItems.length)} funciones disponibles.</small></span></summary><ul class="subscription-features">${features}</ul></details>
            <details class="subscription-section subscription-disclosure"><summary><span><strong>Periodo y acceso</strong><small>Fechas y condiciones del periodo actual.</small></span></summary><dl class="subscription-details"><div><dt>Tipo</dt><dd>${escapeHtml(statusLabel(data.tipo))}</dd></div><div><dt>Inicio</dt><dd>${escapeHtml(formatDate(data.fechaInicio))}</dd></div><div><dt>Fin</dt><dd>${escapeHtml(formatDate(data.fechaFin))}</dd></div>${graceRow}<div><dt>Acceso</dt><dd>${escapeHtml(statusLabel(access.nivel))}</dd></div></dl></details>
          </div>
          ${planChoices(plans, paymentPlans)}
          <section id="paymentSubscriptionRoot" class="subscription-section payment-subscription-section" aria-live="polite"></section>
          <div class="subscription-actions">
            <a class="button-link secondary" href="/app.html?help=mi-plan">Ayuda sobre Mi plan</a>
            <span id="future-action-help">Usa el flujo de pagos manuales para renovar o reactivar cuando tu estado lo permita.</span>
            <button type="button" class="secondary" data-subscription-logout>Cerrar sesion</button>
          </div>
        </div>`;
      root.querySelector('[data-subscription-logout]').addEventListener('click', () => { void logout(); });
      root.querySelectorAll('.subscription-disclosure').forEach((disclosure) => {
        disclosure.addEventListener('toggle', () => {
          if (!disclosure.open) return;
          root.querySelectorAll('.subscription-disclosure[open]').forEach((other) => {
            if (other !== disclosure) other.open = false;
          });
        });
      });
      bindPlanActions();
      trackPlanViewed(data);
    }

    async function render() {
      root.setAttribute('aria-busy', 'true');
      root.innerHTML = '<p class="subscription-loading" role="status">Cargando suscripcion...</p>';
      try {
        const data = await request('/api/suscripcion');
        const [plans, paymentPlans] = data.acceso?.nivel === 'completo'
          ? await Promise.all([
            request('/api/suscripcion/planes'),
            request('/api/pagos-suscripcion/planes').catch(() => null)
          ])
          : [null, null];
        renderData(data, plans, paymentPlans);
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
