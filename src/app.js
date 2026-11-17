import express from "express";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
    ALPHABETS,
    DEFAULT_OPTIONS,
    LIMITS,
    generatePasswords,
} from "../shared/generator.js";
import { parseOptions } from "../shared/options.js";
import { nodeRandomInt } from "./rng-node.js";
import { methodNotAllowed, sendProblem } from "./problem.js";
import { createRateLimiter } from "./rate-limit.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(currentDir, "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const SHARED_DIR = path.join(ROOT_DIR, "shared");
const SPEC_PATH = path.join(ROOT_DIR, "openapi.json");
const PACKAGE_PATH = path.join(ROOT_DIR, "package.json");

const packageInfo = JSON.parse(readFileSync(PACKAGE_PATH, "utf8"));
const VERSION = packageInfo.version;

let cachedSpec = null;
function readSpec() {
    if (!cachedSpec) {
        cachedSpec = JSON.parse(readFileSync(SPEC_PATH, "utf8"));
    }
    return cachedSpec;
}

const CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "style-src 'self'",
    "script-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
].join("; ");

function securityHeaders(req, res, next) {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "no-referrer");
    res.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    res.set("Permissions-Policy", "geolocation=(), camera=(), microphone=()");
    next();
}

function corsHeaders(req, res, next) {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Access-Control-Max-Age", "86400");
    if (req.method === "OPTIONS") {
        res.status(204).end();
        return;
    }
    next();
}

function staticHeaders(res, filePath) {
    if (/\.(png|ico|svg)$/i.test(filePath)) {
        res.setHeader("Cache-Control", "public, max-age=86400");
    } else {
        res.setHeader("Cache-Control", "no-cache");
    }
}

function buildDiscovery() {
    return {
        name: "Password Generator API",
        version: VERSION,
        description: "Генерация криптостойких паролей. Для агента достаточно GET-запроса без тела и авторизации.",
        openapi: "/openapi.json",
        docs: "/docs",
        endpoints: [
            {
                method: "GET",
                path: "/api/v1/passwords",
                description: "Сгенерировать пароли по query-параметрам",
            },
            {
                method: "POST",
                path: "/api/v1/passwords",
                description: "Сгенерировать пароли по JSON-телу",
            },
            {
                method: "GET",
                path: "/api/v1/options",
                description: "Дефолты, лимиты и доступные категории символов",
            },
            {
                method: "GET",
                path: "/api/v1/health",
                description: "Проверка доступности сервиса",
            },
        ],
        example: "/api/v1/passwords?length=16&letters=true&digits=true&symbols=true&count=4",
        notes: [
            "Пароли не сохраняются и не логируются.",
            "Ответы API отдаются с Cache-Control: no-store.",
            "Ошибки приходят в формате application/problem+json.",
        ],
    };
}

function buildOptionsInfo() {
    return {
        defaults: DEFAULT_OPTIONS,
        limits: {
            length: { min: LIMITS.length.min, max: LIMITS.length.max },
            count: { min: LIMITS.count.min, max: LIMITS.count.max },
        },
        categories: {
            letters: {
                description: "Латинские буквы в обоих регистрах",
                size: ALPHABETS.letters.length,
            },
            digits: {
                description: "Цифры 0-9",
                size: ALPHABETS.digits.length,
            },
            symbols: {
                description: "Спецсимволы",
                size: ALPHABETS.symbols.length,
                characters: ALPHABETS.symbols,
            },
        },
        example: "/api/v1/passwords?length=16&count=4",
    };
}

function respondWithPasswords(req, res, raw) {
    const { options, errors } = parseOptions(raw);
    if (errors.length) {
        return sendProblem(
            req,
            res,
            400,
            "Некорректные параметры",
            "Проверьте значения параметров запроса",
            { errors },
        );
    }

    const passwords = generatePasswords(options, nodeRandomInt);
    return res
        .set("Cache-Control", "no-store")
        .set("Pragma", "no-cache")
        .json({
            passwords,
            options,
            generatedAt: new Date().toISOString(),
        });
}

export function createApp({ rateLimit = 120, rateWindowMs = 60_000, trustProxy = false } = {}) {
    const app = express();
    app.disable("x-powered-by");
    app.set("trust proxy", trustProxy === true);

    app.use(securityHeaders);

    const api = express.Router();
    api.use(corsHeaders);
    api.use(createRateLimiter({ limit: rateLimit, windowMs: rateWindowMs }));
    api.use(express.json({ limit: "16kb", type: ["application/json", "application/*+json"] }));

    api.get("/", (req, res) => {
        res.set("Cache-Control", "no-store").json(buildDiscovery());
    });

    api.get("/health", (req, res) => {
        res.set("Cache-Control", "no-store").json({
            status: "ok",
            version: VERSION,
            uptimeSeconds: Math.round(process.uptime()),
            time: new Date().toISOString(),
        });
    });

    api.get("/options", (req, res) => {
        res.set("Cache-Control", "no-store").json(buildOptionsInfo());
    });

    api.get("/passwords", (req, res) => respondWithPasswords(req, res, req.query));

    api.post("/passwords", (req, res) => {
        if (!req.is("application/json")) {
            return sendProblem(
                req,
                res,
                415,
                "Неподдерживаемый тип данных",
                "Передайте тело в формате application/json",
            );
        }

        const body = req.body;
        if (body === undefined || body === null) {
            return sendProblem(req, res, 400, "Пустое тело", "Передайте JSON-объект с параметрами");
        }
        if (typeof body !== "object" || Array.isArray(body)) {
            return sendProblem(req, res, 400, "Некорректное тело", "Ожидается JSON-объект с параметрами");
        }

        return respondWithPasswords(req, res, body);
    });

    api.all("/passwords", (req, res) => methodNotAllowed(req, res, ["GET", "POST", "OPTIONS"]));

    api.use((req, res) => {
        sendProblem(
            req,
            res,
            404,
            "Эндпоинт не найден",
            `Маршрут ${req.method} ${req.originalUrl.split("?")[0]} не существует. Список эндпоинтов: /api/v1`,
        );
    });

    app.use("/api/v1", api);

    app.get("/openapi.json", corsHeaders, (req, res) => {
        res.set("Cache-Control", "public, max-age=300").json(readSpec());
    });

    app.use("/shared", express.static(SHARED_DIR, { index: false, setHeaders: staticHeaders }));
    app.use(express.static(PUBLIC_DIR, { index: "index.html", extensions: ["html"], setHeaders: staticHeaders }));

    app.use((req, res) => {
        if (req.path.startsWith("/api/")) {
            return sendProblem(req, res, 404, "Эндпоинт не найден", "Проверьте путь запроса");
        }
        return res
            .status(404)
            .type("html")
            .send(
                '<!doctype html><html lang="ru"><head><meta charset="utf-8">' +
                    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
                    '<link rel="stylesheet" href="/styles.css">' +
                    "<title>Страница не найдена</title></head>" +
                    '<body><main class="app"><h1>404</h1>' +
                    '<p>Страница не найдена.</p><p><a href="/">На главную</a></p></main></body></html>',
            );
    });

    app.use((err, req, res, next) => {
        if (res.headersSent) return next(err);

        if (err.type === "entity.too.large") {
            return sendProblem(req, res, 413, "Слишком большое тело", "Максимальный размер тела — 16 КБ");
        }
        if (err.type === "entity.parse.failed" || err instanceof SyntaxError) {
            return sendProblem(req, res, 400, "Некорректный JSON", "Тело запроса не является валидным JSON");
        }
        if (err.status === 404) {
            return sendProblem(req, res, 404, "Не найдено", "Запрошенный ресурс отсутствует");
        }

        console.error("[server]", err.message);
        return sendProblem(req, res, 500, "Внутренняя ошибка", "Не удалось обработать запрос");
    });

    return app;
}
