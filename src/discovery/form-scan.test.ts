import { test } from "node:test";
import assert from "node:assert/strict";
import { pairClusters, type ClusterButton, type ClusterElement } from "./form-scan.js";

function field(partial: Partial<ClusterElement> & { x: number; y: number; type: string }): ClusterElement {
  return { tag: "input", ...partial } as ClusterElement;
}

function btn(partial: Partial<ClusterButton> & { x: number; y: number; label: string }): ClusterButton {
  return { label: partial.label, x: partial.x, y: partial.y };
}

test("pairs a submit button with the input below it (no <form> tag)", () => {
  const buttons = [btn({ label: "Generate my strategy", x: 200, y: 400 })];
  const fields = [field({ x: 150, y: 360, type: "text", name: "title", placeholder: "Name of your project" })];
  const clusters = pairClusters(buttons, fields);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].fields.length, 1);
  assert.equal(clusters[0].fields[0].selector, "[name=\"title\"]");
  assert.equal(clusters[0].button.label, "Generate my strategy");
});

test("pairs fields above a vertical-form submit button (within 400px), rejects ones too far", () => {
  const button = btn({ label: "Save", x: 200, y: 500 });
  const near = field({ x: 200, y: 120, type: "text", name: "near" }); // 380px above -> pairs
  const tooFar = field({ x: 200, y: 50, type: "text", name: "far" }); // 450px above -> rejected
  const clusters = pairClusters([button], [near, tooFar]);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].fields.length, 1);
  assert.equal(clusters[0].fields[0].name, "near");
});

test("fields nearest a button are grouped together, and one above/below each other share the band", () => {
  const button = btn({ label: "Add", x: 200, y: 400 });
  const a = field({ x: 120, y: 380, type: "text", placeholder: "Guardrail" });
  const b = field({ x: 130, y: 420, type: "textarea", placeholder: "Limit" });
  const clusters = pairClusters([button], [a, b]);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].fields.length, 2);
});

test("select elements are excluded from heuristic filling", () => {
  const button = btn({ label: "Create", x: 200, y: 400 });
  const select = field({ x: 200, y: 380, type: "select" });
  const text = field({ x: 120, y: 380, type: "text", name: "name" });
  const clusters = pairClusters([button], [select, text]);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].fields.length, 1);
  assert.equal(clusters[0].fields[0].type, "text");
});

test("empty submit labels and over-long labels are not treated as submit buttons", () => {
  const empty = btn({ label: "", x: 100, y: 100 });
  const long = btn({ label: "a".repeat(70), x: 300, y: 300 });
  const field1 = field({ x: 100, y: 90, type: "text", name: "x" });
  const clusters = pairClusters([empty, long], [field1]);
  assert.equal(clusters.length, 0);
});

test("placeholder fallback selector", () => {
  const button = btn({ label: "Submit form", x: 200, y: 400 });
  const noName = field({ x: 180, y: 380, type: "email", placeholder: "you@example.com" });
  const clusters = pairClusters([button], [noName]);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].fields[0].selector, "[placeholder=\"you@example.com\"]");
});