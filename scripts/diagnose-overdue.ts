// scripts/diagnose-overdue.ts
//
// Usage:
//   npx tsx scripts/diagnose-overdue.ts 12345 12346
//
// Takes one or more Printavo visual IDs as arguments and prints why each one
// is (or isn't) showing up in the Zone 1 "Overdue" bucket.

import "dotenv/config";
import { prisma } from "../src/lib/db";

async function main() {
  const visualIds = process.argv.slice(2);
  if (visualIds.length === 0) {
    console.log("Usage: npx tsx scripts/diagnose-overdue.ts 12345 12346 ...");
    process.exit(1);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const vid of visualIds) {
    const o = await prisma.order.findFirst({
      where: { visualId: vid },
      include: { customer: true },
    });

    console.log(`\n============================================`);
    console.log(`#${vid}`);
    console.log(`============================================`);

    if (!o) {
      console.log("  → NOT IN DATABASE (the backfill never saw this order)");
      console.log("    Fix: run the reconcile cron or re-run backfill");
      continue;
    }

    const who = o.customer?.companyName ?? o.contactFullName ?? "—";
    console.log(`  Customer:        ${who}`);
    console.log(`  Total:           $${(o.total ?? 0).toFixed(2)}`);
    console.log(`  Last synced:     ${o.lastSyncedAt.toISOString()}`);
    console.log();

    // Check each filter condition Zone 1 overdue applies
    const checks: Array<{ label: string; value: string; ok: boolean; fix?: string }> = [];

    checks.push({
      label: "orderType",
      value: o.orderType,
      ok: o.orderType === "INVOICE",
      fix:
        o.orderType === "QUOTE"
          ? "In Printavo, this is still a Quote. Either finalize it to an Invoice, or loosen the Zone 1 filter to include quotes."
          : undefined,
    });

    const statusCat = o.statusCategory ?? "(null)";
    const excludedBy = ["ORDER_COMPLETE", "EXCLUDE"].includes(statusCat);
    checks.push({
      label: "statusCategory",
      value: `${statusCat}  (from statusName "${o.statusName ?? "(null)"}")`,
      ok: !excludedBy && statusCat !== "(null)",
      fix:
        statusCat === "EXCLUDE"
          ? `Status "${o.statusName}" isn't in src/lib/status-map.ts. Add it and re-sync.`
          : statusCat === "ORDER_COMPLETE"
            ? "Printavo has this order in a Completed status. If that's wrong, fix it in Printavo."
            : statusCat === "(null)"
              ? "statusCategory is null — likely a sync issue. Re-run backfill for this order."
              : undefined,
    });

    const due = o.customerDueAt;
    const dueOk = !!(due && due < today);
    checks.push({
      label: "customerDueAt",
      value: due ? due.toISOString().slice(0, 10) : "(null)",
      ok: dueOk,
      fix: !due
        ? "No due date set in Printavo. Add one, then re-sync."
        : due >= today
          ? "Due date is today or in the future — Printavo doesn't think this is late yet."
          : undefined,
    });

    // Print check results
    const w = 18;
    for (const c of checks) {
      const mark = c.ok ? "OK  " : "FAIL";
      console.log(`  [${mark}]  ${c.label.padEnd(w)} ${c.value}`);
      if (c.fix) console.log(`           → ${c.fix}`);
    }

    const allOk = checks.every((c) => c.ok);
    console.log();
    console.log(
      allOk
        ? "  ✓ This order SHOULD be in the overdue bucket. If it isn't, something else is up — ping me."
        : "  ✗ This order is filtered out. See the FAIL rows above."
    );
  }

  console.log();
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
