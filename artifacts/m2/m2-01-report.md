# M2-01 执行报告：synthetic-v2 规则、内容包、feature-gated 编译层

日期：2026-09-26。基线：`e06f507`（M1-06）。对应 roadmap M2"机制与插件"第一刀。

## 交付物

| 交付物 | 内容 |
|---|---|
| `docs/rules/synthetic-v2.md` | v2 冻结规范：bench/replacement/stat_ops(transfer+clear)/damage_kinds(standard,fixed,percent,true)/control(stun,cleanse,immune)/revive/apply_effect/mode_overlay + 不变量 |
| `docs/adr/006-m2-mechanics.md` | **ADR-006**：feature-gated IR 决策——v1 包在 v2 引擎下 hash 逐字节不变的实现口径 |
| `content/rulesets/synthetic-v2.json` | features 全开 + 9-op allowlist + damageKinds + boss overlay |
| `content/synthetic-v2/` | 3 单位（gamma/delta revives:1/epsilon boss）+ 12 动作 |
| schema 扩展 | ruleset `features`/`damageKinds`/`modeOverlays`；units `revives`/`mode`；moves `kind`/`name`/`turns`+per-op then 条件 |
| `loader.ts` | CompiledEffect 全 op union + CompiledUnit revives/mode + FrozenPack features/modeOverlays + **op→feature 语义门禁** |

## 验收

- `pnpm content:validate` → PASS（v1+v2 双包同验，0 findings）
- `loader-v2.test.ts` = **10/10**：v2 编译全 op 元数据、v1 规则集下 6 种语义级拒绝（transfer/control/kind:true/revives/mode/未知 op）、无 overlay 项的 mode 拒绝、"新单位只加数据"（纯 JSON 追加 → 编译过且 contentHash 变化）

## 设计决定（诚实记录）

- **版本隔离口径**：v1 不写 `bench` 字段、不挂新事件键——hash 不变靠"不写"而非"写空值"
- `damage` 无 `kind` ≡ standard：v1 内容零改动即可在 v2 引擎编译
- v2 全部新 op **编译时已接入** CompiledEffect，但引擎执行语义在 M2-02/03 才接——当前 v2 包可编译不可对战（applyTurn 未实现新 op → EngineFault，符合"未知执行语义显式失败"纪律）

## 下一步 = M2-02

引擎机制①：transfer_stages/clear_stages/伤害分类/control(3)/overlay 免疫——不含 switch/replacement（独立大活）。
