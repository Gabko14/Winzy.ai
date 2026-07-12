// Package social ports social-service's friendships, per-habit visibility
// settings, default visibility preferences, and Witness Links (winzy.ai-rdc7.4):
// this is the "passive accountability" layer deciding who can see whose
// Flame. In the old NATS world it was the heaviest event consumer
// (habit.created/habit.archived/user.deleted); here those become hook
// handlers on the shared events.Registry, and the old cross-service HTTP
// calls (auth's batch profiles, habits' user-habits/ownership lookups)
// become direct in-process calls into internal/auth and internal/habits —
// see service.go and crossmodule.go.
package social

import (
	"encoding/json"
	"errors"
	"strings"
	"time"
)

// errInvalidVisibility is habitVisibilityValue's decode failure — an
// unrecognized visibility name. Handled the same way habits.Frequency's
// invalid-name UnmarshalJSON error is: it surfaces as the generic "Invalid
// JSON in request body" once decodeJSON propagates it, rather than the more
// specific "Invalid visibility value..." message SetHabitVisibility's C#
// source only needs because its enum's JsonStringEnumConverter additionally
// accepts (and must separately reject) out-of-range integers — a
// distinction that doesn't apply to Go's string-only decode here. No test in
// the ported suite asserts the specific C# message, so this is a documented
// parity gap, not an oversight.
var errInvalidVisibility = errors.New("social: invalid visibility value")

// errInvalidFriendID is friendIDValue's decode failure for a non-UUID-shaped
// string — see that type's doc comment.
var errInvalidFriendID = errors.New("social: invalid friendId")

// errInvalidHabitID is habitIDList's decode failure for a non-UUID-shaped
// array element — see that type's doc comment.
var errInvalidHabitID = errors.New("social: invalid habit id")

// FriendshipStatus mirrors Winzy.SocialService.Entities.FriendshipStatus
// (Pending/Accepted). The DB column stores the C# PascalCase name verbatim,
// matching the habits/promises convention (see habits/promise_models.go's
// PromiseStatus doc comment); the wire (JSON) form is the lowercase name via
// String().
type FriendshipStatus string

const (
	FriendshipPending  FriendshipStatus = "Pending"
	FriendshipAccepted FriendshipStatus = "Accepted"
)

// String renders the lowercase wire/response form.
func (s FriendshipStatus) String() string { return strings.ToLower(string(s)) }

func friendshipStatusFromDB(s string) FriendshipStatus {
	if FriendshipStatus(s) == FriendshipAccepted {
		return FriendshipAccepted
	}
	return FriendshipPending
}

// HabitVisibility mirrors Winzy.SocialService.Entities.HabitVisibility
// (Private/Friends/Public), shared by VisibilitySetting.Visibility and
// SocialPreference.DefaultHabitVisibility. Same DB-PascalCase/wire-lowercase
// split as FriendshipStatus above.
type HabitVisibility string

const (
	VisibilityPrivate HabitVisibility = "Private"
	VisibilityFriends HabitVisibility = "Friends"
	VisibilityPublic  HabitVisibility = "Public"
)

// String renders the lowercase wire/response form.
func (v HabitVisibility) String() string { return strings.ToLower(string(v)) }

func habitVisibilityFromDB(s string) HabitVisibility {
	switch HabitVisibility(s) {
	case VisibilityFriends:
		return VisibilityFriends
	case VisibilityPublic:
		return VisibilityPublic
	default:
		return VisibilityPrivate
	}
}

// parseHabitVisibility parses the lowercase wire form ("private"/"friends"/
// "public") into a HabitVisibility, reporting false for anything else —
// matching `Enum.IsDefined(request.Visibility)`'s rejection of an
// out-of-range value once System.Text.Json's JsonStringEnumConverter has
// already parsed the JSON string into the enum type (case-insensitively, the
// default converter behavior). Go's json.Unmarshal has no enum concept, so
// this is done as a manual, explicit parse step in the request DTOs' own
// UnmarshalJSON instead of relying on decoding failure — see
// HabitVisibilityValue's doc comment.
func parseHabitVisibility(s string) (HabitVisibility, bool) {
	switch strings.ToLower(s) {
	case "private":
		return VisibilityPrivate, true
	case "friends":
		return VisibilityFriends, true
	case "public":
		return VisibilityPublic, true
	default:
		return "", false
	}
}

// Friendship mirrors the friendships table. An accepted friendship is always
// TWO rows (one per direction) — see AcceptFriendRequest in service.go.
type Friendship struct {
	ID        string
	CreatedAt time.Time
	UpdatedAt time.Time
	UserID    string
	FriendID  string
	Status    FriendshipStatus
}

// VisibilitySetting mirrors the visibility_settings table: one user's
// explicit sharing choice for one of their own habits. A habit with no row
// here falls back to the user's SocialPreference.DefaultHabitVisibility (or
// Private if that's absent too).
type VisibilitySetting struct {
	ID         string
	CreatedAt  time.Time
	UpdatedAt  time.Time
	UserID     string
	HabitID    string
	Visibility HabitVisibility
}

// SocialPreference mirrors the social_preferences table: one row per user
// (unique on UserID), holding their default sharing visibility for any habit
// with no explicit VisibilitySetting.
type SocialPreference struct {
	ID                     string
	CreatedAt              time.Time
	UpdatedAt              time.Time
	UserID                 string
	DefaultHabitVisibility HabitVisibility
}

// WitnessLink mirrors the witness_links table: an anonymous, tokenized
// share link scoped to a per-link habit allowlist (witness_link_habits).
// RevokedAt nil means active; non-nil means revoked (soft delete). Token is
// the access credential itself — see witness_service.go's doc comment on why
// it is never logged.
type WitnessLink struct {
	ID        string
	CreatedAt time.Time
	UpdatedAt time.Time
	OwnerID   string
	Token     string
	Label     *string
	RevokedAt *time.Time
}

// --- Request DTOs (JSON field names match the C# endpoints' camelCase wire
// format exactly, verified against FriendEndpoints.cs/VisibilityEndpoints.cs/
// WitnessLinkEndpoints.cs). ---

// emptyUUID is the canonical all-zero UUID text form — Go's analogue of C#'s
// Guid.Empty, which SendFriendRequest's "FriendId is required" check tests
// against directly.
const emptyUUID = "00000000-0000-0000-0000-000000000000"

// friendIDValue decodes a JSON string the way FriendRequestDto's Guid field
// does: a non-UUID-shaped string, an explicit JSON null, an explicit empty
// string, or any non-string JSON value are all decode failures — surfacing
// as "Invalid JSON in request body", matching System.Text.Json's Guid
// converter, which throws JsonException for every one of those (a
// non-nullable Guid has no valid representation for null or ""). Only an
// OMITTED field (this method is never called at all — Go's json package
// only invokes UnmarshalJSON for a field actually present in the input) or
// the literal all-zero UUID decode successfully into "", the signal
// SendFriendRequest's own "FriendId is required" check reacts to (matching
// Guid.Empty's role in the C# source: a missing non-nullable Guid property
// defaults to Guid.Empty rather than erroring, but an explicit null/""
// never reaches that default — the property binder rejects them outright).
type friendIDValue string

func (v *friendIDValue) UnmarshalJSON(data []byte) error {
	// Go's encoding/json calls UnmarshalJSON with the literal bytes "null"
	// for an explicit JSON null value (unlike an omitted field, which never
	// calls this method at all) — and json.Unmarshal("null", &s) below would
	// otherwise silently leave s at its zero value ("") without an error, the
	// well-known Go null-into-non-pointer gotcha. That would wrongly collapse
	// an explicit null into the same "" success case as an omitted field, so
	// it must be checked before the generic decode below.
	if string(data) == "null" {
		return errInvalidFriendID
	}

	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return err
	}
	if s == "" {
		return errInvalidFriendID
	}
	if s == emptyUUID {
		*v = ""
		return nil
	}
	if !isValidUUID(s) {
		return errInvalidFriendID
	}
	*v = friendIDValue(s)
	return nil
}

type friendRequestDTO struct {
	FriendID friendIDValue `json:"friendId"`
}

// habitVisibilityValue decodes/encodes a HabitVisibility over the wire as
// its lowercase string form, rejecting anything else at JSON-decode time —
// matching System.Text.Json's JsonStringEnumConverter, which fails
// deserialization outright for an unrecognized name rather than decoding
// successfully into a zero/invalid enum value (contrast
// habits.CompletionKind, whose invalid values are only caught by a later,
// explicit runtime check — see that type's doc comment for why the two
// enums in this codebase diverge here). A decode failure here surfaces as
// "Invalid JSON in request body" once handlers.go's decodeJSON helper
// propagates it, exactly like an invalid Frequency does in the habits
// module.
type habitVisibilityValue HabitVisibility

func (v *habitVisibilityValue) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return err
	}
	parsed, ok := parseHabitVisibility(s)
	if !ok {
		return errInvalidVisibility
	}
	*v = habitVisibilityValue(parsed)
	return nil
}

// resolveVisibility maps an omitted (zero-valued, never decoded)
// habitVisibilityValue to Private — matching C#'s non-nullable
// HabitVisibility enum, which defaults an OMITTED JSON property to its zero
// value (Private) rather than erroring (Enum.IsDefined(Private) then
// passes, so SetHabitVisibility/UpdatePreferences never see a distinct
// "missing" case in the C# source at all — {} is just a request for the
// default). A present-but-invalid value never reaches here:
// habitVisibilityValue.UnmarshalJSON above already rejects it at decode
// time, surfacing as "Invalid JSON in request body" instead.
func resolveVisibility(v habitVisibilityValue) HabitVisibility {
	if v == "" {
		return VisibilityPrivate
	}
	return HabitVisibility(v)
}

type visibilityUpdateDTO struct {
	Visibility habitVisibilityValue `json:"visibility"`
}

type preferencesUpdateDTO struct {
	DefaultHabitVisibility habitVisibilityValue `json:"defaultHabitVisibility"`
}

// habitIDList decodes a JSON array of habit ids, matching
// WitnessLinkCreateDto/WitnessLinkUpdateDto's `List<Guid>? HabitIds`: any
// element that isn't a canonical UUID string is a decode failure — matching
// System.Text.Json's Guid converter, which throws JsonException for an
// unparseable array element during deserialization rather than letting a
// malformed id reach the database as a raw string (previously this package
// let a bad element reach the `$2::uuid` cast, producing a raw Postgres
// 22P02 error mapped to a bare 500 instead of 400 — and in Create's case,
// after the link row had already committed). An omitted field or an
// explicit JSON null both decode to nil (Go's encoding/json sets a slice
// target to nil for null, without invoking the loop below) — that's the
// existing "leave the allowlist alone" / "no habits selected" signal both
// endpoints already rely on (see witness_service.go's replaceHabits
// parameter), unaffected by this validation.
type habitIDList []string

func (h *habitIDList) UnmarshalJSON(data []byte) error {
	var raw []string
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	for _, id := range raw {
		if !isValidUUID(id) {
			return errInvalidHabitID
		}
	}
	*h = raw
	return nil
}

type witnessLinkCreateDTO struct {
	Label    *string     `json:"label"`
	HabitIDs habitIDList `json:"habitIds"`
}

type witnessLinkUpdateDTO struct {
	Label    *string     `json:"label"`
	HabitIDs habitIDList `json:"habitIds"`
}

// --- Response DTOs ---

type friendshipResponse struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	FriendID  string    `json:"friendId"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
}

// friendListItem is one entry in GET /social/friends's items array, matching
// ListFriends' anonymous projection in FriendEndpoints.cs field-for-field.
type friendListItem struct {
	FriendID          string    `json:"friendId"`
	Since             time.Time `json:"since"`
	Username          *string   `json:"username"`
	DisplayName       *string   `json:"displayName"`
	AvatarURL         *string   `json:"avatarUrl"`
	FlameLevel        string    `json:"flameLevel"`
	Consistency       float64   `json:"consistency"`
	HabitsUnavailable bool      `json:"habitsUnavailable"`
}

type listFriendsResponse struct {
	Items    []friendListItem `json:"items"`
	Page     int              `json:"page"`
	PageSize int              `json:"pageSize"`
	Total    int              `json:"total"`
}

type pendingCountResponse struct {
	Count int `json:"count"`
}

type incomingRequestItem struct {
	ID              string    `json:"id"`
	FromUserID      string    `json:"fromUserId"`
	Direction       string    `json:"direction"`
	CreatedAt       time.Time `json:"createdAt"`
	FromUsername    *string   `json:"fromUsername"`
	FromDisplayName *string   `json:"fromDisplayName"`
}

type outgoingRequestItem struct {
	ID            string    `json:"id"`
	ToUserID      string    `json:"toUserId"`
	Direction     string    `json:"direction"`
	CreatedAt     time.Time `json:"createdAt"`
	ToUsername    *string   `json:"toUsername"`
	ToDisplayName *string   `json:"toDisplayName"`
}

type listRequestsResponse struct {
	Incoming []incomingRequestItem `json:"incoming"`
	Outgoing []outgoingRequestItem `json:"outgoing"`
}

// friendProfileHabit is one habit in GET /social/friends/{friendId}/profile's
// habits array, matching GetFriendProfile's per-habit projection in
// FriendEndpoints.cs.
type friendProfileHabit struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Icon        *string `json:"icon"`
	Color       *string `json:"color"`
	Consistency float64 `json:"consistency"`
	FlameLevel  string  `json:"flameLevel"`
}

type friendProfileResponse struct {
	FriendID          string               `json:"friendId"`
	Habits            []friendProfileHabit `json:"habits"`
	HabitsUnavailable bool                 `json:"habitsUnavailable"`
}

type visibilityResponse struct {
	HabitID    string `json:"habitId"`
	Visibility string `json:"visibility"`
}

type preferencesResponse struct {
	DefaultHabitVisibility string `json:"defaultHabitVisibility"`
}

type batchVisibilityItem struct {
	HabitID    string `json:"habitId"`
	Visibility string `json:"visibility"`
}

type batchVisibilityResponse struct {
	DefaultVisibility string                `json:"defaultVisibility"`
	Habits            []batchVisibilityItem `json:"habits"`
}

// witnessLinkResponse is the shape returned by create/list/update/rotate —
// matching CreateWitnessLink/UpdateWitnessLink/RotateToken's identical
// anonymous projection in WitnessLinkEndpoints.cs.
type witnessLinkResponse struct {
	ID        string    `json:"id"`
	Token     string    `json:"token"`
	Label     *string   `json:"label"`
	HabitIDs  []string  `json:"habitIds"`
	CreatedAt time.Time `json:"createdAt"`
}

type listWitnessLinksResponse struct {
	Items []witnessLinkResponse `json:"items"`
}

// witnessHabitEntry is one habit in GET /social/witness/{token}'s habits
// array, matching ViewWitnessLink's per-habit projection (including the raw
// "promise" passthrough) in WitnessLinkEndpoints.cs.
type witnessHabitEntry struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Icon        *string `json:"icon"`
	Color       *string `json:"color"`
	Consistency float64 `json:"consistency"`
	FlameLevel  string  `json:"flameLevel"`
	Promise     any     `json:"promise"`
}

type witnessViewResponse struct {
	OwnerUsername     *string             `json:"ownerUsername"`
	OwnerDisplayName  *string             `json:"ownerDisplayName"`
	Habits            []witnessHabitEntry `json:"habits"`
	HabitsUnavailable bool                `json:"habitsUnavailable"`
}

// trimPtr trims s in place without collapsing an explicit blank string to
// nil — matching WitnessLinkEndpoints.cs's Label handling
// (`request.Label?.Trim()`), which trims but never converts blank to null;
// only a nil input (an omitted/explicit-null field) stays nil. See
// habits/models.go's identical helper for the Icon/Color precedent this
// mirrors.
func trimPtr(s *string) *string {
	if s == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*s)
	return &trimmed
}
