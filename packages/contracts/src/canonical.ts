/**
 * Canonical JSON encoding (battle-engine.md §5):
 * keys sorted by code unit (ASCII keys only), NFC-normalized strings,
 * no undefined/non-finite/-0, integers in decimal. Deterministic across runtimes.
 */
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const ASCII_KEY = /^[\x20-\x7e]+$/;

export function canonicalJson(value: unknown): string {
  return ser(value);
}

function ser(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!Number.isFinite(v) || Object.is(v, -0) || !Number.isSafeInteger(v)) {
      throw new TypeError("canonicalJson: number must be a safe integer");
    }
    return JSON.stringify(v);
  }
  if (typeof v === "string") return JSON.stringify(v.normalize("NFC"));
  if (Array.isArray(v)) return `[${v.map((item) => ser(item)).join(",")}]`;
  if (typeof v !== "object") throw new TypeError("canonicalJson: unsupported value");
  const keys = Object.keys(v as Record<string, unknown>);
  for (const k of keys) {
    if (!ASCII_KEY.test(k)) throw new TypeError(`canonicalJson: non-ASCII key "${k}"`);
  }
  keys.sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${ser((v as Record<string, unknown>)[k])}`).join(",")}}`;
}
