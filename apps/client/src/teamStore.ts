/**
 * teamStore.ts —— 跨页面共享的队伍状态（出战/待命 12 只 + 刻印 loadout + 技能携带 carried）。
 * 权威在服务端 `data/local-team.json`：加载时 GET 拉取，每次变更 PUT 落盘（原子写）。
 * 刷新/换浏览器/重开进程不丢编队。
 */
import { useSyncExternalStore } from "react";

export interface TeamState {
  team: string[];
  loadout: Record<string, string[]>;
  carried: Record<string, string[]>;
}

const EMPTY: TeamState = { team: [], loadout: {}, carried: {} };

let state: TeamState = EMPTY;
const subs = new Set<() => void>();
let hydrated = false;
const emit = () => { for (const f of subs) f(); };

/** 串行写队列——连续点选不会让多个 PUT 乱序覆盖。 */
let writing: Promise<void> = Promise.resolve();
const persist = (snapshot: TeamState) => {
  writing = writing.then(() =>
    fetch("/api/local/team", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(snapshot),
    }).then(() => undefined).catch(() => undefined), // 写失败不阻塞 UI——下次变更会带全量重试
  );
};

const setAll = (patch: Partial<TeamState>) => {
  hydrated = true; // 本地改动优先于迟到的一次性 GET
  state = { ...state, ...patch };
  persist(state);
  emit();
};

// 模块载入即从服务端权威文件拉取（服务端不可达时保持空，不阻塞 UI）
void fetch("/api/local/team")
  .then((r) => (r.status === 200 ? r.json() : EMPTY))
  .then((s) => {
    if (hydrated) return; // 拉取期间用户已改动——不覆盖内存态
    state = { ...EMPTY, ...(s as Partial<TeamState>) };
    emit();
  })
  .catch(() => {});

export const teamStore = {
  get: (): TeamState => state,
  setTeam: (team: string[]): void => setAll({ team }),
  setLoadout: (loadout: Record<string, string[]>): void => setAll({ loadout }),
  setCarried: (carried: Record<string, string[]>): void => setAll({ carried }),
  reset: (): void => { state = EMPTY; persist(state); emit(); },
  sub: (f: () => void): (() => void) => { subs.add(f); return () => subs.delete(f); },
};

export const useTeamStore = (): TeamState => useSyncExternalStore(teamStore.sub, teamStore.get, teamStore.get);
