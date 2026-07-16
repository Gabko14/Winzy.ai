# Winzy.ai

A habit tracker with an optional social layer. Track daily habits and share your progress through **The Flame** — a visual consistency indicator friends can see at `winzy.ai/@username`, no account needed. Knowing someone *can* see your Flame is the accountability; no messages, no nudges, no streak anxiety.

See [VISION.md](VISION.md) for the full product philosophy.

## Stack

- **Frontend** — Expo / React Native, web-first PWA ([`frontend/`](frontend/))
- **Backend** — a single Go service ([`backend/`](backend/)) with one PostgreSQL database. Modules: auth, habits, social, challenges, notifications, activity. The API also serves the exported web bundle same-origin.
- **Docs** — agent/working rules in [CLAUDE.md](CLAUDE.md)

## Running locally

```bash
cp .env.example .env    # once

# Backend stack (API on http://localhost:5050, Postgres on localhost:5439)
docker compose up -d --build

# Frontend (Expo web)
cd frontend && npm install && npm run web
```

## Tests

```bash
make test-backend              # Go unit + integration (needs winzy-db from compose)
cd frontend && npm test        # frontend (Jest)
cd e2e && npm test             # end-to-end (Playwright, needs the compose stack up)
```

## Deployment

Deployed on Railway (`winzy-staging`): the `api-gateway` service runs the Go binary (built from [`backend/Dockerfile.railway`](backend/Dockerfile.railway), configured by [`railway.json`](railway.json)) next to one PostgreSQL service. Deploys are manual — `railway up --service api-gateway` via the Railway CLI; pushing `main` does not deploy. Secrets live in the Railway dashboard.

## Issue tracking

Issues live in [`.beads/`](.beads/) and are managed with [br (beads_rust)](https://github.com/Dicklesworthstone/beads_rust) — see CLAUDE.md for the workflow.
