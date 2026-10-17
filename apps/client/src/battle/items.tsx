/**
 * 战斗道具面板。目录来自规则包；剩余次数在 obs.own.stocks。
 * 没有 items 元数据时指挥栏的「道具」保持禁用，本面板不出现。
 * 活力药剂两步：先点药剂，再点要回复的技能。
 */
import { useState, type CSSProperties } from "react";
import { zhMove, typeColor, type PackMeta } from "../meta.ts";
import { itemArt, itemRarity } from "../ui/art.ts";
import { Icon } from "../ui/kit.tsx";

export function ItemPane({ obs, meta, enabled, hidden, submit }: {
  obs: any;
  meta: PackMeta | null;
  enabled: boolean;
  hidden: boolean;
  submit: (id: string) => void;
}) {
  const catalog = meta?.items;
  const [ppFor, setPpFor] = useState<string | null>(null);
  if (catalog === undefined) return null;
  const stocks: Record<string, number> = obs.own.stocks ?? {};
  const legal = new Set<string>(obs.legalActions.map((a: { actionId: string }) => a.actionId));
  const moves = Object.keys(obs.own.ppByMoveId ?? {});
  const list = Object.values(catalog);
  const armed = ppFor !== null ? catalog[ppFor] : undefined;
  return (
    <div className={`item-pane pane${hidden ? " off" : ""}${armed !== undefined ? " arming" : ""}`} data-testid="item-pane">
      {armed === undefined ? list.map((it) => {
        const n = stocks[it.id] ?? 0;
        const pp = it.pp !== undefined;
        const actionId = `act_item-${it.id}`;
        const can = enabled && n > 0 && (pp || legal.has(actionId));
        return (
          <button type="button" key={it.id} data-testid={`item-${it.id}`} className={`item-btn cx rar-${itemRarity(it)}${n === 0 ? " empty" : ""}`}
            disabled={!can} title={it.note}
            onClick={() => {
              if (pp) { setPpFor(it.id); return; }
              submit(actionId);
            }}>
            <img src={itemArt(it)} alt="" draggable={false} />
            <b>{it.name}</b>
            <span className="it-n num">×{n}<small>/{it.cap}</small></span>
            <small>{it.kind === "hp" ? `体力 +${it.heal}` : it.kind === "pp" ? `PP +${it.pp}` : `净化 · 体力 +${it.heal ?? 0}`}</small>
          </button>
        );
      }) : (
        <>
          <button type="button" className="item-back" onClick={() => setPpFor(null)}><Icon name="left" />返回</button>
          <div className="item-armed">
            <img src={itemArt(armed)} alt="" />
            <span><b>{armed.name}</b><small>选一个技能回复 {armed.pp} 点 PP，不超过该技能上限。</small></span>
          </div>
          {moves.map((moveId) => {
            const actionId = `act_item-${armed.id}--${moveId}`;
            const mm = meta?.moves[moveId];
            const cur = obs.own.ppByMoveId?.[moveId];
            return (
              <button type="button" key={moveId} data-testid={`item-target-${moveId}`} className="item-target cx"
                style={{ "--tc": mm?.type !== undefined ? typeColor(mm.type) : "#7d8db5" } as CSSProperties}
                disabled={!enabled || !legal.has(actionId)}
                onClick={() => { setPpFor(null); submit(actionId); }}>
                <b>{zhMove(moveId, meta)}</b>
                <span className="num">{cur ?? "?"}/{mm?.pp ?? "?"}</span>
              </button>
            );
          })}
        </>
      )}
    </div>
  );
}
