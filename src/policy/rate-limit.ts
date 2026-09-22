export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export class FixedWindowRateLimiter {
  constructor(private readonly db: D1Database) {}

  async consume(
    subject: string,
    limit: number,
    windowSeconds: number,
    now: number,
  ): Promise<RateLimitResult> {
    const windowStart = Math.floor(now / windowSeconds) * windowSeconds;
    const row = await this.db
      .prepare(
        `INSERT INTO rate_limits (subject, window_start, count) VALUES (?, ?, 1)
         ON CONFLICT(subject, window_start) DO UPDATE SET count = count + 1
         RETURNING count`,
      )
      .bind(subject, windowStart)
      .first<{ count: number }>();
    if (!row) throw new Error("Rate-limit update failed");
    return {
      allowed: row.count <= limit,
      remaining: Math.max(0, limit - row.count),
      resetAt: windowStart + windowSeconds,
    };
  }
}
