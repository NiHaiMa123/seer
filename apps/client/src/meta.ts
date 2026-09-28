/**
 * meta.ts —— 内容元数据客户端缓存：/api/content/:packId。
 * 规则知识属公开信息（lookup_rule 同口径）——只取 badge 需要的最小字段。
 */

export interface MoveEffect {
  op: string; power?: number; kind?: string; stat?: string; delta?: number;
  numerator?: number; denominator?: number; name?: string; turns?: number; target?: string;
}
export interface StatPanel { hp: number; atk: number; def: number; spa: number; sdf: number; spd: number }
export interface MoveMeta { label: string; power: number; damageKind: string; type?: string; category?: "physical" | "special"; effVs?: Record<string, number>; pp?: number; priority?: number; ops: string[]; effects?: MoveEffect[] }
export interface UnitMeta { speciesId: string; hp: number; types?: string[]; level?: number; nature?: string; stats?: StatPanel }
export interface PackMeta { packId: string; moves: Record<string, MoveMeta>; units: Record<string, UnitMeta> }

let cache: Promise<PackMeta> | null = null;

export function packIdOf(obs: any): string {
  return obs?.rules?.rulesetId ?? "synthetic-v1";
}

export function loadMeta(packId: string): Promise<PackMeta> {
  cache ??= fetch(`/api/content/${packId}`).then((r) => r.json() as Promise<PackMeta>);
  return cache;
}

const KIND_BADGE: Record<string, { tag: string; color: string }> = {
  standard: { tag: "STD", color: "#666" },
  fixed: { tag: "FIX", color: "#b080ff" },
  percent: { tag: "PCT", color: "#ffaa33" },
  true: { tag: "TRU", color: "#ff5555" },
};

export function moveBadge(meta: PackMeta | null, moveId: string): { tag: string; color: string; power: number } | null {
  const m = meta?.moves[moveId];
  if (!m || !m.ops.includes("damage")) return null;
  const b = KIND_BADGE[m.damageKind] ?? KIND_BADGE["standard"]!;
  return { ...b, power: m.power };
}

/** 合成内容的中文显示名（表现层映射，协议仍用英文 id） */
const ZH_SPECIES: Record<string, string> = {
  "syn-alpha": "阿尔法", "syn-beta": "贝塔", "syn-gamma": "伽马",
  "syn-delta": "德尔塔", "syn-epsilon": "伊普西龙",
};
const ZH_MOVE: Record<string, string> = {
  "syn-strike": "重击", "syn-jab": "突刺", "syn-bolster": "强化", "syn-recover": "回复",
  "syn-drain": "汲取", "syn-purge": "净化", "syn-slam": "猛击", "syn-blast": "爆破",
  "syn-hex": "咒印", "syn-purge-mind": "清心", "syn-ward": "守护", "syn-brand": "烙印",
};
const ZH_MODE: Record<string, string> = { boss: "首领" };
const ZH_REASON: Record<string, string> = { ko: "击倒", concede: "认输", "turn-limit": "回合上限" };

export const zhSpecies = (id: string): string => ZH_SPECIES[id] ?? id;
export const zhMove = (id: string): string => ZH_MOVE[id] ?? id;
export const zhMode = (id: string): string => ZH_MODE[id] ?? id;
export const zhReason = (id: string): string => ZH_REASON[id] ?? id;

const ZH_EVENT: Record<string, string> = {
  "action-declared": "出招", "damage": "伤害", "heal": "回复", "ko": "击倒",
  "switch": "换人", "revive": "复活", "stat-stage": "能力变化", "stages-transferred": "能力转移",
  "stages-cleared": "能力清除", "effect-applied": "效果附加", "effect-faded": "效果消退",
  "control-immune": "免疫", "action-failed": "失败", "battle-end": "战斗结束", "turn-end": "回合结束",
};
export const zhEvent = (type: string): string => ZH_EVENT[type] ?? type;

const ZH_EFFECT: Record<string, string> = { control: "控制", immune_control: "免控", tag: "标记" };
export const zhEffect = (kind: string): string => kind.startsWith("tag:") ? `标记:${kind.slice(4)}` : (ZH_EFFECT[kind] ?? kind);

const ZH_STAT: Record<string, string> = { hp: "体力", atk: "攻击", def: "防御", spa: "特攻", sdf: "特防", spd: "速度" };
export const zhStat = (k: string): string => ZH_STAT[k] ?? k;
const ZH_CATEGORY: Record<string, string> = { physical: "物攻", special: "特攻" };

/** 属性徽标配色（赛尔号页游风味）。属性名本身就是中文，直接显示。 */
export const TYPE_COLOR: Record<string, string> = {
  火: "#e05038", 水: "#3d7bd9", 草: "#4da63e", 电: "#c8a020", 冰: "#66c8d8",
  机械: "#8a8fa0", 地面: "#a0763a", 龙: "#7a4fd0", 暗影: "#5a3a78", 圣灵: "#d8b840",
  超能: "#c860a8", 战斗: "#b05828", 次元: "#40a0b8", 远古: "#987040", 自然: "#58a848",
  混沌: "#483858", 王: "#c8a848", 邪灵: "#883048", 光: "#d8c860", 神秘: "#7060c0",
  飞行: "#78a8d8", 轮回: "#609878", 虚空: "#504868", 神灵: "#d0a060", 虫: "#889830",
  飞龙: "#6860a8",
};
export const typeColor = (t: string): string => TYPE_COLOR[t] ?? "#707888";
/** 克制倍率 → 飘字标签（中性 null 不飘） */
export function effTag(eff: number | undefined): { text: string; color: string } | null {
  if (eff === undefined || eff === 1) return null;
  if (eff === 0) return { text: "无效", color: "#8890a0" };
  if (eff > 1) return { text: eff >= 2 ? "克制!!" : "克制!", color: "#ffb040" };
  return { text: "微弱", color: "#7ab8ff" };
}
const ZH_TARGET: Record<string, string> = { self: "自身", opponent: "对方" };
const ZH_STATUS: Record<string, string> = { stun: "眩晕", immune_control: "免控", marked: "烙印" };
const ZH_DMGKIND: Record<string, string> = { standard: "普通", fixed: "固定", percent: "百分比", true: "真实" };

/** 单个招式效果 → 中文说明行（公开规则知识） */
export function describeEffect(e: MoveEffect): string {
  const tgt = ZH_TARGET[e.target ?? "opponent"] ?? e.target ?? "对方";
  switch (e.op) {
    case "damage": {
      const k = e.kind ?? "standard";
      if (k === "percent") return `造成对方最大体力 ${e.power}% 的伤害`;
      if (k === "true") return `造成 ${e.power} 点真实伤害（无视攻防）`;
      if (k === "fixed") return `造成 ${e.power} 点固定伤害`;
      return `造成伤害，威力 ${e.power}`;
    }
    case "apply_stat_stage":
      return `${tgt}${ZH_STAT[e.stat ?? ""] ?? e.stat} ${(e.delta ?? 0) > 0 ? "+" : ""}${e.delta}`;
    case "heal":
      return `回复${tgt} ${e.numerator}/${e.denominator} 最大体力`;
    case "transfer_stages":
      return "吸取对方的能力等级变化";
    case "clear_stages":
      return `清除${tgt}的能力等级变化`;
    case "control":
      return `使${tgt}陷入「${ZH_STATUS[e.name ?? ""] ?? e.name}」${e.turns} 回合`;
    case "cleanse":
      return `净化${tgt}的异常状态与标记`;
    case "apply_status":
      return `${tgt}获得「${ZH_STATUS[e.name ?? ""] ?? e.name}」${e.turns} 回合`;
    case "apply_effect":
      return `使${tgt}附加「${ZH_STATUS[e.name ?? ""] ?? e.name}」标记 ${e.turns} 回合`;
    default:
      return e.op;
  }
}

/** 招式悬停提示的完整中文描述行 */
export function describeMove(m: MoveMeta | undefined): string[] {
  if (m === undefined) return [];
  const head = `${m.type !== undefined ? `属性 ${m.type} · ` : ""}${m.category !== undefined ? `${ZH_CATEGORY[m.category]} · ` : ""}类型 ${ZH_DMGKIND[m.damageKind] ?? m.damageKind}${m.priority !== undefined && m.priority !== 0 ? ` · 先制 ${m.priority > 0 ? "+" : ""}${m.priority}` : ""}`;
  return [head, ...(m.effects ?? []).map(describeEffect)];
}
