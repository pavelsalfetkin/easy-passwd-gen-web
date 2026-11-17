/* Service worker: офлайн-оболочка приложения. */
const CACHE_VERSION = "v1";
const CACHE_NAME = `passwd-gen-${CACHE_VERSION}`;

const APP_SHELL = [
    "/",
    "/index.html",
    "/styles.css",
    "/app.js",
    "/rng-web.js",
    "/shared/generator.js",
    "/shared/options.js",
    "/manifest.webmanifest",
    "/docs",
    "/docs.html",
    "/docs.js",
    "/openapi.json",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/icons/icon-maskable-512.png",
    "/icons/apple-touch-icon-180.png",
    "/icons/favicon-32.png",
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches
            .open(CACHE_NAME)
            .then((cache) => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
            .then(() => self.clients.claim()),
    );
});

self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET") return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    // API не кешируем: пароли не должны попадать в хранилище браузера.
    if (url.pathname.startsWith("/api/")) return;

    if (request.mode === "navigate") {
        event.respondWith(fetch(request).catch(() => caches.match("/index.html")));
        return;
    }

    event.respondWith(
        caches.match(request).then((cached) => {
            if (cached) return cached;
            return fetch(request).then((response) => {
                if (response.ok && response.type === "basic") {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                }
                return response;
            });
        }),
    );
});
