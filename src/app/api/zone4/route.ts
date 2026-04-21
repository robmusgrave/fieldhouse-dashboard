// src/app/api/zone4/route.ts
//
// Zone 4: Production & Forward Planning
//
// For each of the next 4 weeks (starting this Monday), return:
//   - orders:         count of orders with customerDueAt in that week AND
//                     statusCategory in (ORDER_OPEN, ORDER_PRODUCTION, ORDER_ON_HOLD)
//   - value:          sum of Order.total for those orders
//   - embroidery:     sum of LineItem.quantity where typeOfWork maps to Embroidery
//   - screenPrinting: ...
//   - heatDTF:        ...
//   - heatPatches:    ...
//
// Pieces come from the LineItem table (populated by scripts/backfill-line-items.ts).
// If that script hasn't been run, pieces will be zero — the orders/value counts still work.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type WorkKey =
  | "embroidery"
  | "screenPrinting"
  | "heatDTF"
  | "heatPatches"
  | "other";

// Maps Printavo's typeOfWork strings → our five buckets.
// null or unmatched values land in "other" (covers outsourced uniforms, service
// line items, and anything without a Printavo imprint attached).
function workKey(typeOfWork: string | null): WorkKey {
  if (!typeOfWork) return "other";
  const s = typeOfWork.toLowerCase();
  if (s.includes("embroidery") || s.includes("embroid")) return "embroidery";
  if (s.includes("screen")) return "screenPrinting";
  if (s.includes("dtf") || s.includes("transfer")) return "heatDTF";
  if (s.includes("patch")) return "heatPatches";
  // Heat Printing without more context is closest to DTF
  if (s.includes("heat")) return "heatDTF";
  return "other";
}

const OPEN_CATS = ["ORDER_OPEN", "ORDER_PRODUCTION", "ORDER_ON_HOLD"];

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

// This Monday at 00:00:00
function thisMonday(ref: Date) {
  const d = startOfDay(ref);
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function fmt(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export async function GET() {
  const now = new Date();
  const monday = thisMonday(now);

  // Build the 4 week windows
  const weeks = [0, 1, 2, 3].map((i) => {
    const start = new Date(monday);
    start.setDate(start.getDate() + i * 7);
    const end = endOfDay(new Date(start));
    end.setDate(end.getDate() + 6);
    return {
      index: i,
      start,
      end,
      label: i === 0 ? "This Week" : i === 1 ? "Next Week" : `+${i} Weeks`,
      dates: `${fmt(start)} – ${fmt(end)}`,
    };
  });

  const overallStart = weeks[0].start;
  const overallEnd = weeks[3].end;

  // 1. Pull all open orders due in the 4-week window
  const orders = await prisma.order.findMany({
    where: {
      statusCategory: { in: OPEN_CATS },
      customerDueAt: { gte: overallStart, lte: overallEnd },
    },
    select: { id: true, total: true, customerDueAt: true },
  });

  // 2. Pull LineItems for those orders (for pieces by decoration method)
  const orderIds = orders.map((o) => o.id);
  const lineItems = orderIds.length
    ? await prisma.lineItem.findMany({
        where: { orderId: { in: orderIds } },
        select: { orderId: true, quantity: true, typeOfWork: true },
      })
    : [];

  // Map order.id → week index
  const orderWeek = new Map<string, number>();
  for (const o of orders) {
    if (!o.customerDueAt) continue;
    const w = weeks.findIndex(
      (wk) => o.customerDueAt! >= wk.start && o.customerDueAt! <= wk.end
    );
    if (w >= 0) orderWeek.set(o.id, w);
  }

  // Initialise results
  const forwardLoad = weeks.map((w) => ({
    week: w.label,
    dates: w.dates,
    orders: 0,
    value: 0,
    embroidery: 0,
    screenPrinting: 0,
    heatDTF: 0,
    heatPatches: 0,
    other: 0,
  }));

  // Roll up orders + value
  for (const o of orders) {
    const w = orderWeek.get(o.id);
    if (w === undefined) continue;
    forwardLoad[w].orders += 1;
    forwardLoad[w].value += o.total ?? 0;
  }

  // Roll up pieces by decoration (workKey always returns a bucket now)
  for (const li of lineItems) {
    const w = orderWeek.get(li.orderId);
    if (w === undefined) continue;
    const key = workKey(li.typeOfWork);
    forwardLoad[w][key] += li.quantity ?? 0;
  }

  return NextResponse.json({
    forwardLoad,
    generatedAt: now.toISOString(),
  });
}
