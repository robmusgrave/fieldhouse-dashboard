import "dotenv/config";
import { prisma } from "../src/lib/db";

async function main() {
  const total = await prisma.lineItem.count();
  console.log(`\nTotal line items: ${total}\n`);

  if (total === 0) {
    console.log("No line items yet — did you run scripts/backfill-line-items.ts?");
    await prisma.$disconnect();
    return;
  }

  const byTow = await prisma.lineItem.groupBy({
    by: ["typeOfWork"],
    _count: true,
    _sum: { quantity: true },
  });

  console.log("Breakdown by typeOfWork:");
  console.table(
    byTow
      .sort((a, b) => (b._sum.quantity ?? 0) - (a._sum.quantity ?? 0))
      .map((r) => ({
        typeOfWork: r.typeOfWork ?? "(null)",
        rows: r._count,
        pieces: r._sum.quantity ?? 0,
      }))
  );

  // How many distinct orders got line items?
  const ordersWithItems = await prisma.lineItem.groupBy({
    by: ["orderId"],
    _count: true,
  });
  console.log(`\nOrders with line items: ${ordersWithItems.length}`);

  // Sample 5 orders to eyeball
  const sampleOrderIds = ordersWithItems.slice(0, 5).map((r) => r.orderId);
  const sample = await prisma.order.findMany({
    where: { id: { in: sampleOrderIds } },
    include: { lineItems: true, customer: true },
  });

  console.log("\nSample orders with their line items:");
  for (const o of sample) {
    const co = o.customer?.companyName ?? o.contactFullName ?? "—";
    const due = o.customerDueAt?.toISOString().slice(0, 10) ?? "—";
    console.log(`\n  #${o.visualId ?? "—"}  ${co}  due:${due}  status:${o.statusCategory}`);
    for (const li of o.lineItems) {
      console.log(`     qty:${String(li.quantity ?? "—").padStart(4)}  ${(li.typeOfWork ?? "(no typeOfWork)").padEnd(30)}  ${li.description ?? ""}`);
    }
  }

  console.log();
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
