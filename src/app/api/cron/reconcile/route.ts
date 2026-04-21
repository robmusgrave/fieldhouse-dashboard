// src/app/api/cron/reconcile/route.ts
//
// Fast incremental Printavo sync.
//
// Called every ~10 minutes by GitHub Actions (or Vercel Cron on Pro).
// Re-pulls orders created within the last N minutes (default 1440 = 24h)
// and upserts them using the same shape as scripts/backfill.ts.
//
// Relationship to the nightly full backfill:
//   - This endpoint keeps the dashboard "live enough" during the day by
//     catching new orders and status changes on recent orders.
//   - The nightly full backfill (scripts/backfill.ts) is still the
//     source of truth and catches status changes on older orders.
//
// Line items are NOT refreshed here — they come from scripts/backfill-line-items.ts
// on a separate cadence. Zone 4 piece counts lag by up to a day.

import { NextRequest, NextResponse } from "next/server";
import { gql } from "graphql-request";
import { prisma } from "@/lib/db";
import { printavo } from "@/lib/printavo";
import { categorize } from "@/lib/status-map";

export const dynamic = "force-dynamic";
export const revalidate = 0;
// Cron pages can take a few seconds on slow Printavo responses. Give ourselves
// headroom on Vercel (default function timeout is ~10s on Hobby).
export const maxDuration = 60;

// Same shape as backfill — just re-used so upsert logic stays consistent.
const ORDERS_QUERY = gql`
  query OrdersRecent($after: String) {
    orders(first: 25, after: $after, sortDescending: true) {
      pageInfo { hasNextPage endCursor }
      nodes {
        __typename
        ... on Quote {
          id
          visualId
          status { id name }
          total
          subtotal
          totalQuantity
          createdAt
          customerDueAt
          contact {
            id
            fullName
            email
            customer {
              id
              companyName
              primaryContact {
                id
                firstName
                lastName
                fullName
                email
                phone
              }
            }
          }
        }
        ... on Invoice {
          id
          visualId
          status { id name }
          total
          subtotal
          totalQuantity
          createdAt
          customerDueAt
          contact {
            id
            fullName
            email
            customer {
              id
              companyName
              primaryContact {
                id
                firstName
                lastName
                fullName
                email
                phone
              }
            }
          }
        }
      }
    }
  }
`;

export async function GET(req: NextRequest) {
  // --- Auth -----------------------------------------------------------
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // --- Parse window ---------------------------------------------------
  const url = new URL(req.url);
  const sinceMinutes = Math.max(
    1,
    parseInt(url.searchParams.get("sinceMinutes") ?? "1440", 10)
  );
  const sinceDate = new Date(Date.now() - sinceMinutes * 60_000);

  const startedAt = new Date();
  let after: string | null = null;
  let synced = 0;
  let skipped = 0;
  let pages = 0;
  let stopped = false;

  try {
    do {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await printavo.request(ORDERS_QUERY, { after });
      const { nodes, pageInfo } = res.orders;
      pages++;

      for (const n of nodes) {
        // Newest-first sort means once we see an order older than our
        // window, everything after is older too — stop paginating.
        const createdAt = n.createdAt ? new Date(n.createdAt) : null;
        if (createdAt && createdAt < sinceDate) {
          stopped = true;
          break;
        }

        const category = categorize(n.status?.name ?? "");
        if (category === "EXCLUDE") {
          skipped++;
          continue;
        }

        // --- Customer upsert (same shape as backfill) ---
        const cust = n.contact?.customer;
        if (cust?.id) {
          const pc = cust.primaryContact ?? {};
          const customerData = {
            companyName: cust.companyName ?? null,
            primaryContactFirstName: pc.firstName ?? null,
            primaryContactLastName: pc.lastName ?? null,
            primaryContactFullName: pc.fullName ?? null,
            primaryContactEmail: pc.email ?? null,
            primaryContactPhone: pc.phone ?? null,
          };
          await prisma.customer.upsert({
            where: { id: cust.id },
            update: customerData,
            create: { id: cust.id, ...customerData },
          });
        }

        // --- Order upsert (same shape as backfill) ---
        const orderType: "QUOTE" | "INVOICE" = n.__typename === "Quote" ? "QUOTE" : "INVOICE";
        const orderData = {
          visualId: n.visualId ?? null,
          orderType,
          statusId: n.status?.id ?? null,
          statusName: n.status?.name ?? null,
          statusCategory: category,
          total: n.total ?? null,
          subtotal: n.subtotal ?? null,
          totalQuantity: n.totalQuantity ?? null,
          customerId: cust?.id ?? null,
          contactFullName: n.contact?.fullName ?? null,
          contactEmail: n.contact?.email ?? null,
          createdAt: createdAt ?? new Date(),
          customerDueAt: n.customerDueAt ? new Date(n.customerDueAt) : null,
          lastSyncedAt: new Date(),
        };
        await prisma.order.upsert({
          where: { id: n.id },
          update: orderData,
          create: { id: n.id, ...orderData },
        });
        synced++;
      }

      if (stopped) break;
      after = pageInfo.hasNextPage ? pageInfo.endCursor : null;

      // Printavo rate limit: 10 req / 5 sec → ~600ms pause between pages.
      if (after) await new Promise((r) => setTimeout(r, 600));
    } while (after);

    await prisma.syncLog.create({
      data: {
        startedAt,
        finishedAt: new Date(),
        ordersSynced: synced,
        ordersSkipped: skipped,
        status: "OK",
        errorMessage: `reconcile sinceMinutes=${sinceMinutes} pages=${pages}`,
      },
    });

    return NextResponse.json({
      ok: true,
      synced,
      skipped,
      pages,
      sinceMinutes,
      durationMs: Date.now() - startedAt.getTime(),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.syncLog.create({
      data: {
        startedAt,
        finishedAt: new Date(),
        ordersSynced: synced,
        ordersSkipped: skipped,
        status: "ERROR",
        errorMessage: msg.slice(0, 2000),
      },
    });
    return NextResponse.json(
      { error: "reconcile failed", details: msg },
      { status: 500 }
    );
  }
}
