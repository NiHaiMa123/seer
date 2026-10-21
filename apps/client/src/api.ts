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
  private destroyed = false;
  private pollGeneration = 0;

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

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(url, { ...init, signal: BattleClient.timeout() });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  }

  async observe(): Promise<any> {
    const r = await this.request(`${this.base}/api/battle/${this.battleId}/observe?${this.q}`);
    return r.json();
  }

  async history(since = 0): Promise<{ cursor: number; events: any[] }> {
    const r = await this.request(`${this.base}/api/battle/${this.battleId}/history?${this.q}&since=${since}`);
    return r.json();
  }

  async resync(since = 0): Promise<{ cursor: number; events: any[]; observation: any }> {
    const r = await this.request(`${this.base}/api/battle/${this.battleId}/resync?${this.q}&since=${since}`);
    return r.json();
  }

  async submit(body: SubmitBody): Promise<any> {
    const r = await this.request(`${this.base}/api/battle/${this.battleId}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ player: this.token, ...body }),
    });
    return r.json();
  }

  async ack(seq: number): Promise<void> {
    await this.request(`${this.base}/api/battle/${this.battleId}/ack`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ player: this.token, seq }),
    });
  }

  /** 轮询：拿到 since 之后的事件交给 handler；重叠请求去重。 */
  poll(ms: number, since: number, onEvents: (cursor: number, events: any[]) => void): void {
    if (this.destroyed) return;
    if (this.timer !== null) clearInterval(this.timer);
    const generation = ++this.pollGeneration;
    let inFlight = false;
    let cursor = since;
    this.timer = setInterval(async () => {
      if (inFlight || this.destroyed || generation !== this.pollGeneration) return;
      inFlight = true;
      try {
        const r = await this.history(cursor);
        if (this.destroyed || generation !== this.pollGeneration) return;
        // 错误体（500/超时重试前的半截响应）不携带 events——跳过但保活轮询
        if (typeof r.cursor === "number" && Array.isArray(r.events)) {
          onEvents(r.cursor, r.events);
          cursor = r.cursor;
        }
      } catch { /* 网络抖动 → 下一轮重试 */ } finally {
        inFlight = false;
      }
    }, ms);
  }

  destroy(): void {
    this.destroyed = true;
    this.pollGeneration++;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
}
