# 数据与内容管线 v0.2

## 1. 规则版本与真实性

现代赛尔号是目标方向；**本次未锁定可验证的具体原作快照、未导入任何真实精灵**。工程规则使用 `synthetic-v1`，目标原作使用另一个带日期/模式/证据索引的 ID，禁止混包后宣称兼容。

区分两个独立维度：`verification = SYNTHETIC | UNVERIFIED | VERIFIED | CONFLICTED`；`implementation = UNSUPPORTED | IMPLEMENTED | TESTED`。实现测试通过不等于原作真实性 VERIFIED。缺字段用显式 unknown，不能默认 0；来源声称与实测冲突标 CONFLICTED。

一个 RuleClaim 至少包含 claimId、targetSnapshot、mode、命题与边界、source kind/URI、observedAt、evidence digest、reviewer、verification、关联 fixture IDs。来源可为官方描述、实测记录、社区资料；技能说明不一定证明隐含执行顺序。若证据无法公开，公开 claim 只放可分发摘要和摘要 hash、访问状态，不泄露本地绝对路径或私人资料。

## 2. 五层管线与发布门禁

RawEvidence → ParsedDraft → CanonicalData → CompiledContent → RuntimeSnapshot。

1. Capture：固定源文件摘要、采集时间、版本与权利信息；保持原记录不可变。
2. Parse：LLM/解析器只产 draft；记录模型/解析器版本、歧义字段，不能直接覆盖 canonical。
3. Normalize：稳定 ID、单位、目标选择器、duration/stackPolicy、模式；保留上游 ID 映射但不绑定 UI 名称。
4. Validate：JSON Schema、外键、循环引用、数值范围、operator 支持、资源 path/hash/尺寸、依赖版本。声明式树节点/深度/大小有上限。
5. Verify：独立人工 expected 或可追溯对照实验；缺规则证据的原作 claim 留 pending。严禁让实现输出充当唯一 golden 答案。
6. Compile：生成不可变 typed IR、active trigger 索引构建材料、公开知识元数据、资源 manifest；无可执行文本。
7. Publish：确定性排序/编码/hash；同输入重复编译字节相同；署明工具链版本。签名证明来源，不能证明规则正确或资产许可。
8. Load：校验完整 bundle digest、ruleset/IR/executable 兼容；启动对局时 pin。未知 operator/不匹配 hash fail closed。

M0/M1 synthetic 可以 TESTED，但不变 VERIFIED 原作。正式原作模式只允许 VERIFIED 且 TESTED 的所需规则闭包；少一个依赖就禁用该内容，不静默删效果。原始素材或尚不支持精灵可以留在私有研究区，不进入公开发行。

## 3. 数据模型

实体：species/variant、move、passive/effect、equipment、mode modifier、map/quest、rule claim、asset。技能文本、机制 IR、条件化攻略分表。每个 effect 的 requires/produces 来自 AST 或被校验的 handler metadata；counters 另存具体状态、假设、模拟种子和版本，不能直接写进权威规则。

内容包包含 `id/version/schemaVersion/rulesetCompatibility/dependencies/operators/assets/provenance/verification` 与内容摘要；资源单独 hash，换立绘不更改战斗语义 hash。具体精灵实例含等级/培养/配招等，进入局时做快照。未核验刻印、抗性、等级公式等不在 M1 猜测实现。

## 4. 公开与私有边界

这是发布策略，不是法律许可判断。公开仓库仅放本项目编写的工程数据/测试、自有或明确获授权素材、允许分发的元数据。未经许可的原作图像/动画/音乐/文本、客户端/SWF 不入库，也不自动提供抓取/解包下载流程。公开网页可看见不代表可重新分发。

资产清单至少记录 license identifier 或书面授权 reference、作者、来源、digest、是否可公开、署名要求。缺项/unknown 的资产拒绝进入 public build。许可证扫描能验证清单完整性，不能自动证明权利真实；发布前由维护者确认。缺视觉资产用自制几何占位，逻辑继续推进。

私有资料位置由用户配置引用，不在仓库硬编码路径、凭据或带 token URL。研究构建与公开构建输出分目录并有不同 allowlist。解压前检查总大小/文件数/压缩比、禁止路径穿越与符号链接逃逸；资源不允许嵌入任意脚本。

## 5. 内容导入与扩容验收

新普通精灵只新增数据/fixture；不支持的新语义先升级通用 operator，再导入。原作规则冲突形成新 snapshot/overlay，不覆盖旧版本 expected。机制覆盖矩阵按 trigger、damage kind、控制/免疫、强化/吸强、切换/复活、模式列出已证/已实现/已测数量，禁止只按精灵总数宣传覆盖。

每次编译输出 `content-report.json`：sources/claims、unknown/conflicted、missing refs/operators、fixture status、license gaps、bundle hashes。M1 原作用例为零可以如实通过 synthetic 工程 gate，但不能通过原作兼容 gate。

## 6. 版本与存档迁移

独立管理 wire protocol、engine executable、ruleset、IR schema、content、assets、save schema、replay schema。兼容性不能只看一个 semver。详细规则见 [ADR-005](adr/005-versions-and-migrations.md)。

存档包含按插件 namespace 分区的 payload/version；迁移 source→target 显式链，先 dry-run、新文件/新表生成、校验、备份，再事务切换。失败保留原数据；降级软件默认打开旧备份，不承诺自动逆迁移。未知插件字段只保留不删除。局内状态不随存档迁移，旧 replay 必须配旧可执行工件。
