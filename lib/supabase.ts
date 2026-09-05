import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { CompilerDiagnostic, SecurityIssue } from './apiTypes';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Create a mock client if Supabase is not configured
const createSupabaseClient = (): SupabaseClient | null => {
  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('⚠️ Supabase not configured. Analytics will be disabled.');
    return null;
  }
  return createClient(supabaseUrl, supabaseAnonKey);
};

export const supabase = createSupabaseClient();

/** Monad chain ids recorded against deployments. Mainnet launched on chain 143. */
const MONAD_CHAIN_IDS = { mainnet: 143, testnet: 10143 } as const;

/** Quick-action buttons in the studio's AI panel. */
export type QuickActionType = 'explain' | 'optimize' | 'secure' | 'debug';

/** Every prompt category recorded in ai_prompts.prompt_type. */
export type AIPromptType =
  | QuickActionType
  | 'generate'
  | 'fix'
  | 'audit'
  | 'architect'
  | 'research';

/** Arbitrary JSON stored in jsonb columns. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

// Types for our database
export interface User {
  id: string;
  wallet_address: string;
  email?: string;
  username?: string;
  avatar_url?: string;
  created_at: string;
  last_active_at: string;
  total_deployments: number;
  total_compiles: number;
  plan_tier: 'free' | 'pro' | 'enterprise';
  referral_code?: string;
  metadata?: Record<string, JsonValue>;
}

export interface Project {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  is_public: boolean;
  created_at: string;
  updated_at: string;
  template_id?: string;
  tags?: string[];
}

export interface ActivityLog {
  user_id: string;
  session_id?: string;
  action_type: string;
  action_category?: string;
  action_details?: Record<string, JsonValue>;
  page_url?: string;
  component_id?: string;
  duration_ms?: number;
  metadata?: Record<string, JsonValue>;
}

// Analytics tracking functions
export const analytics = {
  // Track any user action
  async trackAction(log: ActivityLog) {
    if (!supabase) return; // Skip if not configured
    
    try {
      await supabase.from('activity_logs').insert({
        ...log,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Failed to track action:', error);
    }
  },

  // Track page view
  async trackPageView(userId: string, pagePath: string, pageTitle?: string) {
    if (!supabase) return;
    
    try {
      await supabase.from('page_views').insert({
        user_id: userId,
        page_path: pagePath,
        page_title: pageTitle,
        referrer: typeof window !== 'undefined' ? document.referrer : undefined,
      });
    } catch (error) {
      console.error('Failed to track page view:', error);
    }
  },

  // Track compilation
  async trackCompilation(data: {
    userId: string;
    projectId?: string;
    status: 'success' | 'error' | 'warning';
    sourceCode: string;
    compilerVersion?: string;
    errors?: CompilerDiagnostic[];
    compileTimeMs?: number;
  }) {
    if (!supabase) return;
    
    try {
      const { data: compilation } = await supabase.from('compilations').insert({
        user_id: data.userId,
        project_id: data.projectId,
        status: data.status,
        source_code: data.sourceCode,
        compiler_version: data.compilerVersion,
        errors: data.errors,
        compile_time_ms: data.compileTimeMs,
      }).select().single();

      return compilation;
    } catch (error) {
      console.error('Failed to track compilation:', error);
    }
  },

  // Track deployment
  async trackDeployment(data: {
    userId: string;
    projectId?: string;
    compilationId?: string;
    contractAddress: string;
    network: 'testnet' | 'mainnet';
    transactionHash: string;
    deployerAddress: string;
    gasUsed?: number;
  }) {
    if (!supabase) return;
    
    try {
      await supabase.from('deployments').insert({
        user_id: data.userId,
        project_id: data.projectId,
        compilation_id: data.compilationId,
        contract_address: data.contractAddress,
        network: data.network,
        transaction_hash: data.transactionHash,
        deployer_address: data.deployerAddress,
        gas_used: data.gasUsed,
        chain_id: MONAD_CHAIN_IDS[data.network],
      });
    } catch (error) {
      console.error('Failed to track deployment:', error);
    }
  },

  // Track AI prompt
  async trackAIPrompt(data: {
    userId: string;
    projectId?: string;
    promptType: AIPromptType;
    promptText: string;
    responseText?: string;
    tokensInput?: number;
    tokensOutput?: number;
    responseTimeMs?: number;
  }) {
    if (!supabase) return;
    
    try {
      await supabase.from('ai_prompts').insert({
        user_id: data.userId,
        project_id: data.projectId,
        prompt_type: data.promptType,
        prompt_text: data.promptText,
        response_text: data.responseText,
        tokens_input: data.tokensInput,
        tokens_output: data.tokensOutput,
        response_time_ms: data.responseTimeMs,
      });
    } catch (error) {
      console.error('Failed to track AI prompt:', error);
    }
  },

  // Track security audit
  async trackSecurityAudit(data: {
    userId: string;
    projectId?: string;
    sourceCode: string;
    riskScore: number;
    riskLevel: string;
    issues: SecurityIssue[];
    auditDurationMs?: number;
  }) {
    if (!supabase) return;
    
    try {
      await supabase.from('security_audits').insert({
        user_id: data.userId,
        project_id: data.projectId,
        source_code: data.sourceCode,
        overall_risk_score: data.riskScore,
        risk_level: data.riskLevel,
        issues: data.issues,
        audit_duration_ms: data.auditDurationMs,
      });
    } catch (error) {
      console.error('Failed to track security audit:', error);
    }
  },

  // Get or create user
  async getOrCreateUser(walletAddress: string) {
    if (!supabase) return null;
    
    try {
      // Try to find existing user
      const { data: existingUser } = await supabase
        .from('users')
        .select('*')
        .eq('wallet_address', walletAddress.toLowerCase())
        .single();

      if (existingUser) {
        // Update last active
        await supabase
          .from('users')
          .update({ last_active_at: new Date().toISOString() })
          .eq('id', existingUser.id);
        return existingUser;
      }

      // Create new user
      const { data: newUser } = await supabase
        .from('users')
        .insert({
          wallet_address: walletAddress.toLowerCase(),
          referral_code: generateReferralCode(),
        })
        .select()
        .single();

      return newUser;
    } catch (error) {
      console.error('Failed to get or create user:', error);
      return null;
    }
  },

  // Get user stats
  async getUserStats(userId: string) {
    if (!supabase) return null;
    
    try {
      const [
        { count: projectCount },
        { count: deployCount },
        { count: compileCount },
      ] = await Promise.all([
        supabase.from('projects').select('*', { count: 'exact', head: true }).eq('user_id', userId),
        supabase.from('deployments').select('*', { count: 'exact', head: true }).eq('user_id', userId),
        supabase.from('compilations').select('*', { count: 'exact', head: true }).eq('user_id', userId),
      ]);

      return {
        projects: projectCount || 0,
        deployments: deployCount || 0,
        compilations: compileCount || 0,
      };
    } catch (error) {
      console.error('Failed to get user stats:', error);
      return null;
    }
  },

  // Get platform metrics (for investors)
  async getPlatformMetrics() {
    if (!supabase) return null;
    
    try {
      const [
        { count: totalUsers },
        { count: totalProjects },
        { count: totalDeployments },
        { count: mainnetDeployments },
        { count: totalCompilations },
        { count: totalAIPrompts },
      ] = await Promise.all([
        supabase.from('users').select('*', { count: 'exact', head: true }),
        supabase.from('projects').select('*', { count: 'exact', head: true }),
        supabase.from('deployments').select('*', { count: 'exact', head: true }),
        supabase.from('deployments').select('*', { count: 'exact', head: true }).eq('network', 'mainnet'),
        supabase.from('compilations').select('*', { count: 'exact', head: true }),
        supabase.from('ai_prompts').select('*', { count: 'exact', head: true }),
      ]);

      return {
        totalUsers: totalUsers || 0,
        totalProjects: totalProjects || 0,
        totalDeployments: totalDeployments || 0,
        mainnetDeployments: mainnetDeployments || 0,
        totalCompilations: totalCompilations || 0,
        totalAIPrompts: totalAIPrompts || 0,
      };
    } catch (error) {
      console.error('Failed to get platform metrics:', error);
      return null;
    }
  },
};

function generateReferralCode(): string {
  return 'SS' + Math.random().toString(36).substring(2, 8).toUpperCase();
}

export default supabase;
