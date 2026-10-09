(function initializeStorefront() {
  'use strict';
  const root = document.getElementById('storefrontRoot');
  let catalog = null;
  let search = '';
  let category = 'todas';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function normalized(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  function availabilityLabel(value) {
    return { disponible: 'Disponible', pocas_unidades: 'Quedan pocas unidades', agotado: 'Agotado' }[value] || 'Consultar';
  }

  function deliverySummary(store) {
    const values = [];
    if (store.opciones.recojo) values.push('Recojo en tienda');
    if (store.opciones.entrega) values.push(`Entrega${store.costoEntrega ? ` · Bs ${store.costoEntrega.toFixed(2)}` : ''}`);
    return values.join(' · ');
  }

  function renderProducts() {
    const target = root.querySelector('[data-storefront-products]');
    if (!target) return;
    const products = catalog.productos.filter((product) => {
      const matchesCategory = category === 'todas' || product.categoria === category;
      const matchesSearch = normalized(`${product.nombre} ${product.categoria} ${product.descripcion}`).includes(normalized(search));
      return matchesCategory && matchesSearch;
    });
    root.querySelector('[data-results-count]').textContent = `${products.length} ${products.length === 1 ? 'producto' : 'productos'}`;
    if (!products.length) {
      target.innerHTML = '<section class="storefront-empty"><span aria-hidden="true">⌕</span><h2>No encontramos productos</h2><p>Prueba con otra búsqueda o categoría.</p></section>';
      return;
    }
    target.innerHTML = products.map((product) => `
      <article class="storefront-product${product.disponibilidad === 'agotado' ? ' is-sold-out' : ''}">
        <div class="storefront-product-visual"><span>${escapeHtml(product.categoria.slice(0, 1).toUpperCase())}</span>${product.destacado ? '<strong>Destacado</strong>' : ''}</div>
        <div class="storefront-product-copy"><span class="storefront-category">${escapeHtml(product.categoria)}</span><h2>${escapeHtml(product.nombre)}</h2><p>${escapeHtml(product.descripcion || `Venta por ${product.unidadMedida}.`)}</p></div>
        <div class="storefront-product-bottom"><strong>Bs ${Number(product.precioVenta).toFixed(2)}</strong><span class="availability ${product.disponibilidad}">${availabilityLabel(product.disponibilidad)}</span></div>
      </article>`).join('');
  }

  function render() {
    const store = catalog.tienda;
    document.title = `${store.nombre} · Administrau`;
    root.innerHTML = `
      <section class="storefront-hero">
        <div class="storefront-hero-pattern" aria-hidden="true"></div>
        <div class="storefront-store-mark"><img src="/assets/administrau-icon.png" alt=""></div>
        <div class="storefront-hero-copy"><p class="eyebrow">TIENDA ONLINE</p><h1>${escapeHtml(store.nombre)}</h1><p>${escapeHtml(store.mensajeBienvenida || 'Consulta lo que tenemos disponible y prepara tu próxima compra.')}</p></div>
        <div class="storefront-service-card"><span>Atención de pedidos</span><strong>${escapeHtml(deliverySummary(store))}</strong><small>Preparación estimada: ${store.tiempoPreparacionMinutos} min${store.pedidoMinimo ? ` · Mínimo Bs ${store.pedidoMinimo.toFixed(2)}` : ''}</small></div>
      </section>
      <section class="storefront-catalog">
        <header class="storefront-catalog-heading"><div><p class="eyebrow">CATÁLOGO</p><h2>¿Qué estás buscando?</h2></div><span data-results-count></span></header>
        <div class="storefront-search"><span aria-hidden="true">⌕</span><input type="search" placeholder="Buscar por nombre o categoría" aria-label="Buscar productos" data-storefront-search></div>
        <div class="storefront-categories" role="group" aria-label="Filtrar por categoría">
          <button type="button" class="active" data-category="todas">Todos</button>${catalog.categorias.map((item) => `<button type="button" data-category="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join('')}
        </div>
        <div class="storefront-products" data-storefront-products></div>
      </section>
      <aside class="storefront-next-step"><img src="/assets/administrau-icon.png" alt=""><div><strong>Los pedidos estarán disponibles pronto</strong><p>En esta primera versión puedes consultar precios y disponibilidad. La tienda habilitará el carrito en la siguiente etapa.</p></div></aside>`;
    root.querySelector('[data-storefront-search]').addEventListener('input', (event) => { search = event.target.value; renderProducts(); });
    root.querySelectorAll('[data-category]').forEach((button) => button.addEventListener('click', () => {
      category = button.dataset.category;
      root.querySelectorAll('[data-category]').forEach((item) => item.classList.toggle('active', item === button));
      renderProducts();
    }));
    renderProducts();
  }

  async function load() {
    const slug = decodeURIComponent(globalThis.location.pathname.split('/').filter(Boolean).pop() || '');
    try {
      const response = await SecurityHttp.secureFetch(`/api/public/tiendas/${encodeURIComponent(slug)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw SecurityHttp.errorFromResponse(response, data, 'La tienda no está disponible.');
      catalog = data;
      render();
    } catch (_) {
      root.innerHTML = '<section class="storefront-unavailable"><img src="/assets/administrau-icon.png" alt=""><p class="eyebrow">TIENDA NO DISPONIBLE</p><h1>Este catálogo no está publicado</h1><p>Puede estar en preparación o el enlace ya no está activo. Consulta con la tienda para recibir el enlace correcto.</p></section>';
    }
  }

  void load();
}());
