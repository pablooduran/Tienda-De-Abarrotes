(function attachWelcomeGuide(global) {
  'use strict';

  const STORAGE_PREFIX = 'tienda.welcome.hidden.v1';

  function safePart(value, fallback) {
    const normalized = String(value || fallback).trim().toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    return normalized || fallback;
  }

  function storageKey(context = {}) {
    return `${STORAGE_PREFIX}.${safePart(context.usuario, 'usuario')}.${safePart(context.tienda?.nombre, 'tienda')}`;
  }

  function isHidden(context) {
    try { return global.localStorage.getItem(storageKey(context)) === '1'; } catch { return false; }
  }

  function setHidden(context, hidden) {
    try {
      const key = storageKey(context);
      if (hidden) global.localStorage.setItem(key, '1');
      else global.localStorage.removeItem(key);
    } catch {
      // La guia sigue siendo util aunque el navegador bloquee almacenamiento local.
    }
  }

  function startedKey(context) { return `${storageKey(context)}.started`; }

  function hasStarted(context) {
    try { return global.localStorage.getItem(startedKey(context)) === '1'; } catch { return false; }
  }

  function setStarted(context) {
    try { global.localStorage.setItem(startedKey(context), '1'); } catch { /* Preferencia opcional. */ }
  }

  function show(context) {
    global.ProductAnalytics?.track('welcome_started', { module: 'welcome', step: 'producto' });
    setHidden(context, false);
    setStarted(context);
  }

  function progress(products, sales) {
    const productRows = Array.isArray(products) ? products : [];
    const saleRows = Array.isArray(sales) ? sales : [];
    const hasProduct = productRows.length > 0;
    const hasStock = productRows.some((product) => Number(product?.stockUnidadesTotal ?? product?.stock ?? 0) > 0);
    const hasSale = saleRows.length > 0;
    const steps = [
      { id: 'producto', title: 'Agrega tu primer producto', action: 'Agregar producto', view: 'productos', complete: hasProduct },
      { id: 'stock', title: 'Registra stock', action: 'Registrar stock', view: 'compras', complete: hasStock },
      { id: 'venta', title: 'Realiza tu primera venta', action: 'Ir al punto de venta', view: 'ventas', complete: hasSale }
    ];
    return { steps, complete: steps.every((step) => step.complete) };
  }

  function render({ context, products, sales }) {
    const current = progress(products, sales);
    const readOnly = Boolean(context?.soloLectura);
    if (current.complete) {
      if (!hasStarted(context) || isHidden(context)) return '';
      return `<section class="welcome-complete panel" aria-labelledby="welcomeCompleteTitle">
        <div><h3 id="welcomeCompleteTitle">Tu tienda ya esta lista para operar.</h3><p>Ya registraste producto, stock y una primera venta.</p></div>
        <button type="button" class="secondary small" data-welcome-finish>Cerrar guia</button>
      </section>`;
    }
    if (isHidden(context)) {
      return `<div class="welcome-resume"><button type="button" class="secondary small" data-welcome-resume>Ver guia de primeros pasos</button></div>`;
    }
    const nextStep = current.steps.find((step) => !step.complete);
    const completed = current.steps.filter((step) => step.complete).length;
    return `<section class="welcome-guide panel" aria-labelledby="welcomeTitle">
      <div class="welcome-guide-heading">
        <div><span class="eyebrow">Primeros pasos</span><h3 id="welcomeTitle">Empieza con tu tienda</h3><p>Completa estas primeras tareas para comenzar a vender y controlar tu inventario.</p></div>
        <button type="button" class="link-button" data-welcome-hide>Ahora no</button>
      </div>
      <p class="welcome-guide-progress" aria-live="polite">${completed} de ${current.steps.length} pasos completados.</p>
      ${readOnly ? '<p class="welcome-guide-readonly">La cuenta esta en modo de solo lectura. Puedes consultar el progreso, pero las acciones estaran disponibles al reactivar la suscripcion.</p>' : ''}
      <ol class="welcome-steps">
        ${current.steps.map((step) => {
          const status = step.complete ? 'Completado' : step.id === nextStep?.id ? 'Siguiente paso' : 'Pendiente';
          const action = step.complete ? '<span class="welcome-step-status">Completado</span>' : `<button type="button" class="${step.id === nextStep?.id ? '' : 'secondary'}" data-welcome-action="${step.id}" ${readOnly ? 'disabled aria-disabled="true"' : ''}>${step.action}</button>`;
          return `<li class="welcome-step ${step.complete ? 'is-complete' : ''}" ${step.id === nextStep?.id ? 'aria-current="step"' : ''}>
            <div><strong>${step.title}</strong><span>${status}</span></div>${action}
          </li>`;
        }).join('')}
      </ol>
    </section>`;
  }

  function bind(root, { context, products, sales, navigate, refresh }) {
    const current = progress(products, sales);
    if (!current.complete && root.querySelector('.welcome-guide')) setStarted(context);
    root.querySelector('[data-welcome-hide]')?.addEventListener('click', () => {
      setHidden(context, true);
      refresh();
    });
    root.querySelector('[data-welcome-resume]')?.addEventListener('click', () => {
      setHidden(context, false);
      refresh();
    });
    root.querySelector('[data-welcome-finish]')?.addEventListener('click', () => {
      setHidden(context, true);
      refresh();
    });
    root.querySelectorAll('[data-welcome-action]').forEach((button) => {
      button.addEventListener('click', () => {
        if (context?.soloLectura) return;
        const step = current.steps.find((item) => item.id === button.dataset.welcomeAction);
        if (step && !step.complete) navigate(step.view, step.id);
      });
    });
  }

  global.WelcomeGuide = { progress, render, bind, storageKey, isHidden, setHidden, show };
}(window));
