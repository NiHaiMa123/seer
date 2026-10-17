// w02：武道/衍化开关（set_mode_flag 三态，见 ops/mode-flag.ts）**已经置位之后**的句子。
// 开关本身的置位/清除/改逆转在 batch-remain.mjs 的 r3-wudao-* 里，本条不动它、也不动 mode-flag.ts 的三态语义。
// 读开关用既有谓词 selfHas（cond.ts 按 kind 相等或「前缀+冒号」匹配，编码正是 tag:wudao:forward / tag:wudao:revert）。
// 家族文件惯例：只在 go() 里调解析器，加载期 re: 只用 ./lex.mjs。
import { parseEffectText } from "../effects-parse.mjs";

export const rules = [
  // ── 「（自身）武道（衍化）轨迹为正转/逆转时 X」 ──
  // 宿主句 灭战神决·盖亚 / 战神·破天闪：「…自身武道衍化轨迹为正转时2回合内对手无法通过技能恢复体力，
  // 为逆转时2回合内对手造成的攻击伤害减少50%」。
  //
  // 本条只吃带完整「武道…轨迹为正转/逆转时」前缀的那一半。两个半边的尾段本身都有现成规则
  // （heal_block / dmg_weaken），本条不加状态名、不加 params 键、不加结算分支，只把开关谓词
  // 并入这些 op 的 if（op 信封条件，ops/index.ts 求值；dmg_weaken 挂在对手身上，其 params 本就不带条件，
  // 不接 if 就静默跳过，所以不改结算）。
  //
  // 后半「为逆转时2回合内对手造成的攻击伤害减少50%」承前省主语（自身武道衍化轨迹），
  // 单独回放是 no-rule——按 w02.md「没有宿主的半句」不做：为它写一条裸「为逆转时…」规则，
  // 会把任何以「为逆转时」起头的半句当成持有开关，等于给没有宿主的半句补主语。
  //
  // 半边有 attachDamage/flags 而没有 effects 的形态（"武道轨迹为正转时造成的伤害提升50%"）
  // 本条不发——rider 上没有挂条件的键，进不了就不猜。
  { id: "w02-wudao-cond-01",
    re: /^(?:自身|自己)?(?:的)?武道(?:衍化)?轨迹为?(正转|逆转)时(.+)$/,
    go: (m) => {
      const rest = parseEffectText(m[2]);
      if (rest.effects.length === 0) return null;
      const cond = { selfHas: `tag:wudao:${m[1] === "正转" ? "forward" : "revert"}` };
      return { effects: rest.effects.map((e) => ({ ...e, if: e.if === undefined ? cond : { and: [e.if, cond] } })) };
    } },
];
