/**
 * Cordis 薄适配层 PoC（M0-03）。本包是唯一允许 import "cordis" 的位置。
 *
 * Seer 面：provide/require/own + manifest 策略。语义对应 plugin-system.md：
 * - 依赖在执行入口前失败（缺依赖直接拒绝，因为上游 inject 缺依赖是挂起等待）
 * - 同 service key 双 provider 报冲突
 * - setup 失败的插件不留下半成品注册（staged，失败即回滚登记）
 * - dispose 幂等；cleanup 期间注册新 effect 由上游 INACTIVE_EFFECT 拒绝
 * 不承诺生产热替换；scope 不是恶意代码沙箱。
 */
import { Context } from "cordis";
import type { Fiber } from "cordis";
import type { PluginManifest } from "@seer/contracts";
import { validators } from "@seer/contracts";

export type PluginErrorCode =
  | "INVALID_SCHEMA"
  | "CAPABILITY_DENIED"
  | "MISSING_DEPENDENCY"
  | "CYCLE"
  | "SERVICE_CONFLICT"
  | "SETUP_FAILED"
  | "NOT_FOUND";

export class PluginError extends Error {
  constructor(
    public readonly code: PluginErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PluginError";
  }
}

/** Fiber states of cordis rc.10 (const enum copied by value: PENDING/LOADING/ACTIVE/FAILED/DISPOSED/UNLOADING). */
export const FiberStateName: Record<number, string> = {
  0: "PENDING",
  1: "LOADING",
  2: "ACTIVE",
  3: "FAILED",
  4: "DISPOSED",
  5: "UNLOADING",
};

export type Disposer = () => unknown;

/** Narrow context surface handed to plugin setup. Cordis types never escape it. */
export interface SeerPluginContext {
  require<T = unknown>(name: string): T;
  provide<T>(name: string, value: T): void;
  own(disposer: Disposer): void;
}

export interface PluginSpec {
  manifest: PluginManifest;
  /** Services this plugin intends to register (mirrors upstream `provide` declaration). */
  provides?: string[];
  setup: (ctx: SeerPluginContext) => unknown;
}

export interface PluginHandle {
  readonly pluginId: string;
  readonly fiber: Fiber;
  readonly ownedServices: Set<string>;
  disposed: boolean;
  get state(): string;
}

interface ProviderEntry {
  owner: string;
}

export interface LoadPolicy {
  /** Capabilities the host grants this plugin; manifest.requestedCapabilities must be a subset. */
  grantedCapabilities: string[];
}

export class PluginHost {
  readonly ctx = new Context();
  private readonly providers = new Map<string, ProviderEntry>();
  private readonly plugins = new Map<string, PluginHandle>();

  constructor() {
    // Host-owned baseline services can be registered here by the caller via provideService.
  }

  get registrySize(): number {
    return this.ctx.registry.size;
  }

  get providerCount(): number {
    return this.providers.size;
  }

  get pluginCount(): number {
    return this.plugins.size;
  }

  provideService<T>(name: string, value: T, owner = "host"): void {
    const existing = this.providers.get(name);
    if (existing) {
      throw new PluginError(
        "SERVICE_CONFLICT",
        `service "${name}" already provided by ${existing.owner}`,
      );
    }
    this.ctx.provide(name, value);
    this.providers.set(name, { owner });
  }

  require<T = unknown>(name: string): T {
    return this.ctx.get(name, true) as T;
  }

  has(name: string): boolean {
    return this.ctx.get(name) !== undefined;
  }

  async loadPlugin(spec: PluginSpec, policy: LoadPolicy): Promise<PluginHandle> {
    const { manifest } = spec;
    if (!validators.manifest(manifest)) {
      throw new PluginError("INVALID_SCHEMA", `manifest "${manifest.pluginId}" failed schema`);
    }
    if (this.plugins.has(manifest.pluginId)) {
      throw new PluginError("SERVICE_CONFLICT", `plugin "${manifest.pluginId}" already loaded`);
    }

    const granted = new Set(policy.grantedCapabilities);
    for (const cap of manifest.requestedCapabilities ?? []) {
      if (!granted.has(cap)) {
        throw new PluginError("CAPABILITY_DENIED", `capability "${cap}" not granted to ${manifest.pluginId}`);
      }
    }

    const selfProvided = new Set(spec.provides ?? []);
    for (const req of manifest.requires ?? []) {
      if (selfProvided.has(req.service)) {
        throw new PluginError("CYCLE", `${manifest.pluginId} requires its own service "${req.service}"`);
      }
      if (!this.providers.has(req.service)) {
        throw new PluginError(
          "MISSING_DEPENDENCY",
          `${manifest.pluginId} requires "${req.service}" which no provider supplies`,
        );
      }
    }

    const ownedServices = new Set<string>();
    const handle: PluginHandle = {
      pluginId: manifest.pluginId,
      fiber: undefined as unknown as Fiber,
      ownedServices,
      disposed: false,
      get state() {
        return FiberStateName[this.fiber?.state ?? -1] ?? `UNKNOWN(${this.fiber?.state})`;
      },
    };

    // Everything inside apply() binds to the plugin's own fiber scope:
    // provide() cleanup and effect() registration are released on fiber dispose.
    const pluginDef = {
      name: manifest.pluginId,
      provide: spec.provides,
      inject: (manifest.requires ?? []).map((r) => r.service),
      apply: (ctx: Context) => {
        const scoped: SeerPluginContext = {
          require: <T,>(name: string) => ctx.get(name, true) as T,
          provide: <T,>(name: string, value: T) => {
            const existing = this.providers.get(name);
            if (existing) {
              throw new PluginError(
                "SERVICE_CONFLICT",
                `service "${name}" already provided by ${existing.owner}`,
              );
            }
            const release = ctx.provide(name, value);
            this.providers.set(name, { owner: manifest.pluginId });
            ownedServices.add(name);
            ctx.effect(() => async () => {
              this.providers.delete(name);
              await release();
            });
          },
          own: (disposer: Disposer) => {
            // Cordis binds this to the plugin fiber; registering on an
            // inactive/disposed scope throws CordisError INACTIVE_EFFECT upstream.
            ctx.effect(() => disposer);
          },
        };
        return spec.setup(scoped);
      },
    };

    const fiber = this.ctx.plugin(pluginDef);
    handle.fiber = fiber;
    // Register before await so disposeAll()/unloadPlugin() can kill pending loads.
    this.plugins.set(manifest.pluginId, handle);
    try {
      await fiber;
    } catch (e) {
      // Failed setup must not leave half-registered services behind.
      for (const name of ownedServices) this.providers.delete(name);
      try {
        await fiber.dispose();
      } catch {
        // upstream cleanup failures do not mask the setup error
      }
      this.plugins.delete(manifest.pluginId);
      if (e instanceof PluginError) throw e;
      throw new PluginError(
        "SETUP_FAILED",
        `${manifest.pluginId} setup failed: ${(e as Error).message}`,
      );
    }
    if (handle.disposed || FiberStateName[fiber.state] !== "ACTIVE") {
      // Async reentry: the fiber was disposed while setup was pending.
      this.plugins.delete(manifest.pluginId);
      for (const name of ownedServices) this.providers.delete(name);
      throw new PluginError(
        "SETUP_FAILED",
        `${manifest.pluginId} was disposed during setup (state ${handle.state})`,
      );
    }
    return handle;
  }

  async unloadPlugin(pluginId: string): Promise<void> {
    const handle = this.plugins.get(pluginId);
    if (!handle) return;
    if (!handle.disposed) {
      handle.disposed = true;
      await handle.fiber.dispose();
    }
    for (const name of handle.ownedServices) this.providers.delete(name);
    this.plugins.delete(pluginId);
  }

  async disposeAll(): Promise<void> {
    for (const id of [...this.plugins.keys()]) await this.unloadPlugin(id);
  }
}
