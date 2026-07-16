# CLAUDE.md

> Keep this file concise. Only non-obvious decisions and rules belong here.
> Don't add conventions, naming patterns, or project structure — those are discoverable from the code in seconds.

## Project Overview

Winzy.ai is a habit tracker with an optional social layer. Users track daily habits and optionally share progress with friends through **The Flame** — a visual consistency indicator. Friends can see your Flame and set experience-based challenges (grab coffee, play tennis).

**Core philosophy:**
- **Habit tracker first** — works beautifully standalone. No friends required.
- **Passive accountability** — knowing someone *can* see your Flame changes behavior. No messages, no nudges.
- **Consistency over streaks** — 60-day rolling window. Missing a day doesn't reset to zero.
- **Encourage, never punish** — "Ready to log today?" not "You haven't logged today!"
- **Zero-friction sharing** — public flame page at `winzy.ai/@username`, no account needed to view.
- **Shared experiences, not transactions** — challenge rewards are things you do TOGETHER.

**Product strategy:** Web-first PWA via Expo. Native apps later. Same codebase.

**Architecture:** a **single Go service + one Postgres** (`backend/`), cut over from .NET microservices on 2026-07-13 (epic `winzy.ai-rdc7` — the microservices were a school requirement, not a product need). Deployed on Railway (`winzy-staging`): `api-gateway` (the Go binary, keeps its historical name) + `Postgres`.

## Key Design Decisions

These are the non-obvious choices that agents get wrong without being told:

- **One service, module packages.** `backend/internal/{auth,habits,social,challenges,notifications,activity}` — each module owns its tables; cross-module reads go through small interfaces wired in `cmd/api/main.go`, never another module's store.
- **In-process registries replace NATS.** `internal/events` is a typed, synchronous pub/sub hub (modules register handlers at startup, emitters don't know who listens); `internal/export` collects per-module export sections for GET /auth/export. New cross-module reactions belong in these registries, not in direct calls.
- **Account deletion is one transaction.** DELETE /auth/account runs every module's cascade delete in a single Postgres transaction — any failure rolls back everything. No partial deletes, ever (GDPR).
- **Public endpoints are an explicit allowlist.** `auth.Middleware` guards everything; only `DefaultPublicRoutes` + `GET /health`, `GET /habits/public/*`, `GET /social/witness/*`, `GET /notifications/vapid-public-key` skip auth. New public routes must be added to the allowlist deliberately.
- **Error body contract.** Business errors return `{"error": "message"}` with 409 (conflict), 404, 401 (no body detail for bad credentials); validation failures return 400 `{"errors": {field: [messages]}}`. Return errors, don't panic, for expected failures.
- **Timezone is per-surface, not global.** Habit completion takes `timezone` in the request BODY; stats requires the `X-Timezone` header (400 without it); promise surfaces read `X-Timezone` and fall back to UTC. Don't "unify" these — the frontend depends on each contract.
- **No caching in flame math.** Consistency/flame values are computed fresh from completions on every request — deliberate; at this scale correctness beats speed, and stale flames were a real bug class in the old stack.
- **Argon2id parameters are pinned.** `internal/auth/password.go` constants must match what migrated hashes were created with (verified by `TestProductionHashingParamsPinned`) — changing them silently locks out every existing user.
- **VAPID keys are continuity-critical.** The Railway VAPID env vars were carried over from the old stack; rotating them kills every existing push subscription.
- **Port contract.** The binary listens on `PORT` (Railway sets 5000 — load-bearing, the public domain routes to it; local compose maps `5050:8080`). The API serves the exported web bundle same-origin from `WEB_DIST`.
- **Backend returns data, UI shows feedback.** The backend never formats user-facing presentation; the frontend decides how to present structured results.
- **Rate limiting trusts leftmost X-Forwarded-For** (when `TRUSTED_PROXY=true`). Railway's edge owns XFF; X-Real-IP is broken behind their CDN — don't switch to it.

## Working Rules

- **Always read the relevant bead before reviewing or verifying work.** The beads contain acceptance criteria that define "done" — code review without checking the bead misses spec gaps.
- **No script-based mass changes.** Never run regex-based scripts to transform code files. Make changes manually or use parallel subagents for many simple changes.
- **No file proliferation.** Never create `V2`, `_improved`, `_new`, `_enhanced` variants of existing files. Edit in place. New files are only for genuinely new functionality that doesn't belong in any existing file.
- **Verify library APIs before implementing.** Use Context7 or search online to check current docs. Don't guess at API signatures or assume remembered usage is correct.

## Testing

Every test module must cover three areas:

1. **Happy path** — the expected workflow works correctly
2. **Edge cases** — empty input, boundary values, max limits, zero/null, concurrent access
3. **Error conditions** — invalid input, missing resources, network failures, unauthorized access

## Git Workflow

**Solo project — commit directly to `main`.** (The PR workflow was retired 2026-07 when this stopped being a group school project.)

- Work on `main` by default. Use a `feature/` or `fix/` branch only for risky or experimental work you might throw away.
- **Commits must be meaningful.** No standalone commits for small docs/chore/beads tweaks — amend them into the previous commit or let them ride along with the next real change.
- **Commit messages are for strangers (rule since 2026-07-13).** Subject = `feat:`/`fix:`/`perf:`/`chore:` prefix + one plain-English sentence that says WHY the change exists / what it does for the project — readable without knowing bead IDs or project codenames ("make backend tests run in parallel (5 min -> 13 s)", not "per-package test databases, no -p 1"). Mechanism and detail go in the body. The beads issue ID goes on the LAST line as a `Bead: winzy.ai-xxx` trailer — never in the subject.
- **Push in batches, not per commit.** Push once per work session/milestone, or when the user asks — not after every commit.
- **Quality gates before every push** — CI runs on `main` after the fact; run the gates listed under Workflow step 5 first.
- **Railway deploys are manual, via the `railway` CLI** (`railway up`). Services are NOT repo-connected — pushing `main` does not deploy. Claude operates Railway; the config source of truth is the Railway project itself (`winzy-staging`).

## Agent Instructions

This project uses **[br (beads_rust)](https://github.com/Dicklesworthstone/beads_rust)** for issue tracking — a local-first SQLite + JSONL issue tracker. Issues live in `.beads/` and are committed alongside code.

**Note:** `br` is non-invasive and never executes git commands automatically. After `br sync --flush-only`, you must manually run `git add .beads/ && git commit`.

### Commands

```bash
br list --status open --limit 0                   # All open issues
br show <id>                                      # Full issue details with dependencies
br create --title="..." --description="..." --type=task --priority=2
br close <id> --reason "explanation"              # Close with reason
br comments list <id>                             # View comments
br comments add <id> "message"                    # Add progress note
br dep add <issue> <depends-on>                   # Add dependency
```

### Workflow

1. **Start session** (After pulling from remote or starting new work):
   ```bash
   br doctor                 # Check health
   br sync --import-only     # Import latest changes from git
   br ready                  # Find available work
   ```
2. **Claim**: `br update <id> --claim`
3. **Work**: Implement the task (create beads issue BEFORE writing code)
4. **Complete**: `br close <id>`
5. **End session** — MANDATORY before saying "done":
   - File issues for remaining work
   - Run quality gates (if code changed):
     - Frontend: `npm run lint && npx tsc --noEmit && npm test`
     - Backend (from `backend/`): `gofmt -l .` (must be empty) `&& go vet -tags=integration ./... && go build ./... && go test -tags=integration ./...` (integration tests need `docker compose up -d winzy-db`)
     - If Dockerfiles changed: `docker compose build`
   - Close finished issues, update in-progress items
   - Sync, commit, push:
     ```bash
     br sync --flush-only
     git add <code files> .beads/
     git pull --rebase
     git push
     ```
     Push without asking once quality gates pass. Only pause to confirm when the push does something unusual (force-push, history rewrite, deleting things you didn't create).

### PM / Worker Split

Planning, review, and the bead lifecycle belong to the PM session (top-tier model); implementation beads are executed by worker sessions/agents (Sonnet/Opus). Rules for workers:

- Implement exactly **one bead**, following its `EXECUTION STEPS` in order; run the quality gates; then **stop and report** (files changed, decisions, full gate output, deviations, open questions).
- Workers **never close beads, never commit, never push**, and don't run `br` write commands. A bead is done when the PM has reviewed the diff against the acceptance criteria — not when the worker says so.
- If a bead has no `EXECUTION STEPS` section, it hasn't been dispatched yet — don't start it.

### Core Rule

**Every work item is an issue.** Including meta-work (reviews, refactoring, planning). If no matching issue exists, create one before you start.

**File issues immediately when you spot problems.** When you discover a bug, gap, or technical debt while doing other work — create a bead right away. Don't wait to be asked, don't leave it as a mental note.

### bv — Graph-Aware Triage

`bv` is a triage engine that reads `.beads/` and computes priority scores, critical paths, and parallel work plans.

**CRITICAL: Use ONLY `--robot-*` flags. Bare `bv` launches an interactive TUI that blocks your session.**

```bash
bv --robot-triage                        # Full triage: top picks, quick wins, blockers, health
bv --robot-next                          # Single highest-impact next action
bv --robot-plan --agents N               # Parallel execution tracks for N agents
bv --robot-priority                      # Top 10 by impact score with what-if analysis
bv --robot-capacity --agents N           # Parallelizable %, estimated days, bottlenecks
bv --export-graph file.html              # Interactive dependency graph in browser
```
