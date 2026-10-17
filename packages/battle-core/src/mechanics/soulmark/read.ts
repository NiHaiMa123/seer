/**
 * 魂印结算看主语和概率的唯一入口。
 * 主语是 guard 上的已有谓词，不新增 Condition 成员。
 * 概率是 chance 闭类型，仍交给原来的那一次 fireTriggers 判定（once 不是第二次掷骰）。
 */
import type { Condition } from "../../loader.ts";

export interface SoulSubject {
  actor?: "self" | "foe";
  victim?: "self" | "foe";
  who?: "self" | "foe";
  switcher?: "self" | "foe";
  /** 1 属性 2 物理 3 特殊；数组=任一类。 */
  cat?: 1 | 2 | 3 | readonly (1 | 2 | 3)[];
  streak?: "attack" | "status";
  streakN?: number;
  sameMove?: true;
  /** true=仅必中招；false=仅非必中招。 */
  alwaysHit?: boolean;
}

/** 主语谓词。世界谓词仍是原来的 Condition，叠在一起时放在 if，避免新条件。 */
export interface SoulGuard extends SoulSubject {
  if?: Condition;
}

export interface SoulChance {
  /** 静态概率（%）。 */
  base?: number;
  dyn?: "selfHpPct" | "selfMissingHpPct" | "foeHpPct" | "foeMissingHpPct";
  grow?: { add: number; cap?: number; on?: "fail" | "always" };
  resetOnFire?: true;
  /** 每场战斗限一次。同一次判定里的 once 门。 */
  once?: true;
}

export interface SoulView {
  subject: SoulSubject;
  world?: Condition;
  chance?: SoulChance;
}

/** 调用方只填这次钩子要核的轴。没填的轴不看，避免回合钩误用出招谓词。 */
export interface SoulScene {
  actor?: "self" | "foe";
  victim?: "self" | "foe";
  switcher?: "self" | "foe";
  who?: "self" | "foe";
  checkCat?: boolean;
  cat?: number;
  checkStreak?: boolean;
  checkAlways?: boolean;
  prevCat?: number;
  catStreak?: number;
  prevMoveId?: string;
  moveId?: string;
  moveAlways?: boolean;
}

const SUBJECT_KEYS = ["actor", "victim", "who", "switcher", "cat", "streak", "streakN", "sameMove", "alwaysHit"] as const;

function isGuardBag(g: object): boolean {
  return Object.keys(g).some((k) => k === "if" || (SUBJECT_KEYS as readonly string[]).includes(k));
}

function catHits(gate: SoulSubject["cat"], cat: number | undefined): boolean {
  if (gate === undefined) return true;
  if (cat === undefined) return false;
  return Array.isArray(gate) ? (gate as readonly number[]).includes(cat) : gate === cat;
}

/** 上一动与本动同属攻击（物特可互换）或同属属性。首动不成立。 */
function streakHolds(prev: number | undefined, cat: number | undefined, streak: "attack" | "status"): boolean {
  if (prev === undefined || cat === undefined) return false;
  if (streak === "attack") return (prev === 2 || prev === 3) && (cat === 2 || cat === 3);
  return prev === 1 && cat === 1;
}

export function readSoul(e: { guard?: SoulGuard | Condition; chance?: SoulChance }): SoulView {
  const subject: SoulSubject = {};
  let world: Condition | undefined;
  const g = e.guard;
  if (g !== undefined && isGuardBag(g)) {
    const bag = g as SoulGuard;
    for (const k of SUBJECT_KEYS) {
      if (bag[k] !== undefined) (subject as Record<string, unknown>)[k] = bag[k];
    }
    world = bag.if;
  } else if (g !== undefined) {
    world = g as Condition;
  }
  return { subject, ...(world !== undefined ? { world } : {}), ...(e.chance !== undefined ? { chance: e.chance } : {}) };
}

/** 缺省：switcher=自身换下，who=对手落空。actor/victim 缺谓词则对不上（这两条 schema 必填）。 */
export function subjectOk(view: SoulView, scene: SoulScene): boolean {
  const s = view.subject;
  if (scene.actor !== undefined && s.actor !== scene.actor) return false;
  if (scene.victim !== undefined && s.victim !== scene.victim) return false;
  if (scene.switcher !== undefined && (s.switcher === "foe" ? "foe" : "self") !== scene.switcher) return false;
  if (scene.who !== undefined && (s.who === "self" ? "self" : "foe") !== scene.who) return false;
  if (scene.checkCat === true && !catHits(s.cat, scene.cat)) return false;
  if (scene.checkStreak === true) {
    if (s.streak !== undefined && !streakHolds(scene.prevCat, scene.cat, s.streak)) return false;
    if (s.streakN !== undefined && (scene.catStreak ?? 0) < s.streakN) return false;
    if (s.sameMove === true && !(scene.prevMoveId !== undefined && scene.prevMoveId === scene.moveId)) return false;
  }
  if (scene.checkAlways === true && s.alwaysHit !== undefined && scene.moveAlways !== s.alwaysHit) return false;
  return true;
}
