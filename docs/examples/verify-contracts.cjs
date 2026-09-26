// Usage: node docs/examples/verify-contracts.cjs /absolute/path/to/temporary/tools
// Install typescript@6.0.3 and ajv@8.17.1 there first. This checks an example only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
if (!process.argv[2]) throw new Error('Expected temporary tools directory');
const deps = path.join(path.resolve(process.argv[2]), 'node_modules');
const Ajv = require(path.join(deps, 'ajv'));
const ts = require(path.join(deps, 'typescript'));
const source = fs.readFileSync(path.join(__dirname, 'contracts.ts'), 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
// Evaluate only the adjacent, repository-owned contract example; never external content.
const mod = { exports: {} };
new Function('module', 'exports', js)(mod, mod.exports);
const { commandSchema, sampleCommand } = mod.exports;
const validate = new Ajv({ strict: true, allErrors: true }).compile(commandSchema);
let cases = 0;
function check(name, value, expected) {
  assert.equal(validate(value), expected, name);
  cases++;
}
check('valid', sampleCommand, true);
check('zero revision', { ...sampleCommand, baseRevision: 0 }, true);
check('safe maximum', { ...sampleCommand, baseRevision: Number.MAX_SAFE_INTEGER }, true);
for (const key of Object.keys(sampleCommand)) {
  const data = { ...sampleCommand };
  delete data[key];
  check('missing ' + key, data, false);
}
check('actor injection', { ...sampleCommand, actorId: 'p2' }, false);
check('command injection', { ...sampleCommand, command: { op: 'set_hp', value: 99 } }, false);
check('future version', { ...sampleCommand, schemaVersion: 2 }, false);
check('negative revision', { ...sampleCommand, baseRevision: -1 }, false);
check('fraction revision', { ...sampleCommand, baseRevision: 0.5 }, false);
check('unsafe revision', { ...sampleCommand, baseRevision: 9007199254740992 }, false);
check('no coercion', { ...sampleCommand, baseRevision: '0' }, false);
check('empty action', { ...sampleCommand, actionId: '' }, false);
check('oversize action', { ...sampleCommand, actionId: 'a'.repeat(97) }, false);
check('path as ID', { ...sampleCommand, battleId: '../../hidden' }, false);
check('short key', { ...sampleCommand, idempotencyKey: 'retry' }, false);
check('null', null, false);
check('array', [], false);
console.log(JSON.stringify({
  status: 'PASS', cases, typescript: ts.version,
  ajv: require(path.join(deps, 'ajv/package.json')).version,
  scope: 'Command JSON Schema only; no battle, privacy, Cordis or performance test'
}));
