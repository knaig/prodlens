import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, relTime, type Project } from "@/lib/api";
import type { ProjectData } from "@/App";

export function ArtifactsView({ project, data }: { project?: Project; data: ProjectData }) {
  const [registry, setRegistry] = useState<any[]>([]);
  useEffect(() => { if (project) void api(`/api/projects/${project.id}/registry`).then(setRegistry).catch(() => {}); }, [project]);
  const href = (rel: string) => `/api/projects/${project?.id}/file?path=${encodeURIComponent(rel)}`;
  if (!data.artifacts.length && !registry.length)
    return <Card className="border-dashed"><CardContent className="py-12 text-center text-sm text-muted-foreground">Nothing yet.</CardContent></Card>;
  return (
    <div className="space-y-5">
      {registry.length > 0 && (
        <div>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Registry <span className="normal-case tracking-normal">— versioned + described; check here before re-creating</span></h3>
          <Card><CardContent className="pt-2"><Table>
            <TableHeader><TableRow><TableHead>artifact</TableHead><TableHead className="w-14">ver</TableHead><TableHead>description</TableHead><TableHead className="w-24">created</TableHead></TableRow></TableHeader>
            <TableBody>
              {registry.map((e) => (
                <TableRow key={e.id}>
                  <TableCell><a className="font-medium text-primary hover:underline" target="_blank" href={href(e.rel)}>{e.title}</a></TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px]">v{e.version}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{e.description}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{relTime(e.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table></CardContent></Card>
        </div>
      )}
      <div>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">All files</h3>
        <Card><CardContent className="pt-2"><Table>
          <TableHeader><TableRow><TableHead>artifact</TableHead><TableHead className="w-24">size</TableHead><TableHead className="w-24">modified</TableHead></TableRow></TableHeader>
          <TableBody>
            {data.artifacts.map((a: any) => (
              <TableRow key={a.rel}>
                <TableCell><a className="font-mono text-xs text-primary hover:underline" target="_blank" href={href(a.rel)}>{a.rel}</a></TableCell>
                <TableCell className="text-xs text-muted-foreground">{a.size > 1e6 ? `${(a.size / 1e6).toFixed(1)} MB` : `${Math.round(a.size / 1e3)} KB`}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{relTime(a.mtime)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table></CardContent></Card>
      </div>
    </div>
  );
}
