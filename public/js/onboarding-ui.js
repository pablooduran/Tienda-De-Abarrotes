(function initializeOnboardingUi(global) {
  'use strict';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function errorFromResponse(response, body) {
    if (global.SecurityHttp?.errorFromResponse) {
      return global.SecurityHttp.errorFromResponse(response, body, 'No se pudo actualizar la configuracion.');
    }
    return new Error(body?.error || 'No se pudo actualizar la configuracion.');
  }

  function create({
    root,
    api = null,
    navigate = (path) => { global.location.href = path; }
  } = {}) {
    if (!root) throw new Error('El contenedor de onboarding es obligatorio.');
    let current = null;
    let submitting = false;

    async function request(url, options = {}) {
      if (api) return api(url, options);
      const response = await global.SecurityHttp.secureFetch(url, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401) navigate('/login.html');
        throw errorFromResponse(response, body);
      }
      return body;
    }

    function bodyFrom(form) {
      const raw = Object.fromEntries(new FormData(form).entries());
      return {
        nombreMostrado: raw.nombreMostrado,
        moneda: raw.moneda,
        telefono: raw.telefono,
        direccion: raw.direccion
      };
    }

    function renderCompleted(data) {
      root.innerHTML = `
        <section class="onboarding-shell onboarding-shell-completed">
          ${brandPanel()}
          <div class="onboarding-card onboarding-completed" data-onboarding-completed>
            <span class="onboarding-success-icon" aria-hidden="true">✓</span>
            <p class="onboarding-eyebrow">Configuración completada</p>
            <h1>Tu tienda está lista</h1>
            <p>Ya puedes registrar productos, ventas y movimientos desde el panel principal.</p>
            <div class="onboarding-completed-actions"><button type="button" data-onboarding-panel>Ir al panel principal</button><button type="button" class="onboarding-logout" data-onboarding-logout><span aria-hidden="true">↪</span> Cerrar sesión</button></div>
          </div>
        </section>`;
      root.querySelector('[data-onboarding-panel]').addEventListener('click', () => navigate('/app.html'));
      wireLogout();
    }

    function brandPanel() {
      return `<aside class="onboarding-brand" aria-label="Administrau">
        <div class="onboarding-brand-name"><img src="/assets/administrau-icon.png" alt=""><div><span>ADMINISTRAU</span><strong>Tu negocio, más claro cada día</strong></div></div>
        <img class="onboarding-brand-art" src="/assets/administrau-growth.png" alt="" aria-hidden="true">
        <div class="onboarding-brand-copy"><p class="onboarding-eyebrow">Empecemos con lo esencial</p><h2>Configura tu tienda en un momento</h2><p>Estos datos organizan tu espacio y ayudan a que los reportes, ventas y comprobantes se muestren correctamente.</p></div>
        <ul class="onboarding-benefits"><li><span>1</span> Identifica tu negocio</li><li><span>2</span> Define cómo contactarte</li><li><span>3</span> Empieza a vender</li></ul>
      </aside>`;
    }

    function renderForm(data, announcement = '') {
      const config = data.configuracion || {};
      const progress = Number(data.progreso || 0);
      root.innerHTML = `
        <section class="onboarding-shell">
          ${brandPanel()}
          <div class="onboarding-card" data-onboarding-screen>
            <header class="onboarding-heading">
              <p class="onboarding-eyebrow">Configuración inicial</p>
              <h1>Prepara tu tienda</h1>
              <p>Completa los datos básicos. Podrás modificarlos después desde Configuración.</p>
            </header>
            <div class="onboarding-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}">
              <span>Tu avance</span><strong>${progress}%</strong><progress value="${progress}" max="100">${progress}%</progress>
            </div>
            <form data-onboarding-form novalidate>
              <div class="onboarding-grid">
                <label class="onboarding-field-wide">Nombre de la tienda<small>El nombre que verás en el panel.</small><input name="nombreMostrado" maxlength="120" required placeholder="Ej.: Abarrotes La Esquina" value="${escapeHtml(config.nombreMostrado)}"></label>
                <label>Teléfono<small>Solo números, sin espacios.</small><input name="telefono" maxlength="30" required autocomplete="tel" inputmode="tel" placeholder="Ej.: 70000000" value="${escapeHtml(config.telefono)}"></label>
                <label>Moneda<small>Se usará en precios y reportes.</small><select name="moneda" required><option value="BOB" ${config.moneda === 'BOB' ? 'selected' : ''}>Bolivianos (BOB)</option></select></label>
                <label class="onboarding-field-wide">Dirección <small>Opcional · ayuda a identificar tu sucursal.</small><textarea name="direccion" maxlength="255" rows="3" placeholder="Zona, calle o referencia">${escapeHtml(config.direccion)}</textarea></label>
              </div>
              <p class="onboarding-message" data-onboarding-message role="status" aria-live="polite">${escapeHtml(announcement)}</p>
              <p class="onboarding-message error" data-onboarding-error role="alert" aria-live="assertive"></p>
              <div class="onboarding-actions">
                <button type="button" class="onboarding-logout" data-onboarding-logout><span aria-hidden="true">↪</span> Cerrar sesión</button>
                <button type="submit" data-onboarding-complete>Guardar y entrar a mi tienda <span aria-hidden="true">→</span></button>
              </div>
            </form>
          </div>
        </section>`;
      const form = root.querySelector('[data-onboarding-form]');
      const error = root.querySelector('[data-onboarding-error]');
      const complete = async () => {
        if (submitting) return;
        submitting = true;
        const payload = bodyFrom(form);
        const controls = root.querySelectorAll('button, input, select, textarea');
        controls.forEach((control) => { control.disabled = true; });
        root.querySelector('[data-onboarding-screen]').setAttribute('aria-busy', 'true');
        error.textContent = '';
        try {
          current = await request('/onboarding/completar', { method: 'POST', body: JSON.stringify(payload) });
          renderCompleted(current);
          return;
        } catch (requestError) {
          error.textContent = requestError.message || 'No se pudo guardar la configuracion.';
          controls.forEach((control) => { control.disabled = false; });
          root.querySelector('[data-onboarding-screen]').removeAttribute('aria-busy');
        } finally {
          submitting = false;
        }
      };
      form.addEventListener('submit', (event) => { event.preventDefault(); void complete(); });
      wireLogout();
    }

    function wireLogout() {
      root.querySelector('[data-onboarding-logout]')?.addEventListener('click', async () => {
        try { await request('/auth/logout', { method: 'POST', body: JSON.stringify({}) }); } finally { navigate('/login.html'); }
      });
    }

    async function render() {
      try {
        current = await request('/onboarding');
        if (current.estado === 'completado') renderCompleted(current);
        else renderForm(current);
      } catch (error) {
        root.innerHTML = `<section class="onboarding-card onboarding-error" role="alert"><h1>No se pudo cargar la configuracion</h1><p>${escapeHtml(error.message || 'Intenta nuevamente.')}</p><button type="button" data-onboarding-retry>Reintentar</button></section>`;
        root.querySelector('[data-onboarding-retry]').addEventListener('click', () => { void render(); });
      }
    }

    return Object.freeze({ render });
  }

  global.OnboardingUI = Object.freeze({ create });
  const onboardingRoot = global.document && global.document.getElementById('onboardingRoot');
  if (onboardingRoot) {
    void create({ root: onboardingRoot }).render();
  }
}(window));
