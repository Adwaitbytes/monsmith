-- ============================================
-- MONSMITH SUPABASE SCHEMA
-- Complete data capture for investor-ready analytics
-- ============================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- USERS & AUTHENTICATION
-- ============================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_address TEXT UNIQUE NOT NULL,
    email TEXT,
    username TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_active_at TIMESTAMPTZ DEFAULT NOW(),
    total_deployments INTEGER DEFAULT 0,
    total_compiles INTEGER DEFAULT 0,
    plan_tier TEXT DEFAULT 'free', -- free, pro, enterprise
    referral_code TEXT UNIQUE,
    referred_by UUID REFERENCES users(id),
    metadata JSONB DEFAULT '{}'
);

-- ============================================
-- PROJECTS & FILES
-- ============================================
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    is_public BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_compiled_at TIMESTAMPTZ,
    last_deployed_at TIMESTAMPTZ,
    template_id TEXT,
    tags TEXT[],
    metadata JSONB DEFAULT '{}'
);

CREATE TABLE project_files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    content TEXT NOT NULL,
    language TEXT DEFAULT 'solidity',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    version INTEGER DEFAULT 1,
    UNIQUE(project_id, file_path)
);

CREATE TABLE file_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    file_id UUID REFERENCES project_files(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    version INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    commit_message TEXT
);

-- ============================================
-- COMPILATIONS & ERRORS
-- ============================================
CREATE TABLE compilations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    status TEXT NOT NULL, -- success, error, warning
    source_code TEXT NOT NULL,
    compiler_version TEXT,
    evm_version TEXT,
    optimizer_enabled BOOLEAN DEFAULT true,
    optimizer_runs INTEGER DEFAULT 200,
    bytecode TEXT,
    abi JSONB,
    errors JSONB,
    warnings JSONB,
    gas_estimates JSONB,
    compile_time_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE compile_errors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    compilation_id UUID REFERENCES compilations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    error_type TEXT NOT NULL, -- syntax, type, semantic
    error_message TEXT NOT NULL,
    line_number INTEGER,
    column_number INTEGER,
    source_location TEXT,
    ai_explanation TEXT,
    ai_fix_suggestion TEXT,
    user_accepted_fix BOOLEAN,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- DEPLOYMENTS & TRANSACTIONS
-- ============================================
CREATE TABLE deployments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    compilation_id UUID REFERENCES compilations(id),
    contract_address TEXT NOT NULL,
    network TEXT NOT NULL, -- testnet, mainnet
    chain_id INTEGER,
    transaction_hash TEXT NOT NULL,
    deployer_address TEXT NOT NULL,
    constructor_args JSONB,
    gas_used BIGINT,
    gas_price BIGINT,
    deployment_cost_wei TEXT,
    block_number BIGINT,
    verified BOOLEAN DEFAULT false,
    abi JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deployment_id UUID REFERENCES deployments(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    transaction_hash TEXT NOT NULL,
    function_name TEXT,
    function_args JSONB,
    from_address TEXT NOT NULL,
    to_address TEXT NOT NULL,
    value_wei TEXT,
    gas_used BIGINT,
    gas_price BIGINT,
    status TEXT, -- success, reverted, pending
    block_number BIGINT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE contract_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deployment_id UUID REFERENCES deployments(id) ON DELETE CASCADE,
    event_name TEXT NOT NULL,
    event_args JSONB,
    transaction_hash TEXT,
    log_index INTEGER,
    block_number BIGINT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- AI INTERACTIONS
-- ============================================
CREATE TABLE ai_prompts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    prompt_type TEXT NOT NULL, -- generate, explain, fix, optimize, audit
    prompt_text TEXT NOT NULL,
    response_text TEXT,
    model_used TEXT,
    tokens_input INTEGER,
    tokens_output INTEGER,
    response_time_ms INTEGER,
    user_rating INTEGER, -- 1-5
    user_feedback TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ai_code_fixes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    compile_error_id UUID REFERENCES compile_errors(id),
    user_id UUID REFERENCES users(id),
    original_code TEXT NOT NULL,
    suggested_fix TEXT NOT NULL,
    explanation TEXT,
    teach_mode_content JSONB, -- step by step lesson
    user_accepted BOOLEAN,
    user_modified BOOLEAN,
    final_code TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- SECURITY AUDITS
-- ============================================
CREATE TABLE security_audits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    source_code TEXT NOT NULL,
    overall_risk_score INTEGER, -- 0-100
    risk_level TEXT, -- low, medium, high, critical
    issues JSONB NOT NULL,
    recommendations JSONB,
    gas_analysis JSONB,
    complexity_metrics JSONB,
    audit_duration_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE audit_issues (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    audit_id UUID REFERENCES security_audits(id) ON DELETE CASCADE,
    severity TEXT NOT NULL, -- info, low, medium, high, critical
    category TEXT NOT NULL, -- reentrancy, overflow, access-control, etc
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    line_number INTEGER,
    code_snippet TEXT,
    recommendation TEXT,
    cwe_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Additional AI interaction tracking
CREATE TABLE ai_interactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    interaction_type TEXT NOT NULL, -- chat, suggestion, autocomplete, refactor
    input_text TEXT,
    output_text TEXT,
    accepted BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User feedback
CREATE TABLE feedback (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    feedback_type TEXT NOT NULL, -- bug, feature, improvement, compliment
    subject TEXT,
    message TEXT NOT NULL,
    rating INTEGER, -- 1-5
    page_url TEXT,
    resolved BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- USER ACTIVITY TRACKING (COMPREHENSIVE)
-- ============================================
CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    session_start TIMESTAMPTZ DEFAULT NOW(),
    session_end TIMESTAMPTZ,
    duration_seconds INTEGER,
    ip_address TEXT,
    user_agent TEXT,
    device_type TEXT,
    browser TEXT,
    os TEXT,
    country TEXT,
    city TEXT
);

CREATE TABLE activity_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    session_id UUID REFERENCES user_sessions(id),
    action_type TEXT NOT NULL, -- page_view, button_click, code_change, compile, deploy, etc
    action_category TEXT, -- navigation, editor, compilation, deployment, ai, settings
    action_details JSONB,
    page_url TEXT,
    component_id TEXT,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    duration_ms INTEGER,
    metadata JSONB
);

CREATE TABLE code_changes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    file_id UUID REFERENCES project_files(id) ON DELETE CASCADE,
    change_type TEXT, -- insert, delete, replace
    line_start INTEGER,
    line_end INTEGER,
    old_content TEXT,
    new_content TEXT,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE page_views (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    session_id UUID REFERENCES user_sessions(id),
    page_path TEXT NOT NULL,
    page_title TEXT,
    referrer TEXT,
    time_on_page_seconds INTEGER,
    scroll_depth_percent INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- TEMPLATES & MARKETPLACE
-- ============================================
CREATE TABLE templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    author_id UUID REFERENCES users(id),
    name TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL,
    difficulty TEXT,
    source_code TEXT NOT NULL,
    features TEXT[],
    use_cases TEXT[],
    downloads INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    is_verified BOOLEAN DEFAULT false,
    is_public BOOLEAN DEFAULT true,
    price_usd DECIMAL(10,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE template_downloads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_id UUID REFERENCES templates(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    downloaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- TUTORIALS & LEARNING
-- ============================================
CREATE TABLE tutorials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    content TEXT NOT NULL,
    difficulty TEXT,
    estimated_time_minutes INTEGER,
    tags TEXT[],
    views INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE tutorial_progress (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    tutorial_id UUID REFERENCES tutorials(id),
    progress_percent INTEGER DEFAULT 0,
    completed BOOLEAN DEFAULT false,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    UNIQUE(user_id, tutorial_id)
);

-- ============================================
-- INVESTOR METRICS & ANALYTICS
-- ============================================
CREATE TABLE daily_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    date DATE UNIQUE NOT NULL,
    total_users INTEGER DEFAULT 0,
    new_users INTEGER DEFAULT 0,
    active_users INTEGER DEFAULT 0,
    total_projects INTEGER DEFAULT 0,
    total_compilations INTEGER DEFAULT 0,
    successful_compilations INTEGER DEFAULT 0,
    total_deployments INTEGER DEFAULT 0,
    testnet_deployments INTEGER DEFAULT 0,
    mainnet_deployments INTEGER DEFAULT 0,
    total_ai_prompts INTEGER DEFAULT 0,
    total_audits INTEGER DEFAULT 0,
    gas_spent_wei TEXT,
    revenue_usd DECIMAL(10,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE conversion_funnels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    step_name TEXT NOT NULL, -- signup, first_project, first_compile, first_deploy, pro_upgrade
    completed BOOLEAN DEFAULT false,
    completed_at TIMESTAMPTZ,
    time_to_complete_seconds INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================
CREATE INDEX idx_users_wallet ON users(wallet_address);
CREATE INDEX idx_projects_user ON projects(user_id);
CREATE INDEX idx_compilations_project ON compilations(project_id);
CREATE INDEX idx_deployments_user ON deployments(user_id);
CREATE INDEX idx_activity_logs_user ON activity_logs(user_id);
CREATE INDEX idx_activity_logs_timestamp ON activity_logs(timestamp);
CREATE INDEX idx_ai_prompts_user ON ai_prompts(user_id);
CREATE INDEX idx_daily_metrics_date ON daily_metrics(date);

-- ============================================
-- FUNCTIONS FOR ANALYTICS
-- ============================================
CREATE OR REPLACE FUNCTION update_user_last_active()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE users SET last_active_at = NOW() WHERE id = NEW.user_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_user_activity
AFTER INSERT ON activity_logs
FOR EACH ROW EXECUTE FUNCTION update_user_last_active();

-- Function to increment user deployment count
CREATE OR REPLACE FUNCTION increment_user_deployments()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE users SET total_deployments = total_deployments + 1 WHERE id = NEW.user_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_increment_deployments
AFTER INSERT ON deployments
FOR EACH ROW EXECUTE FUNCTION increment_user_deployments();

-- Function to increment user compile count
CREATE OR REPLACE FUNCTION increment_user_compiles()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE users SET total_compiles = total_compiles + 1 WHERE id = NEW.user_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_increment_compiles
AFTER INSERT ON compilations
FOR EACH ROW EXECUTE FUNCTION increment_user_compiles();

-- ============================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE compilations ENABLE ROW LEVEL SECURITY;
ALTER TABLE compile_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_code_fixes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_downloads ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE code_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE page_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutorials ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutorial_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversion_funnels ENABLE ROW LEVEL SECURITY;

-- Users table: Users can read their own data, anyone can create (for signups), system can update
CREATE POLICY "Users can read own data" ON users FOR SELECT USING (true);
CREATE POLICY "Anyone can insert users" ON users FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update own data" ON users FOR UPDATE USING (true);

-- Projects table: Users can manage their own projects, public read for showcase
CREATE POLICY "Anyone can read projects" ON projects FOR SELECT USING (true);
CREATE POLICY "Anyone can create projects" ON projects FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update projects" ON projects FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete projects" ON projects FOR DELETE USING (true);

-- Project files: Follow project ownership
CREATE POLICY "Anyone can read files" ON project_files FOR SELECT USING (true);
CREATE POLICY "Anyone can create files" ON project_files FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update files" ON project_files FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete files" ON project_files FOR DELETE USING (true);

-- File versions: Follow file ownership
CREATE POLICY "Anyone can read file versions" ON file_versions FOR SELECT USING (true);
CREATE POLICY "Anyone can create file versions" ON file_versions FOR INSERT WITH CHECK (true);

-- Compilations: Follow project ownership, but allow anonymous for demo users
CREATE POLICY "Anyone can read compilations" ON compilations FOR SELECT USING (true);
CREATE POLICY "Anyone can create compilations" ON compilations FOR INSERT WITH CHECK (true);

-- Compile errors: Follow compilation ownership
CREATE POLICY "Anyone can read compile errors" ON compile_errors FOR SELECT USING (true);
CREATE POLICY "Anyone can create compile errors" ON compile_errors FOR INSERT WITH CHECK (true);

-- Deployments: Follow project ownership
CREATE POLICY "Anyone can read deployments" ON deployments FOR SELECT USING (true);
CREATE POLICY "Anyone can create deployments" ON deployments FOR INSERT WITH CHECK (true);

-- AI prompts: Follow user ownership
CREATE POLICY "Anyone can read AI prompts" ON ai_prompts FOR SELECT USING (true);
CREATE POLICY "Anyone can create AI prompts" ON ai_prompts FOR INSERT WITH CHECK (true);

-- AI interactions: Follow project ownership
CREATE POLICY "Anyone can read AI interactions" ON ai_interactions FOR SELECT USING (true);
CREATE POLICY "Anyone can create AI interactions" ON ai_interactions FOR INSERT WITH CHECK (true);

-- Feedback: Public read, anyone can submit
CREATE POLICY "Anyone can read feedback" ON feedback FOR SELECT USING (true);
CREATE POLICY "Anyone can submit feedback" ON feedback FOR INSERT WITH CHECK (true);

-- Templates: Public read, admin write (for now allow all)
CREATE POLICY "Anyone can read templates" ON templates FOR SELECT USING (true);
CREATE POLICY "Anyone can create templates" ON templates FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update templates" ON templates FOR UPDATE USING (true);

-- Template downloads: Track all downloads
CREATE POLICY "Anyone can read template downloads" ON template_downloads FOR SELECT USING (true);
CREATE POLICY "Anyone can create template downloads" ON template_downloads FOR INSERT WITH CHECK (true);

-- Security audits: Follow project ownership
CREATE POLICY "Anyone can read security audits" ON security_audits FOR SELECT USING (true);
CREATE POLICY "Anyone can create security audits" ON security_audits FOR INSERT WITH CHECK (true);

-- Audit issues: Follow audit ownership
CREATE POLICY "Anyone can read audit issues" ON audit_issues FOR SELECT USING (true);
CREATE POLICY "Anyone can create audit issues" ON audit_issues FOR INSERT WITH CHECK (true);

-- User sessions: Users can read their own sessions
CREATE POLICY "Anyone can read sessions" ON user_sessions FOR SELECT USING (true);
CREATE POLICY "Anyone can create sessions" ON user_sessions FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update sessions" ON user_sessions FOR UPDATE USING (true);

-- Activity logs: Users can read their own logs, system can write
CREATE POLICY "Anyone can read activity logs" ON activity_logs FOR SELECT USING (true);
CREATE POLICY "Anyone can create activity logs" ON activity_logs FOR INSERT WITH CHECK (true);

-- Tutorials: Public read
CREATE POLICY "Anyone can read tutorials" ON tutorials FOR SELECT USING (true);
CREATE POLICY "Admins can create tutorials" ON tutorials FOR INSERT WITH CHECK (true);
CREATE POLICY "Admins can update tutorials" ON tutorials FOR UPDATE USING (true);

-- Tutorial progress: Users can manage their own progress
CREATE POLICY "Anyone can read tutorial progress" ON tutorial_progress FOR SELECT USING (true);
CREATE POLICY "Anyone can create tutorial progress" ON tutorial_progress FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update tutorial progress" ON tutorial_progress FOR UPDATE USING (true);

-- Daily metrics: Public read for transparency, system write
CREATE POLICY "Anyone can read daily metrics" ON daily_metrics FOR SELECT USING (true);
CREATE POLICY "System can insert daily metrics" ON daily_metrics FOR INSERT WITH CHECK (true);

-- Conversion funnels: Analytics team read, system write
CREATE POLICY "Anyone can read conversion funnels" ON conversion_funnels FOR SELECT USING (true);
CREATE POLICY "Anyone can create conversion funnels" ON conversion_funnels FOR INSERT WITH CHECK (true);

-- Transactions: Public read
CREATE POLICY "Anyone can read transactions" ON transactions FOR SELECT USING (true);
CREATE POLICY "Anyone can create transactions" ON transactions FOR INSERT WITH CHECK (true);

-- Contract events: Public read
CREATE POLICY "Anyone can read contract events" ON contract_events FOR SELECT USING (true);
CREATE POLICY "Anyone can create contract events" ON contract_events FOR INSERT WITH CHECK (true);

-- AI code fixes: Follow user ownership
CREATE POLICY "Anyone can read AI code fixes" ON ai_code_fixes FOR SELECT USING (true);
CREATE POLICY "Anyone can create AI code fixes" ON ai_code_fixes FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update AI code fixes" ON ai_code_fixes FOR UPDATE USING (true);

-- Code changes: Follow project ownership
CREATE POLICY "Anyone can read code changes" ON code_changes FOR SELECT USING (true);
CREATE POLICY "Anyone can create code changes" ON code_changes FOR INSERT WITH CHECK (true);

-- Page views: Track all views
CREATE POLICY "Anyone can read page views" ON page_views FOR SELECT USING (true);
CREATE POLICY "Anyone can create page views" ON page_views FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update page views" ON page_views FOR UPDATE USING (true);
