/**
 * Ошибки API в формате application/problem+json (RFC 9457).
 * Один формат для всех статусов, чтобы клиенты и агенты разбирали их одинаково.
 */

export function sendProblem(req, res, status, title, detail, extra = {}) {
    const body = {
        type: "about:blank",
        title,
        status,
        detail,
        instance: req.originalUrl.split("?")[0],
        ...extra,
    };

    res.status(status)
        .set("Content-Type", "application/problem+json; charset=utf-8")
        .set("Cache-Control", "no-store")
        .send(JSON.stringify(body));
}

export function methodNotAllowed(req, res, allowed) {
    res.set("Allow", allowed.join(", "));
    sendProblem(
        req,
        res,
        405,
        "Метод не поддерживается",
        `Для ${req.originalUrl.split("?")[0]} доступны методы: ${allowed.join(", ")}`,
    );
}
