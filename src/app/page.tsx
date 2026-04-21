"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

// ---- Server response types ----------------------------------------------

type Zone1Kpi = { count: number; value: number };
type Zone1Response = {
  openPipeline: Zone1Kpi;
  completedYesterday: Zone1Kpi;
  dueThisWeek: Zone1Kpi;
  overdue: Zone1Kpi;
  generatedAt: string;
};

type CustomerRow = {
  customer: string;
  revenue: number;
  orders: number;
  pieces: number;
  lastOrder: string;
  companyName: string | null;
  primaryContactFullName: string | null;
  primaryContactEmail: string | null;
  primaryContactPhone: string | null;
};
type Zone2Response = {
  topYTD: CustomerRow[];
  topLastYear: CustomerRow[];
  generatedAt: string;
};

type FunnelStageSrv = { name: string; count: number; value: number };
type AgingBucketSrv = { bucket: string; count: number; value: number };
type ExpiringQuote = {
  quote: string;
  customer: string;
  value: number;
  daysLeft: number;
};
type WinRatePoint = { week: string; rate: number };
type Zone3Response = {
  funnel: FunnelStageSrv[];
  agingBuckets: AgingBucketSrv[];
  expiringSoon: ExpiringQuote[];
  winRateTrend: WinRatePoint[];
  generatedAt: string;
};

type WeekLoad = {
  week: string;
  dates: string;
  orders: number;
  value: number;
  embroidery: number;
  screenPrinting: number;
  heatDTF: number;
  heatPatches: number;
  other: number;
};
type Zone4Response = {
  forwardLoad: WeekLoad[];
  generatedAt: string;
};

// ---- Presentation style maps --------------------------------------------

type WorkType = {
  key: "embroidery" | "screenPrinting" | "heatDTF" | "heatPatches" | "other";
  label: string;
  color: string;
  dot: string;
};

const workTypes: WorkType[] = [
  { key: "embroidery", label: "Embroidery", color: "bg-indigo-500", dot: "bg-indigo-500" },
  { key: "screenPrinting", label: "Screen Printing", color: "bg-blue-500", dot: "bg-blue-500" },
  { key: "heatDTF", label: "Heat Printing - DTF", color: "bg-cyan-500", dot: "bg-cyan-500" },
  { key: "heatPatches", label: "Heat Printing - Patches", color: "bg-teal-500", dot: "bg-teal-500" },
  { key: "other", label: "Other (outsourced)", color: "bg-slate-400", dot: "bg-slate-400" },
];

const KPI_STYLES = [
  { key: "openPipeline", label: "Open Pipeline", accent: "border-l-slate-500", dot: "bg-slate-500" },
  { key: "completedYesterday", label: "Orders Completed Yesterday", accent: "border-l-emerald-500", dot: "bg-emerald-500" },
  { key: "dueThisWeek", label: "Orders Due This Week", accent: "border-l-blue-500", dot: "bg-blue-500" },
  { key: "overdue", label: "Orders Overdue", accent: "border-l-rose-500", dot: "bg-rose-500" },
] as const;

const FUNNEL_FILLS: Record<string, string> = {
  Draft: "#cbd5e1",
  "Proof Sent": "#94a3b8",
  "Approval Sent": "#3b82f6",
  Approved: "#10b981",
};

const AGING_TONES: Record<string, string> = {
  "0 – 7 days": "bg-emerald-50 text-emerald-700",
  "8 – 14 days": "bg-amber-50 text-amber-700",
  "15 – 30 days": "bg-orange-50 text-orange-700",
  "30+ days": "bg-rose-50 text-rose-700",
};

// ---- Formatters ----------------------------------------------------------

const currency = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

const number = (n: number) => new Intl.NumberFormat("en-US").format(n);

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

const todayLong = () =>
  new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

// ---- Fetch helpers -------------------------------------------------------

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json();
}

// ---- UI primitives -------------------------------------------------------

function SectionHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-4 flex items-baseline justify-between">
      <div>
        <div className="text-xs font-semibold uppercase tracking-widest text-slate-400">
          {eyebrow}
        </div>
        <h2 className="mt-1 text-lg font-semibold text-slate-900">{title}</h2>
      </div>
      {subtitle && <div className="text-sm text-slate-500">{subtitle}</div>}
    </div>
  );
}

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

// ---- Page ----------------------------------------------------------------

export default function Dashboard() {
  const [customerView, setCustomerView] = useState<"ytd" | "last">("ytd");

  const zone1 = useQuery({
    queryKey: ["zone1"],
    queryFn: () => fetchJson<Zone1Response>("/api/zone1"),
  });
  const zone2 = useQuery({
    queryKey: ["zone2"],
    queryFn: () => fetchJson<Zone2Response>("/api/zone2"),
  });
  const zone3 = useQuery({
    queryKey: ["zone3"],
    queryFn: () => fetchJson<Zone3Response>("/api/zone3"),
  });
  const zone4 = useQuery({
    queryKey: ["zone4"],
    queryFn: () => fetchJson<Zone4Response>("/api/zone4"),
  });

  const anyLoading =
    zone1.isLoading || zone2.isLoading || zone3.isLoading || zone4.isLoading;
  const anyError = zone1.error || zone2.error || zone3.error || zone4.error;

  // ---- Build view-model arrays (merge server data + styling) ----

  const kpis = KPI_STYLES.map((s) => {
    const d = zone1.data?.[s.key as keyof Zone1Response] as Zone1Kpi | undefined;
    return {
      label: s.label,
      count: d?.count ?? 0,
      value: d?.value ?? 0,
      accent: s.accent,
      dot: s.dot,
    };
  });

  const customers =
    customerView === "ytd"
      ? zone2.data?.topYTD ?? []
      : zone2.data?.topLastYear ?? [];

  const funnel = (zone3.data?.funnel ?? []).map((f) => ({
    ...f,
    fill: FUNNEL_FILLS[f.name] ?? "#94a3b8",
  }));

  const agingBuckets = (zone3.data?.agingBuckets ?? []).map((b) => ({
    ...b,
    tone: AGING_TONES[b.bucket] ?? "bg-slate-100 text-slate-700",
  }));

  const expiringSoon = zone3.data?.expiringSoon ?? [];
  const winRateTrend = zone3.data?.winRateTrend ?? [];
  const forwardLoad = zone4.data?.forwardLoad ?? [];

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      {/* Top bar */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-white">
              FA
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">
                Fieldhouse Apparel
              </div>
              <div className="text-xs text-slate-500">Executive Dashboard</div>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="hidden items-center gap-2 text-xs md:flex">
              {anyError ? (
                <>
                  <span className="h-2 w-2 rounded-full bg-rose-500" />
                  <span className="text-rose-600">Update failed — retrying</span>
                </>
              ) : anyLoading ? (
                <>
                  <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
                  <span className="text-slate-500">Loading…</span>
                </>
              ) : (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                  </span>
                  <span className="text-slate-500">
                    Live · refreshing every 30s
                  </span>
                </>
              )}
            </div>
            <div className="text-sm text-slate-600">{todayLong()}</div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-10 px-6 py-8">
        {/* Zone 1 */}
        <section>
          <SectionHeader
            eyebrow="Zone 1"
            title="Production Pipeline"
            subtitle="Current state — no comparisons"
          />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            {kpis.map((k) => (
              <Card key={k.label} className={`border-l-4 ${k.accent} p-5`}>
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${k.dot}`}></span>
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    {k.label}
                  </div>
                </div>
                <div className="mt-4 flex items-baseline gap-3">
                  <div className="text-3xl font-bold text-slate-900">
                    {number(k.count)}
                  </div>
                  <div className="text-sm text-slate-400">orders</div>
                </div>
                <div className="mt-1 text-xl font-semibold text-slate-700">
                  {currency(k.value)}
                </div>
              </Card>
            ))}
          </div>
        </section>

        {/* Zone 2 */}
        <section>
          <SectionHeader
            eyebrow="Zone 2"
            title="Top Customers"
            subtitle="Ranked by booked revenue"
          />
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                <button
                  onClick={() => setCustomerView("ytd")}
                  className={`rounded-md px-3 py-1 text-sm font-medium transition ${
                    customerView === "ytd"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Top 10 YTD
                </button>
                <button
                  onClick={() => setCustomerView("last")}
                  className={`rounded-md px-3 py-1 text-sm font-medium transition ${
                    customerView === "last"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Top 10 Last Year
                </button>
              </div>
              <div className="text-xs text-slate-500">
                {customerView === "ytd"
                  ? `Jan 1, ${new Date().getFullYear()} — today`
                  : `Jan 1 — Dec 31, ${new Date().getFullYear() - 1}`}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-3">#</th>
                    <th className="px-5 py-3">Customer</th>
                    <th className="px-5 py-3 text-right">Revenue</th>
                    <th className="px-5 py-3 text-right">Orders</th>
                    <th className="px-5 py-3 text-right">Pieces</th>
                    <th className="px-5 py-3 text-right">Last Order</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.length === 0 && !zone2.isLoading && (
                    <tr>
                      <td
                        className="px-5 py-8 text-center text-slate-400"
                        colSpan={6}
                      >
                        No customers to show for this period.
                      </td>
                    </tr>
                  )}
                  {customers.map((c, i) => (
                    <tr
                      key={`${c.customer}-${i}`}
                      className="border-t border-slate-100 hover:bg-slate-50"
                    >
                      <td className="px-5 py-3 text-slate-400">{i + 1}</td>
                      <td className="px-5 py-3 font-medium text-slate-900">
                        {c.customer}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold text-slate-900">
                        {currency(c.revenue)}
                      </td>
                      <td className="px-5 py-3 text-right text-slate-700">
                        {number(c.orders)}
                      </td>
                      <td className="px-5 py-3 text-right text-slate-700">
                        {number(c.pieces)}
                      </td>
                      <td className="px-5 py-3 text-right text-slate-500">
                        {formatDate(c.lastOrder)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </section>

        {/* Zone 3 */}
        <section>
          <SectionHeader
            eyebrow="Zone 3"
            title="Pipeline & Quoting"
            subtitle="Active quotes only — archived excluded"
          />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Funnel */}
            <Card className="p-5">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">
                  Quotes by Status
                </h3>
                <div className="text-xs text-slate-500">
                  {number(funnel.reduce((s, f) => s + f.count, 0))} quotes ·{" "}
                  {currency(funnel.reduce((s, f) => s + f.value, 0))}
                </div>
              </div>
              <div className="space-y-2">
                {funnel.map((f) => {
                  const maxVal = Math.max(1, ...funnel.map((x) => x.value));
                  const pct = (f.value / maxVal) * 100;
                  const firstCount = funnel[0]?.count ?? 0;
                  const relPct =
                    firstCount > 0
                      ? Math.round((f.count / firstCount) * 100)
                      : 0;
                  return (
                    <div key={f.name}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-700">
                          {f.name}
                        </span>
                        <span className="text-slate-500">
                          {number(f.count)} · {currency(f.value)}
                        </span>
                      </div>
                      <div className="h-7 w-full overflow-hidden rounded-md bg-slate-100">
                        <div
                          className="flex h-full items-center justify-end pr-2 text-xs font-medium text-white"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: f.fill,
                          }}
                        >
                          {relPct}%
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Aging */}
            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">
                  Quote Aging
                </h3>
                <div className="text-xs text-slate-500">
                  Age from created date
                </div>
              </div>
              <div className="space-y-2">
                {agingBuckets.map((a) => (
                  <div
                    key={a.bucket}
                    className="flex items-center justify-between rounded-lg border border-slate-100 p-3"
                  >
                    <div
                      className={`rounded-md px-2 py-1 text-xs font-semibold ${a.tone}`}
                    >
                      {a.bucket}
                    </div>
                    <div className="flex items-center gap-6 text-sm">
                      <div>
                        <div className="text-xs text-slate-500">Count</div>
                        <div className="font-semibold text-slate-900">
                          {number(a.count)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-slate-500">Value</div>
                        <div className="font-semibold text-slate-900">
                          {currency(a.value)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Expiring Soon */}
            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">
                  Expiring Soon
                </h3>
                <div className="text-xs text-slate-500">
                  Quotes 23–30 days old
                </div>
              </div>
              <div className="divide-y divide-slate-100">
                {expiringSoon.length === 0 && (
                  <div className="py-6 text-center text-xs text-slate-400">
                    No quotes expiring in the next week.
                  </div>
                )}
                {expiringSoon.map((q) => (
                  <div
                    key={q.quote}
                    className="flex items-center justify-between py-3"
                  >
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        {q.quote}
                      </div>
                      <div className="text-xs text-slate-500">{q.customer}</div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-sm font-semibold text-slate-900">
                        {currency(q.value)}
                      </div>
                      <div
                        className={`rounded-md px-2 py-1 text-xs font-semibold ${
                          q.daysLeft <= 3
                            ? "bg-rose-50 text-rose-700"
                            : q.daysLeft <= 5
                            ? "bg-amber-50 text-amber-700"
                            : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {q.daysLeft}d left
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Win Rate Trend */}
            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">
                  Conversion Rate
                </h3>
                <div className="text-xs text-slate-500">
                  Rolling 90-day, weekly
                </div>
              </div>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={winRateTrend}
                    margin={{ top: 5, right: 10, left: -15, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      dataKey="week"
                      tick={{ fontSize: 10, fill: "#64748b" }}
                      interval={3}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fontSize: 10, fill: "#64748b" }}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <Tooltip
                      formatter={(v) => [
                        `${typeof v === "number" ? v : Number(v ?? 0)}%`,
                        "Conversion",
                      ]}
                      contentStyle={{
                        borderRadius: 8,
                        border: "1px solid #e2e8f0",
                        fontSize: 12,
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="rate"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        </section>

        {/* Zone 4 */}
        <section>
          <SectionHeader
            eyebrow="Zone 4"
            title="Production & Forward Planning"
            subtitle="Next 4 weeks · pieces by decoration method"
          />

          {/* Weekly capacity cards */}
          <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            {forwardLoad.map((w) => {
              const total = workTypes.reduce((s, t) => s + w[t.key], 0);
              const pct = (n: number) =>
                total > 0 ? (n / total) * 100 : 0;
              return (
                <Card key={w.week} className="p-5">
                  <div className="flex items-baseline justify-between">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {w.week}
                    </div>
                    <div className="text-xs text-slate-400">{w.dates}</div>
                  </div>
                  <div className="mt-3 flex items-baseline gap-2">
                    <div className="text-3xl font-bold text-slate-900">
                      {number(total)}
                    </div>
                    <div className="text-sm text-slate-400">pieces</div>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
                    <span>{number(w.orders)} orders</span>
                    <span className="text-slate-300">·</span>
                    <span>{currency(w.value)}</span>
                  </div>

                  <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
                    {workTypes.map((t) => (
                      <div
                        key={t.key}
                        className={`h-full ${t.color}`}
                        style={{ width: `${pct(w[t.key])}%` }}
                        title={`${t.label} ${w[t.key]}`}
                      ></div>
                    ))}
                  </div>

                  <div className="mt-3 space-y-1.5 text-xs">
                    {workTypes.map((t) => (
                      <div
                        key={t.key}
                        className="flex items-center justify-between"
                      >
                        <span className="flex items-center gap-2 text-slate-600">
                          <span
                            className={`h-2 w-2 rounded-full ${t.dot}`}
                          ></span>
                          {t.label}
                        </span>
                        <span className="font-semibold text-slate-900">
                          {number(w[t.key])}
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
              );
            })}
          </div>
        </section>

        <footer className="pt-4 text-center text-xs text-slate-400">
          Live data from Printavo · refreshes every 30 seconds
        </footer>
      </main>
    </div>
  );
}
