const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }
function assert(condition, message) { if (!condition) throw new Error(message); }

const service = read('services/store-configuration-service.js');
const route = read('routes/store-configuration.js');
const app = read('public/js/app.js');
const ui = read('public/js/store-configuration-ui.js');
const html = read('public/app.html');
assert(service.includes('normalizeOnboardingPatch') && service.includes('configuracionTienda'), 'P5 no reutiliza el contrato real.');
assert(route.includes('req.tenant.idTienda') && !route.includes('req.body.idTienda'), 'El tenant no se deriva solo del backend.');
assert(app.includes("['configuracion', 'Configuracion'"), 'La configuracion no esta en el menu del propietario.');
assert(app.includes("!['ventas', 'clientes', 'configuracion', 'ayuda'].includes(id)")
  && app.includes('isReadOnly: () => Boolean(state.context?.soloLectura)'), 'Configuracion no conserva el acceso de solo lectura.');
assert(ui.includes("'Guardar cambios'") && ui.includes("'Guardando...'"), 'Falta el estado de mutacion de configuracion.');
assert(html.includes('/js/store-configuration-ui.js'), 'La UI de configuracion no esta cargada.');
console.log('Configuracion de tienda: contrato, tenant y UI verificados.');
