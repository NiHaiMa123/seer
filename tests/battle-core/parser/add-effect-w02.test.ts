/**
 * add-effect-w02：武道/衍化开关**置位之后**的句子（seer-w02 这一路）。
 * 步骤见 plans/add-effect.md，预算见 plans/touch-budget.md。
 * 每条：新规则解析出的 IR、该句子原来的 no-rule 事实、同类旧句子结果不变。
 * 这一类 id 不写进 tests/fixtures/effects-rule-order.json（顺序快照只锁已存 id 的相对次序）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { parseEffectText } from "../../../tools/effects-parse.mjs";
import { applyTurn, compilePack, initBattle, type CoreState, type FrozenPack } from "@seer/battle-core";

describe("add one effect (w02)", () => {
  const SRC =
    "必中；若对手处于能力强化状态则先制+2；自身不处于能力提升状态时先制+2；无视对手护盾效果；攻击伤害被限制时100%令对手害怕；" +
    "吸取对手能力提升状态，吸取成功则下2回合对手属性技能无效；" +
    "自身武道衍化轨迹为正转时2回合内对手无法通过技能恢复体力，为逆转时2回合内对手造成的攻击伤害减少50%";

  it("w02-wudao-cond-01：开关位谓词并入尾段 op 的 if（正转/逆转各一）", () => {
    const fwd = parseEffectText("自身武道衍化轨迹为正转时2回合内对手无法通过技能恢复体力") as { effects: unknown[]; unparsed: unknown[] };
    expect(fwd.unparsed).toEqual([]);
    expect(fwd.effects).toEqual([
      { op: "apply_status", name: "heal_block", target: "opponent", turns: 2, if: { selfHas: "tag:wudao:forward" } },
    ]);
    const rev = parseEffectText("自身武道衍化轨迹为逆转时2回合内对手造成的攻击伤害减少50%") as { effects: unknown[]; unparsed: unknown[] };
    expect(rev.unparsed).toEqual([]);
    expect(rev.effects).toEqual([
      { op: "apply_status", name: "dmg_weaken", target: "opponent", turns: 2, params: { n: 50, d: 100 }, if: { selfHas: "tag:wudao:revert" } },
    ]);

    // 语料整句：前半落地、后半仍是 no-rule（"为逆转时…"承前省主语，没有宿主的半句，不做）
    const full = parseEffectText(SRC) as { effects: unknown[]; unparsed: { clause: string; reason: string }[] };
    expect(full.effects).toEqual([
      { op: "strike", of: "pierce", value: true },
      { op: "transfer_stages", direction: "steal", sign: "up" },
      { op: "apply_status", name: "status_lock", target: "opponent", turns: 2, params: { cat: 1 }, if: { prevApplied: true } },
      { op: "apply_status", name: "heal_block", target: "opponent", turns: 2, if: { selfHas: "tag:wudao:forward" } },
    ]);
    expect(full.unparsed).toEqual([
      { clause: "攻击伤害被限制时100%令对手害怕", reason: "no-rule" },
      { clause: "为逆转时2回合内对手造成的攻击伤害减少50%", reason: "no-rule" },
    ]);
    // 后半单独回放：仍是 no-rule（不因本条而变成半条规则）
    expect((parseEffectText("为逆转时2回合内对手造成的攻击伤害减少50%") as { unparsed: unknown[] }).unparsed).toEqual([
      { clause: "为逆转时2回合内对手造成的攻击伤害减少50%", reason: "no-rule" },
    ]);
  });

  it("旧句结果不变：同句去掉开关两半、以及 r3-wudao-* 三个开关招", () => {
    // 旧句（去掉开关两半）仍是原来的三条 op
    const legacy = parseEffectText(
      "必中；若对手处于能力强化状态则先制+2；自身不处于能力提升状态时先制+2；无视对手护盾效果；攻击伤害被限制时100%令对手害怕；" +
      "吸取对手能力提升状态，吸取成功则下2回合对手属性技能无效",
    ) as { effects: unknown[] };
    expect(legacy.effects).toEqual([
      { op: "strike", of: "pierce", value: true },
      { op: "transfer_stages", direction: "steal", sign: "up" },
      { op: "apply_status", name: "status_lock", target: "opponent", turns: 2, params: { cat: 1 }, if: { prevApplied: true } },
    ]);
    // 三个开关位句子（batch-remain 的 r3-wudao-*）不动
    const flag = (q: string) => (parseEffectText(q) as { effects: unknown[] }).effects;
    expect(flag("衍化自身的武道")).toEqual([{ op: "set_mode_flag", name: "wudao", target: "self" }]);
    expect(flag("复原自身的武道衍化轨迹")).toEqual([{ op: "set_mode_flag", name: "wudao", target: "self", clear: true }]);
    expect(flag("将自身的武道衍化轨迹改为逆转")).toEqual([{ op: "set_mode_flag", name: "wudao", target: "self", to: "revert" }]);
    // 同族的无前缀裸句（他人领地的旧句）不变
    expect(flag("2回合内对手无法通过技能恢复体力")).toEqual([{ op: "apply_status", name: "heal_block", target: "opponent", turns: 2 }]);
  });
});

// ── 运行时：规则产出的 if:{selfHas:"tag:wudao:…"} 真的按开关位置门控 ──
// 探针招式直接吃 parseEffectText 的产出（解析→IR→引擎一条线），不手写 IR。
const CONTENT = join(fileURLToPath(new URL("../..", import.meta.url)), "..", "content");
const SEED = "44444444444444444444444444444444";
const read = (rel: string) => JSON.parse(readFileSync(join(CONTENT, rel), "utf8"));
const effOf = (q: string) => (parseEffectText(q) as { effects: unknown[] }).effects;

const pack = (): FrozenPack => compilePack({
  ruleset: read("rulesets/synthetic-v2.json"),
  typeChart: read("rulesets/typechart.json"),
  natures: read("rulesets/natures.json"),
  pack: { packId: "w02-gate", version: "0.0.0", schemaVersion: 1, rulesetId: "synthetic-v2", verification: "SYNTHETIC", license: { identifier: "CC0-1.0", public: true }, files: { units: "units.json", moves: "moves.json" }, assets: [] },
  units: {
    units: [
      { id: "u1", name: "U1", base: { hp: 400, atk: 100, def: 50, spa: 100, sdf: 50, spd: 100 }, types: ["普通"], moveIds: ["mfwd", "mrev", "mprobe-fwd", "mprobe-rev"] },
      { id: "u2", name: "U2", base: { hp: 400, atk: 100, def: 50, spa: 100, sdf: 50, spd: 50 }, types: ["普通"], moveIds: ["mnone"] },
    ],
  },
  moves: {
    moves: [
      { id: "mfwd", name: "置位", type: "普通", pp: 20, priority: 0, effects: [{ op: "set_mode_flag", name: "wudao", target: "self" }] },
      { id: "mrev", name: "逆转", type: "普通", pp: 20, priority: 0, effects: [{ op: "set_mode_flag", name: "wudao", target: "self", to: "revert" }] },
      { id: "mprobe-fwd", name: "探针正转", type: "普通", pp: 20, priority: 0, effects: effOf("自身武道衍化轨迹为正转时2回合内对手无法通过技能恢复体力") },
      { id: "mprobe-rev", name: "探针逆转", type: "普通", pp: 20, priority: 0, effects: effOf("自身武道衍化轨迹为逆转时2回合内对手造成的攻击伤害减少50%") },
      { id: "mnone", name: "空招", type: "普通", pp: 20, priority: 0, effects: [] },
    ],
  },
} as never);

const PACK = pack();
const act = (id: string) => ({ actionId: id, origin: "player" as const, idempotencyKey: `k-${id}-xxxxxxx` });
const ok = (r: ReturnType<typeof applyTurn>) => {
  if (!r.ok) throw new Error(`fault: ${r.fault.reason} ${r.fault.message}`);
  return r;
};
const turn = (s: CoreState, a: string) => ok(applyTurn(PACK, s, { p1: act(a), p2: act("act_mnone") })).state!;
const mk = (): CoreState => initBattle(PACK, { battleId: "btl_w02_gate", seedHex: SEED, p1: "u1", p2: "u2" });
/** p2 身上落下的门控痕迹（禁疗落成 immune 位、削弱落成 modifier 位）。 */
const marks = (s: CoreState) => s.sides.p2.unit.effects.map((e) => e.kind).sort();

describe("w02 开关位门控（运行时）", () => {
  it("未置位两个门都关；正转置位只开正转门；逆转置位只开逆转门", () => {
    expect(marks(turn(mk(), "act_mprobe-fwd"))).toEqual([]);
    expect(marks(turn(mk(), "act_mprobe-rev"))).toEqual([]);
    expect(marks(turn(turn(mk(), "act_mfwd"), "act_mprobe-fwd"))).toEqual(["immune"]);
    expect(marks(turn(turn(mk(), "act_mfwd"), "act_mprobe-rev"))).toEqual([]);
    expect(marks(turn(turn(mk(), "act_mrev"), "act_mprobe-rev"))).toEqual(["modifier"]);
    expect(marks(turn(turn(mk(), "act_mrev"), "act_mprobe-fwd"))).toEqual([]);
  });

  it("门控认的是 tag:wudao 编码：持别的状态（护盾）两个门都不开", () => {
    const base = mk();
    const shielded = {
      ...base,
      sides: { ...base.sides, p1: { ...base.sides.p1, unit: { ...base.sides.p1.unit, effects: [...base.sides.p1.unit.effects, { kind: "shield", params: { flat: 100 }, effectInstanceId: "efx_p1_shield" }] } } },
    };
    expect(marks(turn(shielded as CoreState, "act_mprobe-fwd"))).toEqual([]);
    expect(marks(turn(shielded as CoreState, "act_mprobe-rev"))).toEqual([]);
  });
});
