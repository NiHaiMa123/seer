# Soulmark source-to-runtime audit manifest

Date: 2026-10-20

The machine-readable companion [soulmark-guard-sweep-manifest.json](soulmark-guard-sweep-manifest.json) contains the final per-ID baseline dispositions, old signatures, exact current mappings, reviewed corrections, unresolved old indexes, link state, and parser residuals. The durable pre-sweep comparison input is [soulmark-guard-dropped-baseline-2026-10-20.json](soulmark-guard-dropped-baseline-2026-10-20.json).

## Final counts

| Measure | Count |
|---|---:|
| Creature IDs reviewed | 150 |
| Persistent saved-IR baseline entries | 435 |
| Exact old entries still present | 169 |
| Corrected or partially mapped old entries | 17 |
| Current effect entries representing those corrections | 18 |
| Uniquely evidenced deleted old entries | 209 |
| Old baseline entries with unresolved final mapping | 40 |
| Disposition identity | `435 = 169 exact + 17 corrected/partial + 209 deleted + 40 unresolved` |
| Current soulmark directories / mounted creature references | 1600 / 1589 |
| Empty effect directories / dangling references | 0 / 0 |
| Earlier empty-cleanup IDs still absent and unlinked | 49 of 50 |
| Parser residual fragments (diagnostic only) | 352 |

Deleted-key counting uses unique `creatureId#oldIndex` identities from the durable `saved.effects` baseline. The 210 row-level removal references deduplicate to 208 keys (`pet-4499#3` and `pet-4499#6` are each repeated); the earlier repaired `pet-4695#0` adds one, yielding 209. First-sweep and late-correction reports add no new unique key beyond those. The historical 110 round-two *current-content effect removals* do not all map one-to-one to saved-baseline indexes, so they are retained as operation history and are not added to this baseline deletion count. The 40 unresolved indexes are explicitly listed per ID; they are not certified safe or counted as deleted.

The 50 historical empty-cleanup IDs are unique; 49 remain absent and unlinked. `pet-4695` was intentionally restored with its independently supported +400 HP opener. The opener is a current source mapping rather than a correction of a saved-baseline entry, so it is listed separately and does not change the 209 deletion or 17 correction counts.

## Behavior boundaries

- `pet-3623` now keeps both permanent, mutually exclusive dodge windows as stacked instances, each limited to attack skills (`cat:4`). The real-pack test checks lazy first-turn installation, exactly one active window, attribute-skill exclusion, and switching 50%↔80% when the HP relation changes. The false `not prevApplied` damage-reduction fallback is removed.
- `pet-3647` and `pet-3802` use actual dealt HP for damage and matching self-heal, with a capped growth axis. Runtime tests cover a target with less HP than the theoretical percentage and the first growth amount. The source says “use an attack skill,” while current `onMoveUsed` dispatch occurs only after a successful hit; the MISS case remains an explicit event-contract limitation.
- `pet-4417` uses the tested per-lost-HP attack scaler with `kindMask:4`; full HP reads 0%, half HP reads 100%, and fixed/percent/true damage read 0%. The stable parser still defers the nested turn-start-to-attack clause, so the manual mapping is explicitly identified.
- `pet-4489` snapshots mark eligibility at turn start. The turn-end fixed-damage payload is held by the marked unit, respects fixed immunity, and still resolves after the mark is lost mid-turn; gaining the mark later does not activate it for that turn.
- `pet-4695` has only the independent battle-start +400 HP cap. Its linked four-trigger branch with permanent HP cost and the later max-HP comparison branches are deferred. The opener is not boss-gated, following the parser's local-scope reading.
- `pet-4814` retains the PP restoration and stage inversion guarded by `weCounterFoe`, the existing own-type-chart comparison for “自身克制对手.” The reverse `foeCountersUs` guard and the unrelated power multiplier are not used for that clause. The separate weak-to-foe heal and fixed/percent reduction branches remain deferred.
- The manually curated Peak12 default-mount policy remains unchanged; the 12 exact `creature.id` links are absent. Parser residual fragments count segmentation output, not erroneous effects or new defects.

The focused real-pack runtime suite was rerun after the final content changes: 16 tests passed. The repository-wide final gate is coordinated separately.

## Per-ID final baseline disposition

“Exact” means the full saved entry is still present verbatim. “Corrected” means a reviewed mapping now exists, possibly across multiple current entries; it does not imply unsupported sibling clauses are implemented. “Deleted” counts only a unique old baseline index with source-to-runtime evidence. “Unresolved” means this pass has no final mapping proof and makes no safety claim.

| Creature ID | Mark ID | Current state | Exact | Corrected | Deleted | Unresolved | Source residual clauses |
|---|---|---|---:|---:|---:|---:|---:|
| pet-2680 | sm-2680 | unlinked / directory absent | 0 | 0 | 1 | 0 | 1 |
| pet-3488 | sm-3488 | linked | 1 | 0 | 1 | 0 | 1 |
| pet-3587 | sm-3587 | linked | 2 | 0 | 1 | 0 | 1 |
| pet-3623 | sm-3623 | linked | 0 | 1 | 0 | 0 | 1 |
| pet-3647 | sm-3647 | linked | 1 | 1 | 0 | 1 | 1 |
| pet-3736 | sm-3736 | linked | 2 | 0 | 0 | 0 | 1 |
| pet-3750 | sm-3750 | linked | 2 | 0 | 1 | 0 | 1 |
| pet-3760 | sm-3760 | linked | 1 | 0 | 2 | 0 | 2 |
| pet-3789 | sm-3789 | unlinked / directory absent | 0 | 0 | 3 | 0 | 2 |
| pet-3802 | sm-3802 | linked | 2 | 1 | 0 | 1 | 1 |
| pet-3848 | sm-3848 | linked | 3 | 0 | 1 | 0 | 1 |
| pet-3869 | sm-3869 | linked | 2 | 0 | 1 | 0 | 1 |
| pet-3870 | sm-3870 | linked | 2 | 0 | 3 | 0 | 1 |
| pet-3875 | sm-3875 | linked | 1 | 1 | 2 | 0 | 1 |
| pet-3886 | sm-3886 | unlinked / directory absent | 0 | 0 | 1 | 0 | 1 |
| pet-3897 | sm-3897 | linked | 1 | 1 | 0 | 1 | 3 |
| pet-3917 | sm-3917 | unlinked / directory absent | 0 | 0 | 2 | 0 | 2 |
| pet-3928 | sm-3928 | linked | 1 | 0 | 1 | 0 | 1 |
| pet-3941 | sm-3941 | linked | 3 | 0 | 1 | 0 | 1 |
| pet-3951 | sm-3951 | linked | 3 | 0 | 0 | 0 | 1 |
| pet-3959 | sm-3959 | linked | 2 | 0 | 2 | 0 | 2 |
| pet-3965 | sm-3965 | unlinked / directory absent | 0 | 0 | 0 | 2 | 1 |
| pet-3970 | sm-3970 | linked | 1 | 0 | 1 | 0 | 1 |
| pet-4034 | sm-4034 | linked | 2 | 0 | 1 | 0 | 1 |
| pet-4035 | sm-4035 | unlinked / directory absent | 0 | 0 | 4 | 0 | 4 |
| pet-4132 | sm-4132 | linked | 1 | 0 | 3 | 0 | 2 |
| pet-4193 | sm-4193 | linked | 1 | 0 | 1 | 0 | 1 |
| pet-4220 | sm-4220 | linked | 1 | 1 | 0 | 2 | 3 |
| pet-4227 | sm-4227 | linked | 1 | 0 | 3 | 0 | 3 |
| pet-4288 | sm-4288 | unlinked / directory absent | 0 | 0 | 0 | 4 | 2 |
| pet-4300 | sm-4300 | linked | 1 | 0 | 1 | 0 | 1 |
| pet-4302 | sm-4302 | linked | 1 | 0 | 2 | 0 | 1 |
| pet-4318 | sm-4318 | linked | 3 | 0 | 1 | 0 | 1 |
| pet-4323 | sm-4323 | linked | 2 | 0 | 0 | 0 | 1 |
| pet-4326 | sm-4326 | unlinked / directory absent | 0 | 0 | 2 | 0 | 2 |
| pet-4330 | sm-4330 | linked | 1 | 0 | 2 | 0 | 2 |
| pet-4332 | sm-4332 | linked | 3 | 0 | 1 | 0 | 1 |
| pet-4343 | sm-4343 | linked | 1 | 1 | 0 | 2 | 3 |
| pet-4350 | sm-4350 | linked | 1 | 0 | 0 | 1 | 2 |
| pet-4355 | sm-4355 | linked | 5 | 0 | 1 | 0 | 1 |
| pet-4358 | sm-4358 | unlinked / directory absent | 0 | 0 | 3 | 0 | 3 |
| pet-4365 | sm-4365 | linked | 1 | 0 | 2 | 0 | 2 |
| pet-4367 | sm-4367 | linked | 2 | 0 | 1 | 0 | 1 |
| pet-4372 | sm-4372 | linked | 3 | 0 | 1 | 0 | 2 |
| pet-4373 | sm-4373 | unlinked / directory absent | 0 | 0 | 0 | 2 | 1 |
| pet-4377 | sm-4377 | unlinked / directory absent | 0 | 0 | 0 | 2 | 1 |
| pet-4386 | sm-4386 | linked | 2 | 1 | 1 | 0 | 2 |
| pet-4388 | sm-4388 | linked | 1 | 0 | 3 | 0 | 2 |
| pet-4390 | sm-4390 | linked | 1 | 0 | 2 | 0 | 2 |
| pet-4391 | sm-4391 | linked | 0 | 1 | 1 | 0 | 1 |
| pet-4398 | sm-4398 | linked | 3 | 0 | 0 | 1 | 2 |
| pet-4400 | sm-4400 | linked | 1 | 0 | 1 | 0 | 1 |
| pet-4401 | sm-4401 | linked | 4 | 0 | 2 | 0 | 2 |
| pet-4407 | sm-4407 | linked | 2 | 0 | 0 | 0 | 1 |
| pet-4414 | sm-4414 | unlinked / directory absent | 0 | 0 | 3 | 0 | 1 |
| pet-4417 | sm-4417 | linked | 0 | 2 | 1 | 0 | 1 |
| pet-4421 | sm-4421 | unlinked / directory absent | 0 | 0 | 2 | 0 | 2 |
| pet-4426 | sm-4426 | linked | 1 | 0 | 1 | 0 | 2 |
| pet-4427 | sm-4427 | linked | 2 | 0 | 0 | 0 | 1 |
| pet-4435 | sm-4435 | unlinked / directory absent | 0 | 0 | 3 | 0 | 2 |
| pet-4442 | sm-4442 | unlinked / directory absent | 0 | 0 | 2 | 0 | 3 |
| pet-4450 | sm-4450 | unlinked / directory absent | 0 | 0 | 2 | 3 | 3 |
| pet-4461 | sm-4461 | linked | 3 | 0 | 1 | 0 | 1 |
| pet-4467 | sm-4467 | linked | 1 | 0 | 0 | 0 | 1 |
| pet-4472 | sm-4472 | linked | 1 | 0 | 1 | 0 | 2 |
| pet-4477 | sm-4477 | linked | 2 | 0 | 1 | 0 | 1 |
| pet-4483 | sm-4483 | linked | 1 | 0 | 4 | 0 | 2 |
| pet-4489 | sm-4489 | linked | 3 | 2 | 3 | 0 | 6 |
| pet-4490 | sm-4490 | linked | 1 | 0 | 3 | 0 | 3 |
| pet-4494 | sm-4494 | linked | 2 | 0 | 1 | 0 | 2 |
| pet-4496 | sm-4496 | unlinked / directory absent | 0 | 0 | 2 | 0 | 2 |
| pet-4497 | sm-4497 | unlinked / directory absent | 0 | 0 | 2 | 0 | 2 |
| pet-4499 | sm-4499 | unlinked / directory absent | 0 | 0 | 7 | 0 | 2 |
| pet-4507 | sm-4507 | linked | 1 | 0 | 2 | 0 | 2 |
| pet-4509 | sm-4509 | unlinked / directory absent | 0 | 0 | 3 | 0 | 4 |
| pet-4510 | sm-4510 | linked | 2 | 0 | 0 | 0 | 1 |
| pet-4511 | sm-4511 | linked | 1 | 0 | 1 | 0 | 2 |
| pet-4524 | sm-4524 | linked | 1 | 0 | 1 | 0 | 1 |
| pet-4525 | sm-4525 | linked | 1 | 0 | 1 | 0 | 1 |
| pet-4531 | sm-4531 | linked | 1 | 0 | 0 | 1 | 1 |
| pet-4532 | sm-4532 | linked | 1 | 0 | 3 | 0 | 3 |
| pet-4535 | sm-4535 | linked | 4 | 0 | 1 | 0 | 2 |
| pet-4542 | sm-4542 | unlinked / directory absent | 0 | 0 | 1 | 0 | 2 |
| pet-4544 | sm-4544 | unlinked / directory absent | 0 | 0 | 1 | 0 | 1 |
| pet-4547 | sm-4547 | unlinked / directory absent | 0 | 0 | 2 | 0 | 2 |
| pet-4553 | sm-4553 | unlinked / directory absent | 0 | 0 | 2 | 0 | 1 |
| pet-4554 | sm-4554 | unlinked / directory absent | 0 | 0 | 1 | 0 | 2 |
| pet-4556 | sm-4556 | linked | 0 | 1 | 1 | 0 | 3 |
| pet-4561 | sm-4561 | linked | 2 | 0 | 1 | 0 | 1 |
| pet-4567 | sm-4567 | linked | 3 | 0 | 2 | 0 | 2 |
| pet-4568 | sm-4568 | linked | 2 | 0 | 2 | 0 | 2 |
| pet-4573 | sm-4573 | linked | 1 | 0 | 1 | 0 | 1 |
| pet-4588 | sm-4588 | linked | 3 | 0 | 0 | 0 | 1 |
| pet-4589 | sm-4589 | linked | 5 | 0 | 1 | 0 | 1 |
| pet-4592 | sm-4592 | unlinked / directory absent | 0 | 0 | 3 | 0 | 3 |
| pet-4593 | sm-4593 | linked | 4 | 0 | 1 | 0 | 1 |
| pet-4599 | sm-4599 | linked | 1 | 0 | 1 | 0 | 1 |
| pet-4611 | sm-4611 | linked | 2 | 0 | 4 | 0 | 4 |
| pet-4617 | sm-4617 | linked | 1 | 0 | 4 | 0 | 2 |
| pet-4621 | sm-4621 | linked | 1 | 0 | 2 | 0 | 1 |
| pet-4625 | sm-4625 | linked | 1 | 0 | 1 | 0 | 3 |
| pet-4629 | sm-4629 | unlinked / directory absent | 0 | 0 | 1 | 0 | 1 |
| pet-4634 | sm-4634 | linked | 1 | 0 | 2 | 0 | 1 |
| pet-4635 | sm-4635 | linked | 1 | 0 | 1 | 0 | 1 |
| pet-4644 | sm-4644 | linked | 0 | 0 | 0 | 1 | 2 |
| pet-4648 | sm-4648 | linked | 1 | 0 | 1 | 0 | 1 |
| pet-4653 | sm-4653 | linked | 2 | 0 | 1 | 0 | 1 |
| pet-4654 | sm-4654 | unlinked / directory absent | 0 | 0 | 3 | 0 | 3 |
| pet-4655 | sm-4655 | linked | 1 | 0 | 2 | 0 | 3 |
| pet-4656 | sm-4656 | linked | 2 | 0 | 1 | 0 | 1 |
| pet-4662 | sm-4662 | unlinked / directory absent | 0 | 0 | 3 | 0 | 1 |
| pet-4663 | sm-4663 | unlinked / directory absent | 0 | 0 | 1 | 1 | 2 |
| pet-4665 | sm-4665 | linked | 3 | 0 | 0 | 0 | 1 |
| pet-4671 | sm-4671 | unlinked / directory absent | 0 | 0 | 2 | 0 | 2 |
| pet-4677 | sm-4677 | linked | 1 | 0 | 2 | 0 | 2 |
| pet-4679 | sm-4679 | unlinked / directory absent | 0 | 0 | 2 | 0 | 2 |
| pet-4685 | sm-4685 | unlinked / directory absent | 0 | 0 | 2 | 0 | 2 |
| pet-4695 | sm-4695 | linked | 0 | 0 | 2 | 0 | 2 |
| pet-4700 | sm-4700 | unlinked / directory absent | 0 | 0 | 1 | 0 | 2 |
| pet-4706 | sm-4706 | unlinked / directory absent | 0 | 0 | 1 | 0 | 2 |
| pet-4738 | sm-4738 | linked | 2 | 0 | 0 | 0 | 1 |
| pet-4740 | sm-4740 | linked | 1 | 0 | 1 | 0 | 1 |
| pet-4745 | sm-4745 | unlinked / directory absent | 0 | 0 | 2 | 0 | 2 |
| pet-4747 | sm-4747 | linked | 3 | 0 | 1 | 0 | 1 |
| pet-4749 | sm-4749 | linked | 0 | 0 | 2 | 2 | 2 |
| pet-4759 | sm-4759 | unlinked / directory absent | 0 | 0 | 2 | 0 | 2 |
| pet-4761 | sm-4761 | linked | 5 | 0 | 1 | 0 | 1 |
| pet-4765 | sm-4765 | linked | 1 | 0 | 0 | 2 | 2 |
| pet-4802 | sm-4802 | unlinked / directory absent | 0 | 0 | 0 | 1 | 1 |
| pet-4805 | sm-4805 | linked | 1 | 0 | 1 | 0 | 2 |
| pet-4814 | sm-4814 | linked | 0 | 1 | 3 | 0 | 2 |
| pet-4818 | sm-4818 | unlinked / directory absent | 0 | 0 | 0 | 1 | 1 |
| pet-4823 | sm-4823 | linked | 2 | 0 | 0 | 1 | 2 |
| pet-4834 | sm-4834 | linked | 1 | 2 | 1 | 0 | 3 |
| pet-4835 | sm-4835 | unlinked / directory absent | 0 | 0 | 2 | 0 | 2 |
| pet-4853 | sm-4853 | unlinked / directory absent | 0 | 0 | 0 | 2 | 1 |
| pet-4854 | sm-4854 | unlinked / directory absent | 0 | 0 | 2 | 0 | 1 |
| pet-4863 | sm-4863 | linked | 2 | 0 | 2 | 0 | 1 |
| pet-4870 | sm-4870 | unlinked / directory absent | 0 | 0 | 4 | 0 | 3 |
| pet-4875 | sm-4875 | linked | 2 | 0 | 0 | 2 | 2 |
| pet-4890 | sm-4890 | linked | 4 | 0 | 0 | 0 | 1 |
| pet-4894 | sm-4894 | unlinked / directory absent | 0 | 0 | 2 | 0 | 2 |
| pet-4898 | sm-4898 | unlinked / directory absent | 0 | 0 | 3 | 0 | 3 |
| pet-4902 | sm-4902 | unlinked / directory absent | 0 | 0 | 2 | 0 | 4 |
| pet-4906 | sm-4906 | unlinked / directory absent | 0 | 0 | 2 | 0 | 1 |
| pet-4908 | sm-4908 | unlinked / directory absent | 0 | 0 | 1 | 1 | 3 |
| pet-4911 | sm-4911 | linked | 2 | 0 | 0 | 1 | 2 |
| pet-4915 | sm-4915 | linked | 2 | 0 | 1 | 0 | 2 |
| pet-4928 | sm-4928 | unlinked / directory absent | 0 | 0 | 0 | 1 | 1 |
| pet-4940 | sm-4940 | linked | 0 | 0 | 1 | 1 | 2 |
