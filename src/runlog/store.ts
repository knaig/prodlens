// Append-only run log store. One run = one JSONL file
// (data/projects/<app>/runs/v0.N/log.jsonl); each line is one RunEvent.
// append() validates seq/time and JSON-serializability before commit, so the
// file always equals the in-memory log. flush() writes pending events; the
// store is the persistence half of the runlog pair, derive.ts owns reads.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { AnyRunEvent, RunEvent, RunEventMap, RunEventType } from "./events.js";

export class RunLog {
  private events_: AnyRunEvent[] = [];
  private buffered = 0;
  private readonly path: string | undefined;

  constructor(opts: { path?: string } = {}) {
    this.path = opts.path;
    if (this.path) mkdirSync(dirname(this.path), { recursive: true });
  }

  /** Number of committed events. */
  get length(): number {
    return this.events_.length;
  }

  get events(): readonly AnyRunEvent[] {
    return this.events_;
  }

  append<T extends RunEventType>(type: T, data: RunEventMap[T]): RunEvent<T> {
    // Lossless-JSON guard mirrors dsh's append contract: a bad event must fail
    // here rather than corrupt the durable log later. Undefined-valued object
    // keys are normalized away first (absent = no value, so they are not
    // lossy); undefined inside arrays stays a rejection because it would
    // serialize to null.
    const normalized = normalizeJson(data) as RunEventMap[T];
    if (!isJsonSerializable(normalized)) {
      throw new TypeError(`runlog event ${type} carries non-lossless-JSON data`);
    }
    const event = {
      type,
      seq: this.events_.length,
      time: Date.now(),
      data: normalized,
    } as RunEvent<T>;
    this.events_.push(event);
    this.buffered++;
    return event;
  }

  /** Persist all buffered events. No-op for an in-memory-only log. */
  flush(): void {
    if (!this.path || this.buffered === 0) return;
    let chunk = "";
    for (let i = this.events_.length - this.buffered; i < this.events_.length; i++) {
      chunk += JSON.stringify(this.events_[i]) + "\n";
    }
    appendFileSync(this.path, chunk, "utf-8");
    this.buffered = 0;
  }

  close(): void {
    this.flush();
  }
}

/** Load a log.jsonl file into an in-memory log, validating contiguity. */
export function loadRunLog(path: string): AnyRunEvent[] {
  if (!existsSync(path)) return [];
  const events = readFileSync(path, "utf-8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as AnyRunEvent);
  events.forEach((e, i) => {
    if (e.seq !== i) throw new Error(`runlog corrupt at ${path}: seq ${e.seq} at position ${i}`);
  });
  return events;
}

/** Reset a log file (used before a run that must not append to a prior run's). */
export function initRunLog(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "", "utf-8");
}

function isJsonSerializable(value: unknown, seen?: Set<object>): boolean {
  if (value === null) return true;
  // undefined is lossy under JSON.stringify (dropped from objects, null in
  // arrays) and therefore not lossless-JSON.
  if (value === undefined) return false;
  const t = typeof value;
  if (t === "string" || t === "boolean") return true;
  if (t === "number") return Number.isFinite(value);
  if (t === "bigint" || t === "function" || t === "symbol") return false;
  if (Array.isArray(value)) {
    const s = seen ?? new Set<object>();
    if (s.has(value)) return false;
    s.add(value);
    return value.every((v) => isJsonSerializable(v, s));
  }
  if (t === "object") {
    const s = seen ?? new Set<object>();
    if (s.has(value)) return false;
    s.add(value);
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (!isJsonSerializable(v, s)) return false;
    }
    return true;
  }
  return false;
}

/** Deep-copy a JSON value, dropping undefined-valued object keys (absent = no
 *  value). Arrays keep every slot so undefined inside an array still fails the
 *  lossless guard downstream. */
function normalizeJson<T>(value: T): T {
  if (Array.isArray(value)) return value.map(normalizeJson) as unknown as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = normalizeJson(v);
    }
    return out as T;
  }
  return value;
}
