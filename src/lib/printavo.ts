import { GraphQLClient } from "graphql-request";

const endpoint = "https://www.printavo.com/api/v2";

export const printavo = new GraphQLClient(endpoint, {
  headers: {
    email: process.env.PRINTAVO_EMAIL!,
    token: process.env.PRINTAVO_TOKEN!,
  },
});