# tools/migrate (winzy.ai-rdc7.9)

One-command rehearsal of the six Railway Postgres dumps → single Go schema (`winzy_rehearsal`).

**Language choice:** Go, same as `tools/parity`. Schema apply uses golang-migrate
`file://` against `backend/migrations` (cannot import `backend/internal/*` from
outside that tree). Auth-hash audit mirrors `backend/internal/auth/password.go`
Argon2id params in-process.

## Dedicated Postgres 18 instance (`winzy-mig-db`)

Do **not** use compose `winzy-db` (:5439 / PG17) — that lane stays for integration
tests / other workers. Rehearsal uses a dedicated container on **:5440**:

```bash
docker run -d --name winzy-mig-db -p 5440:5432 \
  -e POSTGRES_USER=winzy -e POSTGRES_PASSWORD=winzy -e POSTGRES_DB=postgres \
  -v winzy-mig-data:/var/lib/postgresql postgres:18-alpine
```

> Postgres 18 Docker images require the volume at `/var/lib/postgresql` (not
> `/var/lib/postgresql/data`). See docker-library/postgres#1259.

| | |
|---|---|
| Container | `winzy-mig-db` |
| Volume | `winzy-mig-data` |
| Port | `5440 → 5432` |
| Image | `postgres:18-alpine` (matches Railway prod 18.4 dumps) |
| Teardown | deferred to **rdc7.11** (`docker rm -f winzy-mig-db` + `docker volume rm winzy-mig-data`; also remove leftover `winzy-mig-db-failed-pg18-mount` if present from the first mount-path mistake) |

Creates only: `winzy_mig_src_{auth,habit,social,challenge,notification,activity}` and `winzy_rehearsal`.
Never touches databases `winzy` or `winzy_parity` (forbidden in code; they live on the other instance).

## Safety

- Archive path stays **outside the repo** (real user data). Default expectation:
  `~/work/side-projects/winzy-data-archive/2026-07-12_1945/`
- `pg_restore` runs via `postgres:18-alpine` client against `:5440`.

## Enum mapping (verified against Go DB writers)

DB-free:

```bash
go run ./cmd/migrate mapping
```

Go **stores PascalCase** in DB columns (`frequency.dbValue` → `"Daily"`,
`completionKindFromDB` switches on `"Full"`, social/challenges/notifications
write `string(EnumConst)` where consts are PascalCase). Wire JSON is lowercase
— that is not the DB column. Archive values match → **identity** transform.
`device_tokens.platform` uses snake_case (`web_push` / `expo_push`); archive has 0 rows.

## One-command rehearse

```bash
# ensure winzy-mig-db is up (see above)
cd tools/migrate
go test ./...
go run ./cmd/migrate rehearse \
  --archive "$HOME/work/side-projects/winzy-data-archive/2026-07-12_1945" \
  --report ./verification-report.md
```

Idempotent: drops/recreates managed DBs on `:5440`, re-restores dumps, re-applies migrations, truncate-then-load.

## Step subcommands

```bash
go run ./cmd/migrate restore-sources --archive "$HOME/work/side-projects/winzy-data-archive/2026-07-12_1945"
go run ./cmd/migrate prepare-target
go run ./cmd/migrate load
go run ./cmd/migrate verify --report ./verification-report.md
```

## Defaults

| Flag | Default |
|---|---|
| `--admin-url` | `postgres://winzy:winzy@localhost:5440/postgres?sslmode=disable` |
| `--sslmode` | `disable` (used when composing SourceURL / TargetURL) |
| `--target-db` | `winzy_rehearsal` |
| `--target-url` | _(empty)_ — when set, full override for the target (wins over host/port/user/db/sslmode) |
| `--docker-image` | `postgres:18-alpine` |

`CREATE DATABASE … OWNER` uses `--user` (not a hardcoded `winzy` role). Forbidden
database names `winzy` / `winzy_parity` are refused whether composed or parsed
from `--target-url`.

Auth audit runs format + PLACEHOLDER rejection for **all** migrated users (no owner-username guessing).

## Railway cutover targeting

Local `rehearse` defaults are unchanged. For a Railway Postgres target, pass a
full `--target-url` (and usually a Railway `--admin-url` for `CREATE DATABASE`).
Pull values from `railway variables` / the dashboard — **never commit URLs**.

```bash
# Example shape only — substitute real values from Railway; do not commit them.
ADMIN_URL='postgres://USER:PASS@HOST:PORT/railway?sslmode=require'   # maintenance DB
TARGET_URL='postgres://USER:PASS@HOST:PORT/YOUR_APP_DB?sslmode=require'

go run ./cmd/migrate prepare-target \
  --admin-url "$ADMIN_URL" \
  --target-url "$TARGET_URL" \
  --user "$USER"

go run ./cmd/migrate load --target-url "$TARGET_URL"
go run ./cmd/migrate verify --target-url "$TARGET_URL" --report ./verification-report.md
```

`--sslmode=require` is also available when composing URLs from `--host` / `--port`
/ `--user` / `--password` / `--target-db` without a full `--target-url`.

## Decisions encoded

- UUIDs / timestamptz / jsonb verbatim
- `refresh_tokens` not migrated
- password hashes verbatim; per-user format audit + `VerifyPassword("PLACEHOLDER")` must reject
- `feed_entries` drops `actor_username` / `actor_display_name`
- orphans reported (run fails); not silently discarded without a report section
