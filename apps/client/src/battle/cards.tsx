/**
 * battle/cards.tsx —— 顶部对战 HUD（六棱头像压在铭牌外缘 | 名字·属性晶石 → 血条 → 后备晶点·状态，敌我镜像）
 * 与指令区精灵面板（头像即换人钮）。魂印/刻印/能力等级徽印经 badges 原子组件拼装——机制增删只动徽章，不动骨架。
 */
import { zhSpecies, zhMode, type PackMeta } from "../meta.ts";
import { Chips, SoulBadge } from "./badges.tsx";
import { HpBar } from "./hp.tsx";
import { Icon, Portrait, TypeGem } from "../ui/kit.tsx";

/** unitId → speciesId：switch 事件不含 species 字段，从最新 obs 反查 */
export function speciesOf(obs: any, unitId: string): string | undefined {
  if (obs.own?.unitId === unitId) return obs.own.speciesId;
  if (obs.opponent?.unitId === unitId) return obs.opponent.speciesId;
  return obs.own?.bench?.find((b: any) => b.unitId === unitId)?.speciesId;
}

/** 后备晶点：己方逐只（倒下 = 空心），敌方只知存活数 */
function BenchPips({ bench, alive }: { bench?: any[] | undefined; alive?: number | undefined }) {
  const pips = bench !== undefined ? bench.map((b) => b.alive !== false) : Array.from({ length: alive ?? 0 }, () => true);
  if (pips.length === 0) return null;
  const n = pips.filter(Boolean).length;
  return (
    <span className="pips" title={`后备精灵 ${n} 只可战斗`}>
      {pips.map((on, i) => <i key={i} className={on ? "on" : ""} />)}
      <em>后备×{n}</em>
    </span>
  );
}

/** 单位 HUD——嵌在战场上缘：左=己方（晶体青）右=敌方（珊瑚橙），镜面对称 */
export function UnitCard({ u, side, bench, benchAlive, meta }: {
  u: any; side: "own" | "foe"; bench?: any[]; benchAlive?: number; meta: PackMeta | null;
}) {
  const types = meta?.units[u.speciesId]?.types ?? [];
  const sealNames = (u.seals ?? []).map((id: string) => meta?.seals?.[id]?.name ?? id).join("、");
  const foe = side === "foe";
  return (
    <div className={`ucard ${side}`} data-testid={`ucard-${side}`}>
      <div className="uc-face">
        <Portrait id={u.speciesId} meta={meta} size={92} tone={foe ? "foe" : "cy"} dead={u.hp.current <= 0} />
        <span className="uc-lv"><small>Lv</small><b className="num">{u.level ?? 100}</b></span>
      </div>
      <div className={`uc-plate cx${foe ? " cx-m e-foe" : " e-cy"} m-glass`}>
        <div className="uc-top">
          <span className="nm">{zhSpecies(u.speciesId, meta)}</span>
          <span className="uc-types">
            {types.map((t) => <span key={t} data-testid={`tchip-${side}-${t}`}><TypeGem t={t} /></span>)}
          </span>
          {u.mode !== undefined && <span className="tchip mode"><Icon name="crown" />{zhMode(u.mode)}</span>}
        </div>
        <HpBar cur={u.hp.current} max={u.hp.max} />
        <div className="uc-sub">
          <BenchPips bench={bench} alive={benchAlive} />
          {u.revives !== undefined && u.revives > 0 && <span className="tchip info">复活×{u.revives}</span>}
          {u.seals !== undefined && u.seals.length > 0 && (
            <span className="tchip seal" data-testid={`sealchip-${side}`} title={sealNames}>刻印×{u.seals.length}</span>
          )}
          <SoulBadge soul={u.soul} meta={meta} testid={`soulchip-${side}`} />
          <Chips effects={u.effects} stages={u.stages} />
        </div>
      </div>
      <div className={`statline${u.stats === undefined ? " unknown" : ""}`} data-testid={u.stats !== undefined ? `stats-${side}` : undefined}>
        {([["攻", u.stats?.atk], ["防", u.stats?.def], ["特攻", u.stats?.spa], ["特防", u.stats?.sdf], ["速", u.stats?.spd]] as const).map(([k, v]) => (
          <span key={k}>{k}<b className="num">{v ?? "?"}</b></span>
        ))}
      </div>
    </div>
  );
}

/** 精灵卡（指令区精灵页）：六棱头像 + 名 + 血条；头像即换人钮（legalAction 驱动），悬停看属性/状态 */
function PetTile({ u, meta, testid, sw, enabled, urgent, active, submit }: {
  u: any; meta: PackMeta | null; testid?: string | undefined; sw?: any; enabled: boolean; urgent: boolean; active?: boolean;
  submit: (id: string) => void;
}) {
  const ratio = u.hp.max > 0 ? Math.max(0, Math.min(1, u.hp.current / u.hp.max)) : 0;
  const alive = u.alive ?? u.hp.current > 0;
  const types = meta?.units[u.speciesId]?.types ?? [];
  const cls = `pet cx m-raise${active === true ? " active e-cy" : ""}${alive ? "" : " dead"}${ratio < 0.35 ? " low" : ""}${sw !== undefined && enabled ? " ready" : ""}${urgent ? " urgent" : ""}`;
  const face = <Portrait id={u.speciesId} meta={meta} size={50} tone={active === true ? "cy" : undefined} dead={!alive} />;
  return (
    <div data-testid={testid} className={cls}>
      {sw !== undefined
        ? <button data-testid={`btn-${sw.actionId}`} className="pet-av" disabled={!enabled}
            aria-label={`换上 ${zhSpecies(u.speciesId, meta)}`} onClick={() => submit(sw.actionId)}>{face}</button>
        : <span className="pet-av">{face}</span>}
      <span className="pet-name">{zhSpecies(u.speciesId, meta)}</span>
      <span className="pet-hp"><i style={{ width: `${ratio * 100}%` }} /></span>
      <span className="pet-num num">{u.hp.current}/{u.hp.max}</span>
      <span className="sr">{u.speciesId}</span>
      {!alive ? <span className="pet-flag dead">倒下</span>
        : active === true ? <span className="pet-flag on">出战</span>
        : u.revives !== undefined && u.revives > 0 ? <span className="pet-flag">↻{u.revives}</span> : null}
      <div className="tip">
        <div className="tt">{zhSpecies(u.speciesId, meta)} <small className="num">Lv {u.level ?? 100}</small> {types.map((t) => <TypeGem key={t} t={t} />)}</div>
        {u.mode !== undefined && <div className="tl">{zhMode(u.mode)}</div>}
        <Chips effects={u.effects} stages={u.stages} />
        <div className="tm">{active === true ? "正在出战" : sw !== undefined ? (enabled ? "点击头像换上场" : "等待出招回合") : alive ? "当前不可换上" : "已倒下"}</div>
      </div>
    </div>
  );
}

/** 精灵面板——指令区中栏的另一页：出战精灵 + 后备精灵一排（点「精灵」切入，点头像即换人） */
export function PetPane({ active, bench, meta, switches, enabled, urgent, hidden, submit }: {
  active: any; bench: any[]; meta: PackMeta | null; switches: any[]; enabled: boolean; urgent: boolean; hidden: boolean;
  submit: (id: string) => void;
}) {
  const orphan = switches.filter((a) => !bench.some((b) => b.unitId === a.action?.unitId));
  return (
    <div data-testid="bench-panel" className={`pet-pane pane${hidden ? " off" : ""}${urgent ? " urgent" : ""}`} aria-hidden={hidden}>
      <PetTile u={active} meta={meta} active enabled={false} urgent={false} submit={submit} />
      {bench.map((b: any, i: number) => (
        <PetTile key={b.unitId} u={b} meta={meta} testid={`bench-${i}`} enabled={enabled} urgent={urgent}
          sw={switches.find((a) => a.action?.unitId === b.unitId)} submit={submit} />
      ))}
      {orphan.map((a) => (
        <button key={a.actionId} data-testid={`btn-${a.actionId}`} disabled={!enabled} className="btn btn--cy cx pet-orphan"
          onClick={() => submit(a.actionId)}><Icon name="swap" />换人</button>
      ))}
      {bench.length === 0 && orphan.length === 0 && <span className="pet-empty">没有后备精灵</span>}
    </div>
  );
}
