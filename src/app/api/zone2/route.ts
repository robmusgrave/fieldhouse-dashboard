// src/app/api/zone2/route.ts
//
// Zone 2: Top 10 customers by booked revenue
//   - topYTD:      orders with createdAt in current calendar year
//   - topLastYear: orders in prior calendar year
//
// For each customer row:
//   { customer, revenue, orders, pieces, lastOrder,
//     companyName, primaryContactFullName, primaryContactEmail, primaryContactPhone }
//
// Rules:
//   - Exclude orderType = QUOTE (revenue = booked invoice $, not quoted $)
//   - Exclude statusCategory = EXCLUDE (voided / archived)
//   - Group by Order.customerId
//   - customer (display) = companyName || primaryContactFullName || "—"
//   - pieces = sum of Order.totalQuantity
//   - lastOrder = max createdAt across ALL orders (regardless of period) — matches build spec

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CustomerRow = {
  customer: string;
  revenue: number;
  orders: number;
  pieces: number;
  lastOrder: string; // ISO
  companyName: string | null;
  primaryContactFullName: string | null;
  primaryContactEmail: string | null;
  primaryContactPhone: string | null;
};

async function topCustomersForRange(start: Date, end: Date): Promise<CustomerRow[]> {
  // 1. Aggregate revenue/orders/pieces for the period
  const grouped = await prisma.order.groupBy({
    by: ["customerId"],
    where: {
      orderType: "INVOICE",
      statusCategory: { not: "EXCLUDE" },
      createdAt: { gte: start, lte: end },
      customerId: { not: null },
    },
    _sum: { total: true, totalQuantity: true },
    _count: true,
    orderBy: { _sum: { total: "desc" } },
    take: 10,
  });

  if (grouped.length === 0) return [];

  const ids = grouped
    .map((g): string | null => g.customerId)
    .filter((id: string | null): id is string => Boolean(id));

  // 2. Fetch customer records for the display fields
  const customers = await prisma.customer.findMany({
    where: { id: { in: ids } },
  });
  const byId = new Map(customers.map((c) => [c.id, c]));

  // 3. Most recent order per customer (any period)
  const latestOrders = await prisma.order.groupBy({
    by: ["customerId"],
    where: { customerId: { in: ids } },
    _max: { createdAt: true },
  });
  const latestById = new Map(
    latestOrders.map((r) => [r.customerId!, r._max.createdAt])
  );

  // 4. Stitch it together in the same order as `grouped` (desc by revenue)
  return grouped.map((g) => {
    const c = g.customerId ? byId.get(g.customerId) : undefined;
    const display =
      c?.companyName ||
      c?.primaryContactFullName ||
      "—";
    return {
      customer: display,
      revenue: g._sum.total ?? 0,
      orders: g._count,
      pieces: g._sum.totalQuantity ?? 0,
      lastOrder:
        (g.customerId && latestById.get(g.customerId)?.toISOString()) ||
        new Date(0).toISOString(),
      companyName: c?.companyName ?? null,
      primaryContactFullName: c?.primaryContactFullName ?? null,
      primaryContactEmail: c?.primaryContactEmail ?? null,
      primaryContactPhone: c?.primaryContactPhone ?? null,
    };
  });
}

export async function GET() {
  const now = new Date();
  const year = now.getFullYear();

  const ytdStart = new Date(year, 0, 1);
  const ytdEnd = now;

  const lastYearStart = new Date(year - 1, 0, 1);
  const lastYearEnd = new Date(year - 1, 11, 31, 23, 59, 59, 999);

  const [topYTD, topLastYear] = await Promise.all([
    topCustomersForRange(ytdStart, ytdEnd),
    topCustomersForRange(lastYearStart, lastYearEnd),
  ]);

  return NextResponse.json({
    topYTD,
    topLastYear,
    generatedAt: now.toISOString(),
  });
}
