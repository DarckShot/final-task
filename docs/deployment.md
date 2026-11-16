# Развёртывание на личном сервере

Требуются Linux, Docker Engine с Compose, домен с A/AAAA на сервер и доступные
из интернета TCP 80/443. PostgreSQL остаётся на 127.0.0.1:5432. Если порт уже занят,
измените левую часть проброса в compose.yaml и цель SSH-туннеля. Не открывайте
5432 наружу. Личный сервер допустим по ТЗ; ограниченный SSH-туннель согласуйте с
преподавателем **до развёртывания**, либо предоставьте отдельное прямое защищённое
подключение с теми же ограниченными правами.

## Подготовка

```sh
git clone https://github.com/DarckShot/final-task.git
cd final-task
cp .env.example .env
chmod 600 .env
openssl rand -hex 32
```

Выполните последнюю команду четыре раза, независимо заполните `API_TOKEN`,
`POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `REVIEWER_DB_PASSWORD`. Используйте hex,
чтобы пароли не требовали URL-кодирования в строках подключения. Заполните
`DOMAIN`, `ACME_EMAIL`; автор уже указан по данным пользователя. Для Docker:

```dotenv
DATABASE_URL=postgresql://tasks_app:ЗНАЧЕНИЕ_APP_DB_PASSWORD@db:5432/tasks_db
```

Это пример формата, замените значение своим секретом. `ADMIN_DATABASE_URL`
в .env для Docker не требуется: сервис setup формирует его из пароля владельца.
Сервис app получает только собственную строку подключения и токен. Пароль
владельца и пароль преподавателя в окружение app не передаются.

```sh
docker compose up -d db
docker compose run --rm setup
docker compose up -d --build app caddy
docker compose ps
git rev-parse HEAD
```

`setup` создаёт таблицу и роли в одной выделенной БД. При уже существующих ролях
он завершится ошибкой; не запускайте provisioning повторно вслепую. Миграция
таблицы повторяема, а пароли существующих ролей меняются отдельно администратором.
При дальнейших обновлениях используйте `docker compose up -d --build app caddy`.
Проверяйте совпадение текущего commit с опубликованной ссылкой сдачи.

Caddy получает сертификат и перенаправляет HTTP на HTTPS автоматически при
корректном DNS. Постоянные данные живут в volumes pgdata/caddydata/caddyconfig.
`docker compose down` сохраняет их; **не используйте `down -v`**, это удалит БД.
Сделайте резервную копию до обновлений; храните её вне публичного репозитория:

```sh
docker compose exec -T db pg_dump -U tasks_owner tasks_db > tasks-backup.sql
```

## Ручное персональное дело и проверка

Откройте `https://ВАШ_ДОМЕН/`, введите токен, проверьте ФИО и логин. Нажмите
«Добавить итоговую работу». В группе `manual` должно появиться
«Итоговая работа 24.10.2026: sergey_krasn». Кнопка не создаёт повторную запись
при обычном последовательном нажатии. Это нужно выполнить вручную на сервере:
браузерный тест создаёт свои данные только в тестовой БД.

На машине с Node.js, заполненной .env и доступом к HTTPS:

```sh
npm ci
APP_URL=https://ВАШ_ДОМЕН npm run check:deployment
```

Проверка использует отдельный случайный runId и удаляет только созданную ею
запись. Действующий токен берётся из .env. Дополнительно перезапустите
`docker compose restart app`, убедитесь в сохранении ручного дела.

## Независимый доступ преподавателя

Предоставьте `tasks_reviewer` и его отдельный пароль. Эта роль имеет только
CONNECT, USAGE public и SELECT/INSERT/UPDATE/DELETE на tasks, не владеет таблицей.
Нельзя использовать `tasks_owner`, основной SSH-аккаунт или учётную запись Moodle.
Создайте отдельного OS-пользователя `tasks-tunnel` с SSH-ключом преподавателя,
без sudo. Пример ограничения в `/etc/ssh/sshd_config.d/tasks-tunnel.conf`:

```text
Match User tasks-tunnel
    AuthenticationMethods publickey
    PasswordAuthentication no
    AllowTcpForwarding local
    PermitOpen 127.0.0.1:5432
    AllowAgentForwarding no
    X11Forwarding no
    PermitTTY no
    MaxSessions 0
```

Администратор должен создать пользователя и `authorized_keys` штатными
средствами ОС, установить права .ssh=700/authorized_keys=600, проверить
`sshd -t` и перечитать конфигурацию SSH. Не закрывайте текущий административный
сеанс до проверки второго подключения. Дополнительные общесистемные правила
SSH могут переопределять доступ; проверьте итоговую конфигурацию на сервере.
`MaxSessions 0` запрещает shell/exec/subsystem, сохраняя forwarding через `ssh -N`.
Команда преподавателя:

```sh
ssh -N -L 15432:127.0.0.1:5432 tasks-tunnel@ВАШ_СЕРВЕР
psql -h 127.0.0.1 -p 15432 -U tasks_reviewer -d tasks_db -W
```

В psql выполните пример ниже. UUID должен быть новым; найдите его при
повторном запуске иначе INSERT ожидаемо получит конфликт. `run_id` совпадает
с открытой группой интерфейса. После SQL UPDATE/DELETE нажимайте «Обновить».

```sql
SELECT id, owner_login, title, done, run_id, created_at
FROM tasks WHERE owner_login='sergey_krasn' AND run_id='manual';
INSERT INTO tasks(id,owner_login,title,run_id)
VALUES ('7e6bb76a-4cdf-4ff8-ab98-f25ff07b93ac','sergey_krasn','SQL проверка','review');
UPDATE tasks SET title='SQL изменено',done=true
WHERE id='7e6bb76a-4cdf-4ff8-ab98-f25ff07b93ac';
DELETE FROM tasks WHERE id='7e6bb76a-4cdf-4ff8-ab98-f25ff07b93ac';
```

Создайте другую запись через интерфейс в группе review, проверьте её через SQL,
измените через API, повторите SELECT, удалите через интерфейс и повторите SELECT.
Это подтверждает обе стороны обмена с **той же** БД. Не заменяйте этот шаг
скриншотами, дампом или HTTP-проверкой. Держите сервер доступным до конца проверки.

## Запуск без Docker

Поддерживается Node.js >=22.17 и PostgreSQL 14+. Создайте отдельную tasks_db под
владельцем с правом создавать роли. В локальной .env задайте ADMIN_DATABASE_URL
на владельца, APP_DB_PASSWORD/REVIEWER_DB_PASSWORD и DATABASE_URL на tasks_app
с адресом localhost. Выполните `npm ci`, `npm run db:init`, `npm run db:roles`,
`npm start`. Приложение доступно на localhost:3000; публичный HTTPS настраивается
отдельным обратным прокси. Для удалённой БД используйте sslmode=verify-full и
доверенный корневой сертификат, не отключайте проверку сертификата.

## Тесты

TEST_DATABASE_URL должен вести в отдельную одноразовую БД с администратором и
без существующих ролей tasks_app/tasks_reviewer. Интеграционные тесты создают
учебную таблицу; проверка ролей временно меняет права тестовой БД. Никогда не
запускайте их на рабочей БД. `npm run test:ui` использует установленный Chrome;
для Playwright Chromium выполните `npx playwright install chromium` и задайте
PLAYWRIGHT_CHANNEL=chromium. CI выполняет те же проверки с PostgreSQL 17.
