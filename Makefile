.PHONY: lint lint-frontend lint-backend format format-frontend format-backend check test test-frontend test-backend test-e2e e2e-install e2e-report

# Run all linting
lint: lint-frontend lint-backend

# Run all format checks
check: check-frontend check-backend

# Frontend
lint-frontend:
	cd frontend && npm run lint

lint-fix-frontend:
	cd frontend && npm run lint:fix

format-frontend:
	cd frontend && npm run format

check-frontend:
	cd frontend && npm run lint && npm run format:check

# Backend (Go)
lint-backend:
	cd backend && test -z "$$(gofmt -l .)" && go vet -tags=integration ./...

format-backend:
	cd backend && gofmt -w .

check-backend:
	cd backend && test -z "$$(gofmt -l .)"

# Testing
test: test-frontend test-backend

test-frontend:
	cd frontend && npm test

# Integration tests need Postgres: docker compose up -d winzy-db (host port 5439)
test-backend:
	cd backend && TEST_DATABASE_URL=$${TEST_DATABASE_URL:-postgres://winzy:winzy@localhost:5439/winzy?sslmode=disable} go test -tags=integration ./...

# E2E (Playwright)
e2e-install:
	cd e2e && npm install && npx playwright install chromium

test-e2e:
	cd e2e && npx playwright test

e2e-report:
	cd e2e && npx playwright show-report
