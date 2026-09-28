-- ══════════════════════════════════════════════════════════════════════
-- NexusCore MVP — Supabase PostgreSQL schema (spec §3.2 + SOP-OPS-NC-001 v2 delta appended at bottom)
-- Run top-to-bottom in the Supabase SQL Editor.
-- ══════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ── Enums ─────────────────────────────────────────────────────────────
-- Postgres has no CREATE TYPE IF NOT EXISTS; DO blocks make re-runs safe.
DO $$ BEGIN
    CREATE TYPE deal_stage AS ENUM (
        'lead', 'discovery', 'demo', 'proposal',
        'negotiation', 'closed_won', 'closed_lost'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE interaction_type AS ENUM (
        'meeting_transcript', 'email', 'call_recording', 'note'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Tables ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    domain TEXT,
    industry TEXT,
    size_estimate TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
    UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    first_name TEXT NOT NULL,
    last_name TEXT,
    email TEXT NOT NULL,
    phone TEXT,
    job_title TEXT,
    linkedin_url TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
    UNIQUE (user_id, email)
);

CREATE TABLE IF NOT EXISTS deals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    stage deal_stage DEFAULT 'lead' NOT NULL,
    amount NUMERIC(12, 2) DEFAULT 0.00,
    currency VARCHAR(3) DEFAULT 'USD' NOT NULL,
    win_probability INTEGER CHECK (win_probability BETWEEN 0 AND 100) DEFAULT 20,
    ai_summary TEXT,
    key_blockers TEXT[],
    identified_budget NUMERIC(12, 2),
    next_steps TEXT[],
    follow_up_draft TEXT,
    last_interaction_date TIMESTAMPTZ,
    expected_close_date DATE,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

CREATE TABLE IF NOT EXISTS interactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    type interaction_type NOT NULL,
    source_identifier TEXT,
    raw_content TEXT NOT NULL,
    sanitized_summary TEXT,
    action_items JSONB DEFAULT '[]'::jsonb,
    sentiment_score NUMERIC(3, 2),
    occurred_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

CREATE TABLE IF NOT EXISTS deal_embeddings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    interaction_id UUID REFERENCES interactions(id) ON DELETE CASCADE,
    content_chunk TEXT NOT NULL,
    embedding vector(384) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

-- v2 dimension migration: force the column to vector(384) even when the
-- table predates v2 (it was vector(1536) in v1). CREATE TABLE IF NOT EXISTS
-- alone would silently keep the old type and every insert would fail with a
-- dimension mismatch. Old vectors are dropped — they are re-derivable from
-- interactions.raw_content (re-run `npm run db:seed` or just re-ingest).
DO $$
DECLARE
    col_type TEXT;
BEGIN
    SELECT format_type(a.atttypid, a.atttypmod) INTO col_type
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.deal_embeddings'::regclass
      AND a.attname = 'embedding'
      AND NOT a.attisdropped;
    IF col_type IS NOT NULL AND col_type <> 'vector(384)' THEN
        DELETE FROM deal_embeddings;
        ALTER TABLE deal_embeddings DROP COLUMN embedding;
        ALTER TABLE deal_embeddings ADD COLUMN embedding vector(384) NOT NULL;
        RAISE NOTICE 'deal_embeddings.embedding migrated % -> vector(384); vectors dropped (re-derivable).', col_type;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS deal_embeddings_vector_idx
ON deal_embeddings
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Drop legacy unique constraint that prevented multiple deals with the same title
DROP INDEX IF EXISTS deals_user_title_key;
CREATE INDEX IF NOT EXISTS deals_user_title_idx ON deals (user_id, title);
CREATE INDEX IF NOT EXISTS deals_user_stage_idx ON deals (user_id, stage);
CREATE INDEX IF NOT EXISTS interactions_deal_idx ON interactions (deal_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS deal_embeddings_deal_idx ON deal_embeddings (deal_id);

-- ── Auto-provision profiles on signup ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, LOWER(NEW.id::text) || '@placeholder.local'),
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name'),
    NEW.raw_user_meta_data ->> 'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill profiles for users created before this trigger existed
-- (e.g. signups during a failed/partial schema run). Idempotent.
INSERT INTO public.profiles (id, email, full_name, avatar_url)
SELECT
    u.id,
    COALESCE(u.email, LOWER(u.id::text) || '@placeholder.local'),
    COALESCE(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'),
    u.raw_user_meta_data ->> 'avatar_url'
FROM auth.users u
ON CONFLICT (id) DO NOTHING;

-- ── Row Level Security ────────────────────────────────────────────────
ALTER TABLE profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies       ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals           ENABLE ROW LEVEL SECURITY;
ALTER TABLE interactions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_embeddings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;
CREATE POLICY "Users can view their own profile"
    ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update their own profile"
    ON profiles FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can manage their own companies" ON companies;
DROP POLICY IF EXISTS "Users can manage their own contacts" ON contacts;
DROP POLICY IF EXISTS "Users can manage their own deals" ON deals;
DROP POLICY IF EXISTS "Users can manage their own interactions" ON interactions;
DROP POLICY IF EXISTS "Users can manage their own deal_embeddings" ON deal_embeddings;
CREATE POLICY "Users can manage their own companies"
    ON companies FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can manage their own contacts"
    ON contacts FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can manage their own deals"
    ON deals FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can manage their own interactions"
    ON interactions FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
-- deal_embeddings has no user_id column (spec §3.2 DDL); ownership is derived
-- from the parent deal row. EXISTS works for both USING and WITH CHECK.
CREATE POLICY "Users can manage their own deal_embeddings"
    ON deal_embeddings FOR ALL
    USING (EXISTS (SELECT 1 FROM deals d WHERE d.id = deal_id AND d.user_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM deals d WHERE d.id = deal_id AND d.user_id = auth.uid()));

-- ── Realtime: broadcast deals changes to the Kanban board ─────────────
-- The board subscribes to postgres_changes on "deals"; without this the
-- channel joins but never receives payloads. Re-run safe via DO block.
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE deals;
EXCEPTION
    WHEN duplicate_object THEN NULL;      -- table already in publication
    WHEN undefined_object THEN NULL;      -- publication missing (non-Supabase env)
END $$;

-- ── Vector search RPC used by the deal-memory Q&A route ───────────────
-- v2: embeddings moved to 384-dim (BAAI/bge-small-en-v1.5 via the free
-- Hugging Face Inference API, with a deterministic hashed fallback of the
-- same dimension). Drop the old 1536-dim RPC signature first — CREATE OR
-- REPLACE with a changed arg type would create an overload, not replace.
DROP FUNCTION IF EXISTS public.match_deal_chunks(UUID, vector(1536), INT);

CREATE OR REPLACE FUNCTION public.match_deal_chunks(
    p_deal_id UUID,
    p_query_embedding vector(384),
    p_match_count INT DEFAULT 6
)
RETURNS TABLE (
    content_chunk TEXT,
    interaction_id UUID,
    similarity DOUBLE PRECISION
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        e.content_chunk,
        e.interaction_id,
        1 - (e.embedding <=> p_query_embedding) AS similarity
    FROM deal_embeddings e
    JOIN deals d ON d.id = e.deal_id
    WHERE e.deal_id = p_deal_id
      AND d.user_id = auth.uid()  -- enforce ownership even on direct RPC calls
    ORDER BY e.embedding <=> p_query_embedding
    LIMIT p_match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_deal_chunks(UUID, vector(384), INT) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- SOP-OPS-NC-001 v2 delta — autonomous agents, health scoring, embeddings
-- ══════════════════════════════════════════════════════════════════════

-- ── Embedding dimension migration: vector(1536) → vector(384) ────────
-- Fresh installs are already at 384 (table DDL above). Existing databases:
-- retype the column; if rows carry the old 1536-dim vectors they are
-- incompatible with the new provider anyway, so memory is reset and can be
-- repopulated with `npm run db:seed` or by re-ingesting.
DO $$
BEGIN
    BEGIN
        ALTER TABLE deal_embeddings
            ALTER COLUMN embedding TYPE vector(384) USING embedding::text::vector(384);
    EXCEPTION WHEN others THEN
        TRUNCATE deal_embeddings;
        ALTER TABLE deal_embeddings
            ALTER COLUMN embedding TYPE vector(384) USING NULL::vector(384);
    END;
END $$;

-- ── v2 column additions (idempotent) ──────────────────────────────────
-- §4.1/§4.2: organizational health + ICP attributes, stakeholder mapping,
-- stalled-deal detection on the Kanban.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS health_score INT DEFAULT 100
    CHECK (health_score BETWEEN 0 AND 100);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS annual_revenue NUMERIC(15, 2);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS employee_count INT;

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS stakeholder_role TEXT DEFAULT 'Influencer';

ALTER TABLE deals ADD COLUMN IF NOT EXISTS stalled_warning BOOLEAN DEFAULT FALSE;

-- ── §4.2 Autonomous Multi-Agent Workforce — human-in-the-loop queue ───
-- Agents never act unilaterally: every proposal (SDR outreach, Deal
-- Strategist play, Health Sentinel mitigation) lands here for review.
CREATE TABLE IF NOT EXISTS agent_action_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    agent_type TEXT NOT NULL CHECK (agent_type IN ('sdr', 'deal_strategist', 'health_sentinel')),
    target_entity_type TEXT NOT NULL DEFAULT 'deal',
    target_entity_id UUID NOT NULL,
    deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
    action_title TEXT NOT NULL,
    rationale TEXT,
    proposed_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    requires_dual_approval BOOLEAN DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'edited', 'rejected', 'dismissed')),
    rejection_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
    reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS agent_action_queue_user_status_idx
    ON agent_action_queue (user_id, status, created_at DESC);

-- ── §3.6 Emergency Stop (kill switch) — single-row settings ──────────
-- When agents_paused is TRUE the platform runs in Passive Read-Only Mode:
-- ingestion still works, but agents stop proposing new actions.
CREATE TABLE IF NOT EXISTS platform_settings (
    id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    agents_paused BOOLEAN DEFAULT FALSE NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);
INSERT INTO platform_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE agent_action_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own agent actions" ON agent_action_queue;
CREATE POLICY "Users can manage their own agent actions"
    ON agent_action_queue FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Team can view platform settings" ON platform_settings;
DROP POLICY IF EXISTS "Team can update platform settings" ON platform_settings;
CREATE POLICY "Team can view platform settings"
    ON platform_settings FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Team can update platform settings"
    ON platform_settings FOR UPDATE USING (auth.uid() IS NOT NULL);

-- ── Auto-capture: Attendee meeting bots (attendee.dev) ───────────────
-- Maps each launched Attendee bot to the NexusCore user (and optional deal)
-- so the finished transcript flows into the ingest pipeline automatically.
CREATE TABLE IF NOT EXISTS meeting_bots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
    attendee_bot_id TEXT NOT NULL UNIQUE,
    meeting_url TEXT NOT NULL,
    bot_name TEXT,
    status TEXT NOT NULL DEFAULT 'ready',
    ingest_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (ingest_status IN ('pending', 'ingested', 'failed')),
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS meeting_bots_user_idx ON meeting_bots (user_id, created_at DESC);

ALTER TABLE meeting_bots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own meeting bots" ON meeting_bots;
CREATE POLICY "Users can manage their own meeting bots"
    ON meeting_bots FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── Realtime: broadcast agent queue changes to the UI ────────────────
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE agent_action_queue;
EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
END $$;
