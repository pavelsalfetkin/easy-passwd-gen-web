import { createApp } from "./src/app.js";

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "0.0.0.0";
const rateLimit = Number(process.env.RATE_LIMIT) || 120;
const trustProxy = process.env.TRUST_PROXY === "1";

const app = createApp({ rateLimit, trustProxy });

const server = app.listen(port, host, () => {
    console.log(`Генератор паролей: http://localhost:${port}`);
    console.log(`API: http://localhost:${port}/api/v1`);
    console.log(`OpenAPI: http://localhost:${port}/openapi.json`);
});

function shutdown(signal) {
    console.log(`\n${signal}: останавливаю сервер`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
