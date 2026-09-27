import { ENGINE_EXECUTABLE_HASH, type FrozenPack } from "@seer/battle-core";

export type GenerationErrorCode =
  | "ARTIFACT_CONFLICT"
  | "ARTIFACT_UNAVAILABLE"
  | "GENERATION_DRAINING"
  | "GENERATION_LIMIT"
  | "PLUGIN_IN_USE"
  | "EXECUTABLE_ISOLATION_REQUIRED"
  | "MALFORMED_RECORD";

export class GenerationError extends Error {
  readonly code: GenerationErrorCode;

  constructor(code: GenerationErrorCode, message: string) {
    super(message);
    this.name = "GenerationError";
    this.code = code;
  }
}

export interface GenerationDescriptor {
  id: string;
  executableHash: string;
  rulesetHash: string;
  contentHash: string;
  references: number;
  draining: boolean;
  isolated: boolean;
}

export interface GenerationLease {
  readonly id: string;
  readonly pack: FrozenPack;
  readonly isolated: boolean;
  release(): void;
}

interface GenerationEntry {
  pack: FrozenPack;
  references: number;
  draining: boolean;
  isolated: boolean;
  order: number;
}

interface PendingGeneration {
  id: string;
  pack: FrozenPack;
  isolated: boolean;
  resolves: Array<(descriptor: GenerationDescriptor) => void>;
}

export function generationIdFromRules(rules: FrozenPack["rules"]): string {
  return `${rules.executableHash}/${rules.rulesetHash}/${rules.contentHash}`;
}

export function generationIdOf(pack: FrozenPack): string {
  return generationIdFromRules(pack.rules);
}

export class RuntimeGenerationRegistry {
  readonly maxActive: number;
  private readonly entries = new Map<string, GenerationEntry>();
  private readonly pending: PendingGeneration[] = [];
  private order = 0;

  constructor(maxActive = 2) {
    if (!Number.isInteger(maxActive) || maxActive < 1) {
      throw new GenerationError("GENERATION_LIMIT", "maxActive must be a positive integer");
    }
    this.maxActive = maxActive;
  }

  get generationCount(): number {
    return this.entries.size;
  }

  get queuedCount(): number {
    return this.pending.length;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  descriptors(): GenerationDescriptor[] {
    return [...this.entries.entries()]
      .sort(([, a], [, b]) => a.order - b.order)
      .map(([id, entry]) => this.describe(id, entry));
  }

  activate(pack: FrozenPack, options: { isolatedExecutable?: boolean } = {}): Promise<GenerationDescriptor> {
    const isolated = options.isolatedExecutable === true;
    if (pack.rules.executableHash !== ENGINE_EXECUTABLE_HASH && !isolated) {
      return Promise.reject(new GenerationError(
        "EXECUTABLE_ISOLATION_REQUIRED",
        `executable ${pack.rules.executableHash} requires an isolated runtime`,
      ));
    }
    const id = generationIdOf(pack);
    const existing = this.entries.get(id);
    if (existing) {
      if (existing.isolated !== isolated) {
        return Promise.reject(new GenerationError("ARTIFACT_CONFLICT", `generation ${id} isolation mode conflicts with the active registration`));
      }
      if (existing.draining) {
        return Promise.reject(new GenerationError("GENERATION_DRAINING", `generation ${id} is draining`));
      }
      return Promise.resolve(this.describe(id, existing));
    }
    const queued = this.pending.find((item) => item.id === id);
    if (queued) {
      if (queued.isolated !== isolated) {
        return Promise.reject(new GenerationError("ARTIFACT_CONFLICT", `generation ${id} isolation mode conflicts with the queued registration`));
      }
      return new Promise((resolve) => queued.resolves.push(resolve));
    }
    if (this.entries.size < this.maxActive) {
      return Promise.resolve(this.add(pack, isolated));
    }
    return new Promise((resolve) => this.pending.push({ id, pack, isolated, resolves: [resolve] }));
  }

  acquire(id?: string, options: { allowDraining?: boolean } = {}): GenerationLease {
    const selected = id ?? this.latestId();
    if (!selected) throw new GenerationError("ARTIFACT_UNAVAILABLE", "no active runtime generation");
    const entry = this.entries.get(selected);
    if (!entry) throw new GenerationError("ARTIFACT_UNAVAILABLE", `generation ${selected} is unavailable`);
    if (entry.draining && options.allowDraining !== true) {
      throw new GenerationError("GENERATION_DRAINING", `generation ${selected} is draining`);
    }
    entry.references += 1;
    let released = false;
    return {
      id: selected,
      pack: entry.pack,
      isolated: entry.isolated,
      release: () => {
        if (released) return;
        released = true;
        this.release(selected);
      },
    };
  }

  markDraining(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) throw new GenerationError("ARTIFACT_UNAVAILABLE", `generation ${id} is unavailable`);
    entry.draining = true;
    if (entry.references === 0) this.remove(id);
  }

  retire(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) throw new GenerationError("ARTIFACT_UNAVAILABLE", `generation ${id} is unavailable`);
    if (entry.references > 0) {
      throw new GenerationError("PLUGIN_IN_USE", `generation ${id} has ${entry.references} active reference(s)`);
    }
    this.remove(id);
  }

  private latestId(): string | undefined {
    return [...this.entries.entries()]
      .filter(([, entry]) => !entry.draining)
      .sort(([, a], [, b]) => b.order - a.order)[0]?.[0];
  }

  private add(pack: FrozenPack, isolated: boolean): GenerationDescriptor {
    const id = generationIdOf(pack);
    const entry: GenerationEntry = { pack, references: 0, draining: false, isolated, order: ++this.order };
    this.entries.set(id, entry);
    return this.describe(id, entry);
  }

  private release(id: string): void {
    const entry = this.entries.get(id);
    if (!entry || entry.references === 0) return;
    entry.references -= 1;
    if (entry.draining && entry.references === 0) this.remove(id);
  }

  private remove(id: string): void {
    this.entries.delete(id);
    while (this.entries.size < this.maxActive && this.pending.length > 0) {
      const pending = this.pending.shift()!;
      const existing = this.entries.get(pending.id);
      const descriptor = existing ? this.describe(pending.id, existing) : this.add(pending.pack, pending.isolated);
      for (const resolve of pending.resolves) resolve(descriptor);
    }
  }

  private describe(id: string, entry: GenerationEntry): GenerationDescriptor {
    return {
      id,
      executableHash: entry.pack.rules.executableHash,
      rulesetHash: entry.pack.rules.rulesetHash,
      contentHash: entry.pack.rules.contentHash,
      references: entry.references,
      draining: entry.draining,
      isolated: entry.isolated,
    };
  }
}
