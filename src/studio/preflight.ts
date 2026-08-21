// Onboarding preflight (spec v2 §7 P7): each check returns ok + a fix hint.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chromium } from "playwright";
import { isLlmConfigured, isLlmReachable } from "../llm/local.js";
import { hasCredentials, type Project } from "../web/registry.js";

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

export async function preflight(project: Project): Promise<Check[]> {
  const checks: Check[] = [];

  // 1. base URL reachable
  try {
    const res = await fetch(project.baseUrl, { signal: AbortSignal.timeout(6000) });
    checks.push({ name: "app reachable", ok: res.status < 500, detail: `${project.baseUrl} -> HTTP ${res.status}` });
  } catch (e) {
    checks.push({ name: "app reachable", ok: false, detail: String(e instanceof Error ? e.message : e), fix: `start the app at ${project.baseUrl}, or fix the base URL in settings` });
  }

  // 2. credentials
  if (project.auth.strategy === "none") {
    checks.push({ name: "auth", ok: true, detail: "no auth configured" });
  } else {
    const has = hasCredentials(project.id);
    checks.push({ name: "auth credentials", ok: has, detail: has ? `stored for ${project.auth.strategy}` : "missing", fix: has ? undefined : "add login email + password in project settings" });
  }

  // 3. LLM endpoint
  if (isLlmConfigured()) {
    const up = await isLlmReachable();
    checks.push({ name: "LLM endpoint", ok: up, detail: up ? "configured + reachable" : "configured but unreachable", fix: up ? undefined : "check LLM_BASE_URL / LLM_API_KEY; heuristics will be used meanwhile" });
  } else {
    checks.push({ name: "LLM endpoint", ok: false, detail: "not configured - journeys/respec/compiler fall back to heuristics", fix: "set LLM_BASE_URL + LLM_API_KEY + LLM_MODEL in .env" });
  }

  // 4. TTS
  checks.push({
    name: "narration TTS",
    ok: Boolean(process.env.GEMINI_API_KEY),
    detail: process.env.GEMINI_API_KEY ? "Gemini TTS available (styles supported)" : "no GEMINI_API_KEY - will fall back to Kokoro/say",
    fix: process.env.GEMINI_API_KEY ? undefined : "set GEMINI_API_KEY for neural voices + accent styles",
  });

  // 5. ffmpeg
  const ff = await new Promise<boolean>((r) => execFile("ffmpeg", ["-version"], (err) => r(!err)));
  checks.push({ name: "ffmpeg", ok: ff, detail: ff ? "found" : "not found", fix: ff ? undefined : "brew install ffmpeg" });

  // 6. Playwright chromium
  let chromiumOk = false;
  try {
    chromiumOk = existsSync(chromium.executablePath());
  } catch { /* not installed */ }
  checks.push({ name: "playwright chromium", ok: chromiumOk, detail: chromiumOk ? "installed" : "missing", fix: chromiumOk ? undefined : "npx playwright install chromium" });

  // 7. source (optional)
  checks.push(
    project.repoRoot
      ? { name: "source access", ok: existsSync(project.repoRoot), detail: existsSync(project.repoRoot) ? project.repoRoot : `${project.repoRoot} not found`, fix: existsSync(project.repoRoot) ? undefined : "fix repoRoot in settings" }
      : { name: "source access", ok: true, detail: "UX-only project (live URL + login; scan disabled, respec runs graph+docs-only)" }
  );

  return checks;
}
