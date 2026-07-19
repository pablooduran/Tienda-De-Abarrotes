const helmet = require('helmet');

function securityHeaders({ production }) {
  const directives = {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'"],
    imgSrc: ["'self'", 'data:'],
    connectSrc: ["'self'"],
    fontSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    frameAncestors: ["'none'"],
    frameSrc: ["'none'"],
    formAction: ["'self'"],
    manifestSrc: ["'self'"],
    workerSrc: ["'none'"]
  };
  if (production) directives.upgradeInsecureRequests = [];
  return helmet({
    contentSecurityPolicy: { directives },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    dnsPrefetchControl: { allow: false },
    frameguard: { action: 'deny' },
    hsts: production ? { maxAge: 31536000, includeSubDomains: true, preload: false } : false,
    originAgentCluster: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xContentTypeOptions: true
  });
}

function permissionsPolicy(req, res, next) {
  res.setHeader(
    'Permissions-Policy',
    'camera=(), geolocation=(), microphone=(), payment=(), usb=(), browsing-topics=()'
  );
  next();
}

module.exports = { permissionsPolicy, securityHeaders };
