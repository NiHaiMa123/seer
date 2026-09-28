// artifacts/seals-raw.json (SMW ask 抓取) → content/seals/seals.json
const fs = require('fs');
const raw = JSON.parse(fs.readFileSync('artifacts/seals-raw.json', 'utf8'));
const S = { '初始攻击': 'atk', '初始防御': 'def', '初始特攻': 'spa', '初始特防': 'sdf', '初始速度': 'spd', '初始体力': 'hp' };
const H = { '隐藏攻击': 'atk', '隐藏防御': 'def', '隐藏特攻': 'spa', '隐藏特防': 'sdf', '隐藏速度': 'spd', '隐藏体力': 'hp' };
const num = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v));
const out = {};
let skipped = 0;
for (const [key, v] of Object.entries(raw)) {
  const p = v.printouts;
  const type = p['类型']?.[0] ?? '';
  const name = p['名称']?.[0] ?? key;
  const idNum = key.split(':')[1];
  if (type === '碎片') { skipped++; continue; }
  const init = {}, hid = {}, stats = {};
  for (const [f, k] of Object.entries(S)) { const n = num(p[f]?.[0]); init[k] = n; }
  for (const [f, k] of Object.entries(H)) { const n = num(p[f]?.[0]); hid[k] = n; }
  for (const k of Object.keys(init)) stats[k] = init[k] + hid[k];
  const entry = {
    id: `seal-${idNum}`,
    name, type,
    ...(p['系列名称']?.[0] ? { series: p['系列名称'][0] } : {}),
    stats,
    ...(Object.values(hid).some(x => x > 0) ? { hidden: hid } : {}),
    ...(p['专属精灵']?.[0] ? { exclusive: p['专属精灵'][0] } : {}),
    ...(p['描述']?.[0] ? { desc: String(p['描述'][0]).slice(0, 200) } : {}),
  };
  out[entry.id] = entry;
}
fs.mkdirSync('content/seals', { recursive: true });
fs.writeFileSync('content/seals/seals.json', JSON.stringify({ seals: out }, null, 0));
const types = {};
for (const s of Object.values(out)) types[s.type] = (types[s.type] || 0) + 1;
console.log('written', Object.keys(out).length, 'skipped 碎片:', skipped, 'types:', types);
console.log('bytes:', fs.statSync('content/seals/seals.json').size);
