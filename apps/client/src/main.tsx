/**
 * main.tsx —— React UI 壳：技能按钮（legalActions 驱动）、状态面板、日志、
 * AI/速度/跳过控制。URL: ?battle=&player=&mode=human|ai&speed=N&autoplay=1
 */
import { createRoot } from "react-dom/client";
import { StrictMode, useEffect, useRef, useState } from "react";
import { BattleClient } from "./api.ts";
import { BattleScene } from "./scene.ts";
import { chooseAction } from "./ai.ts";

declare const window: any;

const qs = new URLSearchParams(location.search);
const BATTLE = qs.get("battle")!;
const TOKEN = qs.get("player")!;
const MODE = qs.get("mode") ?? "human";
const SPEED = Number(qs.get("speed") ?? "1");
const AUTOPLAY = qs.get("autoplay") === "1";

function App() {
  const [obs, setObs] = useState<any>(null);
  const [log, setLog] = useState<string[]>([]);
  const [speed, setSpeed] = useState(SPEED);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clientRef = useRef<BattleClient | null>(null);
  const sceneRef = useRef<BattleScene | null>(null);
  const cursorRef = useRef(0);
  const decisionDone = useRef<string | null>(null);

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
      scene.setup(r.observation.own.unitId, r.observation.opponent.unitId);
      scene.setHp(r.observation.own.unitId, r.observation.own.hp.current, r.observation.own.hp.max);
      scene.setHp(r.observation.opponent.unitId, r.observation.opponent.hp.current, r.observation.opponent.hp.max);
      setObs(r.observation);

      client.poll(250, r.cursor, (cur, events) => {
        if (!alive) return;
        for (const ev of events) {
          scene.enqueueEvent(ev, { own: r.observation.own.unitId, opp: r.observation.opponent.unitId }, r.observation.side);
          setLog((l) => [...l.slice(-60), `${ev.type} ${JSON.stringify(ev)}`]);
          // HP 用下一次 observe 对齐——这里仅终局补刷
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
      // 动画只负责表现——HP 以权威 observe 对齐
      scene.setHp(o.own.unitId, o.own.hp.current, o.own.hp.max);
      scene.setHp(o.opponent.unitId, o.opponent.hp.current, o.opponent.hp.max);
    };

    return () => {
      alive = false;
      client.destroy();
      scene.destroy();
    };
  }, []);

  // AI / autoplay：观察更新后自动提交
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

  return (
    <div style={{ fontFamily: "monospace", color: "#ddd" }}>
      <div data-testid="battle-status" style={{ padding: 8 }}>
        side={obs.side} turn={obs.turn} rev={obs.revision} terminal={JSON.stringify(obs.terminal)}
      </div>
      <canvas ref={canvasRef} data-testid="pixi-canvas" />
      <div style={{ display: "flex", gap: 8, padding: 8 }}>
        {obs.legalActions.map((a: any) => (
          <button key={a.actionId} data-testid={`btn-${a.actionId}`} disabled={!myTurn} onClick={() => submit(a.actionId)}>
            {a.actionId}
          </button>
        ))}
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
