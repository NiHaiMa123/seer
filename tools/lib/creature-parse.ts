/**
 * 4399 精灵图鉴详情页解析器（纯函数，无浏览器依赖）。
 * 输入：GBK 已解码的 HTML 字符串；输出：结构化精灵字段。
 * 模板锚点（新旧 URL 共用一套 DOM）：
 *   .item1 dl.shuxing   基本信息（dt=名, dd>span>em=标签）
 *   .item2 dl.shuxing   属性系别（dt i=系名, dd>p=克制/被克两行）
 *   a.item3             获得攻略链接
 *   .item4 .race table  种族值（体力/攻击/防御/特攻/特防/速度/总和）
 *   .item51             魂印（内联文本 或 外链 seerwenda 详情页）
 *   .item6 table        培养方案（性格 / 学习力 / 推荐配招）
 *   #skill .elvedata    技能表（末列=第五技能/推荐 标记）
 *   .focusimg p         形态链
 *   #gonglue .elvecon   捕捉攻略正文
 */

export interface CreatureDex {
  petNo: string | null;
  gender: string | null;
  grade: string | null;
  kind: string | null;
  extra?: Record<string, string>;
}
export interface CreatureStats {
  hp: number | null; atk: number | null; def: number | null;
  spa: number | null; sdf: number | null; spd: number | null; total: number | null;
}
export interface CreatureSkill {
  name: string;
  kind: string | null;
  power: number | null;
  pp: number | null;
  level: number | null;
  effect: string | null;
  fifth: boolean;
  recommended: boolean;
}
export interface CreatureSoulMark { text: string | null; url: string | null }
export interface CreatureBuild {
  nature: string | null;
  evs: string | null;
  moves: string[];
  raw: string;
}
export interface CreaturePage {
  name: string | null;
  dex: CreatureDex | null;
  typeLabel: string | null;
  typeRelations: string[];
  obtainUrl: string | null;
  obtainText: string | null;
  baseStats: CreatureStats | null;
  soulMark: CreatureSoulMark | null;
  build: CreatureBuild | null;
  skills: CreatureSkill[];
  fifthSkill: string | null;
  forms: string[];
}

const decodeEntities = (s: string): string =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

/** 去标签 + 实体解码 + 空白收敛。<br> 与块级标签转为分隔符。 */
export const stripTags = (s: string | undefined | null): string =>
  decodeEntities(
    (s ?? "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/(p|div|tr|td|li|h\d)>/gi, " ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[\s　]+/g, " ")
    .trim();

/** 从 marker 起平衡匹配 <div>…</div>，返回该 div 块的完整 HTML。 */
export const extractDiv = (html: string, marker: string): string | null => {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const start = html.lastIndexOf("<div", at);
  if (start < 0) return null;
  const re = /<\/?div[\s>]/gi;
  re.lastIndex = start;
  let depth = 0;
  for (let m; (m = re.exec(html)); ) {
    depth += m[0][1] === "/" ? -1 : 1;
    if (depth === 0) return html.slice(start, re.lastIndex);
  }
  return null;
};

const extractTable = (block: string | null): string | null => {
  if (!block) return null;
  const m = block.match(/<table[\s\S]*?<\/table>/i);
  return m ? m[0] : null;
};

/** table → 行数组（每行=单元格纯文本数组）。thead/tbody 一视同仁。 */
export const tableRows = (tableHtml: string | null): string[][] => {
  if (!tableHtml) return [];
  const rows: string[][] = [];
  const trRe = /<tr[\s\S]*?<\/tr>/gi;
  for (let tr; (tr = trRe.exec(tableHtml)); ) {
    const cells: string[] = [];
    const tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    for (let td; (td = tdRe.exec(tr[0] ?? "")); ) cells.push(stripTags(td[1]));
    rows.push(cells);
  }
  return rows;
};

/** item1 dl.shuxing：{ 名, {petNo,gender,grade,kind,extra} } */
const parseBasic = (html: string): { name: string | null; dex: CreatureDex | null } => {
  const blk = extractDiv(html, 'class="item1"');
  if (!blk) return { name: null, dex: null };
  const name = stripTags((blk.match(/<dt[^>]*>([\s\S]*?)<\/dt>/i) || [])[1] ?? "") || null;
  const raw: Record<string, string> = {};
  const spanRe = /<span>\s*<em>([^<]+)<\/em>([\s\S]*?)<\/span>/gi;
  for (let m; (m = spanRe.exec(blk)); ) {
    const key = stripTags(m[1]).replace(/[:：]\s*$/, "");
    const val = stripTags(m[2]);
    if (key && val) raw[key] = val;
  }
  const KEYMAP: Record<string, "petNo" | "gender" | "grade" | "kind"> = {
    精灵序号: "petNo", 精灵性别: "gender", 精灵等级: "grade", 精灵类型: "kind",
  };
  const dex: CreatureDex = { petNo: null, gender: null, grade: null, kind: null };
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (KEYMAP[k]) dex[KEYMAP[k]] = v;
    else extra[k] = v;
  }
  if (Object.keys(extra).length > 0) dex.extra = extra;
  return { name, dex };
};

/** item2：系名 + 克制两行原文（line[0]=克制对象, line[1]=被克对象）。 */
const parseType = (html: string): { typeLabel: string | null; typeRelations: string[] } => {
  const blk = extractDiv(html, 'class="item2"');
  if (!blk) return { typeLabel: null, typeRelations: [] };
  const typeLabel = stripTags((blk.match(/<i>([\s\S]*?)<\/i>/i) || [])[1] ?? "") || null;
  const typeRelations = [...blk.matchAll(/<dd[^>]*>([\s\S]*?)<\/dd>/gi)]
    .flatMap((d) => [...(d[1] ?? "").matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((p) => stripTags(p[1])))
    .filter(Boolean);
  return { typeLabel, typeRelations };
};

const parseStats = (html: string): CreatureStats | null => {
  const blk = extractDiv(html, 'class="item4"');
  const rows = tableRows(extractTable(blk));
  const body = rows.find((r) => r.length >= 7 && /^\d+$/.test(r[0] ?? ""));
  if (!body) return null;
  const num = (v: string | undefined): number | null => (v && /^\d+$/.test(v) ? parseInt(v, 10) : null);
  const [hp, atk, def, spa, sdf, spd, total] = [0, 1, 2, 3, 4, 5, 6].map((i) => num(body[i]));
  return { hp: hp ?? null, atk: atk ?? null, def: def ?? null, spa: spa ?? null, sdf: sdf ?? null, spd: spd ?? null, total: total ?? null };
};

/** item51：内联魂印文本，或长文外链 url。 */
const parseSoulMark = (html: string): CreatureSoulMark | null => {
  const blk = extractDiv(html, 'class="item51"');
  if (!blk) return null;
  const url = (blk.match(/<a[^>]+href="([^"]+)"[^>]*>/i) || [])[1] ?? null;
  const text = stripTags(blk);
  if (!text) return null;
  // 外链引导语视为无内联文本，保留 url 供二段抓取
  const isLinkOnly = !!url && /详细内容|点击查看|点击下面链接/.test(text);
  return { text: isLinkOnly ? null : text, url: url ? (url.startsWith("//") ? "https:" + url : url) : null };
};

const parseBuild = (html: string): CreatureBuild | null => {
  const blk = extractDiv(html, 'class="item6"');
  const rows = tableRows(extractTable(blk)).filter((r) => r.length > 0);
  if (rows.length === 0) return null;
  const [r0, r1] = rows;
  const firstCell = r0?.[0] ?? "";
  const nature = firstCell && !/培养|方案|性格/.test(firstCell) ? firstCell : null;
  const evs = r0?.[1] ?? null;
  const rawMoves = r1?.join(" ") ?? null;
  const hasMoves = rawMoves && !/还没有推荐配招|暂无/.test(rawMoves);
  // 推荐配招尾注：「（该配招得到广大小赛尔推荐）我来配招」等——先剥掉再按 + 切分
  const cleaned = hasMoves
    ? rawMoves.replace(/（[^）]*）|\([^)]*\)/g, "").replace(/我来配招/g, "").trim()
    : "";
  return {
    nature,
    evs,
    moves: hasMoves
      ? cleaned
          .split(/[+＋]/)
          .map((s) => s.trim())
          .filter((s) => s && !/配招|推荐|展示|勾选/.test(s))
      : [],
    raw: rows.map((r) => r.join(" ")).join(" "),
  };
};

const parseSkills = (html: string): CreatureSkill[] => {
  const blk = extractDiv(html, 'class="elvedata"') ?? extractDiv(html, 'id="skill"');
  const rows = tableRows(extractTable(blk));
  const skills: CreatureSkill[] = [];
  for (const r of rows) {
    if (r.length < 6) continue;
    if (/技能名|攻击类型/.test(r.join(""))) continue; // 表头
    const [name, kind, power, pp, level, effect, marker] = r;
    if (!name) continue;
    const toNum = (v: string | undefined) => (v && /^\d+$/.test(v) ? parseInt(v, 10) : null);
    skills.push({
      name,
      kind: kind || null,
      power: toNum(power),
      pp: toNum(pp),
      level: level === "--" ? null : toNum(level),
      effect: effect && effect !== "--" ? effect : null,
      fifth: /第五技能/.test(marker ?? "") || /第五技能/.test(kind ?? ""),
      recommended: /推荐/.test(marker ?? ""),
    });
  }
  return skills;
};

const parseForms = (html: string): string[] => {
  const forms: string[] = [];
  const re = /<div class="focusimg"[^>]*>[\s\S]*?<\/div>/gi;
  for (let m; (m = re.exec(html)); ) {
    const p = m[0].match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const text = p ? stripTags(p[1] ?? "") : "";
    if (text && !forms.includes(text)) forms.push(text);
  }
  return forms;
};

const parseObtain = (html: string): { obtainUrl: string | null; obtainText: string | null } => {
  const blk = extractDiv(html, 'id="gonglue"');
  const url = (html.match(/<a href="([^"]+)" class="item3"/) || [])[1] ?? null;
  if (!blk) return { obtainUrl: url, obtainText: null };
  const con = (blk.match(/class="elvecon"[^>]*>([\s\S]*?)$/i) || [])[1] ?? blk;
  const text = stripTags(con).slice(0, 4000) || null;
  return { obtainUrl: url, obtainText: text };
};

/**
 * 解析详情页 → 结构化字段（不含索引层 petData 字段）。
 * 失败字段返回 null/[]，不抛错——缺数据是常态。
 */
export function parseCreaturePage(html: string): CreaturePage {
  const basic = parseBasic(html);
  const type = parseType(html);
  const skills = parseSkills(html);
  return {
    ...basic,
    ...type,
    ...parseObtain(html),
    baseStats: parseStats(html),
    soulMark: parseSoulMark(html),
    build: parseBuild(html),
    skills,
    fifthSkill: skills.find((s) => s.fifth)?.name ?? null,
    forms: parseForms(html),
  };
}

/** 魂印长文页（seerwenda 等文章页）：提取正文纯文本。 */
export function parseSoulMarkArticle(html: string): string | null {
  const blk =
    extractDiv(html, 'class="content"') ??
    extractDiv(html, 'class="article"') ??
    extractDiv(html, 'id="article"') ??
    extractDiv(html, 'class="text_');
  let text = stripTags(blk ?? "").replace(/相关攻略[：:]?.{0,80}$/s, "").trim();
  if (!text) {
    // 兜底：meta description 常含完整魂印摘要
    text = decodeEntities(
      (html.match(/<meta name="description" content="([^"]+)"/i) || [])[1] ?? "",
    ).trim();
  }
  return text.slice(0, 8000) || null;
}
