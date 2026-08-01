const form = document.getElementById('loginForm');
const message = document.getElementById('loginMessage');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.textContent = '';
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    const response = await SecurityHttp.secureFetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw SecurityHttp.errorFromResponse(response, result, 'No se pudo iniciar sesion.');
    const allowedDestinations = new Set(['/admin.html', '/app.html', '/onboarding.html', '/suscripcion.html']);
    window.location.href = allowedDestinations.has(result.destination) ? result.destination : '/';
  } catch (error) {
    message.textContent = error.message || 'No se pudo iniciar sesion.';
    message.className = 'message error';
  } finally {
    button.disabled = false;
  }
});
