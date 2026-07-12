-- Notifications module tables (winzy.ai-rdc7.6): in-app notifications,
-- per-user settings, and device tokens for web/expo push — ported from
-- notification-service's EF Core model (NotificationDbContextModelSnapshot.cs
-- and its four migrations InitialCreate + AddIdempotencyKey + AddDeviceTokens
-- + AddPushDelivered, folded into one file here since the Go schema is
-- created fresh rather than migrated forward step by step).
--
-- Notification.type stores the C# PascalCase enum name exactly as EF Core's
-- HasConversion<string>() did (HabitCompleted, FriendRequestSent, ...).
-- API responses lower-case it (Program.cs MapToResponse).
--
-- No FK to users(id), matching every other table in this schema: the old
-- system had none (separate databases), and this port preserves that.
-- Cascade cleanup on account deletion runs at the application layer via
-- the notifications module's events.UserDeleted handler.
CREATE TABLE notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    user_id uuid NOT NULL,
    type varchar(32) NOT NULL,
    data jsonb NOT NULL DEFAULT '{}'::jsonb,
    read_at timestamptz,
    idempotency_key varchar(256),
    push_delivered boolean NOT NULL DEFAULT false
);

CREATE INDEX ix_notifications_user_id ON notifications (user_id);
CREATE INDEX ix_notifications_user_id_read_at ON notifications (user_id, read_at);
CREATE UNIQUE INDEX ix_notifications_idempotency_key
    ON notifications (idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE TABLE notification_settings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    user_id uuid NOT NULL,
    habit_reminders boolean NOT NULL DEFAULT true,
    friend_activity boolean NOT NULL DEFAULT true,
    challenge_updates boolean NOT NULL DEFAULT true
);

CREATE UNIQUE INDEX ix_notification_settings_user_id
    ON notification_settings (user_id);

CREATE TABLE device_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    user_id uuid NOT NULL,
    platform varchar(32) NOT NULL,
    token text NOT NULL,
    device_id varchar(512)
);

CREATE INDEX ix_device_tokens_user_id ON device_tokens (user_id);
CREATE UNIQUE INDEX ix_device_tokens_user_id_device_id
    ON device_tokens (user_id, device_id)
    WHERE device_id IS NOT NULL;
