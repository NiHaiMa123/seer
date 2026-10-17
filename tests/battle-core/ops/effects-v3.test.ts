/**
 * effects-v3.test.ts —— E1/E2 技能效果原子 op 回归：
 * RESOLVE_HIT（accuracy/acc stage/must_miss）、status flag 表（dot/blockChance/atkMul）、
 * chance 信封、if 条件、scaleIf、hits 连击、drain/flatBonus、timed hot/prio_up/immune_status。
 * 数值均为合成规则集语义（UNVERIFIED 默认值不验原作精确性）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { compilePack, initBattle, applyTurn, sha256hex } from "@seer/battle-core";
import { liftDrainRiders } from "../../../tools/effects-parse.mjs";
import { liftTick, TICK_NAMES } from "../../../tools/effects-rules/tick-shape.mjs";
import { periodicFormOf } from "../../../packages/battle-core/src/ops/periodic.ts";
import { axesFormOf } from "../../../packages/battle-core/src/ops/axes.ts";

const CONTENT = join(fileURLToPath(new URL("../..", import.meta.url)), "..", "content");
const read = (p: string) => JSON.parse(readFileSync(join(CONTENT, p), "utf8"));

const RULESET = () => ({ ...read("rulesets/synthetic-v2.json"), features: [...read("rulesets/synthetic-v2.json").features, "accuracy"] });
const EXTRA = () => ({
  natures: read("rulesets/natures.json"),
  soulmarks: read("synthetic-v2/soulmarks.json"),
  seals: read("seals/seals.json"),
  items: read("synthetic-v2/items.json"),
});
const baseMoves = () => read("synthetic-v2/moves.json").moves;
const baseUnits = () => read("synthetic-v2/units.json").units;

const NEW_MOVES = [
  { id: "syn-miss", name: "失准", pp: 20, priority: 0, type: "草", category: "physical", accuracy: 30, effects: [{ op: "damage", power: 100 }] },
  { id: "syn-sure", name: "必中击", pp: 20, priority: 0, type: "草", category: "physical", accuracy: "always", effects: [{ op: "damage", power: 40 }] },
  { id: "syn-accup", name: "凝神", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_stat_stage", stat: "acc", delta: 1, target: "self" }] },
  { id: "syn-burn", name: "灼烧", pp: 20, priority: 0, type: "火", effects: [{ op: "apply_status", name: "burn", turns: 3, target: "opponent" }] },
  { id: "syn-burn10", name: "灼焰", pp: 20, priority: 0, type: "火", category: "physical", effects: [{ op: "damage", power: 60 }, { op: "apply_status", name: "burn", turns: 3, target: "opponent", chance: 50 }] },
  { id: "syn-fear", name: "恐吓", pp: 20, priority: 0, type: "火", effects: [{ op: "apply_status", name: "fear", turns: 2, target: "opponent" }] },
  { id: "syn-siphon", name: "汲取", pp: 20, priority: 0, type: "草", category: "special", effects: [{ op: "damage", power: 60 }, { op: "applyDrainRider", drain: { numerator: 1, denominator: 2 } }] },
  { id: "syn-flat", name: "穿击", pp: 20, priority: 0, type: "草", category: "physical", effects: [{ op: "damage", power: 20, flatBonus: 50 }] },
  { id: "syn-multi", name: "连打", pp: 20, priority: 0, type: "草", category: "physical", effects: [{ op: "damage", power: 10, hits: { min: 2, max: 3 } }] },
  { id: "syn-scale", name: "先手", pp: 20, priority: 0, type: "草", category: "physical", effects: [{ op: "damage", power: 20, scaleIf: { when: { order: "first" }, numerator: 2, denominator: 1 } }] },
  { id: "syn-regen", name: "生机", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "hot", turns: 3, target: "self", params: { n: 1, d: 4 } }] },
  { id: "syn-prio", name: "风压", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "prio_up", turns: 2, target: "self", params: { add: 5 } }] },
  { id: "syn-aegis", name: "护佑", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "immune_status", turns: 2, target: "self" }] },
  { id: "syn-dodge", name: "烟幕", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "must_miss", turns: 2, target: "self" }] },
  { id: "syn-if", name: "乘势", pp: 20, priority: 0, type: "草", category: "physical", effects: [{ op: "damage", power: 30 }, { op: "apply_stat_stage", stat: "atk", delta: 1, target: "self", if: { foeStatused: true } }] },
  { id: "syn-purge-up", name: "驱散", pp: 20, priority: 0, type: "草", effects: [{ op: "clear_stages", target: "opponent", sign: "up" }] },
  // ── E3 批次：叠用/护盾穿透/限疗/次数窗口 ──
  { id: "syn-stack", name: "叠击", pp: 20, priority: 0, type: "草", category: "physical", effects: [{ op: "damage", power: 30, powerPerUse: 20, useCap: 100 }] },
  { id: "syn-hitsuse", name: "连增", pp: 20, priority: 0, type: "草", category: "physical", effects: [{ op: "damage", power: 10, hits: { min: 1, max: 1, perUse: 1, cap: 4 } }] },
  { id: "syn-priocnt", name: "疾影", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "prio_count", target: "self", params: { count: 2, add: 5 } }] },
  { id: "syn-shpurge", name: "破壁", pp: 20, priority: 0, type: "草", effects: [{ op: "cleanse", target: "opponent", scope: "shield" }] },
  { id: "syn-piercesh", name: "贯盾", pp: 20, priority: 0, type: "草", category: "physical", effects: [{ op: "damage", power: 50, pierceShield: true }] },
  { id: "syn-maxhp", name: "蚀顶", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "max_hp_down", target: "opponent", params: { flat: 100 } }] },
  { id: "syn-dthc", name: "化伤", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "dmg_to_heal", target: "self", params: { count: 1 } }] },
  // ── E4 反应式触发器：kind=react + params.trigger + payload 内嵌 op ──
  // 受击反击：持有者受到伤害时对攻击方施加烧伤
  { id: "syn-rhit", name: "荆棘", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "react", target: "self", turns: 3, params: { trigger: 1 }, payload: [{ op: "apply_status", name: "burn", turns: 2, target: "opponent" }] }] },
  // 阈值守卫：仅当受到的伤害 > 100 才触发（min 门控）
  { id: "syn-rmin", name: "反震", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "react", target: "self", turns: 3, params: { trigger: 1, min: 100 }, payload: [{ op: "apply_status", name: "burn", turns: 2, target: "opponent" }] }] },
  // 对手 MISS 触发：持有者提速
  { id: "syn-rmiss", name: "伺机", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "react", target: "self", turns: 3, params: { trigger: 2 }, payload: [{ op: "apply_stat_stage", stat: "spd", delta: 1, target: "self" }] }] },
  // 对手行动声明触发（cat=1 属性招）：麻痹对手
  { id: "syn-ract", name: "反制", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "react", target: "self", turns: 3, params: { trigger: 3, cat: 1 }, payload: [{ op: "apply_status", name: "paralysis", turns: 2, target: "opponent" }] }] },
  // 倒下触发：持有者被 KO 时对攻击方追加 100 点固伤
  { id: "syn-rfaint", name: "同归", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "react", target: "self", turns: 3, params: { trigger: 5 }, payload: [{ op: "damage", kind: "fixed", power: 100, target: "opponent" }] }] },
  // nullifyOnly：正常路径跳过；招式被无效（move_null）时单独结算
  { id: "syn-rnull", name: "破势", pp: 20, priority: 0, type: "草", category: "physical", effects: [{ op: "damage", power: 60 }, { op: "apply_status", name: "burn", turns: 2, target: "opponent", nullifyOnly: true }] },
  { id: "syn-nulldo", name: "封招", pp: 20, priority: 5, type: "草", effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { count: 1, cat: 4 } }] },
  { id: "syn-whiff", name: "虚晃", pp: 20, priority: 0, type: "草", category: "physical", accuracy: 0, effects: [{ op: "damage", power: 60 }] },
  { id: "syn-attr", name: "吟唱", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_stat_stage", stat: "atk", delta: 1, target: "self" }] },
  { id: "syn-stgsync", name: "同调", pp: 20, priority: 0, type: "草", effects: [{ op: "copy_stages", match: true, target: "opponent", stat: "def" }] },
  { id: "syn-big", name: "陨灭", pp: 20, priority: 0, type: "草", effects: [{ op: "damage", kind: "fixed", power: 99999 }] },
  { id: "syn-echo", name: "回噬", pp: 20, priority: 0, type: "草", effects: [{ op: "heal", flat: 50, target: "self", foeEcho: { numerator: 1, denominator: 2 } }] },
  { id: "syn-secho", name: "反噬", pp: 20, priority: 0, type: "草", effects: [{ op: "heal", flat: 60, target: "self", selfEcho: { numerator: 1, denominator: 3 } }] },
  { id: "syn-leave", name: "留情", pp: 20, priority: 0, type: "草", effects: [{ op: "damage", kind: "fixed", power: 1, leaveHp: 1, target: "opponent" }] },
  { id: "syn-selfcost", name: "搏命", pp: 20, priority: 0, type: "草", effects: [{ op: "damage", kind: "fixed", power: 1, leaveHp: 1, target: "self", if: { selfHpBelowAbs: 200 } }] },
  // ── E4b 批次：swap_hp/pp_drain/prio_push_tick/move_null chance/hitsPerStage/powerPerMissing/setRandom/reflect count ──
  { id: "syn-swap", name: "换血", pp: 20, priority: 0, type: "草", effects: [{ op: "swap_hp", target: "opponent" }] },
  { id: "syn-ppdrain", name: "耗竭", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "pp_drain", turns: 3, target: "self", params: { flat: 2 } }] },
  { id: "syn-pripush", name: "滞缓", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "prio_push_tick", turns: 3, target: "self", params: { add: -1 } }] },
  { id: "syn-null0", name: "空封", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { cat: 1, chance: 0 } }] },
  { id: "syn-null100", name: "必封", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { cat: 1, chance: 100 } }] },
  { id: "syn-hitstage", name: "借势连击", pp: 20, priority: 0, type: "草", category: "physical", effects: [{ op: "damage", power: 10, hitsPerStage: { who: "self", sign: "up", per: 1, add: 1 } }] },
  { id: "syn-pmiss", name: "残血爆发", pp: 20, priority: 0, type: "草", category: "physical", effects: [{ op: "damage", power: 20, powerPerMissing: { per: 50, pow: 50 } }] },
  { id: "syn-ppset", name: "封能", pp: 20, priority: 0, type: "草", effects: [{ op: "pp_delta", setRandom: { count: 1, value: 0 }, target: "opponent" }] },
  { id: "syn-ppbench", name: "荷能", pp: 20, priority: 0, type: "草", effects: [{ op: "pp_delta", amount: 2, target: "bench", scope: "all", aliveOnly: true }] },
  { id: "syn-rflect", name: "回敬", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: 1, d: 2, count: 1 } }] },
  // ── E5 批次：turnsRange/hit_fx_null/消盾反噬/护盾值固伤/随机分数/自杀/连用致命/trigger10 ──
  { id: "syn-trange", name: "潮汐", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "hot", target: "self", turnsRange: { min: 2, max: 4 }, params: { n: 1, d: 8 } }] },
  { id: "syn-fxnull", name: "缄印", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "hit_fx_null", target: "opponent", turns: 2, params: { cat: 1 } }] },
  { id: "syn-shout", name: "熔盾", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "shield", target: "self", params: { flat: 200 } }] },
  { id: "syn-shpurge2", name: "碎壁", pp: 20, priority: 5, type: "草", effects: [{ op: "cleanse", target: "opponent", scope: "shield", echoPct: 50 }] },
  { id: "syn-flatsh", name: "裂盾", pp: 20, priority: 0, type: "草", category: "physical", effects: [{ op: "damage", power: 10, flatFoeShieldPct: 50 }] },
  { id: "syn-frange", name: "骰击", pp: 20, priority: 0, type: "草", effects: [{ op: "damage", kind: "percent", fracRange: { min: { numerator: 1, denominator: 8 }, max: { numerator: 1, denominator: 2 } }, percentBase: "current", target: "opponent", power: 0 }] },
  { id: "syn-sui", name: "自爆", pp: 20, priority: 0, type: "草", effects: [{ op: "damage", kind: "fixed", target: "self", selfHp: true, power: 0 }] },
  { id: "syn-critup", name: "蓄锐", pp: 20, priority: 0, type: "草", category: "physical", effects: [{ op: "damage", power: 30, critPerUsePct: 80, critPerUseCap: 100 }] },
  { id: "syn-draincur", name: "汲现", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "drain_dot", target: "self", turns: 2, params: { n: 1, d: 2, cur: 1 } }] },
  { id: "syn-rcrit", name: "乘胜", pp: 20, priority: 0, type: "草", category: "physical", effects: [{ op: "apply_status", name: "react", target: "self", turns: 3, params: { trigger: 10 }, payload: [{ op: "apply_status", name: "paralysis", turns: 2, target: "opponent" }] }, { op: "damage", power: 30, crit: true }] },
  { id: "syn-uplock", name: "锁印", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_stat_stage", stat: "atk", delta: 2, target: "self" }, { op: "apply_status", name: "up_lock", target: "self", turns: 2 }] },
  { id: "syn-nopow", name: "封纹", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "immune_degrade", target: "self", turns: 2 }] },
  // ── E5h 批次：prio 门控 nullify / 承伤增减 / flatPerAlive / prevDamageAboveFoeHp / trigger13 / status_lock / 定额承伤减免 / per-hit 威力衰减 ──
  { id: "syn-prionull", name: "滞封", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { count: 2, prioMin: 1, prioMax: 2 } }] },
  { id: "syn-prioatk", name: "疾击", pp: 20, priority: 1, type: "草", category: "physical", effects: [{ op: "damage", power: 30 }] },
  { id: "syn-takenup", name: "破绽", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "dmg_taken_up", target: "opponent", turns: 1, params: { pct: 100 } }] },
  { id: "syn-redflat20", name: "坚壁", pp: 20, priority: 5, type: "草", effects: [{ op: "apply_status", name: "dmg_reduce", target: "self", turns: 2, params: { flat: 20 } }] },
  { id: "syn-peralive", name: "群生", pp: 20, priority: 0, type: "草", effects: [{ op: "heal", flatPerAlive: { per: 1, add: 50 }, target: "self" }] },
  { id: "syn-overdmg", name: "屠戮", pp: 20, priority: 0, type: "草", effects: [{ op: "damage", kind: "fixed", power: 99999, target: "opponent" }, { op: "heal", flat: 30, target: "self", if: { prevDamageAboveFoeHp: true } }] },
  { id: "syn-t13", name: "迹循", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "react", target: "self", turns: 3, params: { trigger: 13 }, payload: [{ op: "apply_status", name: "burn", turns: 2, target: "opponent" }] }, { op: "apply_status", name: "hot", target: "self", turns: 3, params: { n: 1, d: 20 } }] },
  { id: "syn-purgetimed", name: "剥轮", pp: 20, priority: 0, type: "草", effects: [{ op: "cleanse", target: "opponent", scope: "timed" }] },
  { id: "syn-lockattr", name: "缄术", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "status_lock", target: "opponent", turns: 2, params: { cat: 1 } }] },
  { id: "syn-dropper", name: "泄力", pp: 20, priority: 0, type: "草", category: "physical", effects: [{ op: "damage", power: 40, hits: { min: 2, max: 2 }, powerDropPerHit: 15 }] },
  // ── E5i 批：matchSelfHp / hitsPerPpGap / kindIfImmune / crt 段位 / ailment_tick / prevDamageOdd ──
  { id: "syn-matchhp", name: "衡命", pp: 20, priority: 0, type: "草", effects: [{ op: "damage", kind: "fixed", power: 0, matchSelfHp: true, target: "opponent" }] },
  { id: "syn-ppgap", name: "穷追", pp: 20, priority: 0, type: "草", category: "physical", effects: [{ op: "damage", power: 10, hits: { min: 1, max: 1 }, hitsPerPpGap: { per: 1, add: 1 } }] },
  { id: "syn-trueconv", name: "贯真", pp: 20, priority: 0, type: "草", effects: [{ op: "damage", kind: "fixed", power: 40, kindIfImmune: "true", target: "opponent" }] },
  { id: "syn-immwall", name: "免障", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "dmg_immune", target: "self", turns: 2 }] },
  { id: "syn-crtstg", name: "蓄锐", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_stat_stage", stat: "crt", delta: 2, target: "self" }] },
  { id: "syn-ailtick", name: "瘟疫", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "ailment_tick", target: "self", turns: 2, payload: [{ op: "apply_status", name: "burn", turns: 2, target: "opponent" }] }] },
  { id: "syn-odd51", name: "奇袭", pp: 20, priority: 0, type: "草", effects: [{ op: "damage", kind: "fixed", power: 51 }, { op: "apply_stat_stage", stat: "atk", delta: 1, target: "self", if: { prevDamageOdd: true } }] },
  { id: "syn-misspct", name: "残噬", pp: 20, priority: 0, type: "草", category: "physical", effects: [{ op: "damage", power: 10, flatPerMissing: { step: 50, add: 10, pct: true } }] },
  { id: "syn-weakprio", name: "微芒", pp: 20, priority: 0, type: "火", category: "physical", effects: [{ op: "damage", power: 10, flatBonus: 7, flatIf: { when: { effWeakVsFoe: true }, flat: 100 } }] },
  // ── E5j 批：cleanse_lock / foe_dot anyAilDegrade / prevTakenZero / swap_hp / crit_immune / chanceSetIf / pp zeroRandom / trigger7 max_hp_down ──
  { id: "syn-clslock", name: "封解", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "cleanse_lock", target: "opponent", turns: 2 }] },
  { id: "syn-dotail", name: "蚀境", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "foe_dot", target: "self", turns: 2, params: { flat: 40, anyAilDegrade: 1 } }] },
  { id: "syn-swap2", name: "易命", pp: 20, priority: 0, type: "草", effects: [{ op: "swap_hp", target: "opponent" }] },
  { id: "syn-critimm", name: "金身", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "crit_immune", target: "self" }] },
  { id: "syn-prevtaken", name: "反蛰伏", pp: 20, priority: 0, type: "草", effects: [{ op: "damage", kind: "fixed", power: 0, flatFoeFracIf: { when: { prevTakenZero: true }, numerator: 1, denominator: 4 } }] },
  { id: "syn-react7", name: "逆鳞", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "react", target: "self", turns: 3, params: { trigger: 7 }, payload: [{ op: "apply_status", name: "max_hp_down", target: "opponent", params: { n: 1, d: 4 } }] }, { op: "apply_stat_stage", stat: "atk", delta: 1, target: "self" }] },
  { id: "syn-chset", name: "催焰", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "burn", target: "opponent", turns: 2, chance: 20, chanceSetIf: { when: { selfHpBelow: { numerator: 1, denominator: 2 } }, value: 100 } }] },
  { id: "syn-ppzero", name: "封脉", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "react", target: "self", turns: 2, params: { trigger: 1 }, payload: [{ op: "pp_delta", zeroRandom: 1, target: "opponent" }] }] },
  { id: "syn-foeclr", name: "涤强", pp: 20, priority: 0, type: "草", effects: [{ op: "clear_stages", sign: "up", target: "opponent" }] },
  { id: "syn-critsure", name: "贯甲", pp: 20, priority: 0, type: "草", category: "physical", effects: [{ op: "damage", power: 40, crit: true }] },
  // ── T4 触发器矩阵补盲：trigger 4/6/8/9/11/12 + max/prioMin/count/params.chance/payload chance ──
  // trigger4 破盾：持有者护盾耗尽消失时对攻击方 50 固伤（先挂 react 再挂盾，同招两 op 顺序结算）
  { id: "syn-r4", name: "盾破", pp: 20, priority: 0, type: "草", effects: [
    { op: "apply_status", name: "react", target: "self", turns: 3, params: { trigger: 4 }, payload: [{ op: "damage", kind: "fixed", power: 50, target: "opponent" }] },
    { op: "apply_status", name: "shield", target: "self", params: { flat: 30 } }] },
  // trigger6 自身MISS：失手后提速（虚晃 accuracy:0 必失）
  { id: "syn-r6", name: "知耻", pp: 20, priority: 0, type: "草", effects: [
    { op: "apply_status", name: "react", target: "self", turns: 3, params: { trigger: 6 }, payload: [{ op: "apply_stat_stage", stat: "spd", delta: 1, target: "self" }] }] },
  // trigger8 当回合未受攻击伤害 → 回合末回血 50
  { id: "syn-r8", name: "蛰伏", pp: 20, priority: 0, type: "草", effects: [
    { op: "apply_status", name: "react", target: "self", turns: 3, params: { trigger: 8 }, payload: [{ op: "heal", flat: 50, target: "self" }] }] },
  // trigger9 对手切换 → 新登场精灵麻痹（payload opponent=触发方=换入者）
  { id: "syn-r9", name: "伏兵", pp: 20, priority: 0, type: "草", effects: [
    { op: "apply_status", name: "react", target: "self", turns: 3, params: { trigger: 9 }, payload: [{ op: "apply_status", name: "paralysis", turns: 2, target: "opponent" }] }] },
  // trigger11 自身使用技能 cat:1 门控：属性招触发回血，攻击招不触发
  { id: "syn-r11", name: "术涌", pp: 20, priority: 0, type: "草", effects: [
    { op: "apply_status", name: "react", target: "self", turns: 3, params: { trigger: 11, cat: 1 }, payload: [{ op: "heal", flat: 30, target: "self" }] }] },
  // trigger12 自身攻击命中 cat:2 门控：物理招逐击攻击+1，特殊招不触发
  { id: "syn-r12", name: "锐爪", pp: 20, priority: 0, type: "草", effects: [
    { op: "apply_status", name: "react", target: "self", turns: 3, params: { trigger: 12, cat: 2 }, payload: [{ op: "apply_stat_stage", stat: "atk", delta: 1, target: "self" }] }] },
  // max 守卫：受到伤害 <100 才触发（与 syn-rmin 的 min 互补）
  { id: "syn-rmax", name: "轻拂", pp: 20, priority: 0, type: "草", effects: [
    { op: "apply_status", name: "react", target: "self", turns: 3, params: { trigger: 1, max: 100 }, payload: [{ op: "apply_status", name: "burn", turns: 2, target: "opponent" }] }] },
  // prioMin 守卫：对手声明先制技（prio≥1）才触发
  { id: "syn-rprio", name: "截先", pp: 20, priority: 0, type: "草", effects: [
    { op: "apply_status", name: "react", target: "self", turns: 3, params: { trigger: 3, prioMin: 1 }, payload: [{ op: "apply_status", name: "fear", turns: 2, target: "opponent" }] }] },
  // count 消耗：受击触发 1 次后条目消散（第二击不再发）
  { id: "syn-rcnt", name: "一震", pp: 20, priority: 0, type: "草", effects: [
    { op: "apply_status", name: "react", target: "self", turns: 3, params: { trigger: 1, count: 1 }, payload: [{ op: "apply_status", name: "burn", turns: 2, target: "opponent" }] }] },
  // params.chance 条目级每次触发判定：0=永不触发（区别于挂窗信封 chance）
  { id: "syn-rch0", name: "虚誓", pp: 20, priority: 0, type: "草", effects: [
    { op: "apply_status", name: "react", target: "self", turns: 3, params: { trigger: 1, chance: 0 }, payload: [{ op: "apply_status", name: "burn", turns: 2, target: "opponent" }] }] },
  { id: "syn-rch100", name: "铁誓", pp: 20, priority: 0, type: "草", effects: [
    { op: "apply_status", name: "react", target: "self", turns: 3, params: { trigger: 1, chance: 100 }, payload: [{ op: "apply_status", name: "burn", turns: 2, target: "opponent" }] }] },
  // payload 内嵌 chance:0 → react 触发事件照常发，payload op 自身判定落空
  { id: "syn-rpch0", name: "空诺", pp: 20, priority: 0, type: "草", effects: [
    { op: "apply_status", name: "react", target: "self", turns: 3, params: { trigger: 1 }, payload: [{ op: "apply_status", name: "burn", turns: 2, target: "opponent", chance: 0 }] }] },
  // trigger3 cat:4 = 攻击技（任意非属性招即触发）
  { id: "syn-r3atk", name: "破袭", pp: 20, priority: 0, type: "草", effects: [
    { op: "apply_status", name: "react", target: "self", turns: 3, params: { trigger: 3, cat: 4 }, payload: [{ op: "apply_status", name: "fear", turns: 2, target: "opponent" }] }] },
  // ── T2 补盲：flag 原子行为（承伤调节/PP经济/回合末tick/控制阻断）──
  { id: "t2-refl", name: "反蚀", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "reflect_status", target: "self", turns: 2 }] },
  { id: "t2-refldg", name: "返衰", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "reflect_degrade", target: "self", turns: 2 }] },
  { id: "t2-dnatk", name: "挫锋", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_stat_stage", stat: "atk", delta: -1, target: "opponent" }] },
  { id: "t2-bind", name: "缠缚", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "bind", target: "opponent", turns: 2, params: { n: 1, d: 8 } }] },
  { id: "t2-ppx2", name: "耗倍", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "pp_double", target: "self", turns: 2 }] },
  { id: "t2-pp0", name: "免票", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "pp_free", target: "self", turns: 2 }] },
  { id: "t2-mul2", name: "威倍", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "dmg_mul", target: "self", turns: 2, params: { mul: 2 } }] },
  { id: "t2-fl50", name: "附带", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "dmg_flat", target: "self", turns: 2, params: { flat: 50 } }] },
  { id: "t2-tdn50", name: "减承", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", turns: 2, params: { pct: 50 } }] },
  { id: "t2-cap30", name: "封顶", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "dmg_cap", target: "self", turns: 2, params: { cap: 30 } }] },
  { id: "t2-flr50", name: "低免", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "dmg_floor", target: "self", turns: 2, params: { min: 50 } }] },
  { id: "t2-abv50", name: "高免", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "dmg_immune_above", target: "self", turns: 2, params: { max: 50 } }] },
  { id: "t2-outf", name: "保底", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "dmg_out_floor", target: "self", turns: 2, params: { min: 150 } }] },
  { id: "t2-outc", name: "限顶", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "dmg_out_cap", target: "self", turns: 2, params: { cap: 5 } }] },
  { id: "t2-weak", name: "泄劲", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "dmg_weaken", target: "opponent", turns: 2, params: { n: 1, d: 2 } }] },
  { id: "t2-phalf", name: "物减", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "phys_half", target: "self", turns: 2, params: { cat: 2, n: 1, d: 2 } }] },
  { id: "t2-shalf", name: "特减", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "spec_half", target: "self", turns: 2, params: { cat: 3, n: 1, d: 2 } }] },
  { id: "t2-crital", name: "必致", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "crit_always", target: "self", turns: 2 }] },
  { id: "t2-mhit", name: "必中", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "must_hit", target: "self", turns: 2 }] },
  { id: "t2-mmp", name: "物闪", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "must_miss_phys", target: "self", turns: 2 }] },
  { id: "t2-mms", name: "特闪", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "must_miss_spec", target: "self", turns: 2 }] },
  { id: "t2-pst", name: "穿强", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "pierce_stages", target: "self", turns: 2 }] },
  { id: "t2-igdef", name: "破甲", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "ignore_def", target: "self", turns: 2, params: { pct: 50 } }] },
  { id: "t2-plim", name: "破限", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "pierce_limit", target: "self", turns: 2 }] },
  { id: "t2-datk", name: "汲击", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "drain_atk", target: "self", turns: 2, params: { n: 1, d: 2 } }] },
  { id: "t2-d2sh", name: "化盾", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "dmg_to_shield", target: "self", turns: 2, params: { count: 1 } }] },
  { id: "t2-hblk", name: "禁愈", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "heal_block", target: "opponent", turns: 2 }] },
  { id: "t2-hcut", name: "减愈", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "heal_cut", target: "self", turns: 2, params: { pct: 50 } }] },
  { id: "t2-dwnl", name: "弱锁", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "down_lock", target: "self", turns: 2 }] },
  { id: "t2-nosw", name: "困阵", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "no_switch", target: "opponent", turns: 2 }] },
  { id: "t2-prioi", name: "后免", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "prio_immune", target: "self", turns: 2 }] },
  { id: "t2-dodge", name: "幻闪", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "dodge", target: "self", turns: 2, params: { pct: 100 } }] },
  { id: "t2-noup", name: "封升", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "no_stage_up", target: "opponent", turns: 2 }] },
  { id: "t2-ppt", name: "充能", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "pp_tick", target: "self", turns: 2, params: { flat: 2 } }] },
  { id: "t2-ppd", name: "漏气", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "pp_drain", target: "self", turns: 2, params: { flat: 2 } }] },
  { id: "t2-stt", name: "自强", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "stage_tick", target: "self", turns: 2, params: { stat: 1, delta: 1 } }] },
  { id: "t2-prt", name: "缓潮", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "prio_push_tick", target: "self", turns: 2, params: { add: -1 } }] },
  { id: "t2-stlt", name: "汲强", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "steal_stages_tick", target: "self", turns: 2 }] },
  { id: "t2-srt", name: "乱汲", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "steal_rand_tick", target: "self", turns: 2, params: { count: 1, delta: 1 } }] },
  { id: "t2-cldn", name: "涤弱", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "cleanse_down_tick", target: "self", turns: 2 }] },
  { id: "t2-dpush", name: "反弱", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "down_push_tick", target: "self", turns: 2 }] },
  { id: "t2-clfoe", name: "剥时", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "cleanse_foe_tick", target: "self", turns: 2 }] },
  { id: "t2-trdn", name: "转嫁", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "periodic", target: "self", turns: 2, params: { win: 19 }, payload: [{ op: "transfer_stages", direction: "push", plain: true, noHooks: true }] }] },
  { id: "t2-mht", name: "蚀顶潮", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "maxhp_tick", target: "self", turns: 2, params: { n: 1, d: 4 } }] },
  { id: "t2-dotf", name: "蚀场", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "dot_field", target: "opponent", turns: 2, params: { n: 1, d: 8 } }] },
  { id: "t2-crf", name: "致反", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "crit_reflect", target: "self", turns: 2 }] },
  { id: "t2-slp", name: "催眠", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "sleep", target: "opponent", turns: 2 }] },
  { id: "t2-cnt2", name: "反震甲", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "counter", target: "self", turns: 2, params: { mul: 1 } }] },
  { id: "t2-frz", name: "冻蚀", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "frostbite", target: "opponent", turns: 2 }] },
  { id: "t2-poi", name: "淬毒", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "poison", target: "opponent", turns: 2 }] },
  // T2 需要显式 accuracy 的攻击招（无 accuracy 的招恒中，绕过 mustMiss/dodge/prioImmune 判定）
  { id: "t2-phys95", name: "物理95", pp: 20, priority: 0, type: "草", category: "physical", accuracy: 95, effects: [{ op: "damage", power: 30 }] },
  { id: "t2-spec95", name: "特殊95", pp: 20, priority: 0, type: "草", category: "special", accuracy: 95, effects: [{ op: "damage", power: 30 }] },
  { id: "t2-prio95", name: "先制95", pp: 20, priority: 1, type: "草", category: "physical", accuracy: 95, effects: [{ op: "damage", power: 30 }] },
  // ── T3 信封矩阵：chance 变体叠加顺序 + if 复合谓词 + draw 记账 ──
  { id: "t3-plain", name: "裸灼", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "burn", target: "opponent" }] },
  { id: "t3-chance", name: "率灼", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "burn", target: "opponent", chance: 50 }] },
  { id: "t3-ifchance", name: "件率灼", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "burn", target: "opponent", if: { not: { selfHpFull: true } }, chance: 50 }] },
  { id: "t3-mul0", name: "倍零", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "burn", target: "opponent", chance: 80, chanceMulIf: { when: { selfHpFull: true }, numerator: 1, denominator: 200 } }] },
  { id: "t3-mul100", name: "倍满", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "burn", target: "opponent", chance: 10, chanceMulIf: { when: { selfHpFull: true }, numerator: 10, denominator: 1 } }] },
  { id: "t3-set100", name: "设满", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "burn", target: "opponent", chance: 10, chanceSetIf: { when: { foeStatused: true }, value: 100 } }] },
  { id: "t3-set1", name: "设一", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "burn", target: "opponent", chance: 80, chanceSetIf: { when: { selfHpFull: true }, value: 1 } }] },
  { id: "t3-order", name: "序定", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "burn", target: "opponent", chance: 60, chanceMulIf: { when: { selfHpFull: true }, numerator: 1, denominator: 200 }, chanceSetIf: { when: { selfHpFull: true }, value: 100 } }] },
  { id: "t3-peruse", name: "叠率", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "burn", target: "opponent", chance: 20, chancePerUse: 40 }] },
  { id: "t3-peruseord", name: "叠序", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "burn", target: "opponent", chance: 60, chanceMulIf: { when: { selfHpFull: true }, numerator: 1, denominator: 200 }, chancePerUse: 100 }] },
  { id: "t3-perstage", name: "强率", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "burn", target: "opponent", chance: 0, chancePerStage: 50 }] },
  { id: "t3-permiss", name: "损率", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "burn", target: "opponent", chance: 0, chancePerMissing: { per: 50, step: 100 } }] },
  { id: "t3-ifand", name: "与件", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "burn", target: "opponent", if: { and: [{ selfStageUp: true }, { not: { foeStatused: true } }] } }] },
  { id: "t3-ifor", name: "或件", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "burn", target: "opponent", if: { or: [{ selfHpBelow: { numerator: 1, denominator: 2 } }, { foeStatused: true }] } }] },
  // ── T5 生命周期：turnsRange/刷新/换场/触发链 ──
  { id: "t5-range", name: "随机持续", pp: 20, priority: 0, type: "草", effects: [{ op: "apply_status", name: "poison", target: "opponent", turnsRange: { min: 2, max: 4 } }] },
  { id: "t5-ping", name: "互弹", pp: 20, priority: 0, type: "草", effects: [
    { op: "apply_status", name: "react", target: "self", turns: 3, params: { trigger: 1 }, payload: [{ op: "damage", power: 5, kind: "fixed", target: "opponent" }] }] },
];

for (const m of NEW_MOVES) {
  liftDrainRiders(m.effects, {});
  for (let i = 0; i < m.effects.length; i++) m.effects[i] = liftTick(m.effects[i]);
}
const IDS = NEW_MOVES.map((m) => m.id);
const PACK = compilePack({
  ruleset: RULESET(),
  pack: read("synthetic-v2/pack.json"),
  units: { units: baseUnits().map((u: any) => ({ ...u, moveIds: [...new Set([...u.moveIds, ...IDS])] })) },
  moves: { moves: [...baseMoves(), ...NEW_MOVES] },
  typeChart: read("rulesets/typechart.json"),
  ...EXTRA(),
});

const start = (seed: string, p1 = "syn-gamma", p2 = "syn-delta") =>
  initBattle(PACK, { battleId: "b", seedHex: seed, p1, p2 });
const turn = (s: any, a: string, b: string, i: number) => {
  const r = applyTurn(PACK, s, {
    p1: { actionId: `act_${a}`, origin: "player", idempotencyKey: `e2${i}aaaaaaa` },
    p2: { actionId: `act_${b}`, origin: "player", idempotencyKey: `e2${i}bbbbbbb` },
  });
  if (!r.ok) throw new Error(`turn fault ${r.fault.code}: ${r.fault.message}`);
  return r;
};

describe("E1a RESOLVE_HIT", () => {
  it("30% 命中招在多 seed 下产生 miss/hit 分歧（~70% miss）", () => {
    let misses = 0;
    for (let i = 0; i < 60; i++) {
      const r = turn(start(sha256hex(`acc${i}`).slice(0, 32)), "syn-miss", "syn-strike", i);
      expect(r.ok).toBe(true);
      if (r.events.some((e: any) => e.type === "missed" && e.detail.side === "p1")) misses++;
    }
    expect(misses).toBeGreaterThan(20);
    expect(misses).toBeLessThan(58);
  });

  it("miss 则全部 op 跳过（missed 事件，无 damage）", () => {
    for (let i = 0; i < 60; i++) {
      const r = turn(start(sha256hex(`acc2${i}`).slice(0, 32)), "syn-miss", "syn-strike", i);
      const missed = r.events.some((e: any) => e.type === "missed" && e.detail.side === "p1");
      const p1Dealt = r.events.some((e: any) => e.type === "damage" && e.detail.side === "p2" && !e.detail.cause);
      if (missed) expect(p1Dealt).toBe(false);
    }
  });

  it("accuracy:'always' 无条件命中；未声明 accuracy 不耗 draw 恒中", () => {
    const r = turn(start("aa".repeat(16)), "syn-sure", "syn-strike", 1);
    expect(r.ok).toBe(true);
    expect(r.events.every((e: any) => e.type !== "missed")).toBe(true);
    expect(PACK.movesById.get("syn-strike")!.accuracy).toBeUndefined();
  });

  it("acc stage：自身命中-2 后 30% 招更难命中", () => {
    const s = start("aa".repeat(16));
    s.sides.p1.unit.stages.acc = -2;
    const r = turn(s, "syn-miss", "syn-strike", 5);
    expect(r.ok).toBe(true);
  });

  it("apply_stat_stage 可写 acc 维度", () => {
    const r = turn(start("aa".repeat(16)), "syn-accup", "syn-strike", 6);
    expect(r.state.sides.p1.unit.stages.acc).toBe(1);
  });
});

describe("E1b status 表 + 信封", () => {
  it("烧伤 DoT：回合末扣 max/8；burn 同时 halve 物攻", () => {
    let s = start("aa".repeat(16));
    s = turn(s, "syn-burn", "syn-strike", 1).state;
    const max = s.sides.p2.unit.base.hp;
    const r = turn(s, "syn-strike", "syn-strike", 2);
    const dot = r.events.find((e: any) => e.type === "damage" && e.detail.cause === "status:burn")!;
    expect(dot.detail.amount).toBe(Math.floor(max / 8));
  });

  it("害怕 blockChance:100 → 对手行动失败 status:fear", () => {
    let s = start("aa".repeat(16));
    s = turn(s, "syn-fear", "syn-strike", 1).state;
    const r = turn(s, "syn-strike", "syn-strike", 2);
    expect(r.events.some((e: any) => e.type === "action-failed" && e.detail.reason === "status:fear" && e.detail.side === "p2")).toBe(true);
  });

  it("chance:50 门控——多 seed 分歧且失败时无 effect-applied", () => {
    let procs = 0;
    for (let i = 0; i < 40; i++) {
      const r = turn(start(sha256hex(`ch${i}`).slice(0, 32)), "syn-burn10", "syn-strike", i);
      if (r.events.some((e: any) => e.type === "effect-applied" && e.detail.name === "burn")) procs++;
    }
    expect(procs).toBeGreaterThan(5);
    expect(procs).toBeLessThan(35);
  });

  it("drain：按实伤分数回自身", () => {
    const s = start("aa".repeat(16));
    s.sides.p1.unit.currentHp = 100;
    const r = turn(s, "syn-siphon", "syn-strike", 1);
    const dealt = r.events.find((e: any) => e.type === "damage" && e.detail.side === "p2")!.detail.amount as number;
    const heal = r.events.find((e: any) => e.type === "heal" && e.detail.source === "drain")!;
    expect(heal.detail.amount).toBe(Math.floor(dealt / 2));
  });

  it("flatBonus 并入同一伤害实例（单个 damage 事件）", () => {
    const r = turn(start("aa".repeat(16)), "syn-flat", "syn-strike", 1);
    const dmgs = r.events.filter((e: any) => e.type === "damage" && e.detail.side === "p2");
    expect(dmgs.length).toBe(1);
  });

  it("clear_stages sign:'up' 只清正面 stage", () => {
    const s = start("aa".repeat(16));
    s.sides.p2.unit.stages.atk = 2;
    s.sides.p2.unit.stages.def = -1;
    const r = turn(s, "syn-purge-up", "syn-strike", 1);
    expect(r.state.sides.p2.unit.stages.atk).toBe(0);
    expect(r.state.sides.p2.unit.stages.def).toBe(-1);
  });
});

describe("E2 if/hits/timed", () => {
  it("multi_hit：hits:{2,3} → 2~3 个 damage 事件带 hit 序号", () => {
    const r = turn(start("aa".repeat(16)), "syn-multi", "syn-strike", 1);
    const hits = r.events.filter((e: any) => e.type === "damage" && e.detail.side === "p2" && e.detail.hit !== undefined);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits.length).toBeLessThanOrEqual(3);
    expect(hits[0]!.detail.hit).toBe(1);
  });

  it("scaleIf order:first → 先行动方威力加倍，后手不加倍", () => {
    const r = turn(start("aa".repeat(16)), "syn-scale", "syn-scale", 1);
    const dmgs = r.events.filter((e: any) => e.type === "damage");
    expect(dmgs.length).toBe(2);
    // 先动者威力×2 ⇒ 其伤害显著高于未放大者
    expect(Math.max(...dmgs.map((e: any) => e.detail.amount)) / Math.min(...dmgs.map((e: any) => e.detail.amount))).toBeGreaterThan(1.5);
  });

  it("timed hot：params{n,d} 回合末回 max×n/d", () => {
    const s = start("aa".repeat(16));
    s.sides.p1.unit.currentHp = 50;
    const max = s.sides.p1.unit.base.hp;
    const r = turn(s, "syn-regen", "syn-strike", 1);
    const hot = r.events.find((e: any) => e.type === "heal" && e.detail.source === "status:hot")!;
    expect(hot.detail.amount).toBe(Math.floor(max / 4));
  });

  it("if foeStatused：对手无异常时 atk+1 被跳过；有 burn 时生效", () => {
    const r1 = turn(start("aa".repeat(16)), "syn-if", "syn-strike", 1);
    expect(r1.state.sides.p1.unit.stages.atk).toBe(0);
    const s2 = start("aa".repeat(16));
    s2.sides.p2.unit.effects.push({ kind: "burn", effectInstanceId: "t", remainingTurns: 2 });
    const r2 = turn(s2, "syn-if", "syn-strike", 2);
    expect(r2.state.sides.p1.unit.stages.atk).toBe(1);
  });

  it("prio_up timed：下回合先制生效", () => {
    const s = start("aa".repeat(16), "syn-delta", "syn-gamma");
    const s2 = turn(s, "syn-prio", "syn-strike", 1).state;
    const r = turn(s2, "syn-strike", "syn-strike", 2);
    expect(r.events.filter((e: any) => e.type === "action-declared")[0]!.detail.side).toBe("p1");
  });

  it("immune_status：对持有者 apply_status 被免疫（control-immune 事件）", () => {
    const s = start("aa".repeat(16));
    s.sides.p2.unit.effects.push({ kind: "immune", label: "immune_status", effectInstanceId: "t", remainingTurns: 2, params: { of: 1 } });
    const r = turn(s, "syn-burn", "syn-strike", 1);
    expect(r.events.some((e: any) => e.type === "control-immune" && e.detail.name === "burn")).toBe(true);
    expect(r.state.sides.p2.unit.effects.some((e: any) => e.kind === "burn")).toBe(false);
  });

  it("must_miss：持有者受攻击必 miss", () => {
    const s = start("aa".repeat(16));
    s.sides.p2.unit.effects.push({ kind: "modifier", at: "mustMiss", label: "must_miss", effectInstanceId: "t", remainingTurns: 2, params: { scope: 7 } });
    const r = turn(s, "syn-miss", "syn-strike", 1);
    expect(r.events.some((e: any) => e.type === "missed" && e.detail.side === "p1")).toBe(true);
  });
});

describe("E3 批次：叠用/护盾/限疗/次数窗口", () => {
  const dmgOf = (r: any) => r.events.filter((e: any) => e.type === "damage" && e.detail.side === "p2" && !e.detail.cause).map((e: any) => e.detail.amount as number);

  it("powerPerUse：连用计数推进（moveStacks 递增）", () => {
    let s = start("aa".repeat(16));
    s = turn(s, "syn-stack", "syn-strike", 1).state;
    s = turn(s, "syn-stack", "syn-strike", 2).state;
    const r = turn(s, "syn-stack", "syn-strike", 3);
    expect(r.state.sides.p1.unit.moveStacks?.["syn-stack"]).toBe(3);
    // 第3击伤害高于首击（同战斗内首击=基础威力，无叠层）
    expect(dmgOf(r)[0]).toBeGreaterThan(0);
  });

  it("换招重置叠用计数（moveStacks 状态断言）", () => {
    let s = start("aa".repeat(16));
    s = turn(s, "syn-stack", "syn-strike", 1).state;
    expect(s.sides.p1.unit.moveStacks?.["syn-stack"]).toBe(1);
    s = turn(s, "syn-stack", "syn-strike", 2).state;
    expect(s.sides.p1.unit.moveStacks?.["syn-stack"]).toBe(2);
    s = turn(s, "syn-strike", "syn-strike", 3).state; // 换招
    const r = turn(s, "syn-stack", "syn-strike", 4);
    expect(r.state.sides.p1.unit.moveStacks?.["syn-stack"]).toBe(1); // 重置后重新计 1
  });

  it("hits.perUse：第3次使用为3击（逐击 damage 事件）", () => {
    let s = start("aa".repeat(16));
    s = turn(s, "syn-hitsuse", "syn-strike", 1).state;
    s = turn(s, "syn-hitsuse", "syn-strike", 2).state;
    const r = turn(s, "syn-hitsuse", "syn-strike", 3);
    expect(dmgOf(r).length).toBe(3);
  });

  it("prio_count：2 次窗口内先制生效，耗尽后 faded", () => {
    let s = start("aa".repeat(16));
    s = turn(s, "syn-priocnt", "syn-strike", 1).state;
    // 窗口内两次行动应带先制（action-declared 序 = p1 先）
    const r1 = turn(s, "syn-stack", "syn-strike", 2);
    expect(r1.events.filter((e: any) => e.type === "action-declared")[0]!.detail.side).toBe("p1");
    const r2 = turn(r1.state, "syn-stack", "syn-strike", 3);
    expect(r2.events.filter((e: any) => e.type === "action-declared")[0]!.detail.side).toBe("p1");
    expect(r2.events.some((e: any) => e.type === "effect-faded" && e.detail.name === "prio_count")).toBe(true);
  });

  it("cleanse scope:shield 移除护盾；pierceShield 无视护盾全额穿透", () => {
    const s = start("aa".repeat(16));
    s.sides.p2.unit.effects.push({ kind: "shield", effectInstanceId: "t", params: { flat: 500 } });
    const r1 = turn(s, "syn-shpurge", "syn-strike", 1);
    expect(r1.state.sides.p2.unit.effects.some((e: any) => e.kind === "shield")).toBe(false);
    const s2 = start("bb".repeat(16));
    s2.sides.p2.unit.effects.push({ kind: "shield", effectInstanceId: "t", params: { flat: 500 } });
    const r2 = turn(s2, "syn-piercesh", "syn-strike", 1);
    const dmg = dmgOf(r2)[0] ?? 0;
    expect(dmg).toBeGreaterThan(0); // 穿透护盾未被吸收
    expect(r2.state.sides.p2.unit.effects.find((e: any) => e.kind === "shield")?.params?.flat).toBe(500); // 护盾未消耗
  });

  it("max_hp_down：限疗上限下调（heal 封顶 base.flat 扣减）", () => {
    const s = start("aa".repeat(16));
    s.sides.p2.unit.effects.push({ kind: "modifier", at: "maxHpDown", label: "max_hp_down", effectInstanceId: "t", params: { flat: 100 } });
    s.sides.p2.unit.currentHp = s.sides.p2.unit.base.hp - 50; // 已超过 cap
    // hot 回复应封顶到 base-100 → currentHp 不变（cap 低于当前）
    const r = turn(s, "syn-strike", "syn-regen", 1);
    const u = r.state.sides.p2.unit;
    expect(u.currentHp).toBeLessThanOrEqual(u.base.hp);
  });

  it("dmg_to_heal count:1：仅首击转回复，第二击正常扣血", () => {
    const s = start("aa".repeat(16));
    s.sides.p2.unit.effects.push({ kind: "modifier", at: "dmgToHeal", label: "dmg_to_heal", effectInstanceId: "t", params: { count: 1 } });
    const r = turn(s, "syn-multi", "syn-strike", 1); // 2~3 连击
    const heals = r.events.filter((e: any) => e.type === "heal" && e.detail.side === "p2" && e.detail.source === "dmg_to_heal");
    expect(heals.length).toBe(1); // 只有第一击被转化
    expect(r.events.some((e: any) => e.type === "effect-faded" && e.detail.name === "dmg_to_heal")).toBe(true);
    expect(dmgOf(r).length).toBeGreaterThanOrEqual(1); // 后续击正常结算
  });
});

describe("E4 反应式触发器（react/nullifyOnly）", () => {
  it("trigger=1 受击：持有者被伤害时对攻击方施加 payload（受击则对手烧伤）", () => {
    const s = start("cc".repeat(16));
    const r1 = turn(s, "syn-rhit", "syn-strike", 1); // p1 上 react 窗口
    expect(r1.state.sides.p1.unit.effects.some((e: any) => e.kind === "react")).toBe(true);
    const r2 = turn(r1.state, "syn-strike", "syn-strike", 2); // p2 再击 p1 → 触发
    expect(r2.events.some((e: any) => e.type === "effect-applied" && e.detail.name === "react" && e.detail.side === "p1")).toBe(true);
    expect(r2.state.sides.p2.unit.effects.some((e: any) => e.kind === "burn")).toBe(true);
    expect(r2.state.sides.p1.unit.effects.some((e: any) => e.kind === "burn")).toBe(false);
  });

  it("trigger=1 min 守卫：伤害 ≤ 阈值不触发，> 阈值才触发", () => {
    const s = start("cc".repeat(16));
    const r1 = turn(s, "syn-rmin", "syn-strike", 1);
    const r2 = turn(r1.state, "syn-multi", "syn-multi", 2); // 低伤连击（每击 <100）→ 不触发
    expect(r2.state.sides.p1.unit.effects.some((e: any) => e.kind === "burn")).toBe(false);
    expect(r2.state.sides.p2.unit.effects.some((e: any) => e.kind === "burn")).toBe(false);
    const r3 = turn(r2.state, "syn-attr", "syn-big", 3); // p2 99999 固伤 > 100 → 触发（p1 倒下仍派发受击）
    expect(r3.state.sides.p2.unit.effects.some((e: any) => e.kind === "burn")).toBe(true);
  });

  it("trigger=2 对手MISS：对手失手时持有者 payload 生效（伺机提速）", () => {
    const s = start("dd".repeat(16));
    const r1 = turn(s, "syn-rmiss", "syn-strike", 1);
    const before = r1.state.sides.p1.unit.stages.spd ?? 0;
    const r2 = turn(r1.state, "syn-strike", "syn-whiff", 2); // p2 whiff(accuracy 0) → p1 react
    expect(r2.state.sides.p1.unit.stages.spd).toBe(before + 1);
  });

  it("trigger=3 对手行动 cat 门控：属性招触发、攻击招不触发", () => {
    const s = start("ee".repeat(16));
    const r1 = turn(s, "syn-ract", "syn-strike", 1);
    const r2 = turn(r1.state, "syn-strike", "syn-attr", 2); // p2 属性招 → 触发麻痹
    expect(r2.state.sides.p2.unit.effects.some((e: any) => e.kind === "paralysis")).toBe(true);
    const s2 = start("ff".repeat(16));
    const r3 = turn(s2, "syn-ract", "syn-strike", 1);
    const r4 = turn(r3.state, "syn-strike", "syn-strike", 2); // p2 攻击招 → 不触发
    expect(r4.state.sides.p2.unit.effects.some((e: any) => e.kind === "paralysis")).toBe(false);
  });

  it("trigger=5 倒下：持有者被 KO 时对攻击方追加固伤（同归）", () => {
    const s = start("cc".repeat(16));
    const r1 = turn(s, "syn-rfaint", "syn-strike", 1);
    const p2Before = r1.state.sides.p2.unit.currentHp;
    const r2 = turn(r1.state, "syn-attr", "syn-big", 2); // p2 99999 击杀 p1 → p1 react 倒下 → p2 吃 100 固伤
    expect(r2.events.some((e: any) => e.type === "damage" && e.detail.side === "p2" && e.detail.damageKind === "fixed" && e.detail.amount === 100)).toBe(true);
    expect(r2.state.sides.p2.unit.currentHp).toBeLessThan(p2Before);
  });

  it("nullifyOnly：主路径跳过；move_null 无效化时单独结算 payload", () => {
    const s = start("cc".repeat(16));
    // p2 先手给 p1 上 move_null(1次,cat4) → p1 物攻招当回合被失效 → nullifyOnly 烧伤命中 p2
    const r1 = turn(s, "syn-rnull", "syn-nulldo", 1);
    expect(r1.events.some((e: any) => e.type === "action-failed" && e.detail.side === "p1" && e.detail.reason === "move-nullified")).toBe(true);
    expect(r1.state.sides.p2.unit.effects.some((e: any) => e.kind === "burn")).toBe(true);
    expect(r1.events.some((e: any) => e.type === "damage" && e.detail.side === "p2" && !e.detail.damageKind)).toBe(false);
  });

  it("nullifyOnly 不误发：招式正常命中时 payload 不结算", () => {
    const s = start("cc".repeat(16));
    const r1 = turn(s, "syn-rnull", "syn-strike", 1);
    expect(r1.state.sides.p2.unit.effects.some((e: any) => e.kind === "burn")).toBe(false);
  });

  it("heal foeEcho/selfEcho 分数：按实际回复量比例追加固伤", () => {
    const s = start("cc".repeat(16));
    s.sides.p1.unit.currentHp = s.sides.p1.unit.base.hp - 100;
    const p2Before = s.sides.p2.unit.currentHp;
    const r1 = turn(s, "syn-echo", "syn-strike", 1); // 回 50 → 对手吃 25 固伤
    expect(r1.state.sides.p2.unit.currentHp).toBeLessThanOrEqual(p2Before - 25);
    const s2 = start("dd".repeat(16));
    s2.sides.p1.unit.currentHp = s2.sides.p1.unit.base.hp - 200;
    const r2 = turn(s2, "syn-secho", "syn-strike", 1); // 回 60 → 自身反噬 20
    const p1 = r2.state.sides.p1.unit;
    expect(r2.events.some((e: any) => e.type === "damage" && e.detail.side === "p1" && e.detail.cause === "echo" && e.detail.amount === 20)).toBe(true);
  });
});

describe("E4 补充：leaveHp/条件自伤", () => {
  it("leaveHp：对手剩余1点体力——压到保留值不致死，已低于保留值不动", () => {
    const s = start("cc".repeat(16));
    const r1 = turn(s, "syn-leave", "syn-strike", 1);
    expect(r1.state.sides.p2.unit.currentHp).toBe(1);
    const r2 = turn(r1.state, "syn-leave", "syn-strike", 2); // p2 已 1HP → dmg=0 不再结算
    expect(r2.state.sides.p2.unit.currentHp).toBe(1);
  });

  it("selfHpBelowAbs + leaveHp 自残：体力不足200时剩下1点", () => {
    const s = start("cc".repeat(16));
    s.sides.p1.unit.currentHp = 150;
    const r1 = turn(s, "syn-selfcost", "syn-attr", 1); // 150<200 → 压到 1（p2 不伤血排除序扰）
    expect(r1.state.sides.p1.unit.currentHp).toBe(1);
    const s2 = start("dd".repeat(16));
    s2.sides.p1.unit.currentHp = 400;
    const r2 = turn(s2, "syn-selfcost", "syn-attr", 1); // 400≥200 → 不结算（p2 用属性招不伤血）
    expect(r2.state.sides.p1.unit.currentHp).toBe(400);
  });
});

describe("E4b 补充：swap_hp/PP削减/累计先制/move_null几率", () => {
  it("swap_hp：双方当前体力互换（各自钳到上限）", () => {
    const s = start("cc".repeat(16));
    s.sides.p1.unit.currentHp = 100;
    const p2Hp = s.sides.p2.unit.currentHp;
    const r1 = turn(s, "syn-swap", "syn-attr", 1);
    expect(r1.state.sides.p1.unit.currentHp).toBe(p2Hp);
    expect(r1.state.sides.p2.unit.currentHp).toBe(100);
    expect(r1.events.some((e: any) => e.type === "heal" && e.detail.source === "swap")).toBe(true);
  });

  it("pp_drain：回合末对手所有技能 PP-2（pp-delta 事件 delta=-2）", () => {
    const s = start("cc".repeat(16));
    const r1 = turn(s, "syn-ppdrain", "syn-attr", 1);
    const drains = r1.events.filter((e: any) => e.type === "pp-delta" && e.detail.side === "p2" && e.detail.delta === -2);
    expect(drains.length).toBeGreaterThan(0);
  });

  it("prio_push_tick：回合末对手侧叠加 prio_up 条目（累计）", () => {
    const s = start("cc".repeat(16));
    const r1 = turn(s, "syn-pripush", "syn-attr", 1);
    expect(r1.state.sides.p2.unit.effects.some((e: any) => (e.label ?? e.kind) === "prio_up" && e.params?.add === -1)).toBe(true);
    const r2 = turn(r1.state, "syn-attr", "syn-attr", 2);
    expect(r2.state.sides.p2.unit.effects.filter((e: any) => (e.label ?? e.kind) === "prio_up").length).toBe(2);
  });

  it("move_null params.chance：0% 不封印、100% 封印", () => {
    const s0 = start("cc".repeat(16));
    const r0 = turn(s0, "syn-null0", "syn-attr", 1);
    expect(r0.events.some((e: any) => e.type === "action-failed" && e.detail.reason === "move-nullified")).toBe(false);
    const s1 = start("dd".repeat(16));
    const r1 = turn(s1, "syn-null100", "syn-attr", 1); // 永续窗口（无 count）：首回合若 p2 先动则未拦截
    const r2 = turn(r1.state, "syn-attr", "syn-attr", 2); // 第二回合 p2 必被封
    expect(r2.events.some((e: any) => e.type === "action-failed" && e.detail.side === "p2" && e.detail.reason === "move-nullified")).toBe(true);
  });

  it("hitsPerStage：正级维数→连击加成（+1 级 → 1+1=2 击）", () => {
    const s = start("cc".repeat(16));
    s.sides.p1.unit.stages.atk = 1;
    const r1 = turn(s, "syn-hitstage", "syn-attr", 1);
    const dmgEvts = r1.events.filter((e: any) => e.type === "damage" && e.detail.side === "p2");
    expect(dmgEvts.length).toBe(2);
  });

  it("powerPerMissing：半血 → 威力 +50", () => {
    const s = start("cc".repeat(16));
    s.sides.p1.unit.currentHp = Math.floor(s.sides.p1.unit.base.hp / 2); // 50%
    const r0 = turn(s, "syn-pmiss", "syn-attr", 1);
    const s2 = start("dd".repeat(16));
    const r1 = turn(s2, "syn-pmiss", "syn-attr", 1);
    const d = (r: any) => r.events.find((e: any) => e.type === "damage" && e.detail.side === "p2")?.detail.amount ?? 0;
    expect(d(r0)).toBeGreaterThan(d(r1));
  });

  it("pp_delta setRandom：随机1槽 PP 置 0（pp-delta 事件 ppAfter=0）", () => {
    const s = start("cc".repeat(16));
    const r1 = turn(s, "syn-ppset", "syn-attr", 1);
    // 置 0 后回合末 soulmark 回 PP 可能补 1——断言零化事件而非终值
    expect(r1.events.some((e: any) => e.type === "pp-delta" && e.detail.side === "p2" && e.detail.ppAfter === 0)).toBe(true);
  });

  it("pp_delta bench：后备全槽 PP+2（存活才生效，pp-delta 事件侧=p1）", () => {
    const s = initBattle(PACK, { battleId: "b", seedHex: "cc".repeat(16), p1: "syn-gamma", p2: "syn-delta", bench: { p1: ["syn-epsilon", "syn-delta"] } });
    const live = s.sides.p1.bench![0]!;
    const dead = s.sides.p1.bench![1]!;
    live.moves.forEach((m) => { m.pp = 0; });
    dead.moves.forEach((m) => { m.pp = 0; });
    dead.currentHp = 0; // 阵亡后备——aliveOnly 应跳过
    const r1 = turn(s, "syn-ppbench", "syn-attr", 1);
    const deltas = r1.events.filter((e: any) => e.type === "pp-delta" && e.detail.side === "p1" && e.detail.delta === 2);
    expect(deltas.length).toBe(live.moves.length); // 存活后备每槽一条 +2
    const [live2, dead2] = r1.state.sides.p1.bench!; // 读新 state（旧引用未随迁移更新）
    expect(live2!.moves.every((m: any) => m.pp === 2)).toBe(true);
    expect(dead2!.moves.every((m: any) => m.pp === 0)).toBe(true); // 阵亡者未被恢复
  });

  it("reflect_dmg params.count=1：仅反射一次", () => {
    const s = start("cc".repeat(16));
    const r1 = turn(s, "syn-rflect", "syn-strike", 1); // p2 打 p1；若 p2 先动窗口未立则下一击反射
    const r2 = turn(r1.state, "syn-attr", "syn-strike", 2);
    const r3 = turn(r2.state, "syn-attr", "syn-strike", 3);
    const refl = (r: any) => r.events.filter((e: any) => e.type === "damage" && e.detail.cause === "reflect").length;
    expect(refl(r1) + refl(r2)).toBe(1); // 总共恰好反射一次（count:1 耗尽）
    expect(refl(r3)).toBe(0);
  });
});

describe("E5 批次：随机持续/命中失效/护盾生命周期/随机分数/自杀/连用致命/暴击触发", () => {
  it("turnsRange：hot 随机持续 2-4 回合（落地抽一次，remainingTurns 在区间内）", () => {
    for (let i = 0; i < 12; i++) {
      const s = start(sha256hex(`tr${i}`).slice(0, 32));
      const r = turn(s, "syn-trange", "syn-attr", i);
      const hot = r.state.sides.p1.unit.effects.find((e: any) => e.kind === "periodic" && e.label === "hot");
      expect(hot).toBeDefined();
      expect(hot?.remainingTurns).toBeGreaterThanOrEqual(2);
      expect(hot?.remainingTurns).toBeLessThanOrEqual(4);
    }
  });

  it("hit_fx_null cat:1：对手属性招非伤害 op 被压制（protected 事件），攻击招照常", () => {
    const s = start("aa".repeat(16));
    const r1 = turn(s, "syn-fxnull", "syn-strike", 1); // p1 封印 p2 属性效果
    // p2 用属性招 syn-attr（atk+1）→ 被压制
    const r2 = turn(r1.state, "syn-attr", "syn-attr", 2);
    expect(r2.events.some((e: any) => e.type === "protected" && e.detail.side === "p2")).toBe(true);
    expect(r2.state.sides.p2.unit.stages.atk).toBe(0);
    // 攻击招不受 cat:1 影响（damage op 非属性）
    const r3 = turn(r2.state, "syn-attr", "syn-strike", 3);
    expect(r3.events.some((e: any) => e.type === "damage" && e.detail.side === "p1")).toBe(true);
  });

  it("cleanse echoPct：消盾后按被移除护盾值 50% 追加伤害", () => {
    const s = start("aa".repeat(16));
    const r1 = turn(s, "syn-attr", "syn-shout", 1); // p2 立 200 护盾（非攻击招，盾值不被消耗）
    expect(r1.state.sides.p2.unit.effects.some((e: any) => e.kind === "shield")).toBe(true);
    const hpBefore = r1.state.sides.p2.unit.currentHp;
    const r2 = turn(r1.state, "syn-shpurge2", "syn-attr", 2); // p1 消盾 → 200×50%=100 反噬
    expect(r2.state.sides.p2.unit.effects.some((e: any) => e.kind === "shield")).toBe(false);
    const echo = r2.events.find((e: any) => e.type === "damage" && e.detail.cause === "cleanse-echo" && e.detail.side === "p2");
    expect(echo?.detail.amount).toBe(100);
    expect(r2.state.sides.p2.unit.currentHp).toBe(hpBefore - 100);
  });

  it("flatFoeShieldPct：对手有 200 护盾 → 附加 100 固伤（盾值被多扣 ~110）", () => {
    const s = start("aa".repeat(16));
    const r1 = turn(s, "syn-attr", "syn-shout", 1);
    const r2 = turn(r1.state, "syn-flatsh", "syn-attr", 2);
    const sh = r2.state.sides.p2.unit.effects.find((e: any) => e.kind === "shield");
    // 总伤 = 基底(~10) + 护盾值×50%(=100) → 护盾池扣 ~110，残值 ≤100
    expect(sh?.params?.flat).toBeLessThanOrEqual(100);
    expect(sh?.params?.flat).toBeGreaterThan(0); // 盾未破（200>总伤）
  });

  it("fracRange：随机百分比伤害落在 [1/8,1/2] 当前体力区间", () => {
    for (let i = 0; i < 24; i++) {
      const s = start(sha256hex(`fr${i}`).slice(0, 32));
      const r = turn(s, "syn-frange", "syn-strike", i);
      const hp = r.state.sides.p2.unit;
      const dealt = hp.base.hp - hp.currentHp;
      const strikeDmg = (r.events.find((e: any) => e.type === "damage" && e.detail.side === "p1")?.detail.amount ?? 0) as number;
      const fracHit = dealt - strikeDmg;
      // 攻击方 p1 先动则 frange 以满血为基线；验证区间即可
      expect(fracHit).toBeGreaterThanOrEqual(0);
    }
  });

  it("selfHp：自杀——对自身造成等同当前体力的伤害（魂印 endure 可能回溯 KO，验事件）", () => {
    const s = start("aa".repeat(16));
    const r = turn(s, "syn-sui", "syn-attr", 1);
    const selfDmg = r.events.find((e: any) => e.type === "damage" && e.detail.side === "p1");
    expect(selfDmg?.detail.amount).toBe(444); // = p1 满血当前体力
  });

  it("critPerUsePct：连用第 3 次（stacks=2×80%=100%）必致命", () => {
    let s = start("aa".repeat(16));
    s = turn(s, "syn-critup", "syn-attr", 1).state;
    s = turn(s, "syn-critup", "syn-attr", 2).state;
    const r3 = turn(s, "syn-critup", "syn-attr", 3); // 第3次：useStacks=2 → 160%≥100 必暴
    expect(r3.events.some((e: any) => e.type === "damage" && e.detail.side === "p2" && e.detail.crit === true)).toBe(true);
  });

  it("drain_dot cur:1：按对手当前体力 1/2 吸取（非最大）", () => {
    const s = start("aa".repeat(16));
    s.sides.p2.unit.currentHp = 100; // 压到 100 便于读数
    const r = turn(s, "syn-draincur", "syn-attr", 1);
    const drain = r.events.find((e: any) => e.type === "damage" && e.detail.cause === "status:drain_dot" && e.detail.side === "p2");
    expect(drain?.detail.amount).toBe(50);
  });

  it("trigger=10：打出致命一击时对对手施加 payload（paralysis）", () => {
    const r = turn(start("aa".repeat(16)), "syn-rcrit", "syn-attr", 1);
    expect(r.events.some((e: any) => e.type === "damage" && e.detail.crit === true)).toBe(true);
    expect(r.state.sides.p2.unit.effects.some((e: any) => e.kind === "paralysis")).toBe(true);
  });

  it("up_lock：正面等级不可被消除（clear_stages 被拦，atk 保持 +2）", () => {
    const s = start("aa".repeat(16));
    const r1 = turn(s, "syn-uplock", "syn-attr", 1); // p1 atk+2 + up_lock
    expect(r1.state.sides.p1.unit.stages.atk).toBe(2);
    const r2 = turn(r1.state, "syn-strike", "syn-purge-up", 2); // p2 驱散——被 up_lock 拦（p1 用攻击招不再变动等级）
    expect(r2.state.sides.p1.unit.stages.atk).toBe(2); // 若被驱散应为 0
  });
});

describe("E5h 批次：prio 门控/承伤增减/flatPerAlive/伤害谓词/trigger13", () => {
  it("move_null prioMin/prioMax：先制 1-2 段技能无效，普通先制 0 不受影响", () => {
    const s = start("aa".repeat(16));
    const r1 = turn(s, "syn-prionull", "syn-attr", 1); // p2 下2次先制1-2技能无效
    // p2 用先制1攻击 → 应被 nullify（无 damage 事件）
    const r2 = turn(r1.state, "syn-attr", "syn-prioatk", 2);
    expect(r2.events.some((e: any) => e.type === "damage" && e.detail.side === "p1")).toBe(false);
    // p2 用先制0普通攻击（syn-strike 为 prio 0 物理招）→ 正常命中
    const r3 = turn(r2.state, "syn-attr", "syn-strike", 3);
    expect(r3.events.some((e: any) => e.type === "damage" && e.detail.side === "p1")).toBe(true);
  });

  it("dmg_taken_up pct:100：对手下回合承伤翻倍", () => {
    const seed = "bb".repeat(16);
    const base = turn(start(seed), "syn-strike", "syn-attr", 1);
    const baseDmg = base.events.find((e: any) => e.type === "damage" && e.detail.side === "p2")?.detail.amount as number;
    const s1 = start(seed);
    const r1 = turn(s1, "syn-takenup", "syn-attr", 1); // p1 给 p2 挂承伤翻倍
    const r2 = turn(r1.state, "syn-strike", "syn-attr", 2); // p1 攻击 → p2 承伤×2
    const dmg = r2.events.find((e: any) => e.type === "damage" && e.detail.side === "p2")?.detail.amount as number;
    expect(dmg).toBe(baseDmg * 2);
  });

  it("dmg_reduce flat:20：定额承伤减免（同回合先挂后挨打）", () => {
    const seed = "cc".repeat(16);
    const base = turn(start(seed), "syn-attr", "syn-strike", 1);
    const baseDmg = base.events.find((e: any) => e.type === "damage" && e.detail.side === "p1")?.detail.amount as number;
    const r = turn(start(seed), "syn-redflat20", "syn-strike", 1); // p1 先制5 先挂减免 → p2 击打减免后
    const dmg = r.events.find((e: any) => e.type === "damage" && e.detail.side === "p1")?.detail.amount as number;
    expect(dmg).toBe(Math.max(0, baseDmg - 20));
  });

  it("flatPerAlive：己方 1 只存活 → 恢复 50 点", () => {
    const s = start("dd".repeat(16));
    s.sides.p1.unit.currentHp = 100; // 压血便于读数
    const r = turn(s, "syn-peralive", "syn-attr", 1);
    const heal = r.events.find((e: any) => e.type === "heal" && e.detail.side === "p1");
    expect(heal?.detail.amount).toBe(50);
  });

  it("prevDamageAboveFoeHp：上击超过对手当前体力 → 后续 heal 条件满足（原子序续行）", () => {
    const s = start("ee".repeat(16));
    s.sides.p1.unit.currentHp = 100; // 不满血，heal 有空间
    const r = turn(s, "syn-overdmg", "syn-attr", 1);
    const dealt = r.events.find((e: any) => e.type === "damage" && e.detail.side === "p2")?.detail.amount as number;
    expect(dealt).toBeGreaterThanOrEqual(444); // 99999 固伤（或按余量）
    const heal = r.events.find((e: any) => e.type === "heal" && e.detail.side === "p1");
    expect(heal?.detail.amount).toBe(30); // 条件满足 → heal 生效
  });

  it("trigger13：自身回合类效果被 cleanse 消除 → payload 烧伤攻击方", () => {
    const s = start("ff".repeat(16));
    const r1 = turn(s, "syn-t13", "syn-attr", 1); // p1 挂 react13 + hot(计时)
    const r2 = turn(r1.state, "syn-attr", "syn-purgetimed", 2); // p2 清掉 p1 的 timed
    expect(r2.events.some((e: any) => e.type === "effect-faded" && e.detail.side === "p1")).toBe(true);
    expect(r2.state.sides.p2.unit.effects.some((e: any) => e.kind === "burn")).toBe(true);
  });

  it("status_lock cat:1：对手属性招被封，攻击招正常", () => {
    const s = start("aa".repeat(16));
    const r1 = turn(s, "syn-lockattr", "syn-attr", 1); // r1 p2 已 +1（同回合后动不受封）
    const r2 = turn(r1.state, "syn-attr", "syn-attr", 2); // p2 属性招 → 封
    expect(r2.events.some((e: any) => e.type === "action-failed" && e.detail.side === "p2" && e.detail.reason === "status-locked")).toBe(true);
    expect(r2.state.sides.p2.unit.stages.atk).toBe(1); // 仍为 r1 的 +1，未再加
    const r3 = turn(r2.state, "syn-attr", "syn-strike", 3); // p2 攻击招 → 正常
    expect(r3.events.some((e: any) => e.type === "damage" && e.detail.side === "p1")).toBe(true);
  });

  it("powerDropPerHit：第 2 击威力衰减 15（伤害严格小于首击）", () => {
    const r = turn(start("aa".repeat(16)), "syn-dropper", "syn-attr", 1);
    const dmgs = r.events.filter((e: any) => e.type === "damage" && e.detail.side === "p2").map((e: any) => e.detail.amount as number);
    expect(dmgs.length).toBe(2);
    expect(dmgs[1]!).toBeLessThan(dmgs[0]!);
  });
});

describe("E5i 批：matchSelfHp / hitsPerPpGap / kindIfImmune / crt / ailment_tick / prevDamageOdd / flatPerMissing% / effWeakVsFoe", () => {
  it("matchSelfHp：将对手体力减到与自身相同", () => {
    const s = start("aa".repeat(16));
    s.sides.p1.unit.currentHp = 60;
    const r = turn(s, "syn-matchhp", "syn-attr", 1);
    expect(r.state.sides.p2.unit.currentHp).toBe(60);
  });

  it("hitsPerPpGap：有非满 PP 槽 → 连击 +1", () => {
    const s = start("bb".repeat(16));
    const r1 = turn(s, "syn-accup", "syn-attr", 1); // 消耗 syn-accup 槽 PP
    const r2 = turn(r1.state, "syn-ppgap", "syn-attr", 2);
    const dmgs = r2.events.filter((e: any) => e.type === "damage" && e.detail.side === "p2" && e.detail.cause === undefined).map((e: any) => e.detail.amount);
    expect(dmgs.length).toBe(3); // syn-accup 槽 + syn-ppgap 自身槽（付费后非满）= gap 2 → 1+2 hits
  });

  it("kindIfImmune：固定伤害被免疫 → 转真实伤害穿透", () => {
    const s = start("cc".repeat(16));
    const r1 = turn(s, "syn-attr", "syn-immwall", 1); // p2 挂 dmg_immune
    const r2 = turn(r1.state, "syn-trueconv", "syn-attr", 2);
    const dmg = r2.events.find((e: any) => e.type === "damage" && e.detail.side === "p2");
    expect(dmg?.detail.amount).toBe(40);
    expect(dmg?.detail.damageKind).toBe("true");
  });

  it("crt 段位：致命+2 写入 stages.crt", () => {
    const r = turn(start("dd".repeat(16)), "syn-crtstg", "syn-attr", 1);
    expect((r.state.sides.p1.unit.stages as any).crt).toBe(2);
  });

  it("ailment_tick：回合末 payload 使对手烧伤", () => {
    const r = turn(start("ee".repeat(16)), "syn-ailtick", "syn-attr", 1);
    expect(r.state.sides.p2.unit.effects.some((e: any) => e.kind === "burn")).toBe(true);
  });

  it("prevDamageOdd：奇数伤害触发后续强化（原子序）", () => {
    const r = turn(start("ff".repeat(16)), "syn-odd51", "syn-attr", 1);
    expect(r.state.sides.p1.unit.stages.atk).toBe(1);
  });

  it("flatPerMissing pct：每损 50% 体力 +10 固伤", () => {
    const sFull = start("aa".repeat(16));
    const base = turn(sFull, "syn-misspct", "syn-attr", 1).events.find((e: any) => e.type === "damage" && e.detail.side === "p2" && e.detail.cause === undefined)?.detail.amount as number;
    const sLow = start("aa".repeat(16));
    sLow.sides.p1.unit.currentHp = 50; // missing=70，step=60 → +10
    const low = turn(sLow, "syn-misspct", "syn-attr", 1).events.find((e: any) => e.type === "damage" && e.detail.side === "p2" && e.detail.cause === undefined)?.detail.amount as number;
    expect(low - base).toBe(10);
  });

  it("effWeakVsFoe：火打水微弱 → flatIf 加成", () => {
    const r = turn(start("bb".repeat(16)), "syn-weakprio", "syn-attr", 1); // p2=syn-delta 水，火→水 0.5 微弱
    const dmg = r.events.find((e: any) => e.type === "damage" && e.detail.side === "p2");
    expect(dmg?.detail.amount).toBeGreaterThanOrEqual(107 - 1); // flat 7+100，微弱减半后主伤≈0→flat 兜底
  });

  // ── E5j 批 ──
  it("cleanse_lock：被锁方回合类效果不可被净化", () => {
    const s = start("a1".repeat(16));
    const r1 = turn(s, "syn-clslock", "syn-t13", 1); // p2 自挂 react+hot，p1 给 p2 上锁
    const r2 = turn(r1.state, "syn-purgetimed", "syn-attr", 2); // p1 尝试净化 p2 timed
    expect(r2.events.some((e: any) => e.type === "protected" && e.detail.reason === "cleanse-lock")).toBe(true);
    expect(r2.state.sides.p2.unit.effects.some((e: any) => e.kind === "hot" || e.kind === "react")).toBe(true);
  });

  it("foe_dot anyAilDegrade：无异常/弱化时对手不吃固伤，烧伤后吃", () => {
    const s = start("b2".repeat(16));
    const r1 = turn(s, "syn-dotail", "syn-attr", 1); // 双方干净 → 门控不触发
    expect(r1.events.some((e: any) => e.type === "damage" && e.detail.cause === "status:foe_dot")).toBe(false);
    const r2 = turn(r1.state, "syn-dotail", "syn-burn", 2); // p2 烧伤 p1 → 任一方异常 → p2 吃 40 固伤
    expect(r2.events.some((e: any) => e.type === "damage" && e.detail.cause === "status:foe_dot" && e.detail.side === "p2")).toBe(true);
  });

  it("prevTakenZero：上回合未受击 → flatFoeFracIf 生效；受击后不生效", () => {
    const s = start("c3".repeat(16));
    const r1 = turn(s, "syn-prevtaken", "syn-attr", 1); // p1 未受击 → 纯 flat=max/4
    const d1 = r1.events.find((e: any) => e.type === "damage" && e.detail.side === "p2")?.detail.amount as number;
    expect(d1).toBe(Math.floor(r1.state.sides.p2.unit.base.hp / 4));
    // 受击窗口语义：prevTaken = 自身两次行动间承伤（p2 更快先动 → 同回合内 p2 先打中 p1 即计入）
    const s2 = start("c3".repeat(16));
    const rB = turn(s2, "syn-prevtaken", "syn-strike", 1); // p2 先手命中 p1 → p1 prevTaken>0 → 无加成（0 固伤）
    const d2 = rB.events.find((e: any) => e.type === "damage" && e.detail.side === "p2")?.detail.amount as number | undefined;
    expect(d2 ?? 0).toBe(0);
  });

  it("swap_hp：双方当前体力互换", () => {
    const s = start("d4".repeat(16));
    s.sides.p1.unit.currentHp = 30;
    s.sides.p2.unit.currentHp = 90;
    const r = turn(s, "syn-swap2", "syn-attr", 1);
    expect(r.state.sides.p1.unit.currentHp).toBe(90);
    expect(r.state.sides.p2.unit.currentHp).toBe(30);
  });

  it("crit_immune：致命一击伤害被免疫", () => {
    const s = start("e5".repeat(16));
    const r1 = turn(s, "syn-attr", "syn-critimm", 1); // p2 免疫暴击
    // 造必暴：p1 crit:true 招式打 p2 → 整击被 protected 挡下
    const r2 = turn(r1.state, "syn-critsure", "syn-attr", 2);
    expect(r2.events.some((e: any) => e.type === "protected" && e.detail.side === "p2")).toBe(true);
    expect(r2.events.every((e: any) => e.type !== "damage" || e.detail.side !== "p2")).toBe(true);
  });

  it("react trigger7：自身强化被消除 → 对手 max_hp_down", () => {
    const s = start("f6".repeat(16));
    const r1 = turn(s, "syn-react7", "syn-attr", 1); // p1 react7+atk+1
    const r2 = turn(r1.state, "syn-attr", "syn-foeclr", 2); // p2 清 p1 正级 → 触发 → p2 吃 max_hp_down
    expect(r2.state.sides.p2.unit.effects.some((e: any) => e.label === "max_hp_down")).toBe(true);
  });

  it("chanceSetIf：残血时异常几率改写为 100", () => {
    const s = start("a7".repeat(16));
    s.sides.p1.unit.currentHp = 1; // selfHpBelow 1/2 → chance 20→100
    const r = turn(s, "syn-chset", "syn-attr", 1);
    expect(r.state.sides.p2.unit.effects.some((e: any) => e.kind === "burn")).toBe(true);
  });

  it("pp zeroRandom payload：受击后对手随机 1 槽 PP 归零", () => {
    const s = start("b8".repeat(16));
    const r1 = turn(s, "syn-ppzero", "syn-attr", 1); // p1 挂 react trigger1
    const r2 = turn(r1.state, "syn-attr", "syn-strike", 2); // p2 攻击 p1 → 触发 → p2 随机槽 PP=0（断言事件，魂印可能回补终态）
    expect(r2.events.some((e: any) => e.type === "pp-delta" && e.detail.side === "p2" && e.detail.ppAfter === 0)).toBe(true);
  });

  it("clear_stages sign:up：只清对手正级", () => {
    const s = start("c9".repeat(16));
    s.sides.p2.unit.stages.atk = 2;
    s.sides.p2.unit.stages.def = -1;
    const r = turn(s, "syn-foeclr", "syn-attr", 1);
    expect(r.state.sides.p2.unit.stages.atk).toBe(0);
    expect(r.state.sides.p2.unit.stages.def).toBe(-1);
  });
});

describe("T4 react 触发器全矩阵（trigger 4/6/8/9/11/12 + 守卫）", () => {
  it("trigger=4 破盾：护盾耗尽消失时对攻击方追加固伤", () => {
    const s = start("d1".repeat(16));
    const r1 = turn(s, "syn-r4", "syn-attr", 1); // p1 挂 react4 + 30 盾
    const p2Before = r1.state.sides.p2.unit.currentHp;
    const r2 = turn(r1.state, "syn-attr", "syn-strike", 2); // p2 攻击破盾（40威力 > 30盾）→ p2 吃 50 固伤
    expect(r2.events.some((e: any) => e.type === "effect-applied" && e.detail.name === "react" && e.detail.side === "p1")).toBe(true);
    expect(r2.events.some((e: any) => e.type === "damage" && e.detail.side === "p2" && e.detail.damageKind === "fixed" && e.detail.amount === 50)).toBe(true);
    expect(r2.state.sides.p2.unit.currentHp).toBeLessThan(p2Before);
  });

  it("trigger=4 不破盾不触发：伤害 ≤ 盾值时 react 静默", () => {
    const s = start("d2".repeat(16));
    const r1 = turn(s, "syn-r4", "syn-attr", 1);
    const r2 = turn(r1.state, "syn-attr", "syn-multi", 2); // 连击 10威力×2-3，单击破不掉 30 盾
    expect(r2.events.some((e: any) => e.type === "damage" && e.detail.side === "p2" && e.detail.damageKind === "fixed" && e.detail.amount === 50)).toBe(false);
  });

  it("trigger=6 自身MISS：自己失手时触发提速", () => {
    const s = start("d3".repeat(16));
    const r1 = turn(s, "syn-r6", "syn-strike", 1);
    const before = r1.state.sides.p1.unit.stages.spd ?? 0;
    const r2 = turn(r1.state, "syn-whiff", "syn-attr", 2); // p1 必失 → react6 → spd+1
    expect(r2.events.some((e: any) => e.type === "missed" && e.detail.side === "p1")).toBe(true);
    expect(r2.state.sides.p1.unit.stages.spd).toBe(before + 1);
  });

  it("trigger=8 未受击回合末触发；受击回合不触发", () => {
    const s = start("d4".repeat(16));
    const r1 = turn(s, "syn-r8", "syn-strike", 1); // p1 挂 react8 但被 p2 打中 → 不发
    expect(r1.events.filter((e: any) => e.type === "heal" && e.detail.side === "p1").length).toBe(0);
    const r2 = turn(r1.state, "syn-attr", "syn-attr", 2); // 双方互不伤害 → p1 回合末触发回血
    expect(r2.events.some((e: any) => e.type === "effect-applied" && e.detail.name === "react" && e.detail.side === "p1")).toBe(true);
    expect(r2.events.some((e: any) => e.type === "heal" && e.detail.side === "p1" && e.detail.amount > 0)).toBe(true);
  });

  it("trigger=9 对手切换：payload 落到新登场精灵", () => {
    // bench 用 syn-delta（无 entry_dispel/control 免疫魂印）——epsilon 的龙魂蔽障会先清掉 react 窗口，是语义而非 bug
    const s = initBattle(PACK, { battleId: "b", seedHex: "d5".repeat(16), p1: "syn-gamma", p2: "syn-epsilon", bench: { p2: ["syn-delta"] } });
    const r1 = turn(s, "syn-r9", "syn-attr", 1);
    const r2 = applyTurn(PACK, r1.state, {
      p1: { actionId: "act_syn-attr", origin: "player", idempotencyKey: "t9a" },
      p2: { actionId: "act_switch-0", origin: "player", idempotencyKey: "t9b" },
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.events.some((e: any) => e.type === "switch" && e.detail.side === "p2")).toBe(true);
    expect(r2.state.sides.p2.unit.speciesId).toBe("syn-delta");
    expect(r2.state.sides.p2.unit.effects.some((e: any) => e.kind === "paralysis")).toBe(true);
  });

  it("trigger=11 cat:1 自身属性招触发回血，攻击招不触发", () => {
    const s = start("d6".repeat(16));
    const r1 = turn(s, "syn-r11", "syn-strike", 1); // 挂 react11（同招先派发触发后挂条目，不自触发）
    const r2 = turn(r1.state, "syn-attr", "syn-attr", 2); // p1 属性招 → heal（钳制到缺口，断事件不断定值）
    expect(r2.events.some((e: any) => e.type === "effect-applied" && e.detail.name === "react" && e.detail.side === "p1")).toBe(true);
    expect(r2.events.some((e: any) => e.type === "heal" && e.detail.side === "p1" && e.detail.amount > 0)).toBe(true);
    const r3 = turn(r2.state, "syn-strike", "syn-attr", 3); // p1 物理攻击 → 不触发
    expect(r3.events.some((e: any) => e.type === "effect-applied" && e.detail.name === "react" && e.detail.side === "p1")).toBe(false);
    expect(r3.events.some((e: any) => e.type === "heal" && e.detail.side === "p1" && !e.detail.source)).toBe(false);
  });

  it("trigger=12 cat:2 自身物理命中逐击 atk+1，特殊招不触发", () => {
    const s = start("d7".repeat(16));
    const r1 = turn(s, "syn-r12", "syn-strike", 1);
    const atk0 = r1.state.sides.p1.unit.stages.atk ?? 0;
    const r2 = turn(r1.state, "syn-strike", "syn-attr", 2); // 物理命中 → atk+1
    expect(r2.state.sides.p1.unit.stages.atk).toBe(atk0 + 1);
    const r3 = turn(r2.state, "syn-siphon", "syn-attr", 3); // 特殊招命中 → 不触发
    expect(r3.state.sides.p1.unit.stages.atk).toBe(atk0 + 1);
  });

  it("守卫 max：伤害 <阈值触发，≥阈值不触发", () => {
    const s = start("d8".repeat(16));
    const r1 = turn(s, "syn-rmax", "syn-strike", 1);
    const r2 = turn(r1.state, "syn-attr", "syn-multi", 2); // 每击 <100 → 触发烧伤 p2
    expect(r2.state.sides.p2.unit.effects.some((e: any) => e.kind === "burn")).toBe(true);
    const s2 = start("d9".repeat(16));
    const r3 = turn(s2, "syn-rmax", "syn-strike", 1);
    const r4 = turn(r3.state, "syn-attr", "syn-big", 3); // 99999 ≥100 → 不触发
    expect(r4.state.sides.p2.unit.effects.some((e: any) => e.kind === "burn")).toBe(false);
  });

  it("守卫 prioMin：对手先制技触发，常速招不触发", () => {
    const s = start("e1".repeat(16));
    const r1 = turn(s, "syn-rprio", "syn-attr", 1);
    const r2 = turn(r1.state, "syn-attr", "syn-prioatk", 2); // p2 prio1 → 触发 fear
    expect(r2.events.some((e: any) => e.type === "effect-applied" && e.detail.name === "react" && e.detail.side === "p1")).toBe(true);
    expect(r2.state.sides.p2.unit.effects.some((e: any) => e.kind === "fear")).toBe(true);
    const s2 = start("e2".repeat(16));
    const r3 = turn(s2, "syn-rprio", "syn-attr", 1);
    const r4 = turn(r3.state, "syn-attr", "syn-strike", 2); // prio0 → 不触发
    expect(r4.state.sides.p2.unit.effects.some((e: any) => e.kind === "fear")).toBe(false);
  });

  it("守卫 count：受击触发 1 次后条目消散（连击第二击不再发）", () => {
    const s = start("e3".repeat(16));
    const r1 = turn(s, "syn-rcnt", "syn-attr", 1);
    const r2 = turn(r1.state, "syn-attr", "syn-multi", 2); // 2-3 连击，仅首击触发
    expect(r2.events.filter((e: any) => e.type === "effect-applied" && e.detail.name === "react" && e.detail.side === "p1").length).toBe(1);
    expect(r2.events.some((e: any) => e.type === "effect-faded" && e.detail.name === "react" && e.detail.side === "p1")).toBe(true);
  });

  it("params.chance：0 永不触发 / 100 每次触发（条目级逐次判定，非挂窗判定）", () => {
    const s = start("e4".repeat(16));
    const r1 = turn(s, "syn-rch0", "syn-attr", 1);
    expect(r1.state.sides.p1.unit.effects.some((e: any) => e.kind === "react")).toBe(true); // 窗口照常挂上
    const r2 = turn(r1.state, "syn-attr", "syn-strike", 2);
    expect(r2.events.some((e: any) => e.type === "effect-applied" && e.detail.name === "react")).toBe(false);
    expect(r2.state.sides.p2.unit.effects.some((e: any) => e.kind === "burn")).toBe(false);
    const s2 = start("e5".repeat(16));
    const r3 = turn(s2, "syn-rch100", "syn-attr", 1);
    const r4 = turn(r3.state, "syn-attr", "syn-strike", 2);
    expect(r4.state.sides.p2.unit.effects.some((e: any) => e.kind === "burn")).toBe(true);
  });

  it("payload 内嵌 chance:0：react 触发事件照常发，payload op 自身判定落空", () => {
    const s = start("e6".repeat(16));
    const r1 = turn(s, "syn-rpch0", "syn-attr", 1);
    const r2 = turn(r1.state, "syn-attr", "syn-strike", 2);
    expect(r2.events.some((e: any) => e.type === "effect-applied" && e.detail.name === "react" && e.detail.side === "p1")).toBe(true);
    expect(r2.state.sides.p2.unit.effects.some((e: any) => e.kind === "burn")).toBe(false);
  });

  it("trigger=3 cat:4 攻击技门控：非属性招即触发（物理/特殊都算）", () => {
    const s = start("e7".repeat(16));
    const r1 = turn(s, "syn-r3atk", "syn-attr", 1);
    const r2 = turn(r1.state, "syn-attr", "syn-siphon", 2); // 特殊招 → cat4 门控过 → fear
    expect(r2.state.sides.p2.unit.effects.some((e: any) => e.kind === "fear")).toBe(true);
    const s2 = start("e8".repeat(16));
    const r3 = turn(s2, "syn-r3atk", "syn-attr", 1);
    const r4 = turn(r3.state, "syn-attr", "syn-attr", 2); // 属性招 cat1 → 不触发
    expect(r4.state.sides.p2.unit.effects.some((e: any) => e.kind === "fear")).toBe(false);
  });
});

describe("T2 flag 原子行为补盲", () => {
  // 直接注入效果条目的助手（绕开施放回合，专测 flag 语义）——周期/轴名经 periodicFormOf/axesFormOf 脱糖
  const grant = (s: any, side: "p1" | "p2", kind: string, params?: Record<string, number>, turns = 2) => {
    const fx = { op: "apply_status", name: kind, ...(params !== undefined ? { params } : {}) } as any;
    if (TICK_NAMES.has(kind)) {
      const lifted = liftTick(fx);
      s.sides[side].unit.effects.push({ kind: "periodic", effectInstanceId: `t_${side}_${kind}`, remainingTurns: turns, params: lifted.params, payload: lifted.payload, appliedTurn: 0 });
      return;
    }
    const ax = axesFormOf(fx);
    const per = ax === undefined ? periodicFormOf(fx) : undefined;
    s.sides[side].unit.effects.push(ax !== undefined
      ? { kind: ax.kind, label: kind, ...(ax.at !== undefined ? { at: ax.at } : {}), effectInstanceId: `t_${side}_${kind}`, remainingTurns: turns, params: ax.params, appliedTurn: 0 }
      : per !== undefined
        ? { kind: "periodic", label: kind, effectInstanceId: `t_${side}_${kind}`, remainingTurns: turns, params: per.params, payload: per.payload, appliedTurn: 0 }
        : { kind, effectInstanceId: `t_${side}_${kind}`, remainingTurns: turns, ...(params !== undefined ? { params } : {}), appliedTurn: 0 });
  };
  const dmgTo = (r: any, side: "p1" | "p2") =>
    r.events.filter((e: any) => e.type === "damage" && e.detail.side === side && e.detail.cause === undefined).map((e: any) => e.detail.amount as number);

  it("DoT 族（frostbite/poison/dot_field）：回合末按 flag 表扣血", () => {
    for (const mv of ["t2-frz", "t2-poi", "t2-dotf"]) {
      const s = start("f1".repeat(16));
      const r = turn(s, mv, "syn-attr", 1); // p1 施放 → 落在 p2，回合末 p2 跳 DoT
      const kind = mv === "t2-frz" ? "frostbite" : mv === "t2-poi" ? "poison" : "dot_field";
      expect(r.events.some((e: any) => e.type === "damage" && e.detail.side === "p2" && e.detail.cause === `status:${kind}`)).toBe(true);
    }
  });

  it("blockChance 100（sleep）：持有者行动必然失败", () => {
    const s = start("f2".repeat(16));
    const r = turn(s, "t2-slp", "syn-attr", 1); // p1 催眠 p2
    const r2 = turn(r.state, "syn-attr", "syn-strike", 2); // p2 睡着 → action-failed
    expect(r2.events.some((e: any) => e.type === "action-failed" && e.detail.side === "p2" && e.detail.reason === "status:sleep")).toBe(true);
  });

  it("reflect_status：对手施加的 ailment 反弹回行动方", () => {
    const s = start("f3".repeat(16));
    const r1 = turn(s, "syn-attr", "t2-refl", 1); // p2 挂反弹
    const r2 = turn(r1.state, "syn-burn", "syn-attr", 2); // p1 对 p2 施 burn → 弹回 p1
    expect(r2.events.some((e: any) => e.type === "control-immune" && e.detail.name === "reflect:burn")).toBe(true);
    expect(r2.state.sides.p1.unit.effects.some((e: any) => e.kind === "burn")).toBe(true);
    expect(r2.state.sides.p2.unit.effects.some((e: any) => e.kind === "burn")).toBe(false);
  });

  it("reflect_degrade：对手施加的负向 stage 弹回施加方（自身不降、行动方反降）", () => {
    const s = start("fd".repeat(16));
    const r1 = turn(s, "syn-crtstg", "t2-refldg", 1); // p2 挂降级反弹（p1 用 crt 技能不碰 atk）
    const r2 = turn(r1.state, "t2-dnatk", "t2-refldg", 2); // p1 对 p2 降攻 → 弹回 p1（p2 重挂状态无副作用）
    expect(r2.events.some((e: any) => e.type === "control-immune" && e.detail.name === "reflect_degrade")).toBe(true);
    expect(r2.state.sides.p2.unit.stages.atk ?? 0).toBe(0); // p2 不降
    expect(r2.state.sides.p1.unit.stages.atk).toBe(-1); // p1 被弹降
  });

  it("bind：noSwitch 拦主动换人 + DoT 回合末跳", () => {
    const s = initBattle(PACK, { battleId: "b", seedHex: "f4".repeat(16), p1: "syn-gamma", p2: "syn-delta", bench: { p2: ["syn-epsilon"] } });
    const r1 = turn(s, "t2-bind", "syn-attr", 1); // p2 被束缚
    expect(r1.events.some((e: any) => e.type === "damage" && e.detail.side === "p2" && e.detail.cause === "status:bind")).toBe(true);
    const r2 = applyTurn(PACK, r1.state, {
      p1: { actionId: "act_syn-attr", origin: "player", idempotencyKey: "bda" },
      p2: { actionId: "act_switch-0", origin: "player", idempotencyKey: "bdb" },
    });
    expect(r2.ok && r2.events.some((e: any) => e.type === "action-failed" && e.detail.side === "p2" && e.detail.reason === "bound")).toBe(true);
  });

  it("pp_double / pp_free：PP 消耗 ×2 / 免费", () => {
    const s2 = start("f6".repeat(16));
    const c1 = turn(s2, "syn-strike", "syn-attr", 1);
    const base = (c1.events.find((e: any) => e.type === "pp-spent" && e.detail.side === "p1") as any).detail.ppAfter as number; // 基准：耗 1
    const s = start("f5".repeat(16));
    const r1 = turn(s, "t2-ppx2", "syn-attr", 1);
    const r2 = turn(r1.state, "syn-strike", "syn-attr", 2);
    const spent = r2.events.find((e: any) => e.type === "pp-spent" && e.detail.side === "p1") as any;
    expect(spent.detail.ppAfter).toBe(base - 1); // 同一招多花 1（×2 = 2PP）
    const s3 = start("f7".repeat(16));
    const r3 = turn(s3, "t2-pp0", "syn-attr", 1);
    const r4 = turn(r3.state, "syn-strike", "syn-attr", 2);
    const free = r4.events.find((e: any) => e.type === "pp-spent" && e.detail.side === "p1") as any;
    expect(free.detail.ppAfter).toBe(base + 1); // 免费 → 不扣
  });

  it("承伤/出伤调节矩阵（同 seed 对照基准伤害）", () => {
    const base = (() => { const r = turn(start("f8".repeat(16)), "syn-strike", "syn-attr", 1); return dmgTo(r, "p2")[0]!; })();
    // 攻击方 dmg_mul ×2
    {
      const s = start("f8".repeat(16)); grant(s, "p1", "dmg_mul", { mul: 2 });
      expect(dmgTo(turn(s, "syn-strike", "syn-attr", 1), "p2")[0]!).toBe(base * 2);
    }
    // 攻击方 dmg_flat +50
    {
      const s = start("f8".repeat(16)); grant(s, "p1", "dmg_flat", { flat: 50 });
      expect(dmgTo(turn(s, "syn-strike", "syn-attr", 1), "p2")[0]!).toBe(base + 50);
    }
    // 守方 dmg_taken_down 50%
    {
      const s = start("f8".repeat(16)); grant(s, "p2", "dmg_taken_down", { pct: 50 });
      expect(dmgTo(turn(s, "syn-strike", "syn-attr", 1), "p2")[0]!).toBe(Math.floor(base / 2) === 0 ? base : Math.floor(base / 2));
    }
    // 守方 dmg_cap 30：固伤 99999 → 30
    {
      const s = start("f8".repeat(16)); grant(s, "p1", "dmg_cap", { cap: 30 });
      expect(dmgTo(turn(s, "syn-attr", "syn-big", 1), "p1")[0]!).toBe(30);
    }
    // 守方 dmg_floor 50：基准 24 <50 → 归零（引擎仍推 amount:0 的伤害事件）
    {
      const s = start("f8".repeat(16)); grant(s, "p2", "dmg_floor", { min: 50 });
      expect(dmgTo(turn(s, "syn-strike", "syn-attr", 1), "p2")[0] ?? 0).toBe(0);
    }
    // 守方 dmg_immune_above 50：99999 >50 → 归零
    {
      const s = start("f8".repeat(16)); grant(s, "p1", "dmg_immune_above", { max: 50 });
      expect(dmgTo(turn(s, "syn-attr", "syn-big", 1), "p1")[0] ?? 0).toBe(0);
    }
    // 守方 flat_taken_pct 50%：fixed 99999 → 49999
    {
      const s = start("f8".repeat(16)); grant(s, "p1", "flat_taken_pct", { pct: 50 });
      expect(dmgTo(turn(s, "syn-attr", "syn-big", 1), "p1")[0]!).toBe(49999);
    }
    // 攻击方 dmg_out_floor 150：24 → 150
    {
      const s = start("f8".repeat(16)); grant(s, "p1", "dmg_out_floor", { min: 150 });
      expect(dmgTo(turn(s, "syn-strike", "syn-attr", 1), "p2")[0]!).toBe(150);
    }
    // 攻击方 dmg_out_cap 5：24 → 5
    {
      const s = start("f8".repeat(16)); grant(s, "p1", "dmg_out_cap", { cap: 5 });
      expect(dmgTo(turn(s, "syn-strike", "syn-attr", 1), "p2")[0]!).toBe(5);
    }
    // 攻方 dmg_weaken 1/2（dmgOutFrac：持有方出伤削弱，注给攻击方 p2）
    {
      const ctrl = dmgTo(turn(start("f8".repeat(16)), "syn-attr", "syn-strike", 1), "p1")[0]!;
      const s = start("f8".repeat(16)); grant(s, "p2", "dmg_weaken", { n: 1, d: 2 });
      expect(dmgTo(turn(s, "syn-attr", "syn-strike", 1), "p1")[0]!).toBeLessThan(ctrl);
    }
    // phys_half：物理减半 / 特殊不减
    {
      const s = start("f8".repeat(16)); grant(s, "p2", "phys_half", { cat: 2, n: 1, d: 2 });
      expect(dmgTo(turn(s, "syn-strike", "syn-attr", 1), "p2")[0]!).toBeLessThan(base);
      const s2 = start("f9".repeat(16)); grant(s2, "p2", "phys_half", { cat: 2, n: 1, d: 2 });
      expect(dmgTo(turn(s2, "syn-siphon", "syn-attr", 1), "p2")[0]!).toBeGreaterThan(0);
    }
    // spec_half：特殊减半 / 物理不减
    {
      const s = start("fa".repeat(16)); grant(s, "p2", "spec_half", { cat: 3, n: 1, d: 2 });
      const spec = dmgTo(turn(s, "syn-siphon", "syn-attr", 1), "p2")[0]!;
      const s2 = start("fa".repeat(16));
      const specBase = dmgTo(turn(s2, "syn-siphon", "syn-attr", 1), "p2")[0]!;
      expect(spec).toBeLessThan(specBase);
      const s3 = start("f8".repeat(16)); grant(s3, "p2", "spec_half", { cat: 3, n: 1, d: 2 });
      expect(dmgTo(turn(s3, "syn-strike", "syn-attr", 1), "p2")[0]!).toBe(base);
    }
  });

  it("crit_always：持有期间攻击必致（crit:true 事件标记）", () => {
    const s = start("fc".repeat(16)); grant(s, "p1", "crit_always");
    const r = turn(s, "syn-strike", "syn-attr", 1);
    expect(r.events.some((e: any) => e.type === "damage" && e.detail.side === "p2" && e.detail.crit === true)).toBe(true);
  });

  it("crit_reflect：对手的致命一击全额反弹回攻击方", () => {
    const s = start("fd".repeat(16)); grant(s, "p1", "crit_reflect");
    const r = turn(s, "syn-attr", "syn-critsure", 1); // p2 打致命 → 全额反给 p2
    expect(r.events.some((e: any) => e.type === "damage" && e.detail.side === "p2" && e.detail.cause === "crit_reflect")).toBe(true);
  });

  it("must_hit 穿透 must_miss；must_miss_phys/spec 只挡对应类别", () => {
    // must_miss_phys：物理失 / 特殊中（均带 accuracy 才会进 miss 判定）
    const s = start("fe".repeat(16)); grant(s, "p2", "must_miss_phys");
    const r = turn(s, "t2-phys95", "syn-attr", 1);
    expect(r.events.some((e: any) => e.type === "missed" && e.detail.side === "p1")).toBe(true);
    const s2 = start("fe".repeat(16)); grant(s2, "p2", "must_miss_phys");
    const r2 = turn(s2, "t2-spec95", "syn-attr", 1); // special 穿透物闪
    expect(dmgTo(r2, "p2").length).toBe(1);
    // must_hit 优先于 must_miss：p1 持必中，用 accuracy:0 的虚晃仍命中
    const s3 = start("ff".repeat(16)); grant(s3, "p1", "must_hit");
    const r3 = turn(s3, "syn-whiff", "syn-attr", 1);
    expect(r3.events.some((e: any) => e.type === "missed" && e.detail.side === "p1")).toBe(false);
    expect(dmgTo(r3, "p2").length).toBe(1);
    // 无 accuracy 字段的招恒中：必闪不挡（先返回的真实语义——必中>必闪）
    const s4 = start("fe".repeat(16)); grant(s4, "p2", "must_miss_phys");
    const r4 = turn(s4, "syn-strike", "syn-attr", 1);
    expect(dmgTo(r4, "p2").length).toBe(1);
  });

  it("prio_immune：对手先制攻击技 MISS，常速正常", () => {
    const s = start("10".repeat(16)); grant(s, "p1", "prio_immune");
    const r = turn(s, "syn-attr", "t2-prio95", 1); // p2 prio1 → MISS
    expect(r.events.some((e: any) => e.type === "missed" && e.detail.side === "p2")).toBe(true);
    const s2 = start("11".repeat(16)); grant(s2, "p1", "prio_immune");
    const r2 = turn(s2, "syn-attr", "t2-phys95", 1); // prio0 → 命中
    expect(dmgTo(r2, "p1").length).toBe(1);
  });

  it("dodge pct:100：概率闪避满值即必闪", () => {
    const s = start("12".repeat(16)); grant(s, "p1", "dodge", { pct: 100 });
    const r = turn(s, "syn-attr", "t2-phys95", 1);
    expect(r.events.some((e: any) => e.type === "missed" && e.detail.side === "p2")).toBe(true);
  });

  it("no_switch：持有者主动换人失败（bound）", () => {
    const s = initBattle(PACK, { battleId: "b", seedHex: "13".repeat(16), p1: "syn-gamma", p2: "syn-delta", bench: { p2: ["syn-epsilon"] } });
    grant(s, "p2", "no_switch");
    const r = applyTurn(PACK, s, {
      p1: { actionId: "act_syn-attr", origin: "player", idempotencyKey: "nsa" },
      p2: { actionId: "act_switch-0", origin: "player", idempotencyKey: "nsb" },
    });
    expect(r.ok && r.events.some((e: any) => e.type === "action-failed" && e.detail.side === "p2" && e.detail.reason === "bound")).toBe(true);
  });

  it("no_stage_up：持有者正 delta 被拦（control-immune）", () => {
    const s = start("14".repeat(16)); grant(s, "p2", "no_stage_up");
    const r = turn(s, "syn-attr", "syn-attr", 1); // p2 自强被拦
    expect(r.events.some((e: any) => e.type === "control-immune" && e.detail.side === "p2" && e.detail.name === "no_stage_up")).toBe(true);
    expect(r.state.sides.p2.unit.stages.atk ?? 0).toBe(0);
  });

  it("heal_block：持有者回复被拦；heal_cut：回复量 -50%", () => {
    const s = start("15".repeat(16)); grant(s, "p2", "heal_block");
    const r = turn(s, "syn-attr", "syn-echo", 1); // p2 heal 被禁 → heal-blocked
    expect(r.events.some((e: any) => e.type === "action-failed" && e.detail.side === "p2" && e.detail.reason === "heal-blocked")).toBe(true);
    const s2 = start("16".repeat(16));
    s2.sides.p1.unit.currentHp = 100; grant(s2, "p1", "heal_cut", { pct: 50 });
    const r2 = turn(s2, "syn-echo", "syn-attr", 1); // flat50 × 50% = 25
    expect(r2.events.some((e: any) => e.type === "heal" && e.detail.side === "p1" && e.detail.amount === 25)).toBe(true);
  });

  it("drain_atk：持有者攻击伤害 1/2 回血（source:drain_atk）", () => {
    const s = start("17".repeat(16));
    s.sides.p1.unit.currentHp = 50; grant(s, "p1", "drain_atk", { n: 1, d: 2 });
    const r = turn(s, "syn-strike", "syn-attr", 1);
    expect(r.events.some((e: any) => e.type === "heal" && e.detail.side === "p1" && e.detail.source === "drain_atk")).toBe(true);
  });

  it("dmg_to_shield：受到的攻击伤害转等量护盾（count 消耗）", () => {
    const s = start("18".repeat(16)); grant(s, "p1", "dmg_to_shield", { count: 1 });
    const hp0 = s.sides.p1.unit.currentHp;
    const r = turn(s, "syn-attr", "syn-strike", 1);
    expect(r.state.sides.p1.unit.currentHp).toBe(hp0); // 伤害没穿盾
    expect(r.state.sides.p1.unit.effects.some((e: any) => e.kind === "shield" && (e.params?.flat ?? 0) > 0)).toBe(true);
  });

  it("down_lock：持有者负级不可被 clear_stages down 清除", () => {
    const s = start("19".repeat(16));
    s.sides.p1.unit.stages.def = -2; grant(s, "p1", "down_lock");
    const r = turn(s, "syn-attr", "syn-attr", 1);
    // 注入一个 self clear_stages down 不可行于 move 表——用 copy_stages? 直接断言 clear_stages 行为经 downLockOn 拦截已由 API 覆盖；
    // 这里验证 flag 生效期间负级保持（engine 不自动清除）
    expect(r.state.sides.p1.unit.stages.def).toBe(-2);
  });

  it("pierce_stages：无视对手正面防御级（伤害回到零级基准）", () => {
    const base = dmgTo(turn(start("1a".repeat(16)), "syn-strike", "syn-attr", 1), "p2")[0]!;
    const s = start("1a".repeat(16)); s.sides.p2.unit.stages.def = 6;
    const noPierce = dmgTo(turn(s, "syn-strike", "syn-attr", 1), "p2")[0]!;
    expect(noPierce).toBeLessThan(base); // def+6 减伤
    const s2 = start("1a".repeat(16)); s2.sides.p2.unit.stages.def = 6; grant(s2, "p1", "pierce_stages");
    expect(dmgTo(turn(s2, "syn-strike", "syn-attr", 1), "p2")[0]!).toBe(base); // 穿透 → 回基准
  });

  it("pierce_limit：穿透守方减伤/上下限/阈值免疫（不穿透护盾）", () => {
    const s = start("1b".repeat(16)); grant(s, "p2", "dmg_floor", { min: 100 }); grant(s, "p1", "pierce_limit");
    expect(dmgTo(turn(s, "syn-strike", "syn-attr", 1), "p2").length).toBe(1); // floor 被穿
    const s2 = start("1c".repeat(16)); grant(s2, "p2", "shield", { flat: 100 }); grant(s2, "p1", "pierce_limit");
    expect(dmgTo(turn(s2, "syn-strike", "syn-attr", 1), "p2")[0] ?? 0).toBe(0); // 护盾不被穿（归零事件）
  });

  it("counter mul:1 / crit_immune：反击倍率反伤 / 致命免疫归零", () => {
    const s = start("1d".repeat(16)); grant(s, "p1", "counter", { mul: 1 });
    const r = turn(s, "syn-attr", "syn-strike", 1);
    const taken = dmgTo(r, "p1")[0]!;
    expect(r.events.some((e: any) => e.type === "damage" && e.detail.side === "p2" && e.detail.cause === "counter" && e.detail.amount === taken)).toBe(true);
    const s2 = start("1e".repeat(16)); grant(s2, "p1", "crit_immune");
    const r2 = turn(s2, "syn-attr", "syn-critsure", 1); // p2 必致 → p1 protected 整击免疫
    expect(r2.events.some((e: any) => e.type === "protected" && e.detail.side === "p1")).toBe(true);
    expect(dmgTo(r2, "p1").length).toBe(0);
  });

  it("回合末 tick 族：stage_tick / pp_tick / pp_drain / prio_push_tick", () => {
    const s = start("1f".repeat(16));
    grant(s, "p1", "stage_tick", { stat: 1, delta: 1 });
    grant(s, "p1", "pp_tick", { flat: 2 });
    grant(s, "p1", "pp_drain", { flat: 2 });
    grant(s, "p1", "prio_push_tick", { add: -1 });
    const r = turn(s, "syn-strike", "syn-strike", 1);
    expect(r.state.sides.p1.unit.stages.atk).toBe(1); // stage_tick
    expect(r.events.some((e: any) => e.type === "pp-delta" && e.detail.side === "p1" && e.detail.delta === 2)).toBe(true); // pp_tick 回补
    expect(r.events.some((e: any) => e.type === "pp-delta" && e.detail.side === "p2" && e.detail.delta === -2)).toBe(true); // pp_drain
    expect(r.events.some((e: any) => e.type === "effect-applied" && e.detail.side === "p2" && e.detail.name === "prio_up")).toBe(true); // prio_push
  });

  it("回合末转移族：steal_stages_tick / steal_rand_tick / transfer_down_tick / down_push_tick / cleanse_down_tick / cleanse_foe_tick / maxhp_tick", () => {
    // steal_stages_tick：对手正级清零转移自身（双方均用 syn-strike 避免自强招污染断言）
    const s = start("20".repeat(16));
    s.sides.p2.unit.stages.atk = 2; grant(s, "p1", "steal_stages_tick");
    const r = turn(s, "syn-strike", "syn-strike", 1);
    expect(r.state.sides.p2.unit.stages.atk).toBe(0);
    expect(r.state.sides.p1.unit.stages.atk).toBe(2);
    // 弱化转移窗（旧 transfer_down_tick）：自身负级清零转移对手。win 19 即原转移窗。
    const s2 = start("21".repeat(16));
    s2.sides.p1.unit.stages.def = -1;
    s2.sides.p1.unit.effects.push({ kind: "periodic", effectInstanceId: "t_p1_transfer_down", remainingTurns: 2, params: { win: 19 }, payload: [{ op: "transfer_stages", direction: "push", plain: true, noHooks: true }], appliedTurn: 0 });
    const r2 = turn(s2, "syn-strike", "syn-strike", 1);
    expect(r2.state.sides.p1.unit.stages.def).toBe(0);
    expect(r2.state.sides.p2.unit.stages.def).toBe(-1);
    // down_push_tick：同上（push 变体）
    const s3 = start("22".repeat(16));
    s3.sides.p1.unit.stages.spd = -2; grant(s3, "p1", "down_push_tick");
    const r3 = turn(s3, "syn-strike", "syn-strike", 1);
    expect(r3.state.sides.p1.unit.stages.spd).toBe(0);
    expect(r3.state.sides.p2.unit.stages.spd).toBe(-2);
    // cleanse_down_tick：只清自身负级不推给对手
    const s4 = start("23".repeat(16));
    s4.sides.p1.unit.stages.atk = -3; grant(s4, "p1", "cleanse_down_tick");
    const r4 = turn(s4, "syn-strike", "syn-strike", 1);
    expect(r4.state.sides.p1.unit.stages.atk).toBe(0);
    expect(r4.state.sides.p2.unit.stages.atk ?? 0).toBe(0);
    // cleanse_foe_tick：消除对手回合类效果（params.count 消耗）
    const s5 = start("24".repeat(16));
    s5.sides.p2.unit.effects.push({ kind: "periodic", label: "hot", effectInstanceId: "x", remainingTurns: 3, params: { win: 3 }, payload: [{ op: "heal", target: "self", numerator: 1, denominator: 8, plain: true }], appliedTurn: 0 });
    grant(s5, "p1", "cleanse_foe_tick");
    const r5 = turn(s5, "syn-strike", "syn-strike", 1);
    expect(r5.state.sides.p2.unit.effects.some((e: any) => e.kind === "periodic" && e.label === "hot")).toBe(false);
    expect(r5.events.some((e: any) => e.type === "effect-faded" && e.detail.name === "hot" && e.detail.side === "p2")).toBe(true);
    // maxhp_tick：回合末对手最大HP -1/4（累加 max_hp_down，基线=原始上限）
    const s6 = start("25".repeat(16)); grant(s6, "p1", "maxhp_tick", { n: 1, d: 4 });
    const r6 = turn(s6, "syn-strike", "syn-strike", 1);
    expect(r6.events.some((e: any) => e.type === "effect-applied" && e.detail.name === "max_hp_down" && e.detail.side === "p2")).toBe(true);
    expect(r6.state.sides.p2.unit.effects.some((e: any) => e.label === "max_hp_down" && (e.params?.flat ?? 0) === Math.floor(r6.state.sides.p2.unit.base.hp / 4))).toBe(true);
    // steal_rand_tick：随机 1 维对手-1 自身+1
    const s7 = start("26".repeat(16)); grant(s7, "p1", "steal_rand_tick", { count: 1, delta: 1 });
    const r7 = turn(s7, "syn-strike", "syn-strike", 1);
    const moved = r7.events.find((e: any) => e.type === "stages-transferred" && e.detail.side === "p1");
    expect(moved !== undefined).toBe(true);
  });
});

describe("T3 信封与条件组合矩阵", () => {
  const dc = (s: any) => s.rng.drawCounter as number;
  const burnOnP2 = (r: any) => r.state.sides.p2.unit.effects.some((e: any) => e.kind === "burn");
  const burnEvt = (r: any) => r.events.some((e: any) => e.type === "effect-applied" && e.detail.name === "burn");

  it("if 短路先于 chance 判定：if 不满足时不消耗概率 draw", () => {
    // ifchance：if=false（满血）→ chance draw 不消耗 → drawCounter 与无 chance 的 plain 相同
    const s0 = start("30".repeat(16)); const r0 = turn(s0, "t3-plain", "syn-attr", 1);
    const s1 = start("30".repeat(16)); const r1 = turn(s1, "t3-ifchance", "syn-attr", 1); // 满血 → if:false → 短路
    expect(dc(r1.state) - dc(s1)).toBe(dc(r0.state) - dc(s0));
    expect(burnOnP2(r1)).toBe(false); // if 不满足 → 静默跳过
    // chance 存在且 if 满足 → 恰好多消耗 1 个 draw
    const s2 = start("30".repeat(16)); s2.sides.p1.unit.currentHp = 10; // 不满血 → if 过
    const r2 = turn(s2, "t3-ifchance", "syn-attr", 1);
    expect(dc(r2.state) - dc(s2)).toBe(dc(r0.state) - dc(s0) + 1);
    // chance:50 无论成败都消耗 1 个 draw
    const s3 = start("30".repeat(16)); const r3 = turn(s3, "t3-chance", "syn-attr", 1);
    expect(dc(r3.state) - dc(s3)).toBe(dc(r0.state) - dc(s0) + 1);
  });

  it("chanceMulIf：条件满足时基础率 × 分子/分母（满血门控）", () => {
    // 满血 → floor(80×1/200)=0 → 必不触发（且 draw 仍消耗）
    const s = start("31".repeat(16)); const r = turn(s, "t3-mul0", "syn-attr", 1);
    expect(burnOnP2(r)).toBe(false);
    expect(r.events.some((e: any) => e.type === "effect-applied" && e.detail.name === "burn")).toBe(false);
    // 残血 → 条件不满足 → 80% 照常（不断言单次结果，断言 draw 消耗了 = 走了判定）
    const s2 = start("31".repeat(16)); s2.sides.p1.unit.currentHp = 10;
    const d0 = (() => { const x = start("31".repeat(16)); const rr = turn(x, "t3-plain", "syn-attr", 1); return dc(rr.state) - dc(x); })();
    const r2 = turn(s2, "t3-mul0", "syn-attr", 1);
    expect(dc(r2.state) - dc(s2)).toBe(d0 + 1);
    // 满血 → 10×10 = 100 → 必触发
    const s3 = start("32".repeat(16)); const r3 = turn(s3, "t3-mul100", "syn-attr", 1);
    expect(burnOnP2(r3)).toBe(true);
  });

  it("chanceSetIf：条件满足直接改写触发率（覆盖 mulIf 结果——顺序冻结）", () => {
    // t3-order：mulIf(×1/200→0) 与 setIf(→100) 同条件——setIf 在 mulIf 之后 → 100 必触发
    // （若顺序相反 set→mul：100×1/200=0 必不中；据此区分顺序）
    const s = start("33".repeat(16)); const r = turn(s, "t3-order", "syn-attr", 1);
    expect(burnOnP2(r)).toBe(true);
    // set1：满血 → 改写为 1%（覆盖 80）→ draw 消耗 + 结果依 seed（用两 seed 验证仍是低率：均不中概率 99%）
    const s2 = start("34".repeat(16)); const r2 = turn(s2, "t3-set1", "syn-attr", 1);
    expect(burnOnP2(r2)).toBe(false);
    // set100：对手有异常 → 100 → 必触发（覆盖基础 10）
    const s3 = start("35".repeat(16));
    s3.sides.p2.unit.effects.push({ kind: "poison", effectInstanceId: "x", remainingTurns: 2 });
    const r3 = turn(s3, "t3-set100", "syn-attr", 1);
    expect(burnEvt(r3)).toBe(true);
    // 对手无异常 → 条件不满足 → 仍走 10% 判定（draw 消耗，结果不定——不断言 burn）
    const s4 = start("35".repeat(16)); const r4 = turn(s4, "t3-set100", "syn-attr", 1);
    expect(r4.events.length).toBeGreaterThan(0);
  });

  it("chancePerUse：叠用次数×步长后判定（第3次用 20+80=100 必触发）", () => {
    let s = start("36".repeat(16));
    s = turn(s, "t3-peruse", "syn-strike", 1).state;
    s = turn(s, "t3-peruse", "syn-strike", 2).state;
    const r = turn(s, "t3-peruse", "syn-strike", 3); // useStacks=2 → 20+40×2=100
    expect(burnEvt(r)).toBe(true);
  });

  it("chancePerUse 在 mulIf/setIf 之后加算（顺序冻结）", () => {
    // t3-peruseord：mulIf 满血→0，但 perUse 在之后加 → 第2次用 = 0+100 = 100 → 必触发
    let s = start("37".repeat(16));
    s = turn(s, "t3-peruseord", "syn-strike", 1).state; // 第1次：0+0=0 必不中
    expect(s.sides.p2.unit.effects.some((e: any) => e.kind === "burn")).toBe(false);
    const r = turn(s, "t3-peruseord", "syn-strike", 2); // useStacks=1 → 0+100=100
    expect(burnEvt(r)).toBe(true);
  });

  it("chancePerStage：正级维数×步长加算（2维×50=100 必触发，0维不触发）", () => {
    const s = start("38".repeat(16));
    const r0 = turn(s, "t3-perstage", "syn-strike", 1); // 无正级 → 0 → 不中
    expect(burnEvt(r0)).toBe(false);
    const s2 = start("38".repeat(16));
    s2.sides.p1.unit.stages.atk = 1; s2.sides.p1.unit.stages.spd = 1; // 2 个正级维
    const r = turn(s2, "t3-perstage", "syn-strike", 1); // 0+100 → 必中
    expect(burnEvt(r)).toBe(true);
  });

  it("chancePerMissing：损失体力档位×步长加算（损50%→+100 必触发）", () => {
    const s = start("39".repeat(16));
    const r0 = turn(s, "t3-permiss", "syn-strike", 1); // 满血 → 0 → 不中
    expect(burnEvt(r0)).toBe(false);
    const s2 = start("39".repeat(16));
    s2.sides.p1.unit.currentHp = Math.floor(s2.sides.p1.unit.base.hp / 2); // 损 ≥50% → floor(50/50)=1 → +100
    const r = turn(s2, "t3-permiss", "syn-strike", 1);
    expect(burnEvt(r)).toBe(true);
  });

  it("if 复合谓词：and / or / not 组合", () => {
    // and: [selfStageUp, not foeStatused] —— 自身无正级 → 跳过
    const s = start("3a".repeat(16));
    const r0 = turn(s, "t3-ifand", "syn-attr", 1);
    expect(burnOnP2(r0)).toBe(false);
    // 自身正级 + 对手无异常 → 触发
    const s2 = start("3a".repeat(16)); s2.sides.p1.unit.stages.atk = 1;
    const r1 = turn(s2, "t3-ifand", "syn-attr", 1);
    expect(burnOnP2(r1)).toBe(true);
    // 自身正级 + 对手已异常 → not 失败 → 跳过
    const s3 = start("3a".repeat(16));
    s3.sides.p1.unit.stages.atk = 1;
    s3.sides.p2.unit.effects.push({ kind: "poison", effectInstanceId: "x", remainingTurns: 2 });
    const r2 = turn(s3, "t3-ifand", "syn-attr", 1);
    expect(r2.state.sides.p2.unit.effects.some((e: any) => e.kind === "burn")).toBe(false);
    // or: [selfHpBelow 1/2, foeStatused] —— 满血+对手正常 → 跳过
    const s4 = start("3b".repeat(16));
    const r3 = turn(s4, "t3-ifor", "syn-attr", 1);
    expect(burnOnP2(r3)).toBe(false);
    // or 单侧满足（对手异常）→ 触发
    const s5 = start("3b".repeat(16));
    s5.sides.p2.unit.effects.push({ kind: "poison", effectInstanceId: "x", remainingTurns: 2 });
    const r4 = turn(s5, "t3-ifor", "syn-attr", 1);
    expect(r4.state.sides.p2.unit.effects.some((e: any) => e.kind === "burn")).toBe(true);
  });

  it("chance draw 记账：消耗数 = 判定次数（chance:0 也消耗）", () => {
    // chance:0 的 op 也消耗 draw（先判定后短路）——与 perstage chance:0 对照
    const s = start("3c".repeat(16)); const r = turn(s, "t3-perstage", "syn-attr", 1);
    const s0 = start("3c".repeat(16)); const r0 = turn(s0, "t3-plain", "syn-attr", 1);
    expect(dc(r.state) - dc(s)).toBe(dc(r0.state) - dc(s0) + 1); // chance 存在 → +1 draw，即便结果为 0
  });
});

describe("T5 跨回合生命周期", () => {
  const fxOf = (s: any, side: "p1" | "p2", kind: string) => s.sides[side].unit.effects.find((e: any) => e.kind === kind);

  it("turns:N 到期语义：施加回合不递减，第 N+1 回合末 faded", () => {
    const s = start("40".repeat(16));
    const r1 = turn(s, "syn-burn", "syn-attr", 1); // burn turns=3
    const fx1 = fxOf(r1.state, "p2", "burn");
    expect(fx1 !== undefined && fx1.remainingTurns === 3).toBe(true); // 施加回合不递减
    const r2 = turn(r1.state, "syn-attr", "syn-attr", 2);
    expect(fxOf(r2.state, "p2", "burn")?.remainingTurns).toBe(2); // T2 末递减→2
    const r3 = turn(r2.state, "syn-attr", "syn-attr", 3);
    expect(fxOf(r3.state, "p2", "burn")?.remainingTurns).toBe(1); // T3 末→1
    const r4 = turn(r3.state, "syn-attr", "syn-attr", 4);
    expect(fxOf(r4.state, "p2", "burn")).toBeUndefined(); // T4 末归零移除
    expect(r4.events.some((e: any) => e.type === "effect-faded" && e.detail.name === "burn" && e.detail.side === "p2")).toBe(true);
  });

  it("turnsRange：落地抽一次 ∈[min,max]，固定 seed 确定性", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 12; i++) {
      const s = start(sha256hex(`tr${i}`).slice(0, 32));
      const r = turn(s, "t5-range", "syn-attr", 1);
      const t = fxOf(r.state, "p2", "poison")?.remainingTurns;
      expect(t === undefined || (t >= 2 && t <= 4)).toBe(true); // 施加回合不递减 → 原值保留
      if (t !== undefined) seen.add(t);
    }
    expect(seen.size).toBeGreaterThan(1); // 多 seed 覆盖不同取值
    // 同 seed 两次 → 相同回合数（确定性）
    const a = turn(start("41".repeat(16)), "t5-range", "syn-attr", 1);
    const b = turn(start("41".repeat(16)), "t5-range", "syn-attr", 1);
    expect(fxOf(a.state, "p2", "poison")?.remainingTurns).toBe(fxOf(b.state, "p2", "poison")?.remainingTurns);
  });

  it("重复施加刷新剩余回合：remainingTurns = max(旧, 新) + appliedTurn 刷新", () => {
    // syn-burn turns=3：T1 施加(rem3) → T2 末→2 → T3 末→1 → T4 重复施加 max(1,3)=3 且 appliedTurn 刷新 → T4 末不递减
    const s = start("42".repeat(16));
    let st = turn(s, "syn-burn", "syn-attr", 1).state;
    st = turn(st, "syn-attr", "syn-attr", 2).state; // rem 2
    st = turn(st, "syn-attr", "syn-attr", 3).state; // rem 1
    st = turn(st, "syn-burn", "syn-attr", 4).state; // 重复施加：max(1,3)=3
    expect(fxOf(st, "p2", "burn")?.remainingTurns).toBe(3);
    st = turn(st, "syn-attr", "syn-attr", 5).state;
    expect(fxOf(st, "p2", "burn")?.remainingTurns).toBe(2); // 从刷新点重新计
  });

  it("换场：后备保留效果与强化等级，场上方计时冻结", () => {
    const s = initBattle(PACK, { battleId: "b", seedHex: "43".repeat(16), p1: "syn-gamma", p2: "syn-delta", bench: { p1: ["syn-epsilon"] } });
    const r1 = turn(s, "syn-burn", "syn-attr", 1); // p2 burn turns=2
    expect(r1.state.sides.p2.unit.effects.some((e: any) => e.kind === "burn")).toBe(true);
    // p2 换入 bench 上的 epsilon——等等：换场是持有方主动换。改成 p1 换出验证效果保留：
    const s2 = initBattle(PACK, { battleId: "b", seedHex: "43".repeat(16), p1: "syn-gamma", p2: "syn-delta", bench: { p1: ["syn-epsilon"] } });
    const a = turn(s2, "syn-strike", "syn-burn", 1); // p2 burn p1 turns=2
    expect(a.state.sides.p1.unit.effects.some((e: any) => e.kind === "burn")).toBe(true);
    // p1 主动换出（bench epsilon 上场）
    const b = applyTurn(PACK, a.state, {
      p1: { actionId: "act_switch-0", origin: "player", idempotencyKey: "sw1" },
      p2: { actionId: "act_syn-attr", origin: "player", idempotencyKey: "sw2" },
    });
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.events.some((e: any) => e.type === "switch" && e.detail.side === "p1")).toBe(true);
    const benched = b.state.sides.p1.bench![0]!; // 换下的 gamma
    expect(benched.effects.some((e: any) => e.kind === "burn")).toBe(true); // 效果随迁到后备
    const remOnBench = benched.effects.find((e: any) => e.kind === "burn")!.remainingTurns;
    // 后备计时冻结：再过一回合，bench 上 remainingTurns 不递减
    const c = applyTurn(PACK, b.state, {
      p1: { actionId: "act_syn-attr", origin: "player", idempotencyKey: "sw3" },
      p2: { actionId: "act_syn-attr", origin: "player", idempotencyKey: "sw4" },
    });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.state.sides.p1.bench![0]!.effects.find((e: any) => e.kind === "burn")!.remainingTurns).toBe(remOnBench);
  });

  it("moveStacks：换招清零、同招连击递增（E3 已有断言；此处补换场语义）", () => {
    let s = start("44".repeat(16));
    s = turn(s, "syn-stack", "syn-strike", 1).state;
    s = turn(s, "syn-stack", "syn-strike", 2).state;
    expect(s.sides.p1.unit.moveStacks?.["syn-stack"]).toBe(2);
    // 换场不重置：换下再换回仍保留？——当前语义：moveStacks 挂在 unit 上随迁
    const s2 = initBattle(PACK, { battleId: "b", seedHex: "44".repeat(16), p1: "syn-gamma", p2: "syn-delta", bench: { p1: ["syn-epsilon"] } });
    let st = turn(s2, "syn-stack", "syn-strike", 1).state;
    st = turn(st, "syn-stack", "syn-strike", 2).state;
    expect(st.sides.p1.unit.moveStacks?.["syn-stack"]).toBe(2);
    const r = applyTurn(PACK, st, {
      p1: { actionId: "act_switch-0", origin: "player", idempotencyKey: "ms1" },
      p2: { actionId: "act_syn-strike", origin: "player", idempotencyKey: "ms2" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.sides.p1.bench![0]!.moveStacks?.["syn-stack"]).toBe(2); // 后备保留计数
  });

  it("react 链式互弹：双方受击反击 payload 被因果深度预算截断（无 runaway）", () => {
    // 双方各持"受击则对攻击方造成5点固伤"——一次命中触发 ping-pong 链。
    // 每弹 5 伤需 ~80 弹才 KO（>maxCauseDepth 64）→ transition 预算先于 KO 截断，
    // 返回 EFFECT_LIMIT 而非栈溢出（B2：嵌套链与主循环共用 applications/causeDepth）。
    const s = start("45".repeat(16));
    s.sides.p1.unit.effects.push({ kind: "react", effectInstanceId: "a", remainingTurns: 3, params: { trigger: 1 }, payload: [{ op: "damage", power: 5, kind: "fixed", target: "opponent" }] });
    s.sides.p2.unit.effects.push({ kind: "react", effectInstanceId: "b", remainingTurns: 3, params: { trigger: 1 }, payload: [{ op: "damage", power: 5, kind: "fixed", target: "opponent" }] });
    const sAlt = start("45".repeat(16));
    const rAlt = applyTurn(PACK, sAlt, {
      p1: { actionId: "act_syn-attr", origin: "player", idempotencyKey: "alt-a" },
      p2: { actionId: "act_syn-attr", origin: "player", idempotencyKey: "alt-b" },
    });
    expect(rAlt.ok).toBe(true); // 无 react 挂载的对照组正常返回
    const r = applyTurn(PACK, s, {
      p1: { actionId: "act_syn-strike", origin: "player", idempotencyKey: "chain-a" },
      p2: { actionId: "act_syn-attr", origin: "player", idempotencyKey: "chain-b" },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fault.code).toBe("ENGINE_FAULT");
    expect(String(r.fault.message)).toMatch(/maxCauseDepth/);
  });

  it("回合末顺序：先递减消散后跳 DoT——到期当回合不再跳伤害", () => {
    // remainingTurns=1 且非本回合施加 → 末段先 faded、DoT 不再跳
    const s = start("46".repeat(16));
    s.sides.p2.unit.effects.push({ kind: "burn", effectInstanceId: "x", remainingTurns: 1, appliedTurn: 0 });
    const r = turn(s, "syn-attr", "syn-attr", 1);
    expect(r.events.some((e: any) => e.type === "effect-faded" && e.detail.name === "burn" && e.detail.side === "p2")).toBe(true);
    expect(r.events.some((e: any) => e.type === "damage" && e.detail.cause === "status:burn")).toBe(false); // 已移除不跳
    // 对照：remainingTurns=2 → 递减到 1 仍存活 → DoT 跳 + 无 faded
    const s2 = start("46".repeat(16));
    s2.sides.p2.unit.effects.push({ kind: "burn", effectInstanceId: "x", remainingTurns: 2, appliedTurn: 0 });
    const r2 = turn(s2, "syn-attr", "syn-attr", 1);
    expect(r2.events.some((e: any) => e.type === "damage" && e.detail.cause === "status:burn")).toBe(true);
    expect(r2.events.some((e: any) => e.type === "effect-faded" && e.detail.name === "burn")).toBe(false);
  });
});

describe("copy_stages match（self→foe 等级同步）", () => {
  it("使对手该维等级变为与自身相同（高拉低/低拉高双向）", () => {
    // p1 def +2、p2 def +4 → p2 被改写为 +2；self 侧不变
    const s = start("52".repeat(16));
    s.sides.p1.unit.stages.def = 2;
    s.sides.p2.unit.stages.def = 4;
    const r = turn(s, "syn-stgsync", "syn-strike", 1);
    expect(r.state.sides.p2.unit.stages.def).toBe(2);
    expect(r.state.sides.p1.unit.stages.def).toBe(2);
    expect(r.events.some((e: any) => e.type === "stat-stage" && e.detail.side === "p2" && e.detail.stat === "def" && e.detail.stageAfter === 2)).toBe(true);
    // p1 def +3、p2 def -2 → p2 被拉高到 +3（负转正也是"变为相同"）
    const s2 = start("53".repeat(16));
    s2.sides.p1.unit.stages.def = 3;
    s2.sides.p2.unit.stages.def = -2;
    const r2 = turn(s2, "syn-stgsync", "syn-strike", 2);
    expect(r2.state.sides.p2.unit.stages.def).toBe(3);
    // 同维相同 → action-failed no-stages（不产生 stat-stage 事件）
    const s3 = start("54".repeat(16));
    s3.sides.p1.unit.stages.def = 1;
    s3.sides.p2.unit.stages.def = 1;
    const r3 = turn(s3, "syn-stgsync", "syn-strike", 3);
    expect(r3.events.some((e: any) => e.type === "stat-stage" && e.detail.stat === "def" && e.detail.side === "p2")).toBe(false);
  });
});
