-- Reminder scheduler settings (winzy.ai-wyw6.1).
-- reminder_timezone is an intentional, minimal exception to the per-surface
-- timezone rule: it is used ONLY for daily reminder scheduling, never for
-- habit completion or stats math. NULL means we have never learned this
-- user's tz — send nothing, never guess UTC.
ALTER TABLE notification_settings
    ADD COLUMN reminder_time time NOT NULL DEFAULT '19:00',
    ADD COLUMN reminder_timezone varchar(64) NULL;
