export type Category =
  | "QUOTE_ACTIVE"
  | "QUOTE_WON"
  | "QUOTE_LOST"
  | "ORDER_OPEN"
  | "ORDER_PRODUCTION"
  | "ORDER_ON_HOLD"
  | "ORDER_COMPLETE"
  | "EXCLUDE";

export const STATUS_MAP: Record<string, Category> = {
  // Quote - Active
  "Quote": "QUOTE_ACTIVE",
  "FH - CREATE PROOF": "QUOTE_ACTIVE",
  "FH - PROOF TO CUSTOMER": "QUOTE_ACTIVE",
  "Quote Approval Sent": "QUOTE_ACTIVE",
  "Uniform Approval Sent": "QUOTE_ACTIVE",
  "Quote Declined": "QUOTE_ACTIVE",
  "GXS - CREATE PROOF 🚀": "QUOTE_ACTIVE",
  "GXS - PROOF READY 🚀✔": "QUOTE_ACTIVE",

  // Quote - Won
  "Quote Approved": "QUOTE_WON",

  // Quote - Lost
  "Archived Quote": "QUOTE_LOST",

  // Order - Open
  "Art Approval Sent": "ORDER_OPEN",
  "Art Approved": "ORDER_OPEN",

  // Order - Production
  "Ready for Production": "ORDER_PRODUCTION",
  "Ready for Production Paid in Shopify": "ORDER_PRODUCTION",
  "In Production": "ORDER_PRODUCTION",
  "Completed - Ready to Package": "ORDER_PRODUCTION",
  "GXS - ORDER IN PROGRESS 🛠": "ORDER_PRODUCTION",
  "GXS - REVISION NEEDED 🛎": "ORDER_PRODUCTION",
  "GXS - RUSH ORDER 🚨": "ORDER_PRODUCTION",
  "GXS - CREATE VECTOR / CUSTOM ART 🎨": "ORDER_PRODUCTION",
  "GXS - VECTOR / CUSTOM ART READY 🎨✔": "ORDER_PRODUCTION",
  "GXS - CREATE DIGITIZING 🧵": "ORDER_PRODUCTION",
  "GXS - DIGITIZING READY 🧵✔": "ORDER_PRODUCTION",
  "GXS - GANG SHEET NEEDED 🖨": "ORDER_PRODUCTION",
  "GXS - GANG SHEET READY 🖨✔": "ORDER_PRODUCTION",
  "GXS - ON HOLD/NEED MORE INFORMATION ❗": "ORDER_PRODUCTION",

  // Order - On Hold
  "Order on Hold (Issue)": "ORDER_ON_HOLD",

  // Order - Complete
  "Order Ready for Pickup": "ORDER_COMPLETE",
  "Order Shipped": "ORDER_COMPLETE",
  "Order Complete - In House Retail": "ORDER_COMPLETE",
  "Feedback Request": "ORDER_COMPLETE",
  "Need it Again?": "ORDER_COMPLETE",
  "Order Picked Up - COMPLETE/CLOSED": "ORDER_COMPLETE",
  "Order Picked Up / Paid In Quickbooks - COMPLETE/CLOSED": "ORDER_COMPLETE",

  // Excluded
  "Complete - Add to Shopify": "EXCLUDE",
};

export const OPEN_PIPELINE_CATEGORIES: Category[] = [
  "ORDER_OPEN",
  "ORDER_PRODUCTION",
  "ORDER_ON_HOLD",
];

export function categorize(status: string): Category {
  return STATUS_MAP[status] ?? "EXCLUDE";
}