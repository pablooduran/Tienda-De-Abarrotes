(function initializePublicAccess() {
  'use strict';

  const panels = new Map(Array.from(document.querySelectorAll('[data-auth-panel]'))
    .map((panel) => [panel.dataset.authPanel, panel]));
  const targetButtons = Array.from(document.querySelectorAll('[data-auth-target]'));
  const panelTitles = Object.freeze({
    login: 'Acceso',
    register: 'Crear cuenta',
    verify: 'Verificar correo',
    recovery: 'Recuperar acceso',
    reset: 'Restablecer contraseña'
  });
  const allowedDestinations = new Set(['/admin.html', '/app.html', '/onboarding.html', '/suscripcion.html']);
  let registrationKey = null;

  function feedback(panelName) {
    return panelName === 'login'
      ? document.getElementById('loginMessage')
      : document.querySelector(`[data-auth-feedback="${panelName}"]`);
  }

  function setFeedback(panelName, message = '', type = 'success') {
    const node = feedback(panelName);
    if (!node) return;
    node.textContent = message;
    node.className = `auth-message${type === 'error' ? ' error' : ''}`;
  }

  function showPanel(panelName, { focus = true } = {}) {
    if (!panels.has(panelName)) return;
    for (const [name, panel] of panels) panel.hidden = name !== panelName;
    for (const button of targetButtons) {
      if (!['login', 'register'].includes(button.dataset.authTarget)) continue;
      button.setAttribute('aria-pressed', String(button.dataset.authTarget === panelName));
    }
    document.title = `${panelTitles[panelName]} | Tienda de abarrotes`;
    if (focus) panels.get(panelName).querySelector('h2')?.focus();
  }

  function operationKey() {
    const bytes = new Uint32Array(4);
    window.crypto.getRandomValues(bytes);
    return `registro:${Date.now().toString(36)}:${Array.from(bytes, (value) => value.toString(36)).join('-')}`;
  }

  async function requestJson(path, body, headers = {}) {
    const response = await SecurityHttp.secureFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw SecurityHttp.errorFromResponse(response, result, 'No pudimos completar la operación. Inténtalo nuevamente.');
    }
    return result;
  }

  async function mutate(form, panelName, task) {
    if (form.getAttribute('aria-busy') === 'true') return;
    if (!form.reportValidity()) return;
    const button = form.querySelector('button[type="submit"]');
    const originalLabel = button.textContent;
    form.setAttribute('aria-busy', 'true');
    button.disabled = true;
    button.textContent = button.dataset.pendingLabel || 'Procesando…';
    setFeedback(panelName);
    try {
      await task();
    } catch (error) {
      setFeedback(panelName, error?.message || 'No pudimos completar la operación. Inténtalo nuevamente.', 'error');
    } finally {
      form.removeAttribute('aria-busy');
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }

  for (const button of targetButtons) {
    button.addEventListener('click', () => showPanel(button.dataset.authTarget));
  }

  const loginForm = document.getElementById('loginForm');
  loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    mutate(loginForm, 'login', async () => {
      const data = Object.fromEntries(new FormData(loginForm).entries());
      const result = await requestJson('/auth/login', data);
      window.location.href = allowedDestinations.has(result.destination) ? result.destination : '/';
    });
  });

  const registrationForm = document.getElementById('registrationForm');
  registrationForm.addEventListener('input', () => {
    if (registrationForm.getAttribute('aria-busy') !== 'true') registrationKey = null;
  });
  registrationForm.addEventListener('submit', (event) => {
    event.preventDefault();
    mutate(registrationForm, 'register', async () => {
      const data = Object.fromEntries(new FormData(registrationForm).entries());
      if (data.password !== data.confirmacionRegistro) {
        throw new Error('Las contraseñas no coinciden. Revísalas e inténtalo nuevamente.');
      }
      delete data.confirmacionRegistro;
      registrationKey = registrationKey || operationKey();
      const result = await requestJson('/auth/registro', data, { 'Idempotency-Key': registrationKey });
      document.getElementById('resend-email').value = data.correo;
      document.getElementById('recovery-email').value = data.correo;
      document.getElementById('login-user').value = data.usuario;
      registrationForm.reset();
      registrationKey = null;
      showPanel('verify');
      setFeedback('verify', result.message || 'Cuenta creada. Revisa el correo de prueba para obtener tu código.');
    });
  });

  const verificationForm = document.getElementById('verificationForm');
  verificationForm.addEventListener('submit', (event) => {
    event.preventDefault();
    mutate(verificationForm, 'verify', async () => {
      const data = Object.fromEntries(new FormData(verificationForm).entries());
      const result = await requestJson('/auth/verificar-correo', data);
      verificationForm.reset();
      showPanel('login');
      setFeedback('login', result.message || 'Correo verificado. Ya puedes iniciar sesión.');
    });
  });

  const resendForm = document.getElementById('resendVerificationForm');
  resendForm.addEventListener('submit', (event) => {
    event.preventDefault();
    mutate(resendForm, 'verify', async () => {
      const data = Object.fromEntries(new FormData(resendForm).entries());
      const result = await requestJson('/auth/reenviar-verificacion', data);
      setFeedback('verify', result.message || 'Si la cuenta sigue pendiente, recibirás un nuevo código.');
    });
  });

  const recoveryForm = document.getElementById('recoveryRequestForm');
  recoveryForm.addEventListener('submit', (event) => {
    event.preventDefault();
    mutate(recoveryForm, 'recovery', async () => {
      const data = Object.fromEntries(new FormData(recoveryForm).entries());
      const result = await requestJson('/auth/solicitar-recuperacion', data);
      recoveryForm.reset();
      showPanel('reset');
      setFeedback('reset', result.message || 'Si existe una cuenta asociada, recibirás instrucciones para continuar.');
    });
  });

  const resetForm = document.getElementById('passwordResetForm');
  resetForm.addEventListener('submit', (event) => {
    event.preventDefault();
    mutate(resetForm, 'reset', async () => {
      const data = Object.fromEntries(new FormData(resetForm).entries());
      if (data.nuevaPassword !== data.confirmacionPassword) {
        throw new Error('Las contraseñas no coinciden. Revísalas e inténtalo nuevamente.');
      }
      const result = await requestJson('/auth/restablecer-password', data);
      resetForm.reset();
      showPanel('login');
      setFeedback('login', result.message || 'Contraseña actualizada. Inicia sesión nuevamente.');
    });
  });

  document.getElementById('login-user')?.focus();
}());
