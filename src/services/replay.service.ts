import "server-only";
import { lt } from "drizzle-orm";
import { webhookNonces } from "@schema";
import { getDb } from "@/lib/db/client";

/** Records a nonce; returns false if it was already used (replay). */
export async function consumeNonce(nonce: string): Promise<boolean> {
  const db = await getDb();
  const inserted = await db.insert(webhookNonces).values({ nonce }).onConflictDoNothing().returning({ nonce: webhookNonces.nonce });
  // Opportunistic cleanup: nonces older than the signature window can never be valid again.
  if (Math.random() < 0.02) {
    await db.delete(webhookNonces).where(lt(webhookNonces.receivedAt, new Date(Date.now() - 24 * 3_600_000)));
  }
  return inserted.length === 1;
}
