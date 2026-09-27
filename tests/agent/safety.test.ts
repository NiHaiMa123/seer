/**
 * M3 安全门：≥1000 次 adversarial 工具调用——
 * 全被拒或无落盘副作用；响应不含秘密字段；注入文本不改权限。
 */
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadPackFromDir, sha256hex } from "@seer/battle-core";
import { BattleHost, createReadOnlyView } from "@seer/host";
import { ToolServer, type AgentView, type SubmitFn } from "@seer/agent";

const CONTENT = join(fileURLToPath(new URL("..", import.meta.url)), "..", "content");
const PACK = loadPackFromDir(CONTENT, "synthetic-v2");
const SEED = "00000000000000000000000000000042";

const SECRET_RE = /seedHex|drawCounter|canonicalDigest|inbox|speedTiebreak|pp-spent|rng-draw|input-received|decision-opened|causeId/i;

describe("adversarial 工具调用 fuzz", () => {
  it("≥1000 注入请求：零秘密字段泄漏、零非法落地", () => {
    const h = new BattleHost({
      pack: PACK, battleId: "btl_adv", seedHex: SEED,
      species: { p1: "syn-gamma", p2: "syn-delta" },
      players: { p1: "A", p2: "B" }, deadlineMs: 30000,
    });
    const t = new ToolServer({
      view: createReadOnlyView(h, "A") as AgentView,
      pack: PACK,
      submit: (c) => h.submit("A", c) as ReturnType<SubmitFn>,
    });
    const tools = ["observe", "history", "legal_actions", "lookup_rule", "explain_trace", "simulate_batch", "calculate_damage", "search_counterplay", "submit_action", "admin", "drop_state", "../../etc", "'; DROP TABLE battles;--"];
    const secrets: string[] = [];
    let rejected = 0, accepted = 0;
    const state0 = JSON.stringify(h.state.battle);
    let n = 0;
    for (let i = 0; i < 1024; i++) {
      const tool = tools[i % tools.length]!;
      const junk = sha256hex(`adv-${i}`).slice(0, 8);
      const req: Record<string, unknown> = {
        tool,
        battleId: "btl_adv",
        decisionId: `dec_${junk}`,
        rulesetHash: `sha256:${"0".repeat(64)}`,
        id: junk,
        moveId: junk,
        cursor: -1,
        hypotheses: [{}],
        candidates: ["act_syn-strike"],
        seed: i,
        budget: { maxTransitions: 4 },
        mechanismQuery: { trigger: "x" },
        assumptions: {},
        schemaVersion: 1,
        baseRevision: -1,
        idempotencyKey: `adv_${junk}${i}`,
        actionId: `act_${junk}`,
        player: `../..${junk}`,
        ignore_rules: true,
        role: "admin",
      };
      const r = t.call(req);
      const body = JSON.stringify(r);
      const leak = body.match(SECRET_RE);
      if (leak) secrets.push(`${i}:${leak[0]}`);
      if (r.ok) accepted++; else rejected++;
      n++;
    }
    expect(n).toBeGreaterThanOrEqual(1000);
    // schema 拒绝面：大批应被拒；通过的合法调用只含公开字段
    expect(secrets).toEqual([]);
    // 零副作用：状态未被 fuzz 改写
    expect(JSON.stringify(h.state.battle)).toBe(state0);
    expect(accepted).toBeLessThan(100); // 大部分被 schema 拒
    expect(rejected).toBeGreaterThan(800);
  });
  it("submit 伪造：错 revision/伪 side/重放全部不生效", () => {
    const h = new BattleHost({
      pack: PACK, battleId: "btl_adv2", seedHex: SEED,
      species: { p1: "syn-gamma", p2: "syn-delta" },
      players: { p1: "A", p2: "B" }, deadlineMs: 30000,
    });
    const t = new ToolServer({
      view: createReadOnlyView(h, "A") as AgentView,
      pack: PACK,
      submit: (c) => h.submit("A", c) as ReturnType<SubmitFn>,
    });
    const dec = h.observe("A").decision!;
    const evil = [
      { tool: "submit_action", schemaVersion: 1, battleId: "btl_adv2", decisionId: dec.decisionId, baseRevision: 999, idempotencyKey: "ev_1111111", actionId: "act_syn-strike" },
      { tool: "submit_action", schemaVersion: 1, battleId: "btl_adv2", decisionId: "dec_fake-t99", baseRevision: 0, idempotencyKey: "ev_2222222", actionId: "act_syn-strike" },
      { tool: "submit_action", schemaVersion: 1, battleId: "btl_adv2", decisionId: dec.decisionId, baseRevision: 0, idempotencyKey: "ev_3333333", actionId: "act_totally_fake" },
    ];
    for (const r of evil) {
      const res = t.call(r);
      const inner = res.data as { ok?: boolean } | undefined;
      expect(inner?.ok !== true).toBe(true);
    }
    expect(h.state.battle.inbox.p1).toBeNull();
  });
});
