/**
 * battle/feed.tsx —— 战斗信息流：战场下方正中的精简播报条（默认两行，悬停展开历史）、中央覆盖横幅（胜/败/换人）。
 * fmtEvent 在 ./format.ts（纯函数，无 React 依赖，便于 Node 侧夹具测试），此处再导出保持旧 import 路径。
 */
import { useEffect, useRef } from "react";
import { zhReason } from "../meta.ts";
import type { BattlePanelCtx } from "../slots.ts";
import { Icon } from "../ui/kit.tsx";

export { fmtEvent } from "./format.ts";

/** 播报行分级：回合分隔 / 击倒 / 克制 / 回复 / 错误 / 普通 */
function lineCls(l: string, last: boolean): string {
  const k = l.startsWith("—") ? "turn"
    : l.startsWith("ERR") ? "err"
    : l.includes("倒下") ? "ko"
    : l.includes("克制") ? "eff"
    : l.includes("恢复") || l.includes("站了起来") ? "heal"
    : l.includes("魂印") ? "soul"
    : "";
  return `${k}${last ? " cur" : ""}`.trim();
}

/** 战场内嵌「战斗信息」播报条——下方正中，最新行高亮，新行自动滚底 */
export function FieldLog({ log }: BattlePanelCtx) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => { const el = ref.current; if (el) el.scrollTop = el.scrollHeight; }, [log]);
  const lines = log.filter((l) => l !== "");
  return (
    <div className="field-log">
      <div className="fl-head"><Icon name="layers" /><span className="ttag">战斗信息</span><em>悬停查看记录</em></div>
      <pre ref={ref} className="log" data-testid="battle-log">
        {lines.length === 0
          ? <span className="dim">战斗开始！请选择技能</span>
          : lines.map((l, i) => <span key={i} className={lineCls(l, i === lines.length - 1) || undefined}>{l}{"\n"}</span>)}
      </pre>
    </div>
  );
}

/** 中央覆盖横幅——终局结果 + 换人警示 */
export function ArenaBanners({ obs, myTurn, isReplacement }: BattlePanelCtx) {
  const res = obs.terminal === null ? null : obs.terminal.result === obs.side ? "win" : obs.terminal.result === "draw" ? "draw" : "lose";
  return (
    <>
      {isReplacement && myTurn && (
        <div className="arena-banner">
          <div data-testid="replacement-banner" className="replacement-banner">
            <Icon name="swap" />精灵倒下 — 选择替补上场
          </div>
        </div>
      )}
      {res !== null && (
        <div className={`arena-banner result ${res}`}>
          <div data-testid="result-banner" className={`result-banner ${res}`}>
            <span className="rb-rays" />
            <span className="rb-ribbon">
              <span className="rb-title">{res === "win" ? "胜 利" : res === "draw" ? "平 局" : "战 败"}</span>
            </span>
            <div className="reason">{res === "win" ? "VICTORY" : res === "draw" ? "DRAW" : "DEFEAT"} · {zhReason(obs.terminal.reason)}</div>
          </div>
        </div>
      )}
    </>
  );
}
