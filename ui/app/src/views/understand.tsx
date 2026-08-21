import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { api, post, put, type Project } from "@/lib/api";
import type { ProjectData } from "@/App";

export function Understand({ project, runStage }: { project?: Project; data: ProjectData; runStage: (s: string) => void }) {
  const [vision, setVision] = useState("");
  const [respec, setRespec] = useState<any | null>(null);
  useEffect(() => {
    if (!project) return;
    void api(`/api/projects/${project.id}/vision`).then((v) => setVision(v.text));
    void api(`/api/projects/${project.id}/respec`).then((r) => setRespec(r.respec));
  }, [project]);
  const annotate = async (key: string, note: string) => {
    await post(`/api/projects/${project?.id}/respec/annotate`, { key, note });
    toast.success("annotation saved");
  };
  return (
    <div className="space-y-5">
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Vision <span className="ml-1 text-[10px] font-normal text-muted-foreground">gate 1 · feeds every AI stage</span></CardTitle></CardHeader>
          <CardContent>
            <Textarea value={vision} onChange={(e) => setVision(e.target.value)} className="min-h-36 text-[13px]" placeholder="Goals, audiences, key features, what to show / avoid…" />
            <div className="mt-3 space-x-2">
              <Button size="sm" onClick={async () => { await put(`/api/projects/${project?.id}/vision`, { text: vision }); toast.success("vision saved"); }}>Save vision</Button>
              <Button size="sm" variant="outline" onClick={() => runStage("respec")}>Regenerate respec {project?.repoRoot ? "" : "(graph-only)"}</Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">How this works</CardTitle>
            <CardDescription className="text-xs leading-relaxed">
              ProdLens reads {project?.repoRoot ? "the source, docs and the discovered graph" : "the discovered graph (no source connected)"} and writes what the product actually is —
              components, capabilities, key flows and doc-drift. Your annotations are authoritative: regeneration never overwrites them.
            </CardDescription></CardHeader>
        </Card>
      </div>

      {!respec ? (
        <Card className="border-dashed"><CardContent className="py-10 text-center text-sm text-muted-foreground">No respec yet — click "Regenerate respec" (about a minute).</CardContent></Card>
      ) : (
        <>
          <Card><CardContent className="pt-4 text-sm"><b>{respec.oneLiner}</b> <Badge variant="outline" className="ml-2 text-[10px]">{respec.source}</Badge></CardContent></Card>
          {respec.personas?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">{respec.personas.map((p: string) => <Badge key={p} variant="secondary" className="max-w-full whitespace-normal text-[11px] font-normal">{p.split("—")[0].trim()}</Badge>)}</div>
          )}
          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Topology · {respec.topology.length} components</h3>
            <Card><CardContent className="pt-2"><Table><TableBody>
              {respec.topology.map((c: any) => (
                <TableRow key={c.name}>
                  <TableCell className="w-56"><b>{c.name}</b><div><Badge variant="outline" className="mt-1 text-[10px]">{c.kind}{c.port ? ` :${c.port}` : ""}</Badge></div></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c.role}
                    {c.internals?.length > 0 && <div className="mt-1 text-[10.5px] text-muted-foreground/70">inside: {c.internals.map((i: any) => i.name).join(", ")}</div>}
                  </TableCell>
                  <TableCell className="w-56"><Input className="h-8 text-xs" placeholder="annotate…" defaultValue={respec.annotations?.[`topology:${c.name}`] ?? ""} onBlur={(e) => e.target.value !== (respec.annotations?.[`topology:${c.name}`] ?? "") && annotate(`topology:${c.name}`, e.target.value)} /></TableCell>
                </TableRow>
              ))}
            </TableBody></Table></CardContent></Card>
          </div>
          {respec.flows?.length > 0 && (
            <div>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Key flows</h3>
              <div className="grid gap-3 lg:grid-cols-2">
                {respec.flows.map((f: any) => (
                  <Card key={f.name}><CardHeader className="pb-1"><CardTitle className="text-[13px]">{f.name}</CardTitle></CardHeader>
                    <CardContent className="font-mono text-[11px] leading-relaxed text-muted-foreground">
                      {f.steps.map((s: any, i: number) => <div key={i}>{s.from} → {s.to} <span className="opacity-60">· {s.action}</span></div>)}
                    </CardContent></Card>
                ))}
              </div>
            </div>
          )}
          {respec.drift?.length > 0 && (
            <div>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Drift report</h3>
              {respec.drift.map((d: any, i: number) => (
                <div key={i} className="mb-2 flex items-start gap-3 rounded-lg border bg-card p-3 text-xs">
                  <Badge variant="outline" className={d.status === "confirmed" ? "text-emerald-500" : "text-amber-500"}>{d.status}</Badge>
                  <span>{d.claim} <span className="text-muted-foreground">({d.source})</span></span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
