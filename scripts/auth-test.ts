import "dotenv/config";
import { printavo } from "../src/lib/printavo";
import { gql } from "graphql-request";

async function main() {
  console.log("Email:", process.env.PRINTAVO_EMAIL);
  console.log("Token starts with:", process.env.PRINTAVO_TOKEN?.slice(0, 6));
  console.log("Token length:", process.env.PRINTAVO_TOKEN?.length);

  // Test 1: account query (should always work if auth is valid)
  try {
    const res: any = await printavo.request(gql`
      query {
        account {
          id
          companyName
          companyEmail
        }
      }
    `);
    console.log("\n✅ account query succeeded:", res.account);
  } catch (e: any) {
    console.log("\n❌ account query failed:", e?.response?.errors ?? e.message);
  }

  // Test 2: invoices query (first 1 only)
  try {
    const res: any = await printavo.request(gql`
      query {
        invoices(first: 1) {
          nodes { id visualId }
        }
      }
    `);
    console.log("\n✅ invoices query succeeded:", res.invoices);
  } catch (e: any) {
    console.log("\n❌ invoices query failed:", e?.response?.errors ?? e.message);
  }
}

main();
