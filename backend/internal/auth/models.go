package auth

import "time"

// User mirrors the users table. IDs are the Postgres uuid column's
// canonical text form (see store.go's doc comment for why this codebase
// carries ids as plain strings instead of adding a UUID library).
type User struct {
	ID           string
	CreatedAt    time.Time
	UpdatedAt    time.Time
	Email        string
	Username     string
	PasswordHash string
	DisplayName  *string
	AvatarURL    *string
	LastLoginAt  *time.Time
}

// RefreshToken mirrors the refresh_tokens table.
type RefreshToken struct {
	ID        string
	CreatedAt time.Time
	UpdatedAt time.Time
	UserID    string
	Token     string
	ExpiresAt time.Time
	RevokedAt *time.Time
}

// IsRevoked reports whether the token has been explicitly revoked. It does
// not check expiry — callers must check ExpiresAt separately, matching
// RefreshToken.cs's IsRevoked/ExpiresAt split.
func (r RefreshToken) IsRevoked() bool {
	return r.RevokedAt != nil
}

// --- Request DTOs (JSON field names match AuthModels.cs's camelCase wire
// format exactly, verified against frontend/src/api/types.ts). ---

type RegisterRequest struct {
	Email       string  `json:"email"`
	Username    string  `json:"username"`
	Password    string  `json:"password"`
	DisplayName *string `json:"displayName"`
}

type LoginRequest struct {
	EmailOrUsername string `json:"emailOrUsername"`
	Password        string `json:"password"`
}

type RefreshRequestBody struct {
	RefreshToken *string `json:"refreshToken"`
}

type ChangePasswordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

type UpdateProfileRequest struct {
	DisplayName *string `json:"displayName"`
	AvatarURL   *string `json:"avatarUrl"`
}

// --- Response DTOs ---

type UserProfile struct {
	ID          string    `json:"id"`
	Email       string    `json:"email"`
	Username    string    `json:"username"`
	DisplayName *string   `json:"displayName"`
	AvatarURL   *string   `json:"avatarUrl"`
	CreatedAt   time.Time `json:"createdAt"`
}

type AuthResponse struct {
	AccessToken  string      `json:"accessToken"`
	RefreshToken *string     `json:"refreshToken"`
	User         UserProfile `json:"user"`
}

type UserSearchResult struct {
	ID          string  `json:"id"`
	Username    string  `json:"username"`
	DisplayName *string `json:"displayName"`
	AvatarURL   *string `json:"avatarUrl"`
}

// ProfileSummary is the shape BatchProfiles returns to other in-process
// modules — the direct-call replacement for the old POST
// /auth/internal/profiles endpoint.
type ProfileSummary struct {
	UserID      string  `json:"userId"`
	Username    string  `json:"username"`
	DisplayName *string `json:"displayName"`
	AvatarURL   *string `json:"avatarUrl"`
}

// AvatarUploadResponse is returned by PUT /auth/avatar so clients can
// cache-bust the public serving URL with updatedAt.
type AvatarUploadResponse struct {
	AvatarURL string    `json:"avatarUrl"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func toProfile(u User) UserProfile {
	return UserProfile{
		ID:          u.ID,
		Email:       u.Email,
		Username:    u.Username,
		DisplayName: u.DisplayName,
		AvatarURL:   u.AvatarURL,
		CreatedAt:   u.CreatedAt,
	}
}
