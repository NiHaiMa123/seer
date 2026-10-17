/** tick-shape.mjs 的类型声明。十二个 *_tick 收成 periodic。 */
export declare const TICK_NAMES: ReadonlySet<string>;
export declare function tickForm(fx: { name?: string; params?: Record<string, unknown>; target?: string; payload?: unknown[] }): { params: Record<string, unknown>; payload: unknown[] } | undefined;
export declare function liftTick(e: any): any;
export declare function liftTickEffects(effects: unknown[] | undefined): void;
export declare function syncDealtHost(e: any): void;
