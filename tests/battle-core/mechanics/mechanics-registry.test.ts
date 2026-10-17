/**
 * 机制登记是手写数组，不是扫目录。sixstat 必须在 seals 前面。
 */
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MECHANICS } from "../../../packages/battle-core/src/mechanics/index.ts";

const MECH_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../packages/battle-core/src/mechanics");

describe("MECHANICS registry", () => {
  it("id 不重复，sixstat 在 seals 之前，目录名等于 id", () => {
    const ids = MECHANICS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.indexOf("sixstat")).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf("sixstat")).toBeLessThan(ids.indexOf("seals"));
    const dirs = readdirSync(MECH_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect([...ids].sort()).toEqual(dirs);
  });
});
