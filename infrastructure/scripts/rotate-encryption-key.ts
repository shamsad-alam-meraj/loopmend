/**
 * Re-encrypts every integration secret from OLD_ENCRYPTION_KEY to NEW_ENCRYPTION_KEY.
 *
 *   npm run db:rotate-key:remote -- [--dry-run]
 *
 * Reads DATABASE_URL, OLD_ENCRYPTION_KEY and NEW_ENCRYPTION_KEY (e.g. from the
 * gitignored .env.supabase.local). Runs in one transaction; rows already
 * readable with the new key are skipped, so it is safe to re-run. After it
 * succeeds, set ENCRYPTION_KEY to the new key everywhere and redeploy.
 */
import postgres from "postgres";
import { decryptJson, encryptJson } from "@/lib/security/crypto";

const DRY = process.argv.includes("--dry-run");

function key(name: string) {
  const v = process.env[name]?.trim();
  if (!v || Buffer.from(v, "base64").length !== 32) throw new Error(`${name} must be a base64-encoded 32-byte key`);
  return v;
}

function withKey<T>(k: string, fn: () => T): T {
  const prev = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = k;
  try {
    return fn();
  } finally {
    process.env.ENCRYPTION_KEY = prev;
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const oldKey = key("OLD_ENCRYPTION_KEY");
  const newKey = key("NEW_ENCRYPTION_KEY");
  if (oldKey === newKey) throw new Error("OLD_ENCRYPTION_KEY and NEW_ENCRYPTION_KEY are identical");

  const sql = postgres(url, { max: 1, prepare: !/:6543\b/.test(url), onnotice: () => {} });
  const summary = { reencrypted: 0, alreadyNew: 0, unreadable: [] as string[] };
  try {
    await sql.begin(async (tx) => {
      const rows = await tx<{ id: string; organization_id: string; name: string; encrypted_config: string }[]>`
        select id, organization_id, name, encrypted_config from integrations for update`;
      for (const row of rows) {
        const aad = `integration:${row.organization_id}`;
        const readWith = (k: string) => {
          try {
            return withKey(k, () => decryptJson<Record<string, unknown>>(row.encrypted_config, aad));
          } catch {
            return null;
          }
        };
        if (readWith(newKey)) {
          summary.alreadyNew++;
          continue;
        }
        const secrets = readWith(oldKey);
        if (!secrets) {
          summary.unreadable.push(`${row.name} (${row.id})`);
          continue;
        }
        const sealed = withKey(newKey, () => encryptJson(secrets, aad));
        if (!DRY) await tx`update integrations set encrypted_config = ${sealed}, updated_at = now() where id = ${row.id}`;
        summary.reencrypted++;
      }
      if (summary.unreadable.length) throw new Error(`Readable with neither key: ${summary.unreadable.join(", ")} — nothing was changed`);
    });
  } finally {
    await sql.end();
  }
  console.log(`${DRY ? "[dry run] would re-encrypt" : "re-encrypted"} ${summary.reencrypted} integration(s); ${summary.alreadyNew} already on the new key`);
}

main().catch((e) => {
  console.error(`✗ ${e.message}`);
  process.exit(1);
});
