import { randomBytes } from "node:crypto";

/** Short, URL-safe, prefixed identifier (e.g. req_8f3k2…) for request/event ids. */
export function prefixedId(prefix: string, bytes = 12): string {
  return `${prefix}_${randomBytes(bytes).toString("base64url")}`;
}
