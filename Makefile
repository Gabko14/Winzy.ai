.PHONY: lint lint-frontend lint-backend format format-frontend format-backend check test test-frontend test-backend

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

# Backend
lint-backend:
	dotnet format --verify-no-changes

format-backend:
	dotnet format

check-backend:
	dotnet format --verify-no-changes

# Testing
test: test-frontend test-backend

test-frontend:
	cd frontend && npm test

test-backend:
	./test-backend.sh
