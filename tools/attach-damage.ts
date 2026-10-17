/**
 * attachDamage 合并。attachChance 改写成这条 damage 的 chance，其余键原样抄上去。
 * 就地改 dmg。调用方已经选好要并进去的那一条，这里不新建 op，也不筛键。
 */
export function mergeAttachDamage(
  dmg: { [k: string]: unknown },
  ad: { [k: string]: unknown },
): void {
  const { attachChance, ...rest } = ad;
  Object.assign(dmg, rest);
  if (attachChance !== undefined) dmg.chance = attachChance;
}
