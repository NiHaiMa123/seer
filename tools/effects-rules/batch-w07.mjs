// batch-w07：站位/相邻/隔位句族。
//
// 语料里带站位词的片段一共十来条，全在同一个双形态魂印族
// （萌芽之薇 pet-4852、纷争之薇 pet-4862、初诞之薇 pet-4889、荣光之薇 pet-4899）和一个句式的四只宿主里。
// 站位序本身没有建模：engine 的侧状态是 unit + bench 两个箱子（packages/battle-core/src/engine.ts:189，
// 没有相邻/隔位的槽位序、没有小队队列），五个 mechanics 目录里也没有任何位置域；
// 魂印层的 party-scope 门把「与自身相邻的精灵…」整句按参照域未建模留在未解析
// （tools/soulmark-parse.mjs:243）。所以这一族里
//   - 「相邻/隔位的精灵」当受体（受治疗/受加成/进入异常/受真伤）——要槽位序；
//   - 「自身位于场下时」——非出战位生效域；
//   - 「每损失/每有 N% 的体力」的档数——引擎里只有**威力**形的步进
//     （`{ op:"power", of:"powerPerMissing", value:{per,pow} }`，例：「释放技能时自身每损失10%的体力值
//     则此技能威力提升10点」），要落在出伤/吸取上得加新 params 键加新结算读取；
// 三类缺口全部超出本路触点预算，缺口清单与要补的结算写在 scratch/parallel/w07-need-op.md。
// 本路因此**没有加任何规则**，本文件保持空表。
//
// 试过又撤回的三条（记在这里免得后来者重走）：
//   ① 「自身每损失N%的体力，下只出战精灵造成的攻击伤害提升M%」→ apply_status(dmg_boost, nextAlly)
//   ② 「自身每有N%的体力，下只出战精灵吸取对手最大体力的M%」  → damage(percent, nextFoe) + heal(nextAlly)
//      两条都开不出来：魂印层 go() 拿到的是**未切分**的整段，规则能吃下，但那样得丢掉
//      「每满一档」的步进（N=10/M=3 的句子里体力满格也照样给 +3%），而带逗号的形态在 public parser 里
//      会被先切分，「下只出战精灵」前缀的落点是 next-unit 家族（attach-damage.mjs:61 兜底）的领地，
//      本路那两条规则实际只对无逗号形生效——同一句两种写法两个结果，不能这样收。
//   ③ 「自身为（己方）最后一只存活精灵时先制+N」→ flags.priorityIf{when:{benchAllDead,noStandbyAlly}}
//      **根本到不了**：句首条件半句「自身为己方最后一只存活精灵时」先被 effects-parse.mjs 的
//      condPrefix 剥成 condOf 的 `{benchAliveEq:0}`（condOf 在 effects-parse.mjs:382 有这条），
//      规则表只在剩余部分「先制+N」上跑；即便没被 condOf 吃掉，attach-all.mjs:14 还有一条
//      `attach-all-07` 把 whole-clause 形态按 `last-alive cond — E4` 挡在规则表里。
//      要改这个谓词得动 condOf 那一行或 attach-all-07——都是别人的公共文件。
// 本文件保持 `export const rules = []`；三条的缺口形状见 w07-need-op.md 的 A/B/C/D 节。
export const rules = [];
