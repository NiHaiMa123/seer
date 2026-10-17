/**
 * api.ts —— 客户端协议层：observe/history/submit/ack/resync 的 fetch 封装。
 * 轮询循环可 destroy（cleanup：清除 interval，不残留 listener）。
 */
export interface SubmitBody {
  decisionId: string;
  actionId: string;
  baseRevision: number;
  idempotencyKey: string;
}

export class BattleClient {
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;
  private destroyed = false;

  constructor(
    private readonly base: string,
    private readonly battleId: string,
    private readonly token: string,
  ) {}

  private get q() {
    return `player=${encodeURIComponent(this.token)}`;
  }

  private static timeout(): AbortSignal {
    return AbortSignal.timeout(8000);
  }

  async observe(): Promise<any> {
    const r = await fetch(`${this.base}/api/battle/${this.battleId}/observe?${this.q}`, { signal: BattleClient.timeout() });
    return r.json();
  }

  async history(since = 0): Promise<{ cursor: number; events: any[] }> {
    const r = await fetch(`${this.base}/api/battle/${this.battleId}/history?${this.q}&since=${since}`, { signal: BattleClient.timeout() });
    return r.json();
  }

  async resync(since = 0): Promise<{ cursor: number; events: any[]; observation: any }> {
    const r = await fetch(`${this.base}/api/battle/${this.battleId}/resync?${this.q}&since=${since}`, { signal: BattleClient.timeout() });
    return r.json();
  }

  async submit(body: SubmitBody): Promise<any> {
    const r = await fetch(`${this.base}/api/battle/${this.battleId}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ player: this.token, ...body }),
    });
    return r.json();
  }

  async ack(seq: number): Promise<void> {
    await fetch(`${this.base}/api/battle/${this.battleId}/ack`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ player: this.token, seq }),
    });
  }

  /** 轮询：拿到 since 之后的事件交给 handler；重叠请求去重。 */
  poll(ms: number, since: number, onEvents: (cursor: number, events: any[]) => void): void {
    if (this.destroyed) return;
    let cursor = since;
    this.timer = setInterval(async () => {
      if (this.inFlight || this.destroyed) return;
      this.inFlight = true;
      try {
        const r = await this.history(cursor);
        // 错误体（500/超时重试前的半截响应）不携带 events——跳过但保活轮询
        if (typeof r.cursor === "number" && Array.isArray(r.events)) {
          cursor = r.cursor;
          onEvents(r.cursor, r.events);
        }
      } catch { /* 网络抖动 → 下一轮重试 */ } finally {
        this.inFlight = false;
      }
    }, ms);
  }

  destroy(): void {
    this.destroyed = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
}
