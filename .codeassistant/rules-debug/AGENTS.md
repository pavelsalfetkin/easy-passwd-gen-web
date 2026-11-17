# Project Debug Rules (Non-Obvious Only)

- Один тестовый файл запускается как `node --test tests/password.test.js`; `npm test` жёстко перечисляет файлы, поэтому новый тест без правки скрипта молча не выполнится.
- Кнопка установки PWA не появляется на `http://192.168.x.x` — это не баг: нужен `localhost` или HTTPS. Ошибку регистрации SW видно в DevTools → Application → Service Workers.
- После правок UI видна старая версия из-за precache: поднять `CACHE_VERSION` в `public/sw.js` либо включить «Update on reload» / очистить Cache Storage.
- Ответ `400` с `errors[].field` — штатная валидация, а не падение: неизвестные параметры специально отклоняются.
- `429` при ручных прогонах — это in-memory лимитер на IP; для отладки поднять `RATE_LIMIT` или создать приложение через `createApp({ rateLimit })` в тесте.
- `415` на POST означает отсутствие `Content-Type: application/json`; `400` «Некорректный JSON» — сломанное тело, а не ошибка полей.
- Тело больше 16 КБ даёт `413` от `express.json`, до кода роута запрос не доходит.
- Логов с телами запросов и паролями нет намеренно: отлаживать через `curl -i` и `tests/api.test.js`, а не через добавление логов с `passwords`.
