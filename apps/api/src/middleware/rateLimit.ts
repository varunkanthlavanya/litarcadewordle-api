import type { Request, Response, NextFunction } from "express";

interface Bucket {
  count: number;
  windowStartedAt: number;
}

export function createFixedWindowRateLimiter(params: {
  windowMs: number;
  maxAttempts: number;
  keyFn: (req: Request) => string;
  message: string;
}) {
  const buckets = new Map<string, Bucket>();

  return function rateLimiter(req: Request, res: Response, next: NextFunction): void {
    const key = params.keyFn(req);
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || now - bucket.windowStartedAt > params.windowMs) {
      buckets.set(key, { count: 1, windowStartedAt: now });
      next();
      return;
    }

    if (bucket.count >= params.maxAttempts) {
      res.status(429).json({ error: params.message });
      return;
    }

    bucket.count += 1;
    next();
  };
}
