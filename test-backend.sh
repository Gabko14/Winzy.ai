#!/usr/bin/env bash
set -euo pipefail

# Run all backend tests sequentially to avoid file-locking issues
# Usage: ./test-backend.sh [--coverage]

ROOT="$(cd "$(dirname "$0")" && pwd)"
COVERAGE_FLAG=""
EXIT_CODE=0

if [[ "${1:-}" == "--coverage" ]]; then
    COVERAGE_FLAG='--collect:"XPlat Code Coverage"'
fi

PROJECTS=(
    "shared/Winzy.Common.Tests"
    "services/auth-service/tests"
    "services/habit-service/tests"
    "services/social-service/tests"
    "services/challenge-service/tests"
    "services/notification-service/tests"
    "services/activity-service/tests"
    "services/gateway/tests"
)

for PROJECT in "${PROJECTS[@]}"; do
    PROJECT_PATH="$ROOT/$PROJECT"
    echo ""
    echo "========================================="
    echo "Testing: $PROJECT"
    echo "========================================="

    if eval dotnet test "$PROJECT_PATH" --no-restore "$COVERAGE_FLAG" --logger '"console;verbosity=minimal"' --results-directory "$ROOT/test-results"; then
        echo "PASSED: $PROJECT"
    else
        echo "FAILED: $PROJECT"
        EXIT_CODE=1
    fi
done

echo ""
echo "========================================="
if [[ $EXIT_CODE -eq 0 ]]; then
    echo "All backend tests passed."
else
    echo "Some tests failed. See output above."
fi
echo "========================================="

exit $EXIT_CODE
