/**
 * ui/kit.tsx —— 跨页面复用的表现组件：图标、属性晶石、精灵头像框、顶部导航。
 * 只做表现，不读权威状态。样式在 styles/kit.css。
 */
import type { CSSProperties, ReactNode } from "react";
import { typeColor, zhSpecies, type PackMeta } from "../meta.ts";
import { usePortrait } from "../portrait.ts";

const PATHS: Record<string, ReactNode> = {
  sword: <><path d="M14.5 17.5 3 6V3h3l11.5 11.5" /><path d="m13 19 6-6" /><path d="m16 16 4 4" /><path d="m19 21 2-2" /></>,
  potion: <><path d="M9 3h6" /><path d="M10 3v5.5L5.2 17.6A2.3 2.3 0 0 0 7.2 21h9.6a2.3 2.3 0 0 0 2-3.4L14 8.5V3" /><path d="M7.5 15h9" /></>,
  paw: <><circle cx="6.5" cy="10" r="2" /><circle cx="10" cy="6" r="2" /><circle cx="14" cy="6" r="2" /><circle cx="17.5" cy="10" r="2" /><path d="M12 12c-3 0-5.5 3.2-5.5 5.6 0 1.7 1.3 2.6 2.8 2.6 1.1 0 1.8-.6 2.7-.6s1.6.6 2.7.6c1.5 0 2.8-.9 2.8-2.6C17.5 15.2 15 12 12 12Z" /></>,
  flag: <><path d="M5 21V4" /><path d="M5 4h11l-2.2 4L16 12H5" /></>,
  ff: <><path d="m4 5 7.5 7L4 19Z" /><path d="m12.5 5 7.5 7-7.5 7Z" /></>,
  gauge: <><path d="M3.5 18a9 9 0 1 1 17 0" /><path d="m12 15 4-5" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.6-3.6" /></>,
  home: <><path d="m3 11 9-8 9 8" /><path d="M5.5 9.5V20h13V9.5" /><path d="M10 20v-6h4v6" /></>,
  box: <><path d="m3 7.5 9-4.5 9 4.5v9L12 21l-9-4.5Z" /><path d="m3 7.5 9 4.5 9-4.5" /><path d="M12 12v9" /></>,
  bag: <><path d="M5.5 8.5h13l-1.2 12h-10.6Z" /><path d="M9 8.5V6.5a3 3 0 0 1 6 0v2" /></>,
  burst: <><path d="m12 2 2.2 6.2L20.5 7l-3.6 5 3.6 5-6.3-1.2L12 22l-2.2-6.2L3.5 17l3.6-5-3.6-5 6.3 1.2Z" /></>,
  orb: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4" /><path d="M8.5 8.5 7 7" /></>,
  spark: <><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" /></>,
  bolt: <><path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12Z" /></>,
  shield: <><path d="M12 3 4.5 6v6c0 4.5 3.2 7.8 7.5 9 4.3-1.2 7.5-4.5 7.5-9V6Z" /></>,
  star: <><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z" /></>,
  heart: <><path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10Z" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="1.5" /><path d="M8 11V7.5a4 4 0 0 1 8 0V11" /></>,
  check: <><path d="m5 12.5 4.5 4.5L19 7.5" /></>,
  close: <><path d="M6 6l12 12M18 6 6 18" /></>,
  left: <><path d="m15 5-7 7 7 7" /></>,
  right: <><path d="m9 5 7 7-7 7" /></>,
  swap: <><path d="M4 8h14l-3.5-3.5" /><path d="M20 16H6l3.5 3.5" /></>,
  crown: <><path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5Z" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5Z" /><path d="m3 13 9 5 9-5" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.6 3 2.6 15 0 18M12 3c-2.6 3-2.6 15 0 18" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  up: <><path d="m6 14 6-6 6 6" /></>,
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, solid, className, style }: { name: IconName; solid?: boolean; className?: string; style?: CSSProperties }) {
  return (
    <svg className={`ico${solid === true ? " solid" : ""}${className !== undefined ? ` ${className}` : ""}`} style={style} viewBox="0 0 24 24" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

/** 属性晶石：六棱晶体 + 属性首字 */
export function TypeGem({ t, lg, title }: { t: string; lg?: boolean; title?: string }) {
  return (
    <span className={`tgem${lg === true ? " lg" : ""}`} style={{ "--tc": typeColor(t) } as CSSProperties} title={title ?? `${t}系`}>
      {t.slice(0, 1)}
    </span>
  );
}

/** 精灵头像：六棱晶体框 + 离屏渲染的同一只精灵 */
export function Portrait({ id, meta, size = 64, tone, dead, className }: {
  id: string; meta?: PackMeta | null | undefined; size?: number; tone?: "cy" | "au" | "foe" | undefined; dead?: boolean; className?: string | undefined;
}) {
  const url = usePortrait(id);
  const t0 = meta?.units[id]?.types?.[0];
  return (
    <span className={`pt${tone !== undefined ? ` e-${tone}` : ""}${dead === true ? " dead" : ""}${className !== undefined ? ` ${className}` : ""}`}
      style={{ "--sz": `${size}px`, ...(t0 !== undefined ? { "--tc": typeColor(t0) } : {}) } as CSSProperties}>
      <span className="pt-in">
        {url !== null ? <img src={url} alt="" draggable={false} /> : <span className="pt-fb">{zhSpecies(id, meta).slice(0, 1)}</span>}
      </span>
    </span>
  );
}

const TABS = [
  { id: "home", label: "主界面", href: "/?screen=home", icon: "home", testid: "nav-home" },
  { id: "battle", label: "战斗", href: "/?screen=lobby", icon: "sword", testid: "nav-lobby" },
  { id: "storage", label: "仓库", href: "/?screen=storage", icon: "box", testid: "nav-storage" },
  { id: "bag", label: "背包", href: "/?screen=bag", icon: "bag", testid: "nav-bag" },
] as const;

/** 顶部导航：品牌 + 四个主分区 + 右侧玩家信息（只显示真实数据） */
export function TopNav({ active, right }: { active: (typeof TABS)[number]["id"]; right?: ReactNode }) {
  return (
    <header className="topnav">
      <a className="brand" href="/?screen=home">
        <span className="brand-mark" />
        <span><b>SEER</b><small>REBORN</small></span>
      </a>
      <nav className="navtabs">
        {TABS.map((t) => (
          <a key={t.id} className={`navtab${active === t.id ? " on" : ""}`} href={t.href} data-testid={t.testid}>
            <Icon name={t.icon} />{t.label}
          </a>
        ))}
      </nav>
      <span className="spacer" />
      {right}
    </header>
  );
}

/** 全身立绘（展示台用）：透明底，脚底贴下缘 */
export function CreatureArt({ id, size = 320, flip, className }: { id: string; size?: number; flip?: boolean; className?: string }) {
  const url = usePortrait(id, "full", size, flip === true);
  return (
    <span className={`creature-art${className !== undefined ? ` ${className}` : ""}`} style={{ width: size, height: size }}>
      {url !== null && <img src={url} alt="" draggable={false} />}
    </span>
  );
}

/** 六维条（主界面 / 仓库 / 背包共用）：数值 + 相对最大值比例条 */
export function StatBars({ stats }: { stats: Record<"hp" | "atk" | "def" | "spa" | "sdf" | "spd", number> }) {
  const keys = [["hp", "体力"], ["atk", "攻击"], ["def", "防御"], ["spa", "特攻"], ["sdf", "特防"], ["spd", "速度"]] as const;
  const max = Math.max(...keys.map(([k]) => stats[k]), 1);
  return (
    <div className="statbars">
      {keys.map(([k, zh]) => (
        <div key={k} className={`sb sb-${k}`}>
          <span className="sb-k">{zh}</span>
          <span className="sb-bar"><i style={{ width: `${(stats[k] / max) * 100}%` }} /></span>
          <b className="num">{stats[k]}</b>
        </div>
      ))}
    </div>
  );
}

export function SceneBg({ src }: { src: string }) {
  return <div className="scene-bg" style={{ backgroundImage: `url(${src})` }} />;
}
