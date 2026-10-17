/**
 * screens/home.tsx —— 主界面：Krea2 主视觉 + 首发精灵立于浮台（视觉中心）+ 首发信息卡 + 导航（战斗为主入口，仓库/背包次级）+ 编队速览。
 * 只显示真实数据（teamStore / 规则包），不造假货币。
 */
import { useEffect, useState, type CSSProperties } from "react";
import { loadMeta, typeColor, zhSpecies, type PackMeta } from "../meta.ts";
import { useTeamStore } from "../teamStore.ts";
import { BATTLE_SIZE, BAG_SIZE } from "../party.ts";
import { ART } from "../ui/art.ts";
import { CreatureArt, Icon, Portrait, SceneBg, StatBars, TopNav, TypeGem } from "../ui/kit.tsx";

export const PACK_ID = "peak";

export function usePackMeta(packId = PACK_ID): PackMeta | null {
  const [meta, setMeta] = useState<PackMeta | null>(null);
  useEffect(() => { void loadMeta(packId).then(setMeta).catch(() => {}); }, [packId]);
  return meta;
}

/** 顶栏右侧：训练师身份 + 真实计数 */
export function PlayerBar({ meta, team }: { meta: PackMeta | null; team: string[] }) {
  const lead = team[0];
  return (
    <>
      <span className="res" title="本规则包收录的精灵数"><i className="cy" />图鉴 <b className="num">{meta === null ? "—" : Object.keys(meta.units).length}</b></span>
      <span className="player-chip cx m-glass e-soft">
        {lead !== undefined ? <Portrait id={lead} meta={meta} size={30} tone="au" /> : <span className="pt" style={{ "--sz": "30px" } as CSSProperties}><span className="pt-in" /></span>}
        <span><b>训练师</b><small>编队 {team.length}/{BAG_SIZE}</small></span>
      </span>
    </>
  );
}

export function Home() {
  const meta = usePackMeta();
  const ts = useTeamStore();
  const lead = ts.team[0];
  const unit = lead !== undefined ? meta?.units[lead] : undefined;
  const mark = unit?.soulMark !== undefined ? meta?.soulmarks?.[unit.soulMark] : undefined;
  const fighters = ts.team.slice(0, BATTLE_SIZE);
  return (
    <div className="page home" data-testid="home-screen">
      <SceneBg src={ART.bgHome} />
      <TopNav active="home" right={<PlayerBar meta={meta} team={ts.team} />} />
      <main className="home-stage">
        <section className="home-hero">
          <div className="hero-plinth">
            <span className="hero-ring" />
            <span className="hero-glow" />
            {lead !== undefined ? <CreatureArt id={lead} size={400} className="hero-art" /> : <span className="hero-empty"><Icon name="plus" /></span>}
          </div>
          <div className="hero-card cx m-glass e-cy tex">
            <span className="hero-tag"><Icon name="crown" />首发精灵</span>
            {unit !== undefined && lead !== undefined ? (
              <>
                <h2 className="hero-name">{zhSpecies(lead, meta)}</h2>
                <div className="hero-meta">
                  <span className="lvtag num"><small>Lv</small>{unit.level ?? 100}</span>
                  {(unit.types ?? []).map((t) => <span key={t} className="tchip" style={{ "--tc": typeColor(t) } as CSSProperties}><TypeGem t={t} />{t}</span>)}
                  {unit.nature !== undefined && <span className="hero-nature">性格 · {unit.nature}</span>}
                </div>
                {unit.stats !== undefined && <StatBars stats={unit.stats} />}
                {mark !== undefined && (
                  <div className="hero-soul"><span className="soul-chip">◆ 魂印</span><b>{mark.name}</b></div>
                )}
                <a className="btn btn--ghost cx" href="/?screen=bag"><Icon name="layers" />精灵详情</a>
              </>
            ) : (
              <>
                <h2 className="hero-name dim">还没有首发精灵</h2>
                <p className="hero-hint">去仓库挑选精灵编入队伍，第一只就是首发。</p>
                <a className="btn btn--cy cx" href="/?screen=storage"><Icon name="box" />打开仓库</a>
              </>
            )}
          </div>
        </section>

        <nav className="home-nav">
          <a className="hn-main cx e-au" href="/?screen=lobby" data-testid="home-go-battle">
            <img src={ART.navBattle} alt="" />
            <span className="hn-txt">
              <small>BATTLE</small>
              <b>战斗</b>
              <span>带上出战编队，进入对决</span>
            </span>
            <span className="hn-cta">出发<Icon name="right" /></span>
          </a>
          <div className="hn-row">
            <a className="hn-sub cx e-cy" href="/?screen=storage" data-testid="home-go-storage">
              <img src={ART.navStorage} alt="" />
              <span className="hn-txt"><small>STORAGE</small><b>仓库</b><span>收藏 · 筛选 · 编队</span></span>
            </a>
            <a className="hn-sub cx e-cy" href="/?screen=bag" data-testid="home-go-bag">
              <img src={ART.navBag} alt="" />
              <span className="hn-txt"><small>BAG</small><b>背包</b><span>精灵 · 道具 · 刻印</span></span>
            </a>
          </div>
          <a className="hn-link" href="/?world=1"><Icon name="globe" />世界地图<em>实验</em></a>
        </nav>
      </main>

      <footer className="home-party cx m-glass e-soft">
        <span className="hp-label"><b>出战编队</b><small className="num">{fighters.length}/{BATTLE_SIZE}</small></span>
        <div className="hp-slots">
          {Array.from({ length: BATTLE_SIZE }, (_, i) => {
            const id = fighters[i];
            return id !== undefined
              ? <a key={i} className={`hp-slot${i === 0 ? " lead" : ""}`} href="/?screen=bag" title={zhSpecies(id, meta)}>
                  <Portrait id={id} meta={meta} size={52} tone={i === 0 ? "au" : undefined} />
                  <span>{zhSpecies(id, meta)}</span>
                </a>
              : <a key={i} className="hp-slot empty" href="/?screen=storage"><span className="pt" style={{ "--sz": "52px" } as CSSProperties}><span className="pt-in"><Icon name="plus" /></span></span><span>空位</span></a>;
          })}
        </div>
        <span className="hp-standby">待命 <b className="num">{Math.max(0, ts.team.length - BATTLE_SIZE)}</b></span>
        <a className="btn btn--ghost btn--sm cx" href="/?screen=storage"><Icon name="swap" />调整编队</a>
      </footer>
    </div>
  );
}
