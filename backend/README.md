# backend

The Winzy.ai backend: a single Go service (it replaced the original .NET microservices in epic `winzy.ai-rdc7`, live since 2026-07-13). Feature modules — auth, habits, social, challenges, notifications, activity — live as `internal/<module>` packages.

## Stack

- stdlib `net/http` with Go 1.22+ method routing — no web framework.
- [pgx v5](https://github.com/jackc/pgx) (`pgxpool`) for Postgres. One database.
- [golang-migrate](https://github.com/golang-migrate/migrate) for schema migrations, embedded into the binary via `//go:embed` (no mounted migrations directory at runtime).
- `log/slog` JSON logging to stdout (Railway captures stdout).

## Run

```bash
docker compose up -d winzy-db          # from the repo root; Postgres on localhost:5439
cd backend
go run ./cmd/api                       # reads config from env, applies migrations, listens on :8080
curl http://localhost:8080/health
```

### Full stack on :5050 (E2E / same-origin)

Port 5050 matches Playwright fixtures.

**Compose (production bundle inside the image):**

```bash
# from repo root; requires JWT_SECRET in .env (see .env.example)
docker compose up -d --build
curl http://localhost:5050/health
# SPA: http://localhost:5050/   API: http://localhost:5050/auth/...
```

`WINZY_CORS_ORIGIN` defaults to `http://localhost:8081` (Expo web dev). For same-origin Playwright against the Go-served bundle, set `WINZY_CORS_ORIGIN=http://localhost:5050`.

**Local Go binary + Expo export (no image rebuild):**

```bash
docker compose up -d winzy-db
cd frontend && npx expo export --platform web && cp -R assets dist/assets
cd ../backend
PORT=5050 \
  WEB_DIST=../frontend/dist \
  CORS_ORIGIN=http://localhost:8081 \
  JWT_SECRET='winzy-dev-jwt-secret-minimum-32-characters-long!!' \
  RATE_LIMIT_AUTH_PER_MINUTE=1000 \
  go run ./cmd/api
```

Unset `WEB_DIST` for API-only mode (unit tests / contract tests unchanged).

Config is read from the environment with local-dev defaults (see `internal/config/config.go`):

| Var | Default |
|---|---|
| `PORT` | `8080` |
| `DATABASE_URL` | `postgres://winzy:winzy@localhost:5439/winzy?sslmode=disable` |
| `LOG_LEVEL` | `info` (`debug`/`info`/`warn`/`error`) |
| `CORS_ORIGIN` | `http://localhost:8081` (Expo web dev) |
| `WEB_DIST` | unset (API-only); set to Expo `dist/` (+ `assets/`) for same-origin SPA |

Invalid values (unparseable `PORT`, unparseable `DATABASE_URL`, unknown `LOG_LEVEL`, schemeless `CORS_ORIGIN`) fail fast at startup with a descriptive error.

### Production image

Build from the **repo root** (frontend stage needs `frontend/`):

```bash
docker build -f backend/Dockerfile.railway -t winzy-api .
```

`backend/Dockerfile` remains the API-only image (no SPA). `Dockerfile.railway` embeds the Expo export at `/app/web` and sets `WEB_DIST`.

## Test

```bash
go test ./...                          # unit tests only, no DB required
```

Integration tests (handler tests against a **real** Postgres) are build-tagged
`integration` so the plain `go test ./...` above never needs a database:

```bash
docker compose up -d winzy-db
TEST_DATABASE_URL=postgres://winzy:winzy@localhost:5439/winzy?sslmode=disable \
  go test -tags=integration -race ./...
```

**Fast path (Phase A+B of winzy.ai-s8ly — current state; Phase C / zfa3 deferred):**

| Lever | What it does |
|---|---|
| Argon2 test params (`SetHashingParamsForTests` from TestMain) | Weak params in test processes; production constants pinned by `TestProductionHashingParamsPinned` |
| `winzy_test_*` per-package DBs (`internal/dbtest`) | Packages run in parallel — **no `-p 1`** |
| migrate-once + cached truncate list | Per-process fast path inside each package DB |
| fsync / synchronous_commit / full_page_writes off | Local: applied by compose/`ALTER SYSTEM` on winzy-db; CI: tmpfs + same GUCs. **Never use these flags on real data.** |

Each package gets its own database (`winzy_test_<package>_<hash>`, auto-created
on first `dbtest.Connect` — winzy.ai-edxi). `TEST_DATABASE_URL` still points at
the shared `winzy` database; Connect rewrites the dbname internally. Dropping
any `winzy_test_*` database is always safe (they are recreated on the next run).

Today use `dbtest.Connect(t)` (package-scoped DB + advisory lock + truncate).
In-package `t.Parallel` via `dbtest.ConnectParallel` is **Phase C**
(`winzy.ai-utzz` pilot, `winzy.ai-zfa3` rollout — both deferred); do not invent
a parallel helper ahead of that design.

The shared `winzy` database remains for the E2E compose stack.

**Integration-test convention** (every module bead's handler tests follow this —
see `internal/dbtest`): point at the compose `winzy-db` service via
`TEST_DATABASE_URL` rather than spinning up testcontainers-go.
`internal/dbtest.Connect(t)` ensures the package database, runs migrations,
truncates every table, and skips (not fails) the test when `TEST_DATABASE_URL`
is unset.

CI (`.github/workflows/ci-go.yml`) runs `go test -tags=integration -race -json
./...` piped through `go run ./tools/testtiming` (per-package duration table +
soft 40s wall-clock tripwire — warn only, ~3× measured ~13s Phase A+B steady
state).

## Migrate

Migrations live in `migrations/*.sql` (embedded into the binary) and are applied automatically on every process start (`db.Migrate`, called from `cmd/api/main.go`) — there is no separate migrate command to run in normal operation. To add one: create `NNNN_description.up.sql` / `NNNN_description.down.sql` in `migrations/`.

## Transactional cascades

An event handler registered on the shared `events.Registry` (e.g. a module's `UserDeleted` cascade) that writes to Postgres must resolve its querier via `db.QuerierFrom(ctx, s.pool)` instead of using its pool directly. When an emitter holds a transaction (`db.WithQuerier(ctx, tx)` before `events.Emit`), this makes the handler join that transaction instead of writing outside it — see `internal/events`' package doc and `auth.Service.DeleteAccount` / `habits.Service.handleUserDeleted` for the reference implementation.

## Logging convention

Every request produces one JSON log line (`internal/httpserver.RequestLogging`) with `request_id`, `method`, `path`, `status`, `duration_ms`, and `user_id` when authenticated. `request_id` is assigned by the outermost `Recovery` middleware, which also recovers panics and logs them (with `request_id`) before returning a generic 500. Startup logs the resolved config via `slog.LogValuer`, which redacts `DATABASE_URL`'s credentials.

Middleware order is fixed: panic recovery → request logging → CORS → router (`internal/httpserver.New`).
