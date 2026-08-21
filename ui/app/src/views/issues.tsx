import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { post, type Project } from "@/lib/api";
import { StatusBadge } from "./overview";
import type { ProjectData, Tab } from "@/App";

export function Issues({ project, data, refresh, setTab }: { project?: Project; data: ProjectData; refresh: () => Promise<void>; setTab: (t: Tab) => void }) {
  const r = data.report;
  if (!r)
    return (
      <Card className="border-dashed"><CardContent className="py-12 text-center text-sm text-muted-foreground">
        No verification report yet. Run the pipeline through <button className="text-primary underline" onClick={() => setTab("verify")}>Report</button>.
      </CardContent></Card>
    );
  const s = r.summary ?? {};
  const triage = async (issueId: string, verdict: string) => {
    await post(`/api/projects/${project?.id}/triage`, { issueId, verdict });
    await refresh();
    toast.success("triage saved → feeds GEPA");
  };
  const border = (sev: string) => sev === "critical" || sev === "high" ? "border-l-red-500" : sev === "medium" ? "border-l-amber-500" : "border-l-muted";
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        {[[r.issues?.length ?? 0, "findings"], [s.nodesCovered ?? "–", "screens covered"], [s.brokenTransitions ?? "–", "broken transitions"], [s.deadEnds ?? "–", "dead ends"]].map(([v, l]) => (
          <Card key={String(l)}><CardContent className="pt-5"><div className="text-2xl font-extrabold">{v as any}</div><div className="text-xs text-muted-foreground">{l}</div></CardContent></Card>
        ))}
      </div>
      <div className="space-y-2">
        {(r.issues ?? []).map((i: any) => {
          const t = data.triage[i.id];
          return (
            <div key={i.id} className={`flex items-start gap-4 rounded-lg border border-l-4 bg-card p-4 ${border(i.severity)}`}>
              <StatusBadge s={i.severity} />
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold">{i.title}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{i.description}</div>
              </div>
              <div className="shrink-0 space-x-1.5">
                {t ? <StatusBadge s={t.verdict} /> : (
                  <>
                    <Button size="sm" variant="outline" className="h-7 text-xs text-emerald-500" onClick={() => triage(i.id, "confirmed")}>real</Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs text-red-500" onClick={() => triage(i.id, "false-positive")}>false</Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => triage(i.id, "env")}>env</Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
