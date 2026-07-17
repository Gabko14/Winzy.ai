-- Challenge invites (winzy.ai-jc38.1): shareable links that propose a habit
-- plus challenge terms for someone who is not yet on Winzy. Claim (friendship
-- + habit + challenge, atomically) is a later bead; this migration is the
-- lifecycle table only. No FK to users — same convention as challenges.
CREATE TABLE challenge_invites (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    creator_id uuid NOT NULL,
    token varchar(64) UNIQUE NOT NULL,
    habit_name varchar(256) NOT NULL,
    habit_icon varchar(64),
    habit_frequency varchar(16) NOT NULL,
    habit_custom_days jsonb,
    milestone_type varchar(32) NOT NULL,
    target_value double precision NOT NULL,
    period_days int NOT NULL,
    reward_description varchar(512) NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'pending',
    claimed_by uuid,
    claimed_at timestamptz,
    expires_at timestamptz NOT NULL
);

CREATE INDEX ix_challenge_invites_creator_id ON challenge_invites (creator_id);
CREATE INDEX ix_challenge_invites_creator_id_status ON challenge_invites (creator_id, status);
