/**
 * battle/badges.tsx —— 徽章原子组件：能力等级/效果 chips、魂印徽印、刻印徽印、属性 chips。
 * 全部只读公开 Observation/meta——机制 UI 追加从这里出口（模组化）。
 */
import { zhStat, zhEffect, type PackMeta, type SoulmarkMeta } from "../meta.ts";

export const EFFECT_STYLE: Record<string, string> = {
  control: "#c66", immune_control: "#6c6", tag: "#68c",
};
export const effectColor = (kind: string): string => EFFECT_STYLE[kind] ?? (kind.startsWith("tag:") ? "#68c" : "#888");

/** speciesId → 头像底色（与 scene 的 speciesSkin 同算法，UI 一致） */
export function speciesHue(speciesId: string): number {
  let h = 0;
  for (const c of speciesId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

/** 能力等级 + 效果 chips——.chip 数 == 非零 stage 数 + effects 数（ui-matrix 一致性断言口径） */
export function Chips({ effects, stages }: { effects?: any[]; stages?: any }) {
  const out: { key: string; text: string; color: string }[] = [];
  for (const k of ["atk", "def", "spa", "sdf", "spd"]) {
    const v = stages?.[k] ?? 0;
    if (v !== 0) out.push({ key: `st-${k}`, text: `${zhStat(k)}${v > 0 ? `+${v}` : v}`, color: v > 0 ? "#8fd88f" : "#f08a8a" });
  }
  (effects ?? []).forEach((e: any, i: number) => {
    out.push({
      key: `fx-${i}`,
      text: `${zhEffect(e.kind)}${e.remainingTurns !== undefined ? `:${e.remainingTurns}` : ""}${e.stack !== undefined ? `×${e.stack}` : ""}`,
      color: effectColor(e.kind),
    });
  });
  if (out.length === 0) return null;
  return (
    <span className="chips">
      {out.map((c) => (
        <span key={c.key} className="chip" style={{ borderColor: c.color, color: c.color }}>{c.text}</span>
      ))}
    </span>
  );
}

const SOUL_OP_ZH: Record<string, string> = {
  immune_control: "免疫控制", immune_stage_down: "免疫弱化", priority_high_hp: "高血先手",
  endure: "绝地回卷", turn_heal: "回合回血", turn_pp_restore: "回合回PP", turn_flat: "回合固伤",
  entry_dispel: "登场驱散", hit_shield: "受击护盾",
};

/** 魂印徽印——菱形纹章 + 悬停展开（desc + op 中文）。endured=已触发(灰化划线)，shield=护盾态(青蓝光) */
export function SoulBadge({ soul, meta, testid }: { soul: any; meta: PackMeta | null; testid?: string }) {
  if (soul === undefined || soul === null) return null;
  const sm: SoulmarkMeta | undefined = meta?.soulmarks?.[soul.id];
  const name = sm?.name ?? soul.id;
  const cls = `soul-chip${soul.endured === true ? " dim" : ""}${soul.shield === true ? " shielded" : ""}`;
  return (
    <span className={cls} data-testid={testid}>
      ◆{name}{soul.shield === true ? "·盾" : ""}
      {(sm?.desc !== undefined || (sm?.effects?.length ?? 0) > 0) && (
        <span className="tip">
          <span className="tt">魂印「{name}」</span>
          {sm?.desc !== undefined && <span className="tl" style={{ display: "block", whiteSpace: "normal", maxWidth: 220 }}>{sm.desc}</span>}
          <span className="tm" style={{ display: "block" }}>
            {(sm?.effects ?? []).map((e) => SOUL_OP_ZH[e.op] ?? e.op).join(" · ")}
            {soul.endured === true ? "（已触发）" : ""}
          </span>
        </span>
      )}
    </span>
  );
}
