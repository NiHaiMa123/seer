/**
 * portrait.ts —— UI 立绘：离屏 Pixi 把 creature.ts 的同一只精灵渲染成透明 PNG（data URL），按 speciesId+构图+尺寸缓存。
 * bust = 胸像（头像框）；full = 全身（主界面 / 背包展示台）。串行出图（单渲染器），失败时返回 null，组件回落到首字。
 * 纯表现，不碰权威状态。
 */
import { useEffect, useState } from "react";
import { Container, Graphics, Rectangle, autoDetectRenderer, type Renderer } from "pixi.js";
import { drawCreature, speciesSkin } from "./creature.ts";

export type ArtMode = "bust" | "full";
const cache = new Map<string, string | null>();
const waiting = new Map<string, Promise<string | null>>();
let rendererP: Promise<Renderer> | null = null;
let chain: Promise<unknown> = Promise.resolve();

function renderer(): Promise<Renderer> {
  rendererP ??= autoDetectRenderer({ width: 256, height: 256, backgroundAlpha: 0, antialias: true, preference: "webgl" });
  return rendererP;
}

async function draw(speciesId: string, mode: ArtMode, size: number, flip: boolean): Promise<string | null> {
  const r = await renderer();
  const root = new Container();
  const g = new Graphics();
  drawCreature(g, speciesSkin(speciesId), mode === "full");
  root.addChild(g);
  const b = g.getLocalBounds();
  let scale: number;
  if (mode === "bust") {
    // 胸像构图：以头为重心，身体下缘出画
    scale = (size * 1.02) / Math.max(b.width, b.height * 0.9);
    g.x = size / 2 - (b.x + b.width * 0.56) * scale;
    g.y = size * 0.6 - (b.y + b.height * 0.5) * scale;
  } else {
    // 全身：整只入画，脚底贴近下缘
    scale = (size * 0.9) / Math.max(b.width, b.height);
    g.x = size / 2 - (b.x + b.width / 2) * scale;
    g.y = size * 0.96 - (b.y + b.height) * scale;
  }
  g.scale.set(scale);
  if (flip) { g.scale.x = -scale; g.x = size - g.x; }
  const out = await r.extract.base64({ target: root, frame: new Rectangle(0, 0, size, size), resolution: 1, clearColor: [0, 0, 0, 0] });
  root.destroy({ children: true });
  return out;
}

export function portraitUrl(speciesId: string, mode: ArtMode = "bust", size = 192, flip = false): Promise<string | null> {
  const key = `${speciesId}|${mode}|${size}|${flip ? 1 : 0}`;
  if (cache.has(key)) return Promise.resolve(cache.get(key)!);
  let p = waiting.get(key);
  if (p === undefined) {
    p = (chain = chain.then(() => draw(speciesId, mode, size, flip)).catch(() => null)) as Promise<string | null>;
    p.then((u) => { cache.set(key, u); waiting.delete(key); });
    waiting.set(key, p);
  }
  return p;
}

export function usePortrait(speciesId: string | null | undefined, mode: ArtMode = "bust", size = 192, flip = false): string | null {
  const key = speciesId ? `${speciesId}|${mode}|${size}|${flip ? 1 : 0}` : "";
  const [url, setUrl] = useState<string | null>(key ? cache.get(key) ?? null : null);
  useEffect(() => {
    if (!speciesId) { setUrl(null); return; }
    let alive = true;
    const hit = cache.get(key);
    if (hit !== undefined) { setUrl(hit); return; }
    setUrl(null);
    void portraitUrl(speciesId, mode, size, flip).then((u) => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [key]);
  return url;
}
