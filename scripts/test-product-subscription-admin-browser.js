const { execFileSync } = require('child_process');
const path = require('path');

const scripts = [
  'test-subscription-plan-browser.js',
  'test-saas-subscription-admin-browser.js',
  'test-saas-c-payment-browser.js'
];

for (const script of scripts) {
  execFileSync(process.execPath, [path.join(__dirname, script)], { stdio: 'inherit' });
}

console.log('test:product-subscription-admin-browser OK');
