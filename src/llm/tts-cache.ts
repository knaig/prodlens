// Spec: v2 §4.4 (PM2), §12.2 - see spec/traceability.md
// Where synthesized narration clips are cached.
//
// This was `join(process.cwd(), "data", "tts-cache")` in two places, which
// made the cache follow the SHELL's working directory rather than the install.
// Running the same render from a different directory therefore missed every
// entry and re-paid the TTS provider for identical audio - the clips ended up
// split across as many caches as there were places you launched from.
//
// Anchoring to the package means one cache per install, whatever the cwd.
// PRODLENS_TTS_CACHE overrides it (a shared volume, or a scratch dir in tests).
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Package root: this file is <root>/src/llm/ under tsx and <root>/dist/llm/
 *  after a build, so two levels up is the root either way. */
function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function ttsCacheDir(): string {
  return process.env.PRODLENS_TTS_CACHE || join(packageRoot(), "data", "tts-cache");
}

/** The cache dir, created if absent. Returns undefined when it cannot be made,
 *  so callers degrade to "no caching" instead of failing a render. */
export function ensureTtsCacheDir(): string | undefined {
  const dir = ttsCacheDir();
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    return undefined;
  }
}
