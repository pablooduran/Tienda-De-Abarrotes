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
            <label class="online-publish-switch">
              <input type="checkbox" name="publicado" ${checked(product.publicado)} ${isReadOnly() ? 'disabled' : ''}>
              <span aria-hidden="true"></span><strong>${product.publicado ? 'Publicado' : 'Oculto'}</strong>
            </label>
            <div class="online-product-copy">
              <span class="online-product-category">${escapeHtml(product.categoria)}</span>
              <h5>${escapeHtml(product.nombre)}</h5>
              <p>Bs ${Number(product.precioVenta).toFixed(2)} · ${product.stockUnidadesTotal > 0 ? 'Disponible' : 'Agotado'}</p>
            </div>
          </div>
          <div class="online-product-options">
            <label>Descripción para el cliente<textarea name="descripcionPublica" maxlength="300" rows="2" placeholder="Opcional: tamaño, sabor o detalle útil">${escapeHtml(product.descripcionPublica)}</textarea></label>
            <label>Máximo por pedido<input name="cantidadMaximaPedido" type="number" min="1" max="10000" value="${product.cantidadMaximaPedido ?? ''}" placeholder="Sin límite"></label>
            <label class="online-check"><input name="destacado" type="checkbox" ${checked(product.destacado)}><span>Mostrar como destacado</span></label>
            <label class="online-check"><input name="permiteSustitucion" type="checkbox" ${checked(product.permiteSustitucion)}><span>Permitir sustitución</span></label>
            ${isReadOnly() ? '' : '<button type="button" class="secondary" data-online-product-save>Guardar producto</button>'}
          </div>
        </article>`).join('');
      container.querySelectorAll('[data-online-product]').forEach((card) => {
        const publication = card.querySelector('[name="publicado"]');
        const syncState = () => {
          card.classList.toggle('is-published', publication.checked);
          publication.closest('label').querySelector('strong').textContent = publication.checked ? 'Publicado' : 'Oculto';
          card.querySelectorAll('.online-product-options input,.online-product-options textarea').forEach((control) => {
            control.disabled = isReadOnly() || !publication.checked;
          });
        };
        publication.addEventListener('change', syncState);
        syncState();
        card.querySelector('[data-online-product-save]')?.addEventListener('click', () => saveProduct(card));
      });
    }

    async function saveProduct(card) {
      const idProducto = Number(card.dataset.onlineProduct);
      const button = card.querySelector('[data-online-product-save]');
      const payload = {
        publicado: card.querySelector('[name="publicado"]').checked,
        destacado: card.querySelector('[name="destacado"]').checked,
        descripcionPublica: card.querySelector('[name="descripcionPublica"]').value,
        cantidadMaximaPedido: card.querySelector('[name="cantidadMaximaPedido"]').value,
        permiteSustitucion: card.querySelector('[name="permiteSustitucion"]').checked
      };
      button.disabled = true;
      button.textContent = 'Guardando…';
      try {
        const result = await api(`/api/tienda-online/productos/${idProducto}`, { method: 'PATCH', body: JSON.stringify(payload) });
        const index = products.findIndex((product) => product.idProducto === idProducto);
        if (index >= 0) products[index] = result.producto;
        renderProductList();
        setAnnouncement(`${result.producto.nombre} quedó ${result.producto.publicado ? 'publicado' : 'oculto'}.`);
      } catch (error) {
        setAnnouncement(messageFor(error), true);
        button.disabled = false;
        button.textContent = 'Guardar producto';
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
              <div class="online-section-heading"><span>1</span><div><h4>Configura la experiencia</h4><p>Define cómo atenderás los pedidos cuando habilitemos su recepción.</p></div></div>
              <form data-online-config-form>
                <label class="online-activation"><input name="activa" type="checkbox" ${checked(config.activa)}><span><strong>Publicar tienda online</strong><small>Al activarla, cualquier persona con el enlace podrá ver el catálogo.</small></span></label>
                <label>Mensaje de bienvenida<textarea name="mensajeBienvenida" maxlength="300" rows="3" placeholder="Ej.: Elige tus productos y nosotros preparamos tu pedido.">${escapeHtml(config.mensajeBienvenida)}</textarea></label>
                <fieldset><legend>Cómo recibirá su compra</legend><label class="online-check"><input name="permiteRecojo" type="checkbox" ${checked(config.permiteRecojo)}><span>Recojo en tienda</span></label><label class="online-check"><input name="permiteEntrega" type="checkbox" ${checked(config.permiteEntrega)}><span>Entrega a domicilio</span></label></fieldset>
                <fieldset><legend>Formas de pago disponibles</legend><label class="online-check"><input name="permiteEfectivo" type="checkbox" ${checked(config.permiteEfectivo)}><span>Efectivo</span></label><label class="online-check"><input name="permiteQr" type="checkbox" ${checked(config.permiteQr)}><span>QR</span></label></fieldset>
                <div class="online-field-grid"><label>Pedido mínimo (Bs)<input name="pedidoMinimo" type="number" min="0" step="0.01" value="${config.pedidoMinimo}"></label><label>Costo de entrega (Bs)<input name="costoEntrega" type="number" min="0" step="0.01" value="${config.costoEntrega}"></label><label>Preparación estimada (min)<input name="tiempoPreparacionMinutos" type="number" min="5" max="1440" value="${config.tiempoPreparacionMinutos}"></label></div>
                ${isReadOnly() ? '<p class="readonly-note">Puedes revisar esta configuración, pero tu suscripción está en modo de solo lectura.</p>' : '<button type="submit">Guardar configuración</button>'}
              </form>
            </section>

            <aside class="online-store-preview-card">
              <span class="eyebrow">VISTA PREVIA</span><div class="online-preview-phone"><div class="online-preview-logo"><img src="/assets/administrau-icon.png" alt=""></div><strong>${escapeHtml(document.getElementById('storeName')?.textContent || 'Mi tienda')}</strong><p>${escapeHtml(config.mensajeBienvenida || 'Tu catálogo, claro y fácil de consultar.')}</p><div class="online-preview-search">Buscar productos</div><div class="online-preview-items"><span></span><span></span><span></span></div></div>
              <p>El catálogo se adapta automáticamente a celulares y no muestra cantidades exactas de stock.</p>
            </aside>
          </div>

          <section class="online-catalog-manager">
            <div class="online-section-heading"><span>2</span><div><h4>Elige qué productos mostrar</h4><p>Los productos ocultos siguen disponibles en tu inventario, pero no aparecen para el cliente.</p></div></div>
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
        pedidoMinimo: value('pedidoMinimo').value,
        costoEntrega: value('costoEntrega').value,
        tiempoPreparacionMinutos: value('tiempoPreparacionMinutos').value
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
