import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { ShieldCheck, Clapperboard, Compass } from "lucide-react";
import { relTime, shortSummary, type Project } from "@/lib/api";
import type { ProjectData, Tab } from "@/App";

export function Overview({ project, data, setTab }: { project?: Project; data: ProjectData; setTab: (t: Tab) => void }) {
  const d = data.jobs.find((j) => j.stage === "discover");
  const vids = data.artifacts.filter((a: any) => a.rel.endsWith(".mp4"));
  const issues = data.report ? (data.report.issues ?? []).length : "–";
  const crit = data.report ? (data.report.issues ?? []).filter((i: any) => i.severity === "critical" || i.severity === "high").length : 0;
  const stats = [
    { v: d?.summary?.nodes ?? "–", l: "screens discovered", s: d ? relTime(d.startedAt) : "never crawled" },
    { v: data.paths.length, l: "journeys planned", s: `${data.paths.filter((x: any) => x.status === "approved" || x.status === "passed").length} approved` },
    { v: issues, l: "open findings", s: `${crit} high or critical`, red: Boolean(crit) },
    { v: vids.length, l: "videos rendered", s: vids[0] ? relTime(vids[0].mtime) : "none yet" },
  ];
  const actions = [
    { icon: ShieldCheck, t: "Verify this build", d: "Crawl every screen, execute the critical journeys, get a ranked defect report.", tab: "verify" as Tab, cta: "Open pipeline" },
    { icon: Clapperboard, t: "Make a video", d: "Write a script in plain prose; ProdLens grounds it in real screens and renders a narrated demo.", tab: "studio" as Tab, cta: "Open studio" },
    { icon: Compass, t: "Understand the product", d: "Reverse-engineer the architecture, define vision, annotate what the AI got wrong.", tab: "understand" as Tab, cta: "Open respec" },
  ];
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.l}><CardContent className="pt-5">
            <div className={`text-2xl font-extrabold ${s.red ? "text-red-500" : ""}`}>{s.v}</div>
            <div className="text-xs text-muted-foreground">{s.l}</div>
            <div className="mt-1 text-[11px] text-muted-foreground/60">{s.s}</div>
          </CardContent></Card>
        ))}
      </div>
      <div>
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">What do you want to do?</h3>
        <div className="grid gap-3 lg:grid-cols-3">
          {actions.map(({ icon: Icon, ...a }) => (
            <Card key={a.t}>
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-[15px]"><Icon className="size-4 text-primary" /> {a.t}</CardTitle>
                <CardDescription className="text-[12.5px]">{a.d}</CardDescription></CardHeader>
              <CardContent><Button size="sm" onClick={() => setTab(a.tab)}>{a.cta}</Button></CardContent>
            </Card>
          ))}
        </div>
      </div>
      {vids.length > 0 && (
        <div>
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Latest render</h3>
          <Card><CardContent className="pt-5">
            <video controls preload="metadata" className="max-w-2xl rounded-lg border shadow-lg" src={`/api/projects/${project?.id}/file?path=${encodeURIComponent(vids[0].rel)}`} />
            <div className="mt-3 space-y-1 text-[12.5px]">
              {vids.slice(0, 5).map((v: any) => (
                <div key={v.rel}>
                  <a className="text-primary hover:underline" target="_blank" href={`/api/projects/${project?.id}/file?path=${encodeURIComponent(v.rel)}`}>{v.rel.split("/").pop()}</a>
                  <span className="ml-2 text-muted-foreground">{(v.size / 1e6).toFixed(1)} MB · {relTime(v.mtime)}</span>
                </div>
              ))}
            </div>
          </CardContent></Card>
        </div>
      )}
      <div>
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Recent activity</h3>
        {data.jobs.length ? (
          <Card><CardContent className="pt-2"><Table><TableBody>
            {data.jobs.slice(0, 6).map((j: any) => (
              <TableRow key={j.id}>
                <TableCell className="w-32 font-medium">{j.stage}</TableCell>
                <TableCell className="w-28"><StatusBadge s={j.status} /></TableCell>
                <TableCell className="w-24 text-muted-foreground">{relTime(j.startedAt)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{(j.summary ? shortSummary(j.summary) : j.error ?? "").slice(0, 110)}</TableCell>
              </TableRow>
            ))}
          </TableBody></Table></CardContent></Card>
        ) : (
          <Card className="border-dashed"><CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nothing has run yet. Start with <button className="text-primary underline" onClick={() => setTab("verify")}>Verify</button> — discovery takes about two minutes.
          </CardContent></Card>
        )}
      </div>
    </div>
  );
}

export function StatusBadge({ s }: { s: string }) {
  const cls = ["done", "passed", "approved", "confirmed"].includes(s) ? "text-emerald-500 border-emerald-500/40 bg-emerald-500/5"
    : ["error", "failed", "skipped", "critical"].includes(s) ? "text-red-500 border-red-500/40 bg-red-500/5"
    : "text-amber-500 border-amber-500/40 bg-amber-500/5";
  return <Badge variant="outline" className={`text-[10.5px] ${cls}`}>{s}</Badge>;
}
