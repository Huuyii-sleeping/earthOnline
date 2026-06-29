-- +goose Up
-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- 1. users
-- ============================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account VARCHAR(100) NOT NULL,
    nickname VARCHAR(100) NOT NULL,
    avatar_url TEXT,
    bio TEXT,
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_users_account ON users(account);

-- ============================================
-- 2. agent_profiles
-- ============================================
CREATE TABLE agent_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL DEFAULT 'My Agent',
    personality TEXT,
    identity_prompt TEXT,
    dialogue_style TEXT,
    avatar_url TEXT,
    proactive_level INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_agent_profiles_user_id ON agent_profiles(user_id);

-- ============================================
-- 3. experiences
-- ============================================
CREATE TABLE experiences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'collecting',
    occurred_at TIMESTAMPTZ,
    summary TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_experiences_user_id ON experiences(user_id);
CREATE INDEX idx_experiences_user_status ON experiences(user_id, status);

-- ============================================
-- 4. conversation_sessions
-- ============================================
CREATE TABLE conversation_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    experience_id UUID NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    agent_profile_id UUID NOT NULL REFERENCES agent_profiles(id),
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_conversation_sessions_user_id ON conversation_sessions(user_id);
CREATE INDEX idx_conversation_sessions_experience_id ON conversation_sessions(experience_id);

-- ============================================
-- 5. conversation_messages
-- ============================================
CREATE TABLE conversation_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES conversation_sessions(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    content_type VARCHAR(50) NOT NULL DEFAULT 'text',
    asset_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_conversation_messages_session_id ON conversation_messages(session_id);
CREATE INDEX idx_conversation_messages_session_created ON conversation_messages(session_id, created_at);

-- ============================================
-- 6. assets
-- ============================================
CREATE TABLE assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    experience_id UUID REFERENCES experiences(id) ON DELETE SET NULL,
    storage_key TEXT NOT NULL,
    url TEXT NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    asset_type VARCHAR(50) NOT NULL,
    size_bytes BIGINT NOT NULL,
    metadata JSONB,
    visibility VARCHAR(50) NOT NULL DEFAULT 'private',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_assets_user_id ON assets(user_id);
CREATE INDEX idx_assets_experience_id ON assets(experience_id);

-- ============================================
-- 7. medals
-- ============================================
CREATE TABLE medals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    experience_id UUID NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    current_version_id UUID,
    title VARCHAR(255) NOT NULL,
    short_reason TEXT NOT NULL,
    memory_weight VARCHAR(20) NOT NULL DEFAULT 'medium',
    image_url TEXT,
    visibility VARCHAR(50) NOT NULL DEFAULT 'public',
    edited_by_user BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_medals_user_id ON medals(user_id);
CREATE INDEX idx_medals_experience_id ON medals(experience_id);
CREATE INDEX idx_medals_visibility ON medals(visibility);
CREATE INDEX idx_medals_created_at ON medals(created_at DESC);

-- ============================================
-- 8. medal_versions
-- ============================================
CREATE TABLE medal_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    medal_id UUID NOT NULL REFERENCES medals(id) ON DELETE CASCADE,
    version_type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    short_reason TEXT NOT NULL,
    meaning_focus TEXT,
    story TEXT,
    analysis_json JSONB,
    visual_prompt TEXT,
    image_url TEXT,
    created_by VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_medal_versions_medal_id ON medal_versions(medal_id);

-- ============================================
-- 9. medal_visibility
-- ============================================
CREATE TABLE medal_visibility (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    medal_id UUID NOT NULL REFERENCES medals(id) ON DELETE CASCADE,
    visibility VARCHAR(50) NOT NULL DEFAULT 'public',
    hidden_fields JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_medal_visibility_medal_id ON medal_visibility(medal_id);

-- ============================================
-- 10. medal_interactions
-- ============================================
CREATE TABLE medal_interactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    medal_id UUID NOT NULL REFERENCES medals(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_medal_interactions_medal_id ON medal_interactions(medal_id);
CREATE INDEX idx_medal_interactions_user_id ON medal_interactions(user_id);
CREATE UNIQUE INDEX idx_medal_interactions_unique ON medal_interactions(medal_id, user_id, type);

-- ============================================
-- 11. follows
-- ============================================
CREATE TABLE follows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_follows_follower_following ON follows(follower_id, following_id);
CREATE INDEX idx_follows_following_id ON follows(following_id);

-- ============================================
-- 12. friendships
-- ============================================
CREATE TABLE friendships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_friendships_requester_addressee ON friendships(requester_id, addressee_id);
CREATE INDEX idx_friendships_addressee_id ON friendships(addressee_id);

-- ============================================
-- 13. notifications
-- ============================================
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    body TEXT,
    data JSONB,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_user_read ON notifications(user_id, is_read);
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);

-- ============================================
-- 14. generation_jobs
-- ============================================
CREATE TABLE generation_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    experience_id UUID REFERENCES experiences(id) ON DELETE SET NULL,
    medal_id UUID REFERENCES medals(id) ON DELETE SET NULL,
    job_type VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    input_json JSONB,
    output_json JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_generation_jobs_user_id ON generation_jobs(user_id);
CREATE INDEX idx_generation_jobs_experience_id ON generation_jobs(experience_id);
CREATE INDEX idx_generation_jobs_medal_id ON generation_jobs(medal_id);
CREATE INDEX idx_generation_jobs_status ON generation_jobs(status);

-- +goose Down
DROP TABLE IF EXISTS generation_jobs CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS friendships CASCADE;
DROP TABLE IF EXISTS follows CASCADE;
DROP TABLE IF EXISTS medal_interactions CASCADE;
DROP TABLE IF EXISTS medal_visibility CASCADE;
DROP TABLE IF EXISTS medal_versions CASCADE;
DROP TABLE IF EXISTS medals CASCADE;
DROP TABLE IF EXISTS assets CASCADE;
DROP TABLE IF EXISTS conversation_messages CASCADE;
DROP TABLE IF EXISTS conversation_sessions CASCADE;
DROP TABLE IF EXISTS experiences CASCADE;
DROP TABLE IF EXISTS agent_profiles CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP EXTENSION IF EXISTS "uuid-ossp";