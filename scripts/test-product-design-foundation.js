const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const design = read('DESIGN.md');
const skill = read('.codex/skills/product-design-review/SKILL.md');

const designSections = ['Modo Operate y audiencia', 'Auditoria base P7A', 'Tokens vigentes', 'Vocabulario de componentes', 'Jerarquia y copy', 'Estados y motion', 'Responsive y accesibilidad', 'Checklist de revision'];
const skillChecks = ['name: product-design-review', 'DESIGN.md', 'P0 bloqueante', 'P1 importante', 'P2 menor', 'P3 polish', 'Heuristicas de evaluacion', '360x800, 768x1024 y 1366x768'];

for (const section of designSections) assert(design.includes(section), `Falta la seccion ${section}.`);
for (const check of skillChecks) assert(skill.includes(check), `Falta el contrato ${check}.`);
for (const existingSkill of ['browser-harness', 'multitenant-security-review', 'project-navigator', 'release-close', 'safe-migration', 'test-and-cleanup']) {
  assert(fs.existsSync(path.join(root, '.codex', 'skills', existingSkill, 'SKILL.md')), `No se conserva la skill ${existingSkill}.`);
}

console.log('test:product-design-foundation OK');
