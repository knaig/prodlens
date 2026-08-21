// Project registry (P1): data/registry.json holds project configs; per-project
// secrets live in data/projects/<id>/secrets.json (gitignored) and are never
// echoed back to the browser.
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface ProjectAuth {
  strategy: "none" | "password" | "clerk-password" | "clerk-signup" | "custom-login";
  tokenInLocalStorage?: boolean;
  signInPath?: string;
  loginButton?: string;
}

export interface Project {
  id: string;
  name: string;
  baseUrl: string;
  /** Entry paths for discovery/execution (first one doubles as the protected path for auth checks). */
  entry: string[];
  /** Optional - UX-only projects (live URL, no source access) leave these unset. */
  repoRoot?: string;
  appDir?: string;
  tsconfig?: string;
  /** Other product sources named at onboarding: docs links, notion pages, anything. */
  sources?: string[];
  auth: ProjectAuth;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSecrets {
  email?: string;
  password?: string;
}

const dataRoot = () => resolve(process.cwd(), "data");
const registryPath = () => join(dataRoot(), "registry.json");
export const projectRoot = (id: string) => join(dataRoot(), "projects", id);
const secretsPath = (id: string) => join(projectRoot(id), "secrets.json");

function readJson<T>(p: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(p: string, data: unknown): void {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(data, null, 2));
}

export function listProjects(): Project[] {
  return readJson<Project[]>(registryPath(), []);
}

export function getProject(id: string): Project | undefined {
  return listProjects().find((p) => p.id === id);
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "project";
}

export function saveProject(input: Omit<Project, "createdAt" | "updatedAt"> & { createdAt?: string }): Project {
  const all = listProjects();
  const now = new Date().toISOString();
  const existing = all.find((p) => p.id === input.id);
  const project: Project = {
    ...input,
    entry: input.entry.length ? input.entry : ["/"],
    createdAt: existing?.createdAt ?? input.createdAt ?? now,
    updatedAt: now,
  };
  const next = existing ? all.map((p) => (p.id === project.id ? project : p)) : [...all, project];
  writeJson(registryPath(), next);
  mkdirSync(projectRoot(project.id), { recursive: true });
  return project;
}

export function deleteProject(id: string, opts: { deleteData?: boolean } = {}): boolean {
  const all = listProjects();
  const next = all.filter((p) => p.id !== id);
  if (next.length === all.length) return false;
  writeJson(registryPath(), next);
  if (opts.deleteData) rmSync(projectRoot(id), { recursive: true, force: true });
  return true;
}

export function getSecrets(id: string): ProjectSecrets {
  return readJson<ProjectSecrets>(secretsPath(id), {});
}

export function setSecrets(id: string, secrets: ProjectSecrets): void {
  const merged = { ...getSecrets(id), ...secrets };
  // Empty string means "clear this credential".
  if (merged.email === "") delete merged.email;
  if (merged.password === "") delete merged.password;
  writeJson(secretsPath(id), merged);
}

export function hasCredentials(id: string): boolean {
  const s = getSecrets(id);
  return Boolean(s.email && s.password);
}

/** Onboarding gate (spec 13.5): sources declared AND a first discovery done. */
export function isOnboarded(p: Project): boolean {
  const hasSources = Boolean(p.repoRoot || (p.sources && p.sources.length));
  const hasGraph = existsSync(join(projectRoot(p.id), "discovery", "graph.json"));
  return hasSources && hasGraph;
}

/** Registry entries as safe-to-serve JSON (never includes secret values). */
export function publicProjects(): Array<Project & { hasCredentials: boolean; onboarded: boolean }> {
  return listProjects().map((p) => ({ ...p, hasCredentials: hasCredentials(p.id), onboarded: isOnboarded(p) }));
}

export function ensureGitignore(): void {
  // data/ is already gitignored at the repo level in this codebase; this is a
  // safety net for secrets when data/ ever gets whitelisted.
  const p = join(dataRoot(), ".gitignore");
  if (!existsSync(p)) writeJson2(p, "projects/*/secrets.json\nregistry.json\n");
}

function writeJson2(p: string, text: string): void {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
}
