/** order.mjs 的规则表。顺序测试只读 id；另有测试直接触达某条的 re/go，故一并声明。 */
export interface EffectRule {
  id: string;
  re: RegExp;
  go: (m: RegExpMatchArray | RegExpExecArray) => unknown;
}
export const RULES: EffectRule[];
