import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { relTime, shortSummary } from "@/lib/api";
import { StatusBadge } from "./overview";
import type { ProjectData } from "@/App";

export function HistoryView({ data }: { data: ProjectData }) {
  if (!data.jobs.length)
    return <Card className="border-dashed"><CardContent className="py-12 text-center text-sm text-muted-foreground">No runs yet.</CardContent></Card>;
  return (
    <Card><CardContent className="pt-2"><Table>
      <TableHeader><TableRow><TableHead>stage</TableHead><TableHead className="w-28">status</TableHead><TableHead className="w-24">started</TableHead><TableHead>result</TableHead></TableRow></TableHeader>
      <TableBody>
        {data.jobs.map((j: any) => (
          <TableRow key={j.id}>
            <TableCell className="font-medium">{j.stage}</TableCell>
            <TableCell><StatusBadge s={j.status} /></TableCell>
            <TableCell className="text-xs text-muted-foreground">{relTime(j.startedAt)}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{(j.summary ? shortSummary(j.summary) : j.error ?? "").slice(0, 140)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table></CardContent></Card>
  );
}
