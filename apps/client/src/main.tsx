/**
 * main.tsx —— 战斗页壳（16:9 全幅战场 + 悬浮层 + 指挥台，按视口等比缩放）+ 世界（实验）页 + 整页登记。
 * 主界面 / 仓库 / 背包 / 战斗入口在 screens/。
 * 战斗视图组件在 battle/ 目录（模组化：卡片/徽印/指挥面板/信息流各自成文件）。
 * URL: ?battle=&player=&mode=human|ai&speed=N&autoplay=1
 * 权威状态永远来自 observe；动画只表现公开事件。
 */
import { createRoot } from "react-dom/client";
import { StrictMode, useEffect, useRef, useState } from "react";
import { BattleClient } from "./api.ts";
import { BattleScene, VIEW_W, VIEW_H } from "./scene.ts";
import { chooseAction } from "./ai.ts";
import { loadMeta, packIdOf, zhSpecies, type PackMeta } from "./meta.ts";
import { slots, type BattlePanelCtx } from "./slots.ts";
import { fifthMechanics, PetBag } from "./bag.tsx";
import { battleParty } from "./party.ts";
import { speciesOf } from "./battle/cards.tsx";
import { fmtEvent } from "./battle/feed.tsx";
import { pageQuery } from "./query.ts";
import { registerBuiltinPanels } from "./presentation.ts";
import { Home } from "./screens/home.tsx";
import { StoragePage } from "./screens/storage.tsx";
import { BagPage } from "./screens/bag.tsx";
import { Lobby } from "./screens/lobby.tsx";
import { Icon, SceneBg, TopNav } from "./ui/kit.tsx";
import { ART } from "./ui/art.ts";

declare const window: any;

const qs = pageQuery();
const BATTLE = qs.get("battle")!;
const TOKEN = qs.get("player")!;
const MODE = qs.get("mode") ?? "human";
const SPEED = (() => { const v = Number(qs.get("speed") ?? "1"); return Number.isFinite(v) && v > 0 ? v : 1; })();
const AUTOPLAY = qs.get("autoplay") === "1";

function App() {
  const [obs, setObs] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [meta, setMeta] = useState<PackMeta | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [speed, setSpeed] = useState(SPEED);
  const canvasRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<BattleClient | null>(null);
  const sceneRef = useRef<BattleScene | null>(null);
  const cursorRef = useRef(0);
  const decisionDone = useRef<string | null>(null);
  const unitIds = useRef<{ own: string; opp: string } | null>(null);
  const obsRef = useRef<any>(null);
  const metaRef = useRef<PackMeta | null>(null);
  const fit = useFit(VIEW_W, VIEW_H);
  const fitRef = useRef(fit);

  useEffect(() => {
    const client = new BattleClient("", BATTLE, TOKEN);
    clientRef.current = client;
    const scene = new BattleScene();
    scene.speed = SPEED;
    sceneRef.current = scene;
    let alive = true;
    scene.onSettled = () => {
      if (!alive || sceneRef.current !== scene) return;
      const host = canvasRef.current;
      if (host !== null) host.dataset.sceneSettled = "1";
    };
    window.__scenePose = () => (sceneRef.current === scene ? scene.pose() : "");

    (async () => {
      // 画布按缩放后的实际像素出图，放大时不糊（上限 2x 控制填充率）
      await scene.init(canvasRef.current!, Math.min(2, Math.max(1, (globalThis.devicePixelRatio || 1) * fitRef.current)));
      let r: { cursor: number; events: any[]; observation: any };
      try {
        r = await client.resync(0);
      } catch {
        if (alive) setErr("无法连接服务器");
        return;
      }
      if (!alive) return;
      const o = r.observation;
      if (o?.own === undefined || o?.opponent === undefined) {
        const m = (r as unknown as { message?: unknown }).message;
        setErr(typeof m === "string" ? `对局不可用：${m}` : "对局不存在或已关闭");
        return;
      }
      cursorRef.current = r.cursor;
      const metaId = qs.get("pack") ?? packIdOf(o);
      void loadMeta(metaId).then((m) => {
        if (!alive) return;
        metaRef.current = m;
        setMeta(m);
        try {
          scene.setName(o.own.unitId, zhSpecies(o.own.speciesId, m));
          scene.setName(o.opponent.unitId, zhSpecies(o.opponent.speciesId, m));
        } catch { /* 场景层异常不影响 React 状态 */ }
      }).catch(() => {});
      obsRef.current = o;
      unitIds.current = { own: o.own.unitId, opp: o.opponent.unitId };
      scene.setup(o.own.unitId, o.opponent.unitId, zhSpecies(o.own.speciesId), zhSpecies(o.opponent.speciesId));
      scene.setHp(o.own.unitId, o.own.hp.current, o.own.hp.max);
      scene.setHp(o.opponent.unitId, o.opponent.hp.current, o.opponent.hp.max);
      setObs(o);
      if (o.terminal != null) scene.finish();

      client.poll(250, r.cursor, (cur, events) => {
        if (!alive) return;
        let ended = false;
        for (const ev of events) {
          // 动画/日志是纯表现层——单事件异常不得拖死状态同步
          try {
            if (ev.type === "battle-end") ended = true;
            scene.enqueueEvent(ev, unitIds.current!, o.side);
            if (ev.type === "switch" && unitIds.current) {
              const key = ev.side === o.side ? "own" : "opp";
              const sp = zhSpecies(speciesOf(obsRef.current ?? o, ev.inUnitId) ?? ev.inUnitId, metaRef.current);
              scene.swapUnit(ev.outUnitId, ev.inUnitId, key === "own" ? "self" : "foe", sp);
              unitIds.current[key] = ev.inUnitId;
            }
            const line = fmtEvent(ev, obsRef.current ?? o, metaRef.current);
            setLog((l) => [...l.slice(-60), line]);
          } catch { /* 表现层异常：跳过该事件，继续同步 */ }
        }
        // 这一批里如果已经终局，把还排着的受击/换人收到终点。结果条随后才挂上。
        try { if (ended) scene.finish(); } catch { /* 表现层异常不影响权威刷新 */ }
        cursorRef.current = cur;
        void client.ack(cur).catch(() => {});
        void refresh();
      });
    })();

    const refresh = async () => {
      let o: any;
      try {
        o = await client.observe();
      } catch { return; } // 网络抖动 → 下一轮 poll 再刷
      if (!alive || o?.own === undefined || o?.opponent === undefined) return; // 错误体不覆盖权威 obs
      obsRef.current = o;
      setObs(o);
      if (unitIds.current) {
        // unitId 可能因 switch 更换——以权威 observe 对齐映射
        if (unitIds.current.own !== o.own.unitId) unitIds.current.own = o.own.unitId;
        if (unitIds.current.opp !== o.opponent.unitId) unitIds.current.opp = o.opponent.unitId;
        try {
          scene.setHp(o.own.unitId, o.own.hp.current, o.own.hp.max);
          scene.setHp(o.opponent.unitId, o.opponent.hp.current, o.opponent.hp.max);
          scene.setName(o.own.unitId, zhSpecies(o.own.speciesId, metaRef.current));
          scene.setName(o.opponent.unitId, zhSpecies(o.opponent.speciesId, metaRef.current));
        } catch { /* 场景层异常不影响 React 状态 */ }
      }
      try { if (o.terminal != null) scene.finish(); } catch { /* 表现层异常不影响权威 obs */ }
    };

    return () => {
      alive = false;
      if (window.__scenePose !== undefined) window.__scenePose = () => "";
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
    const d = obs?.decision;
    if (d === null || d === undefined) return;
    void clientRef.current!.submit({
      decisionId: d.decisionId,
      actionId,
      baseRevision: d.baseRevision,
      idempotencyKey: `h-${obs.side}-${d.decisionId}-${actionId}`, // 同一决策内改招 = 新幂等键；同键重复提交仍幂等
    }).then((r) => {
      if (!r.ok) setLog((l) => [...l, `ERR ${r.code}: ${r.message}`]);
    });
  };

  useEffect(() => {
    if (AUTOPLAY && obs?.decision?.actors.includes(obs.side) && !obs.terminal) {
      const first = obs.legalActions[0];
      if (first !== undefined) submit(first.actionId); // 已锁定/无合法动作时空数组——不得取 [0].actionId
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
    <div className="bt-viewport">
      <div className="bt-letterbox" />
      <div className="bt-fit" style={{ width: VIEW_W * fit, height: VIEW_H * fit }}>
        <div className={`battle-shell${myTurn ? " my-turn" : ""}${isReplacement && myTurn ? " forced" : ""}`}
          style={{ width: VIEW_W, height: VIEW_H, transform: `scale(${fit})` }}>
          {obs === null && err === null && <div data-testid="loading" className="bt-loading"><i />载入战场…</div>}
          {err !== null && (
            <div data-testid="battle-error" className="bt-loading err">
              <div>{err}</div>
              <a href="/" className="btn btn--ghost cx">返回主界面</a>
            </div>
          )}
          {obs !== null && slots.panelEntries("battle.top").map((e) => <e.component key={e.id} {...ctx} />)}
          {/* 战场：Pixi 画布全幅 + 悬浮层（单位卡/横幅经 battle.arena 面板区挂载） */}
          <div className="arena-wrap">
            <div ref={canvasRef} data-testid="pixi-canvas" style={{ width: VIEW_W, height: VIEW_H }} />
            {obs !== null && (
              <div className="arena-overlay">
                {slots.panelEntries("battle.arena").map((e) => <e.component key={e.id} {...ctx} />)}
              </div>
            )}
          </div>
          {/* battle.hud：指挥面板/终局——叠在战场下缘，按注册顺序渲染 */}
          {obs !== null && <div className="bt-hud">{slots.panelEntries("battle.hud").map((e) => <e.component key={e.id} {...ctx} />)}</div>}
        </div>
      </div>
    </div>
  );
}

/** 战斗画面固定 16:9 设计尺寸，按视口等比缩放（不裁切文字与控件） */
function useFit(w: number, h: number): number {
  const calc = () => Math.max(0.5, Math.min(1.6, Math.min(window.innerWidth / w, window.innerHeight / h)));
  const [fit, setFit] = useState(calc);
  useEffect(() => {
    const on = () => setFit(calc());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return fit;
}

/** 世界入口页：注册→会话→地图导航/节点动作/队伍编辑/挑战→战斗 闭环。 */
function World() {
  const [playerId, setPlayerId] = useState(qs.get("wpl") ?? "wpl_trainer1");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [opsLeft, setOpsLeft] = useState(0);
  const [allowIrr, setAllowIrr] = useState(true);
  const [pack, setPack] = useState("peak");
  const [meta, setMeta] = useState<PackMeta | null>(null);
  const [map, setMap] = useState<{ location: string; nodes: { id: string; label: string; actions: { id: string; desc: string; irreversible?: boolean }[] }[] } | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [team, setTeam] = useState<string[]>([]);
  const [loadout, setLoadout] = useState<Record<string, string[]>>({});
  const [carried, setCarried] = useState<Record<string, string[]>>({});
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
      const chPack = typeof b.result?.challenge?.pack === "string" ? `&pack=${encodeURIComponent(b.result.challenge.pack)}` : "";
      location.assign(`/?battle=${b.battle.battleId}&player=${b.battle.token}&pve=1${chPack}&wpl=${playerId}`);
      return;
    }
    say(`✓ ${actionId}: ${JSON.stringify(b.result)}`);
    await refresh();
  };

  const species = meta === null ? [] : Object.keys(meta.units).sort();
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
    const fighters = battleParty(team);
    const foe = pack === "peak" ? ["pet-3550", "pet-3577"] : species.filter((s) => s !== fighters[0]).slice(0, 2);
    const owners = wplOk ? { p1: playerId } : undefined;
    const mech = fifthMechanics(meta, fighters, carried);
    const r = await fetch("/api/battle", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pack, mode: "pve",
        team: { p1: fighters, p2: foe.length > 0 ? foe : fighters },
        ...(owners !== undefined ? { owners } : {}),
        ...(meta?.seals !== undefined ? { loadout: { p1: fighters.map((id) => loadout[id] ?? []) } } : {}),
        ...(mech !== undefined ? { mechanics: mech } : {}),
      }),
    });
    const body = await r.json() as { battleId?: string; tokens?: { p1: string }; message?: string };
    if (body.battleId === undefined || body.tokens === undefined) { say(`✗ ${body.message ?? "create failed"}`); return; }
    location.assign(`/?battle=${body.battleId}&player=${body.tokens.p1}&pve=1&pack=${encodeURIComponent(pack)}${owners !== undefined ? `&wpl=${playerId}` : ""}`);
  };

  return (
    <div data-testid="world-screen" className="page world">
      <SceneBg src={ART.bgHome} />
      <TopNav active="home" right={<span className="res"><i className="cy" />世界 · 实验</span>} />
      <main className="page-body wd-body">
        <section className="wd-head cx m-glass e-soft">
          <h1 className="st-title">世界地图<small>WORLD · BETA</small></h1>
          <label className="wd-field">玩家 ID
            <input className="field" data-testid="player-id" value={playerId} onChange={(e) => { setPlayerId(e.target.value); setSessionId(null); }} />
          </label>
          <label className="wd-check"><input type="checkbox" data-testid="irr-check" checked={allowIrr} onChange={(e) => setAllowIrr(e.target.checked)} />允许消耗道具</label>
          <button type="button" data-testid="btn-enter" className="btn btn--primary cx" onClick={() => void enter()}><Icon name="globe" />进入世界</button>
          {sessionId !== null && <span className="res">预算 <b className="num">{opsLeft}/128</b></span>}
        </section>
        {profile !== null && (
          <section data-testid="world-profile" className="wd-profile cx m-glass e-soft">
            <span className="wd-stat"><small>战绩</small><b className="num">胜{profile.wins}/负{profile.losses}</b></span>
            <span className="wd-stat"><small>道具</small><b>{Object.entries(profile.inventory).map(([k, v]) => `${k}×${v}`).join(" ") || "空"}</b></span>
            <span className="wd-quests">任务 {profile.quests.map((q: any) => <span key={q.id} className={q.done ? "done" : ""}>{q.desc} {q.progress}/{q.target}{q.done ? " ✓" : ""}</span>)}</span>
          </section>
        )}
        {map !== null && (
          <section data-testid="world-map" className="wd-map cx m-glass e-cy">
            <div className="wd-nodes">
              {map.nodes.map((n) => (
                <button key={n.id} type="button" data-testid={`node-${n.id}`} onClick={() => void move(n.id)} className={`wd-node cx${n.id === map.location ? " on e-cy" : ""}`}>
                  <Icon name={n.id === map.location ? "star" : "globe"} solid={n.id === map.location} />{n.label}
                </button>
              ))}
            </div>
            <div className="wd-acts">
              {curNode?.actions.map((a) => (
                <button key={a.id} type="button" data-testid={`act-${a.id}`} onClick={() => void act(a.id)} className={`btn btn--sm cx ${a.irreversible === true ? "btn--danger" : "btn--cy"}`}>
                  {a.irreversible === true && <Icon name="bolt" />}{a.desc}
                </button>
              ))}
            </div>
          </section>
        )}
        <PetBag pack={pack} onPack={(id) => { setPack(id); setTeam([]); setLoadout({}); setCarried({}); }}
          meta={meta} team={team} onTeam={setTeam} loadout={loadout} onLoadout={setLoadout}
          carried={carried} onCarried={setCarried} onStart={() => void quickStart()} startLabel="快速开战">
          <button type="button" data-testid="btn-save-team" className="btn btn--ghost btn--sm cx" disabled={!wplOk || team.length === 0} onClick={() => void saveTeam()}>存档</button>
          {profile?.teams?.map((t: any) => (
            <button type="button" key={t.name} data-testid={`load-${t.name}`} className="btn btn--ghost btn--sm cx" onClick={() => setTeam(t.species)}>载入:{t.name}</button>
          ))}
        </PetBag>
        <pre data-testid="world-log" className="wd-log">{log.join("\n")}</pre>
      </main>
    </div>
  );
}

function loadMetaPack(packId: string): Promise<PackMeta> {
  return fetch(`/api/content/${packId}`).then((r) => r.json() as Promise<PackMeta>);
}

/** 整页仍在这里。面板不在这里，见 presentation.ts。 */
const builtinDisposers = [
  slots.registerScreen("battle", App),
  slots.registerScreen("world", World),
  slots.registerScreen("lobby", Lobby),
  slots.registerScreen("home", Home),
  slots.registerScreen("bag", BagPage),
  slots.registerScreen("storage", StoragePage),
];
registerBuiltinPanels();
void builtinDisposers;

function screenId(): string {
  if (BATTLE && TOKEN) return "battle";
  if (qs.get("world") === "1" || qs.get("wpl") !== null) return "world";
  const s = qs.get("screen");
  if (s === "bag" || s === "storage" || s === "lobby") return s;
  return "home";
}

function Root() {
  const Screen = slots.screen(screenId()) ?? Home;
  return <Screen />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
