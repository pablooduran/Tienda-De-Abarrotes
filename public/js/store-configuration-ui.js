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
        <section class="configuration-panel" data-configuration-panel>
          <header class="panel-heading"><div><p class="eyebrow">Administracion y configuracion</p><h3>Configuracion</h3>
            <p>Administra los datos operativos que identifican a tu tienda.</p></div></header>
          <div class="configuration-groups">
            <section class="configuration-group"><h4>General</h4><div class="configuration-grid">
              <label>Nombre mostrado<input name="nombreMostrado" maxlength="120" required value="${escapeHtml(config.nombreMostrado)}"></label>
              <label>Moneda<select name="moneda" required><option value="BOB" selected>BOB</option></select></label>
              <label>Zona horaria<select name="zonaHoraria" required><option value="America/La_Paz" selected>America/La_Paz</option></select></label>
            </div></section>
            <section class="configuration-group"><h4>Datos del negocio</h4><div class="configuration-grid">
              <label>Telefono opcional<input name="telefono" maxlength="30" autocomplete="tel" value="${escapeHtml(config.telefono)}"></label>
              <label>Direccion opcional<textarea name="direccion" maxlength="255" rows="3">${escapeHtml(config.direccion)}</textarea></label>
            </div></section>
            <section class="configuration-group"><h4>Informacion fiscal</h4><div class="configuration-grid">
              <label>Dato fiscal basico opcional<input name="datoFiscalBasico" maxlength="120" value="${escapeHtml(config.datoFiscalBasico)}"></label>
            </div><p class="field-help">La facturacion fiscal no forma parte de esta configuracion.</p></section>
            <section class="configuration-group"><h4>Otros ajustes</h4><p class="field-help">Los ajustes de credito e inventario se mantienen en sus herramientas operativas correspondientes.</p></section>
          </div>
          <p class="configuration-message" data-configuration-message role="status" aria-live="polite">${escapeHtml(announcement)}</p>
          ${readOnly ? '<p class="readonly-note">La suscripcion esta en modo de solo lectura. Puedes consultar estos datos, pero no guardarlos.</p>' : '<button type="button" class="primary-action" data-configuration-save>Guardar cambios</button>'}
        </section>`;
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
