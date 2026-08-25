// Spec: v2 §4.4 (PM2) - see spec/traceability.md
import { test } from "node:test";
import assert from "node:assert/strict";
import { chdir, cwd } from "node:process";
import { tmpdir } from "node:os";
import { ttsCacheDir } from "./tts-cache.js";

test("the cache location does not follow the working directory", () => {
  // Regression: this was join(process.cwd(), "data", "tts-cache") in two
  // places, so running a render from a different directory missed every entry
  // and re-paid the TTS provider for identical audio. The clips ended up split
  // across as many caches as there were places you launched from - 46 stranded
  // in one checkout, 8 in another, neither seeing the other.
  const here = cwd();
  try {
    const fromRepo = ttsCacheDir();
    chdir(tmpdir());
    assert.equal(ttsCacheDir(), fromRepo, "cache dir must be anchored to the package, not the cwd");
  } finally {
    chdir(here);
  }
});

test("PRODLENS_TTS_CACHE overrides it", () => {
  const prev = process.env.PRODLENS_TTS_CACHE;
  try {
    process.env.PRODLENS_TTS_CACHE = "/tmp/prodlens-tts-override";
    assert.equal(ttsCacheDir(), "/tmp/prodlens-tts-override");
  } finally {
    if (prev === undefined) delete process.env.PRODLENS_TTS_CACHE;
    else process.env.PRODLENS_TTS_CACHE = prev;
  }
});
