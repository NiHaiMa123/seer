/**
 * xoshiro128** —— synthetic/local 候选 RNG（battle-engine.md §5，来源 S15）。
 * 显式 uint32 运算；非密码学算法，正式 PVP 前换 ChaCha20 流（Q13）。
 * seed：128-bit lowercase hex → 4×u32 大端词；禁止全零状态。
 * 每次 draw 记录 {purpose, seq, value}；整数区间用拒绝采样（无取模偏差）。
 */

export interface RngDraw {
  purpose: string;
  seq: number;
  value: number;
}

const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0;

export class DeterministicRng {
  readonly algorithmId = "xoshiro128**";
  private readonly s: [number, number, number, number];
  private counter = 0;
  readonly draws: RngDraw[] = [];

  constructor(seedHex: string) {
    if (!/^[0-9a-f]{32}$/.test(seedHex)) {
      throw new RangeError("seedHex must be exactly 32 lowercase hex chars (128-bit)");
    }
    const words = [0, 1, 2, 3].map((i) => parseInt(seedHex.slice(i * 8, i * 8 + 8), 16) >>> 0);
    if (words.every((w) => w === 0)) {
      throw new RangeError("xoshiro128** all-zero state is forbidden");
    }
    this.s = words as [number, number, number, number];
  }

  /** Next uint32 draw. Purpose is recorded for replay audit. */
  next(purpose: string): number {
    const [s0, s1, s2, s3] = this.s;
    // reference: result = rotl(s[1] * 5, 7) * 9
    const result = (rotl(Math.imul(s1, 5), 7) * 9) >>> 0;
    const t = (s1 << 17) >>> 0;
    const n2 = s2 ^ s0;
    const n3 = s3 ^ s1;
    const n1 = s1 ^ n2;
    const n0 = s0 ^ n3;
    this.s = [n0 >>> 0, n1 >>> 0, (n2 ^ t) >>> 0, rotl(n3, 11) >>> 0];
    this.draws.push({ purpose, seq: this.counter++, value: result });
    return result;
  }

  /**
   * 拒绝采样：返回 [0, n) 均匀整数，不使用取模（防 modulo bias）。
   * 每次调用至少消费一次 draw；上界迭代超限按规则故障处理。
   */
  drawBelow(n: number, purpose: string): number {
    if (!Number.isSafeInteger(n) || n <= 0 || n > 0x100000000) {
      throw new RangeError(`drawBelow bound must be an integer in [1, 2^32], got ${n}`);
    }
    let mask = n - 1;
    mask |= mask >>> 1;
    mask |= mask >>> 2;
    mask |= mask >>> 4;
    mask |= mask >>> 8;
    mask |= mask >>> 16;
    mask = mask >>> 0; // JS bitwise is int32; keep mask unsigned
    for (let i = 0; i < 64; i++) {
      const v = (this.next(purpose) & mask) >>> 0;
      if (v < n) return v;
    }
    throw new RangeError("drawBelow rejection sampling exceeded bound (fault)");
  }

  get drawCounter(): number {
    return this.counter;
  }
}
