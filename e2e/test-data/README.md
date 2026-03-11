# E2E Test Data Strategy

## Current Approach (Pre-Backend)

Tests currently run against the frontend dev server only. No backend seeding is needed yet.
Auth is stubbed via an empty `storageState` in `e2e/.auth/user.json`.

## Future Approach (With Backend)

Once backend services are integrated into E2E runs:

1. **Docker Compose** spins up all services (gateway, auth, habits, PostgreSQL, NATS).
2. **Seed scripts** in this directory populate the database with deterministic test data.
3. **Auth setup** (`fixtures/auth.setup.ts`) registers/logs in a real test user via the API.
4. **Cleanup** happens via `docker compose down -v` (volumes removed) after each CI run.

### Seed Data Files

Place JSON fixtures here that seed scripts will load:

- `users.json` — test user accounts
- `habits.json` — pre-created habits for testing
- `completions.json` — habit completion history for flame calculation tests

### Principles

- Every test run starts from the same known state.
- Seed data is committed to the repo (no external dependencies).
- Tests never depend on data created by other tests.
- Use unique identifiers per test to avoid cross-test interference.
