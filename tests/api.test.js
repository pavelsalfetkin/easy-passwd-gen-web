import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { createApp } from "../src/app.js";

let server;
let baseUrl;

before(async () => {
    const app = createApp({ rateLimit: 1000 });
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    await new Promise((resolve) => server.close(resolve));
});

test("GET /api/v1/passwords возвращает пароли с категориями", async () => {
    const response = await fetch(`${baseUrl}/api/v1/passwords`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /application\/json/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("access-control-allow-origin"), "*");

    const body = await response.json();
    assert.equal(body.passwords.length, 4);
    for (const password of body.passwords) {
        assert.equal(password.length, 8);
        assert.match(password, /[a-zA-Z]/);
        assert.match(password, /[0-9]/);
        assert.match(password, /[!@#$%^&*_\-+=]/);
    }
    assert.equal(body.options.length, 8);
});

test("GET /api/v1/passwords учитывает query-параметры", async () => {
    const response = await fetch(`${baseUrl}/api/v1/passwords?length=16&count=2&letters=false&digits=true&symbols=true`);
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.passwords.length, 2);
    for (const password of body.passwords) {
        assert.equal(password.length, 16);
        assert.doesNotMatch(password, /[a-zA-Z]/);
    }
    assert.deepEqual(body.options, {
        length: 16,
        letters: false,
        digits: true,
        symbols: true,
        count: 2,
    });
});

test("POST /api/v1/passwords принимает JSON-тело", async () => {
    const response = await fetch(`${baseUrl}/api/v1/passwords`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ length: 12, symbols: false, count: 3 }),
    });
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.passwords.length, 3);
    for (const password of body.passwords) {
        assert.equal(password.length, 12);
        assert.doesNotMatch(password, /[!@#$%^&*_\-+=]/);
    }
});

test("некорректные параметры дают problem+json с errors", async () => {
    const response = await fetch(`${baseUrl}/api/v1/passwords?length=3`);
    assert.equal(response.status, 400);
    assert.match(response.headers.get("content-type"), /application\/problem\+json/);

    const body = await response.json();
    assert.equal(body.status, 400);
    assert.ok(Array.isArray(body.errors));
    assert.equal(body.errors[0].field, "length");
});

test("неизвестный параметр отклоняется", async () => {
    const response = await fetch(`${baseUrl}/api/v1/passwords?size=8`);
    assert.equal(response.status, 400);

    const body = await response.json();
    assert.equal(body.errors[0].field, "size");
});

test("POST без application/json даёт 415", async () => {
    const response = await fetch(`${baseUrl}/api/v1/passwords`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "length=8",
    });
    assert.equal(response.status, 415);
});

test("сломанный JSON даёт 400", async () => {
    const response = await fetch(`${baseUrl}/api/v1/passwords`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
    });
    assert.equal(response.status, 400);
    assert.match(response.headers.get("content-type"), /application\/problem\+json/);
});

test("неподдерживаемый метод даёт 405 с Allow", async () => {
    const response = await fetch(`${baseUrl}/api/v1/passwords`, { method: "PUT" });
    assert.equal(response.status, 405);
    const allow = response.headers.get("allow");
    assert.match(allow, /GET/);
    assert.match(allow, /POST/);
});

test("OPTIONS отвечает 204 и CORS-заголовками", async () => {
    const response = await fetch(`${baseUrl}/api/v1/passwords`, { method: "OPTIONS" });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.match(response.headers.get("access-control-allow-methods"), /GET/);
});

test("неизвестный эндпоинт API даёт 404 problem+json", async () => {
    const response = await fetch(`${baseUrl}/api/v1/unknown`);
    assert.equal(response.status, 404);
    assert.match(response.headers.get("content-type"), /application\/problem\+json/);
});

test("справочник /options описывает лимиты и категории", async () => {
    const response = await fetch(`${baseUrl}/api/v1/options`);
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.deepEqual(body.limits.length, { min: 4, max: 64 });
    assert.deepEqual(body.limits.count, { min: 1, max: 10 });
    assert.equal(body.categories.symbols.characters, "!@#$%^&*_-+=");
});

test("health отдаёт статус ok", async () => {
    const response = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.status, "ok");
    assert.equal(typeof body.version, "string");
});

test("главная страница и service worker отдаются статикой", async () => {
    const page = await fetch(`${baseUrl}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type"), /text\/html/);
    assert.match(await page.text(), /Генератор паролей/);

    const sw = await fetch(`${baseUrl}/sw.js`);
    assert.equal(sw.status, 200);
    assert.match(sw.headers.get("content-type"), /javascript/);
});

test("path traversal не отдаёт файлы проекта", async () => {
    const response = await fetch(`${baseUrl}/%2e%2e/package.json`);
    assert.notEqual(response.status, 200);
});

test("rate limit возвращает 429 и Retry-After", async () => {
    const limitedApp = createApp({ rateLimit: 2, rateWindowMs: 60_000 });
    const limitedServer = limitedApp.listen(0, "127.0.0.1");
    await new Promise((resolve) => limitedServer.once("listening", resolve));
    const url = `http://127.0.0.1:${limitedServer.address().port}/api/v1/health`;

    try {
        assert.equal((await fetch(url)).status, 200);
        assert.equal((await fetch(url)).status, 200);

        const response = await fetch(url);
        assert.equal(response.status, 429);
        assert.ok(Number(response.headers.get("retry-after")) >= 1);
        assert.match(response.headers.get("content-type"), /application\/problem\+json/);
    } finally {
        await new Promise((resolve) => limitedServer.close(resolve));
    }
});

test("оболочка service worker ссылается на существующие файлы", () => {
    const sw = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
    const shellMatch = sw.match(/const APP_SHELL = \[([\s\S]*?)\];/);
    assert.ok(shellMatch, "в sw.js не найден APP_SHELL");

    const assets = [...shellMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    assert.ok(assets.length > 0);

    for (const asset of assets) {
        let relative;
        if (asset === "/") relative = "../public/index.html";
        else if (asset === "/openapi.json") relative = "../openapi.json";
        else if (asset.startsWith("/shared/")) relative = `..${asset}`;
        else {
            const withoutSlash = asset.slice(1);
            relative = `../public/${withoutSlash.includes(".") ? withoutSlash : `${withoutSlash}.html`}`;
        }
        assert.ok(existsSync(new URL(relative, import.meta.url)), `в APP_SHELL указан отсутствующий файл: ${asset}`);
    }
});

test("index.html содержит элементы, которые ищет app.js", () => {
    const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
    const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

    const ids = [...app.matchAll(/querySelector\("#([a-z0-9-]+)"\)/gi)].map((match) => match[1]);
    assert.ok(ids.length > 0);
    for (const id of ids) {
        assert.match(html, new RegExp(`id="${id}"`), `нет элемента #${id}`);
    }

    for (const name of ["letters", "digits", "symbols"]) {
        assert.match(html, new RegExp(`data-category="${name}"`), `нет переключателя ${name}`);
    }
    for (const length of [4, 6, 8, 10, 12, 14, 16]) {
        assert.match(html, new RegExp(`data-length="${length}"`), `нет кнопки длины ${length}`);
    }
});

test("спецификация OpenAPI совпадает с реализованными путями", () => {
    const spec = JSON.parse(readFileSync(new URL("../openapi.json", import.meta.url), "utf8"));

    assert.equal(spec.openapi, "3.1.0");
    assert.ok(spec.info.title);
    assert.ok(spec["x-ai-usage"]);

    const documented = Object.keys(spec.paths)
        .filter((route) => route.startsWith("/api/v1"))
        .sort();
    assert.deepEqual(documented, [
        "/api/v1",
        "/api/v1/health",
        "/api/v1/options",
        "/api/v1/passwords",
    ]);

    for (const [route, methods] of Object.entries(spec.paths)) {
        for (const [method, operation] of Object.entries(methods)) {
            if (!["get", "post"].includes(method)) continue;
            assert.ok(operation.operationId, `${method.toUpperCase()} ${route} без operationId`);
            assert.ok(operation.responses, `${method.toUpperCase()} ${route} без responses`);
        }
    }

    assert.ok(spec.paths["/api/v1/passwords"].get);
    assert.ok(spec.paths["/api/v1/passwords"].post);
});
