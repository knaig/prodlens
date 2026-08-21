import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFinding, visualReportToIssues, type VisualReport } from "./triage.js";

test("parseFinding coerces loose model output into a stable finding", () => {
  const f = parseFinding(
    '```json\n{"broken": true, "severity": "HIGH", "category": "Spinner", "evidence": "spinner worked but nothing appears", "suggested_action": "check data fetch"}\n```'
  );
  assert.ok(f);
  assert.equal(f.broken, true);
  assert.equal(f.severity, "high");
  assert.equal(f.category, "spinner");
  assert.equal(f.evidence, "spinner worked but nothing appears");
  assert.equal(f.suggested_action, "check data fetch");
});

test("parseFinding rejects non-JSON and unknown severities", () => {
  assert.equal(parseFinding("I don't see anything wrong"), undefined);
  assert.equal(parseFinding('{"broken":true,"severity":"nah"}'), undefined);
});

test("visualReportToIssues skips ok shots and maps severity/evidence to the pipeline's Issue shape", () => {
  const report: VisualReport = {
    generatedAt: "2026-08-10T00:00:00.000Z",
    model: "qwen-vl-max",
    total: 2,
    flagged: 1,
    shots: [
      {
        nodeId: "/ok",
        screenshotPath: "/p/ok.png",
        finding: { broken: false, severity: "ok", category: "ok", evidence: "fine", suggested_action: "" },
      },
      {
        nodeId: "/bad",
        screenshotPath: "/p/bad.png",
        finding: { broken: true, severity: "critical", category: "blank-shell", evidence: "nothing renders", suggested_action: "check client bundle" },
      },
    ],
  };
  const issues = visualReportToIssues(report);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].type, "visual");
  assert.equal(issues[0].severity, "critical");
  assert.deepEqual(issues[0].nodeIds, ["/bad"]);
  assert.equal(issues[0].evidence?.[0].type, "screenshot");
  assert.equal(issues[0].evidence?.[0].pathOrValue, "/p/bad.png");
  assert.equal(issues[0].evidence?.[0].timestamp, "2026-08-10T00:00:00.000Z");
});