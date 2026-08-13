const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('public/js/app.js');
const ui = read('public/js/ui-patterns.js');
const html = read('public/app.html');
const css = read('public/css/styles.css');
const checks = [
  ['helper UX cargado antes de app', html.indexOf('/js/ui-patterns.js') < html.indexOf('/js/app.js')],
  ['errores usan mensajes seguros', app.includes('UiPatterns.messageFor(error)')],
  ['skeleton y estados vacios reutilizables', ui.includes('function skeleton') && ui.includes('function empty')],
  ['mutaciones bloquean doble envio', ui.includes('button.disabled = true') && app.includes('UiPatterns.mutation')],
  ['skeleton respeta reduced motion', css.includes('prefers-reduced-motion') && css.includes('.ui-skeleton')],
  ['filtros compactos tienen indicador y limpieza', css.includes('.filter-disclosure') && css.includes('.filter-count')],
  ['foco visible y estados accesibles', css.includes('.filter-disclosure > summary') && ui.includes('role="status"')]
];
checks.forEach(([name, ok]) => console.log(`${ok ? 'OK' : 'FALLO'}: ${name}`));
if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
