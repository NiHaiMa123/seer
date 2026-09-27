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
import { loadMeta, packIdOf, moveBadge, type PackMeta } from "./meta.ts";

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
          {e.kind}{e.remainingTurns !== undefined ? `:${e.remainingTurns}` : ""}{e.stack !== undefined ? `×${e.stack}` : ""}
        </span>
      ))}
    </span>
  );
}

function BenchPanel({ bench }: { bench: any[] }) {
  return (
    <div data-testid="bench-panel" style={{ display: "flex", gap: 6, padding: "4px 8px" }}>
      {bench.map((b: any, i: number) => (
        <div key={b.unitId} data-testid={`bench-${i}`} style={{
          border: `1px solid ${b.alive ? "#4a6" : "#533"}`, padding: "2px 8px", fontSize: 11,
          opacity: b.alive ? 1 : 0.45,
        }}>
          {b.speciesId} {b.hp.current}/{b.hp.max}
          {b.mode !== undefined && <span style={{ color: "#fd6" }}> [{b.mode}]</span>}
          {b.revives !== undefined && b.revives > 0 && <span style={{ color: "#8af" }}> ↻{b.revives}</span>}
          <Chips effects={b.effects} stages={b.stages} />
        </div>
      ))}
    </div>
  );
}

function App() {
  const [obs, setObs] = useState<any>(null);
  const [meta, setMeta] = useState<PackMeta | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [speed, setSpeed] = useState(SPEED);
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
      scene.setup(o.own.unitId, o.opponent.unitId, o.own.speciesId, o.opponent.speciesId);
      scene.setHp(o.own.unitId, o.own.hp.current, o.own.hp.max);
      scene.setHp(o.opponent.unitId, o.opponent.hp.current, o.opponent.hp.max);
      setObs(o);

      client.poll(250, r.cursor, (cur, events) => {
        if (!alive) return;
        for (const ev of events) {
          scene.enqueueEvent(ev, unitIds.current!, o.side);
          if (ev.type === "switch" && unitIds.current) {
            const key = ev.side === o.side ? "own" : "opp";
            scene.swapUnit(ev.outUnitId, ev.inUnitId, key === "own" ? "self" : "foe", "");
            unitIds.current[key] = ev.inUnitId;
          }
          setLog((l) => [...l.slice(-60), `${ev.type} ${JSON.stringify(ev)}`]);
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

  if (!obs) return <div data-testid="loading">loading…</div>;
  const myTurn = obs.decision !== null && obs.decision.actors.includes(obs.side) && obs.terminal === null;
  const isReplacement = obs.decision?.kind === "replacement";

  return (
    <div style={{ fontFamily: "monospace", color: "#ddd" }}>
      <div data-testid="battle-status" style={{ padding: 8 }}>
        {qs.get("pve") === "1" && <span data-testid="pve-badge" style={{ color: "#fd6", marginRight: 8 }}>[PVE]</span>}
        side={obs.side} turn={obs.turn} rev={obs.revision} terminal={JSON.stringify(obs.terminal)}
      </div>
      {isReplacement && myTurn && (
        <div data-testid="replacement-banner" style={{ margin: "0 8px", padding: 8, background: "#533", border: "1px solid #f66" }}>
          ⚠ 精灵倒下 — 选择替补上场
        </div>
      )}
      <canvas ref={canvasRef} data-testid="pixi-canvas" />
      <div style={{ display: "flex", justifyContent: "space-between", padding: "0 8px", fontSize: 12 }}>
        <span>{obs.own.speciesId}<Chips effects={obs.own.effects} stages={obs.own.stages} />
          {obs.own.revives !== undefined && obs.own.revives > 0 && <span style={{ color: "#8af", fontSize: 10 }}> ↻{obs.own.revives}</span>}
          {obs.own.mode !== undefined && <span style={{ color: "#fd6", fontSize: 10 }}> [{obs.own.mode}]</span>}
        </span>
        <span>{obs.opponent.speciesId}
          {obs.opponent.benchAlive !== undefined && <span style={{ color: "#8af", fontSize: 10 }}> bench×{obs.opponent.benchAlive}</span>}
          <Chips effects={obs.opponent.effects} stages={obs.opponent.stages} />
          {obs.opponent.mode !== undefined && <span style={{ color: "#fd6", fontSize: 10 }}> [{obs.opponent.mode}]</span>}
        </span>
      </div>
      {obs.own.bench !== undefined && <BenchPanel bench={obs.own.bench} />}
      <div style={{ display: "flex", gap: 8, padding: 8 }}>
        {obs.legalActions.map((a: any) => {
          const moveId = a.actionId.startsWith("act_") && a.action?.kind === "move" ? a.actionId.slice(4) : null;
          const badge = moveId !== null ? moveBadge(meta, moveId) : null;
          const isSwitch = a.action?.kind === "switch";
          return (
            <button key={a.actionId} data-testid={`btn-${a.actionId}`} disabled={!myTurn}
              onClick={() => submit(a.actionId)}
              style={isSwitch && isReplacement ? { border: "2px solid #f66" } : undefined}>
              {a.label ?? a.actionId}
              {badge !== null && <span style={{ fontSize: 9, marginLeft: 4, color: badge.color }}>[{badge.tag}{badge.power > 0 ? ` ${badge.power}` : ""}]</span>}
            </button>
          );
        })}
        <button data-testid="btn-skip" onClick={() => sceneRef.current?.skip()}>skip</button>
        <button data-testid="btn-speed" onClick={() => { const s = speed >= 4 ? 1 : speed * 2; setSpeed(s); sceneRef.current!.speed = s; }}>
          {speed}x
        </button>
      </div>
      <pre data-testid="battle-log" style={{ fontSize: 11, height: 140, overflow: "auto" }}>{log.join("\n")}</pre>
      {obs.terminal !== null && qs.get("wpl") !== null && <ClaimReward battleId={BATTLE} playerId={qs.get("wpl")!} />}
      {qs.get("wpl") !== null && (
        <div style={{ padding: 8 }}>
          <a data-testid="back-world" href={`/?wpl=${qs.get("wpl")}`} style={{ color: "#8af" }}>← 返回世界</a>
        </div>
      )}
    </div>
  );
}

/** 终局领奖：outbox exactly-once——重复点击回执相同、不重复入账。 */
function ClaimReward({ battleId, playerId }: { battleId: string; playerId: string }) {
  const [res, setRes] = useState<{ items?: Record<string, number>; fresh?: boolean; err?: string } | null>(null);
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
            {id}{team.includes(id) ? `(#${team.indexOf(id) + 1})` : ""}
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {BATTLE && TOKEN ? <App /> : <World />}
  </StrictMode>,
);
