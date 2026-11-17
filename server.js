import { readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";

import { createApp } from "./src/app.js";

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "0.0.0.0";
const rateLimit = Number(process.env.RATE_LIMIT) || 120;
const trustProxy = process.env.TRUST_PROXY === "1";
const redirectPort = Number(process.env.HTTP_PORT) || 0;

const certPath = process.env.TLS_CERT;
const keyPath = process.env.TLS_KEY;
const tlsEnabled = Boolean(certPath && keyPath);

const app = createApp({ rateLimit, trustProxy, hsts: tlsEnabled });

const server = tlsEnabled
    ? createHttpsServer({ cert: readFileSync(certPath), key: readFileSync(keyPath) }, app)
    : createHttpServer(app);

server.listen(port, host, () => {
    const scheme = tlsEnabled ? "https" : "http";
    console.log(`Генератор паролей: ${scheme}://localhost:${port}`);
    console.log(`API: ${scheme}://localhost:${port}/api/v1`);
    console.log(`OpenAPI: ${scheme}://localhost:${port}/openapi.json`);
    if (!tlsEnabled) {
        console.log("HTTPS выключен: service worker и установка PWA требуют TLS_CERT и TLS_KEY");
    }
});

let redirectServer = null;
if (tlsEnabled && redirectPort > 0) {
    redirectServer = createHttpServer((req, res) => {
        const hostname = (req.headers.host || "").split(":")[0] || "localhost";
        const authority = port === 443 ? hostname : `${hostname}:${port}`;
        res.writeHead(301, {
            Location: `https://${authority}${req.url}`,
            "Cache-Control": "no-store",
        });
        res.end();
    });

    redirectServer.listen(redirectPort, host, () => {
        console.log(`HTTP :${redirectPort} → HTTPS :${port}`);
    });
}

const servers = [server, redirectServer].filter(Boolean);

function shutdown(signal) {
    console.log(`\n${signal}: останавливаю сервер`);
    let pending = servers.length;
    const done = () => {
        if (--pending <= 0) process.exit(0);
    };
    for (const item of servers) item.close(done);
    setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
