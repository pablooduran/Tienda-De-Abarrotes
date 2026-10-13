(function initializeStoreConfigurationUi(global) {
  'use strict';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function create({ root, api, isReadOnly = () => false, patterns = global.UiPatterns } = {}) {
    if (!root || !api) throw new Error('La configuracion requiere un contenedor y un cliente API.');
    let submitting = false;
    let account = null;

    function render(data, announcement = '') {
      const config = data.configuracion || {};
      account = data.cuenta || account || {};
      const readOnly = isReadOnly();
      const roleLabel = {
        dueno_tienda: 'Propietario', encargado: 'Encargado', cajero: 'Caja', inventario: 'Inventario'
      }[account.rol] || account.rol || 'Usuario';
      const emailValue = account.correoPendiente || account.correo || '';
      const emailStatus = account.correoPendiente
        ? '<span class="account-status account-status-warning">Pendiente de verificación</span>'
        : account.correoVerificado
          ? '<span class="account-status account-status-ok">Correo verificado</span>'
          : '<span class="account-status">Sin correo agregado</span>';
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
            <section class="configuration-group configuration-account-group" aria-labelledby="configurationAccountTitle">
              <header class="configuration-group-heading">
                <span class="configuration-step" aria-hidden="true">1</span>
                <div><h4 id="configurationAccountTitle">Datos de tu cuenta</h4><p>Tu acceso personal a Administrau. Estos datos no se muestran a los clientes.</p></div>
              </header>
              <div class="account-identity-summary">
                <div><span>Usuario</span><strong>${escapeHtml(account.usuario || 'Sin usuario')}</strong></div>
                <div><span>Tipo de cuenta</span><strong>${escapeHtml(roleLabel)}</strong></div>
              </div>
              <div class="configuration-grid account-contact-grid">
                <label>Correo electrónico
                  <input name="correoCuenta" type="email" maxlength="160" autocomplete="email" placeholder="tu@correo.com" value="${escapeHtml(emailValue)}">
                  <span class="account-field-status">${emailStatus}</span>
                </label>
                <label>Teléfono de la cuenta
                  <input name="telefonoCuenta" maxlength="30" autocomplete="tel" placeholder="Ej.: +591 70000000" value="${escapeHtml(account.telefono)}">
                  <span class="field-help">Es distinto del teléfono público de la tienda.</span>
                </label>
              </div>
              <div class="account-action-row">
                <button type="button" class="secondary" data-account-email>${account.correoPendiente ? 'Reenviar código' : account.correo ? 'Cambiar correo' : 'Agregar correo'}</button>
                <button type="button" class="secondary" data-account-phone>Guardar teléfono</button>
              </div>
              ${account.correoPendiente ? `
                <div class="account-email-verification" data-account-email-verification>
                  <div><strong>Confirma ${escapeHtml(account.correoPendiente)}</strong><p>Ingresa el código de 6 números que enviamos a ese correo.</p></div>
                  <label>Código de verificación<input name="codigoCorreoCuenta" inputmode="numeric" autocomplete="one-time-code" minlength="6" maxlength="6" pattern="[0-9]{6}" placeholder="000000"></label>
                  <button type="button" data-account-email-confirm>Verificar correo</button>
                </div>` : ''}
              <details class="account-password-panel">
                <summary>Cambiar contraseña</summary>
                <div class="account-security-note">
                  <strong>Tu contraseña actual nunca se muestra.</strong>
                  <p>Para cambiarla debes escribir la actual y crear una nueva. Al finalizar se cerrará la sesión en todos tus dispositivos.</p>
                </div>
                <div class="configuration-grid account-password-grid">
                  <label>Contraseña actual<input name="passwordActual" type="password" maxlength="200" autocomplete="off" aria-describedby="accountPasswordHelp"></label>
                  <label>Nueva contraseña<input name="passwordNueva" type="password" minlength="12" maxlength="72" autocomplete="new-password" aria-describedby="accountPasswordHelp"></label>
                  <label>Confirmar nueva contraseña<input name="confirmacionPasswordCuenta" type="password" minlength="12" maxlength="72" autocomplete="new-password" aria-describedby="accountPasswordHelp"></label>
                </div>
                <p id="accountPasswordHelp" class="field-help">Debes escribir nuevamente la contraseña actual. Usa al menos 12 caracteres para la nueva. Los campos permanecen ocultos y Administrau no puede recuperar la contraseña anterior.</p>
                <div class="account-password-actions">
                  <a class="secondary button-link" href="/login.html?panel=recovery">No recuerdo mi contraseña</a>
                  <button type="button" class="secondary" data-account-password>Actualizar contraseña</button>
                </div>
              </details>
              <p class="configuration-message account-message" data-account-message role="status" aria-live="polite"></p>
            </section>

            <section class="configuration-group configuration-group-featured" aria-labelledby="configurationIdentityTitle">
              <header class="configuration-group-heading">
                <span class="configuration-step" aria-hidden="true">2</span>
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
                <span class="configuration-step" aria-hidden="true">3</span>
                <div><h4 id="configurationContactTitle">Contacto del negocio</h4><p>Opcional, útil para reconocer tu tienda y compartirla.</p></div>
              </header>
              <div class="configuration-grid">
                <label>Teléfono<input name="telefono" maxlength="30" autocomplete="tel" placeholder="Ej.: +591 70000000" value="${escapeHtml(config.telefono)}"></label>
                <label>Dirección<textarea name="direccion" maxlength="255" rows="3" placeholder="Barrio, calle o referencia para tu tienda">${escapeHtml(config.direccion)}</textarea></label>
              </div>
            </section>

            <section class="configuration-group configuration-group-compact" aria-labelledby="configurationFiscalTitle">
              <header class="configuration-group-heading">
                <span class="configuration-step" aria-hidden="true">4</span>
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
      const accountMessage = root.querySelector('[data-account-message]');
      const accountAction = async (button, pendingText, action) => {
        if (submitting) return;
        submitting = true;
        const original = button.textContent;
        button.disabled = true;
        button.textContent = pendingText;
        accountMessage.textContent = '';
        try {
          const result = await action();
          if (result?.cuenta) account = result.cuenta;
          render({ ...data, cuenta: account }, result?.message || 'Datos de cuenta actualizados.');
        } catch (error) {
          accountMessage.textContent = patterns?.messageFor?.(error) || error.message || 'No se pudo actualizar la cuenta.';
          accountMessage.classList.add('error');
          button.disabled = false;
          button.textContent = original;
        } finally {
          submitting = false;
        }
      };
      root.querySelector('[data-account-phone]')?.addEventListener('click', (event) => accountAction(
        event.currentTarget,
        'Guardando...',
        () => api('/auth/account', {
          method: 'PATCH',
          body: JSON.stringify({ telefono: root.querySelector('[name="telefonoCuenta"]').value })
        })
      ));
      root.querySelector('[data-account-email]')?.addEventListener('click', (event) => {
        const input = root.querySelector('[name="correoCuenta"]');
        if (!input.reportValidity()) return;
        accountAction(event.currentTarget, 'Enviando...', () => api('/auth/account/email', {
          method: 'POST', body: JSON.stringify({ correo: input.value })
        }));
      });
      root.querySelector('[data-account-email-confirm]')?.addEventListener('click', (event) => {
        const input = root.querySelector('[name="codigoCorreoCuenta"]');
        if (!input.reportValidity()) return;
        accountAction(event.currentTarget, 'Verificando...', () => api('/auth/account/email/confirm', {
          method: 'POST', body: JSON.stringify({ codigo: input.value })
        }));
      });
      root.querySelector('[data-account-password]')?.addEventListener('click', async (event) => {
        const current = root.querySelector('[name="passwordActual"]');
        const password = root.querySelector('[name="passwordNueva"]');
        const confirmation = root.querySelector('[name="confirmacionPasswordCuenta"]');
        [current, password, confirmation].forEach((input) => { input.required = true; });
        confirmation.setCustomValidity(password.value === confirmation.value ? '' : 'Las contraseñas no coinciden.');
        if (![current, password, confirmation].every((input) => input.reportValidity())) return;
        const button = event.currentTarget;
        button.disabled = true;
        button.textContent = 'Actualizando...';
        accountMessage.textContent = '';
        try {
          await api('/auth/change-password', {
            method: 'POST',
            body: JSON.stringify({
              passwordActual: current.value,
              passwordNueva: password.value,
              confirmacionPassword: confirmation.value
            })
          });
          global.location.href = '/login.html?password=updated';
        } catch (error) {
          accountMessage.textContent = patterns?.messageFor?.(error) || error.message || 'No se pudo cambiar la contraseña.';
          accountMessage.classList.add('error');
          button.disabled = false;
          button.textContent = 'Actualizar contraseña';
        }
      });
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
      try {
        const [configuration, accountData] = await Promise.all([
          api('/api/configuracion-tienda'), api('/auth/account')
        ]);
        render({ ...configuration, ...accountData });
      }
      catch (error) { root.innerHTML = `<section class="configuration-panel empty-state" role="alert"><h3>No se pudo cargar la configuracion</h3><p>${escapeHtml(patterns?.messageFor?.(error) || 'Intenta nuevamente.')}</p></section>`; }
    }
    return Object.freeze({ render: renderView });
  }

  global.StoreConfigurationUI = Object.freeze({ create });
}(window));
