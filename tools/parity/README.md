# Parity harness (winzy.ai-rdc7.12)

Proves behavioral parity between the old .NET stack and the Go rewrite by
running scripted API scenarios against both and diffing normalized
responses. Phase 1 (this drop) targets only the live old stack: scenario
runner, normalization/diff engine, and golden-master capture. Phase 2 (a
later bead) points the same scenarios at the Go stack and diffs against
these goldens.

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

```sh
# Bring up the old stack (from the repo root):
docker compose up -d nats auth-db habit-db social-db challenge-db \
  notification-db activity-db api-gateway auth-service habit-service \
  social-service challenge-service notification-service activity-service

cd tools/parity

# Capture the golden master from a stack (run once per stack you trust):
go run ./cmd/parity capture --base-url http://localhost:5050 --stack old

# Replay scenarios against a stack and diff against the golden master:
go run ./cmd/parity check --base-url http://localhost:5050 --stack old

# Later, phase 2 dual-stack diff is the SAME command, just pointed at Go:
go run ./cmd/parity check --base-url http://localhost:8080 --stack go
```

Both subcommands accept `--goldens DIR` (default `goldens`), `--artifacts
DIR` (default `artifacts`), and `--only SUBSTRING` to filter scenarios by
name. Exit code is non-zero if any scenario fails.

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
  that path. This is the exact mechanism phase 2 will use: point `--base-url`
  at the Go stack, and any behavioral divergence from the old stack shows up
  as a scenario failure with a diff.

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
method/path/status/duration). Any diff, unexpected status code, or
transport error writes one JSON file to `artifacts/<scenario>/<step>.json`
containing the full request, the full raw response (headers + body,
uncanonicalized), the golden body it was compared against, and the
specific field-path diffs — enough to diagnose a red run without
re-running anything. The final report lists every scenario's pass/fail,
request count, and duration, so a green run is auditable (not just a green
exit code). Artifacts are cleared at the start of every run; goldens are
only cleared at the start of a `capture` run (never in `check` mode, which
must not touch the golden master it's diffing against) — this avoids stale
files lingering when a scenario's steps change shape across revisions.

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
  `public-flame-page-utc-contract`. A later phase could add a raw-bytes or
  SVG-structural comparison if byte-for-byte SVG parity matters.
- Async NATS-consumer side effects (challenge progress, friend-activity
  notifications) are waited-for with a bounded poll (`waitUntil` in
  `helpers.go`) before the recorded assertion, but that poll is NOT part of
  golden capture — only the final settled read is. Checking for the
  ABSENCE of a further async effect (idempotency/dedupe checks) uses a
  fixed settle delay instead of a poll, since there's no positive condition
  to wait for.
- The local dev stack's gateway enforces a non-configurable 300 req/min/IP
  "standard" rate limit (only the `auth` limiter is raised via
  `RateLimiting__AuthPermitLimit` in `docker-compose.yml`). Running
  `capture` or `check` twice back-to-back can trip it; space runs roughly a
  minute apart if you see spurious 429s.
