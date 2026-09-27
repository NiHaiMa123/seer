/**
 * router.ts —— HTTP 路由注册表：插件体系的 service 装配点。
 * 每个功能域是一个插件，通过 `http.router` 服务键注册自己的路由；
 * 卸载插件 → disposer 撤路由 → 端点随模块消失。
 */
import type { IncomingMessage, ServerResponse } from "node:http";

export interface RouteRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  req: IncomingMessage;
  res: ServerResponse;
  json(status: number, body: unknown): void;
}

export type RouteHandler = (r: RouteRequest) => Promise<void> | void;

interface Route {
  owner: string;
  method: string; // "*" 匹配任意方法
  segments: string[]; // ":name" 捕获单段；"*" 捕获剩余全部
  handler: RouteHandler;
}

export const HTTP_ROUTER_SERVICE = "http.router";

export class Router {
  private readonly routes: Route[] = [];

  /** 返回 disposer——插件卸载时撤销本插件的全部路由 */
  register(owner: string, method: string, template: string, handler: RouteHandler): () => void {
    const route: Route = { owner, method, segments: template.split("/").filter(Boolean), handler };
    this.routes.push(route);
    return () => {
      const i = this.routes.indexOf(route);
      if (i >= 0) this.routes.splice(i, 1);
    };
  }

  routeCount(): number {
    return this.routes.length;
  }

  /** @returns false = 无任何路由匹配（由调用方决定 404/静态兜底） */
  async dispatch(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    let pathMatched = false;
    for (const route of this.routes) {
      const params = this.match(route.segments, parts);
      if (params === null) continue;
      pathMatched = true;
      if (route.method !== "*" && route.method !== req.method) continue;
      await route.handler({
        method: req.method ?? "GET", path: url.pathname, query: url.searchParams,
        params, req, res, json,
      });
      return true;
    }
    if (pathMatched) {
      json(405, { code: "INVALID_SCHEMA", message: "method" });
      return true;
    }
    return false;
  }

  private match(segments: string[], parts: string[]): Record<string, string> | null {
    const params: Record<string, string> = {};
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      if (seg === "*") return params;
      const part = parts[i];
      if (part === undefined) return null;
      if (seg.startsWith(":")) params[seg.slice(1)] = decodeURIComponent(part);
      else if (seg !== part) return null;
    }
    return segments.length === parts.length || segments[segments.length - 1] === "*" ? params : null;
  }
}
