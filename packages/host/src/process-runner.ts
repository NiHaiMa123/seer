import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import type { ProcessExecutionRequest } from "./executor.ts";

interface ProcessEntrypoint {
  execute(request: ProcessExecutionRequest): unknown | Promise<unknown>;
}

async function main(): Promise<void> {
  const entrypoint = process.argv[2];
  if (!entrypoint) throw new Error("missing executable entrypoint");
  const request = JSON.parse(readFileSync(0, "utf8")) as ProcessExecutionRequest;
  const url = entrypoint.startsWith("file:") ? entrypoint : pathToFileURL(resolve(entrypoint)).href;
  const loaded = await import(url) as Partial<ProcessEntrypoint>;
  if (typeof loaded.execute !== "function") throw new Error("executable entrypoint has no execute(request)");
  const value = await loaded.execute(request);
  process.stdout.write(JSON.stringify({
    ok: true,
    pid: process.pid,
    executableHash: request.executableHash,
    rulesetHash: request.rules.rulesetHash,
    contentHash: request.rules.contentHash,
    value,
  }));
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({ ok: false, pid: process.pid, error: (error as Error).message }));
});
