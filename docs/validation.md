# 本轮验证记录

日期：2026-09-26。审查输入 main：`3dcb760070239b3b723675b7e7d991c08facbcf7`。本记录仅覆盖文档和最小契约示例，不是产品 M0/M1 验收。

| 检查 | 结果 | 范围 |
|---|---|---|
| TypeScript 6.0.3 编译 | PASS，exit 0 | contracts.ts，strict / exactOptionalPropertyTypes / noUncheckedIndexedAccess，ES2022 + DOM |
| Ajv 8.17.1 Schema | PASS，22 cases，exit 0 | Command 的正常值/缺字段/未知字段/伪 actor/范围/类型/长度；未测试领域合法性 |
| 本地 Markdown 链接 | PASS | 逐文件解析相对 Markdown 路径并检查存在；不等于所有外部网站永久可用 |
| Markdown 代码围栏 | PASS | 每文件围栏成对；Mermaid 图未做浏览器视觉渲染 |
| Git diff 空白检查 | PASS | `git diff --check` |
| main 并发更新检查 | 提交前核验 | 没有覆盖其他人的 main；本轮使用独立分支 + PR |
| Cordis / 战斗 / Agent / 性能 | NOT_RUN | 无产品实现；M0+ 按 roadmap 执行 |
| 原作规则真实性 | UNVERIFIED | 无本轮新增 VERIFIED 原作规则，无原作素材导入 |

验证环境：Linux、Node v24.19.0。编译器和 Ajv 安装在仓库外临时目录，未为尚未实现的产品创建 package/lockfile。正式工具链由 M0-01 锁定。

## 复现契约检查（POSIX shell）

在仓库根目录执行；临时目录不入 Git：

```sh
VERIFY_TOOLS_DIR=$(mktemp -d)
npm install --prefix "$VERIFY_TOOLS_DIR" --no-audit --no-fund --ignore-scripts typescript@6.0.3 ajv@8.17.1
node "$VERIFY_TOOLS_DIR/node_modules/typescript/bin/tsc" docs/examples/contracts.ts --strict --exactOptionalPropertyTypes --noUncheckedIndexedAccess --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM --noEmit
node docs/examples/verify-contracts.cjs "$VERIFY_TOOLS_DIR"
git diff --check
```

预期 schema 输出 `status=PASS,cases=22`。这个脚本只验证命令结构，不能证明命令已授权、动作在当前回合合法、引擎确定性、无秘密泄露或高性能；这些必须用真实实现与对应测试验证。
