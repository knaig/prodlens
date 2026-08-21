import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunDir, nextRunVersion } from "./version.js";

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), "prodlens-run-ver-"));
}

test("nextRunVersion starts at v0.1 and increments past the highest existing", () => {
  const root = tempProject();
  try {
    assert.equal(nextRunVersion(root), "v0.1");
    mkdirSync(dirname(join(root, "runs", "v0.1")), { recursive: true })
    mkdirSync(join(root, "runs", "v0.1"));
    assert.equal(nextRunVersion(root), "v0.2");
    mkdirSync(join(root, "runs", "v0.3"), { recursive: true });
    mkdirSync(join(root, "runs", "v0.7"), { recursive: true });
    assert.equal(nextRunVersion(root), "v0.8");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ignores folders that aren't v0.<n> run versions", () => {
  const root = tempProject();
  try {
    mkdirSync(join(root, "runs", "visual"), { recursive: true });
    mkdirSync(join(root, "runs", "reports"), { recursive: true });
    assert.equal(nextRunVersion(root), "v0.1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("createRunDir makes and returns the next versioned folder each call", () => {
  const root = tempProject();
  try {
    assert.equal(createRunDir(root), join(root, "runs", "v0.1"));
    assert.equal(createRunDir(root), join(root, "runs", "v0.2"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
