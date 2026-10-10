(function initializeOnlineStoreAdminUi(global) {
  'use strict';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function checked(value) { return value ? 'checked' : ''; }
  function normalized(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  function create({ root, api, isReadOnly = () => false, patterns = global.UiPatterns } = {}) {
    if (!root || !api) throw new Error('La tienda online requiere un contenedor y un cliente API.');
    let model = null;
    let products = [];
    let search = '';

    function messageFor(error) {
      return patterns?.messageFor?.(error) || error?.message || 'No se pudo completar la operación.';
    }

    function publicUrl() {
      return model?.enlacePublico ? `${global.location.origin}${model.enlacePublico}` : '';
    }

    function renderProductList() {
      const container = root.querySelector('[data-online-product-list]');
      if (!container) return;
      const filtered = products.filter((product) => normalized(`${product.nombre} ${product.categoria}`).includes(normalized(search)));
      if (!filtered.length) {
        container.innerHTML = '<div class="online-store-empty"><strong>No encontramos productos</strong><p>Prueba con otro nombre o categoría.</p></div>';
        return;
      }
      container.innerHTML = filtered.map((product) => `
        <article class="online-product-card${product.publicado ? ' is-published' : ''}" data-online-product="${product.idProducto}">
          <div class="online-product-main">
            <div class="online-product-icon" aria-hidden="true">${escapeHtml(product.nombre.slice(0, 1).toUpperCase())}</div>
            <div class="online-product-copy">
              <span class="online-product-category">${escapeHtml(product.categoria)}</span>
              <h5>${escapeHtml(product.nombre)}</h5>
              <p>Bs ${Number(product.precioVenta).toFixed(2)} · ${product.stockUnidadesTotal > 0 ? 'Disponible' : 'Agotado'}</p>
            </div>
          </div>
          <label class="online-visibility-card">
            <span><strong>${product.publicado ? 'Visible en la tienda' : 'Oculto para clientes'}</strong><small>${product.publicado ? 'El cliente puede agregarlo a su carrito.' : 'Sigue disponible en tu inventario.'}</small></span>
            <input type="checkbox" name="publicado" ${checked(product.publicado)} ${isReadOnly() ? 'disabled' : ''}>
            <i aria-hidden="true"></i>
          </label>
        </article>`).join('');
      container.querySelectorAll('[data-online-product]').forEach((card) => {
        const publication = card.querySelector('[name="publicado"]');
        const syncState = () => {
          card.classList.toggle('is-published', publication.checked);
          const copy = publication.closest('label').querySelector('span');
          copy.innerHTML = publication.checked
            ? '<strong>Visible en la tienda</strong><small>El cliente puede agregarlo a su carrito.</small>'
            : '<strong>Oculto para clientes</strong><small>Sigue disponible en tu inventario.</small>';
        };
        publication.addEventListener('change', async () => { syncState(); await saveProduct(card); });
        syncState();
      });
    }

    async function saveProduct(card) {
      const idProducto = Number(card.dataset.onlineProduct);
      const control = card.querySelector('[name="publicado"]');
      const payload = { publicado: control.checked };
      control.disabled = true;
      try {
        const result = await api(`/api/tienda-online/productos/${idProducto}`, { method: 'PATCH', body: JSON.stringify(payload) });
        const index = products.findIndex((product) => product.idProducto === idProducto);
        if (index >= 0) products[index] = result.producto;
        renderProductList();
        setAnnouncement(`${result.producto.nombre} quedó ${result.producto.publicado ? 'publicado' : 'oculto'}.`);
      } catch (error) {
        setAnnouncement(messageFor(error), true);
        control.checked = !control.checked;
        control.disabled = isReadOnly();
        renderProductList();
      }
    }

    function setAnnouncement(text, error = false) {
      const target = root.querySelector('[data-online-announcement]');
      if (!target) return;
      target.textContent = text;
      target.classList.toggle('error', error);
    }

    function render() {
      const config = model.configuracion;
      const enabledCount = products.filter((product) => product.publicado).length;
      root.innerHTML = `
        <section class="online-store-admin">
          <header class="online-store-hero">
            <div class="online-store-brand"><img src="/assets/administrau-icon.png" alt=""><div><p class="eyebrow">CATÁLOGO PARA TUS CLIENTES</p><h3>Tu tienda online</h3><p>Elige qué productos mostrar y comparte un enlace actualizado sin enviar listas por WhatsApp.</p></div></div>
            <div class="online-store-status ${config.activa ? 'is-active' : ''}"><span>${config.activa ? 'En línea' : 'Sin publicar'}</span><strong>${enabledCount} productos visibles</strong></div>
          </header>

          <section class="online-store-link-card">
            <div><span class="eyebrow">ENLACE DE TU TIENDA</span><h4>${config.activa ? 'Listo para compartir' : 'Actívalo cuando termines de prepararlo'}</h4><p>${escapeHtml(publicUrl())}</p></div>
            <div class="online-store-link-actions"><button type="button" class="secondary" data-copy-online-link>Copiar enlace</button><a class="button-link" href="${escapeHtml(model.enlacePublico)}" target="_blank" rel="noopener">Vista del cliente</a></div>
          </section>

          <div class="online-store-admin-grid">
            <section class="online-store-settings-card">
              <div class="online-section-heading"><span>1</span><div><h4>Configura la experiencia</h4><p>Activa las alternativas que podrá elegir el cliente al finalizar su carrito.</p></div></div>
              <form data-online-config-form>
                <label class="online-option-card online-activation"><span class="online-option-icon">↗</span><span><strong>Publicar tienda online</strong><small>Al activarla, cualquier persona con el enlace podrá ver el catálogo.</small></span><input name="activa" type="checkbox" ${checked(config.activa)}><i aria-hidden="true"></i></label>
                <label>Mensaje de bienvenida<textarea name="mensajeBienvenida" maxlength="300" rows="3" placeholder="Ej.: Elige tus productos y nosotros preparamos tu pedido.">${escapeHtml(config.mensajeBienvenida)}</textarea></label>
                <fieldset class="online-choice-grid"><legend>Opciones que podrá escoger el cliente</legend><label class="online-option-card"><span class="online-option-icon">⌂</span><span><strong>Recojo en tienda</strong><small>El cliente elige mañana, tarde o noche.</small></span><input name="permiteRecojo" type="checkbox" ${checked(config.permiteRecojo)}><i aria-hidden="true"></i></label><label class="online-option-card"><span class="online-option-icon">⌖</span><span><strong>Entrega a domicilio</strong><small>La dirección y el horario se piden al confirmar.</small></span><input name="permiteEntrega" type="checkbox" ${checked(config.permiteEntrega)}><i aria-hidden="true"></i></label></fieldset>
                <fieldset class="online-choice-grid"><legend>Formas de pago disponibles</legend><label class="online-option-card"><span class="online-option-icon">Bs</span><span><strong>Efectivo</strong><small>Pago al recoger o recibir.</small></span><input name="permiteEfectivo" type="checkbox" ${checked(config.permiteEfectivo)}><i aria-hidden="true"></i></label><label class="online-option-card"><span class="online-option-icon">QR</span><span><strong>Pago por QR</strong><small>La tienda coordina el comprobante.</small></span><input name="permiteQr" type="checkbox" ${checked(config.permiteQr)}><i aria-hidden="true"></i></label></fieldset>
                <div class="online-delivery-settings"><div><strong>Condiciones para entrega</strong><p>Si el pedido no alcanza el monto indicado, se suma el costo base. La tienda puede confirmar un ajuste según la distancia.</p></div><div class="online-field-grid"><label>Entrega sin costo desde (Bs)<input name="entregaGratisDesde" type="number" min="0" step="0.01" value="${config.entregaGratisDesde ?? config.pedidoMinimo}"></label><label>Costo base si no alcanza (Bs)<input name="costoEntrega" type="number" min="0" step="0.01" value="${config.costoEntrega}"></label></div></div>
                ${isReadOnly() ? '<p class="readonly-note">Puedes revisar esta configuración, pero tu suscripción está en modo de solo lectura.</p>' : '<button type="submit">Guardar configuración</button>'}
              </form>
            </section>

            <aside class="online-store-preview-card">
              <span class="eyebrow">VISTA PREVIA</span><div class="online-preview-phone"><div class="online-preview-logo"><img src="/assets/administrau-icon.png" alt=""></div><strong>${escapeHtml(document.getElementById('storeName')?.textContent || 'Mi tienda')}</strong><p>${escapeHtml(config.mensajeBienvenida || 'Tu catálogo, claro y fácil de consultar.')}</p><div class="online-preview-search">Buscar productos</div><div class="online-preview-items"><span></span><span></span><span></span></div></div>
              <p>El catálogo se adapta automáticamente a celulares y no muestra cantidades exactas de stock.</p>
            </aside>
          </div>

          <section class="online-catalog-manager">
            <div class="online-section-heading"><span>2</span><div><h4>Productos de tu tienda</h4><p>Todos se muestran por defecto. Desactiva únicamente los que quieras ocultar al cliente.</p></div></div>
            <div class="online-catalog-toolbar"><label>Buscar producto<input type="search" data-online-product-search placeholder="Nombre o categoría"></label><div><strong>${enabledCount}</strong><span>publicados de ${products.length}</span></div></div>
            <div class="online-product-list" data-online-product-list></div>
          </section>
          <p class="online-store-announcement" data-online-announcement role="status" aria-live="polite"></p>
        </section>`;

      const form = root.querySelector('[data-online-config-form]');
      if (isReadOnly()) form.querySelectorAll('input,textarea').forEach((control) => { control.disabled = true; });
      form.addEventListener('submit', saveConfiguration);
      root.querySelector('[data-copy-online-link]').addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(publicUrl());
          setAnnouncement('Enlace copiado. Ya puedes compartirlo con tus clientes.');
        } catch (_) {
          setAnnouncement('No se pudo copiar automáticamente. Selecciona el enlace mostrado arriba.', true);
        }
      });
      root.querySelector('[data-online-product-search]').addEventListener('input', (event) => {
        search = event.target.value;
        renderProductList();
      });
      renderProductList();
    }

    async function saveConfiguration(event) {
      event.preventDefault();
      if (isReadOnly()) return;
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      const value = (name) => form.elements[name];
      const payload = {
        activa: value('activa').checked,
        mensajeBienvenida: value('mensajeBienvenida').value,
        permiteRecojo: value('permiteRecojo').checked,
        permiteEntrega: value('permiteEntrega').checked,
        permiteEfectivo: value('permiteEfectivo').checked,
        permiteQr: value('permiteQr').checked,
        entregaGratisDesde: value('entregaGratisDesde').value,
        costoEntrega: value('costoEntrega').value,
        tiempoPreparacionMinutos: 30
      };
      button.disabled = true;
      button.textContent = 'Guardando…';
      try {
        model = await api('/api/tienda-online/configuracion', { method: 'PUT', body: JSON.stringify(payload) });
        render();
        setAnnouncement('La configuración de tu tienda online quedó guardada.');
      } catch (error) {
        setAnnouncement(messageFor(error), true);
        button.disabled = false;
        button.textContent = 'Guardar configuración';
      }
    }

    async function renderView() {
      root.innerHTML = '<section class="online-store-admin loading-panel" aria-busy="true"><p>Preparando tu tienda online…</p></section>';
      try {
        [model, { productos: products }] = await Promise.all([
          api('/api/tienda-online/configuracion'),
          api('/api/tienda-online/productos')
        ]);
        render();
      } catch (error) {
        root.innerHTML = `<section class="panel empty-state" role="alert"><h3>No se pudo abrir la tienda online</h3><p>${escapeHtml(messageFor(error))}</p></section>`;
      }
    }

    return Object.freeze({ render: renderView });
  }

  global.OnlineStoreAdminUI = Object.freeze({ create });
}(window));
