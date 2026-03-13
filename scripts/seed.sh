#!/usr/bin/env bash
# =============================================================================
# Winzy.ai — Local Development Data Seeding Script
# =============================================================================
#
# Populates the running local stack with deterministic test data through the
# API Gateway (port 5050). Safe to re-run: registration conflicts (409) are
# treated as success, and the script logs in to get fresh tokens.
#
# Prerequisites:
#   docker compose up -d   # all services healthy
#
# Usage:
#   ./scripts/seed.sh                     # default: gateway at localhost:5050
#   GATEWAY=http://localhost:5050 ./scripts/seed.sh
#
# Seeded domains:
#   - Auth:      4 users (alice, bob, charlie, diana)
#   - Habits:    2-3 habits per user (daily, weekly, custom frequencies)
#   - Completions: 30 days of varied completion patterns per habit
#   - Social:    friendships (alice<->bob, alice<->charlie, bob<->charlie)
#   - Visibility: per-user defaults + per-habit overrides
#   - Challenges: alice challenges bob on a habit
#
# Out of scope (derived consumers):
#   Notifications and Activity Feed entries are created asynchronously by
#   NATS consumers reacting to the events above. This script does NOT verify
#   their output. If you need to test those, check the /notifications and
#   /activity/feed endpoints after seeding.
#
# Demo scenarios (see SCENARIOS section at the bottom of this file):
#   1. Public flame page:     GET /habits/public/alice
#   2. Friends-only viewing:  login as bob, GET /social/friends/{alice_id}/profile
#   3. Private user:          diana has habits but no friends — nothing visible externally
#   4. Challenge in progress: alice challenged bob — check GET /challenges as bob
#   5. Varied flame levels:   alice (high consistency), charlie (low), diana (medium)
# =============================================================================

set -euo pipefail

GATEWAY="${GATEWAY:-http://localhost:5050}"
PASSWORD="Test1234!"
TZ_HEADER="America/New_York"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
PASS=0
FAIL=0

log_step()  { echo -e "${BLUE}[STEP]${NC}  $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $1"; PASS=$((PASS + 1)); }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_fail()  { echo -e "${RED}[FAIL]${NC}  $1"; FAIL=$((FAIL + 1)); }
log_info()  { echo -e "        $1"; }

# ---------------------------------------------------------------------------
# Helper: make an HTTP request, capture status + body
# Usage: api METHOD path [body] [extra_curl_args...]
#   Sets: HTTP_STATUS, HTTP_BODY
# ---------------------------------------------------------------------------
HTTP_STATUS=""
HTTP_BODY=""

api() {
    local method="$1" path="$2" body="${3:-}" token="${4:-}"
    local -a curl_args=(
        -s -w '\n%{http_code}'
        -X "$method"
        -H 'Content-Type: application/json'
    )
    if [[ -n "$token" ]]; then
        curl_args+=(-H "Authorization: Bearer $token")
    fi
    if [[ -n "$body" ]]; then
        curl_args+=(-d "$body")
    fi

    local raw
    raw=$(curl "${curl_args[@]}" "${GATEWAY}${path}")
    HTTP_STATUS=$(echo "$raw" | tail -1)
    HTTP_BODY=$(echo "$raw" | sed '$d')
}

# ---------------------------------------------------------------------------
# Helper: extract JSON field (requires jq)
# ---------------------------------------------------------------------------
json_field() {
    echo "$1" | jq -r "$2" 2>/dev/null || echo ""
}

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
echo ""
echo "======================================================================"
echo "  Winzy.ai Data Seeder"
echo "  Gateway: $GATEWAY"
echo "======================================================================"
echo ""

if ! command -v jq &>/dev/null; then
    log_fail "jq is required but not installed. Install with: brew install jq"
    exit 1
fi

if ! command -v curl &>/dev/null; then
    log_fail "curl is required but not installed."
    exit 1
fi

log_step "Checking gateway health..."
api GET /health
if [[ "$HTTP_STATUS" == "200" ]]; then
    log_ok "Gateway is healthy"
else
    log_fail "Gateway health check failed (HTTP $HTTP_STATUS). Is the stack running?"
    log_info "Run: docker compose up -d"
    exit 1
fi

# ============================================================================
# 1. USERS
# ============================================================================
echo ""
log_step "=== Phase 1: Register Users ==="

declare -A USER_TOKENS
declare -A USER_IDS

register_and_login() {
    local username="$1" email="$2" display_name="$3"

    log_step "Registering $username..."
    api POST /auth/register "{
        \"email\": \"$email\",
        \"username\": \"$username\",
        \"password\": \"$PASSWORD\",
        \"displayName\": \"$display_name\"
    }"

    if [[ "$HTTP_STATUS" == "201" ]]; then
        log_ok "Registered $username"
        USER_TOKENS[$username]=$(json_field "$HTTP_BODY" '.accessToken')
        USER_IDS[$username]=$(json_field "$HTTP_BODY" '.user.id')
        log_info "  id: ${USER_IDS[$username]}"
        return
    elif [[ "$HTTP_STATUS" == "409" ]]; then
        log_warn "$username already exists, logging in..."
    else
        log_fail "Failed to register $username (HTTP $HTTP_STATUS): $HTTP_BODY"
        return
    fi

    # Login instead
    api POST /auth/login "{
        \"emailOrUsername\": \"$username\",
        \"password\": \"$PASSWORD\"
    }"

    if [[ "$HTTP_STATUS" == "200" ]]; then
        log_ok "Logged in as $username"
        USER_TOKENS[$username]=$(json_field "$HTTP_BODY" '.accessToken')
        USER_IDS[$username]=$(json_field "$HTTP_BODY" '.user.id')
        log_info "  id: ${USER_IDS[$username]}"
    else
        log_fail "Failed to login as $username (HTTP $HTTP_STATUS): $HTTP_BODY"
    fi
}

register_and_login "alice"   "alice@winzy.test"   "Alice Johnson"
register_and_login "bob"     "bob@winzy.test"     "Bob Smith"
register_and_login "charlie" "charlie@winzy.test"  "Charlie Brown"
register_and_login "diana"   "diana@winzy.test"    "Diana Prince"

# Verify all users have tokens
for user in alice bob charlie diana; do
    if [[ -z "${USER_TOKENS[$user]:-}" ]]; then
        log_fail "No token for $user — cannot continue"
        exit 1
    fi
done

# ============================================================================
# 2. HABITS
# ============================================================================
echo ""
log_step "=== Phase 2: Create Habits ==="

declare -A HABIT_IDS

create_habit() {
    local username="$1" habit_key="$2" name="$3" icon="$4" color="$5" frequency="$6" custom_days="${7:-}"
    local token="${USER_TOKENS[$username]}"

    local body
    if [[ "$frequency" == "custom" && -n "$custom_days" ]]; then
        body="{\"name\":\"$name\",\"icon\":\"$icon\",\"color\":\"$color\",\"frequency\":\"$frequency\",\"customDays\":[$custom_days]}"
    else
        body="{\"name\":\"$name\",\"icon\":\"$icon\",\"color\":\"$color\",\"frequency\":\"$frequency\"}"
    fi

    log_step "Creating habit '$name' for $username..."
    api POST /habits "$body" "$token"

    if [[ "$HTTP_STATUS" == "201" ]]; then
        local hid
        hid=$(json_field "$HTTP_BODY" '.id')
        HABIT_IDS[$habit_key]="$hid"
        log_ok "Created habit '$name' (id: $hid)"
    elif [[ "$HTTP_STATUS" == "409" ]]; then
        log_warn "Habit '$name' may already exist for $username"
    else
        log_fail "Failed to create habit '$name' for $username (HTTP $HTTP_STATUS): $HTTP_BODY"
    fi
}

# Alice: high-consistency user — daily meditation, weekly review
create_habit alice "alice_meditate"  "Meditation"    "🧘" "#7C3AED" "daily"
create_habit alice "alice_exercise"  "Exercise"      "💪" "#DC2626" "daily"
create_habit alice "alice_review"    "Weekly Review"  "📝" "#2563EB" "weekly"

# Bob: moderate user — daily reading, MWF workout
create_habit bob "bob_read"     "Read 30 min"   "📚" "#059669" "daily"
create_habit bob "bob_workout"  "Gym Workout"   "🏋️" "#D97706" "custom" "\"monday\",\"wednesday\",\"friday\""

# Charlie: low-consistency user — tries daily habits but misses a lot
create_habit charlie "charlie_journal" "Journaling"   "✍️" "#8B5CF6" "daily"
create_habit charlie "charlie_walk"    "Evening Walk"  "🚶" "#10B981" "daily"

# Diana: medium consistency, no friends — habits are private
create_habit diana "diana_code"   "Coding Practice" "💻" "#3B82F6" "daily"
create_habit diana "diana_piano"  "Piano Practice"  "🎹" "#EC4899" "custom" "\"tuesday\",\"thursday\",\"saturday\""

# If habits already existed, we need to fetch them
fetch_habits_if_needed() {
    local username="$1" token="${USER_TOKENS[$1]}"

    api GET /habits "" "$token"
    if [[ "$HTTP_STATUS" == "200" ]]; then
        echo "$HTTP_BODY"
    else
        echo "[]"
    fi
}

# Check if any habit IDs are missing and try to fetch
needs_fetch=false
for key in alice_meditate alice_exercise alice_review bob_read bob_workout charlie_journal charlie_walk diana_code diana_piano; do
    if [[ -z "${HABIT_IDS[$key]:-}" ]]; then
        needs_fetch=true
        break
    fi
done

if [[ "$needs_fetch" == "true" ]]; then
    log_step "Some habits may already exist, fetching current habits..."

    for username in alice bob charlie diana; do
        habits_json=$(fetch_habits_if_needed "$username")

        # Map habit names back to keys
        while IFS= read -r habit_line; do
            h_id=$(echo "$habit_line" | jq -r '.id')
            h_name=$(echo "$habit_line" | jq -r '.name')

            case "${username}_${h_name}" in
                alice_Meditation)       HABIT_IDS[alice_meditate]="$h_id" ;;
                alice_Exercise)         HABIT_IDS[alice_exercise]="$h_id" ;;
                "alice_Weekly Review")  HABIT_IDS[alice_review]="$h_id" ;;
                "bob_Read 30 min")     HABIT_IDS[bob_read]="$h_id" ;;
                "bob_Gym Workout")     HABIT_IDS[bob_workout]="$h_id" ;;
                charlie_Journaling)    HABIT_IDS[charlie_journal]="$h_id" ;;
                "charlie_Evening Walk") HABIT_IDS[charlie_walk]="$h_id" ;;
                "diana_Coding Practice") HABIT_IDS[diana_code]="$h_id" ;;
                "diana_Piano Practice") HABIT_IDS[diana_piano]="$h_id" ;;
            esac
        done < <(echo "$habits_json" | jq -c '.[]' 2>/dev/null)
    done

    # Report what we found
    for key in alice_meditate alice_exercise alice_review bob_read bob_workout charlie_journal charlie_walk diana_code diana_piano; do
        if [[ -n "${HABIT_IDS[$key]:-}" ]]; then
            log_info "  $key -> ${HABIT_IDS[$key]}"
        else
            log_warn "  $key -> NOT FOUND (completions/challenges for this habit will be skipped)"
        fi
    done
fi

# ============================================================================
# 3. COMPLETIONS
# ============================================================================
echo ""
log_step "=== Phase 3: Log Completions (past 30 days) ==="

log_completion() {
    local username="$1" habit_key="$2" date="$3"
    local token="${USER_TOKENS[$username]}"
    local habit_id="${HABIT_IDS[$habit_key]:-}"

    if [[ -z "$habit_id" ]]; then
        return
    fi

    api POST "/habits/$habit_id/complete" \
        "{\"date\":\"$date\",\"timezone\":\"$TZ_HEADER\"}" \
        "$token"

    # 201 = created, 409 = already completed (idempotent)
    if [[ "$HTTP_STATUS" == "201" || "$HTTP_STATUS" == "409" ]]; then
        return 0
    else
        log_warn "Completion failed for $habit_key on $date (HTTP $HTTP_STATUS)"
        return 0
    fi
}

# Generate dates for the past N days
get_past_date() {
    # macOS date syntax
    if date -v-1d +%Y-%m-%d &>/dev/null 2>&1; then
        date -v-"${1}"d +%Y-%m-%d
    else
        # GNU date syntax
        date -d "$1 days ago" +%Y-%m-%d
    fi
}

# Alice: high consistency — completes meditation 28/30 days, exercise 25/30, review every week
log_step "Logging completions for alice (high consistency)..."
alice_count=0
for i in $(seq 0 29); do
    d=$(get_past_date "$i")
    dow=$(date -j -f "%Y-%m-%d" "$d" +%u 2>/dev/null || date -d "$d" +%u)

    # Meditation: skip day 5 and 18 only
    if [[ $i -ne 5 && $i -ne 18 ]]; then
        log_completion alice alice_meditate "$d"
        alice_count=$((alice_count + 1))
    fi

    # Exercise: skip days 3, 10, 15, 22, 28
    if [[ $i -ne 3 && $i -ne 10 && $i -ne 15 && $i -ne 22 && $i -ne 28 ]]; then
        log_completion alice alice_exercise "$d"
        alice_count=$((alice_count + 1))
    fi

    # Weekly review: only on Sundays (dow=7)
    if [[ "$dow" == "7" ]]; then
        log_completion alice alice_review "$d"
        alice_count=$((alice_count + 1))
    fi
done
log_ok "Alice: $alice_count completion attempts"

# Bob: moderate consistency — reads 20/30 days, gym on MWF but misses some
log_step "Logging completions for bob (moderate consistency)..."
bob_count=0
for i in $(seq 0 29); do
    d=$(get_past_date "$i")
    dow=$(date -j -f "%Y-%m-%d" "$d" +%u 2>/dev/null || date -d "$d" +%u)

    # Reading: skip days 2,7,9,14,16,19,21,24,27,29
    skip=false
    for s in 2 7 9 14 16 19 21 24 27 29; do
        if [[ $i -eq $s ]]; then skip=true; break; fi
    done
    if [[ "$skip" == "false" ]]; then
        log_completion bob bob_read "$d"
        bob_count=$((bob_count + 1))
    fi

    # Gym: MWF (1,3,5) but skip some
    if [[ "$dow" == "1" || "$dow" == "3" || "$dow" == "5" ]]; then
        if [[ $i -ne 8 && $i -ne 20 ]]; then
            log_completion bob bob_workout "$d"
            bob_count=$((bob_count + 1))
        fi
    fi
done
log_ok "Bob: $bob_count completion attempts"

# Charlie: low consistency — journals ~10/30 days, walks ~8/30
log_step "Logging completions for charlie (low consistency)..."
charlie_count=0
for i in $(seq 0 29); do
    d=$(get_past_date "$i")

    # Journal: only days 0,1,4,8,12,15,18,22,25,28
    for s in 0 1 4 8 12 15 18 22 25 28; do
        if [[ $i -eq $s ]]; then
            log_completion charlie charlie_journal "$d"
            charlie_count=$((charlie_count + 1))
            break
        fi
    done

    # Walk: only days 0,3,6,10,14,20,24,27
    for s in 0 3 6 10 14 20 24 27; do
        if [[ $i -eq $s ]]; then
            log_completion charlie charlie_walk "$d"
            charlie_count=$((charlie_count + 1))
            break
        fi
    done
done
log_ok "Charlie: $charlie_count completion attempts"

# Diana: medium consistency — codes 18/30 days, piano on TTS but hits most
log_step "Logging completions for diana (medium consistency)..."
diana_count=0
for i in $(seq 0 29); do
    d=$(get_past_date "$i")
    dow=$(date -j -f "%Y-%m-%d" "$d" +%u 2>/dev/null || date -d "$d" +%u)

    # Coding: skip days 1,5,8,11,13,17,20,23,25,26,28,29
    skip=false
    for s in 1 5 8 11 13 17 20 23 25 26 28 29; do
        if [[ $i -eq $s ]]; then skip=true; break; fi
    done
    if [[ "$skip" == "false" ]]; then
        log_completion diana diana_code "$d"
        diana_count=$((diana_count + 1))
    fi

    # Piano: TTS (2,4,6) — miss a couple
    if [[ "$dow" == "2" || "$dow" == "4" || "$dow" == "6" ]]; then
        if [[ $i -ne 6 && $i -ne 19 ]]; then
            log_completion diana diana_piano "$d"
            diana_count=$((diana_count + 1))
        fi
    fi
done
log_ok "Diana: $diana_count completion attempts"

# ============================================================================
# 4. FRIENDSHIPS
# ============================================================================
echo ""
log_step "=== Phase 4: Create Friendships ==="

send_and_accept_friend_request() {
    local sender="$1" receiver="$2"
    local sender_token="${USER_TOKENS[$sender]}"
    local receiver_token="${USER_TOKENS[$receiver]}"
    local receiver_id="${USER_IDS[$receiver]}"

    log_step "Sending friend request: $sender -> $receiver..."
    api POST /social/friends/request \
        "{\"friendId\":\"$receiver_id\"}" \
        "$sender_token"

    local request_id=""
    if [[ "$HTTP_STATUS" == "201" ]]; then
        request_id=$(json_field "$HTTP_BODY" '.id')
        log_ok "Friend request sent (id: $request_id)"
    elif [[ "$HTTP_STATUS" == "409" ]]; then
        log_warn "Friendship already exists between $sender and $receiver"
        return 0
    else
        log_fail "Failed to send friend request $sender -> $receiver (HTTP $HTTP_STATUS): $HTTP_BODY"
        return 0
    fi

    if [[ -n "$request_id" ]]; then
        log_step "Accepting friend request: $receiver accepts from $sender..."
        api PUT "/social/friends/request/$request_id/accept" "" "$receiver_token"

        if [[ "$HTTP_STATUS" == "200" ]]; then
            log_ok "Friendship established: $sender <-> $receiver"
        else
            log_fail "Failed to accept friend request (HTTP $HTTP_STATUS): $HTTP_BODY"
        fi
    fi
}

send_and_accept_friend_request alice bob
send_and_accept_friend_request alice charlie
send_and_accept_friend_request bob   charlie
# diana has no friends (intentional — tests private/loner scenario)
log_info "Diana intentionally has no friends (private user scenario)"

# ============================================================================
# 5. VISIBILITY SETTINGS
# ============================================================================
echo ""
log_step "=== Phase 5: Set Visibility Preferences ==="

set_default_visibility() {
    local username="$1" visibility="$2"
    local token="${USER_TOKENS[$username]}"

    log_step "Setting default visibility for $username -> $visibility..."
    api PUT /social/preferences \
        "{\"defaultHabitVisibility\":\"$visibility\"}" \
        "$token"

    if [[ "$HTTP_STATUS" == "200" ]]; then
        log_ok "$username default visibility: $visibility"
    else
        log_fail "Failed to set visibility for $username (HTTP $HTTP_STATUS): $HTTP_BODY"
    fi
}

set_habit_visibility() {
    local username="$1" habit_key="$2" visibility="$3"
    local token="${USER_TOKENS[$username]}"
    local habit_id="${HABIT_IDS[$habit_key]:-}"

    if [[ -z "$habit_id" ]]; then
        log_warn "Skipping visibility for $habit_key (habit not found)"
        return
    fi

    log_step "Setting habit visibility: $habit_key -> $visibility..."
    api PUT "/social/visibility/$habit_id" \
        "{\"visibility\":\"$visibility\"}" \
        "$token"

    if [[ "$HTTP_STATUS" == "200" ]]; then
        log_ok "$habit_key visibility: $visibility"
    else
        log_fail "Failed to set visibility for $habit_key (HTTP $HTTP_STATUS): $HTTP_BODY"
    fi
}

# Alice: public by default (her flame page shows everything)
set_default_visibility alice "public"
# But keep Weekly Review private
set_habit_visibility alice "alice_review" "private"

# Bob: friends-only by default
set_default_visibility bob "friends"

# Charlie: private by default, but shares journaling with friends
set_default_visibility charlie "private"
set_habit_visibility charlie "charlie_journal" "friends"

# Diana: private (default), no overrides needed
set_default_visibility diana "private"

# ============================================================================
# 6. CHALLENGES
# ============================================================================
echo ""
log_step "=== Phase 6: Create Challenges ==="

alice_token="${USER_TOKENS[alice]}"
bob_id="${USER_IDS[bob]}"
bob_read_id="${HABIT_IDS[bob_read]:-}"

if [[ -n "$bob_read_id" ]]; then
    log_step "Alice challenges Bob: read 20 days in 30 days..."
    api POST /challenges "{
        \"habitId\": \"$bob_read_id\",
        \"recipientId\": \"$bob_id\",
        \"milestoneType\": \"daysInPeriod\",
        \"targetValue\": 20,
        \"periodDays\": 30,
        \"rewardDescription\": \"Coffee at the new place downtown\"
    }" "$alice_token"

    if [[ "$HTTP_STATUS" == "201" ]]; then
        local_challenge_id=$(json_field "$HTTP_BODY" '.id')
        log_ok "Challenge created (id: $local_challenge_id)"
        log_info "  Alice -> Bob: Read 30 min for 20/30 days"
        log_info "  Reward: Coffee at the new place downtown"
    elif [[ "$HTTP_STATUS" == "409" ]]; then
        log_warn "Active challenge already exists for this habit/recipient pair"
    else
        log_fail "Failed to create challenge (HTTP $HTTP_STATUS): $HTTP_BODY"
    fi
else
    log_warn "Skipping challenge creation: bob_read habit not found"
fi

# ============================================================================
# SUMMARY
# ============================================================================
echo ""
echo "======================================================================"
echo "  Seeding Complete"
echo "======================================================================"
echo ""
echo -e "  ${GREEN}Passed:${NC} $PASS"
echo -e "  ${RED}Failed:${NC} $FAIL"
echo ""
echo "  Users:"
for user in alice bob charlie diana; do
    echo "    @$user  id=${USER_IDS[$user]:-unknown}  password=$PASSWORD"
done
echo ""
echo "  Habits:"
for key in alice_meditate alice_exercise alice_review bob_read bob_workout charlie_journal charlie_walk diana_code diana_piano; do
    echo "    $key  id=${HABIT_IDS[$key]:-not_found}"
done
echo ""
echo "  Friendships:"
echo "    alice <-> bob       (mutual)"
echo "    alice <-> charlie   (mutual)"
echo "    bob   <-> charlie   (mutual)"
echo "    diana               (no friends)"
echo ""
echo "  Visibility defaults:"
echo "    alice:   public  (Weekly Review overridden to private)"
echo "    bob:     friends"
echo "    charlie: private (Journaling overridden to friends)"
echo "    diana:   private"
echo ""
echo "  Challenges:"
echo "    alice -> bob: Read 30 min, 20 days in 30 (reward: coffee)"
echo ""

# ============================================================================
# DEMO SCENARIOS
# ============================================================================
cat <<'SCENARIOS'
  ============================================
  Demo Scenarios
  ============================================

  1. PUBLIC FLAME PAGE
     curl http://localhost:5050/habits/public/alice
     -> Shows Meditation + Exercise with consistency scores.
        Weekly Review is hidden (private override).

  2. FRIENDS-ONLY VIEWING
     Login as bob, then:
       curl -H "Authorization: Bearer $BOB_TOKEN" \
            http://localhost:5050/social/friends/$ALICE_ID/profile
     -> Bob sees alice's Meditation + Exercise (public default).
        Weekly Review hidden (private).

  3. PRIVATE USER (DIANA)
     curl http://localhost:5050/habits/public/diana
     -> Returns empty habits array (all private, no friends).

  4. CHALLENGE IN PROGRESS
     Login as bob, then:
       curl -H "Authorization: Bearer $BOB_TOKEN" \
            http://localhost:5050/challenges
     -> Shows the "Read 30 min" challenge from alice with progress.

  5. VARIED FLAME LEVELS
     alice:   ~93% meditation, ~83% exercise  -> blazing/strong
     bob:     ~67% reading, ~80% gym          -> steady/strong
     charlie: ~33% journaling, ~27% walk      -> ember/none
     diana:   ~60% coding, ~75% piano         -> steady

  6. SEARCH FOR USERS
     Login as any user, then:
       curl -H "Authorization: Bearer $TOKEN" \
            "http://localhost:5050/auth/users/search?q=ali"
     -> Returns alice in search results.

  Note: Notifications and Activity Feed entries are generated
  asynchronously by NATS consumers. They are NOT verified by
  this script. Check /notifications and /activity/feed manually.
SCENARIOS

echo ""

if [[ $FAIL -gt 0 ]]; then
    echo -e "${RED}Seeding completed with $FAIL failures. Review output above.${NC}"
    exit 1
else
    echo -e "${GREEN}Seeding completed successfully!${NC}"
fi
