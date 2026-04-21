// src/app/api/zone3/route.ts
//
// Zone 3: Pipeline & Quoting
//
// Returns:
//   - funnel:        4 stages — Draft / Proof Sent / Approval Sent / Approved
//                    grouped from Order.statusName (QUOTE_ACTIVE only).
//   - agingBuckets:  QUOTE_ACTIVE by age since Order.createdAt
//                    0-7 / 8-14 / 15-30 / 30+ days
//   - expiringSoon:  QUOTE_ACTIVE where createdAt is 23-30 days ago
//                    (Printavo quotes expire at 30 days)
//   - winRateTrend:  Rolling 90-day win rate, weekly, for the last 26 weeks.
//                    rate = QUOTE_WON / (QUOTE_WON + QUOTE_LOST) in each 90d window.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ---- Funnel grouping ----------------------------------------------------
// Maps raw Printavo status names to one of our 4 funnel stage buckets.
// Anything that doesn't match falls through and is ignored.
function funnelBucket(statusName: string | null): FunnelKey | null {
  if (!statusName) return null;
  const s = statusName.toLowerCase();

  // "Approved" — most specific, check first
  if (s === "quote approved") return "Approved";

  // "Approval Sent"
  if (s.includes("approval sent")) return "ApprovalSent";

  // "Proof Sent" — proof is out to the customer
  if (s.includes("proof to customer") || s.includes("proof ready")) {
    return "ProofSent";
  }

  // "Draft" — everything else in QUOTE_ACTIVE bucket (quote being built)
  if (s === "quote" || s.includes("create proof") || s === "quote declined") {
    return "Draft";
  }

  return null;
}

type FunnelKey = "Draft" | "ProofSent" | "ApprovalSent" | "Approved";
const FUNNEL_LABEL: Record<FunnelKey, string> = {
  Draft: "Draft",
  ProofSent: "Proof Sent",
  ApprovalSent: "Approval Sent",
  Approved: "Approved",
};
const FUNNEL_ORDER: FunnelKey[] = ["Draft", "ProofSent", "ApprovalSent", "Approved"];

// ---- Handler ------------------------------------------------------------
export async function GET() {
  const now = new Date();
  const today = startOfDay(now);

  // 1. FUNNEL — active quotes + recently-approved quotes
  //    "Quote Approved" orders are statusCategory=QUOTE_WON, not QUOTE_ACTIVE,
  //    but we want them in the funnel's "Approved" bucket. Include both.
  const activeQuotes = await prisma.order.findMany({
    where: { statusCategory: { in: ["QUOTE_ACTIVE", "QUOTE_WON"] } },
    select: { statusName: true, total: true, createdAt: true, visualId: true, customerId: true, id: true, statusCategory: true },
  });

  const funnelAgg: Record<FunnelKey, { count: number; value: number }> = {
    Draft: { count: 0, value: 0 },
    ProofSent: { count: 0, value: 0 },
    ApprovalSent: { count: 0, value: 0 },
    Approved: { count: 0, value: 0 },
  };

  for (const q of activeQuotes) {
    const bucket = funnelBucket(q.statusName);
    if (!bucket) continue;
    funnelAgg[bucket].count += 1;
    funnelAgg[bucket].value += q.total ?? 0;
  }

  const funnel = FUNNEL_ORDER.map((k) => ({
    name: FUNNEL_LABEL[k],
    count: funnelAgg[k].count,
    value: funnelAgg[k].value,
  }));

  // Aging + Expiring Soon should only count QUOTE_ACTIVE (approved quotes
  // are by definition no longer "aging" as open quotes).
  const stillOpen = activeQuotes.filter(
    (q: (typeof activeQuotes)[number]) => q.statusCategory === "QUOTE_ACTIVE"
  );

  // 2. AGING — QUOTE_ACTIVE only, bucketed by days since createdAt
  const agingBuckets = bucketise(
    stillOpen.map((q: (typeof stillOpen)[number]) => ({
      value: q.total ?? 0,
      ageDays: Math.floor((+today - +startOfDay(q.createdAt)) / 86400000),
    }))
  );

  // 3. EXPIRING SOON — QUOTE_ACTIVE, createdAt 23-30 days ago
  const expiringSoon = stillOpen
    .map((q: (typeof stillOpen)[number]) => {
      const age = Math.floor((+today - +startOfDay(q.createdAt)) / 86400000);
      return { q, age };
    })
    .filter(({ age }: { age: number }) => age >= 23 && age <= 30)
    .sort((a: { age: number }, b: { age: number }) => b.age - a.age) // oldest (= soonest to expire) first
    .slice(0, 10);

  // Fetch customer display names for those quotes
  const custIds = expiringSoon
    .map((x: (typeof expiringSoon)[number]) => x.q.customerId)
    .filter((id: string | null): id is string => !!id);
  const custs = custIds.length
    ? await prisma.customer.findMany({
        where: { id: { in: custIds } },
        select: { id: true, companyName: true, primaryContactFullName: true },
      })
    : [];
  const custMap = new Map(
    custs.map((c: (typeof custs)[number]) => [c.id, c] as const)
  );

  const expiringSoonOut = expiringSoon.map(
    ({ q, age }: (typeof expiringSoon)[number]) => {
    const c = q.customerId ? custMap.get(q.customerId) : undefined;
    return {
      quote: q.visualId ?? q.id.slice(0, 8),
      customer: c?.companyName || c?.primaryContactFullName || "—",
      value: q.total ?? 0,
      daysLeft: Math.max(0, 30 - age),
    };
    }
  );

  // 4. WIN RATE TREND — 26 weekly points, each = rolling 90-day window ending that week
  const winRateTrend = await winRate26Weeks(now);

  return NextResponse.json({
    funnel,
    agingBuckets,
    expiringSoon: expiringSoonOut,
    winRateTrend,
    generatedAt: now.toISOString(),
  });
}

// ---- Aging bucket helper ------------------------------------------------
function bucketise(rows: { value: number; ageDays: number }[]) {
  const def = [
    { bucket: "0 – 7 days", min: 0, max: 7 },
    { bucket: "8 – 14 days", min: 8, max: 14 },
    { bucket: "15 – 30 days", min: 15, max: 30 },
    { bucket: "30+ days", min: 31, max: Infinity },
  ];
  return def.map((b) => {
    const inBucket = rows.filter((r) => r.ageDays >= b.min && r.ageDays <= b.max);
    return {
      bucket: b.bucket,
      count: inBucket.length,
      value: inBucket.reduce((s, r) => s + r.value, 0),
    };
  });
}

// ---- Win rate trend -----------------------------------------------------
// Fieldhouse-specific definition (Option A):
//   Win  = an INVOICE was created (a quote that became real work)
//   Loss = a QUOTE_LOST order (an archived quote)
// Printavo's "Quote Approved" status is rarely used at Fieldhouse, so the
// original won/lost definition returned 0% every week. This version counts
// every converted invoice as a win, which matches how Fieldhouse actually
// operates.
//
// Caveat: "Loss" here assumes you archive dead quotes. If dead quotes sit
// unarchived in "Quote Approval Sent" forever, losses are undercounted and
// the reported rate is inflated. Archiving weekly keeps this honest.
async function winRate26Weeks(now: Date) {
  // Pull everything created in the trailing ~29 weeks
  // (26 weekly points + 90-day window = earliest window starts ~29 weeks back).
  const earliest = new Date(now);
  earliest.setDate(earliest.getDate() - (26 * 7 + 90));

  // Wins: invoices, any non-EXCLUDE status
  const wins = await prisma.order.findMany({
    where: {
      orderType: "INVOICE",
      statusCategory: { not: "EXCLUDE" },
      createdAt: { gte: earliest },
    },
    select: { createdAt: true },
  });

  // Losses: archived quotes (QUOTE_LOST)
  const losses = await prisma.order.findMany({
    where: {
      statusCategory: "QUOTE_LOST",
      createdAt: { gte: earliest },
    },
    select: { createdAt: true },
  });

  // Generate 26 weekly end-dates, most recent last
  const points: { week: string; rate: number }[] = [];
  const monthFmt = { month: "short", day: "numeric" } as const;

  const anchor = startOfDay(now);
  // Align anchor to Sunday so each "week" ends on a Sunday
  const daysBackToSun = anchor.getDay(); // 0=Sun
  anchor.setDate(anchor.getDate() - daysBackToSun);

  for (let i = 25; i >= 0; i--) {
    const windowEnd = new Date(anchor);
    windowEnd.setDate(windowEnd.getDate() - i * 7);
    const windowStart = new Date(windowEnd);
    windowStart.setDate(windowStart.getDate() - 90);

    const won = wins.filter(
      (r: (typeof wins)[number]) =>
        r.createdAt >= windowStart && r.createdAt <= windowEnd
    ).length;
    const lost = losses.filter(
      (r: (typeof losses)[number]) =>
        r.createdAt >= windowStart && r.createdAt <= windowEnd
    ).length;

    const denom = won + lost;
    const rate = denom === 0 ? 0 : Math.round((won / denom) * 100);
    points.push({
      week: windowEnd.toLocaleDateString("en-US", monthFmt),
      rate,
    });
  }

  return points;
}

// ---- Date utils ---------------------------------------------------------
function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
