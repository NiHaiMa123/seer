/**
 * screens/storage.tsx —— 精灵仓库：左筛选栏（搜索 / 单双属性 / 属性晶石 / 更多组合）| 中收藏卡阵（分页）| 右选中详情 | 底部编队坞（出战 6 + 待命 6）。
 * 点卡片 = 编入 / 移出（沿用旧仓库语义与 test id）；最近点过的精灵在右侧展开详情。编队写 teamStore（服务端落盘）。
 */
import { useMemo, useState, type CSSProperties } from "react";
import { TYPE_COLOR, typeColor, zhMove, zhSpecies, type PackMeta } from "../meta.ts";
import { teamStore, useTeamStore } from "../teamStore.ts";
import { BAG_SIZE, BATTLE_SIZE, bagAdd, bagMakeLead, bagRemoveAt, bagReplace, bagToggle } from "../party.ts";
import { ART } from "../ui/art.ts";
import { CreatureArt, Icon, Portrait, SceneBg, StatBars, TopNav, TypeGem } from "../ui/kit.tsx";
import { PlayerBar, usePackMeta } from "./home.tsx";

const PAGE_SIZE = 40;

/** 编队变更时顺带清掉离队精灵的刻印 / 技能携带 */
function commitTeam(next: string[]) {
  const ts = teamStore.get();
  teamStore.setTeam(next);
  const drop = <T,>(rec: Record<string, T>) => {
    const out = { ...rec };
    let changed = false;
    for (const id of Object.keys(out)) if (!next.includes(id)) { delete out[id]; changed = true; }
    return changed ? out : null;
  };
  const l = drop(ts.loadout); if (l !== null) teamStore.setLoadout(l);
  const c = drop(ts.carried); if (c !== null) teamStore.setCarried(c);
}

function PetCard({ id, meta, n, lead, selected, onPick, onDup }: {
  id: string; meta: PackMeta | null; n: number; lead: boolean; selected: boolean; onPick: () => void; onDup: () => void;
}) {
  const u = meta?.units[id];
  const t0 = u?.types?.[0];
  return (
    <div className={`pcard-wrap${selected ? " sel" : ""}`}>
      <button type="button" data-testid={`pick-${id}`} className={`pcard cx${n > 0 ? " in" : ""}${lead ? " lead" : ""}`}
        style={{ "--tc": t0 !== undefined ? typeColor(t0) : "#5a6a90" } as CSSProperties} onClick={onPick}>
        <Portrait id={id} meta={meta} size={78} tone={lead ? "au" : n > 0 ? "cy" : undefined} />
        <span className="pc-name">{zhSpecies(id, meta)}</span>
        <span className="pc-types">{(u?.types ?? []).map((t) => <TypeGem key={t} t={t} />)}</span>
        <span className={`pc-flag${n > 0 ? " on" : ""}${lead ? " lead" : ""}`}>{n === 0 ? "编入" : lead && n === 1 ? "首发" : `已带 ${n}`}</span>
        {n > 0 && <span className="pc-check"><Icon name="check" /></span>}
      </button>
      <button type="button" data-testid={`warehouse-dup-${id}`} className="pc-dup" onClick={onDup} title="同种再带一只"><Icon name="plus" />再带一只</button>
    </div>
  );
}

function PartyDockSlot({ id, index, meta, shown, swapArmed, onOpen, onLead, onRemove, testId, emptyTestId, leadTestId, outTestId, flag }: {
  id: string | undefined; index: number; meta: PackMeta | null; shown: string | undefined; swapArmed: boolean;
  onOpen: () => void; onLead?: (() => void) | undefined; onRemove: () => void; testId: string; emptyTestId: string; leadTestId: string; outTestId: string; flag: string;
}) {
  if (id === undefined) {
    return (
      <div className={`dock-slot empty${swapArmed ? " armed" : ""}`} data-testid={emptyTestId} onClick={onOpen}>
        <span className="pt" style={{ "--sz": "46px" } as CSSProperties}><span className="pt-in"><Icon name="plus" /></span></span>
        <span className="ds-name">空位</span>
      </div>
    );
  }
  return (
    <div className={`dock-slot${index === 0 ? " lead" : ""}${id === shown ? " on" : ""}${swapArmed ? " armed" : ""}`}>
      <button type="button" data-testid={testId} className="ds-face" onClick={onOpen}>
        <Portrait id={id} meta={meta} size={46} tone={index === 0 ? "au" : id === shown ? "cy" : undefined} />
        <span className="ds-name">{zhSpecies(id, meta)}</span>
        <span className="ds-flag">{flag}</span>
      </button>
      <span className="ds-tools">
        {onLead !== undefined && <button type="button" data-testid={leadTestId} onClick={onLead} title="设为首发"><Icon name="crown" /></button>}
        <button type="button" data-testid={outTestId} onClick={onRemove} title="移出编队"><Icon name="close" /></button>
      </span>
    </div>
  );
}

export function StoragePage() {
  const meta = usePackMeta();
  const ts = useTeamStore();
  const team = ts.team;
  const [view, setView] = useState<string | null>(null);
  const [swap, setSwap] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [typeSel, setTypeSel] = useState<string | null>(null);
  const [typeMode, setTypeMode] = useState<"all" | "mono" | "dual">("all");
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);

  const species = useMemo(() => (meta === null ? [] : Object.keys(meta.units).sort()), [meta]);
  const { baseTypes, comboTypes } = useMemo(() => {
    const all = meta === null ? [] : [...new Set(Object.values(meta.units).flatMap((u) => u.types ?? []))];
    const order = Object.keys(TYPE_COLOR);
    const base = all.filter((t) => order.includes(t)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const combo = all.filter((t) => !order.includes(t)).sort((a, b) => a.localeCompare(b, "zh"));
    return { baseTypes: base, comboTypes: combo };
  }, [meta]);
  const filtered = species.filter((id) => {
    const query = q.trim();
    if (query !== "" && !zhSpecies(id, meta).includes(query) && !id.includes(query)) return false;
    const t = meta?.units[id]?.types ?? [];
    if (typeMode === "mono" && t.length !== 1) return false;
    if (typeMode === "dual" && t.length !== 2) return false;
    return typeSel === null || t.includes(typeSel);
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const curPage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(curPage * PAGE_SIZE, curPage * PAGE_SIZE + PAGE_SIZE);
  const shown = view ?? team[0];
  const unit = shown !== undefined ? meta?.units[shown] : undefined;
  const mark = unit?.soulMark !== undefined ? meta?.soulmarks?.[unit.soulMark] : undefined;
  const nIn = (id: string) => team.filter((x) => x === id).length;

  const toggle = (id: string) => {
    setView(id);
    if (team.includes(id)) { commitTeam(bagToggle(team, id)); setSwap(null); return; }
    if (team.length >= BAG_SIZE) { setSwap(id); return; }
    commitTeam(bagAdd(team, id));
    setSwap(null);
  };
  const addDup = (id: string) => {
    setView(id);
    if (team.length >= BAG_SIZE) { setSwap(id); return; }
    commitTeam(bagAdd(team, id));
    setSwap(null);
  };
  const onSlot = (index: number) => {
    const id = team[index];
    if (swap !== null) {
      commitTeam(id === undefined ? bagAdd(team, swap) : bagReplace(team, index, swap));
      setView(swap);
      setSwap(null);
      return;
    }
    if (id !== undefined) setView(id);
  };
  const setFilter = (fn: () => void) => { fn(); setPage(0); };

  const dockRow = (offset: number, prefix: "party" | "party-standby", flag: string) => (
    <div className={`dock-row ${prefix === "party" ? "fight" : "standby"}`}>
      {Array.from({ length: BATTLE_SIZE }, (_, i) => {
        const index = offset + i;
        const id = team[index];
        return (
          <PartyDockSlot key={i} id={id} index={index} meta={meta} shown={shown} swapArmed={swap !== null}
            testId={`${prefix}-${i}`} emptyTestId={`${prefix}-empty-${i}`} leadTestId={`${prefix}-lead-${i}`} outTestId={`${prefix}-out-${i}`}
            flag={index === 0 ? "首发" : flag}
            onOpen={() => onSlot(index)}
            onLead={index === 0 ? undefined : () => commitTeam(bagMakeLead(team, index))}
            onRemove={() => commitTeam(bagRemoveAt(team, index))} />
        );
      })}
    </div>
  );

  return (
    <div className="page storage" data-testid="team-builder">
      <SceneBg src={ART.bgLab} />
      <TopNav active="storage" right={<PlayerBar meta={meta} team={team} />} />
      <main className="st-body">
        <aside className="st-rail cx m-glass e-soft">
          <h2 className="h-sec">筛选</h2>
          <label className="st-search">
            <Icon name="search" />
            <input className="field" data-testid="warehouse-q" placeholder="搜索精灵名称 / 编号" value={q}
              onChange={(e) => setFilter(() => setQ(e.target.value))} />
          </label>
          <div className="seg">
            {(["all", "mono", "dual"] as const).map((m) => (
              <button key={m} type="button" data-testid={`wf-mode-${m}`} className={`seg-b${typeMode === m ? " on" : ""}`}
                onClick={() => setFilter(() => { setTypeMode(m); setTypeSel(null); })}>
                {m === "all" ? "全部" : m === "mono" ? "单属性" : "双属性"}
              </button>
            ))}
          </div>
          <div className="st-sub">属性</div>
          <div className="st-types">
            {baseTypes.map((t) => (
              <button key={t} type="button" data-testid={`wf-type-${t}`} className={`st-type${typeSel === t ? " on" : ""}`}
                style={{ "--tc": typeColor(t) } as CSSProperties}
                onClick={() => setFilter(() => setTypeSel(typeSel === t ? null : t))}>
                <TypeGem t={t} /><span>{t}</span>
              </button>
            ))}
          </div>
          {comboTypes.length > 0 && (
            <>
              <button type="button" className={`st-more${more ? " open" : ""}`} onClick={() => setMore(!more)}>
                更多属性组合 <b className="num">{comboTypes.length}</b><Icon name={more ? "up" : "right"} />
              </button>
              {(more || (typeSel !== null && comboTypes.includes(typeSel))) && (
                <div className="st-combos">
                  {comboTypes.map((t) => (
                    <button key={t} type="button" data-testid={`wf-type-${t}`} className={`st-combo${typeSel === t ? " on" : ""}`}
                      onClick={() => setFilter(() => setTypeSel(typeSel === t ? null : t))}>{t}</button>
                  ))}
                </div>
              )}
            </>
          )}
          <div className="st-count">符合条件 <b className="num">{filtered.length}</b> 只<small>规则包收录，非全图鉴</small></div>
        </aside>

        <section className="st-main">
          <div className="st-head">
            <h1 className="st-title">精灵仓库<small>STORAGE</small></h1>
            {typeSel !== null && <button type="button" className="st-chip" onClick={() => setFilter(() => setTypeSel(null))}><TypeGem t={typeSel} />{typeSel}<Icon name="close" /></button>}
            <span className="spacer" />
            {pageCount > 1 && (
              <div className="pager">
                <button type="button" data-testid="wf-prev" className="btn btn--ghost btn--sm cx" disabled={curPage === 0} onClick={() => setPage(curPage - 1)}><Icon name="left" /></button>
                <span data-testid="wf-pageinfo" className="num">第 {curPage + 1}/{pageCount} 页 · 共 {filtered.length} 只</span>
                <button type="button" data-testid="wf-next" className="btn btn--ghost btn--sm cx" disabled={curPage >= pageCount - 1} onClick={() => setPage(curPage + 1)}><Icon name="right" /></button>
              </div>
            )}
          </div>
          <div className="st-grid">
            {meta === null && <div className="st-empty">载入仓库…</div>}
            {meta !== null && pageItems.length === 0 && <div className="st-empty">没有符合条件的精灵</div>}
            {pageItems.map((id) => (
              <PetCard key={id} id={id} meta={meta} n={nIn(id)} lead={team[0] === id} selected={id === shown}
                onPick={() => toggle(id)} onDup={() => addDup(id)} />
            ))}
          </div>
        </section>

        <aside className="st-detail cx m-glass e-cy tex">
          {unit !== undefined && shown !== undefined ? (
            <>
              <div className="sd-stage" style={{ "--tc": typeColor(unit.types?.[0] ?? "") } as CSSProperties}>
                <span className="sd-ring" />
                <CreatureArt id={shown} size={176} />
              </div>
              <div className="sd-name">
                <h2>{zhSpecies(shown, meta)}</h2>
                <span className="lvtag num"><small>Lv</small>{unit.level ?? 100}</span>
              </div>
              <div className="sd-meta">
                {(unit.types ?? []).map((t) => <span key={t} className="tchip" style={{ "--tc": typeColor(t) } as CSSProperties}><TypeGem t={t} />{t}</span>)}
                {unit.nature !== undefined && <span className="sd-nature">性格 · {unit.nature}</span>}
                <span className="sd-id num">{shown}</span>
              </div>
              {unit.stats !== undefined && <StatBars stats={unit.stats} />}
              {mark !== undefined && <div className="sd-soul"><span className="soul-chip">◆ 魂印</span><b>{mark.name}</b>{mark.desc !== undefined && <p>{mark.desc}</p>}</div>}
              {(unit.moveIds ?? []).length > 0 && (
                <div className="sd-moves">
                  {(unit.moveIds ?? []).slice(0, 4).map((m) => {
                    const mm = meta?.moves[m];
                    return <span key={m} className="sd-move">{mm?.type !== undefined && <TypeGem t={mm.type} />}{zhMove(m, meta)}{mm?.power ? <b className="num">{mm.power}</b> : null}</span>;
                  })}
                  {unit.fifthMoveId !== undefined && <span className="sd-move sd-fifth"><Icon name="star" solid />{zhMove(unit.fifthMoveId, meta)}</span>}
                </div>
              )}
              <div className="sd-actions">
                <button type="button" className={`btn cx ${nIn(shown) > 0 ? "btn--danger" : "btn--primary"}`} onClick={() => toggle(shown)}>
                  <Icon name={nIn(shown) > 0 ? "close" : "plus"} />{nIn(shown) > 0 ? "移出编队" : "编入编队"}
                </button>
                {nIn(shown) > 0 && team[0] !== shown && (
                  <button type="button" className="btn btn--ghost cx" onClick={() => commitTeam(bagMakeLead(team, team.indexOf(shown)))}><Icon name="crown" />设为首发</button>
                )}
              </div>
            </>
          ) : (
            <div className="sd-empty"><Icon name="box" /><p>点一只精灵编入编队，<br />这里显示它的详细资料。</p></div>
          )}
        </aside>
      </main>

      <footer className="st-dock cx m-glass e-soft">
        <div className="dock-label"><b>出战</b><small className="num">{Math.min(team.length, BATTLE_SIZE)}/{BATTLE_SIZE}</small></div>
        {dockRow(0, "party", "出战")}
        <div className="dock-sep" />
        <div className="dock-label"><b>待命</b><small className="num">{Math.max(0, team.length - BATTLE_SIZE)}/{BATTLE_SIZE}</small></div>
        {dockRow(BATTLE_SIZE, "party-standby", "待命")}
        {swap !== null && <div className="dock-swap" data-testid="swap-arm"><Icon name="swap" />编队已满。点一格替换成 {zhSpecies(swap, meta)}<button type="button" onClick={() => setSwap(null)}><Icon name="close" /></button></div>}
      </footer>
    </div>
  );
}
