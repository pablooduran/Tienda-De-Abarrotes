(() => {
  'use strict';

  let deferredInstallPrompt = null;
  const installButtons = () => Array.from(document.querySelectorAll('[data-pwa-install]'));

  const updateInstallButtons = () => {
    const canInstall = Boolean(deferredInstallPrompt);
    installButtons().forEach((button) => {
      button.hidden = !canInstall;
      button.disabled = !canInstall;
    });
  };

  const registerServiceWorker = async () => {
    if (!('serviceWorker' in navigator)) return;
    try {
      const registration = await navigator.serviceWorker.register('/sw.js?v=20261005-1', {
        scope: '/',
        updateViaCache: 'none'
      });
      await registration.update();
    } catch (error) {
      // La app sigue funcionando como sitio web si el navegador no admite PWA.
      console.warn('No se pudo preparar la instalación de la aplicación.', error);
    }
  };

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    updateInstallButtons();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    updateInstallButtons();
  });

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-pwa-install]');
    if (!button || !deferredInstallPrompt) return;

    const prompt = deferredInstallPrompt;
    deferredInstallPrompt = null;
    updateInstallButtons();
    await prompt.prompt();
    await prompt.userChoice;
  });

  void registerServiceWorker();
  updateInstallButtons();
})();
