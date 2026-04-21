// src/app/api/webhooks/printavo/route.ts
//
// Printavo webhook handler with HMAC-SHA256 signature verification.
//
// Printavo signs every webhook request with your shared secret so you can
// verify "yes, this really came from Printavo" before acting on it.
// Without this check, anyone who knows the URL could POST fake events
// and corrupt your dashboard data.
 
import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { categorize } from "@/lib/status-map";
 
// -------- signature verification --------
 
function verifySignature(
  rawBody: string,
  signatureHeader: string | null
): boolean {
  const secret = process.env.PRINTAVO_WEBHOOK_SECRET;
 
  if (!secret) {
    // Defensive: if the secret isn't configured, fail closed rather than
    // accept anything. Better to break loudly than silently accept fakes.
    console.error(
      "[webhook] PRINTAVO_WEBHOOK_SECRET is not set — rejecting request"
    );
    return false;
  }
  if (!signatureHeader) return false;
 
  // Compute what the signature SHOULD be: HMAC-SHA256 of the raw body,
  // keyed with our shared secret, hex-encoded.
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");
 
  // Some providers prefix the header value with "sha256=" — strip it.
  const provided = signatureHeader.replace(/^sha256=/, "");
 
  // timingSafeEqual requires equal-length buffers, so guard first.
  if (expected.length !== provided.length) return false;
 
  return crypto.timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(provided, "hex")
  );
}
 
// -------- the handler --------
 
export async function POST(req: NextRequest) {
  // IMPORTANT: read as raw text, not JSON.
  // HMAC must be computed over the exact bytes Printavo sent. If we parse
  // to JSON and re-serialise, whitespace or key order could shift and
  // verification would fail.
  const rawBody = await req.text();
  const signature = req.headers.get("x-printavo-signature");
 
  if (!verifySignature(rawBody, signature)) {
    // 401 Unauthorized — Printavo won't retry auth failures, which is what
    // we want. A malformed-body scenario would still return 200 below.
    return NextResponse.json(
      { error: "invalid signature" },
      { status: 401 }
    );
  }
 
  // Only NOW — after we've confirmed the sender — do we parse the payload.
  let body: { event?: string; data?: { id?: string; status?: { id?: string; name?: string } } };
  try {
    body = JSON.parse(rawBody);
  } catch {
    // Malformed JSON — still return 200 so Printavo doesn't retry.
    return NextResponse.json({ ok: true });
  }
 
  const event = body.event;
  const data = body.data;
 
  if (!data?.id) return NextResponse.json({ ok: true });
 
  const category = categorize(data.status?.name ?? "");
 
  // Minimal update — just keep the cache warm. The cron job does deep syncs.
  await prisma.order.updateMany({
    where: { id: data.id },
    data: {
      statusId: data.status?.id ?? null,
      statusName: data.status?.name ?? null,
      statusCategory: category,
      lastSyncedAt: new Date(),
    },
  });
 
  await prisma.syncLog.create({
    data: {
      startedAt: new Date(),
      finishedAt: new Date(),
      ordersSynced: 1,
      status: "OK",
      errorMessage: event ? `webhook: ${event}` : null,
    },
  });
 
  return NextResponse.json({ ok: true });
}