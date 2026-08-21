import { useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { post, type Project } from "@/lib/api";
import { StatusBadge } from "./overview";
import type { ProjectData, Tab } from "@/App";

export function Journeys({ project, data, refresh, runStage, setTab }: { project?: Project; data: ProjectData; refresh: () => Promise<void>; runStage: (s: string) => void; setTab: (t: Tab) => void }) {
  const edits = useRef<Record<string, string>>({});
  if (!data.paths.length)
    return (
      <Card className="border-dashed"><CardContent className="py-12 text-center text-sm text-muted-foreground">
        No journeys planned yet. Run <button className="text-primary underline" onClick={() => setTab("verify")}>Prioritize</button> first — the AI proposes them from the discovered graph.
      </CardContent></Card>
    );
  const review = async (body: any) => {
    body.edits = Object.entries(edits.current).map(([id, goal]) => ({ id, goal }));
    await post(`/api/projects/${project?.id}/paths/review`, body);
    await refresh();
  };
  return (
    <div className="space-y-4">
      <Card><CardContent className="pt-2">
        <Table>
          <TableHeader><TableRow>
            <TableHead className="w-24">priority</TableHead><TableHead>goal (editable)</TableHead>
            <TableHead className="w-16">steps</TableHead><TableHead className="w-24">status</TableHead><TableHead className="w-44" />
          </TableRow></TableHeader>
          <TableBody>
            {data.paths.map((x: any) => (
              <TableRow key={x.id}>
                <TableCell><StatusBadge s={x.priority} /></TableCell>
                <TableCell><Input defaultValue={x.goal} className="h-8 border-transparent bg-transparent px-2 text-[13px] focus-visible:border-input" onChange={(e) => (edits.current[x.id] = e.target.value)} /></TableCell>
                <TableCell className="text-muted-foreground">{x.steps.length}</TableCell>
                <TableCell><StatusBadge s={x.status} /></TableCell>
                <TableCell className="space-x-1.5">
                  <Button size="sm" variant="outline" className="h-7 text-xs text-emerald-500" onClick={() => review({ approve: [x.id] })}>approve</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs text-red-500" onClick={() => review({ reject: [x.id] })}>reject</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={async () => { await review({ approve: data.paths.filter((x: any) => x.status === "planned").map((x: any) => x.id) }); toast.success("all planned journeys approved"); }}>Approve all planned</Button>
        <Button size="sm" onClick={() => runStage("run")}>Run approved journeys →</Button>
      </div>
    </div>
  );
}
