import "dotenv/config";
import { gql } from "graphql-request";
import { prisma } from "../src/lib/db";
import { printavo } from "../src/lib/printavo";
import { categorize } from "../src/lib/status-map";

// Main backfill: uses the `orders` query (OrderUnion = Quote + Invoice).
// Pulls totalQuantity directly — no line-item nesting needed.
// Customer primary-contact details are pulled via customer.primaryContact.

const ORDERS_QUERY = gql`
  query Orders($after: String) {
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

async function main() {
  console.log("Starting backfill…");
  const startedAt = new Date();
  let after: string | null = null;
  let total = 0;
  let skipped = 0;

  do {
    const res: any = await printavo.request(ORDERS_QUERY, { after });
    const { nodes, pageInfo } = res.orders;

    for (const n of nodes) {
      const category = categorize(n.status?.name ?? "");
      if (category === "EXCLUDE") {
        skipped++;
        continue;
      }

      // Customer upsert (via contact.customer) — includes primary contact details
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

      // Order upsert
      const orderType = n.__typename === "Quote" ? "QUOTE" : "INVOICE";
      await prisma.order.upsert({
        where: { id: n.id },
        update: {
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
          createdAt: n.createdAt ? new Date(n.createdAt) : new Date(),
          customerDueAt: n.customerDueAt ? new Date(n.customerDueAt) : null,
          lastSyncedAt: new Date(),
        },
        create: {
          id: n.id,
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
          createdAt: n.createdAt ? new Date(n.createdAt) : new Date(),
          customerDueAt: n.customerDueAt ? new Date(n.customerDueAt) : null,
          lastSyncedAt: new Date(),
        },
      });
      total++;
    }

    console.log(`  processed ${total} (skipped ${skipped})`);
    after = pageInfo.hasNextPage ? pageInfo.endCursor : null;

    // Respect rate limit: 10 req / 5 sec → ~600ms pause between pages
    await new Promise((r) => setTimeout(r, 600));
  } while (after);

  await prisma.syncLog.create({
    data: {
      startedAt,
      finishedAt: new Date(),
      ordersSynced: total,
      ordersSkipped: skipped,
      status: "OK",
    },
  });

  console.log(`Done. Synced ${total} orders, skipped ${skipped}.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.syncLog.create({
    data: {
      startedAt: new Date(),
      finishedAt: new Date(),
      ordersSynced: 0,
      ordersSkipped: 0,
      status: "ERROR",
      errorMessage: String(e?.message ?? e).slice(0, 2000),
    },
  });
  await prisma.$disconnect();
  process.exit(1);
});
