// scripts/diagnose-line-items.ts
//
// Usage:
//   npx tsx scripts/diagnose-line-items.ts
//
// Answers: "what actual typeOfWork strings are in my LineItem table, and
// are any of them failing to map to the four dashboard buckets?"

import "dotenv/config";
import { prisma } from "../src/lib/db";

// Must match the mapper in src/app/api/zone4/route.ts
function workKey(typeOfWork: string | null): string | null {
  if (!typeOfWork) return null;
  const s = typeOfWork.toLowerCase();
  if (s.includes("embroidery") || s.includes("embroid")) return "embroidery";
  if (s.includes("screen")) return "screenPrinting";
  if (s.includes("dtf") || s.includes("transfer")) return "heatDTF";
  if (s.includes("patch")) return "heatPatches";
  if (s.includes("heat")) return "heatDTF";
  return null;
}

async function main() {
  console.log("\n=== Line Item Type-of-Work Distribution ===\n");

  const total = await prisma.lineItem.count();
  console.log(`Total line items: ${total}`);

  if (total === 0) {
    console.log("\nNo line items yet — run scripts/backfill-line-items.ts first.");
    await prisma.$disconnect();
    return;
  }

  const byType = await prisma.lineItem.groupBy({
    by: ["typeOfWork"],
    _count: true,
    _sum: { quantity: true },
  });

  console.log("\nAll distinct typeOfWork values in your data:");
  console.log("-".repeat(80));
  console.log(
    `${"typeOfWork".padEnd(40)} ${"rows".padStart(6)} ${"pieces".padStart(8)}  ${"→ bucket".padEnd(18)}`
  );
  console.log("-".repeat(80));

  const unmapped: { tow: string; rows: number; pieces: number }[] = [];
  for (const r of byType.sort(
    (a, b) => (b._sum.quantity ?? 0) - (a._sum.quantity ?? 0)
  )) {
    const tow = r.typeOfWork ?? "(null)";
    const bucket = workKey(r.typeOfWork);
    const bucketLabel = bucket ?? "UNMAPPED ⚠";
    console.log(
      `${tow.padEnd(40)} ${String(r._count).padStart(6)} ${String(r._sum.quantity ?? 0).padStart(8)}  → ${bucketLabel}`
    );
    if (!bucket) {
      unmapped.push({
        tow,
        rows: r._count,
        pieces: r._sum.quantity ?? 0,
      });
    }
  }

  console.log("-".repeat(80));

  if (unmapped.length > 0) {
    const unmappedPieces = unmapped.reduce((s, u) => s + u.pieces, 0);
    console.log(
      `\n⚠  ${unmapped.length} typeOfWork value(s) aren't mapping to a bucket — totaling ${unmappedPieces} pieces that are invisible in Zone 4.`
    );
    console.log("\nTell Claude about these values and we'll extend the workKey() mapper.");
  } else {
    console.log("\n✓ Every typeOfWork value maps to a bucket.");
  }

  console.log();
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
