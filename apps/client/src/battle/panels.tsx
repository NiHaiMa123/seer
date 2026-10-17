/**
 * 战斗页里从 main 搬出的面板。渲染时才读 URL，不在模块顶层碰 location。
 */
import { useState } from "react";
import type { BattlePanelCtx } from "../slots.ts";
import { UnitCard } from "./cards.tsx";
import { pageQuery } from "../query.ts";
import { Icon } from "../ui/kit.tsx";

/** battle.top：隐藏状态点（测试探针，不可见） */
export function HiddenStatus({ obs }: BattlePanelCtx) {
  const qs = pageQuery();
  return (
    <div data-testid="battle-status" style={{ position: "absolute", left: -9999, top: -9999, fontSize: 1 }}>
      {qs.get("pve") === "1" && <span>[PVE]</span>}
      side={obs.side} turn={obs.turn} rev={obs.revision} terminal={JSON.stringify(obs.terminal)}
    </div>
  );
}

/** battle.arena：上缘对战 HUD（左己右敌）+ 中轴回合晶章：回合数 / 对战模式 / 出招状态 / 快进·倍速·离开 */
export function ArenaCards({ obs, meta, myTurn, isReplacement, speed, onSkip, onCycleSpeed }: BattlePanelCtx) {
  const qs = pageQuery();
  const state = obs.terminal !== null ? { cls: "end", text: "战斗结束" }
    : isReplacement && myTurn ? { cls: "alert", text: "选择替补" }
    : myTurn ? { cls: "go", text: "请出招" }
    : { cls: "wait", text: "等待对手" };
  return (
    <>
      <div className="hud-shade" />
      <div className="hud">
        <UnitCard u={obs.own} side="own" bench={obs.own.bench} meta={meta} />
        <div className="round-emblem">
          <div className="re-core">
            <small>ROUND</small>
            <b className="turnbadge num">{obs.turn}</b>
            <em>回合</em>
          </div>
          <div className={`status ${state.cls}`}><i />{state.text}</div>
          <div className="re-mode">
            {qs.get("pve") === "1" ? <span data-testid="pve-badge" className="pve-tag">人机对战</span> : <span>精灵对战</span>}
          </div>
          <div className="re-ctl">
            <button data-testid="btn-skip" title="快进当前演出" onClick={onSkip}><Icon name="ff" solid /><span>快进</span></button>
            <button data-testid="btn-speed" className="num" title="演出倍速" onClick={onCycleSpeed}><Icon name="gauge" />{speed}x</button>
            <a data-testid="btn-quit" href="/" title="离开战斗回主界面"><button><Icon name="close" /></button></a>
          </div>
        </div>
        <UnitCard u={obs.opponent} side="foe" benchAlive={obs.opponent.benchAlive} meta={meta} />
      </div>
    </>
  );
}

/** 终局领奖：outbox exactly-once——重复点击回执相同、不重复入账。 */
function ClaimReward({ battleId, playerId }: { battleId: string; playerId: string }) {
  const [res, setRes] = useState<{ items?: Record<string, number>; fresh?: boolean | undefined; err?: string } | null>(null);
  const claim = async () => {
    const r = await fetch("/api/world/reward", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId, battleId }),
    });
    const b = await r.json() as { receipt?: { items: Record<string, number> }; fresh?: boolean; message?: string };
    setRes(b.receipt !== undefined
      ? { items: b.receipt.items, fresh: b.fresh }
      : { err: b.message ?? `claim failed (${r.status})` });
  };
  return (
    <div data-testid="claim-reward" className="claim-reward">
      <button data-testid="btn-claim" className="btn btn--primary cx" onClick={() => void claim()}><Icon name="star" solid />领取奖励</button>
      {res !== null && (
        res.items !== undefined
          ? <span className="claim-ok"> +{Object.entries(res.items).map(([k, v]) => `${k}×${v}`).join(" ")}（{res.fresh === true ? "已入账" : "回执重放——未重复入账"}）</span>
          : <span className="claim-err"> {res.err}</span>
      )}
    </div>
  );
}

/** battle.hud：终局操作条（领奖/返回） */
export function PostBattle({ obs }: BattlePanelCtx) {
  if (obs.terminal === null) return null;
  const qs = pageQuery();
  return (
    <div data-testid="post-battle" className="post-battle">
      {qs.get("wpl") !== null && <ClaimReward battleId={qs.get("battle")!} playerId={qs.get("wpl")!} />}
      {qs.get("wpl") !== null && (
        <a data-testid="back-world" href={`/?wpl=${qs.get("wpl")}`}>
          <button className="btn btn--ghost cx"><Icon name="globe" />返回世界</button>
        </a>
      )}
      <a data-testid="back-home" href="/">
        <button className="btn btn--ghost cx"><Icon name="home" />{qs.get("wpl") !== null ? "返回大厅" : "返回主界面"}</button>
      </a>
      {qs.get("wpl") === null && (
        <a data-testid="back-lobby" href="/?screen=lobby">
          <button className="btn btn--primary btn--lg cx"><Icon name="sword" />再来一局</button>
        </a>
      )}
    </div>
  );
}
