/**
 * battle/deck.tsx —— 指挥面板：左=第五技能晶核 | 中=四个普通技能 ⇄ 精灵面板 ⇄ 道具面板 | 右=四宫格。
 * 普通技能固定四格（ppByMoveId 里多出来的不进这四格）；第五技能只进左侧晶核。legalActions 只决定可用性。
 * 技能卡状态：可用 / 悬停 / 已选择（本决策内已提交）/ 等待对手 / 不可用 / PP 耗尽。
 * 换人入口在精灵面板（cards.PetPane，点「精灵」切入）。
 */
import { useState, type CSSProperties } from "react";
import { zhMove, moveBadge, describeMove, typeColor, effTag, effOf, type PackMeta, type MoveMeta } from "../meta.ts";
import type { BattlePanelCtx } from "../slots.ts";
import { PetPane } from "./cards.tsx";
import { ItemPane } from "./items.tsx";
import { Icon, TypeGem, type IconName } from "../ui/kit.tsx";

/** 技能悬停说明——技能卡与第五技共用 */
function MoveTip({ moveId, mMeta, pp, suffix, meta }: { moveId: string; mMeta: MoveMeta | undefined; pp: number | undefined; suffix?: string; meta: PackMeta | null }) {
  if (mMeta === undefined) return null;
  return (
    <div className="tip">
      <div className="tt">{mMeta.type !== undefined && <TypeGem t={mMeta.type} />}{zhMove(moveId, meta)}{suffix}</div>
      {describeMove(mMeta).map((line, i) => <div key={i} className="tl">{line}</div>)}
      <div className="tm">PP {pp ?? "?"}/{mMeta.pp ?? "?"}</div>
    </div>
  );
}

const ratioOf = (pp: number | undefined, max: number | undefined): number | null =>
  pp !== undefined && max !== undefined && max > 0 ? Math.max(0, Math.min(1, pp / max)) : null;

/** 物攻 / 特攻 / 变化 */
export function categoryOf(m: MoveMeta | undefined): { icon: IconName; label: string; cls: string } {
  if (m === undefined || !m.ops.includes("damage")) return { icon: "spark", label: "变化", cls: "cat-status" };
  if (m.category === "special") return { icon: "orb", label: "特攻", cls: "cat-special" };
  return { icon: "burst", label: "物攻", cls: "cat-physical" };
}

/** PP 分段条：≤ 12 次逐格，多则连续条 + 刻度 */
function PpBar({ pp, max }: { pp: number | undefined; max: number | undefined }) {
  const r = ratioOf(pp, max);
  if (r === null) return null;
  if (max !== undefined && max <= 12) {
    return <span className="ppseg">{Array.from({ length: max }, (_, i) => <i key={i} className={i < (pp ?? 0) ? "on" : ""} />)}</span>;
  }
  return <span className="ppbar"><i style={{ width: `${r * 100}%` }} /></span>;
}

/** 技能卡——属性晶石 + 类别 | 名称 | 次数 + 威力 | PP 分段 + 克制角标 + 悬停说明 */
function MoveTile({ moveId, actionId, enabled, waiting, picked, obs, meta, submit }: {
  moveId: string; actionId: string; enabled: boolean; waiting: boolean; picked: boolean; obs: any; meta: PackMeta | null; submit: (id: string) => void;
}) {
  const mMeta = meta?.moves[moveId];
  const pp = obs.own.ppByMoveId?.[moveId];
  const badge = moveBadge(meta, moveId);
  const eff = effOf(meta, mMeta, obs.opponent.speciesId);
  const et = effTag(eff);
  const cat = categoryOf(mMeta);
  const tc = mMeta?.type !== undefined ? typeColor(mMeta.type) : "#7d8db5";
  const cls = `skill cx${pp === 0 ? " dry" : ""}${picked ? " picked" : ""}${waiting ? " waiting" : ""}${eff !== undefined && eff > 1 ? " strong" : ""}`;
  return (
    <button data-testid={`btn-${actionId}`} disabled={!enabled} className={cls} style={{ "--tc": tc } as CSSProperties}
      onClick={() => submit(actionId)}>
      <span className="s-head">
        {mMeta?.type !== undefined ? <TypeGem t={mMeta.type} /> : <span className="tgem" />}
        <span className={`s-cat ${cat.cls}`}><Icon name={cat.icon} />{cat.label}</span>
        {badge !== null && <i className={`s-kind${badge.tag === "STD" ? " sr" : ""}`}>{badge.tag}</i>}
      </span>
      <span className="sname">{zhMove(moveId, meta)}</span>
      <span className="s-foot">
        <span className="sinfo"><small>次数 </small><b className="num">{pp ?? "?"}/{mMeta?.pp ?? "?"}</b></span>
        <span className="s-pow">{badge !== null ? <><small>威力</small><b className="num">{badge.power}</b></> : <small className="s-var">变化技</small>}</span>
      </span>
      <PpBar pp={pp} max={mMeta?.pp} />
      {et !== null && <span className="s-eff" style={{ "--ec": et.color } as CSSProperties}>{et.text}</span>}
      {picked && <span className="s-picked"><Icon name="check" />已选择</span>}
      {pp === 0 && <span className="s-dry">PP 耗尽</span>}
      <MoveTip moveId={moveId} mMeta={mMeta} pp={pp} meta={meta} />
    </button>
  );
}

/** 挣扎格（legalAction 驱动——只在可点时存在） */
function StruggleTile({ a, enabled, submit }: { a: any; enabled: boolean; submit: (id: string) => void }) {
  return (
    <button data-testid={`btn-${a.actionId}`} disabled={!enabled} className="skill cx struggle"
      style={{ "--tc": "#ff5468" } as CSSProperties} onClick={() => submit(a.actionId)}>
      <span className="s-head"><span className="s-cat cat-physical"><Icon name="bolt" />PP 耗尽</span></span>
      <span className="sname">挣扎</span>
      <span className="s-foot"><span className="sinfo"><small>无技可用，反噬自身</small></span></span>
    </button>
  );
}

/** 第五技能晶核（战斗与背包共用的表现）：六棱金框晶体 + 能量环 + 技名 / 威力 + PP 晶格 */
export function FifthEmblem({ moveId, meta, pp, max }: { moveId: string; meta: PackMeta | null; pp: number | undefined; max: number | undefined }) {
  const badge = moveBadge(meta, moveId);
  const mMeta = meta?.moves[moveId];
  const tc = mMeta?.type !== undefined ? typeColor(mMeta.type) : "#f6b938";
  return (
    <>
      <span className="f-core" style={{ "--tc": tc } as CSSProperties}>
        <span className="f-aura" />
        <span className="f-gem">
          <span className="fifth-tag">第五技能</span>
          <span className="sname">{zhMove(moveId, meta)}</span>
          {badge !== null ? <span className="fpow"><b className="num">{badge.power}</b><small>威力</small></span> : <span className="fpow"><small>变化技</small></span>}
        </span>
      </span>
      <span className="fpp">次数 <b className="num">{pp ?? "?"}/{max ?? "?"}</b></span>
    </>
  );
}

function FifthTile({ moveId, actionId, enabled, picked, obs, meta, submit }: {
  moveId: string; actionId: string; enabled: boolean; picked: boolean; obs: any; meta: PackMeta | null; submit: (id: string) => void;
}) {
  const mMeta = meta?.moves[moveId];
  const pp = obs.own.ppByMoveId?.[moveId];
  const et = effTag(effOf(meta, mMeta, obs.opponent.speciesId));
  return (
    <button data-testid={`btn-${actionId}`} disabled={!enabled} className={`fifth${picked ? " picked" : ""}`} onClick={() => submit(actionId)}>
      <FifthEmblem moveId={moveId} meta={meta} pp={pp} max={mMeta?.pp} />
      {et !== null && <span className="s-eff" style={{ "--ec": et.color } as CSSProperties}>{et.text}</span>}
      <MoveTip moveId={moveId} mMeta={mMeta} pp={pp} suffix=" · 第五技能" meta={meta} />
    </button>
  );
}

/** 指挥面板整体：第五技能 | 技能卡阵 ⇄ 精灵面板 ⇄ 道具 | 四宫格（战斗 / 道具 / 精灵 / 撤退） */
export function CommandDeck({ obs, meta, myTurn, isReplacement, submit }: BattlePanelCtx) {
  const [view, setView] = useState<"skills" | "pets" | "items">("skills");
  const [picked, setPicked] = useState<{ d: string; a: string } | null>(null);
  if (obs.terminal !== null) return null;
  const legal = new Map(obs.legalActions.map((a: any) => [a.actionId, a]));
  const moveIds = Object.keys(obs.own.ppByMoveId ?? {});
  const fifthId = moveIds.find((id) => meta?.moves[id]?.fifth === true);
  // 第五技能不占普通格。未标 fifth 时按槽位顺序取前四（第五技能由引擎接在末尾）。
  const regular = moveIds.filter((id) => id !== fifthId && meta?.moves[id]?.fifth !== true).slice(0, 4);
  const struggle = obs.legalActions.find((a: any) => a.action?.kind === "struggle");
  const concede = obs.legalActions.find((a: any) => a.action?.kind === "concede");
  const switches = obs.legalActions.filter((a: any) => a.action?.kind === "switch");
  // 精灵倒下需替补：强制停在精灵面板
  const forced = isReplacement && myTurn;
  const shown = forced ? "pets" : view;
  const decisionId: string | undefined = obs.decision?.decisionId;
  const pickedId = picked !== null && picked.d === decisionId ? picked.a : null;
  const act = (id: string) => { if (decisionId !== undefined) setPicked({ d: decisionId, a: id }); submit(id); };
  const pickPet = (actionId: string) => { setView("skills"); submit(actionId); };
  const cmd = (id: string, icon: IconName, label: string, on: boolean, extra: Partial<{ disabled: boolean; cls: string; title: string; onClick: () => void }>) => (
    <button data-testid={id} className={`cmd cx${on ? " on" : ""}${extra.cls ?? ""}`} disabled={extra.disabled} title={extra.title} onClick={extra.onClick}>
      <Icon name={icon} /><span>{label}</span>
    </button>
  );
  return (
    <div className={`command-deck${myTurn ? " live" : " idle"}`} data-testid="command-deck">
      <div className="fifth-slot">
        {fifthId !== undefined
          ? <FifthTile moveId={fifthId} actionId={`act_${fifthId}`} picked={pickedId === `act_${fifthId}`}
              enabled={myTurn && legal.has(`act_${fifthId}`)} obs={obs} meta={meta} submit={act} />
          : <div className="fifth empty"><span className="f-core"><span className="f-gem"><span className="fifth-tag">第五技能</span><span className="sname">未携带</span></span></span></div>}
      </div>
      <div className="deck-stage">
        <div className={`move-grid pane${shown === "skills" ? "" : " off"}`}>
          {Array.from({ length: 4 }, (_, i) => {
            const id = regular[i];
            return id !== undefined
              ? <MoveTile key={id} moveId={id} actionId={`act_${id}`} picked={pickedId === `act_${id}`}
                  waiting={!myTurn} enabled={myTurn && legal.has(`act_${id}`)} obs={obs} meta={meta} submit={act} />
              : <button key={`empty-${i}`} className="skill cx empty" disabled data-testid={`skill-empty-${i}`}>
                <span className="s-head"><span className="tgem" /></span>
                <span className="sname">未携带</span>
                <span className="s-foot"><span className="sinfo"><small>普通技能</small></span></span>
              </button>;
          })}
          {struggle !== undefined && <StruggleTile a={struggle} enabled={myTurn} submit={act} />}
        </div>
        <PetPane active={obs.own} bench={obs.own.bench ?? []} meta={meta} switches={switches}
          enabled={myTurn} urgent={forced} hidden={shown !== "pets"} submit={pickPet} />
        <ItemPane obs={obs} meta={meta} enabled={myTurn && !forced} hidden={shown !== "items"}
          submit={(id) => { setView("skills"); submit(id); }} />
      </div>
      <div className="cmd-grid">
        {cmd("btn-fight", "sword", "战斗", shown === "skills", { disabled: forced, cls: " fight", onClick: () => setView("skills") })}
        {cmd("btn-items", "potion", "道具", shown === "items", {
          disabled: forced || meta?.items === undefined, title: meta?.items === undefined ? "暂无可用道具" : "本场药剂", onClick: () => setView("items"),
        })}
        {cmd("btn-pets", "paw", "精灵", shown === "pets", { cls: forced ? " urgent" : "", onClick: () => setView("pets") })}
        {concede !== undefined
          ? cmd("btn-act_concede", "flag", "撤退", false, { cls: " warn", disabled: !myTurn, onClick: () => submit("act_concede") })
          : <button className="cmd cx warn" disabled><Icon name="flag" /><span>撤退</span></button>}
      </div>
    </div>
  );
}
