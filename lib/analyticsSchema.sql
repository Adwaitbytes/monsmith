-- Monsmith analytics schema (Neon Postgres).
--
-- Deliberately narrow: one row per thing that happened, with enough context to
-- answer "how many people used this, and what did they do" without joins across
-- half a dozen tables. The previous schema had eighteen tables and recorded
-- nothing, because the writes were never wired up.

CREATE TABLE IF NOT EXISTS users (
    id              BIGSERIAL PRIMARY KEY,
    -- A wallet when connected, otherwise a random id held in localStorage, so
    -- anonymous visitors are still counted once rather than once per page load.
    visitor_id      TEXT UNIQUE NOT NULL,
    wallet_address  TEXT,
    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    session_count   INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS users_wallet_idx    ON users (wallet_address);
CREATE INDEX IF NOT EXISTS users_last_seen_idx ON users (last_seen_at DESC);

CREATE TABLE IF NOT EXISTS events (
    id          BIGSERIAL PRIMARY KEY,
    visitor_id  TEXT NOT NULL,
    -- compile | deploy | audit | parallel_analysis | migration | ai_generate |
    -- gas_profile | chain_fit | interact_read | interact_write | transpile | page_view
    event_type  TEXT NOT NULL,
    -- success | error, so failure rates are queryable without parsing details
    status      TEXT NOT NULL DEFAULT 'success',
    duration_ms INTEGER,
    -- Anything event-specific: contract name, score, gas, error message.
    detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS events_type_idx    ON events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS events_visitor_idx ON events (visitor_id);
CREATE INDEX IF NOT EXISTS events_created_idx ON events (created_at DESC);

CREATE TABLE IF NOT EXISTS deployments (
    id               BIGSERIAL PRIMARY KEY,
    visitor_id       TEXT NOT NULL,
    contract_address TEXT NOT NULL,
    contract_name    TEXT,
    tx_hash          TEXT NOT NULL,
    deployer_address TEXT NOT NULL,
    chain_id         INTEGER NOT NULL DEFAULT 10143,
    gas_used         BIGINT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tx_hash)
);

CREATE INDEX IF NOT EXISTS deployments_created_idx ON deployments (created_at DESC);
