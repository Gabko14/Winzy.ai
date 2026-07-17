ALTER TABLE notification_settings
    DROP COLUMN IF EXISTS reminder_timezone,
    DROP COLUMN IF EXISTS reminder_time;
