type Bucket = { count: number; resetAt: number };

/**
 * Simple in-memory sliding-window rate limiter (per key, e.g. socket id or IP).
 */
export class RateLimiter {
    private buckets = new Map<string, Bucket>();

    tryConsume(key: string, limit: number, windowMs: number): boolean {
        const now = Date.now();
        const bucket = this.buckets.get(key);

        if (!bucket || now >= bucket.resetAt) {
            this.buckets.set(key, { count: 1, resetAt: now + windowMs });
            return true;
        }

        if (bucket.count >= limit) return false;

        bucket.count += 1;
        return true;
    }

    /** Penalize failed auth attempts more aggressively. */
    recordFailure(key: string, windowMs: number) {
        const now = Date.now();
        const bucket = this.buckets.get(key);
        if (!bucket || now >= bucket.resetAt) {
            this.buckets.set(key, { count: 3, resetAt: now + windowMs });
            return;
        }
        bucket.count += 2;
    }
}
