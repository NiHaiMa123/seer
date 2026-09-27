/**
 * scene.ts —— Pixi 战斗场景：程序化精灵（speciesId 哈希→体型/配色/耳翼）、
 * 场地地面、命中闪白、伤害浮字、换人/复活/效果动画队列。
 * 动画纯表现——authoritative 状态永远来自 observe，skip 不产生权威差异。
 */
import { Application, Graphics, Text, TextStyle } from "pixi.js";

export interface SceneUnit {
  box: Graphics;          // 主容器（动画目标）
  nameText: Text;
  x: number;
}

export interface AnimTask {
  duration: number; // ms @1x
  update(p: number): void;
}

/** speciesId → 稳定配色与体型（程序化原创精灵，非原作素材） */
function speciesSkin(speciesId: string): { body: number; belly: number; aura: number; ears: "round" | "horn" | "fin"; size: number } {
  let h = 0;
  for (const c of speciesId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  return {
    body: hsl(hue, 62, 55),
    belly: hsl(hue, 55, 78),
    aura: hsl(hue, 80, 60),
    ears: (["round", "horn", "fin"] as const)[h % 3]!,
    size: 0.85 + ((h >> 3) % 40) / 100, // 0.85–1.25
  };
}

const hsl = (h: number, s: number, l: number): number => {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
    return Math.round(255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))));
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
};

export class BattleScene {
  app!: Application;
  private units = new Map<string, SceneUnit>();
  private floats: Text[] = [];
  private queue: AnimTask[] = [];
  private running = false;
  private skipFlag = false;
  speed = 1;
  private seq = 0;
  private bobT = 0;

  async init(host: HTMLElement): Promise<void> {
    this.app = new Application();
    await this.app.init({ width: 720, height: 360, background: 0x0d1526, antialias: true });
    this.app.canvas.style.display = "block";
    this.app.canvas.style.borderRadius = "12px";
    host.replaceChildren(this.app.canvas);
    this.app.ticker.maxFPS = 120;
    this.drawArena();
    // idle 呼吸
    this.app.ticker.add(() => {
      this.bobT += this.app.ticker.deltaMS / 900;
      for (const u of this.units.values()) u.box.pivot.y = Math.sin(this.bobT + u.x) * 2;
    });
  }

  private drawArena(): void {
    const g = new Graphics();
    // 地面椭圆平台
    g.ellipse(170, 262, 130, 22).fill({ color: 0x1b2b52 });
    g.ellipse(550, 262, 130, 22).fill({ color: 0x1b2b52 });
    g.ellipse(170, 258, 130, 22).stroke({ color: 0x3a5a9c, width: 1.5 });
    g.ellipse(550, 258, 130, 22).stroke({ color: 0x3a5a9c, width: 1.5 });
    // 远景氛围线
    for (let i = 0; i < 3; i++) g.moveTo(0, 60 + i * 30).lineTo(720, 60 + i * 30).stroke({ color: 0x16234a, width: 1 });
    this.app.stage.addChild(g);
  }

  setup(ownId: string, foeId: string, ownSpecies: string, foeSpecies: string): void {
    this.mkUnit(ownId, 170, ownSpecies, speciesSkin(ownSpecies));
    this.mkUnit(foeId, 550, foeSpecies, speciesSkin(foeSpecies));
  }

  swapUnit(outUnitId: string, inUnitId: string, side: "self" | "foe", speciesId: string): void {
    const old = this.units.get(outUnitId);
    const x = old?.x ?? (side === "self" ? 170 : 550);
    if (old) {
      this.push((p) => { old.box.alpha = 1 - p; old.box.y = 190 + p * 50; }, 300);
      const name = old.nameText;
      this.push(() => { this.app.stage.removeChild(old.box, name); }, 1);
      this.units.delete(outUnitId);
    }
    this.mkUnit(inUnitId, x, speciesId, speciesSkin(speciesId));
    const nu = this.units.get(inUnitId)!;
    nu.box.alpha = 0;
    this.push((p) => { nu.box.alpha = p; nu.box.y = 240 - p * 50; }, 300);
  }

  private mkUnit(unitId: string, x: number, speciesId: string, skin: ReturnType<typeof speciesSkin>): void {
    const box = new Graphics();
    const s = 46 * skin.size;
    // 光环底
    box.circle(0, s * 0.9, s * 0.75).fill({ color: skin.aura, alpha: 0.18 });
    // 耳/角/鳍
    if (skin.ears === "round") {
      box.circle(-s * 0.52, -s * 0.68, s * 0.22).fill(skin.body);
      box.circle(s * 0.52, -s * 0.68, s * 0.22).fill(skin.body);
    } else if (skin.ears === "horn") {
      box.poly([-s * 0.5, -s * 0.5, -s * 0.75, -s * 1.15, -s * 0.2, -s * 0.75]).fill(skin.aura);
      box.poly([s * 0.5, -s * 0.5, s * 0.75, -s * 1.15, s * 0.2, -s * 0.75]).fill(skin.aura);
    } else {
      box.poly([-s * 0.55, -s * 0.55, -s * 1.05, -s * 0.9, -s * 0.4, -s * 0.3]).fill(skin.body);
      box.poly([s * 0.55, -s * 0.55, s * 1.05, -s * 0.9, s * 0.4, -s * 0.3]).fill(skin.body);
    }
    // 身体 + 腹
    box.circle(0, 0, s).fill(skin.body);
    box.ellipse(0, s * 0.35, s * 0.62, s * 0.5).fill(skin.belly);
    // 眼
    box.circle(-s * 0.32, -s * 0.15, s * 0.13).fill(0xffffff);
    box.circle(s * 0.32, -s * 0.15, s * 0.13).fill(0xffffff);
    box.circle(-s * 0.30, -s * 0.13, s * 0.06).fill(0x182038);
    box.circle(s * 0.34, -s * 0.13, s * 0.06).fill(0x182038);
    box.position.set(x, 190);
    const name = new Text({ text: speciesId, style: new TextStyle({ fill: 0xcfe0ff, fontSize: 13, fontWeight: "700" }) });
    name.anchor.set(0.5);
    name.position.set(x, 118);
    this.app.stage.addChild(box, name);
    this.units.set(unitId, { box, nameText: name, x });
  }

  /** switch 后权威 species 到达时同步名牌 */
  setName(unitId: string, name: string): void {
    const u = this.units.get(unitId);
    if (u) u.nameText.text = name;
  }

  setHp(_unitId: string, _hp: number, _max: number): void {
    // 血条由顶部单位卡承载（HTML 层），场景内不重复绘制
  }

  /** 伤害浮字：-N 从单位头顶升起 */
  private floatText(x: number, y: number, text: string, color: number): void {
    const t = new Text({ text, style: new TextStyle({ fill: color, fontSize: 22, fontWeight: "800", stroke: { color: 0x000000, width: 3 } }) });
    t.anchor.set(0.5);
    t.position.set(x, y);
    t.alpha = 0;
    this.app.stage.addChild(t);
    this.floats.push(t);
    this.push((p) => { t.alpha = p < 0.7 ? 1 : (1 - p) / 0.3; t.y = y - p * 44; }, 700);
    this.push(() => { this.app.stage.removeChild(t); this.floats = this.floats.filter((f) => f !== t); }, 1);
  }

  enqueueEvent(ev: any, unitIds: { own: string; opp: string }, ownSide: string): void {
    const unitOf = (side: string) => (side === ownSide ? unitIds.own : unitIds.opp);
    switch (ev.type) {
      case "action-declared": {
        const u = this.units.get(unitOf(ev.side as string));
        if (!u) return;
        this.push((p) => { u.box.x = u.x + (ev.side === ownSide ? 1 : -1) * 44 * Math.sin(p * Math.PI); }, 300);
        break;
      }
      case "damage": {
        const u = this.units.get(unitOf(ev.side as string));
        if (!u) return;
        this.push((p) => { u.box.alpha = p < 0.5 ? 0.3 : 1; }, 250);
        const color = ev.damageKind === "true" ? 0xff5555 : ev.damageKind === "percent" ? 0xffaa33 : 0xffe08a;
        this.floatText(u.x, 120, `-${ev.amount}`, color);
        break;
      }
      case "heal": {
        const u = this.units.get(unitOf(ev.side as string));
        if (!u) return;
        this.floatText(u.x, 120, `+${ev.amount}`, 0x7bf0a8);
        break;
      }
      case "stat-stage": {
        const u = this.units.get(unitOf(ev.side as string));
        if (!u) return;
        this.push((p) => { const s = 1 + 0.2 * Math.sin(p * Math.PI); u.box.scale.set(s); }, 300);
        break;
      }
      case "ko": {
        const u = this.units.get(unitOf(ev.side as string));
        if (!u) return;
        this.push((p) => { u.box.alpha = 1 - p; u.box.y = 190 + p * 60; }, 500);
        break;
      }
      case "revive": {
        const u = this.units.get(unitOf(ev.side as string));
        if (!u) return;
        this.push((p) => { u.box.alpha = p < 0.5 ? p * 2 : 2 - p * 2; u.box.tint = 0xfff27a; }, 400);
        this.push(() => { u.box.alpha = 1; u.box.tint = 0xffffff; }, 1);
        this.floatText(u.x, 120, "复活!", 0xfff27a);
        break;
      }
      case "effect-applied": {
        const u = this.units.get(unitOf(ev.side as string));
        if (!u) return;
        this.push((p) => { u.box.tint = p < 0.5 ? 0x9f7aff : 0xffffff; }, 250);
        break;
      }
      case "control-immune": {
        const u = this.units.get(unitOf(ev.side as string));
        if (!u) return;
        this.push((p) => { u.box.tint = p < 0.5 ? 0x8affc1 : 0xffffff; }, 250);
        break;
      }
      case "action-failed": {
        const u = this.units.get(unitOf(ev.side as string));
        if (!u) return;
        this.push((p) => { u.box.rotation = Math.sin(p * Math.PI * 2) * 0.15; }, 300);
        this.push(() => { u.box.rotation = 0; }, 1);
        break;
      }
      default:
        break;
    }
  }

  private push(update: (p: number) => void, duration: number): void {
    this.queue.push({ update, duration });
    void this.run();
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const gen = ++this.seq;
    while (this.queue.length > 0 && !this.skipFlag && this.seq === gen) {
      const t = this.queue.shift()!;
      await this.animate(t);
    }
    if (this.skipFlag) {
      for (const t of this.queue.splice(0)) t.update(1);
    }
    this.running = false;
  }

  private animate(t: AnimTask): Promise<void> {
    const dur = Math.max(30, t.duration / this.speed);
    return new Promise((res) => {
      let el = 0;
      const tick = () => {
        el += this.app.ticker.deltaMS;
        t.update(Math.min(1, el / dur));
        if (el >= dur) {
          this.app.ticker.remove(tick);
          res();
        }
      };
      this.app.ticker.add(tick);
    });
  }

  skip(): void {
    this.skipFlag = true;
  }

  get pendingAnimations(): number {
    return this.queue.length + (this.running ? 1 : 0);
  }

  destroy(): void {
    this.seq++;
    this.skipFlag = true;
    this.queue.splice(0);
    try { this.app.destroy(true, { children: true }); } catch { /* already destroyed */ }
  }
}
