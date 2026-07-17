-- user_avatars: one blob row per user for profile images (winzy.ai-mfns.1).
-- users.avatar_url remains the source of truth for "has an avatar" and stores
-- the serving path /auth/users/{id}/avatar after a successful upload.
CREATE TABLE user_avatars (
    user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    data bytea NOT NULL,
    content_type varchar(64) NOT NULL,
    updated_at timestamptz NOT NULL
);
