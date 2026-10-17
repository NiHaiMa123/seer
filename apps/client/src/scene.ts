/**
 * scene.ts —— Pixi 战斗场景：废墟石台竞技场（暮色天穹 + 残柱剪影 + 裂石板地台，敌我左右镜像站位）、
 * 程序化侧向精灵（speciesId 哈希→体型/配色/耳尾刺翼）、命中闪白、伤害浮字、换人/复活/魂印动画队列。
 * 动画纯表现——authoritative 状态永远来自 observe，skip 不产生权威差异。
 * 终局（battle-end）之后把队列收到最终姿势并停住，结果条出来时舞台不再动。
 */
import { Application, Assets, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import { drawCreature, speciesSkin, type CreatureSkin } from "./creature.ts";
import { zhStat } from "./meta.ts";

type FloatTier = "minor" | "normal" | "major" | "epic";
const FLOAT_TIER: Record<FloatTier, { size: number; stroke: number; glow: number; pop: number; rise: number; ms: number }> = {
  minor: { size: 14, stroke: 4, glow: 4, pop: 1.25, rise: 26, ms: 620 },
  normal: { size: 26, stroke: 5, glow: 6, pop: 1.6, rise: 40, ms: 700 },
  major: { size: 24, stroke: 6, glow: 10, pop: 1.9, rise: 34, ms: 820 },
  epic: { size: 38, stroke: 7, glow: 14, pop: 2.2, rise: 18, ms: 1000 },
};

export interface SceneUnit {
  box: Graphics;          // 主容器（动画目标）
  nameText: Text;
  x: number;
  y: number;              // 精灵锚点（身体中心）
  baseScale: number;      // 站位缩放——scale 动画须以此为基准
}

export interface AnimTask {
  duration: number; // ms @1x
  update(p: number): void;
}

/** 画布像素尺寸（16:9 全幅，UI 叠在场景上）；场景内部坐标宽恒为 720 逻辑单位，经 stage 等比放大，逻辑高 = LOGIC_H */
export const VIEW_W = 1280;
export const VIEW_H = 720;
const LOGIC_H = (720 * VIEW_H) / VIEW_W;

/** 站位：左右镜像对称的侧面对峙——己方左侧朝右 / 敌方右侧朝左，同一水平线、同一缩放 */
const OWN_POS = { x: 206, y: 216, scale: 1.16, dir: 1 };
const FOE_POS = { x: 720 - OWN_POS.x, y: OWN_POS.y, scale: OWN_POS.scale, dir: -1 };

/** 稳定伪随机散布（不依赖种子——视觉装饰不参与确定性） */
const scatter = (i: number, salt: number): number => {
  let h = (i * 2654435761 + salt * 40503) >>> 0;
  h = ((h >>> 13) ^ h) * 1274126177 >>> 0;
  return ((h >>> 9) & 0xffff) / 0xffff;
};

export class BattleScene {
  app!: Application;
  private units = new Map<string, SceneUnit>();
  private floats: Text[] = [];
  private queue: AnimTask[] = [];
  private running = false;
  private skipFlag = false;
  /** 终局已封存：不再接受新演出 */
  private sealed = false;
  /** 待机呼吸 / 星尘。终局后关掉，避免结果条底下还在动 */
  private ambient = true;
  private settledNotified = false;
  /** 正在播的那一段。终局时立刻收到 p=1，不等这一段自己放完 */
  private cancelCurrent: (() => void) | null = null;
  /** 队列已空且环境动画已停 */
  onSettled: (() => void) | null = null;
  speed = 1;
  private seq = 0;
  private bobT = 0;
  private particles: { g: Graphics; vx: number; vy: number }[] = [];

  async init(host: HTMLElement, resolution = Math.min(globalThis.devicePixelRatio || 1, 2)): Promise<void> {
    this.app = new Application();
    await this.app.init({ width: VIEW_W, height: VIEW_H, background: 0x070c1e, antialias: true,
      resolution, autoDensity: true });
    this.app.stage.scale.set(VIEW_W / 720);
    this.app.canvas.style.display = "block";
    host.replaceChildren(this.app.canvas);
    // 30fps 足够流畅——无 GPU 环境（SwiftShader 软渲）下高帧率会打满主线程
    this.app.ticker.maxFPS = 30;
    await this.drawArena();
    // idle 呼吸 + 星尘漂移 + 平台光环脉动
    this.app.ticker.add(() => {
      if (!this.ambient) return;
      const dt = this.app.ticker.deltaMS;
      this.bobT += dt / 900;
      for (const u of this.units.values()) u.box.pivot.y = Math.sin(this.bobT + u.x) * 2;
      for (const p of this.particles) {
        p.g.x += p.vx * dt * 0.001; p.g.y += p.vy * dt * 0.001;
        if (p.g.x > 730) p.g.x = -10; if (p.g.x < -10) p.g.x = 730;
        if (p.g.y > LOGIC_H + 10) p.g.y = -10; if (p.g.y < -10) p.g.y = LOGIC_H + 10;
      }
    });
  }

  /* ---------- 竞技场背景：AI 生成图（assets/ui/bg_arena.png） + 星尘 ---------- */
  private async drawArena(): Promise<void> {
    try {
      const tex = await Assets.load("/assets/ui/bg_arena.png");
      const bg = new Sprite(tex);
      const s = Math.max(720 / tex.width, LOGIC_H / tex.height); // cover
      bg.scale.set(s);
      bg.x = (720 - tex.width * s) / 2;
      bg.y = (LOGIC_H - tex.height * s) / 2;
      this.app.stage.addChild(bg);
    } catch {
      // 资产缺失时的兜底场景：暗色天 + 石台剪影
      const sky = new Graphics().rect(0, 0, 720, LOGIC_H).fill(0x0a0a22);
      sky.poly([60, 400, 200, 268, 520, 268, 660, 400]).fill({ color: 0x241d3e });
      this.app.stage.addChild(sky);
    }
    // 漂移微粒层（精灵之上）
    for (let i = 0; i < 14; i++) {
      const p = new Graphics();
      p.circle(0, 0, 1.4 + scatter(i, 41) * 1.6).fill({ color: 0xbfa8ff, alpha: 0.24 + scatter(i, 43) * 0.3 });
      p.x = scatter(i, 47) * 720; p.y = scatter(i, 53) * 360 + 20;
      this.particles.push({ g: p, vx: (scatter(i, 59) - 0.5) * 14, vy: -(4 + scatter(i, 61) * 10) });
      this.app.stage.addChild(p);
    }
  }

  /* ---------- 精灵 ---------- */
  setup(ownId: string, foeId: string, ownSpecies: string, foeSpecies: string): void {
    this.mkUnit(ownId, OWN_POS, ownSpecies, speciesSkin(ownSpecies));
    this.mkUnit(foeId, FOE_POS, foeSpecies, speciesSkin(foeSpecies));
  }

  swapUnit(outUnitId: string, inUnitId: string, side: "self" | "foe", speciesId: string): void {
    if (this.sealed) return;
    const old = this.units.get(outUnitId);
    const pos = side === "self" ? OWN_POS : FOE_POS;
    if (old) {
      const name = old.nameText;
      // 从当前透明度接着淡，不要在 p=0 把已经倒下的精灵拉回不透明
      let from: { a: number; y: number; n: number } | null = null;
      this.push((p) => {
        from ??= { a: old.box.alpha, y: old.box.y, n: name.alpha };
        old.box.alpha = from.a * (1 - p);
        old.box.y = from.y + p * 50;
        name.alpha = from.n * (1 - p);
      }, 300);
      this.push(() => { this.app.stage.removeChild(old.box, name); }, 1);
      this.units.delete(outUnitId);
    }
    this.mkUnit(inUnitId, pos, speciesId, speciesSkin(speciesId));
    const nu = this.units.get(inUnitId)!;
    nu.box.alpha = 0;
    nu.nameText.alpha = 0;
    this.push((p) => { nu.box.alpha = p; nu.nameText.alpha = p; nu.box.y = pos.y + 40 - p * 40; }, 300);
  }

  /** 侧向精灵：朝 +x 绘制，子节点 scale.x=dir 镜像（外层 scale 留给动画不破坏朝向） */
  private mkUnit(unitId: string, pos: typeof OWN_POS, speciesId: string, skin: CreatureSkin): void {
    const box = new Graphics();      // 动画容器：位置/透明度/缩放由队列驱动
    const c = new Graphics();        // 精灵本体（镜像一个朝向）
    const s = drawCreature(c, skin);

    c.scale.x = pos.dir;              // 镜像朝向（敌我相对）
    c.scale.y = Math.abs(pos.dir);    // 保持纵向（dir 恒 ±1）
    box.addChild(c);
    box.position.set(pos.x, pos.y);
    box.scale.set(pos.scale);
    const name = new Text({
      text: speciesId,
      style: new TextStyle({ fill: 0xf3f7ff, fontSize: 12, fontWeight: "700", letterSpacing: 1,
        fontFamily: ["Microsoft YaHei UI", "PingFang SC", "sans-serif"],
        stroke: { color: 0x0a1430, width: 3, join: "round" },
        dropShadow: { color: 0x000000, alpha: 0.5, blur: 3, distance: 1, angle: Math.PI / 2 } }),
    });
    name.anchor.set(0.5);
    name.position.set(pos.x, pos.y - s * pos.scale - 30);
    this.app.stage.addChild(box, name);
    this.units.set(unitId, { box, nameText: name, x: pos.x, y: pos.y, baseScale: pos.scale });
  }

  /** switch 后权威 species 到达时同步名牌 */
  setName(unitId: string, name: string): void {
    const u = this.units.get(unitId);
    if (u) u.nameText.text = name;
  }

  setHp(_unitId: string, _hp: number, _max: number): void {
    // 血条由叠加的单位卡承载（HTML 层），场景内不重复绘制
  }

  /**
   * 浮字分级：minor（能力变化）< normal（伤害/回复数字）< major（克制/致命/魂印）< epic（击败）。
   * 级别越高字越大、描边越厚、弹出越有力、停留越久。
   */
  private floatText(x: number, y: number, text: string, color: number, tier: FloatTier = "normal"): void {
    const T = FLOAT_TIER[tier];
    const t = new Text({ text, style: new TextStyle({
      fill: color, fontSize: T.size, fontWeight: "900", letterSpacing: tier === "epic" ? 4 : 1,
      fontFamily: tier === "normal" ? ["Bahnschrift", "Segoe UI", "sans-serif"] : ["Microsoft YaHei UI", "PingFang SC", "sans-serif"],
      stroke: { color: 0x07102a, width: T.stroke, join: "round" },
      dropShadow: { color, alpha: tier === "minor" ? 0.25 : 0.55, blur: T.glow, distance: 0, angle: 0 },
    }) });
    t.anchor.set(0.5);
    t.position.set(x, y);
    t.alpha = 0;
    this.app.stage.addChild(t);
    this.floats.push(t);
    this.push((p) => {
      const pop = Math.min(1, p / 0.16);
      const s = 1 + (T.pop - 1) * (1 - pop) ** 2;
      t.scale.set(s);
      t.alpha = p < 0.72 ? Math.min(1, p / 0.06) : (1 - p) / 0.28;
      t.y = y - T.rise * (p < 0.16 ? 0 : (p - 0.16) / 0.84);
    }, T.ms);
    this.push(() => { this.app.stage.removeChild(t); this.floats = this.floats.filter((f) => f !== t); }, 1);
  }

  /** 镜头震动（致命一击 / 击败）：只动 stage 偏移，结束归零 */
  private shake(mag: number, ms: number): void {
    const sx = this.app.stage.x, sy = this.app.stage.y;
    this.push((p) => {
      const k = (1 - p) * mag;
      this.app.stage.x = p >= 1 ? sx : sx + Math.sin(p * 60) * k;
      this.app.stage.y = p >= 1 ? sy : sy + Math.cos(p * 47) * k * 0.6;
    }, ms);
  }

  enqueueEvent(ev: any, unitIds: { own: string; opp: string }, ownSide: string): void {
    if (this.sealed) return;
    const unitOf = (side: string) => (side === ownSide ? unitIds.own : unitIds.opp);
    switch (ev.type) {
      case "action-declared": {
        const u = this.units.get(unitOf(ev.side as string));
        if (!u) return;
        const dir = ev.side === ownSide ? 1 : -1;
        this.push((p) => { u.box.x = u.x + dir * 46 * Math.sin(p * Math.PI); }, 300);
        break;
      }
      case "damage": {
        const u = this.units.get(unitOf(ev.side as string));
        if (!u) return;
        this.push((p) => { u.box.alpha = p < 0.5 ? 0.3 : 1; u.box.tint = p < 0.5 ? 0xffb0b0 : 0xffffff; }, 250);
        const crit = ev.crit === true;
        const color = ev.damageKind === "true" ? 0xff5468 : ev.damageKind === "percent" ? 0xffaa33 : crit ? 0xffd56b : 0xfff1d6;
        if (crit) { this.floatText(u.x, u.y - 112, "致命一击!", 0xffd56b, "major"); this.shake(5, 260); }
        this.floatText(u.x, u.y - 72, `-${ev.amount}`, color, crit ? "major" : "normal");
        // 克制反馈飘字（eff 仅 standard/true 招式携带）
        if (typeof ev.eff16 === "number") {
          const effN = ev.eff16 / 16;
          const tag = effN === 0 ? { t: "无效", c: 0x9aa6c4, k: "minor" as const }
            : effN > 1 ? { t: effN >= 2 ? "克制!!" : "克制!", c: 0xffa23d, k: "major" as const }
            : effN < 1 ? { t: "微弱", c: 0x8fc4ff, k: "minor" as const } : null;
          if (tag !== null) this.floatText(u.x, u.y - 100, tag.t, tag.c, tag.k);
        }
        break;
      }
      case "heal": {
        const u = this.units.get(unitOf(ev.side as string));
        if (!u) return;
        this.push((p) => { u.box.tint = p < 0.5 ? 0xb6ffd8 : 0xffffff; }, 260);
        this.floatText(u.x, u.y - 72, `+${ev.amount}`, 0x5df2a6);
        break;
      }
      case "stat-stage": {
        const u = this.units.get(unitOf(ev.side as string));
        if (!u) return;
        this.push((p) => { const s = u.baseScale * (1 + 0.12 * Math.sin(p * Math.PI)); u.box.scale.set(s); }, 260);
        const d = Number(ev.deltaApplied ?? 0);
        if (d !== 0) this.floatText(u.x, u.y - 96, `${zhStat(String(ev.stat ?? ""))}${d > 0 ? "↑" : "↓"}${Math.abs(d) > 1 ? Math.abs(d) : ""}`, d > 0 ? 0x7fe0ff : 0xff8a9a, "minor");
        break;
      }
      case "soulmark": {
        const u = this.units.get(unitOf(ev.side as string));
        if (!u) return;
        // 魂印触发：紫金脉冲 + 印记名浮字
        this.push((p) => { u.box.tint = p < 0.5 ? 0xd8a8ff : 0xffffff; }, 280);
        this.push(() => { u.box.tint = 0xffffff; }, 1);
        const label = typeof ev.name === "string" ? `魂印·${ev.name}` : "魂印";
        this.floatText(u.x, u.y - 100, label, 0xd8b4ff, "major");
        break;
      }
      case "ko": {
        const u = this.units.get(unitOf(ev.side as string));
        if (!u) return;
        this.shake(7, 320);
        this.floatText(u.x, u.y - 40, "击败!", 0xff5468, "epic");
        this.push((p) => { u.box.alpha = 1 - p; u.box.y = u.y + p * 60; u.box.tint = 0x8890b0; }, 520);
        break;
      }
      case "revive": {
        const u = this.units.get(unitOf(ev.side as string));
        if (!u) return;
        this.push((p) => { u.box.alpha = p < 0.5 ? p * 2 : 2 - p * 2; u.box.tint = 0xfff27a; }, 400);
        this.push(() => { u.box.alpha = 1; u.box.tint = 0xffffff; }, 1);
        this.floatText(u.x, u.y - 72, "复活!", 0xffe48a, "major");
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
    if (this.sealed) { update(1); return; }
    this.queue.push({ update, duration });
    void this.run();
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const gen = ++this.seq;
    try {
      while (this.queue.length > 0 && !this.skipFlag && this.seq === gen) {
        const t = this.queue.shift()!;
        await this.animate(t, gen);
      }
      if (this.skipFlag && this.seq === gen) {
        for (const t of this.queue.splice(0)) {
          try { t.update(1); } catch { /* 单段演出失败不卡住队列 */ }
        }
      }
    } finally {
      if (this.seq === gen) {
        this.running = false;
        this.notifySettled();
      }
    }
  }

  private animate(t: AnimTask, gen: number): Promise<void> {
    if (this.seq !== gen) return Promise.resolve();
    if (this.skipFlag) { t.update(1); return Promise.resolve(); }
    const dur = Math.max(30, t.duration / this.speed);
    return new Promise((res) => {
      let el = 0;
      let settled = false;
      const finishTick = (snap: boolean) => {
        if (settled) return;
        settled = true;
        this.app.ticker.remove(tick);
        if (this.cancelCurrent === cancel) this.cancelCurrent = null;
        try { if (snap && this.seq === gen) t.update(1); } finally { res(); }
      };
      const cancel = () => finishTick(true);
      const tick = () => {
        if (this.seq !== gen) { finishTick(false); return; }
        if (this.skipFlag) { finishTick(true); return; }
        el += this.app.ticker.deltaMS;
        const p = Math.min(1, el / dur);
        t.update(p);
        if (p >= 1) finishTick(false);
      };
      this.cancelCurrent = cancel;
      this.app.ticker.add(tick);
    });
  }

  /** 快进：当前这段和队列里剩下的都收到终点。之后的演出也不再按时间播。 */
  skip(): void {
    this.skipFlag = true;
    this.cancelCurrent?.();
    if (!this.running) this.snapQueue();
  }

  /**
   * 对局已经结束。还在播的受击/换人/倒下收到最终姿势，待机呼吸和星尘停住。
   * 重复调用无事。不改权威状态。
   */
  finish(): void {
    if (this.settledNotified) return;
    this.sealed = true;
    this.skipFlag = true;
    this.stopAmbient();
    this.cancelCurrent?.();
    if (!this.running) {
      this.snapQueue();
      this.notifySettled();
    }
  }

  private snapQueue(): void {
    for (const t of this.queue.splice(0)) {
      try { t.update(1); } catch { /* 单段演出失败不卡住终局 */ }
    }
  }

  private stopAmbient(): void {
    if (!this.ambient) return;
    this.ambient = false;
    for (const u of this.units.values()) u.box.pivot.y = 0;
  }

  private notifySettled(): void {
    if (!this.sealed || this.running || this.queue.length > 0 || this.settledNotified) return;
    this.settledNotified = true;
    this.stopAmbient();
    this.onSettled?.();
  }

  /** 舞台姿势指纹。终局后连续两次应相同。 */
  pose(): string {
    const bits: string[] = [];
    for (const id of [...this.units.keys()].sort()) {
      const u = this.units.get(id)!;
      const b = u.box;
      bits.push(`${id}@${b.x.toFixed(1)},${b.y.toFixed(1)},a${b.alpha.toFixed(2)},r${b.rotation.toFixed(2)},s${b.scale.x.toFixed(2)},p${b.pivot.y.toFixed(1)}`);
    }
    const dust = this.particles[0]?.g;
    if (dust !== undefined) bits.push(`dust${dust.x.toFixed(1)},${dust.y.toFixed(1)}`);
    const flo = this.floats[0];
    if (flo !== undefined) bits.push(`fy${flo.y.toFixed(1)},${flo.alpha.toFixed(2)}`);
    bits.push(`|q=${this.queue.length}|run=${this.running ? 1 : 0}|amb=${this.ambient ? 1 : 0}|floats=${this.floats.length}|sealed=${this.sealed ? 1 : 0}|`);
    return bits.join(";");
  }

  get pendingAnimations(): number {
    return this.queue.length + (this.running ? 1 : 0);
  }

  destroy(): void {
    this.seq++;
    this.skipFlag = true;
    this.sealed = true;
    this.ambient = false;
    this.queue.splice(0);
    this.cancelCurrent = null;
    try { this.app?.destroy(true, { children: true }); } catch { /* already destroyed */ }
  }
}
