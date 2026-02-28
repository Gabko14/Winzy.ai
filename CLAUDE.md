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
bd ready                         # Find available work (beads)
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

This project uses **[beads](https://github.com/steveyegge/beads)** for issue tracking — a git-backed CLI issue tracker. Issues live in `.beads/` and are committed alongside code.

**Setup:** `brew install beads && bd onboard` (macOS/Linux) or `winget install beads` (Windows)

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
```

### Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed):
   - Frontend: `npm run lint && npx tsc --noEmit && npm test`
   - Backend (each changed service): `dotnet format --verify-no-changes && dotnet build && dotnet test`
   - If Dockerfiles changed: `docker compose build`
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds


### Essential Commands

```bash
bd ready              # Show issues ready to work (no blockers)
bd list --status=open # All open issues
bd show <id>          # Full issue details with dependencies
bd create --title="..." --description="..." --type=task --priority=2
bd update <id> --status=in_progress
bd close <id> --reason="Completed"
bd close <id1> <id2>  # Close multiple issues at once
bd comments <id>                    # View comments on an issue
bd comments add <id> "message"      # Add a progress note
bd sync               # Commit and push changes
```

### Workflow Pattern

1. **Start**: Run `bd ready` to find actionable work
2. **Claim**: Use `bd update <id> --status=in_progress`
3. **Work**: Implement the task
4. **Complete**: Use `bd close <id>`
5. **Sync**: Always run `bd sync` at session end

### Core Rule

**Every work item is an issue.** Including meta-work (reviews, refactoring, planning). If no matching issue exists, create one before you start.

### Key Concepts

- **Dependencies**: Issues can block other issues. `bd ready` shows only unblocked work.
- **Epics**: Group related issues with `--parent`. Use `bd epic status` to see progress.
- **Priority**: P0=critical, P1=high, P2=medium, P3=low, P4=backlog (use numbers, not words)
- **Types**: task, bug, feature, epic, chore, decision
- **Blocking**: `bd dep add <issue> <depends-on>` to add dependencies

### Session Protocol

**Before ending any session, run this checklist:**

```bash
git status              # Check what changed
git add <files>         # Stage code changes
bd sync                 # Commit beads changes
git commit -m "..."     # Commit code
bd sync                 # Commit any new beads changes
git push                # Push to remote
bd doctor --fix --yes   # Fix any beads issues (locks, sync drift, etc.)
```

### Comments vs New Issues

Use `bd comments add <id> "message"` for:
- Progress updates on existing work
- Decisions made, approaches tried
- Blockers encountered
- Notes for the next session

Only create a new bead when it's a **genuinely separate piece of work**.

### Best Practices

- Check `bd ready` at session start to find available work
- Update status as you work (in_progress → closed)
- Create new issues with `bd create` when you discover tasks (description is required)
- Use descriptive titles and set appropriate priority/type
- Use `bd comments` to track progress on issues instead of creating unnecessary new beads
- Always `bd sync` before ending session
