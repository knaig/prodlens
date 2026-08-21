// Same-origin API client for the prodlens engine server.
export async function api<T = any>(path: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(path, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as any).error || `HTTP ${r.status}`);
  return j as T;
}
export const post = <T = any>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
export const put = <T = any>(path: string, body?: unknown) =>
  api<T>(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
export const del = <T = any>(path: string) => api<T>(path, { method: "DELETE" });

export interface Project {
  id: string; name: string; baseUrl: string; entry: string[];
  repoRoot?: string; appDir?: string; sources?: string[];
  auth: { strategy: string; tokenInLocalStorage?: boolean };
  hasCredentials: boolean; onboarded: boolean;
}
export function relTime(iso?: string): string {
  if (!iso) return "";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
export function shortSummary(s: Record<string, unknown>): string {
  return Object.entries(s).filter(([k]) => !/path|Path|video|artifact/i.test(k)).map(([k, v]) => `${k} ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ");
}
export const STAGE_SPEAK: Record<string, string> = {
  discover: "Meera (QA) is crawling every screen and clicking every button — ~2 min.",
  prioritize: "Meera is planning the critical user journeys — ~1 min.",
  run: "Meera is executing approved journeys on the live app — a browser window may open.",
  report: "Meera is diffing intended vs actual and ranking findings.",
  visual: "Meera is reading every screenshot with a vision model — ~1-2 min.",
  scan: "Dev (engineer) is statically scanning the source — ~30s.",
  respec: "Asha (architect) is reverse-engineering the product into a spec — ~1-2 min.",
  "render-draft": "Priya (PM) is recording a silent draft — a browser window will drive your app.",
  "render-final": "Priya (PM) is recording and narrating the final cut — ~4-8 min.",
};
