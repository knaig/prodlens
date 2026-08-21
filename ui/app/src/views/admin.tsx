import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { api, post } from "@/lib/api";

export function Admin() {
  const [usage, setUsage] = useState<any | null>(null);
  const [pricing, setPricing] = useState<any | null>(null);
  const load = () => Promise.all([api("/api/admin/usage"), api("/api/admin/pricing")]).then(([u, p]) => { setUsage(u); setPricing(p); });
  useEffect(() => { void load(); }, []);
  if (!usage || !pricing) return <div className="text-sm text-muted-foreground">loading…</div>;
  const usd = (m: number) => `$${(m / 1e6).toFixed(3)}`;
  const rows = Object.entries(usage.summary.byProject) as Array<[string, any]>;
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Costs &amp; pricing</h1>
      <div className="grid gap-3 sm:grid-cols-4">
        {[[usd(usage.summary.totalUsdMicros), `estimated spend · ${usage.summary.month}`],
          [`$${pricing.unitEconomics.qaRunCogsUsd}`, "COGS per QA run"],
          [`$${pricing.unitEconomics.videoCogsUsd}`, "COGS per video"],
          [`$${usage.defaultCapUsd}`, "default monthly cap"]].map(([v, l]) => (
          <Card key={String(l)}><CardContent className="pt-5"><div className="text-xl font-extrabold">{v}</div><div className="text-xs text-muted-foreground">{l}</div></CardContent></Card>
        ))}
      </div>
      <div>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Per-project spend &amp; budgets</h3>
        <Card><CardContent className="pt-2"><Table>
          <TableHeader><TableRow><TableHead>project</TableHead><TableHead className="w-24">spend</TableHead><TableHead className="w-48">vs cap</TableHead><TableHead>buckets</TableHead><TableHead className="w-28">cap $/mo</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.length ? rows.map(([pid, d]) => {
              const cap = usage.budgets[pid]?.monthlyCapUsd ?? usage.defaultCapUsd;
              const pct = cap > 0 ? Math.min(100, Math.round(d.totalUsdMicros / 1e6 / cap * 100)) : 0;
              return (
                <TableRow key={pid}>
                  <TableCell className="font-medium">{pid}</TableCell>
                  <TableCell>{usd(d.totalUsdMicros)}</TableCell>
                  <TableCell><Progress value={pct} className="h-1.5" /><span className="text-[10.5px] text-muted-foreground">{pct}% of ${cap}</span></TableCell>
                  <TableCell className="text-[11px] text-muted-foreground">{Object.entries(d.byBucket).map(([b, v]: any) => `${b} ${v.units.toFixed(0)} (${usd(v.usdMicros)})`).join(" · ")}</TableCell>
                  <TableCell><Input type="number" defaultValue={cap} className="h-8 w-20 text-xs" onBlur={async (e) => { await post("/api/admin/budget", { projectId: pid, monthlyCapUsd: Number(e.target.value) }); toast.success(`budget saved for ${pid}`); }} /></TableCell>
                </TableRow>
              );
            }) : <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">no spend recorded this month yet</TableCell></TableRow>}
          </TableBody>
        </Table></CardContent></Card>
        <p className="mt-1.5 text-[11px] text-muted-foreground">Stages refuse to start past cap (HTTP 402). Flat per-unit estimates, not billing-grade metering.</p>
      </div>
      <div>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Pricing tiers</h3>
        <div className="grid gap-3 lg:grid-cols-4">
          {pricing.tiers.map((t: any) => {
            const price = t.priceUsd === "custom" ? "Custom" : `$${t.priceUsd}`;
            const margin = t.priceUsd !== "custom" && t.priceUsd > 0 ? `${Math.round((1 - t.estCogsAtFullUseUsd / t.priceUsd) * 100)}% margin at full use` : t.priceUsd === 0 ? `COGS $${t.estCogsAtFullUseUsd} · acquisition` : "priced per deal";
            return (
              <Card key={t.id} className={t.id === "team" ? "border-primary shadow-lg" : ""}>
                <CardHeader className="pb-1"><CardTitle className="text-sm">{t.name}</CardTitle>
                  <div className="text-2xl font-extrabold">{price}<span className="text-xs font-normal text-muted-foreground">{t.priceUsd !== "custom" ? "/mo" : ""}</span></div>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">{t.tagline}</p>
                  <p className="mt-1.5 text-[10.5px] text-muted-foreground">{t.quotas.projects} projects · {t.quotas.videosPerMonth} videos · {t.quotas.qaRunsPerMonth} QA runs · {t.quotas.seats} seats</p>
                  <ul className="mt-2 list-disc pl-4 text-[11px] leading-relaxed text-muted-foreground">
                    {t.features.map((x: string) => <li key={x}>{x}</li>)}
                  </ul>
                  <p className="mt-2 text-[10.5px] text-muted-foreground/70">{margin}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
