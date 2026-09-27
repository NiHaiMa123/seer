import type { FrozenPack } from "@seer/battle-core";
import { canonicalJson } from "@seer/contracts";
import { GenerationError, generationIdFromRules, generationIdOf } from "./generations.ts";
import { ProcessTransitionExecutor, type ProcessExecutorConfig, type TransitionExecutor } from "./executor.ts";

export type ArtifactRules = FrozenPack["rules"];
export type ProcessArtifactConfig = Omit<ProcessExecutorConfig, "executableHash">;

const HASH = /^sha256:[0-9a-f]{64}$/;

export class RuntimeArtifactCatalog {
  private readonly packs = new Map<string, FrozenPack>();
  private readonly executors = new Map<string, TransitionExecutor>();

  constructor(packs: readonly FrozenPack[] = []) {
    for (const pack of packs) this.register(pack);
  }

  get size(): number {
    return this.packs.size;
  }

  ids(): string[] {
    return [...this.packs.keys()].sort();
  }

  register(pack: FrozenPack, process?: ProcessArtifactConfig): string {
    const id = generationIdOf(pack);
    const existingPack = this.packs.get(id);
    const existingExecutor = this.executors.get(id);
    if (existingPack) {
      if (existingPack !== pack || Boolean(existingExecutor) !== Boolean(process)) {
        throw new GenerationError("ARTIFACT_CONFLICT", `artifact ${id} is already registered with different runtime data`);
      }
      if (process && existingExecutor instanceof ProcessTransitionExecutor) {
        const timeoutMs = process.timeoutMs ?? 5_000;
        const maxOutputBytes = process.maxOutputBytes ?? 4 * 1024 * 1024;
        if (
          existingExecutor.entrypoint !== process.entrypoint
          || existingExecutor.timeoutMs !== timeoutMs
          || existingExecutor.maxOutputBytes !== maxOutputBytes
          || canonicalJson(existingExecutor.payload) !== canonicalJson(process.payload)
        ) {
          throw new GenerationError("ARTIFACT_CONFLICT", `artifact ${id} is already registered with a different executor`);
        }
      }
      return id;
    }
    this.packs.set(id, pack);
    if (process) {
      this.executors.set(id, new ProcessTransitionExecutor({
        ...process,
        executableHash: pack.rules.executableHash,
      }));
    }
    return id;
  }

  has(id: string): boolean {
    return this.packs.has(id);
  }

  executor(id: string): TransitionExecutor | undefined {
    return this.executors.get(id);
  }

  isIsolated(id: string): boolean {
    return this.executors.has(id);
  }

  require(id: string): FrozenPack {
    const pack = this.packs.get(id);
    if (!pack) throw new GenerationError("ARTIFACT_UNAVAILABLE", `artifact ${id} is unavailable`);
    return pack;
  }

  resolve(rules: ArtifactRules): FrozenPack {
    this.validateRules(rules);
    const id = generationIdFromRules(rules);
    const pack = this.require(id);
    const expected = pack.rules;
    if (
      rules.rulesetId !== expected.rulesetId
      || rules.rulesetVersion !== expected.rulesetVersion
      || rules.irVersion !== expected.irVersion
    ) {
      throw new GenerationError("ARTIFACT_UNAVAILABLE", `artifact metadata mismatch for ${id}`);
    }
    return pack;
  }

  private validateRules(rules: ArtifactRules): void {
    if (
      !rules
      || typeof rules.rulesetId !== "string"
      || typeof rules.rulesetVersion !== "string"
      || !HASH.test(rules.executableHash)
      || !HASH.test(rules.rulesetHash)
      || !HASH.test(rules.contentHash)
      || rules.irVersion !== 1
    ) {
      throw new GenerationError("MALFORMED_RECORD", "persisted artifact rules are malformed");
    }
  }
}
