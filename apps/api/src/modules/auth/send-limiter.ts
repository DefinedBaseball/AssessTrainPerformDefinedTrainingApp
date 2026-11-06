/**
 * Per-address cap on emails anyone can trigger without signing in (the
 * "Forgot password?" link). The route is already rate-limited per visitor,
 * but that does nothing for one ADDRESS asked about from many places -- and
 * every send spends the academy's daily email quota (Resend's free plan is
 * 100 a day), so someone could otherwise stop real invites and resets going
 * out. In memory, like the login lockout: a restart clears it, which only
 * ever errs toward sending.
 */
export class SendLimiter {
  private readonly sent = new Map<string, number[]>();

  constructor(
    /** Shortest gap between two sends to one address. */
    private readonly minGapMs: number,
    /** Most sends to one address in any rolling 24 hours. */
    private readonly maxPerDay: number,
  ) {}

  private static readonly DAY_MS = 24 * 60 * 60 * 1000;

  /** True (and the send is recorded) when `key` may be sent to now. */
  allow(key: string, now = Date.now()): boolean {
    if (!key) return false;
    const recent = (this.sent.get(key) ?? []).filter((t) => now - t < SendLimiter.DAY_MS);
    const last = recent[recent.length - 1];
    if (recent.length >= this.maxPerDay || (last !== undefined && now - last < this.minGapMs)) {
      this.sent.set(key, recent);
      return false;
    }
    recent.push(now);
    this.sent.set(key, recent);
    // Keep the map from growing without bound: drop addresses idle a day.
    if (this.sent.size > 5000) {
      for (const [k, times] of this.sent) {
        if (!times.length || now - times[times.length - 1] >= SendLimiter.DAY_MS) this.sent.delete(k);
      }
    }
    return true;
  }
}
