/**
 * scene.ts —— Pixi 占位战斗场景：两方块 + HP 条 + 命中闪白 + 伤害浮字。
 * 事件驱动动画队列；speed 倍速；skip() 立即快进队列到最新状态。
 * 动画纯表现——authoritative 状态永远来自 observe，skip 不产生权威差异。
 */
import { Application, Graphics, Text, TextStyle } from "pixi.js";

export interface SceneUnit {
  box: Graphics;
  hpBar: Graphics;
  hpText: Text;
  nameText: Text;
  x: number;
}

export interface AnimTask {
  duration: number; // ms @1x
  update(p: number): void;
}

export class BattleScene {
  app!: Application;
  private units = new Map<string, SceneUnit>();
  private queue: AnimTask[] = [];
  private running = false;
  private skipFlag = false;
  speed = 1;
  private seq = 0; // 活跃动画世代计数（cleanup 验证）

  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.app = new Application();
    await this.app.init({ canvas, width: 720, height: 360, background: 0x12181f, antialias: false });
    this.app.ticker.maxFPS = 120;
  }

  setup(ownId: string, foeId: string): void {
    this.mkUnit(ownId, 160, "self", 0x3ea6ff);
    this.mkUnit(foeId, 560, "foe", 0xff6b4a);
  }

  private mkUnit(unitId: string, x: number, tag: string, color: number): void {
    const box = new Graphics().roundRect(-36, -36, 72, 72, 10).fill(color);
    box.position.set(x, 170);
    const hpBar = new Graphics();
    hpBar.position.set(x, 250);
    const name = new Text({ text: `${tag === "self" ? "我方" : "对手"}`, style: new TextStyle({ fill: 0xffffff, fontSize: 14 }) });
    name.anchor.set(0.5);
    name.position.set(x, 110);
    const hpText = new Text({ text: "", style: new TextStyle({ fill: 0x9fff9f, fontSize: 13 }) });
    hpText.anchor.set(0.5);
    hpText.position.set(x, 250);
    this.app.stage.addChild(box, hpBar, name, hpText);
    this.units.set(unitId, { box, hpBar, hpText, nameText: name, x });
  }

  /** 立即（无动画）应用 HP——skip 与 resync 用。 */
  setHp(unitId: string, hp: number, max: number): void {
    const u = this.units.get(unitId);
    if (!u) return;
    u.hpBar.clear().rect(-40, -8, 80 * Math.max(0, hp / max), 16).fill(0x2fae4f);
    u.hpText.text = `${hp}/${max}`;
  }

  /** 事件 → 动画任务入队。unitKey: "own"|"opp" → 由调用方映射 unitId。 */
  enqueueEvent(ev: any, unitIds: { own: string; opp: string }, ownSide: string): void {
    const unitOf = (side: string) => (side === ownSide ? unitIds.own : unitIds.opp);
    switch (ev.type) {
      case "action-declared": {
        const u = this.units.get(unitOf(ev.side as string));
        if (!u) return;
        this.push((p) => { u.box.x = u.x + (ev.side === ownSide ? 1 : -1) * 40 * Math.sin(p * Math.PI); }, 300);
        break;
      }
      case "damage": {
        const u = this.units.get(unitOf(ev.side as string));
        if (!u) return;
        this.push((p) => { u.box.alpha = p < 0.5 ? 0.3 : 1; }, 250);
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
        this.push((p) => { u.box.alpha = 1 - p; u.box.y = 170 + p * 60; }, 500);
        break;
      }
      default:
        break; // turn-begin/heal(struggle-used 未画)/battle-end：无动画
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
