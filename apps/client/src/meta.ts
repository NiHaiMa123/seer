/**
 * meta.ts —— 内容元数据客户端缓存：/api/content/:packId。
 * 规则知识属公开信息（lookup_rule 同口径）——只取 badge 需要的最小字段。
 */

export interface MoveEffect {
  op: string; power?: number; kind?: string; stat?: string; delta?: number;
  numerator?: number; denominator?: number; name?: string; turns?: number; target?: string;
  hits?: { min: number; max: number }; drain?: { numerator: number; denominator: number }; flatBonus?: number;
}
export interface StatPanel { hp: number; atk: number; def: number; spa: number; sdf: number; spd: number }
export interface MoveMeta { label: string; power: number; damageKind: string; type?: string; category?: "physical" | "special"; pp?: number; priority?: number; fifth?: boolean; ops: string[]; effects?: MoveEffect[] }
export interface UnitMeta { speciesId: string; name?: string; hp: number; types?: string[]; level?: number; nature?: string; stats?: StatPanel; seals?: string[]; soulMark?: string; fifthMoveId?: string; moveIds?: string[] }
export interface SealMeta { id: string; name: string; type: string; series?: string; stats: StatPanel; hidden?: StatPanel; exclusive?: string; desc?: string }
export interface SealRules { maxPerUnit: number; maxIdentical: number; maxPerSeries: number }
export interface SoulmarkMeta { name: string; desc?: string; effects?: { op: string;[k: string]: unknown }[] }
export interface ItemMeta {
  id: string; name: string; kind: "pp" | "hp" | "cleanse";
  cap: number; pp?: number; heal?: number; clearDown?: boolean; cleanse?: boolean; note: string;
}
export interface PackMeta { packId: string; moves: Record<string, MoveMeta>; units: Record<string, UnitMeta>; typeChart?: Record<string, Record<string, number>>; seals?: Record<string, SealMeta>; sealRules?: SealRules; soulmarks?: Record<string, SoulmarkMeta>; items?: Record<string, ItemMeta> }

const cache = new Map<string, Promise<PackMeta>>();

export function packIdOf(obs: any): string {
  const rulesetId = obs?.rules?.rulesetId ?? "synthetic-v1";
  return rulesetId === "peak-v1" ? "peak" : rulesetId;
}

export function loadMeta(packId: string): Promise<PackMeta> {
  let p = cache.get(packId);
  if (p === undefined) {
    p = fetch(`/api/content/${packId}`).then((r) => r.json() as Promise<PackMeta>);
    p.catch(() => cache.delete(packId)); // 失败不留毒缓存
    cache.set(packId, p);
  }
  return p;
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
  "fifth-verdant-aegis": "万物生发", "fifth-tidal-crash": "覆海惊涛", "fifth-drake-ruin": "灭世龙吟",
};
const ZH_MODE: Record<string, string> = { boss: "首领" };
const ZH_REASON: Record<string, string> = { ko: "击倒", concede: "认输", "turn-limit": "回合上限" };

/** 自建包走固定中文表（伽马 / 重击）。表里没有的，用内容接口的名字，不再把 id 当名字。 */
export function zhSpecies(id: string, meta?: PackMeta | null): string {
  const mapped = ZH_SPECIES[id];
  if (mapped !== undefined) return mapped;
  const name = meta?.units[id]?.name;
  return name !== undefined && name !== id ? name : id;
}
export function zhMove(id: string, meta?: PackMeta | null): string {
  const mapped = ZH_MOVE[id];
  if (mapped !== undefined) return mapped;
  const label = meta?.moves[id]?.label;
  return label !== undefined && label !== id ? label : id;
}
export const zhMode = (id: string): string => ZH_MODE[id] ?? id;
export const zhReason = (id: string): string => ZH_REASON[id] ?? id;

export const ZH_EVENT: Record<string, string> = {
  "action-declared": "出招", "damage": "伤害", "heal": "回复", "ko": "击倒",
  "switch": "换人", "revive": "复活", "stat-stage": "能力变化", "stages-transferred": "能力转移",
  "stages-cleared": "能力清除", "effect-applied": "效果附加", "effect-faded": "效果消退",
  "control-immune": "免疫", "action-failed": "失败", "battle-end": "战斗结束", "turn-end": "回合结束",
  "soulmark": "魂印", "protected": "保护", "pp-delta": "PP变化", "struggle-used": "挣扎", "missed": "未命中",
  "turn-begin": "回合开始",
};
export const zhEvent = (type: string): string => ZH_EVENT[type] ?? type;

const ZH_EFFECT: Record<string, string> = { control: "控制", immune_control: "免控", tag: "标记", periodic: "持续", modifier: "增益", shield: "护盾", seal: "封印" };
export const zhEffect = (kind: string): string => kind.startsWith("tag:") ? `标记:${zhStatus(kind.slice(4))}` : (ZH_EFFECT[kind] ?? zhStatus(kind));
/** 状态/效果内部名 → 中文（未收录的去下划线显示，不露 snake_case） */
export const zhStatus = (name: string): string => ZH_STATUS[name] ?? (/^[a-z0-9_]+$/.test(name) ? "特殊状态" : name);

const ZH_STAT: Record<string, string> = { hp: "体力", atk: "攻击", def: "防御", spa: "特攻", sdf: "特防", spd: "速度", acc: "命中" };
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
/** 本地克制计算（typeChart 整表下发后按 move 属性 × 守方属性查表）——与引擎 effectivenessOf 同构：双属性倒序兜底、缺省 16/16。 */
export function effOf(meta: PackMeta | null, mMeta: MoveMeta | undefined, defenderSpeciesId: string | undefined): number | undefined {
  const row = meta?.typeChart?.[mMeta?.type ?? ""];
  const types = defenderSpeciesId !== undefined ? meta?.units[defenderSpeciesId]?.types : undefined;
  if (row === undefined || mMeta === undefined || types === undefined || types.length === 0) return undefined;
  if (mMeta.damageKind !== "standard" && mMeta.damageKind !== "true") return undefined;
  const v = row[types.join("")] ?? (types.length === 2 ? row[`${types[1]}${types[0]}`] : undefined) ?? 16;
  return v / 16;
}
/** 克制倍率 → 飘字标签（中性 null 不飘） */
export function effTag(eff: number | undefined): { text: string; color: string } | null {
  if (eff === undefined || eff === 1) return null;
  if (eff === 0) return { text: "无效", color: "#8890a0" };
  if (eff > 1) return { text: eff >= 2 ? "克制!!" : "克制!", color: "#ffb040" };
  return { text: "微弱", color: "#7ab8ff" };
}
const ZH_TARGET: Record<string, string> = { self: "自身", opponent: "对方" };
const ZH_STATUS: Record<string, string> = {
  stun: "眩晕", immune_control: "免控", marked: "烙印",
  burn: "烧伤", frostbite: "冻伤", poison: "中毒", paralysis: "麻痹",
  fear: "害怕", sleep: "睡眠", blind: "失明", daze: "失神",
  hot: "持续恢复", dot_field: "持续固伤", prio_up: "先制提升",
  immune_status: "免疫异常", must_miss: "必定闪避", must_miss_phys: "物理闪避", must_miss_spec: "特殊闪避",
};
const ZH_DMGKIND: Record<string, string> = { standard: "普通", fixed: "固定", percent: "百分比", true: "真实" };

/** 单个招式效果 → 中文说明行（公开规则知识） */
export function describeEffect(e: MoveEffect): string {
  const tgt = ZH_TARGET[e.target ?? "opponent"] ?? e.target ?? "对方";
  switch (e.op) {
    case "damage": {
      const k = e.kind ?? "standard";
      const sfx = `${e.hits !== undefined ? `${e.hits.min === e.hits.max ? `${e.hits.min}` : `${e.hits.min}~${e.hits.max}`} 连击 · ` : ""}${e.drain !== undefined ? `吸血 ${e.drain.numerator}/${e.drain.denominator} · ` : ""}`;
      if (k === "percent") return `${sfx}造成对方最大体力 ${e.power}% 的伤害`;
      if (k === "true") return `${sfx}造成 ${e.power} 点真实伤害（无视攻防）`;
      if (k === "fixed") return `${sfx}造成 ${(e.power ?? 0) + (e.flatBonus ?? 0)} 点固定伤害`;
      return `${sfx}造成伤害，威力 ${e.power}${e.flatBonus !== undefined ? `（另附 ${e.flatBonus} 点固伤）` : ""}`;
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
      return `使${tgt}陷入「${ZH_STATUS[e.name ?? ""] ?? e.name}」${e.turns !== undefined ? `${e.turns} 回合` : "持续"}`;
    case "cleanse":
      return `净化${tgt}的异常状态与标记`;
    case "apply_status":
      return `${tgt}获得「${ZH_STATUS[e.name ?? ""] ?? e.name}」${e.turns !== undefined ? `${e.turns} 回合` : "持续"}`;
    case "apply_effect":
      return `使${tgt}附加「${ZH_STATUS[e.name ?? ""] ?? e.name}」标记 ${e.turns !== undefined ? `${e.turns} 回合` : "持续"}`;
    default:
      return ZH_OP[e.op] ?? "附加特殊效果";
  }
}

const ZH_OP: Record<string, string> = {
  pp_delta: "改变技能 PP", apply_seal: "附加刻印效果", stat_swap: "交换能力", revive: "复活",
  shield: "获得护盾", reflect: "反弹伤害", drain: "吸取体力", priority: "改变先制",
};

/** 招式悬停提示的完整中文描述行 */
export function describeMove(m: MoveMeta | undefined): string[] {
  if (m === undefined) return [];
  const head = `${m.type !== undefined ? `属性 ${m.type} · ` : ""}${m.category !== undefined ? `${ZH_CATEGORY[m.category]} · ` : ""}类型 ${ZH_DMGKIND[m.damageKind] ?? m.damageKind}${m.priority !== undefined && m.priority !== 0 ? ` · 先制 ${m.priority > 0 ? "+" : ""}${m.priority}` : ""}`;
  return [head, ...(m.effects ?? []).map(describeEffect)];
}
