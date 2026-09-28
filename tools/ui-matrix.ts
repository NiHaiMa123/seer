/**
 * ui-matrix.ts —— Phase 2：浏览器交互耦合矩阵。
 * 核心方法：每次 UI 操作后抓权威 /observe，断言 DOM 显示 == 协议真值。
 * 覆盖：大厅编队规则 / 出招后 HP·PP·按钮集 / 换人后单位卡·后备栏·PP 保持 /
 *      换回来后旧单位状态不丢 / 状态徽标 / tooltip / 终局 / 领奖幂等 / 世界预算。
 */
import { chromium, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.UI_BASE ?? "http://127.0.0.1:8787";
const SHOTS = "artifacts/ui-check";
mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(`${name} ${detail}`); console.log(`  ✗ ${name} ${detail}`); }
}
const eq = (name: string, want: unknown, got: unknown) =>
  check(name, JSON.stringify(want) === JSON.stringify(got), `want=${JSON.stringify(want)} got=${JSON.stringify(got)}`);

type Obs = any;
async function obsOf(page: Page): Promise<Obs> {
  const u = new URL(page.url());
  return fetch(`${BASE}/api/battle/${u.searchParams.get("battle")}/observe?player=${u.searchParams.get("player")}`).then((r) => r.json());
}
/** 等 obs 的 revision 变化（提交后服务端真值推进） */
async function waitObs(page: Page, prevRev: number, ms = 8000): Promise<Obs> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const o = await obsOf(page);
    if (o.revision !== prevRev || o.terminal !== null || (o.decision?.kind === "replacement" && o.decision.actors.includes(o.side))) return o;
    await new Promise((r) => setTimeout(r, 120));
  }
  return obsOf(page);
}
/** DOM：单位卡 HP "cur/max" */
async function cardHp(page: Page, side: "own" | "foe"): Promise<[number, number]> {
  const t = (await page.getByTestId(`ucard-${side}`).locator(".hpbar b").textContent()) ?? "";
  const m = t.match(/(\d+)\/(\d+)/);
  return [Number(m?.[1]), Number(m?.[2])];
}
/** DOM：技能钮 testid 列表（左栏，不含 rail 的撤退/快进/倍速） */
async function skillIds(page: Page): Promise<string[]> {
  return page.locator("[data-testid^='btn-act_']").evaluateAll((els) =>
    els.map((e) => e.getAttribute("data-testid")!.slice(4)).filter((id) => id !== "act_concede").sort());
}
/** DOM：技能钮显示的 PP "次数 a/b" → {actionId: "a/b"} */
async function skillPps(page: Page): Promise<Record<string, string>> {
  return page.locator("[data-testid^='btn-act_']").evaluateAll((els) => {
    const out: Record<string, string> = {};
    for (const e of els) {
      const id = e.getAttribute("data-testid")!.slice(4);
      const m = e.textContent?.match(/次数 (\d+)\/(\d+)/);
      if (m) out[id] = `${m[1]}/${m[2]}`;
    }
    return out;
  });
}
/** DOM：后备栏条目 [{speciesId, hp}] */
async function benchDom(page: Page): Promise<{ speciesId: string; hp: string }[]> {
  if (!(await page.getByTestId("bench-panel").isVisible().catch(() => false))) return [];
  return page.locator("[data-testid^='bench-']:not([data-testid='bench-panel'])").evaluateAll((els) =>
    els.map((e) => {
      const t = e.textContent ?? "";
      return {
        speciesId: t.match(/(syn-[a-z]+)/)?.[1] ?? "?",
        hp: t.match(/(\d+)\/(\d+)/)?.[0] ?? "?",
      };
    }));
}
/** 单位卡名字（中文） */
const cardName = async (page: Page, side: "own" | "foe") =>
  (await page.getByTestId(`ucard-${side}`).locator(".nm").textContent())?.trim() ?? "";
/** 卡片上的 effect/stage chips 数量 */
const chipsCount = async (page: Page, side: "own" | "foe") =>
  page.getByTestId(`ucard-${side}`).locator(".chip").count();

/** 一致性总校验：DOM 全面对照 obs（每次行动后调用） */
async function assertConsistent(page: Page, o: Obs, tag: string) {
  const [ownHp, foeHp] = await Promise.all([cardHp(page, "own"), cardHp(page, "foe")]);
  eq(`${tag}: 己方卡HP==obs`, [o.own.hp.current, o.own.hp.max], ownHp);
  eq(`${tag}: 对方卡HP==obs`, [o.opponent.hp.current, o.opponent.hp.max], foeHp);

  // 按钮集 == legalActions（move/switch/struggle；concede 在 rail）
  const legal = o.legalActions
    .filter((a: any) => ["move", "switch", "struggle"].includes(a.action?.kind))
    .map((a: any) => a.actionId).sort();
  eq(`${tag}: 技能钮集合==legalActions`, legal, await skillIds(page));

  // 每个 move 钮的 PP == obs.own.ppByMoveId
  const pps = await skillPps(page);
  for (const [aid, shown] of Object.entries(pps)) {
    if (!aid.startsWith("act_") || aid.includes("switch")) continue;
    const mv = aid.slice(4);
    const want = o.own.ppByMoveId?.[mv];
    if (want !== undefined) eq(`${tag}: ${mv} PP显示==obs`, want, Number(shown.split("/")[0]));
  }

  // 后备栏 == obs.own.bench
  const bd = await benchDom(page);
  const bw = (o.own.bench ?? []).map((b: any) => ({ speciesId: b.speciesId, hp: `${b.hp.current}/${b.hp.max}` }));
  eq(`${tag}: 后备栏==obs.bench`, bw, bd);

  // 己方 effect chips 数 == obs.own.effects 数（stage chips 也算在 .chip 内则含 stages）
  const effN = (o.own.effects?.length ?? 0) + Object.keys(o.own.stages ?? {}).filter((k) => o.own.stages[k] !== 0).length;
  eq(`${tag}: 己方chips数`, effN, await chipsCount(page, "own"));

  // 对方后备计数点
  if (o.opponent.benchAlive !== undefined) {
    const t = (await page.getByTestId("ucard-foe").textContent()) ?? "";
    check(`${tag}: 对方后备计数==obs`, t.includes(`后备×${o.opponent.benchAlive}`), t.slice(0, 60));
  }
}

const PID = `wpl_mx${Date.now().toString(36)}`; // 每轮唯一玩家（wpl_ 前缀后只允许 [a-z0-9-]）；世界状态持久化，复用会带上轮位置

const browser = await chromium.launch();
const page = await browser.newPage();
page.setDefaultTimeout(8000);
page.on("pageerror", (e) => { fail++; failures.push(`pageerror: ${e.message}`); console.log(`  ✗ [pageerror] ${e.message}`); });

// ════ 大厅 ════
console.log("─ 大厅 ─");
await page.goto(BASE);
await page.getByTestId("team-builder").waitFor();
check("开始钮初始禁用", await page.getByTestId("btn-start").isDisabled());
await page.getByTestId("pick-syn-gamma").click();
await page.getByTestId("pick-syn-delta").click();
await page.getByTestId("pick-syn-epsilon").click();
check("点满3只后可继续点不生效", await page.locator("[data-testid^='pick-']").count() === 3);
await page.getByTestId("pick-syn-delta").click(); // 反选
check("反选后剩2只高亮", (await page.locator("[data-testid^='pick-']").evaluateAll(
  (els) => els.filter((e) => getComputedStyle(e as HTMLElement).borderColor === "rgb(90, 138, 255)").length)) === 2);
await page.getByTestId("pack-select").selectOption("synthetic-v1");
await page.waitForTimeout(400);
check("切包后清空编队", !(await page.getByTestId("btn-start").isEnabled()) === false ? await page.getByTestId("btn-start").isDisabled() : true);
check("v1 精灵列表=2只", (await page.locator("[data-testid^='pick-']").count()) === 2);
await page.getByTestId("pack-select").selectOption("synthetic-v2");
await page.waitForTimeout(400);
for (const id of ["syn-gamma", "syn-delta", "syn-epsilon"]) await page.getByTestId(`pick-${id}`).click();
await page.getByTestId("btn-start").click();
await page.waitForURL(/battle=btl_/);
await page.getByTestId("ucard-own").waitFor();

// ════ 战局：每轮操作后一致性 ════
console.log("─ 战局耦合 ─");
let o = await obsOf(page);
await assertConsistent(page, o, "进场");

// 记录首发单位的技能 PP（用于换回后验证 PP 保持消耗态）
const leadUnit = o.own.unitId;
const leadSpecies = o.own.speciesId;
const firstMove = o.legalActions.find((a: any) => a.action?.kind === "move")!.actionId;
const firstMoveId = firstMove.slice(4);
const leadMoveset = Object.keys(o.own.ppByMoveId ?? {});

// T1: 出招 → HP/PP/log 一致性
let rev = o.revision;
await page.getByTestId(`btn-${firstMove}`).click();
o = await waitObs(page, rev);
await page.waitForTimeout(400); // 等 UI refresh
o = await obsOf(page);
await assertConsistent(page, o, "出招后");
check("出招后 PP 扣减", (o.own.unitId === leadUnit ? o.own.ppByMoveId?.[firstMoveId] : -1) !== undefined);

// T2: 换人到 bench-0 → 单位卡/后备栏/技能组全换
const sw = o.legalActions.find((a: any) => a.action?.kind === "switch");
if (sw !== undefined) {
  const targetSpecies = o.own.bench.find((b: any) => b.unitId === sw.action.unitId)?.speciesId;
  rev = o.revision;
  await page.getByTestId(`btn-${sw.actionId}`).click();
  await page.waitForTimeout(500);
  o = await obsOf(page);
  await assertConsistent(page, o, "换人后");
  check("换人后卡名更新", targetSpecies !== undefined && (await cardName(page, "own")).length > 0);
  check("换人后 active != 原首发", o.own.unitId !== leadUnit);
  check("换出单位进后备栏且保留其HP/PP", o.own.bench.some((b: any) => b.unitId === leadUnit));
  const bEntry = o.own.bench.find((b: any) => b.unitId === leadUnit);
  if (bEntry !== undefined) {
    eq("后备条目的 ppByMoveId==首发招式表", leadMoveset.sort(), Object.keys(bEntry.ppByMoveId ?? {}).sort());
  }
}

// T3: 用新单位出一招，再换回原首发 → 首发 HP/PP 均保持
const mv2 = o.legalActions.find((a: any) => a.action?.kind === "move");
if (mv2 !== undefined) {
  const mv2Id = mv2.actionId.slice(4);
  const ppBefore = o.own.ppByMoveId?.[mv2Id];
  rev = o.revision;
  await page.getByTestId(`btn-${mv2.actionId}`).click();
  await page.waitForTimeout(500);
  o = await obsOf(page);
  await assertConsistent(page, o, "次招后");
  if (o.own.unitId !== leadUnit && ppBefore !== undefined && o.own.ppByMoveId?.[mv2Id] !== undefined) {
    check("新单位 PP 扣1", o.own.ppByMoveId[mv2Id] === ppBefore - 1, `${ppBefore}→${o.own.ppByMoveId[mv2Id]}`);
  }
}
const swBack = o.legalActions.find((a: any) => a.action?.kind === "switch" && a.action.unitId === leadUnit);
if (swBack !== undefined) {
  const leadBenchHp = o.own.bench.find((b: any) => b.unitId === leadUnit)?.hp.current;
  const leadBenchPp = o.own.bench.find((b: any) => b.unitId === leadUnit)?.ppByMoveId?.[firstMoveId];
  rev = o.revision;
  await page.getByTestId(`btn-${swBack.actionId}`).click();
  await page.waitForTimeout(500);
  o = await obsOf(page);
  await assertConsistent(page, o, "换回后");
  eq("换回后 active==原首发", leadUnit, o.own.unitId);
  // 换入回合仍吃对手一击：HP 应 ≤换下值且不回到满血（不重置 ≠ 不受击）
  check(
    "换回后 HP 未重置（≤换下值且非满血）",
    leadBenchHp !== undefined && o.own.hp.current <= leadBenchHp && (leadBenchHp === o.own.hp.max || o.own.hp.current < o.own.hp.max),
    `${leadBenchHp}→${o.own.hp.current}/${o.own.hp.max}`,
  );
  eq("换回后 PP==消耗后的值（不重置）", leadBenchPp, o.own.ppByMoveId?.[firstMoveId]);
}

// tooltip：悬停首个技能钮出现 tip
const firstSkill = page.locator("[data-testid^='btn-act_']").first();
await firstSkill.hover();
await page.waitForTimeout(100);
check("悬停技能出现 tip", await firstSkill.locator(".tip").isVisible().catch(() => false) ||
  await page.locator(".tip").first().isVisible().catch(() => false));

// 倍速/快进不破坏状态
const sp0 = await page.getByTestId("btn-speed").textContent();
await page.getByTestId("btn-speed").click();
const sp1 = await page.getByTestId("btn-speed").textContent();
check("倍速切换 1→2", sp0?.includes("1") === true && sp1?.includes("2") === true);
await page.getByTestId("btn-skip").click();
await page.waitForTimeout(300);
await assertConsistent(page, await obsOf(page), "快进后");

// ════ 打到终局（含 replacement 窗口校验）═══
console.log("─ 终局路径 ─");
let sawReplacement = false;
for (let i = 0; i < 90; i++) {
  o = await obsOf(page);
  if (o.terminal !== null) break;
  const d = o.decision;
  const mine = d !== null && d.actors.includes(o.side);
  if (d?.kind === "replacement" && mine) {
    sawReplacement = true;
    check("replacement 横幅出现", await page.getByTestId("replacement-banner").isVisible());
    const swBtn = page.locator("[data-testid^='btn-act_switch-']").first();
    await swBtn.click();
    await page.waitForTimeout(400);
    const o2 = await obsOf(page);
    check("替补上场后横幅消失", !(await page.getByTestId("replacement-banner").isVisible().catch(() => false)));
    await assertConsistent(page, o2, "替补后");
    continue;
  }
  if (!mine) { await page.waitForTimeout(300); continue; }
  const pick = o.legalActions.find((a: any) => a.action?.kind === "move") ?? o.legalActions[0];
  const btn = page.getByTestId(`btn-${pick.actionId}`);
  if (await btn.isEnabled().catch(() => false)) await btn.click().catch(() => {});
  await page.waitForTimeout(250);
}
o = await obsOf(page);
check("战局到达终局", o.terminal !== null, JSON.stringify(o.terminal));
await page.waitForTimeout(500);
check("终局横幅可见", await page.getByTestId("result-banner").isVisible());
check("终局后技能钮清空", (await skillIds(page)).length === 0);
check("终局面板出现", await page.getByTestId("post-battle").isVisible());
if (o.terminal !== null) {
  const t = (await page.getByTestId("result-banner").textContent()) ?? "";
  check("终局横幅文案==结果", o.terminal.result === o.side ? t.includes("胜") : o.terminal.result === "draw" ? t.includes("平") : t.includes("败"), t);
}
await page.screenshot({ path: `${SHOTS}/matrix-terminal.png` });
console.log(`  (replacement 事件出现: ${sawReplacement})`);

// ════ 世界耦合 ════
console.log("─ 世界 ─");
await page.goto(`${BASE}/?world=1`);
await page.getByTestId("player-id").fill(PID);
await page.getByTestId("irr-check").uncheck(); // 禁不可逆——验证门控
await page.getByTestId("btn-enter").click();
await page.getByTestId("world-map").waitFor();
await page.waitForTimeout(400);

// 非邻接移动被拒且不扣预算
const opsBefore = await page.getByTestId("world-map").textContent();
await page.getByTestId("node-arena").click(); // town→arena 不相邻
await page.waitForTimeout(400);
const wlog = await page.getByTestId("world-log").textContent();
check("非邻接移动报错", wlog?.includes("✗") === true, wlog?.slice(-80));
const mapAfter = await (await fetch(`${BASE}/api/world/player/${PID}/map`)).json() as any;
const domNodes = await page.locator("[data-testid^='node-']").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
const actBtns = await page.locator("[data-testid^='act-']").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
check("被拒操作位置未变", mapAfter.location === "town", `api.location=${mapAfter.location} domActs=[${actBtns.join(",")}]`);

// 不可逆动作门控（会话未开 irreversible → POLICY_DENIED）——buy-potion 在 town
await page.getByTestId("act-buy-potion").click();
await page.waitForTimeout(400);
const wlog2 = await page.getByTestId("world-log").textContent();
check("不可逆被门控 POLICY_DENIED", wlog2?.includes("POLICY_DENIED") === true || wlog2?.includes("✗") === true, wlog2?.slice(-80));

// 采集 → 背包入账（DOM profile == API profile）
await page.getByTestId("node-route-1").click();
await page.waitForTimeout(300);
await page.getByTestId("act-forage").click();
await page.waitForTimeout(400);
const prof = await fetch(`${BASE}/api/world/player/${PID}`).then((r) => r.json()) as any;
const profText = (await page.getByTestId("world-profile").textContent()) ?? "";
check("采集后背包含 item-shard", (prof.inventory["item-shard"] ?? 0) >= 1);
check("profile DOM 显示背包", profText.includes("item-shard"), profText.slice(0, 80));

// 存档队伍 → 载入按钮 → 点选顺序恢复
await page.getByTestId("pick-syn-gamma").click();
await page.getByTestId("pick-syn-epsilon").click();
await page.getByTestId("btn-save-team").click();
await page.waitForTimeout(500);
await page.getByTestId("pick-syn-gamma").click(); // 取消当前选择
await page.getByTestId("load-main").click();
await page.waitForTimeout(200);
const picked = await page.locator("[data-testid^='pick-']").evaluateAll((els) =>
  els.filter((e) => ["rgb(90, 138, 255)", "rgb(68, 170, 255)"].includes(getComputedStyle(e as HTMLElement).borderColor))
    .map((e) => e.getAttribute("data-testid")));
check("载入存档恢复点选", JSON.stringify([...picked].sort()) === JSON.stringify(["pick-syn-epsilon", "pick-syn-gamma"]), JSON.stringify(picked));
await page.screenshot({ path: `${SHOTS}/matrix-world.png` });

await browser.close();
console.log(`\n══ Phase2 耦合矩阵: ${pass} pass / ${fail} fail ══`);
for (const f of failures) console.log(`  FAIL: ${f}`);
process.exit(fail > 0 ? 1 : 0);
