# 数据、规则证据与内容管线 v0.1

## 范围和来源

目标是现代赛尔号规则复刻，历史版本可作为独立 ruleset。不要将任意时期图鉴、技能说明与另一期的机制混用。资料来源需记录原始 URL/文档、抓取时间、目标版本、社区/官方属性、验证人和可信状态。

公开网络图鉴可以辅助研究，但图鉴内容、动画、音乐、精灵图像、原始客户端/SWF 均有不同的许可/权利问题；技术上可提取不等于可分发。公开仓库只保留自行编写或得到许可的数据和资源。允许单独配置用户自己有权使用的私有资产路径，不在仓库中默认打包。

## 分层存储

1. Raw Evidence：不可变原始记录；描述/截图/引用；版权约束与 provenance。
2. Parsed Draft：LLM/解析器初始抽取；UNKNOWN/AMBIGUOUS 字段显式存在。
3. Canonical Data：通过 schema、规则归一化与人工/对照验证的版本化数据。
4. Compiled Content：按 ruleset 编译的只读索引、效果 IR、资源 manifest 和 content hash。
5. Runtime Snapshot：对战开始时锁定可执行规则、精灵与装备具体配置。

数据库建议按 pet species/variant、move、effect definition、passive、items、mode modifier、provenance/verification、assets 分实体。技能/魂印自然语言描述和可执行 Effect DSL 分开；ID 保留上游原始 ID 映射和项目内部稳定 ID。

## 基础 schema 示意

~~~json
{
  "schemaVersion": 1,
  "id": "seer.pet.example",
  "ruleset": "modern-pinned",
  "source": [
    {"uri":"https://example.invalid/source","observedAt":"2026-09-26","status":"UNVERIFIED"}
  ],
  "stats": {"hp":0,"atk":0,"def":0,"spAtk":0,"spDef":0,"speed":0},
  "moves": ["seer.move.example.1"],
  "passive": "seer.effect.example.passive",
  "assets": {"sprite":"asset://placeholder/pet-example"},
  "verification": "DRAFT"
}
~~~

上面数值和 URL 为占位，不能当真实赛尔号数据。字段实际含义/等级计算/刻印/抗性等由选定版本规则规范化，禁止把未经验证的字段设为默认 0 然后进入正式战斗。

## 数据编译流程

~~~text
Capture -> Parse -> Normalize -> Schema validate
 -> Semantic validate (refs, IDs, mode, trigger/operator)
 -> Generate golden fixtures -> Verify against evidence
 -> Compile immutable IR/index -> Package/hash -> Publish
~~~

LLM 可辅助抽取技能描述与条件，但不能直接决定它在原作的确切执行顺序。对“攻击后”“回合结束”等含糊描述必须进入待验证队列。未知效果不得被忽略；引用失效时编译失败。

## 精灵扩充的规则

- 已有 DSL 可表达：仅新增内容 JSON/资源 manifest + fixture；
- DSL 无法表达：先添加通用 mechanic 插件和测试，再加入新精灵；
- 出现与当前 ruleset 冲突：建立版本差异/模式例外，不直接改旧规则；
- 外观素材不具授权：使用 placeholder/自制资产；逻辑可继续开发；
- 对每只内容包生成合法配招、效果引用、资源路径、属性值范围和模式限制的检查。

## 溯源与评测防污染

每条规则保持 source/evidence/verification；每个对局固定 content hash。Agent 训练案例、人工攻略、真实规则证据分表，防止将推测的“破解关系”写成客观规则。

Mechanic Graph 中 produces/requires/consumes 等由 DSL 派生；counters 是条件化结论，必须保存具体状态、模拟/实战证据、适用版本。LLM 生成的解释带 source refs，不应伪装为已验证游戏事实。

## 资源和性能

- UI 精灵图使用 atlas 与多分辨率资源，异步加载；动画和伤害结算分离；
- 场景、特效、音频按资源组预加载/卸载；资产元数据记录尺寸、许可证、hash、依赖；
- 提供缺资源 fallback；资源缺失不改变战斗状态；
- 资源包限尺寸/格式/路径，避免压缩炸弹、目录穿越及任意脚本执行；
- 研究和公开构建两个 pipeline；公开 CI 检查许可证清单。

## 版本管理

ruleset_version、dsl_schema_version、content_hash、plugin_hash、asset_manifest_hash、save_schema_version 各自独立。更新内容不能悄悄改变进行中的战斗；升级存档必须有迁移与 dry-run。数据质量报告统计：已验证/待验证规则、未实现 operator、测试覆盖、授权缺口。
