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

  function create({ root, api = null, navigate = (path) => { global.location.href = path; } } = {}) {
    if (!root) throw new Error('El contenedor de suscripcion es obligatorio.');

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

    function renderData(data) {
      const access = data.acceso || {};
      const restricted = access.nivel === 'restringido';
      const grace = access.nivel === 'solo_lectura';
      const visibleStatus = data.estadoEfectivo === 'activa' && data.tipo === 'prueba'
        ? 'prueba'
        : data.estadoEfectivo;
      const graceRow = data.fechaFinGracia
        ? `<div><dt>Fin del periodo de gracia</dt><dd>${escapeHtml(formatDate(data.fechaFinGracia))}</dd></div>`
        : '';
      const features = Array.isArray(data.funcionalidades) && data.funcionalidades.length
        ? data.funcionalidades.map((feature) => `<li>${escapeHtml(label(feature))}</li>`).join('')
        : '<li>No hay funcionalidades visibles.</li>';
      root.innerHTML = `
        <div class="subscription-shell" data-subscription-view data-access="${escapeHtml(access.nivel)}">
          <header class="subscription-heading">
            <div>
              <p class="subscription-eyebrow">Mi suscripcion</p>
              <h1>${escapeHtml(data.plan?.nombre || 'Sin plan asignado')}</h1>
              <p>${escapeHtml(access.mensaje || 'Consulta el estado de tu suscripcion.')}</p>
            </div>
            <span class="subscription-status" data-status="${escapeHtml(visibleStatus)}">${escapeHtml(label(visibleStatus))}</span>
          </header>
          ${grace ? '<div class="subscription-notice" role="status"><strong>Modo de solo lectura</strong><span>No puedes registrar ni modificar operaciones durante la gracia.</span></div>' : ''}
          ${restricted ? '<div class="subscription-notice subscription-notice-critical" role="status"><strong>Acceso comercial restringido</strong><span>Tus datos permanecen conservados.</span></div>' : ''}
          <section class="subscription-section" aria-labelledby="subscription-period-title">
            <h2 id="subscription-period-title">Periodo actual</h2>
            <dl class="subscription-details">
              <div><dt>Tipo</dt><dd>${escapeHtml(label(data.tipo))}</dd></div>
              <div><dt>Periodo</dt><dd>${escapeHtml(label(data.periodo?.tipo))}</dd></div>
              <div><dt>Inicio</dt><dd>${escapeHtml(formatDate(data.fechaInicio))}</dd></div>
              <div><dt>Fin</dt><dd>${escapeHtml(formatDate(data.fechaFin))}</dd></div>
              ${graceRow}
              <div><dt>Acceso</dt><dd>${escapeHtml(label(access.nivel))}</dd></div>
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
          </section>
          <div class="subscription-actions">
            ${restricted ? '' : '<a class="button-link secondary" href="/app.html" data-subscription-panel>Volver al panel</a>'}
            <button type="button" disabled aria-describedby="future-action-help">${data.puedeReactivar ? 'Reactivar' : 'Renovar'}: proximamente</button>
            <span id="future-action-help">La accion estara disponible en una proxima etapa.</span>
            <button type="button" class="secondary" data-subscription-logout>Cerrar sesion</button>
          </div>
        </div>`;
      root.querySelector('[data-subscription-logout]').addEventListener('click', () => { void logout(); });
    }

    async function render() {
      root.setAttribute('aria-busy', 'true');
      root.innerHTML = '<p class="subscription-loading" role="status">Cargando suscripcion...</p>';
      try {
        renderData(await request('/api/suscripcion'));
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
