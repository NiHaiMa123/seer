/**
 * screens/lobby.tsx —— 战斗入口：我方出战编队 VS 对手阵容，中间开始对战。
 * 对手阵容就是实际建局用的那组（与旧入口一致），不另造数据。编队在仓库 / 背包调整，经 teamStore 共享。
 */
import { useState, type CSSProperties } from "react";
import { typeColor, zhSpecies, type PackMeta } from "../meta.ts";
import { useTeamStore } from "../teamStore.ts";
import { BATTLE_SIZE, battleParty } from "../party.ts";
import { fifthMechanics } from "../bag.tsx";
import { CreatureArt, Icon, Portrait, SceneBg, TopNav, TypeGem } from "../ui/kit.tsx";
import { PACK_ID, PlayerBar, usePackMeta } from "./home.tsx";

const FOE = ["pet-3550", "pet-3577"];

function foeOf(meta: PackMeta, fighters: string[]): string[] {
  return PACK_ID === "peak" ? FOE : Object.keys(meta.units).filter((s) => !fighters.includes(s)).slice(0, 2);
}

function Lineup({ ids, meta, side }: { ids: string[]; meta: PackMeta | null; side: "own" | "foe" }) {
  return (
    <div className={`lu-list ${side}`}>
      {ids.map((id, i) => {
        const u = meta?.units[id];
        return (
          <div key={`${id}-${i}`} className={`lu-row cx${side === "foe" ? " cx-m e-foe" : i === 0 ? " e-au" : ""}`} style={{ "--tc": typeColor(u?.types?.[0] ?? "") } as CSSProperties}>
            <Portrait id={id} meta={meta} size={44} tone={side === "foe" ? "foe" : i === 0 ? "au" : undefined} />
            <span className="lu-txt">
              <b>{zhSpecies(id, meta)}</b>
              <span><span className="num">Lv {u?.level ?? 100}</span>{(u?.types ?? []).map((t) => <TypeGem key={t} t={t} />)}</span>
            </span>
            {u?.stats !== undefined && <span className="lu-hp num">{u.stats.hp}<small>HP</small></span>}
            {side === "own" && i === 0 && <span className="lu-flag">首发</span>}
          </div>
        );
      })}
    </div>
  );
}

export function Lobby() {
  const meta = usePackMeta();
  const ts = useTeamStore();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const team = ts.team;
  const fighters = battleParty(team);
  const foe = meta !== null ? foeOf(meta, fighters) : FOE;
  const start = async () => {
    if (busy || meta === null || team.length === 0) return;
    setBusy(true);
    try {
      const mech = fifthMechanics(meta, fighters, ts.carried);
      const r = await fetch("/api/battle", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pack: PACK_ID, mode: "pve", team: { p1: fighters, p2: foe.length > 0 ? foe : fighters },
          ...(meta.seals !== undefined ? { loadout: { p1: fighters.map((id) => ts.loadout[id] ?? []) } } : {}),
          ...(mech !== undefined ? { mechanics: mech } : {}),
        }),
      });
      const b = await r.json() as { battleId?: string; tokens?: { p1: string }; message?: string };
      if (b.battleId === undefined || b.tokens === undefined) { setErr(b.message ?? "建局失败"); setBusy(false); return; }
      location.assign(`/?battle=${b.battleId}&player=${b.tokens.p1}&pve=1&pack=${encodeURIComponent(PACK_ID)}`);
    } catch { setErr("网络错误"); setBusy(false); }
  };
  return (
    <div className="page lobby" data-testid="lobby-screen">
      <SceneBg src="/assets/ui/bg_arena.png" />
      <TopNav active="battle" right={<PlayerBar meta={meta} team={team} />} />
      <main className="lb-body">
        <section className="lb-side own">
          <h2 className="h-sec">我方出战<small className="num">{fighters.length}/{BATTLE_SIZE} · 待命 {Math.max(0, team.length - BATTLE_SIZE)}</small></h2>
          {fighters.length > 0 ? <Lineup ids={fighters} meta={meta} side="own" /> : (
            <div className="lb-empty cx m-glass e-soft"><Icon name="paw" /><p>还没有编队</p><a className="btn btn--cy cx" href="/?screen=storage">去仓库挑选精灵</a></div>
          )}
        </section>

        <section className="lb-center">
          <div className="lb-duel">
            {fighters[0] !== undefined && <CreatureArt id={fighters[0]} size={250} className="lb-art own" />}
            <span className="lb-vs">VS</span>
            {foe[0] !== undefined && <CreatureArt id={foe[0]} size={250} flip className="lb-art foe" />}
          </div>
          <div className="lb-mode"><span>人机对战</span><span>巅峰规则</span><span>出战 {BATTLE_SIZE} 只</span></div>
          <button type="button" data-testid="btn-start" className="btn btn--primary btn--lg cx lb-start" disabled={team.length === 0 || meta === null || busy} onClick={() => void start()}>
            <Icon name="sword" />{busy ? "正在进入…" : "开始对战"}
          </button>
          {err !== null && err !== "" && <span className="bag-err lb-err">{err}</span>}
          <div className="lb-links">
            <a className="btn btn--ghost btn--sm cx" href="/?screen=storage"><Icon name="swap" />调整编队</a>
            <a className="btn btn--ghost btn--sm cx" href="/?screen=bag"><Icon name="layers" />技能与刻印</a>
            <a className="btn btn--ghost btn--sm cx" href="/?world=1"><Icon name="globe" />世界地图 · 实验</a>
          </div>
        </section>

        <section className="lb-side foe">
          <h2 className="h-sec">对手阵容<small>{foe.length} 只</small></h2>
          <Lineup ids={foe} meta={meta} side="foe" />
        </section>
      </main>
    </div>
  );
}
