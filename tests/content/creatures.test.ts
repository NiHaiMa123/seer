import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { parseCreaturePage, parseSoulMarkArticle } from "../../tools/lib/creature-parse.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const fix = (id: string) => readFileSync(`${ROOT}tests/fixtures/creatures/${id}.html`, "utf8");

describe("creature-parse: 4399 详情页解析", () => {
  it("圣灵谱尼：魂印外链 + 显式第五技能标记 + 培养方案", () => {
    const r = parseCreaturePage(fix("778713"));
    expect(r.name).toBe("圣灵谱尼");
    expect(r.dex).toMatchObject({ petNo: "5000", gender: "无性别", grade: "高级", kind: "活动精灵" });
    expect(r.typeLabel).toBe("神灵系");
    expect(r.baseStats).toEqual({ hp: 180, atk: 110, def: 120, spa: 150, sdf: 120, spd: 140, total: 820 });
    expect(r.soulMark?.url).toContain("seerwenda/780195");
    expect(r.fifthSkill).toBe("神灵救世光");
    const fifth = r.skills.find((s) => s.fifth);
    expect(fifth?.power).toBe(160);
    expect(r.build?.nature).toBe("保守");
    expect(r.build?.moves).toEqual(["光荣之梦", "神圣启示歌", "圣光吟诵", "神圣复苏"]);
    expect(r.forms).toEqual(["高级形态：圣灵谱尼"]);
  });

  it("雷伊：旧模板无魂印，无第五技能", () => {
    const r = parseCreaturePage(fix("47245"));
    expect(r.name).toBe("雷伊");
    expect(r.dex?.petNo).toBe("070");
    expect(r.baseStats?.total).toBe(610);
    expect(r.soulMark).toBeNull();
    expect(r.fifthSkill).toBeNull();
    expect(r.skills.length).toBeGreaterThan(10);
    expect(r.build?.moves).toContain("雷神觉醒");
  });

  it("克律莎：内联魂印文本", () => {
    const r = parseCreaturePage(fix("1015319"));
    expect(r.soulMark?.text).toContain("麻痹");
    expect(r.soulMark?.url).toBeNull();
    expect(r.baseStats?.total).toBe(715);
  });

  it("魂印长文页：提取正文", () => {
    const text = parseSoulMarkArticle(fix("soulmark-780195"));
    expect(text).toContain("圣洁");
    expect(text).toContain("虚无");
  });
});

describe("creatures 库完整性", () => {
  const libFile = `${ROOT}content/creatures/creatures.json`;
  const exists = existsSync(libFile);
  const lib = exists ? JSON.parse(readFileSync(libFile, "utf8")) : null;

  it.skipIf(!exists)("schema 校验通过", () => {
    const schema = JSON.parse(readFileSync(`${ROOT}content/schemas/creatures.schema.json`, "utf8"));
    const v = new Ajv({ allErrors: true, strict: true }).compile(schema);
    expect(v(lib), JSON.stringify(v.errors?.slice(0, 5))).toBe(true);
  });

  it.skipIf(!exists)("id/name 唯一，petNo 重复仅按 -b/-c 后缀区分", () => {
    const cs = Object.values(lib.creatures) as any[];
    const ids = new Set(cs.map((c) => c.id));
    expect(ids.size).toBe(cs.length);
    for (const c of cs) {
      if (c.id.includes("-") && /[a-z]$/.test(c.id)) {
        const base = c.id.replace(/-[a-z]$/, "");
        expect(lib.creatures[base], `${c.id} orphan suffix`).toBeTruthy();
      }
    }
  });

  it.skipIf(!exists)("数据形状抽查：谱尼/雷伊/圣灵谱尼", () => {
    const byPetNo = (n: string) => (Object.values(lib.creatures) as any[]).find((c) => c.petNo === n);
    expect(byPetNo("300")?.name).toBe("谱尼");
    expect(byPetNo("300")?.baseStats?.total).toBe(660);
    expect(byPetNo("070")?.name).toBe("雷伊");
    expect(byPetNo("5000")?.name).toBe("圣灵谱尼");
    expect(byPetNo("5000")?.soulMark?.text ?? byPetNo("5000")?.soulMark?.url).toBeTruthy();
  });
});
