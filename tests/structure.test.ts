/**
 * 锁 tests/README.md 的目录形状。
 * 产品测试不平铺在 tests/battle-core/ 根上，也不出现在仓库根、tools、packages、apps。
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TESTS = fileURLToPath(new URL(".", import.meta.url));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BATTLE_GROUPS = ["content", "engine", "mechanics", "ops", "parser"];
const TEST_FILE = /\.(test|spec)\.tsx?$/;

const names = (dir: string) => readdirSync(dir);

describe("test layout", () => {
  it("battle-core 只有五个组，根上没有测试文件", () => {
    const dir = join(TESTS, "battle-core");
    const entries = readdirSync(dir, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile() && TEST_FILE.test(e.name)).map((e) => e.name);
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
    expect(files).toEqual([]);
    expect(dirs).toEqual(BATTLE_GROUPS);
  });

  it("tests 根上只有 structure.test.ts 这一份测试", () => {
    const files = names(TESTS).filter((name) => TEST_FILE.test(name));
    expect(files).toEqual(["structure.test.ts"]);
  });

  it("仓库根、tools、packages、apps 没有测试文件", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of names(dir)) {
        if (name === "node_modules" || name === "dist" || name === "scratch") continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (TEST_FILE.test(name)) hits.push(path.slice(ROOT.length + 1).replaceAll("\\", "/"));
      }
    };
    for (const top of ["tools", "packages", "apps"]) walk(join(ROOT, top));
    const rootHits = names(ROOT).filter((name) => TEST_FILE.test(name));
    expect(rootHits).toEqual([]);
    expect(hits).toEqual([]);
  });
});
