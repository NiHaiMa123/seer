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
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
