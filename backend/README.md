# backend

Single Go service replacing the .NET microservices (epic `winzy.ai-rdc7`). Scaffold only right now — feature modules (auth, habits, social, challenges, notifications, activity) land in later beads as `internal/<module>` packages.

## Stack

- stdlib `net/http` with Go 1.22+ method routing — no web framework.
- [pgx v5](https://github.com/jackc/pgx) (`pgxpool`) for Postgres. One database.
- [golang-migrate](https://github.com/golang-migrate/migrate) for schema migrations, embedded into the binary via `//go:embed` (no mounted migrations directory at runtime).
- `log/slog` JSON logging to stdout (Railway captures stdout; no Seq in the new world).

## Run

```bash
docker compose up -d winzy-db          # from the repo root; Postgres on localhost:5439
cd backend
go run ./cmd/api                       # reads config from env, applies migrations, listens on :8080
curl http://localhost:8080/health
```

Config is read from the environment with local-dev defaults (see `internal/config/config.go`):

| Var | Default |
|---|---|
| `PORT` | `8080` |
| `DATABASE_URL` | `postgres://winzy:winzy@localhost:5439/winzy?sslmode=disable` |
| `LOG_LEVEL` | `info` (`debug`/`info`/`warn`/`error`) |
| `CORS_ORIGIN` | `http://localhost:8081` (Expo web dev) |

Invalid values (unparseable `PORT`, unparseable `DATABASE_URL`, unknown `LOG_LEVEL`, schemeless `CORS_ORIGIN`) fail fast at startup with a descriptive error.

## Test

```bash
go test ./...                          # unit tests only, no DB required
```

Integration tests (handler tests against a **real** Postgres) are build-tagged `integration` so the plain `go test ./...` above never needs a database:

```bash
docker compose up -d winzy-db
TEST_DATABASE_URL=postgres://winzy:winzy@localhost:5439/winzy?sslmode=disable \
  go test -tags=integration -race -v -p 1 ./...
```

`-p 1` is required for multi-package integration runs: all packages share the one live database and each test truncates every table, so concurrently running packages wipe each other's rows mid-test.

**Integration-test convention** (every module bead's handler tests follow this — see `internal/dbtest`): point at the compose `winzy-db` service via `TEST_DATABASE_URL` rather than spinning up testcontainers-go. This repo already treats Postgres as a docker-compose service everywhere else, the pre-push hook already assumes Docker is running, and CI already knows how to bring up a Postgres service container — reusing that avoids a second container-management dependency. `internal/dbtest.Connect(t)` runs migrations, truncates every table, and skips (not fails) the test when `TEST_DATABASE_URL` is unset.

CI (`.github/workflows/ci-go.yml`) runs `go test -tags=integration -race -v ./...` against a Postgres service container on every push/PR touching `backend/**`.

## Migrate

Migrations live in `migrations/*.sql` (embedded into the binary) and are applied automatically on every process start (`db.Migrate`, called from `cmd/api/main.go`) — there is no separate migrate command to run in normal operation. To add one: create `NNNN_description.up.sql` / `NNNN_description.down.sql` in `migrations/`.

## Logging convention

Every request produces one JSON log line (`internal/httpserver.RequestLogging`) with `request_id`, `method`, `path`, `status`, `duration_ms`, and `user_id` when authenticated. `request_id` is assigned by the outermost `Recovery` middleware, which also recovers panics and logs them (with `request_id`) before returning a generic 500. Startup logs the resolved config via `slog.LogValuer`, which redacts `DATABASE_URL`'s credentials.

Middleware order is fixed: panic recovery → request logging → CORS → router (`internal/httpserver.New`).
