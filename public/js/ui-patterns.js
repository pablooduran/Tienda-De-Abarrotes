(() => {
  const safeMessages = {
    RATE_LIMITED: 'Recibimos muchas solicitudes. Espera un momento e intentalo nuevamente.',
    NETWORK_ERROR: 'Parece que no tienes conexión. Revisa internet e inténtalo otra vez.',
    TIMEOUT: 'La solicitud tardó demasiado. Inténtalo nuevamente.',
    SUBSCRIPTION_GRACE_READ_ONLY: 'Tu suscripción está en gracia. Puedes consultar los datos, pero no registrar cambios.',
    LIMIT_REACHED: 'Alcanzaste el límite de tu plan para esta operación.',
    SUBSCRIPTION_SUSPENDED: 'Tu suscripción está suspendida. Consulta el estado de tu cuenta para continuar.',
    SUBSCRIPTION_CANCELLED: 'Tu suscripción está cancelada. Tus datos permanecen conservados.'
  };
  function messageFor(error) {
    const code = error?.code;
    if (code && safeMessages[code]) return safeMessages[code];
    if (error?.name === 'AbortError' || code === 'TIMEOUT') return safeMessages.TIMEOUT;
    if (!navigator.onLine || /network|fetch|failed to fetch/i.test(String(error?.message || ''))) return safeMessages.NETWORK_ERROR;
    return 'No pudimos completar la operación. Inténtalo nuevamente.';
  }
  function skeleton(kind = 'rows', count = 3) {
    return `<div class="ui-skeleton ui-skeleton-${kind}" aria-hidden="true">${Array.from({ length: count }, () => '<span></span>').join('')}</div>`;
  }
  function empty(title, description, cta = '') {
    return `<div class="ui-empty" role="status"><strong>${title}</strong><p>${description}</p>${cta}</div>`;
  }
  function mutation(button, busyText = 'Procesando...') {
    if (!button || button.disabled) return null;
    const original = { text: button.textContent, width: button.getBoundingClientRect().width };
    button.disabled = true;
    button.classList.add('is-busy');
    button.style.minWidth = `${Math.ceil(original.width)}px`;
    button.textContent = busyText;
    return () => { button.disabled = false; button.classList.remove('is-busy'); button.style.minWidth = ''; button.textContent = original.text; };
  }
  window.UiPatterns = { messageFor, skeleton, empty, mutation };
})();
