# E2E Test Data Strategy

E2E runs against the real stack: `docker compose up -d --build` boots the Go API + Postgres, and each test creates its own users and data through the API (see `fixtures/base.ts` and the `setup*` helpers in the specs). There are no shared seed fixtures.

### Principles

- Every test is self-contained — it registers unique users (timestamped names) and never depends on data created by another test.
- The auth setup project (`fixtures/auth.setup.ts`) registers/logs in a real test user via the API.
- For a populated local dev environment (not used by tests), run `scripts/seed.sh` from the repo root.
