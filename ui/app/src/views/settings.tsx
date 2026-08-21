import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { post, del, type Project } from "@/lib/api";

export function ProjectForm({ project, onSaved, onDeleted }: { project?: Project; onSaved: (id: string) => void | Promise<void>; onDeleted?: () => void | Promise<void> }) {
  const [f, setF] = useState({
    name: project?.name ?? "",
    baseUrl: project?.baseUrl ?? "http://localhost:3000",
    entry: (project?.entry ?? ["/"]).join(","),
    strategy: project?.auth.strategy ?? "none",
    token: project?.auth.tokenInLocalStorage ?? false,
    email: "", password: "",
    repoRoot: project?.repoRoot ?? "",
    appDir: project?.appDir ?? "",
    sources: (project?.sources ?? []).join("\n"),
  });
  const set = (k: string, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));
  const save = async () => {
    const sources = f.sources.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!f.name || !f.baseUrl) return toast.error("name + base URL required");
    if (!f.repoRoot && !sources.length) return toast.error("onboarding needs at least one product source (repo or docs links)");
    const r = await post<{ id: string }>("/api/projects", {
      id: project?.id, name: f.name, baseUrl: f.baseUrl,
      entry: f.entry.split(",").map((s) => s.trim()).filter(Boolean),
      auth: { strategy: f.strategy, tokenInLocalStorage: f.token },
      repoRoot: f.repoRoot || undefined, appDir: f.appDir || undefined,
      sources, email: f.email, password: f.password,
    });
    await onSaved(r.id);
  };
  return (
    <Card className="max-w-2xl">
      <CardHeader><CardTitle className="text-base">{project ? "Project settings" : "New project"}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div><Label className="text-[11px]">Name</Label><Input className="mt-1" value={f.name} onChange={(e) => set("name", e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-[11px]">Base URL <span className="text-muted-foreground">(live app — source optional)</span></Label><Input className="mt-1" value={f.baseUrl} onChange={(e) => set("baseUrl", e.target.value)} /></div>
          <div><Label className="text-[11px]">Entry paths (comma-sep)</Label><Input className="mt-1" value={f.entry} onChange={(e) => set("entry", e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-[11px]">Auth strategy</Label>
            <select className="mt-1 h-9 w-full rounded-md border bg-transparent px-2 text-[13px]" value={f.strategy} onChange={(e) => set("strategy", e.target.value)}>
              {["none", "custom-login", "password", "clerk-password", "clerk-signup"].map((s) => <option key={s}>{s}</option>)}
            </select></div>
          <div><Label className="text-[11px]">Token in localStorage</Label>
            <select className="mt-1 h-9 w-full rounded-md border bg-transparent px-2 text-[13px]" value={f.token ? "yes" : "no"} onChange={(e) => set("token", e.target.value === "yes")}>
              <option>no</option><option>yes</option>
            </select></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-[11px]">Login email {project?.hasCredentials && <Badge variant="outline" className="ml-1 text-[9px] text-emerald-500">stored</Badge>}</Label>
            <Input className="mt-1" placeholder="(unchanged)" value={f.email} onChange={(e) => set("email", e.target.value)} /></div>
          <div><Label className="text-[11px]">Login password</Label><Input className="mt-1" type="password" placeholder="(unchanged)" value={f.password} onChange={(e) => set("password", e.target.value)} /></div>
        </div>
        <div className="pt-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Product sources <span className="normal-case tracking-normal">— required for onboarding, at least one beyond the URL</span></div>
        <div><Label className="text-[11px]">Repo root <span className="text-muted-foreground">(optional — read-only access; enables scan + code-grounded respec)</span></Label>
          <Input className="mt-1" value={f.repoRoot} onChange={(e) => set("repoRoot", e.target.value)} /></div>
        <div><Label className="text-[11px]">App dir <span className="text-muted-foreground">(for scan, e.g. &lt;repo&gt;/src/app)</span></Label>
          <Input className="mt-1" value={f.appDir} onChange={(e) => set("appDir", e.target.value)} /></div>
        <div><Label className="text-[11px]">Other sources <span className="text-muted-foreground">(docs links, one per line)</span></Label>
          <Textarea className="mt-1 min-h-16 text-[13px]" value={f.sources} onChange={(e) => set("sources", e.target.value)} /></div>
        <div className="space-x-2 pt-2">
          <Button size="sm" onClick={save}>Save project</Button>
          {project && onDeleted && (
            <Button size="sm" variant="outline" className="text-red-500" onClick={async () => {
              if (!confirm("Delete project config? (artifacts on disk are kept)")) return;
              await del(`/api/projects/${project.id}`);
              await onDeleted();
            }}>Delete</Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
