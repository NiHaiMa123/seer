/**
 * main.tsx —— React UI 壳：技能按钮（legalActions 驱动 + 伤害类型徽标）、
 * bench 面板、effect/stage tags、replacement 决策横幅、日志、AI/速度/跳过。
 * URL: ?battle=&player=&mode=human|ai&speed=N&autoplay=1
 * 权威状态永远来自 observe；动画只表现公开事件。
 */
import { createRoot } from "react-dom/client";
import { StrictMode, useEffect, useRef, useState } from "react";
import { BattleClient } from "./api.ts";
import { BattleScene } from "./scene.ts";
import { chooseAction } from "./ai.ts";
import { loadMeta, packIdOf, moveBadge, zhSpecies, zhMove, zhMode, zhReason, zhEvent, zhEffect, describeMove, typeColor, effTag, type PackMeta } from "./meta.ts";
import { slots, type BattlePanelCtx } from "./slots.ts";

declare const window: any;

const qs = new URLSearchParams(location.search);
const BATTLE = qs.get("battle")!;
const TOKEN = qs.get("player")!;
const MODE = qs.get("mode") ?? "human";
const SPEED = Number(qs.get("speed") ?? "1");
const AUTOPLAY = qs.get("autoplay") === "1";

const EFFECT_STYLE: Record<string, string> = {
  control: "#c66", immune_control: "#6c6", tag: "#68c",
};
const effectColor = (kind: string) => EFFECT_STYLE[kind] ?? (kind.startsWith("tag:") ? "#68c" : "#888");

function Chips({ effects, stages }: { effects?: any[]; stages?: any }) {
  return (
    <span style={{ display: "inline-flex", gap: 4, marginLeft: 8, verticalAlign: "middle" }}>
      {(stages ?? {}) && ["atk", "def", "spd"].map((k) => {
        const v = stages?.[k] ?? 0;
        if (v === 0) return null;
        return <span key={k} style={{ fontSize: 10, padding: "0 4px", border: "1px solid #55a", color: v > 0 ? "#8f8" : "#f88" }}>{k}{v > 0 ? `+${v}` : v}</span>;
      })}
      {(effects ?? []).map((e: any, i: number) => (
        <span key={i} style={{ fontSize: 10, padding: "0 4px", border: `1px solid ${effectColor(e.kind)}`, color: effectColor(e.kind) }}>
          {zhEffect(e.kind)}{e.remainingTurns !== undefined ? `:${e.remainingTurns}` : ""}{e.stack !== undefined ? `×${e.stack}` : ""}
        </span>
      ))}
    </span>
  );
}

function BenchPanel({ bench, meta }: { bench: any[]; meta?: PackMeta | null }) {
  return (
    <div data-testid="bench-panel" style={{ display: "flex", gap: 6, padding: "4px 8px" }}>
      {bench.map((b: any, i: number) => (
        <div key={b.unitId} data-testid={`bench-${i}`} style={{
          border: `1px solid ${b.alive ? "#4a6" : "#533"}`, padding: "2px 8px", fontSize: 11,
          opacity: b.alive ? 1 : 0.45,
        }}>
          {zhSpecies(b.speciesId)}
          {(meta?.units[b.speciesId]?.types ?? []).map((t) => (
            <b key={t} className="tchip" style={{ background: typeColor(t) }}>{t}</b>
          ))}
          <span style={{ fontSize: 9, color: "#6a7ca8" }}>{b.speciesId}</span> {b.hp.current}/{b.hp.max}
          {b.mode !== undefined && <span style={{ color: "#fd6" }}> [{zhMode(b.mode)}]</span>}
          {b.revives !== undefined && b.revives > 0 && <span style={{ color: "#8af" }}> ↻{b.revives}</span>}
          <Chips effects={b.effects} stages={b.stages} />
        </div>
      ))}
    </div>
  );
}

/** unitId → speciesId：switch 事件不含 species 字段，从最新 obs 反查 */
function speciesOf(obs: any, unitId: string): string | undefined {
  if (obs.own?.unitId === unitId) return obs.own.speciesId;
  if (obs.opponent?.unitId === unitId) return obs.opponent.speciesId;
  return obs.own?.bench?.find((b: any) => b.unitId === unitId)?.speciesId;
}

/** speciesId → 头像底色（与 scene 的 speciesSkin 同算法，UI 一致） */
function speciesHue(speciesId: string): number {
  let h = 0;
  for (const c of speciesId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

/** 单位信息卡——赛尔号式：圆形头像 + Lv + 名字 + HP 条 + 状态 chips */
function UnitCard({ u, side, benchAlive, types }: { u: any; side: "own" | "foe"; benchAlive?: number; types: string[] | undefined }) {
  const hue = speciesHue(u.speciesId);
  const low = u.hp.current / u.hp.max < 0.3;
  return (
    <div className="ucard" data-testid={`ucard-${side}`}>
      <div className="avatar" style={{ background: `radial-gradient(circle at 35% 30%, hsl(${hue},70%,70%), hsl(${hue},60%,40%))` }}>
        {u.speciesId.slice(4, 5).toUpperCase()}
      </div>
      <div style={{ flex: 1 }}>
        <div className="nm">{zhSpecies(u.speciesId)}
          {(types ?? []).map((t) => (
            <span key={t} className="tchip" data-testid={`tchip-${side}-${t}`} style={{ background: typeColor(t) }}>{t}</span>
          ))}
          <span className="lv"> Lv.100</span>
          {u.mode !== undefined && <span style={{ color: "#fd6", fontSize: 10 }}> [{zhMode(u.mode)}]</span>}
          {u.revives !== undefined && u.revives > 0 && <span style={{ color: "#8af", fontSize: 10 }}> ↻{u.revives}</span>}
          {benchAlive !== undefined && <span style={{ color: "#8af", fontSize: 10 }}> 后备×{benchAlive}</span>}
        </div>
        <div className={`hpbar${low ? " low" : ""}`}>
          <i style={{ width: `${(u.hp.current / u.hp.max) * 100}%` }} />
          <b>{u.hp.current}/{u.hp.max}</b>
        </div>
        <Chips effects={u.effects} stages={u.stages} />
      </div>
    </div>
  );
}

function App() {
  const [obs, setObs] = useState<any>(null);
  const [meta, setMeta] = useState<PackMeta | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [speed, setSpeed] = useState(SPEED);
  const canvasRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<BattleClient | null>(null);
  const sceneRef = useRef<BattleScene | null>(null);
  const cursorRef = useRef(0);
  const decisionDone = useRef<string | null>(null);
  const unitIds = useRef<{ own: string; opp: string } | null>(null);

  useEffect(() => {
    const client = new BattleClient("", BATTLE, TOKEN);
    clientRef.current = client;
    const scene = new BattleScene();
    scene.speed = SPEED;
    sceneRef.current = scene;
    let alive = true;

    (async () => {
      await scene.init(canvasRef.current!);
      const r = await client.resync(0);
      if (!alive) return;
      cursorRef.current = r.cursor;
      void loadMeta(packIdOf(r.observation)).then((m) => { if (alive) setMeta(m); });
      const o = r.observation;
      unitIds.current = { own: o.own.unitId, opp: o.opponent.unitId };
      scene.setup(o.own.unitId, o.opponent.unitId, zhSpecies(o.own.speciesId), zhSpecies(o.opponent.speciesId));
      scene.setHp(o.own.unitId, o.own.hp.current, o.own.hp.max);
      scene.setHp(o.opponent.unitId, o.opponent.hp.current, o.opponent.hp.max);
      setObs(o);

      client.poll(250, r.cursor, (cur, events) => {
        if (!alive) return;
        for (const ev of events) {
          scene.enqueueEvent(ev, unitIds.current!, o.side);
          if (ev.type === "switch" && unitIds.current) {
            const key = ev.side === o.side ? "own" : "opp";
            const sp = zhSpecies(speciesOf(o, ev.inUnitId) ?? ev.inUnitId);
            scene.swapUnit(ev.outUnitId, ev.inUnitId, key === "own" ? "self" : "foe", sp);
            unitIds.current[key] = ev.inUnitId;
          }
          setLog((l) => [...l.slice(-60), `${zhEvent(ev.type)} ${JSON.stringify(ev)}`]);
        }
        cursorRef.current = cur;
        void client.ack(cur);
        void refresh();
      });
    })();

    const refresh = async () => {
      const o = await client.observe();
      if (!alive) return;
      setObs(o);
      if (unitIds.current) {
        // unitId 可能因 switch 更换——以权威 observe 对齐映射
        if (unitIds.current.own !== o.own.unitId) unitIds.current.own = o.own.unitId;
        if (unitIds.current.opp !== o.opponent.unitId) unitIds.current.opp = o.opponent.unitId;
        scene.setHp(o.own.unitId, o.own.hp.current, o.own.hp.max);
        scene.setHp(o.opponent.unitId, o.opponent.hp.current, o.opponent.hp.max);
        scene.setName(o.own.unitId, zhSpecies(o.own.speciesId));
        scene.setName(o.opponent.unitId, zhSpecies(o.opponent.speciesId));
      }
    };

    return () => {
      alive = false;
      client.destroy();
      scene.destroy();
    };
  }, []);

  // AI / autoplay：观察更新后自动提交（replacement 决策走第一个 switch）
  useEffect(() => {
    if (!obs || MODE !== "ai" || obs.terminal) return;
    const d = obs.decision;
    if (!d || !d.actors.includes(obs.side) || decisionDone.current === d.decisionId) return;
    const action = chooseAction(obs);
    if (!action) return;
    decisionDone.current = d.decisionId;
    void clientRef.current!.submit({
      decisionId: d.decisionId,
      actionId: action,
      baseRevision: d.baseRevision,
      idempotencyKey: `ai-${obs.side}-${d.decisionId}`,
    });
  }, [obs, MODE]);

  const submit = (actionId: string) => {
    const d = obs.decision;
    void clientRef.current!.submit({
      decisionId: d.decisionId,
      actionId,
      baseRevision: d.baseRevision,
      idempotencyKey: `h-${obs.side}-${d.decisionId}`,
    }).then((r) => {
      if (!r.ok) setLog((l) => [...l, `ERR ${r.code}: ${r.message}`]);
    });
  };

  useEffect(() => {
    if (AUTOPLAY && obs?.decision?.actors.includes(obs.side) && !obs.terminal) {
      submit(obs.legalActions[0].actionId);
    }
  }, [AUTOPLAY, obs]);

  const myTurn = obs !== null && obs.decision !== null && obs.decision.actors.includes(obs.side) && obs.terminal === null;
  const isReplacement = obs?.decision?.kind === "replacement";
  const ctx: BattlePanelCtx = {
    obs, meta, myTurn, isReplacement, submit, log, speed,
    onSkip: () => sceneRef.current?.skip(),
    onCycleSpeed: () => {
      const s = speed >= 4 ? 1 : speed * 2;
      setSpeed(s);
      if (sceneRef.current) sceneRef.current.speed = s;
    },
  };

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      {obs === null && <div data-testid="loading" style={{ padding: 40, textAlign: "center", color: "#9ab4e8" }}>载入中…</div>}
      {/* battle.top 面板区：单位卡/横幅——presentation 插件可 registerPanel 追加 */}
      {obs !== null && slots.panels("battle.top").map((C, i) => <C key={i} {...ctx} />)}
      {/* 中央战场（Pixi 自建 canvas 挂载于此——挂外层 canvas 会被 StrictMode 重挂载杀上下文） */}
      <div ref={canvasRef} data-testid="pixi-canvas" style={{ width: 720, minHeight: 360, margin: "0 auto", borderRadius: 12, border: "1px solid #24365e", overflow: "hidden" }} />
      {/* battle.hud 面板区：替补/技能栏/日志/终局——按注册顺序渲染 */}
      {obs !== null && slots.panels("battle.hud").map((C, i) => <C key={i} {...ctx} />)}
    </div>
  );
}

/** battle.top：顶部信息栏——双单位卡 + 回合徽标 + 终局横幅 */
function BattleTop({ obs, meta }: BattlePanelCtx) {
  return (
    <>
      <div data-testid="battle-status" style={{ position: "absolute", left: -9999, top: -9999, fontSize: 1 }}>
        {qs.get("pve") === "1" && <span>[PVE]</span>}
        side={obs.side} turn={obs.turn} rev={obs.revision} terminal={JSON.stringify(obs.terminal)}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "8px 10px 0" }}>
        <UnitCard u={obs.own} side="own" types={meta?.units[obs.own.speciesId]?.types} />
        <div style={{ textAlign: "center" }}>
          {qs.get("pve") === "1" && <div data-testid="pve-badge" style={{ color: "#fd6", fontSize: 11 }}>人机对战</div>}
          <span className="turnbadge">第 {obs.turn} 回合</span>
          {obs.terminal !== null && (
            <div data-testid="result-banner" style={{
              marginTop: 8, padding: "6px 18px", borderRadius: 8, fontSize: 18, fontWeight: 800, letterSpacing: 4,
              background: obs.terminal.result === obs.side ? "#2c5a2c" : "#5a2c2c",
              border: `1px solid ${obs.terminal.result === obs.side ? "#7bf0a8" : "#ff8a6a"}`,
              color: obs.terminal.result === obs.side ? "#b8ffd0" : "#ffc0b0",
            }}>
              {obs.terminal.result === obs.side ? "胜 利" : obs.terminal.result === "draw" ? "平 局" : "战 败"}
              <div style={{ fontSize: 10, fontWeight: 400, letterSpacing: 0, color: "#9ab4e8", marginTop: 2 }}>{zhReason(obs.terminal.reason)}</div>
            </div>
          )}
        </div>
        <UnitCard u={obs.opponent} side="foe" benchAlive={obs.opponent.benchAlive} types={meta?.units[obs.opponent.speciesId]?.types} />
      </div>
    </>
  );
}

/** battle.top：替补决策横幅 */
function ReplacementBanner({ myTurn, isReplacement }: BattlePanelCtx) {
  if (!isReplacement || !myTurn) return null;
  return (
    <div data-testid="replacement-banner" style={{ margin: "4px 10px", padding: 8, background: "#533", border: "1px solid #f66", borderRadius: 8 }}>
      ⚠ 精灵倒下 — 选择替补上场
    </div>
  );
}

/** battle.hud：替补面板 */
function BenchRow({ obs, meta }: BattlePanelCtx) {
  if (obs.own.bench === undefined) return null;
  return <BenchPanel bench={obs.own.bench} meta={meta} />;
}

/** battle.hud：技能栏 + 右侧功能键 */
function SkillBar({ obs, meta, myTurn, isReplacement, submit, speed, onSkip, onCycleSpeed }: BattlePanelCtx) {
  const moveActs = obs.legalActions.filter((a: any) => a.action?.kind === "move" || a.action?.kind === "switch" || a.action?.kind === "struggle");
  const concede = obs.legalActions.find((a: any) => a.action?.kind === "concede");
  return (
    <div style={{ display: "flex", gap: 8, padding: "8px 10px", alignItems: "stretch" }}>
      <div style={{ display: "flex", gap: 8, flex: 1, flexWrap: "wrap" }}>
        {moveActs.map((a: any) => {
          const moveId = a.action?.kind === "move" ? a.actionId.slice(4) : null;
          const badge = moveId !== null ? moveBadge(meta, moveId) : null;
          const mMeta = moveId !== null ? meta?.moves[moveId] : undefined;
          const pp = moveId !== null ? obs.own.ppByMoveId?.[moveId] : undefined;
          const effNow = mMeta?.effVs?.[obs.opponent.speciesId];
          const et = effTag(effNow);
          const isSwitch = a.action?.kind === "switch";
          const swSpecies = isSwitch ? obs.own.bench?.find((b: any) => b.unitId === a.action.unitId)?.speciesId : undefined;
          return (
            <button key={a.actionId} data-testid={`btn-${a.actionId}`} disabled={!myTurn}
              className={`skill${isSwitch ? " switch" : ""}`}
              onClick={() => submit(a.actionId)}
              style={isSwitch && isReplacement ? { border: "2px solid #f66" } : undefined}>
              <div className="sname">{isSwitch ? `换下 → ${zhSpecies(swSpecies ?? a.label ?? "")}` : moveId !== null ? zhMove(moveId) : "挣扎"}</div>
              <div className="sinfo">
                {moveId !== null ? (
                  <>
                    <span>
                      {mMeta?.type !== undefined && <b className="tchip" style={{ background: typeColor(mMeta.type) }}>{mMeta.type}</b>}
                      {" "}次数 {pp ?? "?"}/{mMeta?.pp ?? "?"}
                    </span>
                    <span>{badge !== null ? <><span style={{ color: badge.color }}>[{badge.tag}]</span> 威力 {badge.power}</> : "变化"}
                      {et !== null && <b style={{ color: et.color, marginLeft: 3 }}>{et.text}</b>}
                    </span>
                  </>
                ) : (
                  <span>{isSwitch ? "替换" : "挣扎"}</span>
                )}
              </div>
              {moveId !== null && mMeta !== undefined && (
                <div className="tip">
                  <div className="tt">{zhMove(moveId)}</div>
                  {describeMove(mMeta).map((line, i) => <div key={i} className="tl">{line}</div>)}
                  <div className="tm">PP {pp ?? "?"}/{mMeta.pp ?? "?"}</div>
                </div>
              )}
            </button>
          );
        })}
      </div>
      <div className="rail">
        {concede !== undefined && (
          <button data-testid="btn-act_concede" className="warn" disabled={!myTurn} onClick={() => submit("act_concede")}>撤退</button>
        )}
        <button data-testid="btn-skip" onClick={onSkip}>快进</button>
        <button data-testid="btn-speed" onClick={onCycleSpeed}>{speed}x</button>
      </div>
    </div>
  );
}

/** battle.hud：战斗日志 */
function BattleLogView({ log }: BattlePanelCtx) {
  return <pre className="log" data-testid="battle-log">{log.join("\n")}</pre>;
}

/** battle.hud：终局操作条（领奖/返回） */
function PostBattle({ obs }: BattlePanelCtx) {
  if (obs.terminal === null) return null;
  return (
    <div data-testid="post-battle" style={{ display: "flex", gap: 10, justifyContent: "center", padding: "8px 10px 14px" }}>
      {qs.get("wpl") !== null && <ClaimReward battleId={BATTLE} playerId={qs.get("wpl")!} />}
      {qs.get("wpl") !== null && (
        <a data-testid="back-world" href={`/?wpl=${qs.get("wpl")}`}>
          <button className="skill" style={{ padding: "8px 20px" }}>← 返回世界</button>
        </a>
      )}
      <a data-testid="back-lobby" href="/">
        <button className="skill" style={{ padding: "8px 20px" }}>{qs.get("wpl") !== null ? "返回大厅" : "再来一局"}</button>
      </a>
    </div>
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
    <div data-testid="claim-reward" style={{ padding: 8 }}>
      <button data-testid="btn-claim" onClick={() => void claim()}>领取奖励</button>
      {res !== null && (
        res.items !== undefined
          ? <span style={{ color: "#8f8" }}> +{Object.entries(res.items).map(([k, v]) => `${k}×${v}`).join(" ")}（{res.fresh === true ? "已入账" : "回执重放——未重复入账"}）</span>
          : <span style={{ color: "#f66" }}> {res.err}</span>
      )}
    </div>
  );
}

/** 世界入口页：注册→会话→地图导航/节点动作/队伍编辑/挑战→战斗 闭环。 */
function World() {
  const [playerId, setPlayerId] = useState(qs.get("wpl") ?? "wpl_trainer1");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [opsLeft, setOpsLeft] = useState(0);
  const [allowIrr, setAllowIrr] = useState(true);
  const [pack, setPack] = useState("synthetic-v2");
  const [meta, setMeta] = useState<PackMeta | null>(null);
  const [map, setMap] = useState<{ location: string; nodes: { id: string; label: string; actions: { id: string; desc: string; irreversible?: boolean }[] }[] } | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [team, setTeam] = useState<string[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const say = (s: string) => setLog((l) => [...l.slice(-30), s]);
  const wplOk = /^wpl_[a-z0-9-]{1,60}$/.test(playerId);

  const refresh = async () => {
    const [p, m] = await Promise.all([
      fetch(`/api/world/player/${playerId}`).then((r) => (r.status === 200 ? r.json() : null)),
      fetch(`/api/world/player/${playerId}/map`).then((r) => (r.status === 200 ? r.json() : null)),
    ]);
    setProfile(p); setMap(m);
  };

  const enter = async () => {
    if (!wplOk) { say("玩家ID 需 wpl_ 开头"); return; }
    await fetch("/api/world/player", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ playerId, name: playerId }) });
    const s = await fetch("/api/world/session", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId, ops: 128, irreversible: allowIrr }),
    }).then((r) => r.json());
    setSessionId(s.sessionId); setOpsLeft(s.opsLeft);
    await refresh();
    say(`进入世界 — 会话 ${s.sessionId} 预算 ${s.opsLeft}${allowIrr ? "（允许消耗道具）" : ""}`);
  };

  useEffect(() => { void loadMetaPack(pack).then(setMeta); }, [pack]);
  useEffect(() => { if (qs.get("wpl") !== null && wplOk) void enter(); }, []); // 战斗归来自动重进

  const op = async (body: Record<string, unknown>) => {
    const r = await fetch("/api/world/op", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, ...body }),
    });
    const b = await r.json() as any;
    if (r.status !== 200) { say(`✗ ${b.code}: ${b.message}`); return null; }
    setOpsLeft(b.opsLeft ?? opsLeft);
    return b;
  };

  const move = async (nodeId: string) => {
    const b = await op({ op: "move", nodeId });
    if (b !== null) { say(`→ ${b.location}`); await refresh(); }
  };

  const act = async (actionId: string) => {
    const b = await op({ op: "act", actionId });
    if (b === null) return;
    if (b.battle !== undefined) { // challenge → 直接进战局
      location.assign(`/?battle=${b.battle.battleId}&player=${b.battle.token}&pve=1&wpl=${playerId}`);
      return;
    }
    say(`✓ ${actionId}: ${JSON.stringify(b.result)}`);
    await refresh();
  };

  const species = meta === null ? [] : Object.keys(meta.units).sort();
  const toggle = (id: string) => setTeam((t) => t.includes(id) ? t.filter((x) => x !== id) : t.length >= 3 ? t : [...t, id]);
  const saveTeam = async () => {
    if (team.length === 0) return;
    await fetch(`/api/world/player/${playerId}/team`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "main", pack, species: team }),
    });
    say(`队伍已存档 main=[${team.join(",")}]`);
    await refresh();
  };
  const curNode = map?.nodes.find((n) => n.id === map.location);
  const quickStart = async () => {
    if (team.length === 0) { say("先点选队伍"); return; }
    const foe = pack === "synthetic-v2" ? ["syn-epsilon", "syn-delta"] : species.filter((s) => s !== team[0]).slice(0, 2);
    const owners = wplOk ? { p1: playerId } : undefined;
    const r = await fetch("/api/battle", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pack, mode: "pve",
        team: { p1: team, p2: foe.length > 0 ? foe : team },
        ...(owners !== undefined ? { owners } : {}),
      }),
    });
    const body = await r.json() as { battleId?: string; tokens?: { p1: string }; message?: string };
    if (body.battleId === undefined || body.tokens === undefined) { say(`✗ ${body.message ?? "create failed"}`); return; }
    location.assign(`/?battle=${body.battleId}&player=${body.tokens.p1}&pve=1${owners !== undefined ? `&wpl=${playerId}` : ""}`);
  };

  return (
    <div data-testid="world-screen" style={{ fontFamily: "monospace", color: "#ddd", padding: 16 }}>
      <h3>Seer Reborn — 世界</h3>
      <div style={{ marginBottom: 8 }}>
        玩家ID <input data-testid="player-id" value={playerId}
          onChange={(e) => { setPlayerId(e.target.value); setSessionId(null); }}
          style={{ fontFamily: "monospace", width: 200 }} />
        {" "}<label><input type="checkbox" data-testid="irr-check" checked={allowIrr} onChange={(e) => setAllowIrr(e.target.checked)} /> 允许消耗道具</label>
        {" "}<button data-testid="btn-enter" onClick={() => void enter()}>进入世界</button>
        {sessionId !== null && <span style={{ color: "#8af", fontSize: 12 }}> 预算 {opsLeft}/128</span>}
      </div>
      {profile !== null && (
        <div data-testid="world-profile" style={{ fontSize: 12, color: "#8af", marginBottom: 8 }}>
          胜{profile.wins}/负{profile.losses} · 背包[{Object.entries(profile.inventory).map(([k, v]) => `${k}×${v}`).join(" ") || "空"}]
          <br />任务 {profile.quests.map((q: any) => <span key={q.id} style={{ color: q.done ? "#8f8" : "#ddd" }}>{q.desc} {q.progress}/{q.target}{q.done ? "✓" : ""}{"　"}</span>)}
        </div>
      )}
      {map !== null && (
        <div data-testid="world-map" style={{ margin: "8px 0", padding: 8, border: "1px solid #444" }}>
          {map.nodes.map((n) => (
            <button key={n.id} data-testid={`node-${n.id}`} onClick={() => void move(n.id)}
              style={{ margin: 4, padding: "6px 10px", border: n.id === map.location ? "2px solid #4af" : "1px solid #555" }}>
              {n.label}{n.id === map.location ? " ◎" : ""}
            </button>
          ))}
          <div style={{ marginTop: 6 }}>
            {curNode?.actions.map((a) => (
              <button key={a.id} data-testid={`act-${a.id}`} onClick={() => void act(a.id)}
                style={{ margin: 4, padding: "4px 8px", fontSize: 12, border: a.irreversible === true ? "1px solid #f96" : "1px solid #555" }}>
                {a.irreversible === true ? "⚠ " : ""}{a.desc}
              </button>
            ))}
          </div>
        </div>
      )}
      <div data-testid="team-builder" style={{ marginTop: 12, padding: 8, border: "1px solid #444" }}>
        <b>队伍</b>{" "}<select data-testid="pack-select" value={pack} onChange={(e) => { setPack(e.target.value); setTeam([]); }}>
          <option value="synthetic-v2">synthetic-v2</option><option value="synthetic-v1">synthetic-v1</option>
        </select>
        <div style={{ margin: "6px 0" }}>{species.map((id) => (
          <button key={id} data-testid={`pick-${id}`} onClick={() => toggle(id)}
            style={{ margin: 4, padding: "5px 8px", fontSize: 12, border: team.includes(id) ? "2px solid #4af" : "1px solid #555" }}>
            {zhSpecies(id)}<span style={{ fontSize: 9, color: "#6a7ca8" }}> {id}</span>{team.includes(id) ? `(#${team.indexOf(id) + 1})` : ""}
          </button>
        ))}</div>
        <span style={{ fontSize: 12 }}>首发={team[0] ?? "-"} bench=[{team.slice(1).join(",")}]</span>
        {" "}<button data-testid="btn-start" disabled={team.length === 0} onClick={() => void quickStart()}>快速开战</button>
        {" "}<button data-testid="btn-save-team" disabled={!wplOk || team.length === 0} onClick={() => void saveTeam()}>存档</button>
        {profile?.teams?.map((t: any) => (
          <button key={t.name} data-testid={`load-${t.name}`} onClick={() => setTeam(t.species)}>载入:{t.name}</button>
        ))}
      </div>
      <pre data-testid="world-log" style={{ fontSize: 11, height: 90, overflow: "auto", color: "#9ab" }}>{log.join("\n")}</pre>
    </div>
  );
}

function loadMetaPack(packId: string): Promise<PackMeta> {
  return fetch(`/api/content/${packId}`).then((r) => r.json() as Promise<PackMeta>);
}

/** 战斗入口——赛尔号式：选精灵编队 → 直接进对战（PVE boss / 双人对局）。 */
function Lobby() {
  const [pack, setPack] = useState("synthetic-v2");
  const [meta, setMeta] = useState<PackMeta | null>(null);
  const [team, setTeam] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { void loadMetaPack(pack).then(setMeta); }, [pack]);
  const species = meta === null ? [] : Object.keys(meta.units).sort();
  const toggle = (id: string) => setTeam((t) => t.includes(id) ? t.filter((x) => x !== id) : t.length >= 3 ? t : [...t, id]);
  const start = async () => {
    const foe = pack === "synthetic-v2" ? ["syn-epsilon", "syn-delta"] : species.filter((s) => !team.includes(s)).slice(0, 2);
    const r = await fetch("/api/battle", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ pack, mode: "pve", team: { p1: team, p2: foe.length > 0 ? foe : team } }),
    });
    const b = await r.json() as { battleId?: string; tokens?: { p1: string }; message?: string };
    if (b.battleId === undefined || b.tokens === undefined) { setErr(b.message ?? "create failed"); return; }
    location.assign(`/?battle=${b.battleId}&player=${b.tokens.p1}&pve=1`);
  };
  return (
    <div data-testid="team-builder" style={{ maxWidth: 720, margin: "24px auto", padding: "0 16px" }}>
      <div style={{ textAlign: "center", marginBottom: 18 }}>
        <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: 6, color: "#cfe0ff", textShadow: "0 0 18px #4a7dff88" }}>精灵对战</div>
        <div style={{ fontSize: 11, color: "#7a90c8", marginTop: 4 }}>SEER REBORN · 合成规则演示</div>
      </div>
      <div style={{ marginBottom: 10, fontSize: 12, color: "#9ab4e8" }}>
        规则包 <select data-testid="pack-select" value={pack} onChange={(e) => { setPack(e.target.value); setTeam([]); }}
          style={{ background: "#16204a", color: "#cfe0ff", border: "1px solid #3a4a70", padding: "3px 8px", borderRadius: 6 }}>
          <option value="synthetic-v2">synthetic-v2</option>
          <option value="synthetic-v1">synthetic-v1</option>
        </select>
        <span style={{ marginLeft: 10 }}>按点选顺序编队（第 1 只首发，最多 3 只）</span>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {species.map((id) => {
          const hue = speciesHue(id);
          const order = team.indexOf(id);
          const hp = meta!.units[id]?.hp ?? 0;
          return (
            <button key={id} data-testid={`pick-${id}`} onClick={() => toggle(id)} style={{
              width: 108, padding: 8, borderRadius: 10, cursor: "pointer", fontFamily: "inherit",
              background: order >= 0 ? "#1c2f66" : "#141d3d",
              border: order >= 0 ? "2px solid #5a8aff" : "1px solid #2c3d68", color: "#dfe8ff",
            }}>
              <div style={{
                width: 44, height: 44, margin: "0 auto 6px", borderRadius: "50%",
                background: `radial-gradient(circle at 35% 30%, hsl(${hue},70%,70%), hsl(${hue},60%,40%))`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 800, fontSize: 18, color: "#fff", textShadow: "0 1px 2px #000",
              }}>{id.slice(4, 5).toUpperCase()}</div>
              <div style={{ fontSize: 12, fontWeight: 700 }}>{zhSpecies(id)}</div>
              <div>{(meta!.units[id]?.types ?? []).map((t) => <b key={t} className="tchip" style={{ background: typeColor(t), marginLeft: 2 }}>{t}</b>)}</div>
              <div style={{ fontSize: 9, color: "#6a7ca8" }}>{id}</div>
              <div style={{ fontSize: 10, color: "#9ab4e8" }}>体力 {hp}</div>
              {order >= 0 && <div style={{ fontSize: 10, color: "#8af", marginTop: 2 }}>{order === 0 ? "首发" : `替补 ${order}`}</div>}
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 12, color: "#9ab4e8" }}>首发={team[0] ?? "-"} 替补=[{team.slice(1).join(", ")}]</span>
        <button data-testid="btn-start" disabled={team.length === 0} onClick={() => void start()} style={{
          padding: "10px 34px", fontSize: 16, fontWeight: 800, letterSpacing: 4, borderRadius: 10,
          background: team.length === 0 ? "#2a3450" : "linear-gradient(180deg,#ffb830,#f07818)",
          border: "1px solid #ffd080", color: "#311800", cursor: team.length === 0 ? "default" : "pointer",
          fontFamily: "inherit",
        }}>开始对战</button>
        {err !== null && <span style={{ color: "#f66", fontSize: 12 }}>{err}</span>}
      </div>
      <div style={{ marginTop: 20, fontSize: 11, color: "#5a6c9a" }}>
        <a href="/?world=1" style={{ color: "#5a6c9a" }}>世界地图（实验）</a> · 内容与规则均为合成，与原游戏无关
      </div>
    </div>
  );
}

/** 内建 presentation 模块注册——新页面/新面板照此追加，不改渲染分发逻辑 */
const builtinDisposers = [
  slots.registerScreen("battle", App),
  slots.registerScreen("world", World),
  slots.registerScreen("lobby", Lobby),
  slots.registerPanel("battle.top", BattleTop),
  slots.registerPanel("battle.top", ReplacementBanner),
  slots.registerPanel("battle.hud", BenchRow),
  slots.registerPanel("battle.hud", SkillBar),
  slots.registerPanel("battle.hud", BattleLogView),
  slots.registerPanel("battle.hud", PostBattle),
];
void builtinDisposers;

function screenId(): string {
  if (BATTLE && TOKEN) return "battle";
  return qs.get("world") === "1" || qs.get("wpl") !== null ? "world" : "lobby";
}

function Root() {
  const Screen = slots.screen(screenId()) ?? Lobby;
  return <Screen />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
