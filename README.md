# Winzy.ai

A habit tracker with an optional social layer. Track daily habits and share your progress through **The Flame** — a visual consistency indicator friends can see at `winzy.ai/@username`, no account needed. Knowing someone *can* see your Flame is the accountability; no messages, no nudges, no streak anxiety.

See [VISION.md](VISION.md) for the full product philosophy.

## Stack

- **Frontend** — Expo / React Native, web-first PWA ([`frontend/`](frontend/))
- **Backend** — .NET 10 microservices behind a YARP gateway ([`services/`](services/)): auth, habits, social, challenges, notifications, activity
- **Messaging** — NATS JetStream for cross-service events; one PostgreSQL database per service
- **Docs** — [Flame architecture](docs/architecture.html), [ADRs](docs/decisions/), agent/working rules in [CLAUDE.md](CLAUDE.md)

## Running locally

```bash
# Backend stack (gateway on http://localhost:5050, Seq logs on http://localhost:5341)
docker compose up -d --build

# Frontend (Expo web)
cd frontend && npm install && npm run web
```

The gateway is the only public surface — services are reached through it, never directly.

## Tests

```bash
dotnet test                    # backend (from repo root)
cd frontend && npm test        # frontend (Jest)
cd e2e && npm test             # end-to-end (Playwright, needs the compose stack up)
```

## Deployment

Deployed on Railway: gateway (serving the exported web bundle same-origin) + private services, six PostgreSQL services, and NATS with a persistent JetStream volume. Topology and secrets are managed in the Railway dashboard; Railway-specific images are `services/gateway/Dockerfile.railway` and `services/nats/Dockerfile.railway`.

## Issue tracking

Issues live in [`.beads/`](.beads/) and are managed with [br (beads_rust)](https://github.com/Dicklesworthstone/beads_rust) — see CLAUDE.md for the workflow.
