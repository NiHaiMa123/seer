/**
 * server 插件：local-bag（本地队伍存档）与 static（静态资源）。
 *
 * 这两个插件此前零引用。localbag 的 sanitize 没导出，但它的边界（非对象输入、
 * 非字符串项、超过 12 只、loadout/carried 形状）全都能经 HTTP 观察，所以用
 * 起真实 server 的方式测，不为了测试去改导出面。
 */
import { describe, it, expect, afterAll } from "vitest";
import { startServer } from "../../apps/server/src/index.ts";

const servers: Awaited<ReturnType<typeof startServer>>[] = [];
const boot = async () => {
  // 全量起（local-bag / static-web 都在默认装配里）；不裁剪模块，
  // 以免测到的不是线上真实组合。
  const s = await startServer(0);
  servers.push(s);
  return s;
};
afterAll(async () => {
  for (const s of servers) await s.close();
});

const put = (url: string, body: unknown) =>
  fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("local-bag 插件", () => {
  it("GET 返回可用的队伍结构（字段齐全，类型正确）", async () => {
    const s = await boot();
    const r = await fetch(`${s.url}/api/local/team`);
    expect(r.status).toBe(200);
    const j = (await r.json()) as { team: string[]; loadout: Record<string, string[]>; carried: Record<string, string[]> };
    // 不假设初始为空：local-bag 读 data/ 下的持久档，可能已有内容
    expect(Array.isArray(j.team)).toBe(true);
    expect(j.loadout).toBeTypeOf("object");
    expect(j.carried).toBeTypeOf("object");
  });

  it("PUT 后 GET 能读回同一份数据", async () => {
    const s = await boot();
    const body = { team: ["pet-1", "pet-2"], loadout: { "pet-1": ["mv-1"] }, carried: { "pet-1": ["mv-1"] } };
    const w = await put(`${s.url}/api/local/team`, body);
    expect(w.status).toBe(200);
    const r = await (await fetch(`${s.url}/api/local/team`)).json();
    expect(r).toMatchObject(body);
  });

  it("sanitize：非字符串项被丢弃，team 截断到 12 只", async () => {
    const s = await boot();
    const team = [...Array.from({ length: 20 }, (_, i) => `pet-${i}`), 42, null, "ok"];
    await put(`${s.url}/api/local/team`, { team, loadout: {}, carried: {} });
    const r = (await (await fetch(`${s.url}/api/local/team`)).json()) as { team: string[] };
    expect(r.team.length).toBeLessThanOrEqual(12);
    expect(r.team.every((x) => typeof x === "string")).toBe(true);
  });

  it("sanitize：loadout 里非数组值被忽略", async () => {
    const s = await boot();
    await put(`${s.url}/api/local/team`, { team: [], loadout: { a: "not-array", b: ["mv-1"] }, carried: {} });
    const r = (await (await fetch(`${s.url}/api/local/team`)).json()) as { loadout: Record<string, string[]> };
    expect(r.loadout["a"]).toBeUndefined();
    expect(r.loadout["b"]).toEqual(["mv-1"]);
  });

  it("sanitize：整体非对象输入回落空结构", async () => {
    const s = await boot();
    await put(`${s.url}/api/local/team`, "not-an-object");
    const r = (await (await fetch(`${s.url}/api/local/team`)).json()) as { team: string[] };
    expect(r.team).toEqual([]);
  });
});

describe("static 插件", () => {
  it("未知路径返回 404 而不是崩溃", async () => {
    const s = await boot();
    const r = await fetch(`${s.url}/__definitely_not_here__.js`);
    expect(r.status).toBe(404);
  });

  it("越出 clientRoot 的路径不会拿到仓库级文件", async () => {
    const s = await boot();
    // 说明 WHATWG URL 的行为（这也是 static 插件的安全边界所在）：
    //   /../../package.json  → pathname 被规范化为 /package.json，落到 clientRoot 内的
    //   前端包描述文件，属于 clientRoot 的合法资源，不算穿越。
    //   %2e%2e/%2e%2e 同理会被规范化。
    // 能真正逃出 clientRoot 的只有编码斜杠（..%2f），那条必须被 !file.includes("..") 挡住。
    const escaped = await fetch(`${s.url}/..%2f..%2fpackage.json`);
    expect(escaped.status).toBe(404);

    const normalized = await fetch(`${s.url}/../../package.json`);
    // 规范化后落在 clientRoot 内：200 且内容就是 clientRoot 自己的 package.json
    if (normalized.status === 200) {
      const j = (await normalized.json()) as { name?: string };
      expect(j.name).toBe("@seer/client");
    }
  });
});
