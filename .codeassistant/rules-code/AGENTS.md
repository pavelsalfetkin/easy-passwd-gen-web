# Project Coding Rules (Non-Obvious Only)

- Express именно 4.x: синтаксис роутов и `app.use((err, req, res, next))` из 5.x несовместим; не обновлять мажор без переписывания обработчика ошибок.
- `shared/*.js` — изоморфные модули: никаких `node:crypto`, `node:fs`, `process`. Случайность приходит параметром `randomInt(maxExclusive)`.
- Новый API-роут = правка `openapi.json` + тест `tests/api.test.js` (он сверяет список путей со спекой). Без спеки роут считается незавершённым.
- Ошибки отдавать только через `sendProblem()`/`methodNotAllowed()` из `src/problem.js`; `res.status(400).json()` нарушит единый контракт `application/problem+json`.
- `api.all("/passwords")` обязан оставаться после GET/POST: он реализует 405 с `Allow`.
- `express.json` подключён только внутри API-роутера с лимитом 16 КБ; не переносить его на всё приложение.
- CSP без `'unsafe-inline'`: обработчики — в `public/app.js`, стили — в `public/styles.css`; инлайновые `onclick` и `style=""` не сработают.
- Пароли выводить через `textContent`/`createElement`, не через `innerHTML`; в `dataset` и логи пароли не писать.
- Новый статический файл требует записи в `APP_SHELL` в `public/sw.js` и инкремента `CACHE_VERSION`.
- UI и API используют одну валидацию из `shared/options.js`; не дублировать проверки диапазонов в `app.js` или на сервере.
