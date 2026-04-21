// src/app/api/zone1/route.ts
//
// Zone 1: Production Pipeline KPIs
//   - openPipeline:        count + $ of orders in OPEN_PIPELINE_CATEGORIES
//   - completedYesterday:  count + $ of orders that hit ORDER_COMPLETE on prior day
//                          (proxy: statusCategory = ORDER_COMPLETE and lastSyncedAt yesterday)
//   - dueThisWeek:         INVOICE orders with customerDueAt in Mon..Sun of current
//                          week AND not ORDER_COMPLETE
//   - overdue:             INVOICE orders with customerDueAt < today AND not
//                          ORDER_COMPLETE
//
// dueThisWeek and overdue are restricted to orderType = INVOICE so stale quotes
// with past due-dates don't show up as "overdue production work".
//
// Shape matches what page.tsx needs for the four KPI cards.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { OPEN_PIPELINE_CATEGORIES } from "@/lib/status-map";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

// Monday-start week range containing the given date.
function weekRange(d: Date) {
  const start = startOfDay(d);
  const day = start.getDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + diffToMonday);
  const end = endOfDay(new Date(start));
  end.setDate(end.getDate() + 6);
  return { start, end };
}

async function aggregate(where: any) {
  const agg = await prisma.order.aggregate({
    where,
    _count: true,
    _sum: { total: true },
  });
  return {
    count: agg._count ?? 0,
    value: agg._sum.total ?? 0,
  };
}

export async function GET() {
  const now = new Date();
  const today = startOfDay(now);
  const yesterdayStart = new Date(today);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const yesterdayEnd = endOfDay(yesterdayStart);
  const { start: weekStart, end: weekEnd } = weekRange(now);

  // Production KPIs: invoices only (not stale quotes) AND not complete / excluded
  const INVOICE_NOT_DONE = {
    orderType: "INVOICE" as const,
    statusCategory: { notIn: ["ORDER_COMPLETE", "EXCLUDE"] },
  };

  const [openPipeline, completedYesterday, dueThisWeek, overdue] = await Promise.all([
    aggregate({ statusCategory: { in: OPEN_PIPELINE_CATEGORIES } }),
    aggregate({
      statusCategory: "ORDER_COMPLETE",
      lastSyncedAt: { gte: yesterdayStart, lte: yesterdayEnd },
    }),
    aggregate({
      ...INVOICE_NOT_DONE,
      customerDueAt: { gte: weekStart, lte: weekEnd },
    }),
    aggregate({
      ...INVOICE_NOT_DONE,
      customerDueAt: { lt: today },
    }),
  ]);

  return NextResponse.json({
    openPipeline,
    completedYesterday,
    dueThisWeek,
    overdue,
    generatedAt: now.toISOString(),
  });
}
