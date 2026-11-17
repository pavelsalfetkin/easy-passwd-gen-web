# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Запуск и проверки
- Node >= 18.11, ESM (`"type": "module"`). Единственная зависимость — `express@4`; не добавлять вторую без причины.
- `npm test` запускает фиксированный список файлов (`node --test tests/password.test.js tests/api.test.js`) — новый тестовый файл нужно дописать в скрипт.
- PNG-иконки PWA не редактировать руками: `npm run icons` пересобирает их на встроенном `zlib`.

## Изоморфный код
- [`shared/generator.js`](shared/generator.js:1) и [`shared/options.js`](shared/options.js:1) импортируются и сервером, и браузером. Node-API (`node:crypto`, `fs`) там запрещены: случайность передаётся функцией `randomInt`.
- Одна и та же валидация используется API и UI, поэтому лимиты и тексты ошибок не могут разойтись.
- UI генерирует пароли локально и не вызывает API — это осознанное решение (офлайн-режим и пароли не покидают устройство), а не забытая интеграция.

## Контракт и ловушки
- [`openapi.json`](openapi.json:1) — источник истины для API; тест сверяет набор путей в спеке, поэтому новый роут требует правки спеки.
- Неизвестные query/body-параметры отклоняются с `400`, а не игнорируются — это требование к API для агентов.
- Ошибки всегда `application/problem+json` с массивом `errors`; успешная генерация — `Cache-Control: no-store`.
- `api.all("/passwords")` в [`src/app.js`](src/app.js:1) должен идти после GET/POST: он даёт `405` с `Allow`. Выше роутов его не переносить.
- CSP без `'unsafe-inline'`: обработчики только в [`public/app.js`](public/app.js:1), стили только в [`public/styles.css`](public/styles.css:1). Inline-стили и скрипты не добавятся.
- Service worker и установка PWA требуют secure context (`localhost` или HTTPS); на `http://192.168.x.x` их не будет, при этом `crypto.getRandomValues` работает.
- `/api/` в [`public/sw.js`](public/sw.js:1) намеренно network-only: пароли не должны попадать в Cache Storage.
- При добавлении статического файла обновить `APP_SHELL` в `sw.js` и поднять `CACHE_VERSION`, иначе старый кеш продолжит отдавать прежнюю оболочку.
- Пароли и тела запросов не логировать: в коде нет и не должно быть логов с содержимым `passwords`.
