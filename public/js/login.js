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
  let googleRegistrationPending = false;
  const resendTimers = new WeakMap();
  const googleMessages = Object.freeze({
    not_configured: 'El acceso con Google todavía no está configurado.',
    cancelled: 'Se canceló el acceso con Google.',
    expired: 'La solicitud de Google venció. Inténtalo nuevamente.',
    account_not_found: 'No encontramos una cuenta vinculada. Elige Crear cuenta para comenzar con Google.',
    account_unavailable: 'Esta cuenta no está disponible para acceso con Google.',
    invalid_registration: 'Completa correctamente tu usuario.',
    failed: 'No pudimos completar el acceso con Google. Inténtalo nuevamente.'
  });

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

  function setGoogleRegistrationMode(enabled) {
    googleRegistrationPending = Boolean(enabled);
    const form = document.getElementById('registrationForm');
    const email = document.getElementById('register-email');
    const passwordFields = document.querySelector('[data-password-fields]');
    const passwordHelp = document.querySelector('[data-password-help]');
    const title = document.getElementById('register-title');
    const eyebrow = document.querySelector('[data-register-eyebrow]');
    const description = document.querySelector('[data-register-description]');
    const submit = form?.querySelector('button[type="submit"]');
    const googleEntry = document.querySelector('[data-google-entry="register"]');
    if (!form || !email || !passwordFields || !passwordHelp || !title || !eyebrow || !description || !submit) return;

    email.closest('label').hidden = googleRegistrationPending;
    email.required = !googleRegistrationPending;
    passwordFields.hidden = googleRegistrationPending;
    passwordHelp.hidden = googleRegistrationPending;
    passwordFields.querySelectorAll('input').forEach((input) => { input.required = !googleRegistrationPending; });
    if (googleEntry) googleEntry.hidden = googleRegistrationPending;

    if (googleRegistrationPending) {
      eyebrow.textContent = 'Cuenta de Google lista';
      title.textContent = 'Elige tu usuario';
      description.textContent = 'Google ya confirmó tu correo. Después podrás preparar los datos de tu tienda.';
      submit.textContent = 'Crear mi cuenta';
      submit.dataset.pendingLabel = 'Creando tu cuenta…';
    } else {
      eyebrow.textContent = 'Primer paso';
      title.textContent = 'Crea tu cuenta';
      description.textContent = 'Elige tu usuario, agrega tu correo y crea una contraseña.';
      submit.textContent = 'Crear cuenta';
      submit.dataset.pendingLabel = 'Creando cuenta…';
    }
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

  async function submitGoogle(mode, button) {
    const fields = { mode };
    button.disabled = true;
    try {
      const response = await SecurityHttp.secureFetch('/auth/google/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.authorizationUrl) throw new Error(result.error || googleMessages.failed);
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      setFeedback(mode === 'register' ? 'register' : 'login', error.message || googleMessages.failed, 'error');
      button.disabled = false;
    }
  }

  function startResendCooldown(form, seconds = 30) {
    const button = form.querySelector('[data-resend-button]');
    const status = form.querySelector('[data-resend-status]');
    if (!button || !status) return;
    const previous = resendTimers.get(form);
    if (previous) window.clearInterval(previous);
    let remaining = seconds;
    const original = button.dataset.readyLabel || button.textContent;
    button.dataset.readyLabel = original;
    button.disabled = true;
    const render = () => {
      status.textContent = remaining > 0 ? `Podrás solicitar otro código en ${remaining} segundos.` : 'Ya puedes solicitar otro código.';
      button.textContent = remaining > 0 ? `Reenviar en ${remaining} s` : original;
      button.disabled = remaining > 0;
      if (remaining <= 0) {
        window.clearInterval(resendTimers.get(form));
        resendTimers.delete(form);
        return;
      }
      remaining -= 1;
    };
    render();
    resendTimers.set(form, window.setInterval(render, 1000));
  }

  for (const button of targetButtons) {
    button.addEventListener('click', () => showPanel(button.dataset.authTarget));
  }

  document.querySelectorAll('[data-google-action]').forEach((button) => {
    button.addEventListener('click', () => submitGoogle(button.dataset.googleAction, button));
  });

  SecurityHttp.secureFetch('/auth/google/status').then(async (response) => {
    const result = response.ok ? await response.json().catch(() => ({})) : {};
    if (result.available) document.querySelectorAll('[data-google-entry]').forEach((entry) => { entry.hidden = false; });
  }).catch(() => {});

  const googleResult = new URLSearchParams(window.location.search).get('google');
  if (googleResult) {
    const register = ['account_not_found', 'invalid_registration', 'registration_required'].includes(googleResult);
    showPanel(register ? 'register' : 'login', { focus: false });
    if (googleResult === 'registration_required') {
      setGoogleRegistrationMode(true);
      setFeedback('register', 'Tu cuenta de Google está lista. Elige tu usuario para continuar.');
    } else {
      setFeedback(register ? 'register' : 'login', googleMessages[googleResult] || googleMessages.failed, 'error');
    }
    window.history.replaceState({}, '', '/login.html');
  }

  const loginForm = document.getElementById('loginForm');
  loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    mutate(loginForm, 'login', async () => {
      const data = Object.fromEntries(new FormData(loginForm).entries());
      const result = await requestJson('/auth/login', data);
      const sessionResponse = await SecurityHttp.secureFetch('/auth/status');
      const session = sessionResponse.ok ? await sessionResponse.json().catch(() => ({})) : {};
      if (!session.authenticated || session.admin?.rol !== result.admin?.rol) {
        throw new Error('La contraseña fue aceptada, pero no pudimos mantener la sesión. Inténtalo nuevamente; si continúa, avísanos.');
      }
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
      if (googleRegistrationPending) {
        const result = await requestJson('/auth/google/complete-registration', { usuario: data.usuario });
        window.location.href = allowedDestinations.has(result.destination) ? result.destination : '/onboarding.html';
        return;
      }
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
      window.setTimeout(() => startResendCooldown(resendForm), 0);
    });
  });

  if (!googleRegistrationPending) setGoogleRegistrationMode(false);

  const recoveryForm = document.getElementById('recoveryRequestForm');
  recoveryForm.addEventListener('submit', (event) => {
    event.preventDefault();
    mutate(recoveryForm, 'recovery', async () => {
      const data = Object.fromEntries(new FormData(recoveryForm).entries());
      const result = await requestJson('/auth/solicitar-recuperacion', data);
      document.getElementById('recovery-resend-email').value = data.correo;
      recoveryForm.reset();
      showPanel('reset');
      setFeedback('reset', result.message || 'Si existe una cuenta asociada, recibirás instrucciones para continuar.');
      window.setTimeout(() => startResendCooldown(document.getElementById('resendRecoveryForm')), 0);
    });
  });

  const resendRecoveryForm = document.getElementById('resendRecoveryForm');
  resendRecoveryForm.addEventListener('submit', (event) => {
    event.preventDefault();
    mutate(resendRecoveryForm, 'reset', async () => {
      const data = Object.fromEntries(new FormData(resendRecoveryForm).entries());
      const result = await requestJson('/auth/solicitar-recuperacion', data);
      setFeedback('reset', result.message || 'Si existe una cuenta asociada, recibirás instrucciones para continuar.');
      window.setTimeout(() => startResendCooldown(resendRecoveryForm), 0);
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
