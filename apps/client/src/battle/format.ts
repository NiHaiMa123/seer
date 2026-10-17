import { zhSpecies, zhMove, zhEvent, zhStat, zhReason, zhStatus, effTag, type PackMeta } from "../meta.ts";

/** 事件 → 一行中文播报。own 视角：side===obs.side 是"我方"。 */
export function fmtEvent(ev: any, obs: any, meta: PackMeta | null): string {
  const mine = ev.side === obs?.side;
  const who = ev.side === undefined ? "" : mine ? `${zhSpecies(obs.own.speciesId, meta)}` : `敌方 ${zhSpecies(obs.opponent.speciesId, meta)}`;
  const d = ev;
  switch (ev.type as string) {
    case "action-declared": {
      const actionId = typeof d.actionId === "string" ? d.actionId : "";
      if (actionId.startsWith("act_item-")) {
        const itemId = actionId.slice("act_item-".length).split("--")[0] ?? "";
        const name = meta?.items?.[itemId]?.name ?? itemId;
        return `${who} 使用了 ${name}`;
      }
      return `${who} 使出 ${zhMove(d.moveId ?? "", meta)}`;
    }
    case "damage": {
      const eff = typeof d.eff16 === "number" ? effTag(d.eff16 / 16) : null;
      return `${who} 受到 ${d.amount} 点伤害${eff !== null ? `（${eff.text}）` : ""}${d.cause === "struggle" ? "（挣扎反噬）" : ""}${d.recoil === true ? "（反伤）" : ""}`;
    }
    case "heal": return `${who} 恢复 ${d.amount} 点体力${d.source !== undefined ? `（${d.source}）` : ""}`;
    case "stat-stage": return `${who} ${zhStat(d.stat ?? "")} ${d.deltaApplied > 0 ? "+" : ""}${d.deltaApplied}`;
    case "stages-transferred": return `${who} 吸取了能力等级`;
    case "stages-cleared": return `${who} 的能力等级被清除`;
    case "control-immune": return `${who} 免疫了控制`;
    case "effect-applied": return `${who} 被附加「${zhStatus(String(d.name ?? "?"))}」`;
    case "effect-faded": return `${who} 的「${zhStatus(String(d.name ?? "?"))}」消退`;
    case "soulmark": {
      const fx = typeof d.effect === "string" ? d.effect : "";
      const tag = fx === "endure" ? "保留了 1 点体力" : fx === "shield_absorb" ? "护盾吸收伤害" : fx === "entry_dispel" ? "驱散对手回合效果" : "触发";
      return `${who} 的魂印「${d.name ?? d.mark}」${tag}`;
    }
    case "switch": return `${who}换人了`;
    case "revive": return `${who} 重新站了起来`;
    case "ko": return `${who} 倒下了`;
    case "missed": return `${who} 的 ${zhMove(d.moveId ?? "", meta)} 没有命中`;
    case "action-failed": {
      const why = d.reason === "hp-full" ? "体力已满"
        : d.reason === "no-control" ? "没有可解除的异常"
        : d.reason === "no-stages" ? "没有能力下降"
        : d.reason === "pp-delta-noop" ? "PP 没有变化"
        : "";
      return why === "" ? `${who} 无法行动` : `${who} 无法行动（${why}）`;
    }
    case "pp-spent": return "";
    case "turn-begin": return `— 第 ${ev.turn ?? "?"} 回合 —`;
    case "battle-end": return `战斗结束：${zhReason(d.reason ?? "")}`;
    default: return `${zhEvent(ev.type)}`;
  }
}
