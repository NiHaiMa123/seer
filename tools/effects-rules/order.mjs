/** 技能规则的唯一拼接顺序。家族之间的先后只改这个文件。先命中先生效。 */
import { rules as flags } from "./flags.mjs";
import { rules as ignored } from "./ignored.mjs";
import { rules as ailment } from "./ailment.mjs";
import { rules as stages } from "./stages.mjs";
import { rules as clear } from "./clear.mjs";
import { rules as heal } from "./heal.mjs";
import { rules as batchE6 } from "./batch-e6.mjs";
import { rules as batchE5 } from "./batch-e5.mjs";
import { rules as batchE5b } from "./batch-e5b.mjs";
import { rules as batchE5d } from "./batch-e5d.mjs";
import { rules as batchE5e } from "./batch-e5e.mjs";
import { rules as batchE5f } from "./batch-e5f.mjs";
import { rules as batchE5g } from "./batch-e5g.mjs";
import { rules as batchE5h } from "./batch-e5h.mjs";
import { rules as penalty } from "./penalty.mjs";
import { rules as batchE5c } from "./batch-e5c.mjs";
import { rules as deferred } from "./deferred.mjs";
import { rules as timed } from "./timed.mjs";
import { rules as timedBare } from "./timed-bare.mjs";
import { rules as nextAlly } from "./next-ally.mjs";
import { rules as attachDamage } from "./attach-damage.mjs";
import { rules as attachAll } from "./attach-all.mjs";
import { rules as misc } from "./misc.mjs";
import { rules as marks } from "./marks.mjs";
import { rules as batchE7 } from "./batch-e7.mjs";
import { rules as batchE8 } from "./batch-e8.mjs";
import { rules as batchE9 } from "./batch-e9.mjs";
import { rules as batchE10 } from "./batch-e10.mjs";
import { rules as batchE11 } from "./batch-e11.mjs";
import { rules as batchE12 } from "./batch-e12.mjs";
import { rules as batchE13 } from "./batch-e13.mjs";
import { rules as batchE14 } from "./batch-e14.mjs";
import { rules as batchE15 } from "./batch-e15.mjs";
import { rules as batchE16 } from "./batch-e16.mjs";
import { rules as batchE17 } from "./batch-e17.mjs";
import { rules as batchE18 } from "./batch-e18.mjs";
import { rules as batchE19 } from "./batch-e19.mjs";
import { rules as batchE20 } from "./batch-e20.mjs";
import { rules as batchE21 } from "./batch-e21.mjs";
import { rules as batchE22 } from "./batch-e22.mjs";
import { rules as batchE23 } from "./batch-e23.mjs";
import { rules as batchE24 } from "./batch-e24.mjs";
import { rules as batchE25 } from "./batch-e25.mjs";
import { rules as batchE26 } from "./batch-e26.mjs";
import { rules as batchE27 } from "./batch-e27.mjs";
import { rules as batchE28 } from "./batch-e28.mjs";
import { rules as batchE29 } from "./batch-e29.mjs";
import { rules as batchE30 } from "./batch-e30.mjs";
import { rules as batchE31 } from "./batch-e31.mjs";
import { rules as batchE32 } from "./batch-e32.mjs";
import { rules as batchE33 } from "./batch-e33.mjs";
import { rules as batchE34 } from "./batch-e34.mjs";
import { rules as batchE35 } from "./batch-e35.mjs";
import { rules as batchE36 } from "./batch-e36.mjs";
import { rules as batchE37 } from "./batch-e37.mjs";
import { rules as batchE38 } from "./batch-e38.mjs";
import { rules as batchE39 } from "./batch-e39.mjs";
import { rules as batchE40 } from "./batch-e40.mjs";
import { rules as batchE41 } from "./batch-e41.mjs";
import { rules as batchE42 } from "./batch-e42.mjs";
import { rules as batchE43 } from "./batch-e43.mjs";
import { rules as batchE44 } from "./batch-e44.mjs";
import { rules as batchE45 } from "./batch-e45.mjs";
import { rules as batchE46 } from "./batch-e46.mjs";
import { rules as batchE47 } from "./batch-e47.mjs";
import { rules as batchE48 } from "./batch-e48.mjs";
import { rules as batchE49 } from "./batch-e49.mjs";
import { rules as batchE50 } from "./batch-e50.mjs";
import { rules as batchE51 } from "./batch-e51.mjs";
import { rules as batchE52 } from "./batch-e52.mjs";
import { rules as batchE53 } from "./batch-e53.mjs";
// mech 家族文件：新机制句子的落点。全文件排在最后，只保证同文件内新规则在更宽旧规则之前。
import { rules as batchMech } from "./batch-mech.mjs";
// remain 家族文件：mech 判定「勾子接不住」、这一轮补齐的那批。排在 batchMech 之后。
import { rules as batchRemain } from "./batch-remain.mjs";
import { rules as batchW01 } from "./batch-w01.mjs";
import { rules as batchW02 } from "./batch-w02.mjs";
import { rules as batchW03 } from "./batch-w03.mjs";
import { rules as batchW04 } from "./batch-w04.mjs";
import { rules as batchW05 } from "./batch-w05.mjs";
import { rules as batchW06 } from "./batch-w06.mjs";
import { rules as batchW07 } from "./batch-w07.mjs";
import { rules as batchW08 } from "./batch-w08.mjs";
import { rules as batchW09 } from "./batch-w09.mjs";
import { rules as batchW10 } from "./batch-w10.mjs";
import { rules as batchW11 } from "./batch-w11.mjs";
import { rules as batchW12 } from "./batch-w12.mjs";
import { rules as batchR2e } from "./batch-r2e.mjs";

export const RULES = [
  ...flags,
  ...ignored,
  ...ailment,
  ...stages,
  ...clear,
  ...heal,
  ...batchE6,
  ...batchW10,
  ...batchE5,
  ...batchE5b,
  ...batchE5d,
  ...batchE5e,
  ...batchE5f,
  ...batchE5g,
  ...batchE5h,
  ...penalty,
  ...batchE5c,
  ...deferred,
  ...timed,
  ...timedBare,
  ...nextAlly,
  ...attachDamage,
  ...attachAll,
  ...misc,
  ...marks,
  ...batchE7,
  ...batchE8,
  ...batchE9,
  ...batchE10,
  ...batchE11,
  ...batchE12,
  ...batchE13,
  ...batchE14,
  ...batchE15,
  ...batchE16,
  ...batchE17,
  ...batchE18,
  ...batchE19,
  ...batchE20,
  ...batchE21,
  ...batchE22,
  ...batchE23,
  ...batchE24,
  ...batchE25,
  ...batchE26,
  ...batchE27,
  ...batchE28,
  ...batchE29,
  ...batchE30,
  ...batchE31,
  ...batchE32,
  ...batchE33,
  ...batchE34,
  ...batchE35,
  ...batchE36,
  ...batchE37,
  ...batchE38,
  ...batchE39,
  ...batchE40,
  ...batchE41,
  ...batchE42,
  ...batchE43,
  ...batchE44,
  ...batchE45,
  ...batchE46,
  ...batchW09,
  ...batchE47,
  ...batchE48,
  ...batchE49,
  ...batchE50,
  ...batchE51,
  ...batchE52,
  ...batchE53,
  ...batchMech,
  ...batchRemain,
  ...batchW01,
  ...batchW02,
  ...batchW03,
  ...batchW04,
  ...batchW05,
  ...batchW06,
  ...batchW07,
  ...batchW08,
  ...batchW11,
  ...batchW12,
  ...batchR2e,
];
