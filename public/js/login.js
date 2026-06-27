const form = document.getElementById('loginForm');
const message = document.getElementById('loginMessage');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.textContent = '';
  const data = Object.fromEntries(new FormData(form).entries());

  const response = await fetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });

  const result = await response.json();
  if (!response.ok) {
    message.textContent = result.error || 'No se pudo iniciar sesion.';
    message.className = 'message error';
    return;
  }

  window.location.href = '/';
});
