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

**⚠️ Backend rewrite in progress (decided 2026-07-09, epic `winzy.ai-rdc7`):** the .NET microservices + NATS + per-service Postgres are being replaced by a **single Go service + one Postgres** (the microservices were a school requirement, not a product need). All features are kept; the C# services and their tests are the porting spec. The Key Design Decisions below describe the current live system and stay binding until cutover (`winzy.ai-rdc7.10`).

## Key Design Decisions

These are the non-obvious choices that agents get wrong without being told:

- **JetStream, not core NATS.** `user.deleted` cascades to 5 services that must all process it (data cleanup, GDPR). Core NATS is fire-and-forget — a restarting service silently misses the event.
- **Gateway validates JWT, services trust X-User-Id.** Services never re-validate tokens. The gateway strips any client-supplied `X-User-Id` and sets it from JWT claims. Never expose service ports directly.
- **Gateway must NOT reference Winzy.Common.** The gateway has no NATS dependency. If it needs shared types, reference `Winzy.Contracts` directly.
- **NATS subjects have no prefix.** `user.registered`, not `events.user.registered`. Matches `Subjects.cs` constants.
- **Result pattern for business logic errors.** Return result types, don't throw exceptions for expected failures (validation, not-found, conflict).
- **Gateway is exposed on port 5050, not 5000.** Port 5000 conflicts with macOS AirPlay Receiver. The gateway listens on 5000 internally, docker-compose maps `5050:5000`.
- **No direct DB access across services.** Each service owns its data. Cross-service data via REST or NATS only.
- **Internal endpoints stay internal.** Endpoints like `GET /habits/user/{userId}` are service-to-service only — never exposed through the Gateway.
- **Public endpoints are explicit.** Only these work without auth: `/auth/register`, `/auth/login`, `/auth/refresh`, `/habits/public/{username}`, `/notifications/vapid-public-key`.
- **Every service implements `GET /health`.** Returns service status, DB connectivity, and NATS connection status. Gateway aggregates all health checks.
- **Services return results, UI shows feedback.** Backend services never format user-facing messages. They return structured data; the frontend decides how to present it.

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
- **Push in batches, not per commit.** The pre-push hook rebuilds and re-tests every changed service (slow), so push once per work session/milestone, or when the user asks — not after every commit.
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
     - Backend: `dotnet format --verify-no-changes && dotnet build && dotnet test`
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
