/**
 * screens/bag.tsx —— 背包：三类（精灵 / 道具 / 刻印）。
 * 精灵 = 编队列表 | 展示台（全身立绘 + 魂印）| 战斗信息（六维 + 携带技能 + 第五技能 + 刻印槽），技能更换抽屉。
 * 道具 = 战斗药剂卡（图标 / 品质 / 携带上限），选中看详情。
 * 刻印 = 刻印图鉴（按类型图标、搜索、系列），点卡片佩戴给当前精灵（规则同刻印中心）。
 * 编队 / 技能携带 / 刻印都写 teamStore（服务端落盘），进战斗时带入。
 */
import { useMemo, useState, type CSSProperties } from "react";
import { describeMove, moveBadge, typeColor, zhMove, zhSpecies, zhStat, type ItemMeta, type PackMeta, type SealMeta } from "../meta.ts";
import { teamStore, useTeamStore } from "../teamStore.ts";
import { BATTLE_SIZE, bagMakeLead, bagRemoveAt } from "../party.ts";
import { carriedSlots, sealEquipError } from "../bag.tsx";
import { FifthEmblem, categoryOf } from "../battle/deck.tsx";
import { ART, ITEM_KIND_ZH, SEAL_TONE, itemArt, itemRarity, sealArt } from "../ui/art.ts";
import { CreatureArt, Icon, Portrait, SceneBg, StatBars, TopNav, TypeGem } from "../ui/kit.tsx";
import { PlayerBar, usePackMeta } from "./home.tsx";

type Tab = "pets" | "items" | "seals";
const RAR_ZH = { n: "普通", r: "稀有", sr: "史诗", ssr: "传说" } as const;
const STATS = ["hp", "atk", "def", "spa", "sdf", "spd"] as const;

function commitTeam(next: string[]) {
  const ts = teamStore.get();
  teamStore.setTeam(next);
  for (const [key, rec, set] of [["loadout", ts.loadout, teamStore.setLoadout], ["carried", ts.carried, teamStore.setCarried]] as const) {
    void key;
    const out = { ...rec };
    let changed = false;
    for (const id of Object.keys(out)) if (!next.includes(id)) { delete out[id]; changed = true; }
    if (changed) set(out);
  }
}

/* ── 精灵页 ─────────────────────────────────────────────────────────────── */

function CarrySkill({ moveId, armed, meta, testId, onPick }: { moveId: string | null; armed: boolean; meta: PackMeta; testId: string; onPick: () => void }) {
  const m = moveId !== null ? meta.moves[moveId] : undefined;
  const badge = moveId !== null ? moveBadge(meta, moveId) : null;
  const cat = categoryOf(m);
  return (
    <button type="button" data-testid={testId} className={`skill cx${armed ? " picked" : ""}${moveId === null ? " empty" : ""}`}
      style={{ "--tc": m?.type !== undefined ? typeColor(m.type) : "#7d8db5" } as CSSProperties} onClick={onPick}>
      <span className="s-head">
        {m?.type !== undefined ? <TypeGem t={m.type} /> : <span className="tgem" />}
        <span className={`s-cat ${cat.cls}`}><Icon name={cat.icon} />{moveId === null ? "空位" : cat.label}</span>
      </span>
      <span className="sname">{moveId === null ? "未携带" : zhMove(moveId, meta)}</span>
      <span className="s-foot">
        <span className="sinfo"><small>次数 </small><b className="num">{m?.pp ?? "—"}/{m?.pp ?? "—"}</b></span>
        <span className="s-pow">{badge !== null ? <><small>威力</small><b className="num">{badge.power}</b></> : <small className="s-var">{moveId === null ? "" : "变化技"}</small>}</span>
      </span>
      {armed && <span className="s-picked"><Icon name="swap" />更换中</span>}
      {m !== undefined && (
        <div className="tip">
          <div className="tt">{m.type !== undefined && <TypeGem t={m.type} />}{zhMove(moveId!, meta)}</div>
          {describeMove(m).map((line, i) => <div key={i} className="tl">{line}</div>)}
          <div className="tm">PP {m.pp ?? "?"}</div>
        </div>
      )}
    </button>
  );
}

function PetsTab({ meta, shown, setShown, goSeals }: { meta: PackMeta | null; shown: string | null; setShown: (id: string | null) => void; goSeals: () => void }) {
  const ts = useTeamStore();
  const team = ts.team;
  const [arm, setArm] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const cur = shown !== null && team.includes(shown) ? shown : team[0] ?? null;
  const unit = cur !== null ? meta?.units[cur] : undefined;
  const mark = unit?.soulMark !== undefined ? meta?.soulmarks?.[unit.soulMark] : undefined;
  const slots = cur !== null && meta !== null ? carriedSlots(meta, ts.carried, cur) : [null, null, null, null];
  const seals = cur !== null ? ts.loadout[cur] ?? [] : [];
  const tc = typeColor(unit?.types?.[0] ?? "");

  const assign = (moveId: string) => {
    if (cur === null || arm === null || meta === null) return;
    const now = carriedSlots(meta, ts.carried, cur).map((s) => s ?? "");
    if (now.includes(moveId)) { setNote("这个技能已经在四格里"); return; }
    now[arm] = moveId;
    teamStore.setCarried({ ...ts.carried, [cur]: now });
    setArm(null); setNote(null);
  };

  const row = (index: number) => {
    const id = team[index];
    const fight = index < BATTLE_SIZE;
    if (id === undefined) return <div key={index} className={`bp-slot empty${fight ? "" : " sm"}`} data-testid={`pd-empty-${index}`}><Icon name="plus" /><span>空位</span></div>;
    const u = meta?.units[id];
    const i = fight ? index : index - BATTLE_SIZE;
    return (
      <div key={index} className={`bp-slot${fight ? "" : " sm"}${index === 0 ? " lead" : ""}${id === cur ? " on" : ""}`}>
        <button type="button" data-testid={`pd-party-${index}`} className="bp-face" onClick={() => { setShown(id); setArm(null); setNote(null); }}>
          <Portrait id={id} meta={meta} size={fight ? 46 : 38} tone={index === 0 ? "au" : id === cur ? "cy" : undefined} />
          {fight && (
            <span className="bp-info">
              <b>{zhSpecies(id, meta)}</b>
              <span><span className="num">Lv {u?.level ?? 100}</span>{(u?.types ?? []).map((t) => <TypeGem key={t} t={t} />)}</span>
            </span>
          )}
          {index === 0 && <span className="bp-flag">首发</span>}
        </button>
        <span className="ds-tools">
          {index !== 0 && <button type="button" data-testid={`${fight ? "pd-lead" : "pd-standby-lead"}-${i}`} title="设为首发" onClick={() => commitTeam(bagMakeLead(team, index))}><Icon name="crown" /></button>}
          <button type="button" data-testid={`${fight ? "pd-out" : "pd-standby-out"}-${i}`} title="移出编队" onClick={() => commitTeam(bagRemoveAt(team, index))}><Icon name="close" /></button>
        </span>
      </div>
    );
  };

  return (
    <div className="bg-pets" data-testid="petbag" data-variant="detail">
      <aside className="bp-party cx m-glass e-soft">
        <h2 className="h-sec">出战精灵<small className="num">{Math.min(team.length, BATTLE_SIZE)}/{BATTLE_SIZE}</small></h2>
        <div className="bp-list">{Array.from({ length: BATTLE_SIZE }, (_, i) => row(i))}</div>
        <h2 className="h-sec">待命精灵<small className="num">{Math.max(0, team.length - BATTLE_SIZE)}/{BATTLE_SIZE}</small></h2>
        <div className="bp-grid">{Array.from({ length: BATTLE_SIZE }, (_, i) => row(BATTLE_SIZE + i))}</div>
        <a className="btn btn--ghost btn--sm cx bp-go" href="/?screen=storage"><Icon name="box" />去仓库调整</a>
      </aside>

      <section className="bp-show" style={{ "--tc": tc } as CSSProperties}>
        {cur !== null && unit !== undefined ? (
          <>
            <div className="bs-title">
              <span className="lvtag num"><small>Lv</small>{unit.level ?? 100}</span>
              <h1>{zhSpecies(cur, meta)}</h1>
              <span className="bs-types">{(unit.types ?? []).map((t) => <span key={t} className="tchip" style={{ "--tc": typeColor(t) } as CSSProperties}><TypeGem t={t} />{t}</span>)}</span>
            </div>
            <div className="bs-stage">
              <span className="bs-halo" />
              <span className="bs-ring" />
              <CreatureArt id={cur} size={340} className="bs-art" />
            </div>
            <div className="bs-facts">
              <span><small>性格</small><b>{unit.nature ?? "—"}</b></span>
              <span><small>编号</small><b className="num">{cur}</b></span>
              <span><small>位置</small><b>{team.indexOf(cur) === 0 ? "首发" : team.indexOf(cur) < BATTLE_SIZE ? "出战" : "待命"}</b></span>
            </div>
            {mark !== undefined && (
              <div className="bs-soul cx m-deep e-soft">
                <span className="soul-chip">◆ 魂印</span><b>{mark.name}</b>
                {mark.desc !== undefined && <p>{mark.desc}</p>}
              </div>
            )}
          </>
        ) : (
          <div className="sd-empty"><Icon name="paw" /><p>背包里还没有精灵。<br />去仓库挑选几只编入编队吧。</p><a className="btn btn--cy cx" href="/?screen=storage">打开仓库</a></div>
        )}
      </section>

      <aside className="bp-info cx m-glass e-cy tex">
        <h2 className="h-sec">战斗信息</h2>
        {unit?.stats !== undefined ? <StatBars stats={unit.stats} /> : <p className="muted">这个规则包没有六维面板</p>}
        <h2 className="h-sec">携带技能<small>点一格，再从下方选技能换上</small></h2>
        <div className="bi-skills">
          {meta !== null && slots.map((id, i) => (
            <CarrySkill key={i} testId={`pd-carry-${i}`} moveId={id} armed={arm === i} meta={meta} onPick={() => { setArm(arm === i ? null : i); setNote(null); }} />
          ))}
        </div>
        {unit?.fifthMoveId !== undefined && meta !== null && (
          <div className="bi-fifth">
            <div className="fifth" data-testid="carry-fifth" title="第五技能固定在独立槽，不能和四个普通技能互换">
              <FifthEmblem moveId={unit.fifthMoveId} meta={meta} pp={meta.moves[unit.fifthMoveId]?.pp} max={meta.moves[unit.fifthMoveId]?.pp} />
            </div>
            <div className="bi-fifth-txt">
              <b>{zhMove(unit.fifthMoveId, meta)}</b>
              <span>{describeMove(meta.moves[unit.fifthMoveId]).slice(0, 2).join(" · ")}</span>
            </div>
          </div>
        )}
        <div className="bi-seals">
          <span className="bi-k">刻印</span>
          {Array.from({ length: meta?.sealRules?.maxPerUnit ?? 0 }, (_, i) => {
            const sid = seals[i];
            const s = sid !== undefined ? meta?.seals?.[sid] : undefined;
            return s !== undefined
              ? <button key={i} type="button" className="bi-seal" title={`${s.name}（点击卸下）`} onClick={() => cur !== null && teamStore.setLoadout({ ...ts.loadout, [cur]: seals.filter((_, j) => j !== i) })}><img src={sealArt(s.type)} alt="" /></button>
              : <span key={i} className="bi-seal empty"><Icon name="plus" /></span>;
          })}
          <button type="button" data-testid="pd-toggle-seal" className="btn btn--ghost btn--sm cx" disabled={cur === null || meta?.seals === undefined} onClick={goSeals}><Icon name="shield" />刻印中心</button>
        </div>
      </aside>

      {arm !== null && unit !== undefined && meta !== null && (
        <div className="bp-learn cx m-raise e-cy">
          <div className="bl-head">
            <h2 className="h-sec">更换第 {arm + 1} 格技能<small>{note ?? "第五技能不能换进普通格"}</small></h2>
            <button type="button" data-testid="pd-toggle-learn" className="btn btn--ghost btn--sm cx" onClick={() => setArm(null)}><Icon name="close" />收起</button>
          </div>
          <div className="bl-row">
            {(unit.moveIds ?? []).map((id) => {
              const m = meta.moves[id];
              const on = slots.includes(id);
              return (
                <button type="button" key={id} data-testid={`learn-${id}`} className={`bl-move${on ? " on" : ""}`} onClick={() => assign(id)}
                  style={{ "--tc": m?.type !== undefined ? typeColor(m.type) : "#7d8db5" } as CSSProperties}>
                  {m?.type !== undefined && <TypeGem t={m.type} />}
                  <b>{zhMove(id, meta)}</b>
                  {m?.power ? <span className="num">{m.power}</span> : <span className="muted">变化</span>}
                  {on && <em>携带中</em>}
                </button>
              );
            })}
            {(unit.moveIds ?? []).length === 0 && <span className="muted">技能表还没载入</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 道具页 ─────────────────────────────────────────────────────────────── */

function ItemsTab({ meta }: { meta: PackMeta | null }) {
  const list: ItemMeta[] = meta?.items !== undefined ? Object.values(meta.items) : [];
  const [sel, setSel] = useState<string | null>(null);
  const it = list.find((x) => x.id === sel) ?? list[0];
  const groups = (["hp", "pp", "cleanse"] as const).map((k) => ({ k, items: list.filter((x) => x.kind === k) })).filter((g) => g.items.length > 0);
  return (
    <div className="bg-items">
      <section className="bi-list">
        {list.length === 0 && <div className="st-empty">这个规则包没有战斗药剂</div>}
        {groups.map((g) => (
          <div key={g.k} className="bi-group">
            <h2 className="h-sec">{ITEM_KIND_ZH[g.k]}<small>{g.items.length} 种</small></h2>
            <div className="bi-cards">
              {g.items.map((x) => {
                const r = itemRarity(x);
                return (
                  <button type="button" key={x.id} data-testid={`bag-item-${x.id}`} className={`icard cx rar-${r}${it?.id === x.id ? " sel" : ""}`} onClick={() => setSel(x.id)}>
                    <span className={`ic-rar r-${r}`}>{RAR_ZH[r]}</span>
                    <img src={itemArt(x)} alt="" />
                    <b>{x.name}</b>
                    <span className="ic-eff">{x.kind === "hp" ? `体力 +${x.heal}` : x.kind === "pp" ? `PP +${x.pp}` : `净化 + 体力 ${x.heal ?? 0}`}</span>
                    <span className="ic-n num">×{x.cap}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </section>
      <aside className="bi-detail cx m-glass e-cy tex">
        {it !== undefined ? (
          <>
            <div className={`id-art rar-bg-${itemRarity(it)}`}><img src={itemArt(it)} alt="" /></div>
            <span className={`ic-rar r-${itemRarity(it)}`}>{RAR_ZH[itemRarity(it)]} · {ITEM_KIND_ZH[it.kind]}</span>
            <h2 className="id-name">{it.name}</h2>
            <div className="id-stats">
              {it.heal !== undefined && <span><small>体力回复</small><b className="num">+{it.heal}</b></span>}
              {it.pp !== undefined && <span><small>PP 回复</small><b className="num">+{it.pp}</b></span>}
              <span><small>每场携带</small><b className="num">{it.cap}</b></span>
            </div>
            <p className="id-note">{it.note}</p>
            <div className="id-tags">
              {it.clearDown === true && <span className="tchip plain" style={{ "--tc": "#5aa8ff" } as CSSProperties}>解除能力下降</span>}
              {it.cleanse === true && <span className="tchip plain" style={{ "--tc": "#46e38a" } as CSSProperties}>解除全部异常</span>}
              <span className="tchip plain info">战斗中使用占用本回合</span>
            </div>
          </>
        ) : <div className="sd-empty"><Icon name="potion" /><p>没有道具</p></div>}
      </aside>
    </div>
  );
}

/* ── 刻印页 ─────────────────────────────────────────────────────────────── */

const SEAL_PAGE = 36;

function SealsTab({ meta, target }: { meta: PackMeta | null; target: string | null }) {
  const ts = useTeamStore();
  const [q, setQ] = useState("");
  const [ftype, setFtype] = useState("全部");
  const [fseries, setFseries] = useState("全部");
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const seals = meta?.seals;
  const all = useMemo(() => (seals === undefined ? [] : Object.values(seals)), [seals]);
  const types = useMemo(() => [...new Set(all.map((s) => s.type))], [all]);
  const seriesList = useMemo(() => [...new Set(all.map((s) => s.series).filter((x): x is string => x !== undefined))].sort(), [all]);
  const filtered = useMemo(() => all.filter((s) =>
    (ftype === "全部" || s.type === ftype) && (fseries === "全部" || s.series === fseries) && (q === "" || s.name.includes(q) || s.id.includes(q))), [all, q, ftype, fseries]);
  const pages = Math.max(1, Math.ceil(filtered.length / SEAL_PAGE));
  const cur = Math.min(page, pages - 1);
  const items = filtered.slice(cur * SEAL_PAGE, cur * SEAL_PAGE + SEAL_PAGE);
  const s: SealMeta | undefined = (sel !== null ? seals?.[sel] : undefined) ?? items[0];
  const unitId = target !== null && ts.team.includes(target) ? target : ts.team[0] ?? null;
  const current = unitId !== null ? ts.loadout[unitId] ?? [] : [];
  const rules = meta?.sealRules;
  const equip = (id: string) => {
    if (meta === null || unitId === null || rules === undefined) return;
    const err = sealEquipError(meta, zhSpecies(unitId, meta), current, id);
    if (err !== null) { setMsg(err); return; }
    setMsg(null);
    teamStore.setLoadout({ ...ts.loadout, [unitId]: [...current, id] });
  };
  const reset = (fn: () => void) => { fn(); setPage(0); };
  if (seals === undefined || rules === undefined) return <div className="st-empty">这个规则包没有刻印</div>;
  return (
    <div className="bg-seals" data-testid="seal-picker">
      <section className="bs-main">
        <div className="bs-bar">
          <div className="bs-tabs">
            {["全部", ...types].map((t) => (
              <button key={t} type="button" className={`bs-tab${ftype === t ? " on" : ""}`} onClick={() => reset(() => setFtype(t))}>
                {t !== "全部" && <img src={sealArt(t)} alt="" />}{t}
              </button>
            ))}
          </div>
          <select className="field sr" data-testid="seal-ftype" value={ftype} onChange={(e) => reset(() => setFtype(e.target.value))}>
            <option>全部</option>{types.map((t) => <option key={t}>{t}</option>)}
          </select>
          <span className="spacer" />
          <label className="st-search"><Icon name="search" /><input className="field" data-testid="seal-q" placeholder="刻印名称 / 编号" value={q} onChange={(e) => reset(() => setQ(e.target.value))} /></label>
          <select className="field" data-testid="seal-fseries" value={fseries} onChange={(e) => reset(() => setFseries(e.target.value))}>
            <option>全部</option>{seriesList.map((x) => <option key={x}>{x}</option>)}
          </select>
        </div>
        <div className="bs-grid" data-testid="seal-list">
          {items.map((x) => {
            const err = unitId !== null && meta !== null ? sealEquipError(meta, zhSpecies(unitId, meta), current, x.id) : "先在编队里放一只精灵";
            return (
              <button type="button" key={x.id} data-testid={`seal-row-${x.id}`} className={`scard cx rar-${SEAL_TONE[x.type] ?? "n"}${s?.id === x.id ? " sel" : ""}${err !== null ? " blocked" : ""}`}
                onClick={() => { setSel(x.id); equip(x.id); }} title={err ?? "点击佩戴"}>
                <img src={sealArt(x.type)} alt="" />
                <span className="sc-txt">
                  <b>{x.name}</b>
                  <small>{x.series ?? x.type}{x.exclusive !== undefined ? ` · 专属` : ""}</small>
                </span>
                <span className="sc-stat">{STATS.filter((k) => x.stats[k] > 0).slice(0, 2).map((k) => `${zhStat(k)}+${x.stats[k]}`).join(" ")}</span>
              </button>
            );
          })}
          {items.length === 0 && <div className="st-empty">无匹配刻印</div>}
        </div>
        <div className="bs-foot">
          <span className="muted">共 <b className="num">{filtered.length}</b> 枚 · 相同≤{rules.maxIdentical} · 同系列≤{rules.maxPerSeries}</span>
          {pages > 1 && (
            <div className="pager">
              <button type="button" className="btn btn--ghost btn--sm cx" disabled={cur === 0} onClick={() => setPage(cur - 1)}><Icon name="left" /></button>
              <span className="num">{cur + 1}/{pages}</span>
              <button type="button" className="btn btn--ghost btn--sm cx" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}><Icon name="right" /></button>
            </div>
          )}
        </div>
      </section>
      <aside className="bs-side cx m-glass e-cy tex">
        <div className="bs-target">
          {unitId !== null ? <Portrait id={unitId} meta={meta} size={48} tone="cy" /> : <span className="pt" style={{ "--sz": "48px" } as CSSProperties}><span className="pt-in" /></span>}
          <span><small>佩戴目标</small><b>{unitId !== null ? zhSpecies(unitId, meta) : "无"}</b></span>
        </div>
        <div className="bs-slots">
          {Array.from({ length: rules.maxPerUnit }, (_, i) => current[i] ?? "").map((id, i) => {
            const x = id !== "" ? seals[id] : undefined;
            return (
              <button type="button" key={i} data-testid={`seal-slot-${i}`} className={`bs-slot${x !== undefined ? " on" : ""}`}
                onClick={() => { if (id !== "" && unitId !== null) teamStore.setLoadout({ ...ts.loadout, [unitId]: current.filter((_, j) => j !== i) }); setMsg(null); }}
                title={x !== undefined ? `${x.name}（点击卸下）` : "空槽"}>
                {x !== undefined ? <img src={sealArt(x.type)} alt="" /> : <Icon name="plus" />}
                <span>{x?.name ?? `槽 ${i + 1}`}</span>
              </button>
            );
          })}
        </div>
        {msg !== null && <div className="bs-err" data-testid="seal-err"><Icon name="lock" />{msg}</div>}
        {s !== undefined && (
          <div className="bs-detail">
            <img src={sealArt(s.type)} alt="" />
            <h3>{s.name}</h3>
            <span className="muted">{s.type}{s.series !== undefined ? ` · ${s.series}` : ""}{s.exclusive !== undefined ? ` · 专属「${s.exclusive}」` : ""}</span>
            <div className="bs-stats">
              {STATS.filter((k) => s.stats[k] > 0).map((k) => <span key={k}><small>{zhStat(k)}</small><b className="num">+{s.stats[k]}</b></span>)}
            </div>
            {s.desc !== undefined && <p>{s.desc}</p>}
          </div>
        )}
      </aside>
    </div>
  );
}

/* ── 页面 ───────────────────────────────────────────────────────────────── */

export function BagPage() {
  const meta = usePackMeta();
  const ts = useTeamStore();
  const [tab, setTab] = useState<Tab>("pets");
  const [shown, setShown] = useState<string | null>(null);
  const tabs: { id: Tab; label: string; icon: "paw" | "potion" | "shield"; n: number | string }[] = [
    { id: "pets", label: "精灵", icon: "paw", n: ts.team.length },
    { id: "items", label: "道具", icon: "potion", n: meta?.items !== undefined ? Object.keys(meta.items).length : 0 },
    { id: "seals", label: "刻印", icon: "shield", n: meta?.seals !== undefined ? Object.keys(meta.seals).length : 0 },
  ];
  return (
    <div className="page bag">
      <SceneBg src={ART.bgBag} />
      <TopNav active="bag" right={<PlayerBar meta={meta} team={ts.team} />} />
      <main className="bg-body">
        <nav className="bg-tabs">
          {tabs.map((t) => (
            <button key={t.id} type="button" data-testid={`bagtab-${t.id}`} className={`bg-tab cx${tab === t.id ? " on" : ""}`} onClick={() => setTab(t.id)}>
              <Icon name={t.icon} /><span>{t.label}</span><small className="num">{t.n}</small>
            </button>
          ))}
        </nav>
        <div className="bg-pane">
          {tab === "pets" && <PetsTab meta={meta} shown={shown} setShown={setShown} goSeals={() => setTab("seals")} />}
          {tab === "items" && <ItemsTab meta={meta} />}
          {tab === "seals" && <SealsTab meta={meta} target={shown} />}
        </div>
      </main>
    </div>
  );
}
