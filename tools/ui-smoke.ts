/**
 * ui-smoke.ts —— Phase 1：全链路浏览器冒烟。
 * 大厅→编队→PVE 战局→打到终局→再来一局→世界闭环（存档/跑图/挑战/认输/领奖/回世界）。
 * 每步断言 testid 可见 + 截图留 artifacts/ui-check/。
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.UI_BASE ?? "http://127.0.0.1:8787";
const SHOTS = "artifacts/ui-check";
mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const results: string[] = [];
async function step(name: string, fn: () => Promise<void>) {
  try { await fn(); pass++; results.push(`PASS ${name}`); console.log(`  ✓ ${name}`); }
  catch (e) { fail++; results.push(`FAIL ${name} — ${String(e).split("\n")[0]}`); console.log(`  ✗ ${name}: ${String(e).split("\n")[0]}`); }
}
const vis = async (page: any, tid: string, ms = 8000) => {
  const el = page.getByTestId(tid);
  await el.waitFor({ state: "visible", timeout: ms });
  return el;
};

const browser = await chromium.launch();
const page = await browser.newPage();
page.setDefaultTimeout(8000);
page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") console.log(`  [console.error] ${m.text().slice(0, 120)}`); });

// ── 大厅 → 编队 → 开战 ─────────────────────────────
await step("大厅加载+精灵列表", async () => {
  await page.goto(BASE);
  await vis(page, "team-builder");
  await vis(page, "pick-syn-gamma");
  await page.screenshot({ path: `${SHOTS}/01-lobby.png` });
});
await step("编队→开始对战→进入战局", async () => {
  await page.getByTestId("pick-syn-gamma").click();
  await page.getByTestId("pick-syn-delta").click();
  await page.getByTestId("pick-syn-epsilon").click();
  await page.getByTestId("btn-start").click();
  await page.waitForURL(/battle=btl_/, { timeout: 8000 });
  await vis(page, "ucard-own");
  await vis(page, "pixi-canvas");
  await vis(page, "battle-log");
  await page.screenshot({ path: `${SHOTS}/02-battle.png` });
});
await step("连续出招打到终局", async () => {
  let nulls = 0;
  for (let i = 0; i < 120; i++) {
    if (await page.getByTestId("result-banner").isVisible().catch(() => false)) return;
    if (await page.getByTestId("replacement-banner").isVisible().catch(() => false)) {
      const sw = page.locator("[data-testid^='btn-act_switch-']").first();
      if (await sw.isEnabled().catch(() => false)) {
        console.log(`    [t${i}] switch`);
        await sw.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(200);
        continue;
      }
    }
    const mv = page.locator("button.skill:not(.switch)").first(); // 技能/挣扎钮（换人钮是 .skill.switch，撤退是 .warn）
    const tid = await mv.getAttribute("data-testid").catch(() => null);
    const en = await mv.isEnabled().catch(() => false);
    console.log(`    [t${i}] btn=${tid} enabled=${en}`);
    if (tid !== null && en) {
      nulls = 0;
      await mv.click({ timeout: 3000 }).catch((e) => console.log(`    [t${i}] click fail ${String(e).split("\n")[0]}`));
      await page.waitForTimeout(150);
      continue;
    }
    // 无可点技能——诊断：dump 权威 obs（terminal/decision/legalActions）+ 截图
    if (++nulls === 3) {
      const u = new URL(page.url());
      const o = await fetch(`${BASE}/api/battle/${u.searchParams.get("battle")}/observe?player=${u.searchParams.get("player")}`).then((r) => r.json()) as any;
      const legal = Array.isArray(o.legalActions) ? o.legalActions.map((a: any) => `${a.actionId}:${a.action?.kind}`).join(",") : "(none)";
      console.log(`    [t${i}] STALL obs: terminal=${JSON.stringify(o.terminal)} decision=${JSON.stringify(o.decision)} legal=[${legal}]`);
      if (o.terminal !== null) return; // 已终局（横幅渲染可能滞后一拍）——交给下一步验横幅
      console.log(`    [t${i}] DOM skills=${await page.locator("button.skill").count()} banner=${await page.getByTestId("result-banner").count()} repl=${await page.getByTestId("replacement-banner").count()}`);
      await page.screenshot({ path: `${SHOTS}/stall.png` });
    }
    await page.waitForTimeout(300);
  }
  throw new Error("120 回合未终局");
});
await step("终局横幅+再来一局回大厅", async () => {
  await vis(page, "result-banner");
  await page.screenshot({ path: `${SHOTS}/03-terminal.png` });
  await page.getByTestId("back-lobby").locator("button").click();
  await page.waitForURL(/\/$/, { timeout: 8000 });
  await vis(page, "team-builder");
});

// ── 世界闭环 ──────────────────────────────────────
await step("进世界→会话→地图", async () => {
  await page.goto(`${BASE}/?world=1`);
  await page.getByTestId("player-id").fill("wpl_smoke");
  await page.getByTestId("btn-enter").click();
  await vis(page, "world-map");
  await vis(page, "world-profile");
  await page.screenshot({ path: `${SHOTS}/04-world.png` });
});
await step("存档队伍", async () => {
  await page.getByTestId("pick-syn-gamma").click();
  await page.getByTestId("pick-syn-delta").click();
  await page.getByTestId("btn-save-team").click();
  await page.waitForTimeout(400);
  await vis(page, "load-main");
});
await step("跑图到斗技场（town→route-1→route-2→arena）", async () => {
  for (const n of ["route-1", "route-2", "arena"]) {
    await page.getByTestId(`node-${n}`).click();
    await page.waitForTimeout(250);
  }
});
await step("挑战守擂队→进入 PVE 战局", async () => {
  await page.getByTestId("act-challenge").click();
  await page.waitForURL(/battle=btl_.*wpl=wpl_smoke/, { timeout: 8000 });
  await vis(page, "ucard-own");
});
await step("认输→终局面板出现领奖", async () => {
  await page.getByTestId("btn-act_concede").click();
  await vis(page, "result-banner", 10000);
  await vis(page, "post-battle");
  await page.screenshot({ path: `${SHOTS}/05-worldbattle-terminal.png` });
});
await step("领奖→重放不重复入账", async () => {
  await page.getByTestId("btn-claim").click();
  await page.waitForTimeout(400);
  const t1 = await page.getByTestId("claim-reward").textContent();
  if (!t1?.includes("已入账")) throw new Error(`首次领奖未入账: ${t1}`);
  await page.getByTestId("btn-claim").click();
  await page.waitForTimeout(400);
  const t2 = await page.getByTestId("claim-reward").textContent();
  if (!t2?.includes("回执重放")) throw new Error(`重复领奖未见重放提示: ${t2}`);
});
await step("返回世界→背包有入账", async () => {
  await page.getByTestId("back-world").locator("button").click();
  await page.waitForURL(/wpl=wpl_smoke/, { timeout: 8000 });
  await vis(page, "world-profile");
  await page.waitForTimeout(500);
  const prof = await page.getByTestId("world-profile").textContent();
  if (!prof?.includes("item-")) throw new Error(`背包未见入账: ${prof}`);
  await page.screenshot({ path: `${SHOTS}/06-back-world.png` });
});

await browser.close();
console.log(`\n══ Phase1 冒烟: ${pass} pass / ${fail} fail ══`);
if (fail > 0) process.exit(1);
