# CLAUDE.md

> Keep this file concise. Focus on project-specific decisions and non-obvious patterns.

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

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Expo (web-first PWA) |
| Backend | .NET 10 Minimal APIs (C#) |
| Database | PostgreSQL (one per service, EF Core) |
| Messaging | NATS (pub/sub for events) |
| Gateway | YARP (routing, JWT validation, rate limiting) |
| Auth | JWT (Argon2id password hashing) |
| Containers | Docker + Docker Compose |
| Testing | xUnit + Testcontainers (backend), Jest (frontend), Playwright (E2E) |
| CI/CD | GitHub Actions (per-service workflows) |

## Architecture

7 services in a Docker Compose network. Frontend talks only to the Gateway. Services communicate via REST (sync) or NATS (async events).

| Service | Port | DB | Responsibility |
|---------|------|-----|---------------|
| API Gateway (YARP) | 5000 | — | Routing, JWT validation, rate limiting, health aggregation |
| Auth Service | 5001 | auth_db | Registration, login, JWT, profile management |
| Habit Service | 5002 | habit_db | Habit CRUD, completions, consistency calculation |
| Social Service | 5003 | social_db | Friendships, visibility rules |
| Challenge Service | 5004 | challenge_db | Challenges, milestones, progress tracking |
| Notification Service | 5005 | notification_db | Push notifications, reminders |
| Activity Service | 5006 | activity_db | Activity feed, event aggregation |

### Mono-repo Structure

```
frontend/                      # React + Expo app
services/
  gateway/                     # YARP API Gateway
  auth-service/                # Each service contains:
  habit-service/               #   src/   → .NET Minimal API project
  social-service/              #   tests/ → xUnit + Testcontainers
  challenge-service/           #   Dockerfile
  notification-service/
  activity-service/
shared/
  Winzy.Contracts/             # NATS event types, shared DTOs
  Winzy.Common/                # NATS helpers, health check base, common middleware
Winzy.sln
docker-compose.yml
```

### NATS Events

| Event | Publisher | Subscribers |
|-------|----------|------------|
| `user.registered` | Auth | Activity |
| `user.deleted` | Auth | Habit, Social, Challenge, Notification, Activity |
| `habit.created` | Habit | Activity |
| `habit.completed` | Habit | Challenge, Notification, Activity |
| `friend.request.sent` | Social | Notification |
| `friend.request.accepted` | Social | Notification, Activity |
| `challenge.created` | Challenge | Notification, Activity |
| `challenge.completed` | Challenge | Notification, Activity |

## Non-Negotiables

- **No code without tests.** Unit tests for business logic, integration tests for endpoints. 80%+ coverage per service.
- **No direct DB access across services.** Each service owns its data. Cross-service data via REST or NATS only.
- **Internal endpoints stay internal.** Endpoints like `GET /habits/user/{userId}` are service-to-service only — never exposed through the Gateway.
- **Public endpoints are explicit.** Only these work without auth: `/auth/register`, `/auth/login`, `/auth/refresh`, `/habits/public/{username}`.
- **Every service implements `GET /health`.** Returns service status, DB connectivity, and NATS connection status. Gateway aggregates all health checks.
- **Services return results, UI shows feedback.** Backend services never format user-facing messages. They return structured data; the frontend decides how to present it.

## Backend Conventions

**Project structure per service:**
```
services/{name}/src/
  Program.cs          — DI + endpoint mapping
  Endpoints/          — Static classes with MapGroup
  Entities/           — EF Core entity classes
  Services/           — Business logic interfaces + implementations
  Data/               — DbContext + migrations
```

**Key patterns:**
- Minimal API endpoint groups — static classes returning `RouteGroupBuilder` via `MapGroup`
- Result pattern for error handling — no exceptions for business logic flow
- `user_id` from `X-User-Id` header (set by Gateway after JWT validation, never parsed from JWT in downstream services)
- Standard response shape: `{ data: T }` on success, `{ error: string, details?: string[] }` on failure
- File-scoped namespaces, primary constructors, `var` everywhere
- Private fields: `_camelCase`, constants: `PascalCase`
- Test naming: `MethodName_Scenario_ExpectedResult`
- Async methods end with `Async` suffix (except middleware `InvokeAsync` and endpoint lambdas)

## Commands

```bash
# Frontend
cd frontend && npm start         # Expo dev server
npm run lint && npx tsc --noEmit # Lint + typecheck
npm test                         # Jest

# Backend (per service)
cd services/<service>/src && dotnet build && dotnet test
dotnet format --verify-no-changes  # Format check

# Infrastructure
docker compose up -d             # Start all services
docker compose build             # Rebuild after Dockerfile changes

# Tools
br ready                         # Find available work (beads)
gh pr create                     # Create PR
```

## Naming Conventions

- **C#:** PascalCase (types, methods, properties), camelCase (locals, parameters)
- **TypeScript:** camelCase (variables, functions), PascalCase (components, types)
- **C# files:** PascalCase (`HabitService.cs`, `HabitEndpoints.cs`)
- **TypeScript files:** kebab-case (`flame-visualization.tsx`, `use-habits.ts`)
- **Directories:** kebab-case (`auth-service/`, `habit-service/`), except .NET project names under `shared/` which use PascalCase (`Winzy.Contracts/`, `Winzy.Common/`)
- **NATS subjects:** dot-separated lowercase (`habit.completed`, `user.registered`)

## Git Workflow

**All changes go through PRs. No direct pushes to `main`.**

- New task = new branch from main
- Branch naming: `feature/description` or `fix/description`
- Conventional commits referencing beads issues
- Delete branches after merge (local and remote)

### PR Workflow

**NEVER merge without explicit user approval.** After checks/review pass, ASK the user before merging.

1. Push branch, create PR: `gh pr create`
2. Wait for checks: `gh pr checks <number> --watch`
3. Read review: `gh pr view <number> --comments` — **NEVER skip this, even for non-code PRs**
4. Evaluate feedback critically — fix legit issues (bugs, security, logic), ignore noise (style nitpicks, "optional" suggestions)
5. Push fixes, wait for re-review if needed. Repeat 2-4 until approved.
6. **Ask the user for merge approval** — they may want to test or review the diff first
7. Merge and cleanup:
   ```bash
   gh pr merge <number> --squash --delete-branch
   git checkout main && git pull
   git branch -d <branch>
   ```

## Agent Instructions

This project uses **[br (beads_rust)](https://github.com/Dicklesworthstone/beads_rust)** for issue tracking — a local-first SQLite + JSONL issue tracker. Issues live in `.beads/` and are committed alongside code.

**Note:** `br` is non-invasive and never executes git commands automatically. After `br sync --flush-only`, you must manually run `git add .beads/ && git commit`.

**Install:** `curl -fsSL "https://raw.githubusercontent.com/Dicklesworthstone/beads_rust/main/install.sh?$(date +%s)" | bash`

### Commands

```bash
br ready                                          # Find available work (no blockers)
br list --status open --limit 0                   # All open issues
br show <id>                                      # Full issue details with dependencies
br create --title="..." --description="..." --type=task --priority=2
br update <id> --claim                            # Claim work (sets in_progress)
br close <id>                                     # Complete work
br close <id> --reason "explanation"              # Close with reason
br comments list <id>                             # View comments
br comments add <id> "message"                    # Add progress note
br dep add <issue> <depends-on>                   # Add dependency
br sync --flush-only                              # Export to JSONL (then git add/commit manually)
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
5. **End session** — 🚨 MANDATORY before saying "done":
   - File issues for remaining work
   - Run quality gates (if code changed):
     - Frontend: `npm run lint && npx tsc --noEmit && npm test`
     - Backend: `dotnet format --verify-no-changes && dotnet build && dotnet test`
     - If Dockerfiles changed: `docker compose build`
   - Close finished issues, update in-progress items
   - Push:
     ```bash
     br sync --flush-only
     git add <code files> .beads/
     git pull --rebase
     git commit -m "..." && git push
     ```

**CRITICAL:** Work is NOT complete until `git push` succeeds. NEVER say "ready to push when you are" — YOU must push. Do NOT use markdown TODOs for task tracking.

### Core Rule

**Every work item is an issue.** Including meta-work (reviews, refactoring, planning). If no matching issue exists, create one before you start.

### Key Concepts

- **Dependencies**: Issues can block other issues. `br ready` shows only unblocked work.
- **Epics**: Group related issues with `--parent`. Use `br epic status` to see progress.
- **Priority**: P0=critical, P1=high, P2=medium, P3=low, P4=backlog (use numbers, not words)
- **Types**: task, bug, feature, epic, chore, decision
- **Comments vs new issues**: Use `br comments add <id> "message"` for progress updates, decisions, blockers, and notes. Only create a new issue for genuinely separate work.
