import { ENGINE_EXECUTABLE_HASH, EngineFault, type CoreState, type FrozenPack } from "@seer/battle-core";
import { internalValidators, type BattleState } from "@seer/contracts/internal";
import { RuntimeGenerationRegistry, GenerationError, generationIdFromRules, generationIdOf, type GenerationLease } from "./generations.ts";
import { RuntimeArtifactCatalog, type ArtifactRules } from "./artifacts.ts";
import { ExecutorError, assertCoreState, assertExecutorBinding } from "./executor.ts";
import { HostError, type HostConfig } from "./types.ts";
import { PersistedBattleHost } from "./persisted.ts";
import type { BattleStore } from "./store.ts";

export type ManagedBattleConfig = Omit<HostConfig, "pack"> & { generationId?: string };
export type RestoreBattleConfig = Omit<HostConfig, "pack" | "battleId" | "seedHex">;

interface ManagedBattle {
  host: PersistedBattleHost;
  generationId: string;
  lease?: GenerationLease;
}

export class BattleManager {
  private readonly hosts = new Map<string, ManagedBattle>();
  private readonly store: BattleStore;
  private readonly fixedPack: FrozenPack | undefined;
  private readonly generations: RuntimeGenerationRegistry | undefined;
  private readonly artifacts: RuntimeArtifactCatalog | undefined;

  constructor(store: BattleStore, runtime: FrozenPack | RuntimeGenerationRegistry, artifacts?: RuntimeArtifactCatalog) {
    this.store = store;
    this.artifacts = artifacts;
    if (runtime instanceof RuntimeGenerationRegistry) {
      this.generations = runtime;
      this.fixedPack = undefined;
    } else {
      this.fixedPack = runtime;
      this.generations = undefined;
    }
  }

  get size(): number {
    return this.hosts.size;
  }

  get(battleId: string): PersistedBattleHost | undefined {
    return this.hosts.get(battleId)?.host;
  }

  require(battleId: string): PersistedBattleHost {
    const host = this.get(battleId);
    if (!host) throw new HostError("NOT_FOUND", `battle ${battleId} not loaded`);
    return host;
  }

  has(battleId: string): boolean {
    return this.hosts.has(battleId);
  }

  ids(): string[] {
    return [...this.hosts.keys()].sort();
  }

  generationOf(battleId: string): string {
    const managed = this.hosts.get(battleId);
    if (!managed) throw new HostError("NOT_FOUND", `battle ${battleId} not loaded`);
    return managed.generationId;
  }

  create(config: ManagedBattleConfig): PersistedBattleHost {
    if (this.hosts.has(config.battleId) || this.store.loadBattle(config.battleId) !== null) {
      throw new HostError("INVALID_SCHEMA", `battle ${config.battleId} already exists`);
    }

    let lease: GenerationLease | undefined;
    let pack: FrozenPack;
    let generationId: string;
    if (this.generations) {
      lease = this.generations.acquire(config.generationId);
      pack = lease.pack;
      generationId = lease.id;
    } else {
      pack = this.fixedPack!;
      generationId = generationIdOf(pack);
      if (config.generationId !== undefined && config.generationId !== generationId) {
        throw new GenerationError("ARTIFACT_UNAVAILABLE", `generation ${config.generationId} is unavailable`);
      }
    }

    const { generationId: _, ...hostConfig } = config;
    const executor = this.artifacts?.executor(generationId);
    if ((pack.rules.executableHash !== ENGINE_EXECUTABLE_HASH || lease?.isolated) && !executor) {
      lease?.release();
      throw new GenerationError("EXECUTABLE_ISOLATION_REQUIRED", `generation ${generationId} has no isolated executor`);
    }
    if (lease && lease.isolated !== (executor !== undefined)) {
      lease.release();
      throw new GenerationError("ARTIFACT_CONFLICT", `generation ${generationId} executor binding conflicts with the active generation`);
    }
    if (executor) assertExecutorBinding(executor, pack);
    try {
      const host = PersistedBattleHost.create(this.store, { ...hostConfig, pack, ...(executor ? { executor } : {}) });
      this.hosts.set(config.battleId, { host, generationId, ...(lease ? { lease } : {}) });
      return host;
    } catch (error) {
      lease?.release();
      if (error instanceof EngineFault) throw new HostError("INVALID_SCHEMA", error.message);
      if (error instanceof ExecutorError) throw new HostError("ENGINE_FAULT", error.message);
      throw error;
    }
  }

  async restore(config: RestoreBattleConfig, battleId: string): Promise<PersistedBattleHost> {
    if (this.hosts.has(battleId)) throw new HostError("INVALID_SCHEMA", `battle ${battleId} already loaded`);
    const row = this.store.loadBattle(battleId);
    if (!row) throw new HostError("NOT_FOUND", `battle ${battleId} not found`);

    let state: BattleState;
    let init: CoreState;
    let rules: ArtifactRules;
    let initRules: ArtifactRules;
    try {
      const parsedState = JSON.parse(row.stateJson) as unknown;
      const parsedInit = JSON.parse(row.initJson) as unknown;
      const stateRecord = parsedState as { rules?: ArtifactRules };
      const initRecord = parsedInit as { rules?: ArtifactRules };
      if (!stateRecord?.rules || !initRecord?.rules) throw new Error("missing rules reference");
      rules = stateRecord.rules;
      initRules = initRecord.rules;
      state = parsedState as BattleState;
      init = parsedInit as CoreState;
    } catch (error) {
      throw new GenerationError("MALFORMED_RECORD", `battle ${battleId} state is malformed: ${(error as Error).message}`);
    }

    const catalog = this.artifacts ?? (this.fixedPack ? new RuntimeArtifactCatalog([this.fixedPack]) : undefined);
    if (!catalog) throw new GenerationError("ARTIFACT_UNAVAILABLE", "no runtime artifact catalog configured");
    const pack = catalog.resolve(rules);
    catalog.resolve(initRules);
    const generationId = generationIdFromRules(rules);
    if (generationIdFromRules(initRules) !== generationId) {
      throw new GenerationError("ARTIFACT_UNAVAILABLE", `battle ${battleId} snapshots reference different artifacts`);
    }
    try {
      if (!internalValidators.state(state)) {
        const first = internalValidators.state.errors?.[0];
        throw new Error(`${first?.instancePath || "/"} ${first?.message ?? "is invalid"}`);
      }
      assertCoreState(init, pack, battleId);
      if (
        state.battleId !== battleId
        || state.rng.seedHex !== init.rng.seedHex
        || init.revision !== 0
        || init.turn !== 1
      ) throw new Error("snapshot identity mismatch");
    } catch (error) {
      throw new GenerationError("MALFORMED_RECORD", `battle ${battleId} snapshots are malformed: ${(error as Error).message}`);
    }

    const executor = catalog.executor(generationId);
    if (pack.rules.executableHash !== ENGINE_EXECUTABLE_HASH && !executor) {
      throw new GenerationError("EXECUTABLE_ISOLATION_REQUIRED", `generation ${generationId} has no isolated executor`);
    }
    if (executor) assertExecutorBinding(executor, pack);
    let lease: GenerationLease | undefined;
    let activatedHere = false;
    try {
      if (this.generations) {
        if (!this.generations.has(generationId)) {
          await this.generations.activate(pack, { isolatedExecutable: executor !== undefined });
          activatedHere = true;
        }
        lease = this.generations.acquire(generationId, { allowDraining: true });
        if (lease.isolated !== (executor !== undefined)) {
          throw new GenerationError("ARTIFACT_CONFLICT", `generation ${generationId} executor binding conflicts with the active generation`);
        }
      }
      const host = PersistedBattleHost.restore(this.store, { ...config, pack, ...(executor ? { executor } : {}) }, battleId);
      this.hosts.set(battleId, { host, generationId, ...(lease ? { lease } : {}) });
      return host;
    } catch (error) {
      lease?.release();
      if (activatedHere && this.generations?.has(generationId)) {
        const descriptor = this.generations.descriptors().find((item) => item.id === generationId);
        if (descriptor?.references === 0) this.generations.retire(generationId);
      }
      throw error;
    }
  }

  unload(battleId: string): void {
    const managed = this.hosts.get(battleId);
    if (!managed) return;
    if (managed.host.host.state.battle.terminal === null) {
      throw new GenerationError("PLUGIN_IN_USE", `battle ${battleId} is still active`);
    }
    this.hosts.delete(battleId);
    managed.lease?.release();
  }
}
