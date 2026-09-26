# 原作规则 Claim Register

每条原作规则命题一个 JSON 文件，字段见 `content/schemas/claim.schema.json` 与 `docs/data-and-content.md` §1。

- 复制 `_template.claim.json` 改名建档（`CLAIM-<topic>-<seq>.claim.json`）；`_` 前缀文件不参与校验。
- `verification` 取值：`UNVERIFIED`（默认）→ `VERIFIED` / `CONFLICTED`；无证据不标 VERIFIED。
- `evidenceDigest` 是原始证据（录像/记录/官方描述存档）的 SHA-256；证据不可公开时只填摘要并在 `source.uri` 说明访问方式。
- 每个 claim 关联 `fixtureIds`；pending 的 claim 不计入通过率，也不进入可玩 ruleset。

当前原作 VERIFIED claim 数：0（`pnpm content:validate` 汇总输出）。
