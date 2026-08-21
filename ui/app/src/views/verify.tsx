import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Check, Loader2, CircleAlert } from "lucide-react";
import { api, shortSummary, type Project } from "@/lib/api";
import type { ProjectData, Tab } from "@/App";

const MAIN = [
  { s: "discover", n: "Discover", d: "Live crawl: every screen, link and button" },
  { s: "prioritize", n: "Prioritize", d: "AI plans the critical user journeys" },
  { s: "review", n: "Review", d: "You approve, reject or edit each journey", gate: true },
  { s: "run", n: "Run", d: "Execute approved journeys on the live app" },
  { s: "report", n: "Report", d: "Diff intended vs actual, rank the findings" },
];
const EXTRA = [
  { s: "visual", n: "Visual QA", d: "Vision model reads every screenshot" },
  { s: "scan", n: "Scan", d: "Static source pass", needsRepo: true },
  { s: "respec", n: "Respec", d: "Reverse-engineer code → spec" },
];

export function Verify({ project, data, runStage, setTab }: { project?: Project; data: ProjectData; runStage: (s: string) => void; setTab: (t: Tab) => void }) {
  const [checks, setChecks] = useState<any[] | null>(null);
  const [checking, setChecking] = useState(false);
  const lastJob = (stage: string) => data.jobs.find((j: any) => j.stage === stage);
  const stepState = (s: string) => {
    if (s === "review") return data.paths.length ? (data.paths.some((x: any) => x.status !== "planned") ? "done" : "gate") : "";
    const j = lastJob(s);
    return !j ? "" : j.status === "done" ? "done" : j.status === "running" || j.status === "queued" ? "live" : "err";
  };
  return (
    <div className="space-y-6">
      <div className="flex overflow-x-auto rounded-xl border">
        {MAIN.map((x, i) => {
          const st = stepState(x.s);
          const j = lastJob(x.s);
          return (
            <div key={x.s} className={`min-w-40 flex-1 border-l p-4 first:border-l-0 ${st === "live" ? "bg-amber-500/5" : ""}`}>
              <div className={`mb-2 flex size-6 items-center justify-center rounded-full border text-[11px] font-bold
                ${st === "done" ? "border-emerald-500 bg-emerald-500/10 text-emerald-500" : st === "err" ? "border-red-500 bg-red-500/10 text-red-500" : st === "live" ? "border-amber-500 bg-amber-500/10 text-amber-500" : "text-muted-foreground"}`}>
                {st === "done" ? <Check className="size-3.5" /> : st === "err" ? <CircleAlert className="size-3.5" /> : i + 1}
              </div>
              <div className="text-[13.5px] font-semibold">{x.n}</div>
              <div className="mb-3 min-h-8 text-[11px] text-muted-foreground">{x.d}</div>
              {x.gate
                ? <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setTab("journeys")}>Review journeys</Button>
                : <Button size="sm" className="h-7 text-xs" disabled={st === "live"} onClick={() => runStage(x.s)}>
                    {st === "live" ? <><Loader2 className="mr-1 size-3 animate-spin" /> running</> : "Run"}
                  </Button>}
              {j?.summary && <div className="mt-2 text-[10.5px] leading-relaxed text-muted-foreground">{shortSummary(j.summary).slice(0, 90)}</div>}
              {j?.error && <div className="mt-2 text-[10.5px] text-red-500">{j.error.slice(0, 80)}</div>}
            </div>
          );
        })}
      </div>

      <div>
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">More passes</h3>
        <div className="grid gap-3 lg:grid-cols-3">
          {EXTRA.map((x) => {
            const off = x.needsRepo && !project?.repoRoot;
            const j = lastJob(x.s);
            return (
              <Card key={x.s} className={off ? "opacity-50" : ""}>
                <CardHeader className="pb-2"><CardTitle className="text-sm">{x.n}</CardTitle>
                  <CardDescription className="text-xs">{off ? "Connect a repo in Settings to enable" : x.d}</CardDescription></CardHeader>
                <CardContent>
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={off} onClick={() => runStage(x.s)}>Run</Button>
                  {j?.summary && <div className="mt-2 text-[10.5px] text-muted-foreground">{shortSummary(j.summary).slice(0, 90)}</div>}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Environment</CardTitle></CardHeader>
        <CardContent>
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={checking}
            onClick={async () => { setChecking(true); try { setChecks(await api(`/api/projects/${project?.id}/preflight`)); } finally { setChecking(false); } }}>
            {checking ? <><Loader2 className="mr-1 size-3 animate-spin" /> checking…</> : "Run preflight checks"}
          </Button>
          {checks && (
            <Table className="mt-3"><TableBody>
              {checks.map((c) => (
                <TableRow key={c.name}>
                  <TableCell className="w-14"><Badge variant="outline" className={c.ok ? "text-emerald-500" : "text-red-500"}>{c.ok ? "ok" : "fix"}</Badge></TableCell>
                  <TableCell className="w-44 font-medium">{c.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c.detail}{c.fix && <b className="ml-1 text-amber-500">— {c.fix}</b>}</TableCell>
                </TableRow>
              ))}
            </TableBody></Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
