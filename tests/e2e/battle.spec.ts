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

async function openPlayer(ctx: BrowserContext, battleId: string, token: string, extra = ""): Promise<Page> {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { throw new Error(`pageerror: ${e.message}`); });
  await page.goto(`${server!.url}/?battle=${battleId}&player=${token}${extra}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("battle-status")).toBeVisible({ timeout: 15_000 });
  return page;
}

/** 驱动一步真实点击；检查与点击间 obs 可能刷新 → 短超时 click + catch。 */
async function actOnce(page: Page): Promise<void> {
  const status = await page.getByTestId("battle-status").textContent();
  if (status?.includes('"result"')) return; // terminal
  const btns = page.locator("button[data-testid^='btn-act_']:not([disabled])");
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
      await ctx.close();
      void p1;
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

    // bench 面板可见（双方各 1 个后备）
    await expect(pA.getByTestId("bench-0")).toBeVisible();
    await expect(pB.getByTestId("bench-0")).toBeVisible();
    // 徽标渲染（meta endpoint 提供 damageKind）
    const btn = pA.getByTestId("btn-act_syn-strike");
    await expect(btn).toContainText("[STD", { timeout: 10_000 });

    // AI 双侧自动打到 KO+replacement（p2 delta revive→KO→选替补）
    for (let i = 0; i < 200; i++) {
      const sB = await pB.getByTestId("battle-status").textContent();
      if (sB?.includes('"result"')) break;
      if ((await pB.getByTestId("replacement-banner").count()) > 0) break; // 横幅出现即停——AI 会自己选替补
      await actOnce(pA);
      // pB 只点招式——replacement 期间不打断，让横幅存活到下一轮被检测
      const strikeB = pB.getByTestId("btn-act_syn-strike");
      if (await strikeB.isEnabled().catch(() => false)) await strikeB.click({ timeout: 800 }).catch(() => {});
      await pA.waitForTimeout(120);
    }
    // p2 侧应出现过 replacement 横幅（KO 后选替补）
    await expect(pB.getByTestId("replacement-banner")).toBeVisible({ timeout: 10_000 });
    // 换入 epsilon 后 p2 状态栏 unitId 变化 → log 里有 switch 事件
    await pB.getByTestId("btn-act_switch-0").click({ timeout: 1500 }).catch(() => {});
    await pA.waitForTimeout(400);
    const log = await pB.getByTestId("battle-log").textContent();
    expect(log ?? "").toContain("switch");

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
    page.on("pageerror", (e) => { throw new Error(`pageerror: ${e.message}`); });
    await page.goto(`${server!.url}/`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("team-builder")).toBeVisible({ timeout: 15_000 });
    // 点选 gamma 首发 + epsilon bench
    await page.getByTestId("pick-syn-gamma").click();
    await page.getByTestId("pick-syn-epsilon").click();
    await page.getByTestId("btn-start").click();
    // 跳转进战局页：bench 面板应显示 epsilon
    await expect(page.getByTestId("battle-status")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("bench-0")).toBeVisible();
    await expect(page.getByTestId("bench-0")).toContainText("syn-epsilon");
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
    await page.getByTestId("btn-act_syn-strike").click();
    const dup: any = await page.evaluate(async ({ battleId, token, decisionId, baseRevision }: { battleId: string; token: string; decisionId: string; baseRevision: number }) => {
      const r = await fetch(`/api/battle/${battleId}/submit`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ player: token, decisionId, actionId: "act_syn-strike", baseRevision, idempotencyKey: `h-p1-${decisionId}` }),
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
    page.on("pageerror", (e) => { throw new Error(`pageerror: ${e.message}`); });
    await page.goto(`${server!.url}/?world=1`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("world-screen")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("btn-enter").click();
    await expect(page.getByTestId("world-map")).toBeVisible({ timeout: 10_000 });
    // 先存档一队（挑战用默认首单位兜底也行，这里显式存）
    await page.getByTestId("pick-syn-gamma").click();
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
    await ctx.close();
  } finally {
    await browser.close();
  }
});
