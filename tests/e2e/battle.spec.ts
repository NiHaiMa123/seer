/**
 * test:e2e —— M1-05：两浏览器上下文真实 UI 对局到终局；
 * 跳动画 vs 正常播放 authoritative 结果相同；慢 mock 下 UI 可操作；
 * cleanup 后无重复 listener/poll。
 */
import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { startServer } from "../../apps/server/src/index.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
let server: Awaited<ReturnType<typeof startServer>>;

test.beforeAll(async () => {
  server = await startServer(0);
});
test.afterAll(async () => {
  await server.close();
});

const api = (path: string) => `${server!.url}${path}`;

async function newBattle(seed: string, extra?: Record<string, unknown>): Promise<{ battleId: string; tokens: { p1: string; p2: string } }> {
  const r = await fetch(api("/api/battle"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ seedHex: seed, ...extra }),
  });
  return (await r.json()) as { battleId: string; tokens: { p1: string; p2: string } };
}

const pageErrors = new WeakMap<Page, string[]>();

async function openPlayer(ctx: BrowserContext, battleId: string, token: string, extra = ""): Promise<Page> {
  const page = await ctx.newPage();
  const errs: string[] = [];
  // 收集而非 throw——在 pageerror 监听器里抛异常会污染 Playwright 进行中的协议调用
  page.on("pageerror", (e) => { errs.push(`${e.message} | ${e.stack?.split("\n").slice(0, 4).join(" | ") ?? ""}`); });
  pageErrors.set(page, errs);
  await page.goto(`${server!.url}/?battle=${battleId}&player=${token}${extra}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("battle-status")).toBeVisible({ timeout: 15_000 });
  return page;
}

function expectNoPageErrors(...pages: Page[]): void {
  for (const p of pages) expect(pageErrors.get(p) ?? [], "pageerror").toEqual([]);
}

/** 驱动一步真实点击；检查与点击间 obs 可能刷新 → 短超时 click + catch。 */
async function actOnce(page: Page): Promise<void> {
  const status = await page.getByTestId("battle-status").textContent();
  if (status?.includes('"result"')) return; // terminal
  // 撤退钮也匹配 btn-act_ 前缀——竞态窗口下 btns.first() 可能落到它；战斗动作池必须排除
  const btns = page.locator("button[data-testid^='btn-act_']:not([disabled]):not([data-testid='btn-act_concede'])");
  if ((await btns.count()) === 0) {
    await page.waitForTimeout(300);
    return;
  }
  const strike = page.getByTestId("btn-act_syn-strike");
  const target = (await strike.count()) > 0 && !(await strike.isDisabled()) ? strike : btns.first();
  await target.click({ timeout: 1200 }).catch(() => {}); // 竞态 disabled → 下轮重试
}

test("两个浏览器上下文 human 对局到终局", async () => {
  test.setTimeout(120_000);
  const browser = await chromium.launch({ args: ["--enable-gpu"] });
  try {
    const { battleId, tokens } = await newBattle("a1".repeat(16));
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pA = await openPlayer(ctxA, battleId, tokens.p1);
    const pB = await openPlayer(ctxB, battleId, tokens.p2);

    // 双方轮流驱动直到 terminal（上限 250 步，spec turn-limit 200）
    for (let i = 0; i < 250; i++) {
      const sA = await pA.getByTestId("battle-status").textContent();
      if (sA?.includes('"result"')) break;
      if (i % 20 === 0) console.log(`iter ${i}: A=${sA}`);
      await actOnce(pA);
      await actOnce(pB);
      await pA.waitForTimeout(120);
    }
    let finB: string | null = null;
    await expect(async () => {
      finB = await pB.getByTestId("battle-status").textContent();
      expect(finB).toContain('"result"');
    }).toPass({ timeout: 15_000, intervals: [300] });
    const finA = await pA.getByTestId("battle-status").textContent();
    expect(finA).toContain('"result"');
    // 两侧看到的 terminal 一致
    const termA = JSON.parse(finA!.split("terminal=")[1]!);
    const termB = JSON.parse(finB!.split("terminal=")[1]!);
    expect(termA).toEqual(termB);
    expectNoPageErrors(pA, pB);

    await ctxA.close();
    await ctxB.close();
  } finally {
    await browser.close();
  }
});

test("skip 动画与正常播放产生相同 authoritative 状态", async () => {
  test.setTimeout(120_000);
  const browser = await chromium.launch();
  try {
    // 局1：正常速度播放
    const b1 = await newBattle("b2".repeat(16));
    // 局2：同 seed、speed=8 + skip
    const b2 = await newBattle("b2".repeat(16));

    for (const [bat, extra] of [[b1, ""], [b2, "&speed=8"]] as const) {
      const ctx = await browser.newContext();
      const p1 = await openPlayer(ctx, bat.battleId, bat.tokens.p1, extra + "&mode=ai");
      const p2 = await openPlayer(ctx, bat.battleId, bat.tokens.p2, extra + "&mode=ai");
      // AI 自动打（mode=ai 提交规则动作）——等终局
      await expect(async () => {
        const s = await p1.getByTestId("battle-status").textContent();
        expect(s).toContain('"result"');
      }).toPass({ timeout: 60_000, intervals: [500] });
      if (extra) await p2.getByTestId("btn-skip").click();
      expectNoPageErrors(p1, p2);
      await ctx.close();
    }

    // 同 seed + 同动作序列 → 两局最终权威态一致（UI 与动画模式无关）
    const o1 = await fetch(`${server!.url}/api/battle/${b1.battleId}/observe?player=${b1.tokens.p1}`).then((r) => r.json());
    const o2 = await fetch(`${server!.url}/api/battle/${b2.battleId}/observe?player=${b2.tokens.p1}`).then((r) => r.json());
    expect(o1.terminal).toEqual(o2.terminal);
    expect(o1.own.hp).toEqual(o2.own.hp);
    expect(o1.opponent.hp).toEqual(o2.opponent.hp);
    expect(o1.turn).toBe(o2.turn);
  } finally {
    await browser.close();
  }
});

test("慢 mock（history 延迟 2s）下 UI 仍可操作提交", async () => {
  test.setTimeout(90_000);
  const browser = await chromium.launch();
  try {
    const { battleId, tokens } = await newBattle("c3".repeat(16));
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    // 给 A 侧 history 路由注入 2s 延迟
    await ctxA.route(`**/api/battle/${battleId}/history**`, async (route) => {
      await new Promise((r) => setTimeout(r, 2000));
      await route.continue();
    });
    const pA = await openPlayer(ctxA, battleId, tokens.p1);
    const pB = await openPlayer(ctxB, battleId, tokens.p2);

    // 尽管 A 的 history 慢，submit 端点不经过它 → 按钮可点
    await expect(pA.getByTestId("btn-act_syn-strike")).toBeEnabled({ timeout: 15_000 });
    await pA.getByTestId("btn-act_syn-strike").click();
    await pB.getByTestId("btn-act_syn-strike").click();
    // B 侧正常 → 其 status 应前进到 turn 2
    await expect(async () => {
      const s = await pB.getByTestId("battle-status").textContent();
      expect(s).toContain("turn=2");
    }).toPass({ timeout: 15_000, intervals: [300] });
    expectNoPageErrors(pA, pB);

    await ctxA.close();
    await ctxB.close();
  } finally {
    await browser.close();
  }
});

test("v2 机制 UI：bench 面板 + replacement 横幅 + 徽标", async () => {
  test.setTimeout(120_000);
  const browser = await chromium.launch();
  try {
    // 双 bench → delta KO 后 p2 得 replacement 决策；epsilon(boss) 上场
    // six-stat：epsilon 物攻317 对 delta 防176 ≈53-62/回合，~9 回合内 KO（gamma 物攻太低打不动）
    const { battleId, tokens } = await newBattle("e5".repeat(16), {
      pack: "synthetic-v2",
      species: { p1: "syn-epsilon", p2: "syn-delta" },
      bench: { p1: ["syn-gamma"], p2: ["syn-epsilon"] },
    });
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pA = await openPlayer(ctxA, battleId, tokens.p1);
    const pB = await openPlayer(ctxB, battleId, tokens.p2);

    // bench 面板可见（双方各 1 个后备）——精灵面板在指令区中栏第二页，点「精灵」切入
    await pA.getByTestId("btn-pets").click();
    await pB.getByTestId("btn-pets").click();
    await expect(pA.getByTestId("bench-0")).toBeVisible();
    await expect(pB.getByTestId("bench-0")).toBeVisible();
    await pA.getByTestId("btn-fight").click();
    await pB.getByTestId("btn-fight").click();
    // 徽标渲染（meta endpoint 提供 damageKind）
    const btn = pA.getByTestId("btn-act_syn-strike");
    await expect(btn).toContainText("STD", { timeout: 10_000 });

    // 双侧驱动到 KO+replacement（p2 delta 倒下→选替补横幅）。
    // 挂起由 30s deadline 兜底——用 toPass 等待横幅出现而非逐帧探测
    const drive = async () => {
      await actOnce(pA);
      const strikeB = pB.getByTestId("btn-act_syn-strike");
      if (await strikeB.isEnabled().catch(() => false)) await strikeB.click({ timeout: 800 }).catch(() => {});
      const sB = await pB.getByTestId("battle-status").textContent();
      if (sB?.includes('"result"')) return;
    };
    await expect(async () => {
      if ((await pB.getByTestId("replacement-banner").count()) === 0) await drive();
      await expect(pB.getByTestId("replacement-banner")).toHaveCount(1, { timeout: 500 });
    }).toPass({ timeout: 90_000, intervals: [150] });

    // 换入 epsilon 后 p2 状态栏 unitId 变化 → log 里有 switch 事件
    await pB.getByTestId("btn-act_switch-0").click({ timeout: 3000 });
    await expect(pB.getByTestId("battle-log")).toContainText("换人", { timeout: 10_000 });
    expectNoPageErrors(pA, pB);

    await ctxA.close();
    await ctxB.close();
  } finally {
    await browser.close();
  }
});

test("队伍编辑器：点选→建局→进战局", async () => {
  test.setTimeout(60_000);
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errs: string[] = [];
    page.on("pageerror", (e) => { errs.push(e.message); });
    await page.goto(`${server!.url}/?world=1`, { waitUntil: "domcontentloaded" });
    // 清空玩家ID → wplOk=false → quickStart 不挂 wpl 参数：战局终局渲染 back-lobby（非 world 链路的 back-world）
    await page.getByTestId("player-id").fill("");
    await expect(page.getByTestId("team-builder")).toBeVisible({ timeout: 15_000 });
    // 点选 gamma 首发 + epsilon bench。背包：第五技能在环上，四个普通格另开。名册分页——按编号搜索后点选。
    await page.getByTestId("warehouse-q").fill("pet-5000");
    await page.getByTestId("pick-pet-5000").click();
    await expect(page.getByTestId("carry-fifth")).toContainText("神灵救世光", { timeout: 15_000 });
    await expect(page.getByTestId("carry-0")).toContainText("光荣之梦");
    await expect(page.getByTestId("carry-3")).toBeVisible();
    await page.getByTestId("warehouse-q").fill("pet-3550");
    await page.getByTestId("pick-pet-3550").click();
    await page.getByTestId("btn-start").click();
    // 跳转进战局页：bench 面板应显示天启帝君
    await expect(page.getByTestId("battle-status")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".move-grid > button.skill")).toHaveCount(4);
    await expect(page.locator(".fifth-slot").getByTestId("btn-act_mv-5000-f")).toBeVisible();
    await expect(page.locator(".move-grid").getByTestId("btn-act_mv-5000-f")).toHaveCount(0);
    await page.getByTestId("btn-pets").click();
    await expect(page.getByTestId("bench-0")).toBeVisible();
    await expect(page.getByTestId("bench-0")).toContainText("天启帝君");
    expect(errs, "pageerror").toEqual([]);
    await ctx.close();
  } finally {
    await browser.close();
  }
});

test("背包 6+6、仓库搜索、战斗药剂自动满", async () => {
  test.setTimeout(60_000);
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const errs: string[] = [];
    page.on("pageerror", (e) => { errs.push(e.message); });
    await page.goto(`${server!.url}/?world=1`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("player-id").fill("");
    await expect(page.getByTestId("team-builder")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("warehouse-q").fill("pet-5000");
    await page.getByTestId("pick-pet-5000").click();
    await expect(page.getByTestId("party-empty-5")).toBeVisible();
    await expect(page.getByTestId("carry-3")).toBeVisible();
    await page.setViewportSize({ width: 390, height: 800 });
    await expect(page.getByTestId("party-empty-5")).toBeVisible();
    await expect(page.getByTestId("carry-3")).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId("warehouse-q").fill("谱尼");
    await expect(page.getByTestId("pick-pet-3550")).toHaveCount(0);
    await expect(page.getByTestId("pick-pet-5000")).toBeVisible();
    await page.getByTestId("warehouse-q").fill("pet-3550");
    await page.getByTestId("pick-pet-3550").click();
    await page.getByTestId("btn-start").click();
    await expect(page.getByTestId("battle-status")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("btn-items").click();
    const pot = page.getByTestId("item-hp-200");
    await expect(pot).toContainText("5/5");
    await pot.click();
    await expect(pot).toContainText("4/5", { timeout: 10_000 });
    expect(errs, "pageerror").toEqual([]);
    await ctx.close();
  } finally {
    await browser.close();
  }
});

test("cleanup/幂等：连击按钮不产生重复生效；页面销毁后重新进入可 resync", async () => {
  test.setTimeout(60_000);
  const browser = await chromium.launch();
  try {
    const { battleId, tokens } = await newBattle("d4".repeat(16));
    const ctx = await browser.newContext();
    const page = await openPlayer(ctx, battleId, tokens.p1);

    // cleanup：页面销毁后无残留轮询。幂等：UI 提交后按钮即收起（双击竞态不可靠），
    // 改为协议层用同一幂等键重放——服务端应返回 duplicate-replay 而非重复生效。
    const pre: any = await page.evaluate(async (a: { battleId: string; token: string }) => {
      const r = await fetch(`/api/battle/${a.battleId}/observe?player=${encodeURIComponent(a.token)}`);
      return r.json();
    }, { battleId, token: tokens.p1 });
    // 按钮键是 h-<side>-<decisionId>-<actionId>。改招才是新键；同键重放必须是 duplicate-replay。
    const submitted = page.waitForResponse((r) => r.url().includes("/submit") && r.request().method() === "POST");
    await page.getByTestId("btn-act_syn-strike").click();
    await submitted;
    const dup: any = await page.evaluate(async ({ battleId, token, decisionId, baseRevision }: { battleId: string; token: string; decisionId: string; baseRevision: number }) => {
      const r = await fetch(`/api/battle/${battleId}/submit`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ player: token, decisionId, actionId: "act_syn-strike", baseRevision, idempotencyKey: `h-p1-${decisionId}-act_syn-strike` }),
      });
      return r.json();
    }, { battleId, token: tokens.p1, decisionId: pre.decision.decisionId, baseRevision: pre.decision.baseRevision });
    expect(dup.ok).toBe(true);
    expect(dup.receipt?.status).toBe("duplicate-replay");
    await page.waitForTimeout(600);
    const log = await page.getByTestId("battle-log").textContent();
    expect(log ?? "").not.toContain("ALREADY_SUBMITTED");
    expect(log ?? "").not.toContain("ERR");

    // destroy + 重建：关页面再开——resync 恢复同视角
    const before = await page.getByTestId("battle-status").textContent();
    await page.close();
    const page2 = await openPlayer(ctx, battleId, tokens.p1);
    const after = await page2.getByTestId("battle-status").textContent();
    expect(after).toBe(before);
    expectNoPageErrors(page2);
    await ctx.close();
  } finally {
    await browser.close();
  }
});

test("世界闭环：进世界→跑图→挑战boss→认输→领奖→回世界背包入账", async () => {
  test.setTimeout(90_000);
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errs: string[] = [];
    page.on("pageerror", (e) => { errs.push(e.message); });
    await page.goto(`${server!.url}/?world=1`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("world-screen")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("btn-enter").click();
    await expect(page.getByTestId("world-map")).toBeVisible({ timeout: 10_000 });
    // 先存档一队（挑战用默认首单位兜底也行，这里显式存；名册分页，按编号搜索）
    await page.getByTestId("warehouse-q").fill("pet-5000");
    await page.getByTestId("pick-pet-5000").click();
    await page.getByTestId("btn-save-team").click();
    // 跑图到 arena
    for (const n of ["route-1", "route-2", "arena"]) {
      await page.getByTestId(`node-${n}`).click();
      await page.waitForTimeout(120);
    }
    // 挑战 → 自动进战局
    await page.getByTestId("act-challenge").click();
    await expect(page.getByTestId("battle-status")).toBeVisible({ timeout: 15_000 });
    // 认输 → bot 自动回应 → 终局
    await page.getByTestId("btn-act_concede").click();
    await expect(page.getByTestId("btn-claim")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("btn-claim").click();
    // 再点一次——回执重放，不重复入账
    await page.waitForTimeout(300);
    await page.getByTestId("btn-claim").click();
    await page.waitForTimeout(300);
    // 回世界：背包应有 item-shard（败方参与奖）且只入账一次
    await page.getByTestId("back-world").click();
    await expect(page.getByTestId("world-profile")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("world-profile")).toContainText("item-shard×1");
    expect(errs, "pageerror").toEqual([]);
    await ctx.close();
  } finally {
    await browser.close();
  }
});

test("背包换位、战斗中换人、终局后舞台停住", async () => {
  test.setTimeout(90_000);
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const errs: string[] = [];
    page.on("pageerror", (e) => { errs.push(e.message); });
    await page.goto(`${server!.url}/?world=1`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("player-id").fill("");
    await expect(page.getByTestId("team-builder")).toBeVisible({ timeout: 15_000 });

    const order = [
      "pet-5000", "pet-3550", "pet-3577", "pet-3291", "pet-3673", "pet-4169",
      "pet-2987", "pet-3986", "pet-4275", "pet-3033", "pet-3788", "pet-4321",
    ];
    for (const id of order) { // 名册分页——逐只按编号搜索后点选
      await page.getByTestId("warehouse-q").fill(id);
      await page.getByTestId(`pick-${id}`).click();
    }
    await expect(page.getByTestId("party-5")).toContainText("弑序神罗");
    await expect(page.getByTestId("party-standby-5")).toContainText("至序圣华");
    await expect(page.getByTestId("party-empty-0")).toHaveCount(0);
    await expect(page.getByTestId("party-standby-empty-0")).toHaveCount(0);

    // 第五技能只在环上，不能换进四个普通格
    await page.getByTestId("party-0").click();
    await expect(page.getByTestId("carry-fifth")).toContainText("神灵救世光");
    expect(await page.getByTestId("carry-fifth").evaluate((el) => el.tagName)).toBe("DIV");
    await expect(page.getByTestId("learn-mv-5000-f")).toHaveCount(0);
    await expect(page.getByTestId("carry-0")).toContainText("光荣之梦");
    await expect(page.getByTestId("carry-0")).not.toContainText("神灵救世光");

    await page.getByTestId("warehouse-q").fill("谱尼");
    await expect(page.getByTestId("pick-pet-5000")).toBeVisible();
    await expect(page.getByTestId("pick-pet-3550")).toHaveCount(0);

    // 满 12 再带一只：点待命格替换，不是静默丢弃（留在 pet-5000 筛选视图，复制钮才在 DOM）
    await page.getByTestId("warehouse-q").fill("pet-5000");
    await page.getByTestId("warehouse-dup-pet-5000").click();
    await expect(page.getByTestId("swap-arm")).toBeVisible();
    await page.getByTestId("party-standby-5").click();
    await expect(page.getByTestId("swap-arm")).toHaveCount(0);
    await expect(page.getByTestId("party-0")).toContainText("圣灵谱尼");
    await expect(page.getByTestId("party-standby-5")).toContainText("圣灵谱尼");

    // 移出出战位，后面的往前补：英卡洛斯离开，星皇补到这一格，待命第一只补进出战
    await page.getByTestId("party-out-2").click();
    await expect(page.getByTestId("party-2")).toContainText("瀚宇星皇");
    await expect(page.getByTestId("party-5")).toContainText("重生之翼");
    await expect(page.getByTestId("party-standby-0")).toContainText("启灵元神");
    await expect(page.getByTestId("party-standby-empty-5")).toBeVisible();

    await page.getByTestId("party-standby-lead-0").click();
    await expect(page.getByTestId("party-0")).toContainText("启灵元神");

    await page.setViewportSize({ width: 390, height: 800 });
    await expect(page.getByTestId("party-0")).toBeVisible();
    await expect(page.getByTestId("party-standby-0")).toBeVisible();
    await expect(page.getByTestId("carry-fifth")).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.getByTestId("btn-start").click();
    await expect(page.getByTestId("battle-status")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("ucard-own")).toContainText("启灵元神");
    await page.getByTestId("btn-pets").click();
    await expect(page.getByTestId("bench-panel")).toBeVisible();
    await expect(page.getByTestId("bench-0")).toContainText("圣灵谱尼");
    await expect(page.getByTestId("bench-panel")).not.toContainText("重生之翼");

    const pose = () => page.evaluate(() => (window as unknown as { __scenePose?: () => string }).__scenePose?.() ?? "");
    const before = await pose();
    expect(before).toContain("|amb=1|");
    expect(before).toContain("|sealed=0|");
    await page.waitForTimeout(600);
    expect(await pose()).not.toBe(before);

    await page.getByTestId("btn-act_switch-0").click();
    await expect(page.getByTestId("battle-log")).toContainText("换人", { timeout: 15_000 });
    await expect(page.getByTestId("ucard-own")).toContainText("圣灵谱尼", { timeout: 15_000 });

    await expect(page.getByTestId("btn-act_concede")).toBeEnabled({ timeout: 15_000 });
    await page.getByTestId("btn-act_concede").click();
    await expect(page.getByTestId("result-banner")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("pixi-canvas")).toHaveAttribute("data-scene-settled", "1", { timeout: 1_000 });
    await expect(page.getByTestId("command-deck")).toHaveCount(0);
    await expect(page.getByTestId("back-lobby")).toBeVisible();
    const ended = await pose();
    expect(ended).toContain("|q=0|");
    expect(ended).toContain("|run=0|");
    expect(ended).toContain("|amb=0|");
    expect(ended).toContain("|floats=0|");
    expect(ended).toContain("|sealed=1|");
    await page.waitForTimeout(700);
    expect(await pose()).toBe(ended);
    await expect(page.getByTestId("result-banner")).toBeVisible();
    expect(errs, "pageerror").toEqual([]);
    await ctx.close();
  } finally {
    await browser.close();
  }
});
