/**
 * slots.ts —— presentation 插件注册表（plugin-system.md 的 presentation 类）。
 * 两类挂载点：
 * - screen：整页（lobby/battle/world）——新页面 = registerScreen，不改 main.tsx
 * - panel area：战斗页内的有序面板区——新面板 = registerPanel 追加，不改 App
 * 卸载 = unregister 返回的 disposer；UI 只允许读公开 Observation（隐私边界不变）。
 */
import type { ComponentType } from "react";
import type { PackMeta } from "./meta.ts";

export type PanelComponent<P = unknown> = ComponentType<P>;

const screens = new Map<string, PanelComponent<any>>();
const panelAreas = new Map<string, { id: string; component: PanelComponent<any> }[]>();
let seq = 0;

export const slots = {
  registerScreen(id: string, component: PanelComponent<any>): () => void {
    screens.set(id, component);
    return () => { if (screens.get(id) === component) screens.delete(id); };
  },
  screen(id: string): PanelComponent<any> | undefined {
    return screens.get(id);
  },
  /** area 内按注册顺序渲染 */
  registerPanel(area: string, component: PanelComponent<any>): () => void {
    const list = panelAreas.get(area) ?? [];
    const entry = { id: `${area}#${++seq}`, component };
    list.push(entry);
    panelAreas.set(area, list);
    return () => {
      const i = list.indexOf(entry);
      if (i >= 0) list.splice(i, 1);
    };
  },
  panels(area: string): PanelComponent<any>[] {
    return (panelAreas.get(area) ?? []).map((e) => e.component);
  },
};

/** 战斗页 panel 上下文——插件面板拿到的全部公开数据（Observation 是隐私投影，不含对手隐藏态） */
export interface BattlePanelCtx {
  obs: any;
  meta: PackMeta | null;
  myTurn: boolean;
  isReplacement: boolean;
  submit(actionId: string): void;
  log: string[];
  speed: number;
  onSkip(): void;
  onCycleSpeed(): void;
}
