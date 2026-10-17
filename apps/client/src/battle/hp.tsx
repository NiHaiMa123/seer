/**
 * battle/hp.tsx —— 血条：分段刻度 + 端部高光 + 受击残影（白→红，延迟回落）+ 受击/回复闪光 + 低血呼吸。
 * 数字始终是 `.hpbar b` = "cur/max"（ui-matrix 口径）。
 */
import { useEffect, useRef, useState } from "react";

export function HpBar({ cur, max, size = "lg" }: { cur: number; max: number; size?: "lg" | "sm" }) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, cur / max)) : 0;
  const tone = ratio <= 0.25 ? " low" : ratio <= 0.5 ? " mid" : "";
  const prev = useRef(cur);
  const [fx, setFx] = useState<{ kind: "hit" | "heal"; n: number } | null>(null);
  useEffect(() => {
    if (cur === prev.current) return;
    setFx((f) => ({ kind: cur < prev.current ? "hit" : "heal", n: (f?.n ?? 0) + 1 }));
    prev.current = cur;
    const t = setTimeout(() => setFx(null), 650);
    return () => clearTimeout(t);
  }, [cur]);
  return (
    <div className={`hpbar ${size}${tone}${fx !== null ? ` fx-${fx.kind} fx-${fx.n % 2}` : ""}`}>
      <span className="hp-track">
        <s style={{ width: `${ratio * 100}%` }} />
        <i style={{ width: `${ratio * 100}%` }} />
      </span>
      <b className="num">{cur}<small>/{max}</small></b>
    </div>
  );
}
