/**
 * M0-05 render PoC：Pixi 8.21.0 最小场景 + 10k 程序化 sprite。
 * 测量：冷启动（模块加载→首帧）、帧时长统计、Worker round-trip、structuredClone 成本。
 * 不使用任何真实游戏资产；UI 不证明任何规则。
 */
import { Application, Container, Graphics, Sprite } from "pixi.js";

const bootT0 = performance.now();
const SPRITES = 10_000;
const MEASURE_FRAMES = 240; // ~4s @60fps
const WORKER_PINGS = 500;

interface Stats {
  spriteCount: number;
  renderer: string;
  coldStartMs: number;
  frames: { count: number; meanMs: number; p50ms: number; p95ms: number; p99ms: number; fpsMean: number };
  workerRoundTrip: { count: number; meanMs: number; p50ms: number; p95ms: number };
  structuredClone10kState: { count: number; meanMs: number; p95ms: number };
  userAgent: string;
  glRenderer: string;
}

const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
};

async function workerRoundTrip(): Promise<number[]> {
  const blob = new Blob(["onmessage=(e)=>postMessage(e.data)"], { type: "text/javascript" });
  const w = new Worker(URL.createObjectURL(blob));
  const times: number[] = [];
  for (let i = 0; i < WORKER_PINGS; i++) {
    const t = performance.now();
    await new Promise<void>((res) => {
      w.onmessage = () => res();
      w.postMessage(i);
    });
    times.push(performance.now() - t);
  }
  w.terminate();
  return times;
}

async function structuredCloneCost(): Promise<number[]> {
  // ~一个 observation 大小的对象（10KB 级）
  const state = {
    schemaVersion: 1,
    battleId: "btl_perf",
    units: Array.from({ length: 50 }, (_, i) => ({
      id: `u${i}`,
      hp: { current: 100 - i, max: 100 },
      stages: { atk: i % 7, def: 0, spd: 0 },
      effects: [{ kind: "e", remainingTurns: 2 }],
    })),
    log: "x".repeat(4096),
  };
  const times: number[] = [];
  for (let i = 0; i < WORKER_PINGS; i++) {
    const t = performance.now();
    structuredClone(state);
    times.push(performance.now() - t);
  }
  return times;
}

const phase = (p: string) => {
  (globalThis as Record<string, unknown>)["__phase"] = p;
};

async function main(): Promise<void> {
  phase("init");
  const app = new Application();
  await app.init({ width: 1280, height: 720, backgroundColor: 0x101418 });
  phase("inited");
  document.body.appendChild(app.canvas);

  // 程序化纹理（无任何资产）
  const tex = app.renderer.generateTexture(new Graphics().rect(0, 0, 8, 8).fill(0xffffff));
  const container = new Container();
  app.stage.addChild(container);
  let seed = 0x2f6e2b1;
  const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 0x100000000;
  const sprites: Sprite[] = [];
  for (let i = 0; i < SPRITES; i++) {
    const s = new Sprite(tex);
    s.position.set(rnd() * 1280, rnd() * 720);
    s.tint = (i * 2654435761) % 0xffffff;
    s.anchor.set(0.5);
    container.addChild(s);
    sprites.push(s);
  }

  phase("sprites");
  const frameTimes: number[] = [];
  let last = performance.now();
  let firstFrameAt = 0;
  let angle = 0;
  await new Promise<void>((resolve) => {
    let started = false;
    app.ticker.add(() => {
      const now = performance.now();
      if (!started) {
        started = true;
        firstFrameAt = now;
        last = now;
        return;
      }
      frameTimes.push(now - last);
      last = now;
      angle += 0.01;
      if (frameTimes.length % 60 === 0) phase(`frames:${frameTimes.length}`);
      // 轻量运动：每帧 10k sprite 旋转/位移
      for (let i = 0; i < SPRITES; i += 10) sprites[i]!.rotation += 0.02;
      container.rotation = Math.sin(angle) * 0.02;
      if (frameTimes.length >= MEASURE_FRAMES) resolve();
    });
  });

  phase("worker");
  const rtt = await workerRoundTrip();
  phase("clone");
  const cloneTimes = await structuredCloneCost();
  const stats: Stats = {
    spriteCount: SPRITES,
    renderer: `type=${app.renderer.type}`,
    coldStartMs: firstFrameAt - bootT0,
    frames: {
      count: frameTimes.length,
      meanMs: frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length,
      p50ms: pct(frameTimes, 50),
      p95ms: pct(frameTimes, 95),
      p99ms: pct(frameTimes, 99),
      fpsMean: 1000 / (frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length),
    },
    workerRoundTrip: {
      count: rtt.length,
      meanMs: rtt.reduce((a, b) => a + b, 0) / rtt.length,
      p50ms: pct(rtt, 50),
      p95ms: pct(rtt, 95),
    },
    structuredClone10kState: {
      count: cloneTimes.length,
      meanMs: cloneTimes.reduce((a, b) => a + b, 0) / cloneTimes.length,
      p95ms: pct(cloneTimes, 95),
    },
    userAgent: navigator.userAgent,
    glRenderer: (() => {
      const gl = document.createElement("canvas").getContext("webgl");
      const ext = gl?.getExtension("WEBGL_debug_renderer_info");
      return gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "unavailable";
    })(),
  };
  (globalThis as Record<string, unknown>)["__renderStats"] = stats;
  phase("done");
}

main().catch((e) => {
  (globalThis as Record<string, unknown>)["__renderError"] = String(e);
});
