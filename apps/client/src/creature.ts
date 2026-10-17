/**
 * creature.ts —— 程序化侧向精灵（speciesId 哈希 → 体型/配色/耳尾刺翼）。原创造型，非原作素材。
 * 战斗场景（scene.ts）与 UI 头像（portrait.ts）共用同一份画法，卡面与战场上是同一只精灵。
 */
import type { Graphics } from "pixi.js";

export interface CreatureSkin {
  hue: number; body: number; belly: number; aura: number; spine: number;
  ears: "round" | "horn" | "fin"; tail: "none" | "fin" | "whip"; wings: boolean; size: number;
}

export const hsl = (h: number, s: number, l: number): number => {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
    return Math.round(255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))));
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
};

/** speciesId → 稳定配色与体态部件 */
export function speciesSkin(speciesId: string): CreatureSkin {
  let h = 0;
  for (const c of speciesId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  // 雪崩混合（murmur3 finalizer）：相邻编号也拉开配色与体态
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  const hue = h % 360;
  return {
    hue,
    body: hsl(hue, 58, 52),
    belly: hsl(hue, 48, 76),
    aura: hsl(hue, 85, 62),
    spine: hsl((hue + 40) % 360, 70, 66),
    ears: (["round", "horn", "fin"] as const)[h % 3]!,
    tail: (["none", "fin", "whip"] as const)[(h >> 5) % 3]!,
    wings: (h >> 7) % 4 === 0,
    size: 0.85 + ((h >> 3) % 40) / 100, // 0.85–1.25
  };
}

/** 朝 +x 画一只精灵到 c（原点 = 身体中心）。shadow=false 时不画落地阴影（头像用）。返回基准尺寸 s。 */
export function drawCreature(c: Graphics, skin: CreatureSkin, shadow = true): number {
  const s = 42 * skin.size;
  const dark = 0x0e0a26;
  const shade = (skin.body & 0xfefefe) >> 1 & 0x7f7f7f;

  if (shadow) c.ellipse(0, s * 1.02, s * 0.85, s * 0.16).fill({ color: 0x000000, alpha: 0.32 });
  // 翅（身后膜翼）
  if (skin.wings) {
    c.poly([-s * 0.3, -s * 0.5, -s * 1.15, -s * 1.35, -s * 0.95, -s * 0.4, -s * 1.3, -s * 0.75])
      .fill({ color: skin.aura, alpha: 0.75 }).stroke({ color: dark, width: 1.5, alpha: 0.5 });
  }
  // 尾
  if (skin.tail === "fin") {
    c.poly([-s * 0.65, s * 0.15, -s * 1.45, -s * 0.5, -s * 1.05, s * 0.05, -s * 1.35, s * 0.55, -s * 0.7, s * 0.5])
      .fill(skin.body).stroke({ color: dark, width: 1.5, alpha: 0.5 });
    c.poly([-s * 1.4, -s * 0.45, -s * 1.15, -s * 0.15, -s * 1.3, s * 0.45]).stroke({ color: skin.spine, width: 2, alpha: 0.7 });
  } else if (skin.tail === "whip") {
    c.moveTo(-s * 0.7, s * 0.25).bezierCurveTo(-s * 1.5, s * 0.5, -s * 1.6, -s * 0.3, -s * 1.25, -s * 0.55)
      .stroke({ color: skin.body, width: s * 0.14 });
    c.circle(-s * 1.25, -s * 0.55, s * 0.11).fill(skin.spine);
  }
  // 后足（远侧暗色）
  c.ellipse(-s * 0.28, s * 0.92, s * 0.24, s * 0.15).fill(shade);
  // 躯体（前倾椭圆）
  c.ellipse(-s * 0.05, s * 0.1, s * 0.82, s * 0.72).fill(skin.body)
    .stroke({ color: dark, width: 2, alpha: 0.55 });
  // 腹面
  c.ellipse(s * 0.12, s * 0.32, s * 0.48, s * 0.42).fill(skin.belly);
  // 背刺列
  for (let i = 0; i < 4; i++) {
    const t = i / 3, bx = -s * 0.72 + t * s * 0.72, by = -s * (0.5 + Math.sin(t * Math.PI) * 0.28);
    c.poly([bx - s * 0.13, by + s * 0.12, bx, by - s * 0.3, bx + s * 0.13, by + s * 0.1])
      .fill(skin.spine).stroke({ color: dark, width: 1, alpha: 0.4 });
  }
  // 头（前向突出）
  c.ellipse(s * 0.38, -s * 0.42, s * 0.56, s * 0.5).fill(skin.body)
    .stroke({ color: dark, width: 2, alpha: 0.55 });
  // 耳/角/鳍
  if (skin.ears === "round") {
    c.circle(s * 0.16, -s * 0.92, s * 0.2).fill(skin.body).stroke({ color: dark, width: 1.5, alpha: 0.5 });
    c.circle(s * 0.16, -s * 0.92, s * 0.1).fill(skin.belly);
    c.circle(s * 0.62, -s * 0.88, s * 0.17).fill(skin.body).stroke({ color: dark, width: 1.5, alpha: 0.5 });
    c.circle(s * 0.62, -s * 0.88, s * 0.08).fill(skin.belly);
  } else if (skin.ears === "horn") {
    c.poly([s * 0.12, -s * 0.72, -s * 0.05, -s * 1.25, s * 0.3, -s * 0.85]).fill(skin.spine)
      .stroke({ color: dark, width: 1.5, alpha: 0.5 });
    c.poly([s * 0.55, -s * 0.75, s * 0.55, -s * 1.3, s * 0.78, -s * 0.8]).fill(skin.spine)
      .stroke({ color: dark, width: 1.5, alpha: 0.5 });
  } else {
    c.poly([s * 0.1, -s * 0.7, -s * 0.3, -s * 1.15, s * 0.35, -s * 0.82]).fill(skin.body)
      .stroke({ color: dark, width: 1.5, alpha: 0.5 });
    c.poly([s * 0.55, -s * 0.72, s * 0.4, -s * 1.05, s * 0.75, -s * 0.75]).fill(skin.spine)
      .stroke({ color: dark, width: 1.5, alpha: 0.5 });
  }
  // 前臂（对敌侧）
  c.ellipse(s * 0.68, s * 0.12, s * 0.16, s * 0.3).fill(skin.body)
    .stroke({ color: dark, width: 1.5, alpha: 0.5 });
  c.circle(s * 0.68, s * 0.4, s * 0.12).fill(skin.belly);
  // 前足
  c.ellipse(s * 0.4, s * 0.92, s * 0.26, s * 0.15).fill(skin.body)
    .stroke({ color: dark, width: 1.5, alpha: 0.5 });
  // 眼（朝敌 +x）+ 怒眉 + 颔线
  c.ellipse(s * 0.52, -s * 0.5, s * 0.16, s * 0.19).fill(0xffffff)
    .stroke({ color: dark, width: 1.5, alpha: 0.6 });
  c.circle(s * 0.58, -s * 0.47, s * 0.075).fill(0x12122a);
  c.circle(s * 0.6, -s * 0.5, s * 0.028).fill(0xffffff);
  c.moveTo(s * 0.32, -s * 0.74).lineTo(s * 0.68, -s * 0.62).stroke({ color: dark, width: 3, alpha: 0.75 });
  c.moveTo(s * 0.55, -s * 0.18).quadraticCurveTo(s * 0.72, -s * 0.1, s * 0.78, -s * 0.22).stroke({ color: dark, width: 2, alpha: 0.6 });
  // 胸前符纹点缀
  c.circle(s * 0.05, -s * 0.05, s * 0.09).fill({ color: skin.aura, alpha: 0.6 });
  return s;
}
