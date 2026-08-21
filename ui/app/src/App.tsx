import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/components/theme-provider";
import {
  LayoutDashboard, ShieldCheck, Route, Flag, Compass, Clapperboard, FolderOpen,
  History as HistoryIcon, Settings as SettingsIcon, Coins, Sun, Moon, Laptop, Plus, ChevronUp, ChevronDown,
} from "lucide-react";
import { api, post, type Project, STAGE_SPEAK, shortSummary } from "@/lib/api";
import { Overview } from "@/views/overview";
import { Verify } from "@/views/verify";
import { Journeys } from "@/views/journeys";
import { Issues } from "@/views/issues";
import { Understand } from "@/views/understand";
import { Studio } from "@/views/studio";
import { ArtifactsView } from "@/views/artifacts";
import { HistoryView } from "@/views/history";
import { ProjectForm } from "@/views/settings";
import { Admin } from "@/views/admin";

export type Tab = "overview" | "verify" | "journeys" | "issues" | "understand" | "studio" | "artifacts" | "history" | "settings" | "admin" | "new";

const NAV: Array<{ id: Tab; icon: React.ElementType; label: string }> = [
  { id: "overview", icon: LayoutDashboard, label: "Overview" },
  { id: "verify", icon: ShieldCheck, label: "Verify" },
  { id: "journeys", icon: Route, label: "Journeys" },
  { id: "issues", icon: Flag, label: "Issues" },
  { id: "understand", icon: Compass, label: "Understand" },
  { id: "studio", icon: Clapperboard, label: "Studio" },
  { id: "artifacts", icon: FolderOpen, label: "Artifacts" },
  { id: "history", icon: HistoryIcon, label: "History" },
  { id: "settings", icon: SettingsIcon, label: "Settings" },
];

export interface ProjectData {
  paths: any[]; report: any; triage: Record<string, any>; jobs: any[]; artifacts: any[];
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<ProjectData>({ paths: [], report: null, triage: {}, jobs: [], artifacts: [] });
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleTitle, setConsoleTitle] = useState("Console");
  const [consoleStatus, setConsoleStatus] = useState("idle");
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const esRef = useRef<EventSource | null>(null);
  const logRef = useRef<HTMLPreElement | null>(null);

  const project = useMemo(() => projects.find((p) => p.id === sel), [projects, sel]);

  const loadProjects = useCallback(async () => {
    const ps = await api<Project[]>("/api/projects");
    setProjects(ps);
    setSel((cur) => cur && ps.find((p) => p.id === cur) ? cur : (ps[0]?.id ?? null));
  }, []);

  const refresh = useCallback(async () => {
    if (!sel) return;
    const [paths, report, triage, jobs, artifacts] = await Promise.all([
      api(`/api/projects/${sel}/paths`), api(`/api/projects/${sel}/report`),
      api(`/api/projects/${sel}/triage`), api(`/api/projects/${sel}/jobs`), api(`/api/projects/${sel}/artifacts`),
    ]);
    setData({ paths, report: report.report ?? null, triage, jobs, artifacts });
  }, [sel]);

  useEffect(() => { void loadProjects(); }, [loadProjects]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [log]);

  const watchJob = useCallback((jobId: string, title: string) => {
    esRef.current?.close();
    setConsoleOpen(true); setRunning(true); setLog([]);
    setConsoleTitle(title);
    setConsoleStatus(STAGE_SPEAK[title] ?? "running");
    const es = new EventSource(`/api/projects/${sel}/jobs/${jobId}/events`);
    esRef.current = es;
    es.onmessage = (ev) => {
      const d = JSON.parse(ev.data);
      if (d.line) setLog((l) => [...l, d.line]);
      if (d.status && d.status !== "running" && d.status !== "queued") {
        es.close(); esRef.current = null; setRunning(false);
        setConsoleStatus(`${d.status}${d.summary ? " · " + shortSummary(d.summary).slice(0, 90) : ""}`);
        toast[d.status === "done" ? "success" : "error"](`${title} ${d.status}`, { description: d.error ?? (d.summary ? shortSummary(d.summary).slice(0, 120) : undefined) });
        void refresh();
      }
    };
  }, [sel, refresh]);

  const runStage = useCallback(async (stage: string) => {
    try {
      const { jobId } = await post<{ jobId: string }>(`/api/projects/${sel}/stages/${stage}`);
      watchJob(jobId, stage);
    } catch (e: any) { toast.error(String(e.message ?? e)); }
  }, [sel, watchJob]);

  const ctx = { project, data, refresh, runStage, watchJob, setTab: setTab as (t: Tab) => void };

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* sidebar */}
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r bg-card/40 p-3">
        <div className="flex items-center gap-2.5 px-2 py-3">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary font-extrabold text-primary-foreground">P</div>
          <div>
            <div className="text-[15px] font-bold leading-4">ProdLens</div>
            <div className="text-[10px] text-muted-foreground">see your whole product</div>
          </div>
          <div className="ml-auto"><ThemeToggle /></div>
        </div>
        <div className="mt-2 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Projects</div>
        <div className="mt-1 space-y-0.5">
          {projects.map((p) => (
            <button key={p.id} onClick={() => { setSel(p.id); setTab("overview"); }}
              className={`w-full rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-accent ${p.id === sel && tab !== "admin" && tab !== "new" ? "bg-accent" : ""}`}>
              <span className="font-medium">{p.name}</span>
              {!p.onboarded && <Badge variant="outline" className="ml-2 h-4 px-1.5 text-[9px] text-amber-500">onboarding</Badge>}
              <div className="truncate text-[10.5px] text-muted-foreground">{p.baseUrl.replace(/^https?:\/\//, "")}</div>
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" className="mt-2 h-7 justify-start gap-1.5 text-xs" onClick={() => setTab("new")}>
          <Plus className="size-3.5" /> New project
        </Button>
        <div className="mt-4 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Workspace</div>
        <nav className="mt-1 space-y-0.5">
          {NAV.map(({ id, icon: Icon, label }) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors hover:bg-accent ${tab === id ? "bg-accent" : "text-muted-foreground"}`}>
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </nav>
        <div className="mt-4 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Account</div>
        <button onClick={() => setTab("admin")}
          className={`mt-1 flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors hover:bg-accent ${tab === "admin" ? "bg-accent" : "text-muted-foreground"}`}>
          <Coins className="size-4" /> Costs &amp; pricing
        </button>
        <div className="mt-auto px-2 pb-1 text-[10.5px] text-muted-foreground">
          local control plane · <a className="underline" href="/classic">classic UI</a>
        </div>
      </aside>

      {/* main */}
      <main className="min-w-0 flex-1 px-8 pb-32 pt-6">
        <div className="mx-auto max-w-5xl">
          {tab === "new" || (!project && tab !== "admin") ? (
            <ProjectForm project={undefined} onSaved={async (id: string) => { await loadProjects(); setSel(id); setTab("overview"); }} />
          ) : tab === "admin" ? (
            <Admin />
          ) : project ? (
            <>
              <div className="mb-5 flex flex-wrap items-center gap-3">
                <h1 className="text-xl font-bold">{project.name}</h1>
                <Badge variant="secondary" className="font-mono text-[11px] font-normal">{project.baseUrl}</Badge>
                {project.repoRoot
                  ? <Badge variant="outline" className="text-emerald-500">source connected</Badge>
                  : <Badge variant="outline" className="text-amber-500">UX-only</Badge>}
                {!project.onboarded && <Badge variant="outline" className="text-amber-500">onboarding incomplete — run Discover</Badge>}
              </div>
              {tab === "overview" && <Overview {...ctx} />}
              {tab === "verify" && <Verify {...ctx} />}
              {tab === "journeys" && <Journeys {...ctx} />}
              {tab === "issues" && <Issues {...ctx} />}
              {tab === "understand" && <Understand {...ctx} />}
              {tab === "studio" && <Studio {...ctx} />}
              {tab === "artifacts" && <ArtifactsView {...ctx} />}
              {tab === "history" && <HistoryView {...ctx} />}
              {tab === "settings" && <ProjectForm project={project} onSaved={async () => { await loadProjects(); toast.success("project saved"); }} onDeleted={async () => { await loadProjects(); setTab("overview"); }} />}
            </>
          ) : null}
        </div>
      </main>

      {/* console drawer */}
      <div className={`fixed bottom-0 left-60 right-0 z-40 border-t bg-background/95 backdrop-blur transition-transform ${consoleOpen ? "" : "translate-y-[calc(100%-38px)]"}`}>
        <button className="flex w-full items-center gap-3 px-5 py-2 text-left text-xs" onClick={() => setConsoleOpen((o) => !o)}>
          <span className={`size-2 rounded-full ${running ? "animate-pulse bg-amber-400" : "bg-muted-foreground/40"}`} />
          <b>Console{consoleTitle !== "Console" ? ` · ${consoleTitle}` : ""}</b>
          <span className="truncate text-muted-foreground">{consoleStatus}</span>
          <span className="ml-auto text-muted-foreground">{consoleOpen ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}</span>
        </button>
        <pre ref={logRef} className="h-52 overflow-auto px-5 pb-4 font-mono text-[11px] leading-relaxed text-muted-foreground">{log.join("\n") || "idle"}</pre>
      </div>
      <Toaster richColors position="bottom-right" />
    </div>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Laptop;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="size-7"><Icon className="size-4" /></Button>} />
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme("light")}><Sun className="mr-2 size-4" /> Light</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}><Moon className="mr-2 size-4" /> Dark</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}><Laptop className="mr-2 size-4" /> System</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
