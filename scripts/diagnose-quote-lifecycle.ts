// scripts/diagnose-quote-lifecycle.ts
//
// Usage:
//   npx tsx scripts/diagnose-quote-lifecycle.ts
//
// Answers: "do my quotes ever land in QUOTE_WON / QUOTE_LOST, or does my
// Printavo workflow skip those statuses?" — which drives whether Zone 3's
// win-rate trend can work as defined.

import "dotenv/config";
import { prisma } from "../src/lib/db";

async function main() {
  console.log("\n=== Quote Lifecycle Distribution ===\n");

  // Count by statusCategory
  const byCategory = await prisma.order.groupBy({
    by: ["statusCategory"],
    _count: true,
  });
  console.log("Counts by statusCategory:");
  for (const r of byCategory.sort((a, b) => b._count - a._count)) {
    console.log(`  ${(r.statusCategory ?? "null").padEnd(20)} ${String(r._count).padStart(5)}`);
  }

  // Zoom in on QUOTE_WON / QUOTE_LOST
  console.log("\nstatusName distribution for QUOTE_WON + QUOTE_LOST:");
  const wonLost = await prisma.order.groupBy({
    by: ["statusName"],
    where: { statusCategory: { in: ["QUOTE_WON", "QUOTE_LOST"] } },
    _count: true,
  });
  if (wonLost.length === 0) {
    console.log("  (none — so the win-rate trend can't compute)");
  } else {
    for (const r of wonLost) console.log(`  ${r.statusName?.padEnd(30)} ${r._count}`);
  }

  // Look at the statusName of currently-active quotes
  console.log("\nstatusName distribution for QUOTE_ACTIVE (what's in flight):");
  const active = await prisma.order.groupBy({
    by: ["statusName"],
    where: { statusCategory: "QUOTE_ACTIVE" },
    _count: true,
  });
  for (const r of active.sort((a, b) => b._count - a._count)) {
    console.log(`  ${r.statusName?.padEnd(30)} ${r._count}`);
  }

  // And how many INVOICEs we have in the last 90 days (proxy for wins)
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000);
  const recentInvoices = await prisma.order.count({
    where: {
      orderType: "INVOICE",
      createdAt: { gte: ninetyDaysAgo },
      statusCategory: { not: "EXCLUDE" },
    },
  });
  const activeQuotesCount = await prisma.order.count({
    where: { statusCategory: "QUOTE_ACTIVE" },
  });
  console.log(`\nLast 90 days:`);
  console.log(`  Invoices created: ${recentInvoices}   ← proxy for "quotes that won"`);
  console.log(`  Quotes currently active: ${activeQuotesCount}`);

  console.log();
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
