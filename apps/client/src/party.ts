/**
 * 背包编制：一条数组，前 6 只出战，后 6 只待命，一共 12。
 * 出战满了再追加，进待命。移出某一格时后面的往前补（页游会留空位，这里不留）。
 * 仓库不在这条数组里。只有出战列进战斗。
 */
export const BATTLE_SIZE = 6;
export const BAG_SIZE = 12;

export function battleParty(team: readonly string[]): string[] {
  return team.slice(0, BATTLE_SIZE);
}

/** 点仓库行：已在背包则拿走全部同种；没有且未满则追加。满了不改，交给替换。 */
export function bagToggle(team: readonly string[], speciesId: string): string[] {
  if (team.includes(speciesId)) return team.filter((id) => id !== speciesId);
  return bagAdd(team, speciesId);
}

export function bagAdd(team: readonly string[], speciesId: string): string[] {
  if (team.length >= BAG_SIZE) return [...team];
  return [...team, speciesId];
}

export function bagReplace(team: readonly string[], index: number, speciesId: string): string[] {
  if (index < 0 || index >= team.length) return [...team];
  const next = [...team];
  next[index] = speciesId;
  return next;
}

export function bagRemoveAt(team: readonly string[], index: number): string[] {
  if (index < 0 || index >= team.length) return [...team];
  return team.filter((_, i) => i !== index);
}

/** 把这一格设为首发。从待命顶上来时，原来的第 6 只出战落到待命第一格。 */
export function bagMakeLead(team: readonly string[], index: number): string[] {
  if (index <= 0 || index >= team.length) return [...team];
  const next = [...team];
  const [id] = next.splice(index, 1);
  if (id === undefined) return [...team];
  next.unshift(id);
  return next;
}
