/**
 * Exponential backoff with "full jitter": delay = random(0, min(cap, base * 2^(attempt-1))).
 * Never exceeds the plan deadline.
 */
export function backoffDelayMs(attempt: number, opts: { baseMs: number; capMs?: number; random?: () => number }): number {
  const cap = opts.capMs ?? 5 * 60_000;
  const exp = Math.min(cap, opts.baseMs * 2 ** Math.max(0, attempt - 1));
  const r = (opts.random ?? Math.random)();
  return Math.max(opts.baseMs / 2, Math.round(exp * r));
}

export function nextAttemptAt(now: Date, attempt: number, opts: { baseMs: number; capMs?: number; deadline: Date; random?: () => number }): Date | null {
  const at = new Date(now.getTime() + backoffDelayMs(attempt, opts));
  return at > opts.deadline ? null : at;
}
