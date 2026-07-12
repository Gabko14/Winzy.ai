# Parity harness (winzy.ai-rdc7.12)

Proves behavioral parity between the old .NET stack and the Go rewrite by
running scripted API scenarios against both and diffing normalized
responses. Phase 1 captured the golden master from the live old stack.
Phase 2 (Go-diff) points the same scenarios at the Go stack and diffs
against those goldens, with a reviewed allowlist for intentional
divergences.

## Implementation

Standalone Go module (`go.mod` inside this directory, no dependency on the
root repo's Node toolchain or the `backend/` Go module) using only the
standard library (`net/http`, `encoding/json`, `net/http/cookiejar`) — no
third-party dependencies, no `go.sum`. Chosen over a Node/TS script because
the rewrite target is also Go: this dogfoods the same stdlib-only,
single-static-binary style the backend rewrite standardizes on, needs no
extra toolchain, and produces one `parity` binary that can run in CI later
with no `npm install` step.

## One-command usage

### Phase 1 — golden capture / old-stack check (reference)

```sh
# Bring up the old stack ONLY when explicitly needed (from the repo root).
# Phase 2 Go-diff does NOT need the old stack — goldens are already committed.
# When you do boot it: docker compose up -d --build (images go stale).
docker compose up -d --build

cd tools/parity
go run ./cmd/parity capture --base-url http://localhost:5050 --stack old
go run ./cmd/parity check --base-url http://localhost:5050 --stack old
```

### Phase 2 — Go stack vs goldens

Target topology (PM-prescribed):

| Piece | Value |
| --- | --- |
| Go API | `go run ./cmd/api` from `backend/` (temp-cache compile — never `go build` into the tree) |
| Listen port | **`:5051`** (never `:5050` — old gateway / E2E own it) |
| Database | logical DB **`winzy_parity`** in the winzy-db Postgres instance |
| Env | `PORT=5051` and `DATABASE_URL=postgres://winzy:winzy@localhost:5439/winzy_parity?sslmode=disable` (defaults otherwise point at `winzy` on `:8080` — see `backend/internal/config`) |
| Hard rule | **NEVER** touch the `winzy` database — integration tests and E2E own it and `TRUNCATE` it |

Create the logical database once (after PM GO for the DB window):

```sh
psql "postgres://winzy:winzy@localhost:5439/postgres?sslmode=disable" \
  -c "CREATE DATABASE winzy_parity;"
```

Boot the Go API (after PM GO):

```sh
cd backend
PORT=5051 \
DATABASE_URL='postgres://winzy:winzy@localhost:5439/winzy_parity?sslmode=disable' \
  go run ./cmd/api
```

Run the parity check against goldens:

```sh
cd tools/parity
go run ./cmd/parity check \
  --base-url http://localhost:5051 \
  --stack go \
  --allowlist allowlist.json
```

Both subcommands also accept `--goldens DIR` (default `goldens`),
`--artifacts DIR` (default `artifacts`), and `--only SUBSTRING` to filter
scenarios by name. Exit code is non-zero if any scenario has **unexplained**
diffs after allowlist filtering.

## Dual-target design

Every scenario is written against a `*runner.Context` that carries a
parametrized base URL and two HTTP identities (`ctx.Native` — bearer token,
no cookies; `ctx.Web` — cookie jar + `Sec-Fetch-Site`, to exercise the
web-client refresh-cookie path). Nothing in scenario code is old-stack- or
Go-stack-specific — `--base-url` and `--stack` are the only things that
change between an old-stack run and a Go-stack run.

- **`capture`** runs every scenario against `--base-url` and writes
  canonicalized responses to `goldens/<scenario>/<NN>_<step>.json`. This is
  how the old-stack golden master (committed to the repo) was produced, and
  is also how a determinism check works: capture twice into two different
  `--goldens` dirs and `diff -r` them — see "Verification" below.
- **`check`** runs every scenario fresh against `--base-url`, canonicalizes
  each response the same way, and diffs it against the stored golden at
  that path. Phase 2 uses this against the Go stack (`--stack go`); any
  behavioral divergence from the old stack shows up as a scenario failure
  with a diff, unless an **approved** allowlist entry covers that field.

Cookie-flow scenarios: the Go stack sets the refresh cookie itself (no
gateway). The runner's web client already uses a cookie jar; phase 2
verifies that path still holds against `:5051`.

## Allowlist (`allowlist.json`)

Every non-volatile old-vs-Go difference that is intentional lives here with:
`scenario`, `field`, `old_shape`, `new_shape`, `justification`, `source_bead`,
`response_surface`, `status`.

- **`status=seeded`** — candidates recorded on module beads (rdc7.5 / rdc7.6 /
  rdc7.7). Documentation only; they **never** suppress a live diff.
- **`status=approved`** + **`response_surface=true`** — PM-approved; matching
  field paths are logged as `ALLOWLISTED` and do not fail the scenario.
  Phase-2 approved set (2026-07-12): `validation-envelope-keys` (+ title/status
  companions), `401-error-body`, `export-empty-collections-present` (+
  witnessLinks companion), `feed-name-join-freshness`.
- **`response_surface=false`** — internal/behavioral divergences (CDR skip,
  heal-path, warn-logs, …) that are not expected to appear as golden JSON
  field diffs. Even if marked approved, they never suppress diffs.

Feed-item ordering with tied `createdAt` is handled by
`normalize.StableSortFeedItems` (secondary key: eventType, actorId, id) —
not by the allowlist (F6a).

Workers must **report new diffs as findings** on the Agent Mail thread and
wait for PM approval before flipping any entry to `approved`. An empty
unexplained-diff report is the pass condition.

## Normalization

`internal/normalize` canonicalizes documented volatile fields by VALUE
SHAPE (not field name), so it applies uniformly with no per-endpoint
allowlist:

- **UUIDs** — replaced with the registered symbolic name from the
  id-mapping table (`internal/idmap`) when known (e.g. `{{seed:user:alice:id}}`),
  else an ordinal placeholder assigned by first-seen order within the
  response (`{{uuid:1}}`, `{{uuid:2}}`, ...). Traversal order is
  deterministic (object keys visited in sorted order) so two independent
  runs assign identical ordinals despite Go's randomized map iteration.
- **Timestamps** (RFC3339) — replaced with `{{timestamp}}`.
- **Civil dates** (yyyy-MM-dd) — masked to `{{date:N}}` on **both** golden
  and actual immediately before Diff (see `normalize.MaskCivilDates`).
  Scenario inputs are relative to "today"; without this, a golden captured
  on day D fails a check on day D+N even when behavior matches. Server-
  synthesized strings that embed a human month/day (promise `statement`)
  are registered in the id-map by the scenario instead.
- **Opaque tokens** (JWTs, refresh tokens, witness link tokens) — replaced
  with `{{token}}`.
- **Seeded random values** — every scenario registers a symbolic name for
  every random value IT chose (email, username, displayName — see
  `registerUser` in `internal/scenarios/helpers.go`), not just server-issued
  UUIDs. This is what makes two independently-seeded runs (each with their
  own random `parity-*@winzy.test` users) produce byte-identical
  canonicalized output. One subtlety: auth-service lowercases email/username
  before storing them, so the generator lowercases them at the source too —
  otherwise a mixed-case symbolic scenario name would make the client-sent
  value diverge from the server-echoed value and silently defeat
  substitution (this was an actual bug caught during verification; see the
  dispatch report).

## Observability

Every step logs a timestamped line (`stack=`, `scenario=`, `step=`,
method/path/status/duration). Any unexplained diff, unexpected status code,
or transport error writes one JSON file to `artifacts/<scenario>/<step>.json`
containing the full request, the full raw response (headers + body,
uncanonicalized), the golden body it was compared against, and the
specific field-path diffs — enough to diagnose a red run without
re-running anything. Allowlisted diffs are logged inline (`ALLOWLISTED`)
and counted in the final report. The final report lists every scenario's
pass/fail, request count, allowlisted-diff count, and duration, so a green
run is auditable (not just a green exit code). Artifacts are cleared at the
start of every run; goldens are only cleared at the start of a `capture`
run (never in `check` mode, which must not touch the golden master it's
diffing against).

## Scenario coverage

See `internal/scenarios/*.go`, one file per API area: `auth.go`,
`habits.go`, `completions.go`, `stats.go`, `flame_public.go`,
`promises.go`, `friends.go`, `visibility.go`, `witness.go`,
`challenges.go`, `notifications.go`, `activity.go`, `export.go`,
`errors.go`. Every scenario creates its own throwaway `parity-*@winzy.test`
users (never touches `e2e/fixtures`, which stay reserved for Playwright).

## Known limitations

- `flame.svg`'s body isn't JSON, so it isn't captured in the golden master
  — only its status code and `Content-Type` are asserted inline in
  `public-flame-page-utc-contract`. Phase-1 review asked for byte-level SVG
  goldens in phase 2; naive byte compare breaks under independent seeding
  (SVG embeds username / consistency). Needs SVG-aware normalization or a
  same-seed dual-hit — deferred pending PM direction (PART 2 flame
  golden-master over the rdc7.9 rehearsal dataset is a separate scope).
- Async NATS-consumer side effects (challenge progress, friend-activity
  notifications) are waited-for with a bounded poll (`waitUntil` in
  `helpers.go`) before the recorded assertion, but that poll is NOT part of
  golden capture — only the final settled read is. Checking for the
  ABSENCE of a further async effect (idempotency/dedupe checks) uses a
  fixed settle delay instead of a poll, since there's no positive condition
  to wait for. Against the Go stack, equivalent side effects are in-process
  rather than NATS — settle delays still apply where scenarios check absence.
- The local old-stack gateway enforces a non-configurable 300 req/min/IP
  "standard" rate limit. Running `capture` or `check` twice back-to-back
  against `:5050` can trip it; space runs roughly a minute apart if you see
  spurious 429s. The Go stack on `:5051` has its own rate-limit config
  (`RATE_LIMIT_*` env); default general limit is also 300/min.
