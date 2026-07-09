-- Auth module tables (winzy.ai-rdc7.2): users + refresh_tokens, ported from
-- auth-service's EF Core model (see AuthDbContextModelSnapshot.cs). Email
-- and Username are stored already-lowercased by the application layer; the
-- unique indexes below assume that and do not lowercase themselves.
CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    email varchar(256) NOT NULL,
    username varchar(64) NOT NULL,
    password_hash varchar(512) NOT NULL,
    display_name varchar(128),
    avatar_url varchar(512),
    last_login_at timestamptz
);

CREATE UNIQUE INDEX ix_users_email ON users (email);
CREATE UNIQUE INDEX ix_users_username ON users (username);

CREATE TABLE refresh_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token varchar(512) NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz
);

CREATE UNIQUE INDEX ix_refresh_tokens_token ON refresh_tokens (token);
CREATE INDEX ix_refresh_tokens_user_id ON refresh_tokens (user_id);
