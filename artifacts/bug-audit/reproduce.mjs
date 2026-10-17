// Review-only probes: assert intended behavior, without changing production files or the normal suite.
// Run from repository root: node artifacts/bug-audit/reproduce.mjs
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { applyTurn, applyReplacement, initBattle, compilePack } from '../../packages/battle-core/src/index.ts';
import { parseSoulmarkText } from '../../tools/soulmark-parse.mjs';
import { InProcessTransitionExecutor } from '../../packages/host/src/executor.ts';

const read = p => JSON.parse(readFileSync(new URL(`../../content/${p}`, import.meta.url), 'utf8'));
const raw = () => {
  const r = {
    ruleset: read('rulesets/synthetic-v2.json'), pack: read('synthetic-v2/pack.json'),
    units: read('synthetic-v2/units.json'), moves: read('synthetic-v2/moves.json'),
    typeChart: read('rulesets/typechart.json'), natures: read('rulesets/natures.json'),
    seals: read('seals/seals.json'), soulmarks: read('synthetic-v2/soulmarks.json'),
  };
  for (const u of r.units.units) { delete u.soulMark; delete u.revives; }
  for (const u of r.units.units.filter(u => ['syn-gamma','syn-delta','syn-epsilon'].includes(u.id))) {
    u.moveIds = ['syn-strike','syn-jab','syn-hex','syn-blast'];
  }
  // Fixed damage makes expectations independent of critical hits and type multipliers.
  r.moves.moves.find(m => m.id === 'syn-strike').effects = [{op:'damage',kind:'fixed',power:10}];
  delete r.moves.moves.find(m => m.id === 'syn-strike').category;
  r.moves.moves.find(m => m.id === 'syn-hex').effects = [{op:'heal',flat:1,target:'self'}];
  return r;
};
const mark = (r, id, effects) => r.soulmarks.soulmarks[id] = {id,name:id,effects};
const act = id => ({actionId:`act_${id}`,origin:'player',idempotencyKey:'audit-action'});
const ok = r => { if (!r.ok) throw r.fault; return r; };
const init = (pack, options = {}) => {
  const s = initBattle(pack, {battleId:'btl_audit',seedHex:'22222222222222222222222222222222',p1:'syn-gamma',p2:'syn-delta',...options});
  s.sides.p1.unit.base.spd = 200; s.sides.p2.unit.base.spd = 100;
  return s;
};
const turn = (p,s,a='syn-hex',b='syn-hex') => ok(applyTurn(p,s,{p1:act(a),p2:act(b)}));
const smEvents = (r, hook, side) => r.events.filter(e => e.type === 'soulmark' && e.detail.effect === `hook:${hook}` && (!side || e.detail.side === side));
const results = [];
function probe(id, run) {
  let evidence;
  try { run(v => evidence = v); results.push({id,status:'PASS',evidence}); }
  catch(e) { results.push({id,status:'FAIL',evidence,error:e.message}); }
}

probe('control-normal-entry', record => {
  const r=raw(); mark(r,'sm-audit-entry',[{hook:'onEntry',ops:[{op:'apply_stat_stage',stat:'atk',delta:1,target:'self'}]}]);
  const p=compilePack(r); const s=init(p,{bench:{p1:['syn-epsilon']},mechanics:{soulmark:{p1:[undefined,'sm-audit-entry']}}});
  const out=turn(p,s,'switch-0'); record({atk:out.state.sides.p1.unit.stages.atk});
  assert.equal(out.state.sides.p1.unit.stages.atk,1);
});

probe('control-starting-passive', record => {
  const p=compilePack(raw()); const s=init(p,{mechanics:{soulmark:{p1:['sm-passive-ward']}}});
  const out=turn(p,s); const effects=out.state.sides.p1.unit.effects.map(e=>e.kind); record({effects});
  assert.ok(effects.includes('dmg_taken_down'));
});

probe('control-normal-on-move-used', record => {
  const p=compilePack(raw()); const s=init(p,{mechanics:{soulmark:{p1:['sm-hook-use']}}});
  const out=turn(p,s,'syn-strike'); const count=smEvents(out,'onMoveUsed','p1').length; record({count});
  assert.ok(count>0);
});

probe('control-host-normal-turn', record => {
  const p=compilePack(raw()); const s=init(p);
  const out=new InProcessTransitionExecutor(p.rules.executableHash).applyTurn(p,s,{p1:act('syn-strike'),p2:act('syn-hex')});
  record({ok:out.ok}); assert.equal(out.ok,true);
});

probe('host-rejects-valid-pp-delta-event', record => {
  const r=raw(); r.moves.moves.find(m=>m.id==='syn-hex').effects=[{op:'pp_delta',amount:-1,target:'opponent',scope:'all'}];
  const p=compilePack(r); const s=init(p);
  const core=turn(p,s); const types=[...new Set(core.events.map(e=>e.type))];
  record({coreOk:core.ok,types}); assert.ok(types.includes('pp-delta'));
  const out=new InProcessTransitionExecutor(p.rules.executableHash).applyTurn(p,s,{p1:act('syn-hex'),p2:act('syn-hex')});
  assert.equal(out.ok,true,'host must accept valid engine events');
});

probe('initial-entry-hook', record => {
  const r = raw(); mark(r,'sm-audit-entry',[{hook:'onEntry',ops:[{op:'apply_stat_stage',stat:'atk',delta:1,target:'self'}]}]);
  const p = compilePack(r); const s = init(p,{mechanics:{soulmark:{p1:['sm-audit-entry']}}});
  const out = turn(p,s); record({atk:out.state.sides.p1.unit.stages.atk,entryEvents:smEvents(out,'onEntry').length});
  assert.equal(out.state.sides.p1.unit.stages.atk,1,'a starting unit must receive its entry effect');
});

probe('bench-passive-initialization', record => {
  const p = compilePack(raw());
  const s = init(p,{bench:{p1:['syn-epsilon']},mechanics:{soulmark:{p1:[undefined,'sm-passive-ward']}}});
  const a = turn(p,s); const b = turn(p,a.state,'switch-0'); const c = turn(p,b.state);
  const effects = c.state.sides.p1.unit.effects.map(e=>e.kind); record({turn:c.state.turn,effects});
  assert.ok(effects.includes('dmg_taken_down'),'a bench unit must have its permanent passive after entering');
});

probe('replacement-resumes-on-move-used', record => {
  const r = raw(); mark(r,'sm-audit-start',[
    {hook:'onTurnStart',ops:[{op:'damage',kind:'fixed',power:10,target:'opponent'}]},
    {hook:'onMoveUsed',actor:'self',ops:[{op:'apply_stat_stage',stat:'atk',delta:1,target:'self'}]},
  ]);
  const p = compilePack(r);
  const s = init(p,{bench:{p1:['syn-epsilon']},mechanics:{soulmark:{p2:['sm-audit-start']}}});
  // p1 dies before either action; p2's declared strike must resume after replacement.
  s.sides.p1.unit.currentHp = 1;
  const a = turn(p,s,'syn-hex','syn-strike'); assert.equal(a.state.suspension?.koSide,'p1');
  const b = ok(applyReplacement(p,a.state,{p1:act('switch-0'),p2:null}));
  record({actions:b.events.filter(e=>e.type==='action-declared'),soulHooks:smEvents(b,'onMoveUsed','p2').length});
  assert.equal(smEvents(b,'onMoveUsed','p2').length,1,'resumed attacks must dispatch onMoveUsed');
});

probe('forced-switch-entry-hook', record => {
  const r = raw(); mark(r,'sm-audit-entry',[{hook:'onEntry',ops:[{op:'apply_stat_stage',stat:'atk',delta:1,target:'self'}]}]);
  r.moves.moves.find(m=>m.id==='syn-hex').effects=[{op:'force_switch',target:'opponent'}];
  const p=compilePack(r); const s=init(p,{bench:{p2:['syn-epsilon']},mechanics:{soulmark:{p2:[undefined,'sm-audit-entry']}}});
  const out=turn(p,s,'syn-hex','syn-strike');
  record({species:out.state.sides.p2.unit.speciesId,atk:out.state.sides.p2.unit.stages.atk,entryEvents:smEvents(out,'onEntry').length});
  assert.equal(out.state.sides.p2.unit.speciesId,'syn-epsilon');
  assert.equal(out.state.sides.p2.unit.stages.atk,1,'forced entry must dispatch entry hooks');
});

probe('reactive-lethal-damage-suspends-action', record => {
  const p=compilePack(raw()); const s=init(p,{bench:{p1:['syn-epsilon']}});
  s.sides.p1.unit.currentHp=1;
  s.sides.p2.unit.effects.push({kind:'react',effectInstanceId:'efx_audit_react',params:{trigger:3,count:1},payload:[{op:'damage',kind:'fixed',power:10,target:'opponent'}]});
  const out=turn(p,s,'syn-strike','syn-hex');
  record({hp:out.state.sides.p1.unit.currentHp,suspension:out.state.suspension,damage:out.events.filter(e=>e.type==='damage')});
  assert.ok(!out.events.some(e=>e.type==='damage'&&e.detail.side==='p2'),'an actor killed by the declaration reaction must not attack');
});

probe('turn-end-resumes-remaining-hooks', record => {
  const r=raw(); mark(r,'sm-audit-end',[
    {hook:'onTurnEnd',ops:[{op:'damage',kind:'fixed',power:10,target:'opponent'}]},
    {hook:'onTurnEnd',ops:[{op:'apply_stat_stage',stat:'atk',delta:1,target:'self'}]},
  ]);
  const p=compilePack(r); const s=init(p,{bench:{p2:['syn-epsilon']},mechanics:{soulmark:{p1:['sm-audit-end']}}});
  s.sides.p2.unit.currentHp=1;
  const a=turn(p,s,'syn-hex','syn-strike'); assert.equal(a.state.suspension?.koSide,'p2');
  const b=ok(applyReplacement(p,a.state,{p1:null,p2:act('switch-0')}));
  record({suspension:a.state.suspension,atk:b.state.sides.p1.unit.stages.atk,turn:b.state.turn});
  assert.equal(b.state.sides.p1.unit.stages.atk,1,'pending turn-end effects must not be lost at replacement');
});

probe('first-turn-endure-restores-stages', record => {
  const r=raw(); r.moves.moves.find(m=>m.id==='syn-hex').effects=[{op:'apply_stat_stage',stat:'atk',delta:3,target:'self'}];
  const p=compilePack(r); const s=init(p,{mechanics:{soulmark:{p1:['sm-holy-guard']}}});
  s.sides.p1.unit.currentHp=1;
  const out=turn(p,s,'syn-hex','syn-strike'); record({hp:out.state.sides.p1.unit.currentHp,atk:out.state.sides.p1.unit.stages.atk,soulEvents:out.events.filter(e=>e.type==='soulmark')});
  assert.ok(out.events.some(e=>e.type==='soulmark'&&e.detail.effect==='endure_rewind'),'fixture must actually trigger rewind');
  assert.equal(out.state.sides.p1.unit.stages.atk,0,'first-turn rewind must restore initial zero stages');
});

probe('mutual-on-damaged-respects-effect-budget', record => {
  const r=raw(); mark(r,'sm-audit-react',[{hook:'onDamaged',ops:[
    {op:'heal',flat:1,target:'self'},
    {op:'damage',kind:'fixed',power:1,target:'opponent'},
  ]}]);
  const p=compilePack(r); const s=init(p,{mechanics:{soulmark:{p1:['sm-audit-react'],p2:['sm-audit-react']}}});
  let out;
  try { out=applyTurn(p,s,{p1:act('syn-strike'),p2:act('syn-hex')}); }
  catch(e) { record({exception:e.name,message:e.message}); throw e; }
  record({ok:out.ok,fault:out.fault?.reason});
  assert.equal(out.ok,false,'unbounded reactive chains must be stopped by the effect budget');
  assert.equal(out.fault.reason,'EFFECT_LIMIT');
});

probe('parser-foe-order-condition', record => {
  const first=parseSoulmarkText('对手先出手时恢复自身100点体力');
  const last=parseSoulmarkText('对手后出手时恢复自身100点体力');
  const creature=read('creatures/creatures.json').creatures['pet-4613'];
  const real=parseSoulmarkText(creature.soulMark.text);
  record({first,last,real:{id:'pet-4613',name:creature.name,text:creature.soulMark.text,entries:real.entries}});
  assert.notDeepEqual(first.entries,last.entries,'opposite order conditions must not compile into identical effects');
});

for (const r of results) console.log(`${r.status} ${r.id}${r.error ? `: ${r.error.split('\n')[0]}` : ''}`);
console.log(`${results.filter(r=>r.status==='PASS').length} passed; ${results.filter(r=>r.status==='FAIL').length} failed. Details: artifacts/bug-audit/results.json`);
writeFileSync(new URL('./results.json',import.meta.url),JSON.stringify(results,null,2)+'\n');
process.exitCode=results.some(r=>r.status==='FAIL')?1:0;
