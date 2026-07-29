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
        zonaHoraria: raw.zonaHoraria,
        telefono: raw.telefono,
        direccion: raw.direccion,
        datoFiscalBasico: raw.datoFiscalBasico
      };
    }

    function renderCompleted(data) {
      root.innerHTML = `
        <section class="onboarding-card onboarding-completed" data-onboarding-completed>
          <p class="onboarding-eyebrow">Configuracion inicial</p>
          <h1>Todo esta listo</h1>
          <p>La configuracion inicial de tu tienda fue completada.</p>
          <button type="button" data-onboarding-panel>Ir al panel principal</button>
          <button type="button" class="secondary" data-onboarding-logout>Cerrar sesion</button>
        </section>`;
      root.querySelector('[data-onboarding-panel]').addEventListener('click', () => navigate('/app.html'));
      wireLogout();
    }

    function renderForm(data, announcement = '') {
      const config = data.configuracion || {};
      const progress = Number(data.progreso || 0);
      root.innerHTML = `
        <section class="onboarding-card" data-onboarding-screen>
          <header class="onboarding-heading">
            <p class="onboarding-eyebrow">Configuracion inicial</p>
            <h1>Prepara tu tienda</h1>
            <p>Confirma estos datos para continuar al panel. Los campos opcionales pueden quedar vacios.</p>
          </header>
          <div class="onboarding-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}">
            <span>Progreso</span><strong>${progress}%</strong><progress value="${progress}" max="100">${progress}%</progress>
          </div>
          <form data-onboarding-form novalidate>
            <div class="onboarding-grid">
              <label>Nombre mostrado<input name="nombreMostrado" maxlength="120" required value="${escapeHtml(config.nombreMostrado)}"></label>
              <label>Moneda<select name="moneda" required><option value="BOB" ${config.moneda === 'BOB' ? 'selected' : ''}>BOB</option></select></label>
              <label>Zona horaria<select name="zonaHoraria" required><option value="America/La_Paz" ${config.zonaHoraria === 'America/La_Paz' ? 'selected' : ''}>America/La_Paz</option></select></label>
              <label>Telefono opcional<input name="telefono" maxlength="30" autocomplete="tel" value="${escapeHtml(config.telefono)}"></label>
              <label>Direccion opcional<textarea name="direccion" maxlength="255" rows="3">${escapeHtml(config.direccion)}</textarea></label>
              <label>Dato fiscal basico opcional<input name="datoFiscalBasico" maxlength="120" value="${escapeHtml(config.datoFiscalBasico)}"></label>
            </div>
            <p class="onboarding-message" data-onboarding-message role="status" aria-live="polite">${escapeHtml(announcement)}</p>
            <p class="onboarding-message error" data-onboarding-error role="alert" aria-live="assertive"></p>
            <div class="onboarding-actions">
              <button type="button" class="secondary" data-onboarding-omit>Omitir campos opcionales</button>
              <button type="submit" data-onboarding-save>Guardar</button>
              <button type="button" data-onboarding-complete>Completar configuracion</button>
            </div>
          </form>
          <button type="button" class="onboarding-logout" data-onboarding-logout>Cerrar sesion</button>
        </section>`;
      const form = root.querySelector('[data-onboarding-form]');
      const error = root.querySelector('[data-onboarding-error]');
      const save = async ({ complete = false } = {}) => {
        if (submitting) return;
        submitting = true;
        const payload = bodyFrom(form);
        const controls = root.querySelectorAll('button, input, select, textarea');
        controls.forEach((control) => { control.disabled = true; });
        root.querySelector('[data-onboarding-screen]').setAttribute('aria-busy', 'true');
        error.textContent = '';
        try {
          current = await request('/onboarding', { method: 'PATCH', body: JSON.stringify(payload) });
          if (complete) {
            current = await request('/onboarding/completar', { method: 'POST', body: JSON.stringify({}) });
            renderCompleted(current);
            return;
          }
          renderForm(current, 'Configuracion guardada.');
        } catch (requestError) {
          error.textContent = requestError.message || 'No se pudo guardar la configuracion.';
          controls.forEach((control) => { control.disabled = false; });
          root.querySelector('[data-onboarding-screen]').removeAttribute('aria-busy');
        } finally {
          submitting = false;
        }
      };
      form.addEventListener('submit', (event) => { event.preventDefault(); void save(); });
      root.querySelector('[data-onboarding-complete]').addEventListener('click', () => void save({ complete: true }));
      root.querySelector('[data-onboarding-omit]').addEventListener('click', () => {
        ['telefono', 'direccion', 'datoFiscalBasico'].forEach((name) => { form.elements[name].value = ''; });
        root.querySelector('[data-onboarding-message]').textContent = 'Los campos opcionales se omitiran al guardar.';
        form.elements.telefono.focus();
      });
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
