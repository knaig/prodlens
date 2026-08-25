#!/usr/bin/env node
// Spec: enforces spec/README.md §4 (traceability rules) - see spec/traceability.md
// Fails when the spec and the code stop agreeing about each other:
//   A. an internal spec/doc link points at a file that isn't there
//   B. traceability.md names a module that doesn't exist
//   C. a module in the code->spec index (§7) has no `// Spec:` anchor
//   D. an anchored module is missing from the index
//   E. a code anchor cites an FR-/NFR- id the Product Spec never defines
// Run: npm run spec:check

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const failures = [];
const fail = (check, msg) => failures.push(`[${check}] ${msg}`);
const read = (p) => readFileSync(join(root, p), "utf-8");

function walk(dir, filter, out = []) {
  for (const name of readdirSync(join(root, dir))) {
    if (name === "node_modules" || name === ".git") continue;
    const rel = join(dir, name);
    if (statSync(join(root, rel)).isDirectory()) walk(rel, filter, out);
    else if (filter(rel)) out.push(rel);
  }
  return out;
}

const ANCHOR = /^\/\/ Spec: (.+?) - see spec\/traceability\.md$/;
const HEAD_LINES = 8;

function anchorOf(relPath) {
  const lines = read(relPath).split("\n").slice(0, HEAD_LINES);
  for (const line of lines) {
    const m = line.match(ANCHOR);
    if (m) return m[1];
  }
  return null;
}

// ---- A. internal links resolve ----
const mdFiles = [
  ...walk("spec", (p) => p.endsWith(".md")),
  ...walk("docs", (p) => p.endsWith(".md")),
  "README.md",
];
for (const md of mdFiles) {
  for (const m of read(md).matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const link = m[1];
    if (/^(https?:|#|mailto:)/.test(link)) continue;
    const target = link.split("#")[0];
    if (!target) continue;
    if (!existsSync(resolve(root, dirname(md), target))) fail("A", `${md}: broken link ${link}`);
  }
}

// ---- parse the code->spec index in traceability.md §7 ----
const trace = read("spec/traceability.md");
// Matched by name, not number, so sections can be renumbered freely.
const indexSection = trace.split(/^##\s+\d+\.\s+Code -> spec index\s*$/m)[1];
if (!indexSection) fail("C", "spec/traceability.md is missing its 'Code -> spec index' section");
const indexed = new Set(
  [...(indexSection ?? "").matchAll(/`(src\/[^`]+\.ts)`/g)].map((m) => m[1]),
);

// ---- B. every module the matrix names exists ----
for (const m of trace.matchAll(/`(src\/[^`]+\.ts)`/g)) {
  if (!existsSync(join(root, m[1]))) fail("B", `spec/traceability.md names a missing module: ${m[1]}`);
}

// ---- C + D. index and anchors agree ----
const anchored = new Map();
for (const f of walk("src", (p) => p.endsWith(".ts"))) {
  const a = anchorOf(f);
  if (a) anchored.set(f, a);
}
for (const f of indexed) {
  if (existsSync(join(root, f)) && !anchored.has(f))
    fail("C", `${f} is in the code->spec index but has no '// Spec:' anchor in its first ${HEAD_LINES} lines`);
}
for (const f of anchored.keys()) {
  if (!indexed.has(f)) fail("D", `${f} is anchored but missing from the code->spec index (traceability.md §7)`);
}

// ---- E. cited FR-/NFR- ids are defined ----
const productSpec = read("spec/Prodlens-Product-Spec.md");
// Ids are defined in bold, either alone (`**NFR-4**`) or heading a line
// (`**FR-UI-1 — Live Graph / Tree View**`).
const defined = new Set([...productSpec.matchAll(/\*\*(FR-[A-Z]+-\d+|NFR-\d+)\b/g)].map((m) => m[1]));
for (const [file, ids] of anchored) {
  for (const m of ids.matchAll(/\b(FR-[A-Z]+-\d+|NFR-\d+)\b/g)) {
    if (!defined.has(m[1])) fail("E", `${file} cites ${m[1]}, which the Product Spec does not define`);
  }
}

// ---- report ----
if (failures.length) {
  console.error(`spec-check: ${failures.length} problem(s)\n`);
  for (const f of failures) console.error("  " + f);
  console.error("\nSee spec/README.md §4 for the traceability rules.");
  process.exit(1);
}
console.log(
  `spec-check: ok (${mdFiles.length} docs linked, ${anchored.size} modules anchored, ${defined.size} requirement ids defined)`,
);
