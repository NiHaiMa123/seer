/**
 * 4399 精灵图鉴爬取器 → content/creatures/creatures.json
 *
 * 流程：
 *   1) 索引页内嵌 petData（3526 条）→ 详情 URL 列表
 *   2) 详情页抓取（并发 4，GBK 解码，失败重试×3，NDJSON 断点续传）
 *   3) 魂印长文外链（seerwenda 文章页）二段抓取回填 soulMark.text
 *   4) 汇总写 creatures.json + claims 溯源（sha256）
 *
 * 用法：
 *   node tools/scrape-creatures.cjs            # 全量/续传
 *   node tools/scrape-creatures.cjs --limit=50 # 试跑
 *   node tools/scrape-creatures.cjs --finalize # 只把已有 checkpoint 汇总出库
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import iconv from "iconv-lite";
import { fileURLToPath } from "node:url";
import { parseCreaturePage, parseSoulMarkArticle } from "./lib/creature-parse.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const INDEX_URL = "https://news.4399.com/seer/jinglingdaquan/";
const OUT_DIR = path.join(ROOT, "content", "creatures");
const OUT_FILE = path.join(OUT_DIR, "creatures.json");
const CLAIM_FILE = path.join(ROOT, "content", "claims", "creatures-catalog.claim.json");
const CKPT_DIR = path.join(ROOT, "artifacts", "creatures");
const CKPT_FILE = path.join(CKPT_DIR, "raw.ndjson");

const CONCURRENCY = 4;
const REQ_DELAY_MS = 120;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : Infinity;
const FINALIZE_ONLY = process.argv.includes("--finalize");
const FETCH_SOUL = !process.argv.includes("--no-soul");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(20000),
        redirect: "follow",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return iconv.decode(Buffer.from(await r.arrayBuffer()), "gbk");
    } catch (e) {
      if (i === retries - 1) throw e;
      await sleep(1000 * (i + 1));
    }
  }
}

function extractPetData(html) {
  const m = html.match(/petData\s*=\s*(\[[\s\S]*?\])\s*;/);
  if (!m) throw new Error("petData array not found in index page");
  return JSON.parse(m[1]);
}

/** 索引行 → 记录骨架（detailUrl 为主键）。 */
const skeleton = (row) => ({
  name: row[0] ?? null,
  detailUrl: (row[1] ?? "").replace(/^http:/, "https:"),
  image: row[2] ? "https:" + row[2].replace(/^\/\//, "//") : null,
  iconId: row[3] ?? null,
  letter: row[4] ?? null,
  petNo: String(row[5] ?? ""),
  type: row[6] && row[6] !== "暂无资料" ? row[6] : null,
  signatureSkill: row[7] && row[7] !== "暂无资料" ? row[7] : null,
  obtainUrl: row[8] ? String(row[8]).replace(/^http:/, "https:") : null,
  indexTotal: /^\d+$/.test(String(row[9] ?? "")) ? parseInt(row[9], 10) : null,
});

function loadCheckpoint() {
  const done = new Map();
  if (fs.existsSync(CKPT_FILE)) {
    for (const line of fs.readFileSync(CKPT_FILE, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        done.set(rec.detailUrl, rec);
      } catch { /* 坏行跳过 */ }
    }
  }
  return done;
}

async function scrapeOne(row) {
  const sk = skeleton(row);
  const html = await fetchText(sk.detailUrl);
  const p = parseCreaturePage(html);
  const notes = [];
  if (!p.baseStats) notes.push("no-baseStats");
  if (p.skills.length === 0) notes.push("no-skills");
  if (p.name && sk.name && p.name !== sk.name) notes.push(`name-mismatch:${p.name}`);
  if (p.baseStats && sk.indexTotal !== null && p.baseStats.total !== sk.indexTotal)
    notes.push(`total-mismatch:${p.baseStats.total}vs${sk.indexTotal}`);
  // 第五技能判别：marker 权威；否则按新版页面惯例推断——
  // 索引 signatureSkill 命中技能表且 (lv71 或 lv--&高威力)，或末行技能 power≥160 且 lv∈{71,--}
  const isFifthShape = (s) => s && (s.level === 71 || (s.level === null && (s.power ?? 0) >= 150));
  let fifthInferred = null;
  const sig = sk.signatureSkill;
  if (sig) {
    const hit = p.skills.find((s) => s.name === sig);
    if (hit && isFifthShape(hit)) fifthInferred = sig;
  }
  if (!fifthInferred) {
    const last = p.skills[p.skills.length - 1];
    if (last && (last.power ?? 0) >= 160 && isFifthShape(last)) fifthInferred = last.name;
  }
  return {
    ...sk,
    name: p.name ?? sk.name,
    petNo: p.dex?.petNo ?? sk.petNo,
    dex: p.dex ? { gender: p.dex.gender, grade: p.dex.grade, kind: p.dex.kind, ...(p.dex.extra ? { extra: p.dex.extra } : {}) } : null,
    typeLabel: p.typeLabel,
    typeRelations: p.typeRelations,
    baseStats: p.baseStats,
    soulMark: p.soulMark,
    build: p.build,
    skills: p.skills,
    fifthSkill: p.fifthSkill,
    fifthSkillInferred: fifthInferred,
    forms: p.forms,
    obtainText: p.obtainText,
    fetchedAt: new Date().toISOString(),
    parseNotes: notes,
  };
}

async function runPool(items, worker, onEach) {
  let i = 0;
  const lanes = Array.from({ length: CONCURRENCY }, async () => {
    while (i < items.length) {
      const item = items[i++];
      try {
        const rec = await worker(item);
        onEach?.(rec, null);
      } catch (e) {
        onEach?.(null, { item, error: String(e) });
      }
      await sleep(REQ_DELAY_MS);
    }
  });
  await Promise.all(lanes);
}

async function main() {
  fs.mkdirSync(CKPT_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 1) 索引
  let rows;
  const idxCache = path.join(CKPT_DIR, "index.json");
  if (FINALIZE_ONLY && fs.existsSync(idxCache)) {
    rows = JSON.parse(fs.readFileSync(idxCache, "utf8"));
  } else {
    const html = await fetchText(INDEX_URL);
    rows = extractPetData(html);
    fs.writeFileSync(idxCache, JSON.stringify(rows));
  }
  console.log(`index rows: ${rows.length}`);

  // 2) 详情页（续传）
  const done = loadCheckpoint();
  const todo = rows.filter((r) => !done.has(String(r[1]).replace(/^http:/, "https:")));
  const batch = Number.isFinite(LIMIT) ? todo.slice(0, LIMIT) : todo;
  console.log(`checkpoint: ${done.size}, todo: ${todo.length}, batch: ${batch.length}`);

  if (!FINALIZE_ONLY && batch.length > 0) {
    const out = fs.createWriteStream(CKPT_FILE, { flags: "a" });
    let n = 0, fails = 0;
    await runPool(batch, scrapeOne, (rec, err) => {
      if (rec) {
        out.write(JSON.stringify(rec) + "\n");
        done.set(rec.detailUrl, rec);
      } else {
        fails++;
        console.log(`FAIL ${err.item[0]} ${err.item[1]}: ${err.error}`);
      }
      if (++n % 100 === 0) console.log(`progress ${n}/${batch.length}`);
    });
    out.end();
    console.log(`detail done: +${n - fails}, failed ${fails}`);
  }

  // 3) 魂印外链二段抓取
  const needSoul = [...done.values()].filter((r) => r.soulMark?.url && !r.soulMark.text);
  if (FETCH_SOUL && !FINALIZE_ONLY && needSoul.length > 0) {
    console.log(`soulMark external fetch: ${needSoul.length}`);
    const out = fs.createWriteStream(CKPT_FILE, { flags: "a" });
    let n = 0;
    await runPool(needSoul, async (rec) => {
      const html = await fetchText(rec.soulMark.url);
      const text = parseSoulMarkArticle(html);
      return { ...rec, soulMark: { ...rec.soulMark, text: text ?? rec.soulMark.text } };
    }, (rec, err) => {
      if (rec) { out.write(JSON.stringify(rec) + "\n"); done.set(rec.detailUrl, rec); }
      else console.log(`SOUL FAIL ${err.item.name}: ${err.error}`);
      if (++n % 100 === 0) console.log(`soul progress ${n}/${needSoul.length}`);
    });
    out.end();
    console.log(`soul done: ${n}`);
  }

  // 4) 汇总出库（petNo 去重：重复者按 detailUrl 序加 -b/-c）
  const all = [...done.values()];
  const byPet = new Map();
  for (const r of all.sort((a, b) => a.detailUrl.localeCompare(b.detailUrl))) {
    const k = r.petNo || "?";
    if (!byPet.has(k)) byPet.set(k, []);
    byPet.get(k).push(r);
  }
  const creatures = {};
  for (const [, list] of byPet) {
    list.forEach((r, i) => {
      const suffix = i === 0 ? "" : `-${String.fromCharCode(97 + i)}`;
      const id = `pet-${r.petNo}${suffix}`;
      creatures[id] = { id, ...r };
    });
  }
  const lib = {
    schemaVersion: 1,
    source: {
      name: "4399赛尔号精灵大全",
      indexUrl: INDEX_URL,
      fetchedAt: new Date().toISOString(),
      recordCount: all.length,
    },
    creatures,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(lib, null, 1));
  const sha = crypto.createHash("sha256").update(fs.readFileSync(OUT_FILE)).digest("hex");

  fs.mkdirSync(path.dirname(CLAIM_FILE), { recursive: true });
  fs.writeFileSync(CLAIM_FILE, JSON.stringify({
    claimId: "CLAIM-CREATURES-4399",
    targetSnapshot: "content/creatures/creatures.json",
    mode: "catalog-ingest",
    statement: "4399 精灵图鉴抓取的精灵库（名称/属性/种族值/魂印/第五技能/技能表/培养方案/形态/获得方式）。仅作数据源，未接入战斗规则。",
    boundaries: "数值与文本为 4399 编辑页面内容；魂印长文经文章页二段抓取；字段缺失时保留 null 不臆造。",
    source: { kind: "community", uri: INDEX_URL },
    observedAt: new Date().toISOString().slice(0, 10),
    evidenceDigest: `sha256:${sha}`,
    reviewer: "devin-scraper",
    verification: "UNVERIFIED",
    fixtureIds: [],
  }, null, 2));

  const stats = {
    total: all.length,
    withStats: all.filter((r) => r.baseStats).length,
    withSoul: all.filter((r) => r.soulMark?.text || r.soulMark?.url).length,
    soulText: all.filter((r) => r.soulMark?.text).length,
    withFifth: all.filter((r) => r.fifthSkill).length,
    withFifthInferred: all.filter((r) => r.fifthSkillInferred).length,
    withBuild: all.filter((r) => r.build?.moves?.length).length,
    totalSkills: all.reduce((s, r) => s + r.skills.length, 0),
    notes: all.filter((r) => r.parseNotes.length).length,
  };
  console.log("STATS", JSON.stringify(stats, null, 1));
  console.log(`wrote ${OUT_FILE} sha256:${sha.slice(0, 16)}…`);
}

main().catch((e) => { console.error(e); process.exit(1); });
