(function initializeStoreConfigurationUi(global) {
  'use strict';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function create({ root, api, isReadOnly = () => false, patterns = global.UiPatterns } = {}) {
    if (!root || !api) throw new Error('La configuracion requiere un contenedor y un cliente API.');
    let submitting = false;

    function render(data, announcement = '') {
      const config = data.configuracion || {};
      const readOnly = isReadOnly();
      root.innerHTML = `
        <section class="configuration-panel configuration-experience" data-configuration-panel>
          <header class="configuration-hero">
            <div class="configuration-brand">
              <span class="configuration-brand-mark" aria-hidden="true"><img src="/assets/administrau-icon.png" alt=""></span>
              <div>
                <p class="eyebrow">Perfil de tu tienda</p>
                <h3>Configuración</h3>
                <p>Organiza los datos que identifican a tu negocio y su operación diaria.</p>
              </div>
            </div>
            <div class="configuration-hero-status" aria-label="Estado de configuración">
              <span>Información operativa</span>
              <strong>Lista para revisar</strong>
            </div>
          </header>

          <div class="configuration-intro">
            <div>
              <p class="eyebrow">Tu negocio</p>
              <h4>${escapeHtml(config.nombreMostrado || 'Mi tienda')}</h4>
              <p>Actualiza solo lo necesario. Estos datos se usan para identificar tu tienda dentro de la aplicación.</p>
            </div>
            <p class="configuration-intro-note"><strong>Consejo:</strong> teléfono, dirección y dato fiscal son opcionales.</p>
          </div>

          <div class="configuration-groups">
            <section class="configuration-group configuration-group-featured" aria-labelledby="configurationIdentityTitle">
              <header class="configuration-group-heading">
                <span class="configuration-step" aria-hidden="true">1</span>
                <div><h4 id="configurationIdentityTitle">Identidad de la tienda</h4><p>Lo esencial para mostrar y ubicar tu negocio.</p></div>
              </header>
              <div class="configuration-grid configuration-grid-identity">
                <label class="configuration-field-wide">Nombre mostrado<input name="nombreMostrado" maxlength="120" required value="${escapeHtml(config.nombreMostrado)}"></label>
                <label>Moneda<select name="moneda" required><option value="BOB" selected>Boliviano (BOB)</option></select></label>
                <label>Zona horaria<select name="zonaHoraria" required><option value="America/La_Paz" selected>Bolivia · América/La Paz</option></select></label>
              </div>
            </section>

            <section class="configuration-group" aria-labelledby="configurationContactTitle">
              <header class="configuration-group-heading">
                <span class="configuration-step" aria-hidden="true">2</span>
                <div><h4 id="configurationContactTitle">Contacto del negocio</h4><p>Opcional, útil para reconocer tu tienda y compartirla.</p></div>
              </header>
              <div class="configuration-grid">
                <label>Teléfono<input name="telefono" maxlength="30" autocomplete="tel" placeholder="Ej.: +591 70000000" value="${escapeHtml(config.telefono)}"></label>
                <label>Dirección<textarea name="direccion" maxlength="255" rows="3" placeholder="Barrio, calle o referencia para tu tienda">${escapeHtml(config.direccion)}</textarea></label>
              </div>
            </section>

            <section class="configuration-group configuration-group-compact" aria-labelledby="configurationFiscalTitle">
              <header class="configuration-group-heading">
                <span class="configuration-step" aria-hidden="true">3</span>
                <div><h4 id="configurationFiscalTitle">Información fiscal</h4><p>Guarda un dato fiscal básico si lo necesitas para identificar el negocio.</p></div>
              </header>
              <div class="configuration-grid">
                <label>Dato fiscal básico<input name="datoFiscalBasico" maxlength="120" placeholder="Ej.: NIT o razón social" value="${escapeHtml(config.datoFiscalBasico)}"></label>
              </div>
              <p class="field-help">Este campo no habilita facturación fiscal; es solo un dato de referencia.</p>
            </section>

            <div class="configuration-secondary-grid">
              <section class="configuration-group configuration-group-compact" aria-labelledby="configurationAppearanceTitle">
                <header class="configuration-group-heading">
                  <span class="configuration-icon" aria-hidden="true">◐</span>
                  <div><h4 id="configurationAppearanceTitle">Apariencia</h4><p>Elige cómo quieres ver la aplicación en este dispositivo.</p></div>
                </header>
                <div class="theme-choices" role="group" aria-label="Modo de apariencia">
                  <button type="button" class="theme-choice" data-theme-choice="light" aria-pressed="${global.StoreTheme?.get() !== 'dark'}">Modo claro</button>
                  <button type="button" class="theme-choice" data-theme-choice="dark" aria-pressed="${global.StoreTheme?.get() === 'dark'}">Modo oscuro</button>
                </div>
              </section>
              <aside class="configuration-next-settings" aria-label="Otros ajustes disponibles">
                <p class="eyebrow">Otros ajustes</p>
                <h4>Configura cada cosa donde corresponde</h4>
                <ul><li><strong>Crédito y cobranza</strong><span>Disponible en Clientes.</span></li><li><strong>Inventario y reposición</strong><span>Disponible en Inventario.</span></li></ul>
              </aside>
            </div>
          </div>

          <footer class="configuration-actions">
            <p class="configuration-message" data-configuration-message role="status" aria-live="polite">${escapeHtml(announcement)}</p>
            ${readOnly ? '<p class="readonly-note">La suscripción está en modo de solo lectura. Puedes consultar estos datos, pero no guardarlos.</p>' : '<button type="button" class="primary-action" data-configuration-save>Guardar cambios</button>'}
          </footer>
        </section>`;
      root.querySelectorAll('[data-theme-choice]').forEach((button) => button.addEventListener('click', () => {
        const selected = global.StoreTheme?.set(button.dataset.themeChoice);
        root.querySelectorAll('[data-theme-choice]').forEach((choice) => {
          choice.setAttribute('aria-pressed', String(choice.dataset.themeChoice === selected));
        });
      }));
      if (readOnly) return;
      root.querySelector('[data-configuration-save]').addEventListener('click', async () => {
        if (submitting) return;
        submitting = true;
        const button = root.querySelector('[data-configuration-save]');
        const fields = ['nombreMostrado', 'moneda', 'zonaHoraria', 'telefono', 'direccion', 'datoFiscalBasico'];
        const payload = Object.fromEntries(fields.map((name) => [name, root.querySelector(`[name="${name}"]`).value]));
        button.disabled = true;
        button.textContent = 'Guardando...';
        root.querySelector('[data-configuration-panel]').setAttribute('aria-busy', 'true');
        try {
          const result = await api('/api/configuracion-tienda', { method: 'PATCH', body: JSON.stringify(payload) });
          render(result, 'Cambios guardados.');
        } catch (error) {
          root.querySelector('[data-configuration-message]').textContent = patterns?.messageFor?.(error) || 'No se pudo guardar la configuracion.';
          button.disabled = false;
          button.textContent = 'Guardar cambios';
          root.querySelector('[data-configuration-panel]').removeAttribute('aria-busy');
        } finally {
          submitting = false;
        }
      });
    }

    async function renderView() {
      root.innerHTML = '<section class="configuration-panel loading-panel" aria-busy="true"><p>Cargando configuracion...</p></section>';
      try { render(await api('/api/configuracion-tienda')); }
      catch (error) { root.innerHTML = `<section class="configuration-panel empty-state" role="alert"><h3>No se pudo cargar la configuracion</h3><p>${escapeHtml(patterns?.messageFor?.(error) || 'Intenta nuevamente.')}</p></section>`; }
    }
    return Object.freeze({ render: renderView });
  }

  global.StoreConfigurationUI = Object.freeze({ create });
}(window));
