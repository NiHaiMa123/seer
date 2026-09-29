/**
 * mechanics/sixstat —— 六维养成机制模块（赛尔号面板体系）。
 *
 * 机制知识全部在本目录：性格表（ruleset 级 natures.json）、种族/等级/个体/努力校验、
 * 面板推导（EV/4 不预取整 + 末端单次去尾的"省点"语义）、spa/sdf stage 键、
 * 赛尔号缩放伤害公式（物特分家 + 217..255 随机系数）、level/stats 投影。
 * 流水线只通过 Mechanic 钩子触达本模块；删除本目录 + mechanics/index.ts 注册行即卸载
 * （此时 level/ivs/evs/nature/base.spa/base.sdf/category 字段因无人认领而被 loader 拒载）。
 */
import Ajv from "ajv";
import naturesSchemaJson from "../../../../../content/schemas/natures.schema.json" with { type: "json" };
import { sha256hex } from "../../sha256.ts";
import type { StageStatKey, StatKey, StatSpread } from "../../loader.ts";
import type { Mechanic, MechanicCompileCtx, MechanicContribution, MechanicMove, MechanicUnit, PackMechView, ScaledDamageCtx } from "../types.ts";

/** 性格修正项：up=+10% stat，down=-10% stat（平衡性格为空对象）。 */
export interface NatureMod {
  up?: StageStatKey;
  down?: StageStatKey;
}

/** pack.mechanics.sixstat 的形状。键存在 = 本包启用六维养成。 */
export interface SixStatPackData {
  natures: ReadonlyMap<string, NatureMod>;
}

const ajv = new Ajv({ allErrors: true, strict: true });
const vNatures = ajv.compile(naturesSchemaJson);

/** 类型化读取 pack.mechanics.sixstat。 */
export const sixstatOf = (pack: PackMechView): SixStatPackData | undefined =>
  pack.mechanics?.["sixstat"] as SixStatPackData | undefined;

const IV_DEFAULT: StatSpread = { hp: 31, atk: 31, def: 31, spa: 31, sdf: 31, spd: 31 };
const EV_DEFAULT: StatSpread = { hp: 0, atk: 0, def: 0, spa: 0, sdf: 0, spd: 0 };

/**
 * 赛尔号面板推导（4399 解析第一期 / BWIKI 培养机制交叉验证）：
 *   体力 = Int[(2B + IV + EV/4)×L/100 + L + 10]
 *   其余 = Int[((2B + IV + EV/4)×L/100 + 5) × 性格修正]
 * 关键语义：EV/4 不预先取整，小数穿过性格乘算后整体单次 Int（去尾）——
 * 因此 ×1.1 性格项的极限努力值是 254 或 255（由 (种族个位×2+个体个位) mod 10 决定），
 * 中性项 252 即极限，省下的点数可再投资（"省点"机制）。
 * 用 4 倍整数 q = 8B + 4IV + EV 避免浮点误差。
 */
export function deriveStats(
  base: StatSpread,
  opts: { level: number; ivs: StatSpread; evs: StatSpread; nature?: NatureMod | undefined },
): StatSpread {
  const L = opts.level;
  const q = (s: StatKey) => 8 * base[s] + 4 * opts.ivs[s] + opts.evs[s];
  const out = {} as StatSpread;
  out.hp = Math.floor((q("hp") * L) / 400) + L + 10;
  for (const s of ["atk", "def", "spa", "sdf", "spd"] as const) {
    const mult = opts.nature?.up === s ? 11 : opts.nature?.down === s ? 9 : 10;
    out[s] = Math.floor(((q(s) * L + 2000) * mult) / 4000);
  }
  return out;
}

/** eff = floor(base × num / den)，§4 stage 系数表。 */
const effStat = (base: number, stage: number): number =>
  Math.floor((base * (stage >= 0 ? 2 + stage : 2)) / (stage >= 0 ? 2 : 2 - stage));

const sixFieldsOf = (u: MechanicUnit): string[] => [
  ...(u.level !== undefined ? ["level"] : []),
  ...(u.ivs !== undefined ? ["ivs"] : []),
  ...(u.evs !== undefined ? ["evs"] : []),
  ...(u.nature !== undefined ? ["nature"] : []),
  ...(u.base.spa !== undefined ? ["base.spa"] : []),
  ...(u.base.sdf !== undefined ? ["base.sdf"] : []),
];

export const sixstatMechanic: Mechanic = {
  id: "sixstat",
  doc: { rawKey: "natures", rulesetFile: "naturesFile" },
  unitFieldClaims: ["level", "ivs", "evs", "nature", "base.spa", "base.sdf"],
  moveFieldClaims: ["category"],

  compile(ctx: MechanicCompileCtx): MechanicContribution | undefined {
    const { raw, ruleset, fail } = ctx;
    const on = ruleset["statModel"] === "six-stat";
    const naturesFile = ruleset["naturesFile"];
    if (!on) {
      if (naturesFile !== undefined) fail("naturesFile declared without statModel");
      if (raw["natures"] !== undefined) fail("natures document provided but ruleset declares no naturesFile");
      return undefined;
    }
    // statModel 依赖：公式含 STAB+性格修正 → 必须同时声明克制表和性格表。
    if (ruleset["typeChartFile"] === undefined) fail('statModel "six-stat" requires typeChartFile (damage formula includes STAB)');
    if (naturesFile === undefined) fail('statModel "six-stat" requires naturesFile');
    if (raw["natures"] === undefined) fail(`ruleset declares naturesFile "${naturesFile}" but no natures document was provided`);
    if (!vNatures(raw["natures"])) fail(`natures schema: ${ajv.errorsText(vNatures.errors)}`);
    const natures = new Map(Object.entries((raw["natures"] as { natures: Record<string, NatureMod> }).natures));
    return {
      data: { natures } satisfies SixStatPackData,
      rulesetHashExtra: { naturesSha256: sha256hex(JSON.stringify(raw["natures"])) },
    };
  },

  checkUnit(unit, pack): string | null {
    if (sixstatOf(pack) === undefined) {
      const six = sixFieldsOf(unit);
      return six.length > 0
        ? `unit ${unit.id} sets six-stat fields (${six.join("/")}) but statModel is not "six-stat"`
        : null;
    }
    if (unit.base.spa === undefined || unit.base.sdf === undefined) return `unit ${unit.id} lacks spa/sdf base stats (six-stat)`;
    if (unit.ivs !== undefined) {
      for (const [s, v] of Object.entries(unit.ivs)) if (v > 31) return `unit ${unit.id} ivs.${s}=${v} exceeds 31`;
    }
    if (unit.evs !== undefined) {
      const total = Object.values(unit.evs).reduce((a, b) => a + b, 0);
      if (total > 510) return `unit ${unit.id} evs total ${total} exceeds 510`;
    }
    if (unit.nature !== undefined && !sixstatOf(pack)!.natures.has(unit.nature)) {
      return `unit ${unit.id} nature "${unit.nature}" not in natures table`;
    }
    return null;
  },

  /** 启用时注入养成默认值（loader 补 level=100/ivs=31/evs=0；nature 不填=无修正）。 */
  unitFields(unit, pack): Record<string, unknown> | undefined {
    if (sixstatOf(pack) === undefined) return undefined;
    return {
      level: unit.level ?? 100,
      ivs: unit.ivs ?? IV_DEFAULT,
      evs: unit.evs ?? EV_DEFAULT,
      ...(unit.nature !== undefined ? { nature: unit.nature } : {}),
    };
  },

  /** category 归本机制所有：物特分家只在六维模式下有意义。 */
  checkMove(move: MechanicMove, pack): string | null {
    const on = sixstatOf(pack) !== undefined;
    const dealsScaled = move.effects.some((f) => f.op === "damage" && ((f.kind ?? "standard") === "standard" || f.kind === "true"));
    if (!on) return move.category !== undefined ? `move ${move.id} sets category but statModel is not "six-stat"` : null;
    if (dealsScaled && move.category === undefined) return `move ${move.id} has standard/true damage but no category (six-stat)`;
    if (!dealsScaled && move.category !== undefined) return `move ${move.id} sets category but deals no scaled damage (six-stat)`;
    return null;
  },

  /** 面板推导接管：种族/等级/个体/努力/性格 → 六维实值。 */
  deriveBase(pack, unit): StatSpread | undefined {
    const d = sixstatOf(pack);
    if (d === undefined) return undefined;
    return deriveStats(unit.base as StatSpread, {
      level: unit.level ?? 100,
      ivs: unit.ivs ?? IV_DEFAULT,
      evs: unit.evs ?? EV_DEFAULT,
      ...(unit.nature !== undefined ? { nature: d.natures.get(unit.nature) } : {}),
    });
  },

  /** spa/sdf 参与 stage 增减（六维模式下）。 */
  stageKeys(pack): readonly StageStatKey[] {
    return sixstatOf(pack) !== undefined ? ["spa", "sdf"] : [];
  },

  /** 单位状态附加 level 字段（观测/伤害公式用）。 */
  applyUnit(pack, unit): Record<string, unknown> | undefined {
    return sixstatOf(pack) !== undefined ? { level: unit.level ?? 100 } : undefined;
  },

  /**
   * Seer 伤害公式（4399/7k7k/BWIKI 交叉验证，时代=页游经典式）：
   *   floor(floor(lv·0.4+2)·威力·攻÷防÷50+2) ×本系 ×克制 ×随机(217..255)/255
   *   physical → 攻/防；special → 特攻/特防；true 伤吃攻防值但无视防御 stage。
   */
  scaledDamage(ctx: ScaledDamageCtx): { dmg: number; roll?: number } | undefined {
    if (sixstatOf(ctx.pack) === undefined) return undefined;
    const { unit, foe, move, power, kind, eff16, stab, rng } = ctx;
    const cat = move.category ?? "physical";
    const aKey: StageStatKey = cat === "special" ? "spa" : "atk";
    const dKey: StageStatKey = cat === "special" ? "sdf" : "def";
    const atk = effStat(unit.base[aKey]!, unit.stages[aKey] ?? 0);
    const def = effStat(foe.base[dKey]!, kind === "true" ? 0 : (foe.stages[dKey] ?? 0));
    const lvf = Math.floor((unit.level ?? 100) * 0.4 + 2);
    let core = Math.floor((lvf * power * atk) / (def * 50)) + 2;
    if (eff16 !== undefined) {
      if (stab) core = Math.floor(core * (ctx.pack.stabMultiplier ?? 1.5));
      core = Math.floor((core * eff16) / 16);
      if (eff16 === 0) return { dmg: 0 }; // 免疫不抽随机系数（与原语义一致：不消耗 RNG draw）
      const roll = 217 + rng.drawBelow(39, "damage_roll");
      return { dmg: Math.max(1, Math.floor((core * roll) / 255)), roll };
    }
    const roll = 217 + rng.drawBelow(39, "damage_roll");
    return { dmg: Math.max(1, Math.floor((core * roll) / 255)), roll };
  },

  projections: [
    // level 双方可见（对手见等级）；stats 六维面板仅己方（与 PP 隐藏同一纪律）。
    { key: "level", into: "both", get: (u) => u.level },
    {
      key: "stats",
      into: "own",
      get: (u) =>
        u.level !== undefined
          ? { hp: u.base.hp, atk: u.base.atk, def: u.base.def, spa: u.base.spa, sdf: u.base.sdf, spd: u.base.spd }
          : undefined,
    },
  ],
};
