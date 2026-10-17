// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
import { NUM, num } from "./lex.mjs";

export const rules = [

  // ── 可忽略前缀/碎片（逗号拆分后的孤儿）───────────────────────
  { id: "ignored-01", re: /^(技能使用成功时|命中后|命中时|使用后|若|则|并|并且|且|同时|额外|随机|下降状态|提升状态|能力下降状态|能力提升状态|属性相|属性相同|属性相同时|使敌我双方|敌我双方|双方|时)?$/, go: () => ({ ignored: true }) },
  { id: "ignored-02", re: /^最高(\d+)%?$|^最高(\d+)点$|^最高威力(\d+)$|^最多(\d+)次$|^最高增加(\d+)%$/, go: (m) => { if (m[3] !== undefined) return { attachDamage: { useCap: num(m[3]) } }; const unit = m[4] !== undefined ? "次" : m[2] !== undefined ? "点" : /%/.test(m[0]) ? "%" : "点"; return { attachAll: { capTail: { value: num(m[1] ?? m[2] ?? m[4] ?? m[5]), unit, src: m[0] } } }; } }, // "最高N%/N点/威力N" 是前条修饰的尾巴；威力封顶 → useCap；裸"最高N"（无%）按点值域走 powerPerUse/flatPerUse 宿主分支；其余封顶尾挂叠用宿主，无宿主记残留
  { id: "ignored-03", re: /^最高\+\d+$/, go: () => ({ unparsedReason: "stat-cap raise — stage ceiling unmodeled (deferred)" }) }, // "最高+N" 是 stage 封顶提升尾
  { id: "ignored-04", re: /^有效$|^对自身有效$|^对(?:敌|对方)有效$/, go: () => ({ ignored: true }) },
  { id: "ignored-05", re: new RegExp(`^${NUM}回合内?$|^下?${NUM}回合$|^每回合$|^下回合$`), go: () => ({ ignored: true }) }, // 逗号拆出的独立 timed 前缀碎片
  { id: "ignored-06", re: /^免(?:疫)?异常(?:状态)?$/, go: () => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self" }] }) },
];
