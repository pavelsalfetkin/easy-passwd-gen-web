# Деплой на Debian 13: только Node.js + PM2 (без Apache)

Всё обслуживает один процесс: [`server.js`](server.js:1) под управлением PM2 слушает
`0.0.0.0:443` по HTTPS, при желании — ещё и `:80` для редиректа на HTTPS.

```
Клиент → Node.js :443 (TLS, HSTS) под PM2
              ↳ :80 → 301 https://...   (опционально, HTTP_PORT=80)
```

## Что меняется по сравнению с вариантом через Apache

| | Node + PM2 | Apache + Node |
|---|---|---|
| TLS | сам Node (`node:https`), сертификаты через `certbot --standalone` | Apache + `certbot --apache` |
| HSTS | приложение включает автоматически при наличии TLS | заголовок в vhost |
| HTTP → HTTPS | отдельный слушатель на `HTTP_PORT` | `Redirect` в vhost |
| HTTP/2 | нет (нужен `node:http2`, в проекте не реализован) | есть |
| gzip/brotli | нет | `mod_deflate` |
| Конфигурация | один `ecosystem.config.cjs` | vhost + PM2 |
| Привилегированные порты | `setcap` на бинарник `node` | Apache работает от root |

Для генератора паролей потери HTTP/2 и gzip несущественны: статика маленькая, API отдаёт
JSON на пару килобайт. Если позже понадобится HTTP/2 или сжатие — верните прокси
(Caddy/nginx/Apache) или поставьте Cloudflare перед сервером.

---

## 0. Что понадобится

- Debian 13 (trixie), root или sudo.
- Домен с A-записью на IP сервера (для сертификата).
- Node.js >= 18.11 — в Debian 13 в репозитории уже есть Node 20.

---

## 1. Установка пакетов

```bash
sudo apt update
sudo apt install -y nodejs npm certbot rsync

node -v    # ожидается v20.x, главное — >= 18.11
npm -v
```

Если Node старее 18.11 — LTS из NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

PM2 ставится глобально, от root (чтобы бинарник попал в системный PATH):

```bash
sudo npm install -g pm2
pm2 -v
```

Apache не нужен, порты 80/443 будут заняты самим Node.

---

## 2. Пользователь и каталоги

```bash
sudo useradd -r -m -d /var/lib/passwdgen -s /usr/sbin/nologin passwdgen
sudo mkdir -p /opt/easy-passwd-gen-web
sudo chown -R passwdgen:passwdgen /opt/easy-passwd-gen-web
```

Домашний каталог `/var/lib/passwdgen` нужен PM2: он хранит состояние в `~/.pm2`.
Там же будем держать сертификаты — **вне** каталога приложения, иначе `rsync --delete`
при обновлении их снесёт.

---

## 3. Копирование проекта

С локальной машины (из корня репозитория):

```bash
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .codeassistant \
  ./ user@server:/tmp/easy-passwd-gen-web/
```

На сервере:

```bash
sudo rsync -a --delete /tmp/easy-passwd-gen-web/ /opt/easy-passwd-gen-web/
sudo chown -R passwdgen:passwdgen /opt/easy-passwd-gen-web
cd /opt/easy-passwd-gen-web
sudo -u passwdgen npm ci --omit=dev
sudo -u passwdgen npm test
```

`npm test` прогоняйте перед каждым запуском: тест сверяет набор путей API со спекой
[`openapi.json`](openapi.json:1) и поймает рассинхрон роутов и контракта.

---

## 4. Права на порты 80/443

Порты ниже 1024 требуют привилегий. Запускать Node от root нельзя, поэтому выдаём
бинарнику `node` capability `cap_net_bind_service`:

```bash
sudo setcap 'cap_net_bind_service=+ep' "$(command -v node)"
getcap "$(command -v node)"      # ожидается: ... cap_net_bind_service=ep
```

Что важно знать:

- capability привязана к файлу `node`, то есть действует для **всех** Node-процессов на хосте;
- после обновления пакета `nodejs` (`apt upgrade`) её нужно выставить заново;
- если такой подход не устраивает, оставьте `PORT=8443` и заверните трафик через
  Cloudflare Tunnel / Caddy, либо используйте `authbind`. В этом случае появится прокси,
  и понадобится `TRUST_PROXY=1` (см. шаг 6).

---

## 5. Сертификат Let's Encrypt

Приложение занимает 80 и 443, а `certbot --standalone` для проверки домена тоже хочет 80.
Поэтому выдачу и продление оборачиваем в хуки: перед проверкой останавливаем приложение,
после — копируем сертификаты и поднимаем обратно.

Скрипт остановки `/usr/local/bin/passwdgen-cert-pre.sh`:

```bash
sudo tee /usr/local/bin/passwdgen-cert-pre.sh > /dev/null <<'EOF'
#!/bin/sh
set -eu
# Останавливаем приложение, чтобы освободить :80 для ACME-проверки.
sudo -u passwdgen env HOME=/var/lib/passwdgen PATH="$PATH" pm2 stop passwdgen || true
EOF
sudo chmod 755 /usr/local/bin/passwdgen-cert-pre.sh
```

Скрипт установки сертификата `/usr/local/bin/passwdgen-cert-deploy.sh`:

```bash
sudo tee /usr/local/bin/passwdgen-cert-deploy.sh > /dev/null <<'EOF'
#!/bin/sh
set -eu
DOMAIN=passwd.example.com
CERT_DIR=/var/lib/passwdgen/certs

# /etc/letsencrypt доступен только root, а приложение работает под passwdgen —
# копируем сертификат в его каталог.
install -d -m 750 -o passwdgen -g passwdgen "$CERT_DIR"
install -m 640 -o passwdgen -g passwdgen \
  "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" "$CERT_DIR/fullchain.pem"
install -m 640 -o passwdgen -g passwdgen \
  "/etc/letsencrypt/live/$DOMAIN/privkey.pem" "$CERT_DIR/privkey.pem"

# Node читает сертификаты при старте — перезапускаем процесс.
sudo -u passwdgen env HOME=/var/lib/passwdgen PATH="$PATH" \
  pm2 restart passwdgen --update-env || true
EOF
sudo chmod 755 /usr/local/bin/passwdgen-cert-deploy.sh
```

Замените `passwd.example.com` на свой домен в обоих скриптах и ниже в командах.

Первичная выдача (приложение ещё не запущено — это нормально):

```bash
sudo certbot certonly --standalone -d passwd.example.com \
  --pre-hook "/usr/local/bin/passwdgen-cert-pre.sh" \
  --deploy-hook "/usr/local/bin/passwdgen-cert-deploy.sh"
```

Проверка файлов:

```bash
sudo ls -l /var/lib/passwdgen/certs
# fullchain.pem и privkey.pem, владелец passwdgen
```

Проверка автопродления (таймер certbot уже включён в systemd):

```bash
sudo certbot renew --dry-run
```

`--dry-run` использует staging-сертификаты и **не** пишет в `/etc/letsencrypt/live`, поэтому
deploy-хук просто повторно скопирует действующий сертификат — боевые файлы не пострадают.
Хуки сохраняются в конфигурации renewal-задания, так что при реальном продлении
остановка/запуск произойдут автоматически.

---

## 6. Конфигурация PM2

Проект — ESM (`"type": "module"` в [`package.json`](package.json:5)), поэтому файл
конфигурации должен иметь расширение **`.cjs`**. С `ecosystem.config.js` PM2 упадёт
с `ReferenceError: module is not defined`.

`/opt/easy-passwd-gen-web/ecosystem.config.cjs`:

```js
module.exports = {
    apps: [
        {
            name: "passwdgen",
            script: "server.js",
            cwd: "/opt/easy-passwd-gen-web",

            // Лимитер живёт в памяти процесса (src/rate-limit.js),
            // поэтому только один инстанс. Cluster mode размножит счётчики.
            exec_mode: "fork",
            instances: 1,

            autorestart: true,
            max_restarts: 10,
            restart_delay: 3000,
            max_memory_restart: "300M",

            // server.js обрабатывает SIGTERM/SIGINT и закрывает сервер за 5 с
            kill_timeout: 5000,
            wait_ready: false,

            time: true,       // таймстампы в логах
            watch: false,     // в продакшене watch не нужен

            env: {
                NODE_ENV: "production",
                HOST: "0.0.0.0",
                PORT: "443",
                HTTP_PORT: "80",
                TLS_CERT: "/var/lib/passwdgen/certs/fullchain.pem",
                TLS_KEY: "/var/lib/passwdgen/certs/privkey.pem",
                RATE_LIMIT: "120",
                // TRUST_PROXY здесь НЕ нужен: прокси нет, req.ip — реальный клиент.
            },
        },
    ],
};
```

Переменные читает [`server.js`](server.js:3):

| Переменная | Значение | Зачем |
|---|---|---|
| `HOST` | `0.0.0.0` | Node принимает внешние подключения сам |
| `PORT` | `443` | HTTPS-порт |
| `HTTP_PORT` | `80` | отдельный слушатель с `301` на HTTPS; `0`/не задан — редиректа нет |
| `TLS_CERT` / `TLS_KEY` | пути к файлам | при наличии обоих сервер поднимает HTTPS и включает HSTS |
| `RATE_LIMIT` | `120` | запросов в минуту на IP |
| `TRUST_PROXY` | **не задавать** | без прокси включение флага позволит подделать `X-Forwarded-For` и обойти лимит |

HSTS отдаётся автоматически, когда TLS включён ([`src/app.js`](src/app.js:48)).
Если `TLS_CERT`/`TLS_KEY` не заданы, сервер поднимется по HTTP на `PORT` — приложение
заработает, но service worker и установка PWA будут недоступны.

---

## 7. Первый запуск и автозапуск

```bash
cd /opt/easy-passwd-gen-web

# запуск от пользователя приложения
sudo -u passwdgen env HOME=/var/lib/passwdgen PATH="$PATH" \
  pm2 start ecosystem.config.cjs

# зафиксировать список процессов для восстановления после ребута
sudo -u passwdgen env HOME=/var/lib/passwdgen PATH="$PATH" pm2 save

# systemd-юнит для самого PM2-демона (один раз, от root)
sudo env PATH="$PATH" pm2 startup systemd -u passwdgen --hp /var/lib/passwdgen
```

Проверка:

```bash
sudo -u passwdgen env HOME=/var/lib/passwdgen PATH="$PATH" pm2 status
curl -fsS https://passwd.example.com/api/v1/health
```

Ожидаемый ответ: `{"status":"ok",...}`. Если PM2 пишет `EACCES` на `:443` — вернитесь
к шагу 4 (capability не выставилась или слетела после обновления Node).

---

## 8. Firewall

```bash
sudo apt install -y ufw
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

Порт 3000 не нужен — приложение слушает 80/443 напрямую.

---

## 9. Приёмка

```bash
# 1. Здоровье
curl -fsS https://passwd.example.com/api/v1/health

# 2. Редирект с HTTP
curl -sI http://passwd.example.com/ | head -n 3      # 301 + Location: https://...

# 3. Генерация
curl -fsS "https://passwd.example.com/api/v1/passwords?length=16&count=4"

# 4. 405 с заголовком Allow
curl -si -X DELETE https://passwd.example.com/api/v1/passwords | head -n 10

# 5. Security-заголовки: CSP из src/app.js + HSTS от Node
curl -sI https://passwd.example.com/ | grep -i -E 'content-security-policy|strict-transport'

# 6. Спека и документация
curl -fsS https://passwd.example.com/openapi.json | head -c 120; echo
curl -s -o /dev/null -w '%{http_code}\n' https://passwd.example.com/docs
```

Сертификат глазами клиента:

```bash
echo | openssl s_client -connect passwd.example.com:443 -servername passwd.example.com 2>/dev/null \
  | openssl x509 -noout -subject -dates -issuer
```

В браузере: DevTools → **Application**:

- *Service Workers* — статус `activated`;
- *Manifest* — без ошибок, иконки загружаются;
- кнопка установки PWA доступна.

Проверка лимита (на 121-м запросе должен прийти `429` с `Retry-After` и телом `application/problem+json`):

```bash
for i in $(seq 1 130); do
  curl -s -o /dev/null -w '%{http_code}\n' "https://passwd.example.com/api/v1/passwords"
done | sort | uniq -c
```

---

## 10. Обновление версии

```bash
# локально
rsync -az --delete --exclude node_modules --exclude .git \
  ./ user@server:/tmp/easy-passwd-gen-web/

# на сервере
sudo rsync -a --delete /tmp/easy-passwd-gen-web/ /opt/easy-passwd-gen-web/
sudo chown -R passwdgen:passwdgen /opt/easy-passwd-gen-web
cd /opt/easy-passwd-gen-web
sudo -u passwdgen npm ci --omit=dev
sudo -u passwdgen npm test
sudo -u passwdgen env HOME=/var/lib/passwdgen PATH="$PATH" pm2 restart passwdgen --update-env
```

Почему `--update-env`: PM2 кеширует окружение процесса, и без флага правки в
`ecosystem.config.cjs` (например, `RATE_LIMIT`) не применятся.

`pm2 reload` в режиме `fork` делает то же, что `restart`; zero-downtime появляется только
в `cluster`-режиме, который здесь противопоказан из-за лимитера в памяти
([`src/rate-limit.js`](src/rate-limit.js:8)).

Сертификаты лежат в `/var/lib/passwdgen/certs`, поэтому `rsync --delete` их не затрагивает.

Важно при изменениях фронтенда: поднимайте `CACHE_VERSION` в [`public/sw.js`](public/sw.js:2),
иначе service worker продолжит отдавать старую оболочку из Cache Storage. Новый статический
файл нужно добавить в `APP_SHELL` там же.

`openapi.json` кешируется в памяти при старте ([`src/app.js`](src/app.js:27)),
поэтому после правки спеки рестарт обязателен.

---

## 11. Логи и мониторинг

```bash
sudo -u passwdgen env HOME=/var/lib/passwdgen PATH="$PATH" pm2 status
sudo -u passwdgen env HOME=/var/lib/passwdgen PATH="$PATH" pm2 logs passwdgen --lines 100
sudo -u passwdgen env HOME=/var/lib/passwdgen PATH="$PATH" pm2 monit
```

Логи PM2 лежат в `/var/lib/passwdgen/.pm2/logs/`. Ротация:

```bash
sudo -u passwdgen env HOME=/var/lib/passwdgen PATH="$PATH" pm2 install pm2-logrotate
sudo -u passwdgen env HOME=/var/lib/passwdgen PATH="$PATH" \
  pm2 set pm2-logrotate:max_size 10M
sudo -u passwdgen env HOME=/var/lib/passwdgen PATH="$PATH" \
  pm2 set pm2-logrotate:retain 7
```

Тела запросов и пароли в логи не попадают — в коде такого логирования нет.

---

## 12. Частые проблемы

| Симптом | Причина | Решение |
|---|---|---|
| `EACCES: permission denied 0.0.0.0:443` | нет capability на бинарнике `node` | `sudo setcap 'cap_net_bind_service=+ep' "$(command -v node)"`, затем `pm2 restart passwdgen` |
| После `apt upgrade nodejs` снова `EACCES` | capability слетела при замене файла | повторить `setcap` |
| `EACCES`/`ENOENT` на `TLS_CERT` | сертификат не скопирован или нет прав | `ls -l /var/lib/passwdgen/certs`, запустить `passwdgen-cert-deploy.sh` |
| Браузер ругается на сертификат | используется staging-сертификат после `--dry-run` или истёк срок | `sudo certbot renew --force-renewal`, проверить `openssl s_client` |
| `fetch failed`/`ERR_CONNECTION_REFUSED` на `http://` | не задан `HTTP_PORT` | добавить `HTTP_PORT: "80"` и `pm2 restart passwdgen --update-env` |
| Массовые `429` при нормальной нагрузке | лимит слишком низкий для вашего трафика | поднять `RATE_LIMIT`, `pm2 restart passwdgen --update-env` |
| Лимит обходится подделкой `X-Forwarded-For` | задан `TRUST_PROXY=1` без прокси | убрать переменную из `env`, рестарт с `--update-env` |
| PWA не устанавливается, нет service worker | сайт открыт по HTTP или сертификат невалиден | открывать `https://`, проверить `openssl s_client` |
| Кнопка установки есть, но UI старый | старый service worker | поднять `CACHE_VERSION`, перезагрузить с `Ctrl+Shift+R` |
| `pm2: command not found` под `sudo -u passwdgen` | глобальный bin не в PATH этого пользователя | выполнять через `env PATH="$PATH"`, как в командах выше |
| `ReferenceError: module is not defined` при старте | конфиг назван `ecosystem.config.js` в ESM-проекте | переименовать в `ecosystem.config.cjs` |
| После ребута приложение не поднялось | не выполнены `pm2 save` и/или `pm2 startup` | повторить оба шага, проверить `systemctl status pm2-passwdgen` |
| Продление сертификата падает на `:80` | порт занят, pre-hook не отработал | проверить `journalctl -u certbot`, `/var/log/letsencrypt/letsencrypt.log` |

---

## 13. Что не делать

- Не запускать PM2 от root для самого приложения — только `pm2 startup` один раз от root.
- Не задавать `TRUST_PROXY=1`, пока перед Node нет прокси: это разрешает клиенту
  подставить любой IP в `X-Forwarded-For` и обойти лимит.
- Не включать `cluster`/`instances > 1`: лимитер в памяти станет «на инстанс»,
  и `RATE_LIMIT` перестанет соответствовать документации.
- Не хранить сертификаты внутри `/opt/easy-passwd-gen-web`: `rsync --delete` их удалит.
- Не включать `watch: true` в продакшене: PM2 будет рестартовать процесс на каждый
  записанный файл, включая логи.
- Не логировать тела запросов и пароли: в коде этого нет и добавлять не нужно.
