import "dotenv/config";
import { gql } from "graphql-request";
import { prisma } from "../src/lib/db";
import { printavo } from "../src/lib/printavo";

const LINE_ITEMS_QUOTE_QUERY = gql`
  query QuoteLineItems($id: ID!) {
    quote(id: $id) {
      id
      lineItemGroups {
        nodes {
          lineItems {
            nodes {
              id
              description
              items
              price
            }
          }
          imprints {
            nodes {
              typeOfWork {
                name
              }
            }
          }
        }
      }
    }
  }
`;

const LINE_ITEMS_INVOICE_QUERY = gql`
  query InvoiceLineItems($id: ID!) {
    invoice(id: $id) {
      id
      lineItemGroups {
        nodes {
          lineItems {
            nodes {
              id
              description
              items
              price
            }
          }
          imprints {
            nodes {
              typeOfWork {
                name
              }
            }
          }
        }
      }
    }
  }
`;

type PrintavoLineItemNode = {
  id: string;
  description: string | null;
  items: number | null;
  price: number | null;
};

type PrintavoLineItemGroupNode = {
  lineItems?: { nodes?: PrintavoLineItemNode[] | null } | null;
  imprints?: {
    nodes?: { typeOfWork?: { name?: string | null } | null }[] | null;
  } | null;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fourWeeksFromNow() {
  const now = new Date();
  const future = new Date(now);
  future.setDate(now.getDate() + 28);
  return future;
}

function collectTypeOfWork(group: PrintavoLineItemGroupNode): string | null {
  const names =
    group.imprints?.nodes
      ?.map((imprint) => imprint.typeOfWork?.name?.trim())
      .filter((name): name is string => Boolean(name)) ?? [];

  if (names.length === 0) return null;
  return [...new Set(names)].join(", ");
}

async function fetchOrderLineItemGroups(orderId: string, orderType: "QUOTE" | "INVOICE") {
  if (orderType === "QUOTE") {
    const res = await printavo.request<any>(LINE_ITEMS_QUOTE_QUERY, { id: orderId });
    return res.quote?.lineItemGroups?.nodes ?? [];
  }

  const res = await printavo.request<any>(LINE_ITEMS_INVOICE_QUERY, { id: orderId });
  return res.invoice?.lineItemGroups?.nodes ?? [];
}

async function main() {
  const startedAt = new Date();
  const dueBefore = fourWeeksFromNow();

  const orders = await prisma.order.findMany({
    where: {
      statusCategory: {
        in: ["ORDER_OPEN", "ORDER_PRODUCTION", "ORDER_ON_HOLD"],
      },
      customerDueAt: {
        gte: startedAt,
        lte: dueBefore,
      },
    },
    select: {
      id: true,
      orderType: true,
      customerDueAt: true,
    },
    orderBy: {
      customerDueAt: "asc",
    },
  });

  console.log(`Found ${orders.length} eligible orders due by ${dueBefore.toISOString()}.`);

  let ordersProcessed = 0;
  let lineItemsUpserted = 0;
  let ordersFailed = 0;

  for (const order of orders) {
    try {
      const groups = await fetchOrderLineItemGroups(order.id, order.orderType);
      let upsertedForOrder = 0;

      for (const group of groups as PrintavoLineItemGroupNode[]) {
        const typeOfWork = collectTypeOfWork(group);
        const lineItems = group.lineItems?.nodes ?? [];

        for (const item of lineItems) {
          if (!item?.id) continue;

          await prisma.lineItem.upsert({
            where: { id: item.id },
            update: {
              orderId: order.id,
              description: item.description ?? null,
              quantity: item.items ?? null,
              price: item.price ?? null,
              typeOfWork,
            },
            create: {
              id: item.id,
              orderId: order.id,
              description: item.description ?? null,
              quantity: item.items ?? null,
              price: item.price ?? null,
              typeOfWork,
            },
          });

          lineItemsUpserted++;
          upsertedForOrder++;
        }
      }

      ordersProcessed++;
      console.log(
        `[${ordersProcessed}/${orders.length}] Order ${order.id} (${order.orderType}) upserted ${upsertedForOrder} line items.`,
      );
    } catch (error) {
      ordersFailed++;
      console.error(`Failed processing order ${order.id}:`, error);
    }

    // Respect Printavo rate limit (10 req / 5 sec) with one request per order.
    await sleep(600);
  }

  await prisma.syncLog.create({
    data: {
      startedAt,
      finishedAt: new Date(),
      ordersSynced: ordersProcessed,
      ordersSkipped: ordersFailed,
      status: ordersFailed > 0 ? "PARTIAL" : "OK",
      errorMessage:
        ordersFailed > 0
          ? `Failed ${ordersFailed} of ${orders.length} eligible orders in line item backfill.`
          : null,
    },
  });

  console.log(
    `Done. Processed ${ordersProcessed}/${orders.length} orders, failed ${ordersFailed}, upserted ${lineItemsUpserted} line items.`,
  );
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
