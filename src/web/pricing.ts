// SaaS pricing model (spec v2 §13). Prices in USD/month; quotas per month.
// COGS figures derive from usage/ledger UNIT_COST estimates so the admin page
// can show margin per tier honestly.
import { UNIT_COST } from "../usage/ledger.js";

export interface Tier {
  id: string;
  name: string;
  priceUsd: number | "custom";
  tagline: string;
  quotas: {
    projects: number | "unlimited";
    videosPerMonth: number | "unlimited";
    qaRunsPerMonth: number | "unlimited";
    seats: number | "unlimited";
  };
  features: string[];
  /** Estimated COGS at full quota consumption (USD). */
  estCogsAtFullUseUsd: number;
}

// Blended cost of one "typical" unit of work, from the ledger's unit estimates:
// - QA run: discover (~40 pages) + prioritize (2 llm) + run (~20 steps) + report + visual (9 shots)
// - Video: compile (3 llm) + 12 tts clips + ~4 render minutes + few llm
const QA_RUN_COGS = (40 * UNIT_COST.crawl.micros + 2 * UNIT_COST.llm.micros + 20 * UNIT_COST.execute.micros + 9 * UNIT_COST.vision_llm.micros) / 1e6; // ~$0.20
const VIDEO_COGS = (5 * UNIT_COST.llm.micros + 12 * UNIT_COST.tts.micros + 4 * UNIT_COST.render.micros) / 1e6; // ~$0.49

export const UNIT_ECONOMICS = {
  qaRunCogsUsd: Number(QA_RUN_COGS.toFixed(3)),
  videoCogsUsd: Number(VIDEO_COGS.toFixed(3)),
};

export const TIERS: Tier[] = [
  {
    id: "free",
    name: "Free",
    priceUsd: 0,
    tagline: "Verify one project, taste the videos",
    quotas: { projects: 1, videosPerMonth: 3, qaRunsPerMonth: 10, seats: 1 },
    features: ["Full QA pipeline (discover/journeys/report)", "3 narrated videos/month (watermarked)", "Community support"],
    estCogsAtFullUseUsd: Number((10 * QA_RUN_COGS + 3 * VIDEO_COGS).toFixed(2)),
  },
  {
    id: "builder",
    name: "Builder",
    priceUsd: 49,
    tagline: "A founder shipping demos + regression checks",
    quotas: { projects: 3, videosPerMonth: 20, qaRunsPerMonth: 100, seats: 2 },
    features: ["Everything in Free", "No watermark", "Voice styles + localization", "Script-to-demo compiler", "Architecture diagram scenes", "Email support"],
    estCogsAtFullUseUsd: Number((100 * QA_RUN_COGS + 20 * VIDEO_COGS).toFixed(2)),
  },
  {
    id: "team",
    name: "Team",
    priceUsd: 199,
    tagline: "QA + PM + DevRel on one pipeline",
    quotas: { projects: 10, videosPerMonth: 80, qaRunsPerMonth: 600, seats: 5 },
    features: ["Everything in Builder", "HITL gates with per-seat review", "CI integration + release gating", "Run history + diffing", "Call scenes (live product demos)", "Priority support"],
    estCogsAtFullUseUsd: Number((600 * QA_RUN_COGS + 80 * VIDEO_COGS).toFixed(2)),
  },
  {
    id: "enterprise",
    name: "Enterprise",
    priceUsd: "custom",
    tagline: "Self-hosted runner, SSO, unlimited scale",
    quotas: { projects: "unlimited", videosPerMonth: "unlimited", qaRunsPerMonth: "unlimited", seats: "unlimited" },
    features: ["Everything in Team", "Desktop/CI runner for private networks (creds never leave your machines)", "SSO + audit log", "Custom adapters + onboarding", "SLA"],
    estCogsAtFullUseUsd: 0,
  },
];
