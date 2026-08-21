import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { KeyRound, Monitor, Map, Clapperboard, Phone, FileBox, Loader2 } from "lucide-react";
import { api, post, put, relTime, type Project } from "@/lib/api";
import type { ProjectData } from "@/App";

const ICON: Record<string, React.ElementType> = { login: KeyRound, screen: Monitor, diagram: Map, card: Clapperboard, call: Phone, artifact: FileBox };

export function Studio({ project, watchJob }: { project?: Project; data: ProjectData; watchJob: (id: string, title: string) => void }) {
  const [meta, setMeta] = useState<any | null>(null);
  const [studio, setStudio] = useState<any | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [script, setScript] = useState("");
  const [audience, setAudience] = useState("prospect");
  const [frame, setFrame] = useState("");
  const [oneLiner, setOneLiner] = useState("");
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!project) return;
    const [m, s, r] = await Promise.all([
      api("/api/studio/meta"), api(`/api/projects/${project.id}/studio`), api(`/api/projects/${project.id}/roles`).catch(() => ({ roles: [] })),
    ]);
    setMeta(m); setStudio(s); setRoles(r.roles ?? []);
    setScript((cur) => cur || s.script);
    if (s.spec?.audience) setAudience(s.spec.audience);
    if (s.spec?.frame) setFrame(s.spec.frame);
  }, [project]);
  useEffect(() => { void load(); }, [load]);

  const saveScript = async () => { await put(`/api/projects/${project?.id}/studio/script`, { text: script }); };
  const draft = async (src: { oneLiner?: string; role?: string }) => {
    if (src.oneLiner !== undefined && !src.oneLiner.trim()) return toast.error("type a one-line brief first");
    if (src.role !== undefined && !src.role) return toast.error("run respec first to get roles");
    setBusy("draft");
    try {
      const r = await post(`/api/projects/${project?.id}/studio/draft-script`, { ...src, audience });
      setScript(r.script);
      toast.success("script drafted from product evidence — review, then compile");
    } catch (e: any) { toast.error(`draft failed: ${e.message}`); } finally { setBusy(null); }
  };
  const compile = async () => {
    await saveScript();
    setBusy("compile");
    try {
      const r = await post(`/api/projects/${project?.id}/studio/compile`, { audience, frame: frame || undefined });
      setStudio((s: any) => ({ ...s, spec: r.spec, narration: r.narration, gaps: r.gaps }));
      toast.success(`compiled: ${r.spec.scenes.length} scenes, ${r.gaps.length} gaps`);
    } catch (e: any) { toast.error(`compile failed: ${e.message}`); } finally { setBusy(null); }
  };
  const render = async (draftMode: boolean) => {
    try {
      const { jobId } = await post(`/api/projects/${project?.id}/studio/render`, { draft: draftMode });
      watchJob(jobId, draftMode ? "render-draft" : "render-final");
    } catch (e: any) { toast.error(String(e.message ?? e)); }
  };
  const editLine = async (lineId: string, text: string) => {
    const n = studio?.narration; if (!n) return;
    const l = n.lines.find((x: any) => x.id === lineId); if (l) l.text = text;
    await put(`/api/projects/${project?.id}/studio/narration`, n);
    toast.success("line saved · pinned against recompiles");
  };

  const framesFit = meta?.frames.filter((f: any) => f.defaultAudience === audience) ?? [];
  const framesRest = meta?.frames.filter((f: any) => f.defaultAudience !== audience) ?? [];

  // storyboard grouped by act
  const scenes = studio?.spec?.scenes ?? [];
  const groups: Array<{ act: string | null; scenes: any[] }> = [];
  for (const sc of scenes) {
    const last = groups[groups.length - 1];
    if (last && last.act === (sc.act ?? null)) last.scenes.push(sc);
    else groups.push({ act: sc.act ?? null, scenes: [sc] });
  }
  const lineFor = (sc: any) => studio?.narration?.lines.find((l: any) => l.sceneId === sc.id);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Start from…</CardTitle></CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-3">
          <div>
            <Label className="text-[11px]">A one-line brief</Label>
            <Input value={oneLiner} onChange={(e) => setOneLiner(e.target.value)} className="mt-1 text-[13px]" placeholder="90-second video convincing a call-center head to try us" />
            <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" disabled={busy === "draft"} onClick={() => draft({ oneLiner })}>
              {busy === "draft" ? <Loader2 className="mr-1 size-3 animate-spin" /> : null} Draft script
            </Button>
          </div>
          <div>
            <Label className="text-[11px]">A viewer role <span className="text-muted-foreground">(role-scoped workflow)</span></Label>
            <select className="mt-1 h-9 w-full rounded-md border bg-transparent px-2 text-[13px]" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">{roles.length ? "pick a role…" : "no roles yet — run respec"}</option>
              {roles.map((r) => <option key={r} value={r}>{r.split("—")[0].trim()}</option>)}
            </select>
            <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={() => draft({ role })}>Draft role workflow</Button>
          </div>
          <div>
            <Label className="text-[11px]">lazy-dist vision/strategy</Label>
            <p className="mt-1 text-xs text-muted-foreground">import positioning as script seed</p>
            <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" disabled title="integration — spec 13.6">Connect lazy-dist</Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Script <span className="ml-1 text-[10px] font-normal text-muted-foreground">prose beats · "quoted lines" kept verbatim</span></CardTitle></CardHeader>
          <CardContent>
            <Textarea value={script} onChange={(e) => setScript(e.target.value)} className="min-h-44 text-[13px]" placeholder="Open on the sign-in page and log in. Then show…" />
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[11px]">Audience</Label>
                <select className="mt-1 h-9 w-full rounded-md border bg-transparent px-2 text-[13px]" value={audience} onChange={(e) => { setAudience(e.target.value); setFrame(""); }}>
                  {meta?.audiences.map((a: any) => <option key={a.id} value={a.id}>{a.id} — {a.who}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-[11px]">Story frame <span className="text-muted-foreground">(filtered by audience)</span></Label>
                <select className="mt-1 h-9 w-full rounded-md border bg-transparent px-2 text-[13px]" value={frame} onChange={(e) => setFrame(e.target.value)}>
                  <option value="">no frame</option>
                  {framesFit.map((f: any) => <option key={f.id} value={f.id}>{f.id} ✓</option>)}
                  <optgroup label="advanced (other audiences)">
                    {framesRest.map((f: any) => <option key={f.id} value={f.id}>{f.id}</option>)}
                  </optgroup>
                </select>
              </div>
            </div>
            <div className="mt-4 space-x-2">
              <Button size="sm" disabled={busy === "compile"} onClick={compile}>{busy === "compile" ? <Loader2 className="mr-1 size-3 animate-spin" /> : null} Compile → storyboard</Button>
              <Button size="sm" variant="outline" onClick={async () => { await saveScript(); toast.success("script saved"); }}>Save</Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Render</CardTitle></CardHeader>
          <CardContent>
            <p className="text-xs leading-relaxed text-muted-foreground">Draft = silent, fast review cut. Final = narrated with the cast voice, captions burned in. A browser window opens and drives the live app.</p>
            <div className="mt-3 space-x-2">
              <Button size="sm" variant="outline" onClick={() => render(true)}>Render draft</Button>
              <Button size="sm" onClick={() => render(false)}>Render final</Button>
            </div>
            {studio?.videos?.[0] && (
              <div className="mt-4 text-xs">
                <a className="text-primary hover:underline" target="_blank" href={`/api/projects/${project?.id}/file?path=${encodeURIComponent(studio.videos[0].rel)}`}>▶ {studio.videos[0].rel.split("/").pop()}</a>
                <span className="ml-2 text-muted-foreground">{relTime(studio.videos[0].mtime)}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {scenes.length === 0 ? (
        <Card className="border-dashed"><CardContent className="py-10 text-center text-sm text-muted-foreground">No storyboard yet. Write a script and hit Compile — ProdLens grounds every beat in real screens.</CardContent></Card>
      ) : (
        <div className="space-y-4">
          {groups.map((g, gi) => (
            <div key={gi}>
              {g.act && <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-violet-400"><span className="h-px w-5 bg-violet-400" /> {g.act}</div>}
              <div className="flex gap-3 overflow-x-auto pb-1.5">
                {g.scenes.map((sc: any) => {
                  const Icon = ICON[sc.type] ?? Monitor;
                  const l = lineFor(sc);
                  return (
                    <Card key={sc.id} className="w-72 shrink-0">
                      <CardContent className="pt-4">
                        <div className="flex items-center gap-2 text-[13px] font-semibold"><span className="flex size-6 items-center justify-center rounded-md border bg-muted"><Icon className="size-3.5" /></span> {sc.type}</div>
                        <div className="mt-1 truncate font-mono text-[10.5px] text-muted-foreground">{sc.goto || sc.click || sc.scenario || sc.title || ""}</div>
                        {l ? (
                          <Textarea defaultValue={l.text} className="mt-2 min-h-20 text-xs" onBlur={(e) => e.target.value !== l.text && editLine(l.id, e.target.value)} />
                        ) : <div className="mt-2 text-[11px] text-muted-foreground">no narration</div>}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {studio?.gaps?.length > 0 && (
        <div>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Gap report · {studio.gaps.length}</h3>
          {studio.gaps.map((g: any, i: number) => (
            <div key={i} className="mb-2 rounded-r-lg border-l-4 border-l-amber-500 bg-amber-500/5 px-4 py-2.5 text-xs">
              <b className="text-amber-500">{g.beat.slice(0, 70)}</b> — {g.reason}{g.suggestion && <span className="text-muted-foreground"> → {g.suggestion}</span>}
            </div>
          ))}
        </div>
      )}

      {studio?.videos?.length > 0 && (
        <div>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Renders</h3>
          <video controls preload="metadata" className="max-w-2xl rounded-lg border shadow-lg" src={`/api/projects/${project?.id}/file?path=${encodeURIComponent(studio.videos[0].rel)}`} />
          <div className="mt-2 space-y-1 text-xs">
            {studio.videos.map((v: any) => (
              <div key={v.rel}><a className="text-primary hover:underline" target="_blank" href={`/api/projects/${project?.id}/file?path=${encodeURIComponent(v.rel)}`}>{v.rel.split("/").pop()}</a> <span className="text-muted-foreground">{(v.size / 1e6).toFixed(1)} MB · {relTime(v.mtime)}</span></div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
