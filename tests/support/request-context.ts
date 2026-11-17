import { vi } from "vitest";

/**
 * Minimal stand-in for next/headers so Route Handlers / auth helpers can run in
 * Vitest. Tests set cookies/headers on `requestContext` before each call.
 */
export const requestContext = {
  cookies: new Map<string, string>(),
  headers: new Headers(),
  reset() {
    this.cookies.clear();
    this.headers = new Headers();
  },
};

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (requestContext.cookies.has(name) ? { name, value: requestContext.cookies.get(name)! } : undefined),
    getAll: () => [...requestContext.cookies.entries()].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void requestContext.cookies.set(name, value),
    delete: (name: string) => void requestContext.cookies.delete(name),
  }),
  headers: async () => requestContext.headers,
}));
