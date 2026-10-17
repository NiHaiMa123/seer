/**
 * bag.tsx —— 精灵背包。信息架构按页游背包（信息/能力/道具/资料 + 底部出战列），
 * 视觉沿用战斗指挥栏：左第五技能环、中四格普通技能、右四宫格分页。不改战斗样式。
 * 第五技能固定，不能换进四个普通格。携带结果经 mechanics.fifth 带进对局。
 */
import { useMemo, useState, type ReactNode } from "react";
import { speciesHue } from "./battle/badges.tsx";
import {
  describeMove, moveBadge, typeColor, zhMove, zhSpecies, zhStat, TYPE_COLOR,
  type PackMeta, type StatPanel,
} from "./meta.ts";
import { BAG_SIZE, BATTLE_SIZE, bagAdd, bagMakeLead, bagRemoveAt, bagReplace, bagToggle } from "./party.ts";

const STATS = ["hp", "atk", "def", "spa", "sdf", "spd"] as const;
export const SEAL_TYPE_COLOR: Record<string, string> = { 全能刻印: "#b8922a", 能力刻印: "#3a6ad0", 技能刻印: "#8a4ac0", 通用刻印: "#3a9070" };

export function carriedSlots(meta: PackMeta, carried: Record<string, string[]>, speciesId: string): (string | null)[] {
  const learned = meta.units[speciesId]?.moveIds ?? [];
  const stored = carried[speciesId];
  if (stored === undefined) return [0, 1, 2, 3].map((i) => learned[i] ?? null);
  return [0, 1, 2, 3].map((i) => {
    const id = stored[i];
    return id !== undefined && id !== "" && learned.includes(id) ? id : null;
  });
}

/** 带进对局的普通技能（去掉空位，最多 4，且都在物种 moveIds 里）。 */
export function carriedPayload(meta: PackMeta, carried: Record<string, string[]>, speciesId: string): string[] {
  const out: string[] = [];
  for (const id of carriedSlots(meta, carried, speciesId)) {
    if (id !== null && !out.includes(id)) out.push(id);
  }
  return out;
}

/** 规则包有第五技能、且物种技能表已下发时，才提交携带列表。不提交 = 沿用物种全部普通技能。 */
export function fifthMechanics(
  meta: PackMeta | null,
  team: string[],
  carried: Record<string, string[]>,
): { fifth: { p1: string[][] } } | undefined {
  if (meta === null || team.length === 0) return undefined;
  if (!Object.values(meta.moves).some((m) => m.fifth === true)) return undefined;
  if (team.some((id) => meta.units[id]?.moveIds === undefined)) return undefined;
  return { fifth: { p1: team.map((id) => carriedPayload(meta, carried, id)) } };
}

export const sealStatText = (s: StatPanel): string =>
  STATS.filter((k) => s[k] > 0).map((k) => `${zhStat(k)}+${s[k]}`).join(" ");

export function sealEquipError(meta: PackMeta, unitName: string, cur: string[], id: string): string | null {
  const rules = meta.sealRules!;
  const seals = meta.seals!;
  const seal = seals[id]!;
  if (cur.length >= rules.maxPerUnit) return `最多佩戴 ${rules.maxPerUnit} 枚刻印`;
  if (cur.filter((x) => x === id).length >= rules.maxIdentical) return `相同刻印最多 ${rules.maxIdentical} 枚`;
  if (seal.series !== undefined && cur.filter((x) => seals[x]?.series === seal.series).length >= rules.maxPerSeries)
    return `同系列「${seal.series}」最多 ${rules.maxPerSeries} 枚`;
  if (seal.exclusive !== undefined && seal.exclusive !== unitName) return `专属刻印，仅「${seal.exclusive}」可佩戴`;
  return null;
}

function SealPicker({ meta, unit, current, onChange }: {
  meta: PackMeta; unit: { speciesId: string; name?: string }; current: string[];
  onChange: (next: string[] | null) => void;
}) {
  const [q, setQ] = useState("");
  const [ftype, setFtype] = useState("全部");
  const [fseries, setFseries] = useState("全部");
  const [msg, setMsg] = useState<string | null>(null);
  const seals = meta.seals!;
  const all = useMemo(() => Object.values(seals), [seals]);
  const types = useMemo(() => [...new Set(all.map((s) => s.type))], [all]);
  const seriesList = useMemo(() => [...new Set(all.map((s) => s.series).filter((x): x is string => x !== undefined))].sort(), [all]);
  const filtered = useMemo(() => all.filter((s) =>
    (ftype === "全部" || s.type === ftype) &&
    (fseries === "全部" || s.series === fseries) &&
    (q === "" || s.name.includes(q) || s.id.includes(q))
  ), [all, q, ftype, fseries]);
  const rules = meta.sealRules!;
  const equip = (id: string) => {
    const err = sealEquipError(meta, unit.name ?? unit.speciesId, current, id);
    if (err !== null) { setMsg(err); return; }
    setMsg(null);
    onChange([...current, id]);
  };
  return (
    <div data-testid="seal-picker" className="bag-seal">
      <div className="bag-seal-bar">
        <b>{zhSpecies(unit.speciesId, meta)}</b> 的刻印
        <input data-testid="seal-q" placeholder="名称/ID" value={q} onChange={(e) => setQ(e.target.value)} />
        <select data-testid="seal-ftype" value={ftype} onChange={(e) => setFtype(e.target.value)}>
          <option>全部</option>{types.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select data-testid="seal-fseries" value={fseries} onChange={(e) => setFseries(e.target.value)}>
          <option>全部</option>{seriesList.map((s) => <option key={s}>{s}</option>)}
        </select>
        <span>共 {filtered.length} 条</span>
        <button type="button" data-testid="seal-close" onClick={() => onChange(null)}>收起</button>
      </div>
      <div className="bag-seal-slots">
        {Array.from({ length: rules.maxPerUnit }, (_, i) => current[i] ?? "").map((id, i) => {
          const s = id !== "" ? seals[id] : undefined;
          return (
            <span key={i} data-testid={`seal-slot-${i}`}
              onClick={() => { if (id !== "") onChange(current.filter((_, j) => j !== i)); setMsg(null); }}
              title={s !== undefined ? `${s.name} · ${s.type}${s.series !== undefined ? ` · ${s.series}` : ""} · ${sealStatText(s.stats)}（点击卸下）` : "空槽"}>
              {i + 1}. {s?.name ?? "空槽"}
            </span>
          );
        })}
        <span>相同≤{rules.maxIdentical} · 同系列≤{rules.maxPerSeries}</span>
        {msg !== null && <span data-testid="seal-err">{msg}</span>}
      </div>
      <div data-testid="seal-list">
        {filtered.slice(0, 80).map((s) => {
          const err = sealEquipError(meta, unit.name ?? unit.speciesId, current, s.id);
          return (
            <div key={s.id} data-testid={`seal-row-${s.id}`} onClick={() => equip(s.id)} style={{ opacity: err !== null ? 0.45 : 1 }}>
              <b>{s.name}</b>
              <span className="tchip" style={{ "--tc": SEAL_TYPE_COLOR[s.type] ?? "#8e8e93" } as any}>{s.type}</span>
              {s.series !== undefined && <span>[{s.series}]</span>}
              <span>{sealStatText(s.stats)}</span>
              {s.exclusive !== undefined && <span>专属:{s.exclusive}</span>}
            </div>
          );
        })}
        {filtered.length > 80 && <div>仅显示前 80 条，请用筛选缩小范围</div>}
        {filtered.length === 0 && <div>无匹配刻印</div>}
      </div>
    </div>
  );
}

function BagSkill({ moveId, armed, onPick, meta, testId }: {
  moveId: string | null; armed: boolean; onPick: () => void; meta: PackMeta; testId: string;
}) {
  const m = moveId !== null ? meta.moves[moveId] : undefined;
  const badge = moveId !== null ? moveBadge(meta, moveId) : null;
  const tc = m?.type !== undefined ? typeColor(m.type) : "#8e8e93";
  return (
    <button type="button" data-testid={testId} className={`skill${armed ? " bag-armed" : ""}`} style={{ "--tc": tc } as any} onClick={onPick}>
      <span className="s-row">
        <span className="s-type">{m?.type ?? "空"}</span>
        <span className="s-pow">{badge !== null ? <><small>威力</small><b className="num">{badge.power}</b></> : <small>{moveId === null ? "未携带" : "变化"}</small>}</span>
      </span>
      <span className="s-row"><span className="sname">{moveId === null ? "空技能" : zhMove(moveId, meta)}</span></span>
      <span className="s-row s-pp"><span className="sinfo"><small>次数 </small><b className="num">{m?.pp ?? "—"}/{m?.pp ?? "—"}</b></span></span>
      {m !== undefined && (
        <div className="tip">
          <div className="tt">{zhMove(moveId!, meta)}</div>
          {describeMove(m).map((line, i) => <div key={i} className="tl">{line}</div>)}
          <div className="tm">PP {m.pp ?? "?"}/{m.pp ?? "?"}</div>
        </div>
      )}
    </button>
  );
}

function FifthMark({ moveId, meta }: { moveId: string; meta: PackMeta }) {
  const m = meta.moves[moveId];
  const badge = moveBadge(meta, moveId);
  return (
    <div className="fifth" data-testid="carry-fifth" title="第五技能固定在独立槽，不能和四个普通技能互换">
      <span className="f-dial" style={{ "--p": "100%", "--a": "360deg" } as any}>
        <span className="f-ring" />
        <span className="f-cap start" />
        <span className="f-cap end" />
        <span className="f-core">
          <span className="fifth-tag">第五技能</span>
          <span className="sname">{zhMove(moveId, meta)}</span>
          {badge !== null && <span className="fpow"><small>威力</small><b className="num">{badge.power}</b></span>}
        </span>
      </span>
      <span className="fpp">次数 <b className="num">{m?.pp ?? "?"}/{m?.pp ?? "?"}</b></span>
      {m !== undefined && (
        <div className="tip">
          <div className="tt">{zhMove(moveId, meta)} · 第五技能</div>
          {describeMove(m).map((line, i) => <div key={i} className="tl">{line}</div>)}
        </div>
      )}
    </div>
  );
}

function PartySlot({ id, testId, lead, on, flag, onOpen, onLead, onRemove, leadTestId, outTestId, meta }: {
  id: string; testId: string; lead: boolean; on: boolean; flag: string;
  onOpen: () => void; onLead?: (() => void) | undefined; onRemove: () => void;
  leadTestId: string; outTestId: string;
  meta: PackMeta | null;
}) {
  const h = speciesHue(id);
  return (
    <div className="bag-slot-wrap">
      <button type="button" data-testid={testId}
        className={`pet bag-slot${lead ? " lead" : ""}${on ? " on" : ""}${!lead && !on ? " rest" : ""}`}
        onClick={onOpen}>
        <span className="pet-av" style={{ background: `radial-gradient(circle at 38% 30%, hsl(${h},78%,72%), hsl(${h},62%,42%))` }}>{id.slice(4, 5).toUpperCase()}</span>
        <span className="pet-name">{zhSpecies(id, meta)}</span>
        <span className="pet-flag">{flag}</span>
      </button>
      <span className="bag-slot-tools">
        {onLead !== undefined && <button type="button" data-testid={leadTestId} onClick={onLead}>设为首发</button>}
        <button type="button" data-testid={outTestId} onClick={onRemove}>移出</button>
      </span>
    </div>
  );
}

export function PetBag({
  pack, onPack, meta, team, onTeam, loadout, onLoadout, carried, onCarried,
  onStart, startLabel, busy, err, children, variant,
}: {
  pack: string;
  onPack: (packId: string) => void;
  meta: PackMeta | null;
  team: string[];
  onTeam: (team: string[]) => void;
  loadout: Record<string, string[]>;
  onLoadout: (next: Record<string, string[]>) => void;
  carried: Record<string, string[]>;
  onCarried: (next: Record<string, string[]>) => void;
  onStart: () => void;
  /** storage 变体不渲染开始按钮——label 仅签名保留 */
  startLabel: string;
  busy?: boolean;
  err?: string | null;
  children?: ReactNode;
  /** "storage" = 纯仓库：只留队伍格子 + 搜索/筛选/取放/分页（首页「仓库」入口） */
  variant?: "full" | "storage";
}) {
  const [view, setView] = useState<string | null>(null);
  const [tab, setTab] = useState<"info" | "stats" | "items" | "lore">("info");
  const [arm, setArm] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [swap, setSwap] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [typeSel, setTypeSel] = useState<string | null>(null); // 属性筛选（单选芯片——命中任一属性位即算）
  const [typeMode, setTypeMode] = useState<"all" | "mono" | "dual">("all"); // 单/双属性域
  const [page, setPage] = useState(0);
  const species = meta === null ? [] : Object.keys(meta.units).sort();
  // 属性芯片序：TYPE_COLOR 内置序优先，余者按 Unicode 排尾（与战斗端 typeColor 配色一致）
  const typeList = meta === null ? [] : [...new Set(Object.values(meta.units).flatMap((u) => u.types ?? []))].sort((a, b) => {
    const ia = Object.keys(TYPE_COLOR).indexOf(a), ib = Object.keys(TYPE_COLOR).indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a.localeCompare(b, "zh");
  });
  const PAGE_SIZE = 60;
  const filtered = species.filter((id) => {
    const query = q.trim();
    if (query !== "" && !zhSpecies(id, meta).includes(query) && !id.includes(query)) return false;
    const t = meta?.units[id]?.types ?? [];
    if (typeMode === "mono" && t.length !== 1) return false;
    if (typeMode === "dual" && t.length !== 2) return false;
    return typeSel === null || t.includes(typeSel);
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const curPage = Math.min(page, pageCount - 1); // 筛选收窄时钳位（不换页时页码越界兜底）
  const pageItems = filtered.slice(curPage * PAGE_SIZE, curPage * PAGE_SIZE + PAGE_SIZE);
  const shown = view !== null && team.includes(view) ? view : team[0];
  const unit = shown !== undefined && meta !== null ? meta.units[shown] : undefined;
  const slots = shown !== undefined && meta !== null ? carriedSlots(meta, carried, shown) : [null, null, null, null];

  const commit = (next: string[]) => {
    onTeam(next);
    const load = { ...loadout };
    const carry = { ...carried };
    let loadChanged = false;
    let carryChanged = false;
    for (const id of Object.keys(load)) {
      if (!next.includes(id)) { delete load[id]; loadChanged = true; }
    }
    for (const id of Object.keys(carry)) {
      if (!next.includes(id)) { delete carry[id]; carryChanged = true; }
    }
    if (loadChanged) onLoadout(load);
    if (carryChanged) onCarried(carry);
    if (pickerFor !== null && !next.includes(pickerFor)) setPickerFor(null);
  };

  const toggle = (id: string) => {
    if (team.includes(id)) {
      commit(bagToggle(team, id));
      setSwap(null);
      return;
    }
    if (team.length >= BAG_SIZE) { setSwap(id); return; }
    commit(bagAdd(team, id));
    setView(id);
    setTab("info");
    setSwap(null);
  };

  const addDup = (id: string) => {
    if (team.length >= BAG_SIZE) { setSwap(id); return; }
    commit(bagAdd(team, id));
    setView(id);
    setSwap(null);
  };

  const onSlot = (index: number) => {
    const id = team[index];
    if (swap !== null) {
      commit(id === undefined ? bagAdd(team, swap) : bagReplace(team, index, swap));
      setView(swap);
      setSwap(null);
      setTab("info");
      return;
    }
    if (id !== undefined) { setView(id); setTab("info"); }
  };

  const assign = (moveId: string) => {
    if (shown === undefined || meta === null) return;
    if (arm === null) { setNote("先点上面四个格子里的一格"); return; }
    const cur = carriedSlots(meta, carried, shown).map((s) => s ?? "");
    const from = cur.indexOf(moveId);
    const prev = cur[arm] ?? "";
    if (from === arm) { setNote(null); return; }
    cur[arm] = moveId;
    if (from >= 0) cur[from] = prev;
    onCarried({ ...carried, [shown]: cur });
    setNote(null);
  };

  const hue = shown !== undefined ? speciesHue(shown) : 210;
  const mark = unit?.soulMark !== undefined ? meta?.soulmarks?.[unit.soulMark] : undefined;
  const sealCur = shown !== undefined ? (loadout[shown] ?? []) : [];

  return (
    <div data-testid="team-builder" className="bag-shell">
      <div className="bag-head">
        <h1>{variant === "storage" ? "精灵仓库" : "精灵背包"}</h1>
        <p>出战 {BATTLE_SIZE} 只进战斗，待命 {BATTLE_SIZE} 只留在背包，一共 {BAG_SIZE} 只。移出出战位时，后面的精灵会往前补。第五技能不能和四个普通技能互换。</p>
      </div>
      {variant !== "storage" && <div className="bag-id">
        <label>规则包 <select data-testid="pack-select" value={pack} onChange={(e) => onPack(e.target.value)}>
          <option value="peak">巅峰常见</option>
        </select></label>
        {unit !== undefined && shown !== undefined && (
          <>
            <span className="pet-av" style={{ background: `radial-gradient(circle at 38% 30%, hsl(${hue},78%,72%), hsl(${hue},62%,42%))` }}>{shown.slice(4, 5).toUpperCase()}</span>
            <b>{zhSpecies(shown, meta)}</b>
            <span className="num">Lv.{unit.level ?? "—"}</span>
            {(unit.types ?? []).map((t) => <span key={t} className="tchip" style={{ "--tc": typeColor(t) } as any}>{t}</span>)}
            {unit.nature !== undefined && <span>性格 {unit.nature}</span>}
            <span className="num">{shown}</span>
          </>
        )}
        {unit === undefined && <span>从下方点选精灵编入，第 1 只是首发</span>}
      </div>}

      {variant !== "storage" && <div className="command-deck">
        <div className="fifth-slot">
          {unit?.fifthMoveId !== undefined && meta !== null && <FifthMark moveId={unit.fifthMoveId} meta={meta} />}
        </div>
        <div className="deck-stage">
          <div className={`move-grid pane${tab === "info" ? "" : " off"}`}>
            {meta !== null && slots.map((id, i) => (
              <BagSkill key={i} testId={`carry-${i}`} moveId={id} armed={arm === i} meta={meta} onPick={() => { setArm(i); setNote(null); }} />
            ))}
          </div>
          <div className={`bag-stats pane${tab === "stats" ? "" : " off"}`}>
            {meta === null ? <div className="bag-stat">载入中…</div>
              : unit?.stats !== undefined
              ? STATS.map((k) => {
                const v = unit.stats![k];
                const max = Math.max(...STATS.map((s) => unit.stats![s]), 1);
                return (
                  <div key={k} className="bag-stat"><span>{zhStat(k)}</span><span className="bag-bar"><i style={{ width: `${(v / max) * 100}%` }} /></span><b className="num">{v}</b></div>
                );
              })
              : <div className="bag-stat">这个规则包没有六维面板</div>}
            <div className="bag-stat bag-miss">天赋、学习力本内容包没有，不显示空数字</div>
          </div>
          <div className={`bag-pane pane${tab === "items" ? "" : " off"}`}>
            <div>刻印 {sealCur.length === 0 ? "未佩戴" : sealCur.map((id) => meta?.seals?.[id]?.name ?? id).join("、")}</div>
            {meta?.items === undefined
              ? <div>这个规则包没有战斗药剂。</div>
              : Object.values(meta.items).map((it) => (
                <div key={it.id}>{it.name} · 每场 {it.cap} 个 · {it.note}</div>
              ))}
          </div>
          <div className={`bag-pane pane${tab === "lore" ? "" : " off"}`}>
            {mark !== undefined
              ? <><b>{mark.name}</b><div>{mark.desc ?? "无描述"}</div></>
              : <div>无魂印。图鉴正文本内容包没有。</div>}
          </div>
        </div>
        <div className="cmd-grid">
          <button type="button" data-testid="bag-tab-info" className={`cmd${tab === "info" ? " on" : ""}`} onClick={() => setTab("info")}>信息</button>
          <button type="button" data-testid="bag-tab-stats" className={`cmd${tab === "stats" ? " on" : ""}`} onClick={() => setTab("stats")}>能力</button>
          <button type="button" data-testid="bag-tab-items" className={`cmd${tab === "items" ? " on" : ""}`} onClick={() => setTab("items")}>道具</button>
          <button type="button" data-testid="bag-tab-lore" className={`cmd${tab === "lore" ? " on" : ""}`} onClick={() => setTab("lore")}>资料</button>
        </div>
      </div>}

      {variant !== "storage" && tab === "info" && unit !== undefined && meta !== null && (
        <div className="bag-learn">
          <div className="bag-note">点一格普通技能，再点下面已学会的技能换上。第五技能不能换进来。{note !== null ? note : ""}</div>
          <div className="bag-learn-row">
            {(unit.moveIds ?? []).map((id) => {
              const on = slots.includes(id);
              return (
                <button type="button" key={id} data-testid={`learn-${id}`} className={`bag-learn-btn${on ? " on" : ""}`} onClick={() => assign(id)}>
                  <span className="tchip" style={{ "--tc": typeColor(meta.moves[id]?.type ?? "") } as any}>{meta.moves[id]?.type ?? "技"}</span>
                  {zhMove(id, meta)}{on ? " · 携带" : ""}
                </button>
              );
            })}
            {(unit.moveIds ?? []).length === 0 && <span>技能表还没载入</span>}
          </div>
        </div>
      )}

      {variant !== "storage" && tab === "items" && meta?.seals !== undefined && shown !== undefined && unit !== undefined && (
        <div className="bag-detail">
          <button type="button" data-testid={`seal-edit-${shown}`} className="pb-btn" onClick={() => setPickerFor(pickerFor === shown ? null : shown)}>
            {pickerFor === shown ? "收起图鉴" : "打开刻印图鉴"}
          </button>
          {pickerFor === shown && (
            <SealPicker meta={meta} unit={unit} current={sealCur} onChange={(next) => {
              if (next === null) { setPickerFor(null); return; }
              onLoadout({ ...loadout, [shown]: next });
            }} />
          )}
        </div>
      )}

      <div className="bag-party">
        <span className="bag-legend">橙框首发 · 绿框当前 · 蓝框其他 · 出战 {Math.min(team.length, BATTLE_SIZE)}/{BATTLE_SIZE} · 待命 {Math.max(0, team.length - BATTLE_SIZE)}/{BATTLE_SIZE}</span>
        {swap !== null && <div className="bag-swap" data-testid="swap-arm">背包已满。点一格替换成 {zhSpecies(swap, meta)}。</div>}
        <div className="bag-party-label">出战</div>
        <div className="bag-party-row">
          {Array.from({ length: BATTLE_SIZE }, (_, i) => {
            const id = team[i];
            if (id === undefined) {
              return <div key={i} className="pet bag-slot empty" data-testid={`party-empty-${i}`} onClick={() => onSlot(i)}>空位</div>;
            }
            return <PartySlot key={i} id={id} testId={`party-${i}`} lead={i === 0} on={id === shown}
              flag={i === 0 ? "首发" : "出战"}
              onOpen={() => onSlot(i)}
              onLead={i === 0 ? undefined : () => commit(bagMakeLead(team, i))}
              onRemove={() => commit(bagRemoveAt(team, i))}
              leadTestId={`party-lead-${i}`} outTestId={`party-out-${i}`} meta={meta} />;
          })}
        </div>
        <div className="bag-party-label">待命</div>
        <div className="bag-party-row">
          {Array.from({ length: BATTLE_SIZE }, (_, i) => {
            const index = BATTLE_SIZE + i;
            const id = team[index];
            if (id === undefined) {
              return <div key={i} className="pet bag-slot empty" data-testid={`party-standby-empty-${i}`} onClick={() => onSlot(index)}>空位</div>;
            }
            return <PartySlot key={i} id={id} testId={`party-standby-${i}`} lead={false} on={id === shown} flag="待命"
              onOpen={() => onSlot(index)}
              onLead={() => commit(bagMakeLead(team, index))}
              onRemove={() => commit(bagRemoveAt(team, index))}
              leadTestId={`party-standby-lead-${i}`} outTestId={`party-standby-out-${i}`} meta={meta} />;
          })}
        </div>
      </div>

      <div className="warehouse-bar">
        <span>仓库</span>
        <input data-testid="warehouse-q" placeholder="搜索名称" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
        <span>这个规则包里的精灵，不是全图鉴</span>
      </div>
      <div className="warehouse-filter">
        <span className="wf-modes">
          {(["all", "mono", "dual"] as const).map((m) => (
            <button key={m} type="button" data-testid={`wf-mode-${m}`}
              className={`wf-chip${typeMode === m && typeSel === null ? " on" : ""}`}
              onClick={() => { setTypeMode(m); setTypeSel(null); setPage(0); }}>
              {m === "all" ? "全部" : m === "mono" ? "单属性" : "双属性"}
            </button>
          ))}
        </span>
        <span className="wf-types">
          {typeList.map((t) => (
            <button key={t} type="button" data-testid={`wf-type-${t}`}
              className={`wf-chip${typeSel === t ? " on" : ""}`}
              style={typeSel === t ? { borderColor: typeColor(t), color: typeColor(t) } : undefined}
              onClick={() => { setTypeSel(typeSel === t ? null : t); setPage(0); }}>{t}</button>
          ))}
        </span>
      </div>
      <div className="bag-roster">
        {pageItems.map((id) => {
          const n = team.filter((x) => x === id).length;
          const h = speciesHue(id);
          return (
            <div key={id} className="bag-slot-wrap">
              <button type="button" data-testid={`pick-${id}`} className={`pickbtn pet${n > 0 ? " in" : ""}`} onClick={() => toggle(id)}>
                <span className="pet-av" style={{ background: `radial-gradient(circle at 38% 30%, hsl(${h},78%,72%), hsl(${h},62%,42%))` }}>{id.slice(4, 5).toUpperCase()}</span>
                <span className="pet-name">{zhSpecies(id, meta)}</span>
                <span className="pet-flag">{n === 0 ? "编入" : team[0] === id && n === 1 ? "首发" : `已带 ${n}`}</span>
              </button>
              <button type="button" data-testid={`warehouse-dup-${id}`} className="bag-mini" onClick={() => addDup(id)}>再带一只</button>
            </div>
          );
        })}
      </div>
      {pageCount > 1 && (
        <div className="bag-pager">
          <button type="button" data-testid="wf-prev" disabled={curPage === 0} onClick={() => setPage(curPage - 1)}>上一页</button>
          <span data-testid="wf-pageinfo">第 {curPage + 1}/{pageCount} 页 · 共 {filtered.length} 只</span>
          <button type="button" data-testid="wf-next" disabled={curPage >= pageCount - 1} onClick={() => setPage(curPage + 1)}>下一页</button>
        </div>
      )}

      <div className="bag-actions">
        <span>出战=[{team.slice(0, BATTLE_SIZE).join(", ") || "-"}] 待命=[{team.slice(BATTLE_SIZE).join(", ") || "-"}]</span>
        {variant !== "storage" && <button type="button" data-testid="btn-start" className="pb-btn primary" disabled={team.length === 0 || busy === true} onClick={onStart}>{startLabel}</button>}
        {children}
        {err != null && err !== "" && <span className="bag-err">{err}</span>}
      </div>
    </div>
  );
}

/** PetDetail —— 背包页：官方式三栏（培养信息 | 精灵展示 | 战斗信息）+ 底部队伍，战风样式。 */
export function PetDetail({
  pack, onPack, meta, team, onTeam, loadout, onLoadout, carried, onCarried, children,
}: {
  pack: string;
  onPack: (packId: string) => void;
  meta: PackMeta | null;
  team: string[];
  onTeam: (team: string[]) => void;
  loadout: Record<string, string[]>;
  onLoadout: (next: Record<string, string[]>) => void;
  carried: Record<string, string[]>;
  onCarried: (next: Record<string, string[]>) => void;
  children?: ReactNode;
}) {
  const [shown, setShown] = useState<string | null>(team[0] ?? null);
  const [arm, setArm] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [pane, setPane] = useState<"learn" | "seal" | null>(null);

  const commit = (next: string[]) => {
    onTeam(next);
    if (shown !== null && !next.includes(shown)) setShown(next[0] ?? null);
    if (next.length === 0) setArm(null);
  };
  const onSlot = (index: number) => {
    const id = team[index];
    setShown(id ?? team[0] ?? null);
    setArm(null); setNote(null);
  };
  const unit = shown !== null ? meta?.units[shown] : undefined;
  const mark = unit?.soulMark !== undefined ? meta?.soulmarks?.[unit.soulMark] : undefined;
  const slots = shown !== null && meta !== null ? carriedSlots(meta, carried, shown) : [null, null, null, null];
  const sealCur = shown !== null ? (loadout[shown] ?? []) : [];
  const hue = unit === undefined ? 0 : (parseInt(shown!.replace(/\D/g, "") || "0", 10) * 37) % 360;

  const assign = (moveId: string) => {
    if (shown === null || arm === null || meta === null) return;
    const cur = carriedSlots(meta, carried, shown).map((s) => s ?? "");
    if (cur.includes(moveId)) { setNote("这技能已在四格里"); return; }
    const next = [...cur];
    next[arm] = moveId;
    onCarried({ ...carried, [shown]: next });
    setArm(null); setNote(null);
  };

  const partyRow = (offset: number, flag: string, leadTest: string, outTest: string) => (
    <div className="bag-party-row">
      {Array.from({ length: BATTLE_SIZE }, (_, i) => {
        const index = offset + i;
        const id = team[index];
        if (id === undefined) {
          return <div key={i} className="pet bag-slot empty" data-testid={`pd-empty-${index}`}>空位</div>;
        }
        return <PartySlot key={i} id={id} testId={`pd-party-${index}`} lead={index === 0} on={id === shown}
          flag={index === 0 ? "首发" : flag}
          onOpen={() => onSlot(index)}
          onLead={index === 0 ? undefined : () => commit(bagMakeLead(team, index))}
          onRemove={() => commit(bagRemoveAt(team, index))}
          leadTestId={`${leadTest}-${i}`} outTestId={`${outTest}-${i}`} meta={meta} />;
      })}
    </div>
  );

  return (
    <div className="bag-shell pd-shell" data-testid="petbag" data-variant="detail">
      <div className="pd-top">
        <div className="pd-left">
          <div className="pd-panel-title">« 培养信息 »</div>
          <div className="pd-info-row"><span className="pd-ico">Lv</span><span className="pd-k">等级:</span>
            <span className="pd-bar"><i style={{ width: "100%" }} /></span><b className="num">{unit?.level ?? "—"}/100</b></div>
          <div className="pd-info-row"><span className="pd-ico">HP</span><span className="pd-k">体力上限:</span>
            <span className="pd-bar"><i style={{ width: "100%" }} /></span><b className="num">{unit?.stats?.hp ?? "—"}/{unit?.stats?.hp ?? "—"}</b></div>
          <div className="pd-info-row"><span className="pd-ico">性</span><span className="pd-k">性格:</span>
            <b>{unit?.nature ?? "—"}</b></div>
          <div className="pd-info-row"><span className="pd-ico">特</span><span className="pd-k">特性:</span>
            <b>{mark?.name ?? (unit?.soulMark ? "魂印" : "无")}</b>{mark !== undefined && <span className="pd-stars">★★★★★</span>}</div>
          <div className="pd-info-row"><span className="pd-ico">赋</span><span className="pd-k">天赋 / 学习力:</span>
            <span className="pd-miss">—（本包未建模）</span></div>
          <div className="pd-info-row"><span className="pd-ico">属</span><span className="pd-k">属性:</span>
            {(unit?.types ?? []).map((t) => <span key={t} className="tchip" style={{ "--tc": typeColor(t) } as any}>{t}</span>)}
            {(unit?.types ?? []).length === 0 && <span className="pd-miss">—</span>}</div>
        </div>

        <div className="pd-mid">
          <div className="pd-banner"><span className="pd-lv">Lv.{unit?.level ?? "—"}</span><b>{shown !== null ? zhSpecies(shown, meta) : "未选择"}</b></div>
          <div className="pd-hero">
            <span className="pet-av pd-av" style={{ background: `radial-gradient(circle at 38% 30%, hsl(${hue},78%,72%), hsl(${hue},62%,42%))` }}>{shown !== null ? zhSpecies(shown, meta).slice(0, 1) : "?"}</span>
          </div>
        </div>

        <div className="pd-right">
          <div className="pd-panel-title">« 战斗信息 »</div>
          <div className="pd-stats">
            {meta === null ? <div className="bag-stat">载入中…</div>
              : unit?.stats !== undefined
              ? STATS.map((k) => {
                const v = unit.stats![k];
                const max = Math.max(...STATS.map((s) => unit.stats![s]), 1);
                return (
                  <div key={k} className="bag-stat"><span>{zhStat(k)}</span><span className="bag-bar"><i style={{ width: `${(v / max) * 100}%` }} /></span><b className="num">{v}</b></div>
                );
              })
              : <div className="bag-stat">这个规则包没有六维面板</div>}
          </div>
        </div>

        <div className="pd-side">{children}</div>
      </div>

      <div className="pd-skills">
        {meta !== null && slots.map((id, i) => (
          <BagSkill key={i} testId={`pd-carry-${i}`} moveId={id} armed={arm === i} meta={meta} onPick={() => { setArm(i); setPane("learn"); setNote(null); }} />
        ))}
        {unit?.fifthMoveId !== undefined && meta !== null && <FifthMark moveId={unit.fifthMoveId} meta={meta} />}
        <span className="pd-skill-actions">
          <button type="button" data-testid="pd-toggle-learn" className="pb-btn" disabled={shown === null}
            onClick={() => setPane(pane === "learn" ? null : "learn")}>更换技能</button>
          <button type="button" data-testid="pd-toggle-seal" className="pb-btn" disabled={shown === null || meta?.seals === undefined}
            onClick={() => { setPane(pane === "seal" ? null : "seal"); setPickerFor(shown); }}>刻印中心</button>
        </span>
      </div>

      {pane === "learn" && unit !== undefined && meta !== null && (
        <div className="bag-learn">
          <div className="bag-note">点一格普通技能，再点下面已学会的技能换上。第五技能不能换进来。{note !== null ? note : ""}</div>
          <div className="bag-learn-row">
            {(unit.moveIds ?? []).map((id) => {
              const on = slots.includes(id);
              return (
                <button type="button" key={id} data-testid={`learn-${id}`} className={`bag-learn-btn${on ? " on" : ""}`} onClick={() => assign(id)}>
                  <span className="tchip" style={{ "--tc": typeColor(meta.moves[id]?.type ?? "") } as any}>{meta.moves[id]?.type ?? "技"}</span>
                  {zhMove(id, meta)}{on ? " · 携带" : ""}
                </button>
              );
            })}
      
            {(unit.moveIds ?? []).length === 0 && <span>技能表还没载入</span>}
          </div>
        </div>
      )}

      {pane === "seal" && shown !== null && unit !== undefined && meta?.seals !== undefined && (
        <div className="bag-detail">
          {pickerFor === shown && (
            <SealPicker meta={meta} unit={unit} current={sealCur} onChange={(next) => {
              if (next === null) { setPickerFor(null); setPane(null); return; }
              onLoadout({ ...loadout, [shown]: next });
            }} />
          )}
        </div>
      )}

      <div className="bag-party">
        <span className="bag-legend">橙框首发 · 绿框当前 · 蓝框其他 · 出战 {Math.min(team.length, BATTLE_SIZE)}/{BATTLE_SIZE} · 待命 {Math.max(0, team.length - BATTLE_SIZE)}/{BATTLE_SIZE}</span>
        <div className="bag-party-label">出战精灵</div>
        {partyRow(0, "出战", "pd-lead", "pd-out")}
        <div className="bag-party-label">待命精灵</div>
        {partyRow(BATTLE_SIZE, "待命", "pd-standby-lead", "pd-standby-out")}
      </div>
    </div>
  );
}
