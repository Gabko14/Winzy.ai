-- Challenges module tables (winzy.ai-rdc7.5): experience-based challenges
-- friends set on each other's habits — ported from challenge-service's EF
-- Core model (see ChallengeDbContextModelSnapshot.cs and its four migrations
-- InitialCreate + AddMilestoneTypeFields + AddUniqueActiveIndex +
-- AddProcessedCompletionDates, folded into one file here since the Go schema
-- is created fresh rather than migrated forward step by step).
--
-- Enum columns (milestone_type, status) store the C# PascalCase name exactly
-- as EF Core's HasConversion<string>() did, matching the habits/promises/
-- social convention.
--
-- No FK to users(id) or habits(id), matching every other table in this
-- schema: the old system had none (separate databases), and this port
-- preserves that. Cascade cleanup on account deletion runs at the
-- application layer via the challenges module's events.UserDeleted handler.
CREATE TABLE challenges (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    habit_id uuid NOT NULL,
    creator_id uuid NOT NULL,
    recipient_id uuid NOT NULL,
    milestone_type varchar(32) NOT NULL,
    target_value double precision NOT NULL,
    period_days integer NOT NULL,
    reward_description varchar(512) NOT NULL,
    status varchar(16) NOT NULL,
    current_progress double precision NOT NULL DEFAULT 0,
    ends_at timestamptz NOT NULL,
    completed_at timestamptz,
    claimed_at timestamptz,
    completion_count integer NOT NULL DEFAULT 0,
    processed_completion_dates jsonb,
    custom_start_date timestamptz,
    custom_end_date timestamptz,
    baseline_consistency double precision
);

CREATE INDEX ix_challenges_creator_id ON challenges (creator_id);
CREATE INDEX ix_challenges_recipient_id ON challenges (recipient_id);
CREATE INDEX ix_challenges_habit_id ON challenges (habit_id);
CREATE INDEX ix_challenges_recipient_id_status ON challenges (recipient_id, status);

-- At most one Active challenge per creator+recipient+habit — enforces
-- duplicate prevention atomically at the DB level (winzy.ai-3e4 / C#
-- ix_challenges_unique_active).
CREATE UNIQUE INDEX ix_challenges_unique_active
    ON challenges (creator_id, recipient_id, habit_id)
    WHERE status = 'Active';
