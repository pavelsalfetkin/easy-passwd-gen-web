import { sendProblem } from "./problem.js";

/**
 * Простой лимитер по IP в памяти процесса.
 * Достаточен для публичного API без внешних зависимостей; при горизонтальном
 * масштабировании его нужно заменить на общее хранилище.
 */
export function createRateLimiter({ limit = 120, windowMs = 60_000 } = {}) {
    const buckets = new Map();

    const timer = setInterval(() => {
        const now = Date.now();
        for (const [key, bucket] of buckets) {
            if (bucket.resetAt <= now) buckets.delete(key);
        }
    }, windowMs);
    if (typeof timer.unref === "function") timer.unref();

    return function rateLimit(req, res, next) {
        const key = req.ip || req.socket?.remoteAddress || "unknown";
        const now = Date.now();

        let bucket = buckets.get(key);
        if (!bucket || bucket.resetAt <= now) {
            bucket = { count: 0, resetAt: now + windowMs };
            buckets.set(key, bucket);
        }
        bucket.count += 1;

        const remaining = Math.max(0, limit - bucket.count);
        const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

        res.set("RateLimit-Limit", String(limit));
        res.set("RateLimit-Remaining", String(remaining));
        res.set("RateLimit-Reset", String(retryAfter));

        if (bucket.count > limit) {
            res.set("Retry-After", String(retryAfter));
            return sendProblem(
                req,
                res,
                429,
                "Слишком много запросов",
                `Лимит ${limit} запросов в минуту. Повторите через ${retryAfter} с.`,
            );
        }

        return next();
    };
}
