/**
 * 背包编制：出战 6 + 待命 6。移出出战位时后面的往前补。
 */
import { describe, expect, it } from "vitest";
import { BAG_SIZE, BATTLE_SIZE, bagAdd, bagMakeLead, bagRemoveAt, bagReplace, bagToggle, battleParty } from "../../apps/client/src/party.ts";

const six = ["a", "b", "c", "d", "e", "f"];

describe("bag party", () => {
  it("追加先填出战，再进待命；第 13 只不加", () => {
    let team: string[] = [];
    for (let i = 0; i < BAG_SIZE; i++) team = bagAdd(team, `s${i}`);
    expect(team).toHaveLength(12);
    expect(battleParty(team)).toEqual(["s0", "s1", "s2", "s3", "s4", "s5"]);
    expect(team.slice(BATTLE_SIZE)).toEqual(["s6", "s7", "s8", "s9", "s10", "s11"]);
    expect(bagAdd(team, "s12")).toEqual(team);
  });

  it("点已在背包的种类，拿走全部同种", () => {
    expect(bagToggle(["a", "b", "a"], "a")).toEqual(["b"]);
    expect(bagToggle(["a"], "b")).toEqual(["a", "b"]);
  });

  it("移出出战位时后面的精灵前移，待命可以补进出战", () => {
    const team = [...six, "g", "h"];
    expect(bagRemoveAt(team, 1)).toEqual(["a", "c", "d", "e", "f", "g", "h"]);
    expect(battleParty(bagRemoveAt(team, 1))).toEqual(["a", "c", "d", "e", "f", "g"]);
  });

  it("待命设为首发时，原来的第 6 只落到待命第一格", () => {
    const team = [...six, "g", "h"];
    expect(bagMakeLead(team, 6)).toEqual(["g", "a", "b", "c", "d", "e", "f", "h"]);
  });

  it("替换指定格子", () => {
    expect(bagReplace([...six], 5, "z")).toEqual(["a", "b", "c", "d", "e", "z"]);
  });
});
