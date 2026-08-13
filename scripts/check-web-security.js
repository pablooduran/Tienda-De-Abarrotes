const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));
const files = {
  server: read('server.js'),
  package: JSON.parse(read('package.json')),
  auth: read('routes/auth.js'),
  headers: read('middleware/security-headers.js'),
  requestSecurity: read('middleware/request-security.js'),
  rateLimits: read('middleware/rate-limiters.js'),
  requestContext: read('middleware/request-context.js'),
  errorHandler: read('middleware/error-handler.js'),
  logger: read('utils/security-logger.js'),
  env: read('config/env.js'),
  deployment: read('config/deployment.js'),
  rateLimitStore: read('services/rate-limit-store-service.js'),
  webConfig: read('config/web-security.js'),
  emailVerificationContract: read('config/email-verification-contract.js'),
  passwordRecoveryContract: read('config/password-recovery-contract.js'),
  httpSecurity: read('public/js/http-security.js'),
};

const checks = {};
const details = {};
function check(name, condition, detail = '') {
  checks[name] = Boolean(condition);
  if (detail) details[name] = detail;
}

const htmlFiles = fs.readdirSync(path.join(root, 'public')).filter((file) => file.endsWith('.html'));
const allHtmlSources = htmlFiles.map((file) => read(path.join('public', file)));
const allHtml = allHtmlSources.join('\n');
const allFrontend = fs.readdirSync(path.join(root, 'public', 'js'))
  .filter((file) => file.endsWith('.js'))
  .map((file) => read(path.join('public', 'js', file)))
  .join('\n');
const routeFiles = fs.readdirSync(path.join(root, 'routes'))
  .filter((file) => file.endsWith('.js'));
const routeSource = routeFiles.map((file) => read(path.join('routes', file))).join('\n');
const directFetches = [...allFrontend.matchAll(/\bfetch\s*\(/g)].length;
const secureFetchDefinitions = [...allFrontend.matchAll(/global\.fetch\s*\(/g)].length;
const inlineScripts = [...allHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/gi)].length;
const inlineStyles = [...allHtml.matchAll(/\bstyle\s*=/gi)].length;
const inlineHandlers = [...allHtml.matchAll(/\bon[a-z]+\s*=/gi)].length;
const unsafeGetBlocks = [];

function routeCallEnd(source, start) {
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = source.indexOf('(', start); index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') { blockComment = false; index += 1; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '/' && next === '/') { lineComment = true; index += 1; continue; }
    if (character === '/' && next === '*') { blockComment = true; index += 1; continue; }
    if (character === '"' || character === "'" || character === '`') { quote = character; continue; }
    if (character === '(') depth += 1;
    if (character === ')') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return source.length;
}

for (const file of routeFiles) {
  const source = read(path.join('routes', file));
  const starts = [...source.matchAll(/router\.(get|post|put|patch|delete)\s*\(/g)];
  for (let index = 0; index < starts.length; index += 1) {
    if (starts[index][1] !== 'get') continue;
    const start = starts[index].index;
    const end = routeCallEnd(source, start);
    const block = source.slice(start, end);
    if (/\b(INSERT\s+INTO|UPDATE\s+[a-zA-Z`]|DELETE\s+FROM|\.beginTransaction\s*\()/i.test(block)) {
      unsafeGetBlocks.push(`${file}:${source.slice(0, start).split('\n').length}`);
    }
  }
}

check('helmetActivo', files.server.includes('securityHeaders(appSecurityConfig)'));
check('cspActiva', files.headers.includes('contentSecurityPolicy: { directives }')
  && !files.server.includes('contentSecurityPolicy: false'));
check('scriptSrcSinUnsafeInline', files.headers.includes('scriptSrc: ["\'self\'"]')
  && !/scriptSrc[^\n]*unsafe-inline/.test(files.headers));
check('scriptSrcSinUnsafeEval', !/unsafe-eval/.test(files.headers));
check('cspSinComodin', !/Src:\s*\[[^\]]*["']\*["']/.test(files.headers));
check('frameAncestorsNone', files.headers.includes('frameAncestors: ["\'none\'"]'));
check('objectSrcNone', files.headers.includes('objectSrc: ["\'none\'"]'));
check('hstsSoloProduccion', files.headers.includes('hsts: production ?') && files.headers.includes(': false'));
check('permissionsPolicy', files.server.includes('app.use(permissionsPolicy)'));
check('rateLimitDependency', Boolean(files.package.dependencies?.['express-rate-limit']));
check('rateLimitGeneral', files.server.includes("app.use('/api', rateLimiters.api)"));
check('rateLimitLoginEspecifico', files.server.includes("app.use('/auth/login', rateLimiters.loginIp, rateLimiters.loginIdentity)"));
check('rateLimitRegistroPublico', files.server.includes("app.use('/auth/registro', rateLimiters.publicRegistration)")
  && files.rateLimits.includes("identifier: 'public-registration'")
  && files.webConfig.includes('PUBLIC_REGISTRATION_RATE_LIMIT_MAX'));
check('rateLimitVerificacionCorreo', files.server.includes("app.use('/auth/verificar-correo', rateLimiters.emailVerificationConfirm)")
  && files.server.includes("app.use('/auth/reenviar-verificacion', rateLimiters.emailVerificationResendIp, rateLimiters.emailVerificationResendIdentity)")
  && files.rateLimits.includes("identifier: 'email-verification-confirm'")
  && files.rateLimits.includes("identifier: 'email-verification-resend-identity'")
  && files.emailVerificationContract.includes('EMAIL_VERIFICATION_TTL_HOURS'));
check('rateLimitRecuperacionPassword', files.server.includes("app.use('/auth/solicitar-recuperacion', rateLimiters.passwordRecoveryRequestIp, rateLimiters.passwordRecoveryRequestIdentity)")
  && files.server.includes("app.use('/auth/restablecer-password', rateLimiters.passwordRecoveryConfirmIp, rateLimiters.passwordRecoveryConfirmToken)")
  && files.rateLimits.includes("identifier: 'password-recovery-request-identity'")
  && files.rateLimits.includes("identifier: 'password-recovery-confirm-token'")
  && files.passwordRecoveryContract.includes('PASSWORD_RECOVERY_TTL_MINUTES'));
check('rateLimitExportacion', files.server.includes('rateLimiters.export'));
check('rateLimitWhatsapp', files.server.includes('rateLimiters.whatsapp'));
check('rateLimitPagosDedicado', files.server.includes("app.use('/api/pagos-suscripcion', rateLimiters.payment)")
  && files.server.includes("app.use('/api/admin/pagos-suscripcion', rateLimiters.paymentAdmin)")
  && files.rateLimits.includes("identifier: 'payment-owner'")
  && files.rateLimits.includes("identifier: 'payment-admin'"));
check('rateLimitComprobantesDedicado', files.server.includes('rateLimiters.receiptUpload')
  && files.rateLimits.includes("identifier: 'payment-receipt-upload'")
  && files.webConfig.includes('RECEIPT_UPLOAD_RATE_LIMIT_MAX'));
check('rateLimitHealth', files.server.includes("app.use('/health', rateLimiters.health"));
check('healthInternoProtegido', files.server.includes(
  "app.use('/api/admin/health', requireAuth, requireRole('superadmin'), adminHealthRoutes)"
));
check('rateLimitProduccionObligatorio', files.webConfig.includes('RATE_LIMIT_ENABLED debe ser true'));
check('rateLimitDistribuidoHospedado', files.deployment.includes("configured !== 'redis'")
  && files.rateLimitStore.includes("require('rate-limit-redis')")
  && files.server.includes('storeFactory: rateLimitStore.storeFor'));
check('credencialesUniformes', files.auth.includes("error: 'Credenciales incorrectas.'")
  && !/res\.status\(403\).*tienda|res\.status\(403\).*administrador/is.test(files.auth));
check('comparacionDummy', files.auth.includes('dummyPasswordHash') && files.auth.includes('bcrypt.compare'));
check('origenProtegido', files.server.includes('mutationProtection(appSecurityConfig.trustedOrigins)'));
check('metodosMutablesProtegidos', files.requestSecurity.includes("new Set(['GET', 'HEAD', 'OPTIONS'])"));
check('encabezadoCsrfExigido', files.requestSecurity.includes("X-Requested-With")
  && files.requestSecurity.includes('CSRF_VALIDATION_FAILED'));
check('origenExternoRechazado', files.requestSecurity.includes('ORIGIN_NOT_ALLOWED'));
check('trustedOriginsSinWildcard', files.webConfig.includes("text.includes('*')"));
check('trustedOriginsObligatorioProduccion', files.webConfig.includes('En staging/production TRUSTED_ORIGINS es obligatorio'));
check('sameSiteLax', /sameSite:\s*['"]lax['"]/.test(files.server));
check('cookieHttpOnly', /httpOnly:\s*true/.test(files.server));
check('cookieSecureProduccion', /secure:\s*appDeploymentConfig\.secureCookies/.test(files.server));
check('secretoSesionProduccionEndurecido', files.env.includes('SESSION_SECRET de staging/production debe ser largo, aleatorio')
  && files.env.includes('value.length < 48'));
check('trustProxyExplicito', files.server.includes("app.set('trust proxy', appDeploymentConfig.trustProxy)")
  && files.deployment.includes('parseProxyCidrs')
  && !files.server.includes("app.set('trust proxy', true)"));
check('corsGlobalAusente', !/require\(['"]cors['"]\)|Access-Control-Allow-Origin|app\.use\(cors/i.test(files.server + routeSource));
check('cacheNoStore', files.server.includes('noStoreSensitiveResponses')
  && files.requestSecurity.includes("'Cache-Control', 'no-store, max-age=0'"));
check('requestId', files.server.includes('requestContext(securityLogger)')
  && files.requestContext.includes("'X-Request-Id'"));
check('requestIdNoConfiaEnExterno', files.requestContext.includes('crypto.randomUUID()')
  && !files.requestContext.includes("req.get('X-Request-Id')"));
check('errorHandlerFinal', files.server.includes('app.use(notFoundHandler)')
  && files.server.includes('app.use(createErrorHandler'));
check('error500GenericoGlobal', files.requestContext.includes("error: 'Ocurrio un error interno.'"));
check('loggerRedactaSecretos', /password\|contrasena/.test(files.logger)
  && /authorization\|cookie/.test(files.logger)
  && /db_ssl_ca/.test(files.logger));
check('loggerNoRegistraBody', /\|body\)/.test(files.logger));
check('frontendSeguroCargado', allHtmlSources.every((html) => html.includes('/js/http-security.js')),
  `HTML revisados: ${htmlFiles.length}`);
check('aliasSuscripcionProtegido', files.server.includes("app.get('/subscription.html', requireAuth")
  && files.requestSecurity.includes("'/subscription.html'"));
check('frontendEncabezadoCsrf', files.httpSecurity.includes("headers.set('X-Requested-With', 'XMLHttpRequest')"));
check('frontendManeja429', files.httpSecurity.includes('response.status === 429'));
check('frontendManejaSesionRevocada', files.httpSecurity.includes("body.code === 'SESSION_REVOKED'"));
check('frontendManejaRequestId', files.httpSecurity.includes('requestId'));
check('fetchDirectoCentralizado', directFetches === secureFetchDefinitions,
  `fetch directos: ${directFetches}; llamadas global.fetch centrales: ${secureFetchDefinitions}`);
check('sinScriptInline', inlineScripts === 0, `scripts inline: ${inlineScripts}`);
check('sinEstiloInlineHtml', inlineStyles === 0, `atributos style: ${inlineStyles}`);
check('sinHandlersInline', inlineHandlers === 0, `handlers inline: ${inlineHandlers}`);
check('getSinEscrituraEvidente', unsafeGetBlocks.length === 0,
  unsafeGetBlocks.length ? unsafeGetBlocks.join(', ') : 'Sin escrituras SQL evidentes dentro de handlers GET.');
check('scriptsNpmPresentes', files.package.scripts?.['test:web-security']
  && files.package.scripts?.['check:web-security']);
check('archivosCentralesPresentes', [
  'middleware/error-handler.js', 'middleware/rate-limiters.js', 'middleware/request-context.js',
  'middleware/request-security.js', 'middleware/security-headers.js', 'utils/security-logger.js'
].every(exists));

const invalid = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
console.log(JSON.stringify({
  entorno: process.env.APP_ENV || 'no_definido',
  comprobaciones: checks,
  detalles: details,
  metricas: {
    archivosRutas: routeFiles.length,
    fetchDirectos: directFetches,
    scriptsInline: inlineScripts,
    estilosInlineHtml: inlineStyles,
    handlersInline: inlineHandlers,
    getConEscrituraEvidente: unsafeGetBlocks.length
  },
  estado: invalid.length ? 'incompleto' : 'correcto',
  incumplimientos: invalid
}, null, 2));

if (invalid.length) process.exitCode = 1;
