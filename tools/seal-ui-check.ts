/**
 * 刻印 UI 全链路验证：大厅搜索/筛选/装备 → 规则提示 → 建局 → 战斗卡徽标+面板加成 → 对手隐藏。
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = "http://127.0.0.1:8787";
const OUT = "artifacts/seal-ui";
mkdirSync(OUT, { recursive: true });
const results: string[] = [];
const check = (name: string, ok: boolean, extra = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${extra !== "" ? ` ${extra}` : ""}`);
  if (!ok) process.exitCode = 1;
};

const browser = await chromium.launch();
const page = await browser.newPage();
// teamStore 服务端落盘——先清空，保证从空编队开始
await fetch(`${BASE}/api/local/team`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ team: [], loadout: {}, carried: {} }) });
await page.goto(BASE);
await page.waitForSelector("[data-testid=home-screen]");

// 1) 仓库搜编号选两只精灵 → 背包刻印页（佩戴目标=首发 pet-5000）
await page.getByTestId("nav-storage").click();
await page.waitForSelector("[data-testid=team-builder]");
await page.getByTestId("warehouse-q").fill("pet-5000");
await page.getByTestId("pick-pet-5000").click();
await page.getByTestId("warehouse-q").fill("pet-3550");
await page.getByTestId("pick-pet-3550").click();
await page.getByTestId("nav-bag").click();
await page.waitForSelector("[data-testid=petbag]");
await page.getByTestId("pd-party-0").click();
await page.getByTestId("bagtab-seals").click();
await page.waitForSelector("[data-testid=seal-picker]");
check("seal picker targets the lead", await page.locator(".bs-target").innerText().then((t) => t.trim().length > 0));

// 2) 三维检索
check("3 empty slots", (await page.locator("[data-testid^=seal-slot-]").count()) === 3);
const total = await page.locator("[data-testid^=seal-row-]").count();
check("list renders (page 36)", total === 36, `rows=${total}`);
check("count text shows 3832", await page.locator("[data-testid=seal-picker]").innerText().then((t) => t.includes("3832")));

// 名称搜索「K13-01」→ 命中 2 条（两个 id 同名）
await page.getByTestId("seal-q").fill("K13-01");
const hits = await page.locator("[data-testid^=seal-row-]").count();
check("name search K13-01 → 2 rows", hits === 2, `rows=${hits}`);
await page.getByTestId("seal-q").fill("");

// 系列筛选 K13 → 16 条（K13-01..08 × 2 组 id）
await page.getByTestId("seal-fseries").selectOption("K13");
const k13 = await page.locator("[data-testid^=seal-row-]").count();
check("series filter K13 → 16 rows", k13 === 16, `rows=${k13}`);

// 类型筛选 技能刻印 + 系列 K13 → 0
await page.getByTestId("seal-ftype").selectOption("技能刻印");
check("type+series combo → 0 rows", (await page.locator("[data-testid^=seal-row-]").count()) === 0);
await page.getByTestId("seal-ftype").selectOption("全部");

// 3) 装备两枚 K13-01 → 图鉴内槽位 1/2 填充
const pickerSlot = (i: number) => page.getByTestId(`seal-slot-${i}`);
await page.locator("[data-testid=seal-row-seal-42240]").click();
await page.locator("[data-testid=seal-row-seal-42240]").click();
check("2 slots filled",
  (await pickerSlot(0).innerText()).includes("K13-01") && (await pickerSlot(1).innerText()).includes("K13-01"));

// 4) 第 3 枚相同 → 规则提示；K13-02 → 同系列第 3 枚 → 拒
await page.locator("[data-testid=seal-row-seal-42240]").click();
check("3rd identical blocked", await page.getByTestId("seal-err").innerText().then((t) => t.includes("相同刻印最多 2")));
await page.locator("[data-testid=seal-row-seal-42241]").click();
check("3rd same-series blocked", await page.getByTestId("seal-err").innerText().then((t) => t.includes("同系列")));

// 5) 卸下一枚 → K13-04 专属（此时同系列仅 2 枚，专属检查才触发）→ 拒
await pickerSlot(1).click();
await page.locator("[data-testid=seal-row-seal-42243]").click();
check("exclusive blocked", await page.getByTestId("seal-err").innerText().then((t) => t.includes("专属")));
await page.screenshot({ path: `${OUT}/01-picker.png` });

// 6) 换一枚非 K13（V10-01）→ 合法双装
await page.getByTestId("seal-fseries").selectOption("V10");
await page.locator("[data-testid=seal-row-seal-45009]").click();
check("mixed series equip ok",
  (await pickerSlot(0).innerText()).includes("K13-01") && (await pickerSlot(1).innerText()).includes("V10-01"));
await page.screenshot({ path: `${OUT}/02-lobby.png` });

// 6) 大厅开战 → 己方刻印徽标 + 面板加成；对手隐藏徽标但 HP=634（预设双 K13-01）
await page.getByTestId("nav-lobby").click();
await page.waitForSelector("[data-testid=lobby-screen]");
await page.getByTestId("btn-start").click();
await page.waitForSelector("[data-testid=ucard-own]", { timeout: 15000 });
check("own seal chip 刻印×2", await page.getByTestId("sealchip-own").innerText().then((t) => t.includes("刻印×2")));
check("foe seal chip hidden", (await page.getByTestId("sealchip-foe").count()) === 0);
const ownStats = await page.getByTestId("stats-own").innerText();
check("own panel 特攻 369（保守，学习力按 0，这枚刻印不加特攻）", /特攻369/.test(ownStats.replace(/\s/g, "")), ownStats.trim());
const foeHp = await page.locator("[data-testid=ucard-foe] .hpbar b").innerText();
check("foe hp 491（天启帝君，没有预设刻印）", foeHp.trim().endsWith("/491"), foeHp);
await page.screenshot({ path: `${OUT}/03-battle.png` });

await browser.close();
console.log(results.join("\n"));
console.log(`\n${results.filter((r) => r.startsWith("PASS")).length}/${results.length} PASS`);
