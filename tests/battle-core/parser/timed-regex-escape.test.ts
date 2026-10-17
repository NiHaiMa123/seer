/**
 * timed 家族正则转义 bug 的回归锁。
 *
 * 背景：几条规则把「正则字面量」写成了双反斜杠（/^\\d+$/），实际匹配的是
 * 字面量 "\d" 而不是数字，于是判定永远为假、走兜底分支。表现为句子被
 * 前面的规则劫持并算出错误的数值：
 *   - timed-49：「使对手疲惫2回合」被算成 turns:3（兜底值），而正确的
 *     e45-05 给出 turns:2。golden（3015/2388）与 parser-regression:1058
 *     三条独立期望都要求 2。
 *   - timed-43：清理尾巴 "+N" 的 replace 失效，stat 名里残留 "攻击+1"，
 *     STATS 查表落空。
 *   - e53-v25-03 / e53-v25-06：\s 与 (\d+) 同样失效。
 *
 * 这些断言只钉住「转义修正后应得的结果」，不放松任何既有 golden。
 */
import { describe, it, expect } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";

describe("timed / e53 家族正则转义", () => {
  it("timed-49：'使对手疲惫N回合' 的 turns 取句子里的 N，不是兜底 3", () => {
    expect(parseEffectText("使对手疲惫2回合").effects).toEqual([
      { op: "apply_status", name: "fatigue", target: "opponent", turns: 2 },
    ]);
    // 与已锁定的裸形 "30%疲惫2回合" 保持一致
    expect(parseEffectText("30%疲惫2回合").effects).toEqual([
      { op: "apply_status", name: "fatigue", target: "opponent", turns: 2, chance: 30 },
    ]);
    // 带「命中后」前缀同样不应跳档
    expect(parseEffectText("命中后30%使对手疲惫2回合").effects).toEqual([
      { op: "apply_status", name: "fatigue", target: "opponent", turns: 2, chance: 30 },
    ]);
    // 换一个 N 也要跟着变（防止又退化成常量 3）
    expect(parseEffectText("使对手疲惫4回合").effects).toEqual([
      { op: "apply_status", name: "fatigue", target: "opponent", turns: 4 },
    ]);
  });

  it("timed-43：能力名尾巴的 +N/-N 能被正确剥离（多段并列时不吞维）", () => {
    // 单段：由更宽规则兜住，这里只钉多段并列——bug 表现为维数丢失
    expect(parseEffectText("攻击、防御+1").effects).toEqual([
      { op: "apply_stat_stage", target: "self", stat: "atk", delta: 1 },
      { op: "apply_stat_stage", target: "self", stat: "def", delta: 1 },
    ]);
    // 关键回归：尾巴没被剥离时 "速度-2" 查表落空，spd 整维消失
    expect(parseEffectText("物攻、速度-2").effects).toEqual([
      { op: "apply_stat_stage", target: "self", stat: "atk", delta: -2 },
      { op: "apply_stat_stage", target: "self", stat: "spd", delta: -2 },
    ]);
  });

  it("e53-v25-03：能力+数值 + 组队目标句，能力 dim 不被目标句吞掉", () => {
    // 语料真实写法（无空格）：能力 effect 与 targetScope flag 都要在
    expect(parseEffectText("速度+1组队时可作用己方任意目标").effects).toEqual([
      { op: "apply_stat_stage", target: "self", stat: "spd", delta: 1 },
    ]);
    expect(parseEffectText("速度+1组队时可作用己方任意目标").flags).toEqual({ targetScope: "anyAlly" });
    // 纯目标句仍只出 flag（e48-31 锚定后不再吞掉前半句）
    expect(parseEffectText("组队时可作用己方任意目标").effects).toEqual([]);
    expect(parseEffectText("组队时可作用己方任意目标").flags).toEqual({ targetScope: "anyAlly" });
  });

  it("e53-v25-06：'提升N%' 的倍率句能取到数值", () => {
    const r = parseEffectText("使用火系技能造成的威力提升20%");
    expect(JSON.stringify(r.effects)).toContain("20");
  });
});
