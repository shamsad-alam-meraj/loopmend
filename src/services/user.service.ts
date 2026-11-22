import "server-only";
import { eq, sql } from "drizzle-orm";
import { profiles } from "@schema";
import { getDb } from "@/lib/db/client";
import { hashPassword, verifyPassword } from "@/lib/security/password";
import { AppError } from "@/lib/utils/errors";

export type SessionUser = { id: string; email: string; fullName: string | null };

const toUser = (p: typeof profiles.$inferSelect): SessionUser => ({ id: p.id, email: p.email, fullName: p.fullName });

/** Local auth: returns the user only if the token's session version is still current. */
export async function findUserForSession(id: string, version: number): Promise<SessionUser | null> {
  const db = await getDb();
  const [p] = await db.select().from(profiles).where(eq(profiles.id, id));
  return p && p.sessionVersion === version ? toUser(p) : null;
}

export async function currentSessionVersion(id: string): Promise<number> {
  const db = await getDb();
  const [p] = await db.select({ v: profiles.sessionVersion }).from(profiles).where(eq(profiles.id, id));
  return p?.v ?? 0;
}

/** Revokes all local sessions for a user (sign out everywhere). */
export async function revokeSessions(id: string) {
  const db = await getDb();
  await db.update(profiles).set({ sessionVersion: sql`${profiles.sessionVersion} + 1` }).where(eq(profiles.id, id));
}

export async function findUserById(id: string): Promise<SessionUser | null> {
  const db = await getDb();
  const [p] = await db.select().from(profiles).where(eq(profiles.id, id));
  return p ? toUser(p) : null;
}

/** Local auth: create a user with a scrypt password hash. */
export async function createLocalUser(email: string, password: string, fullName?: string): Promise<SessionUser> {
  const normalized = email.trim().toLowerCase();
  const db = await getDb();
  const [existing] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.email, normalized));
  if (existing) throw new AppError("CONFLICT", "An account with this email already exists");
  const [p] = await db
    .insert(profiles)
    .values({ email: normalized, fullName: fullName?.trim() || null, passwordHash: await hashPassword(password) })
    .returning();
  return toUser(p);
}

/** Local auth: verify credentials. Uses a dummy hash on unknown emails to keep timing uniform. */
export async function verifyLocalCredentials(email: string, password: string): Promise<SessionUser | null> {
  const db = await getDb();
  const [p] = await db.select().from(profiles).where(eq(profiles.email, email.trim().toLowerCase()));
  const ok = await verifyPassword(password, p?.passwordHash ?? "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  return p && ok ? toUser(p) : null;
}

export async function findUserByEmail(email: string): Promise<SessionUser | null> {
  const db = await getDb();
  const [p] = await db.select().from(profiles).where(eq(profiles.email, email.trim().toLowerCase()));
  return p ? toUser(p) : null;
}

/** Supabase auth: mirror auth.users into profiles (id = auth uid). */
export async function ensureProfile(id: string, email: string, fullName?: string | null): Promise<SessionUser> {
  const db = await getDb();
  const [p] = await db
    .insert(profiles)
    .values({ id, email: email.toLowerCase(), fullName: fullName ?? null })
    .onConflictDoUpdate({ target: profiles.id, set: { email: email.toLowerCase() } })
    .returning();
  return toUser(p);
}
