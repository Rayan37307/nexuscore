import { z } from "zod";
import type { DealStage, InteractionType } from "./constants";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
}

export interface Company {
  id: string;
  user_id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size_estimate: string | null;
  health_score: number | null;
  annual_revenue: number | null;
  employee_count: number | null;
}

export interface Contact {
  id: string;
  company_id: string | null;
  user_id: string;
  first_name: string;
  last_name: string | null;
  email: string;
  phone: string | null;
  job_title: string | null;
  linkedin_url: string | null;
  stakeholder_role: string | null;
}

export interface Deal {
  id: string;
  user_id: string;
  company_id: string | null;
  title: string;
  stage: DealStage;
  amount: number | null;
  currency: string;
  win_probability: number | null;
  ai_summary: string | null;
  key_blockers: string[] | null;
  identified_budget: number | null;
  next_steps: string[] | null;
  follow_up_draft: string | null;
  last_interaction_date: string | null;
  expected_close_date: string | null;
  stalled_warning: boolean | null;
  created_at: string;
  updated_at: string;
  company?: { id: string; name: string } | null;
}

/** A proposal from the autonomous agent workforce, awaiting human review. */
export interface AgentAction {
  id: string;
  user_id: string;
  agent_type: "sdr" | "deal_strategist" | "health_sentinel";
  target_entity_type: string;
  target_entity_id: string;
  deal_id: string | null;
  action_title: string;
  rationale: string | null;
  proposed_payload: {
    draft_email?: { subject: string; body: string };
    recommended_actions?: string[];
    icp_match?: boolean | null;
    health_score?: number | null;
    requires_dual_approval?: boolean;
    [k: string]: unknown;
  };
  requires_dual_approval: boolean | null;
  status: "pending" | "accepted" | "edited" | "rejected" | "dismissed";
  rejection_reason: string | null;
  created_at: string;
  reviewed_at: string | null;
  deal_title?: string | null;
}

export interface Interaction {
  id: string;
  deal_id: string;
  user_id: string;
  type: InteractionType;
  source_identifier: string | null;
  raw_content: string;
  sanitized_summary: string | null;
  action_items: unknown;
  sentiment_score: number | null;
  occurred_at: string;
  created_at: string;
}

export interface DealEmbedding {
  id: string;
  deal_id: string;
  interaction_id: string | null;
  content_chunk: string;
  created_at: string;
}

/**
 * Structured output of the Groq extraction call (Module A/B of the spec).
 * Validated with zod before anything touches the database.
 */
export const ExtractionSchema = z.object({
  company_name: z.string().min(1, "company_name is required"),
  deal_title: z.string().nullish(),
  contact_names: z.array(z.string()).default([]),
  contact_emails: z.array(z.string()).default([]),
  suggested_stage: z
    .enum(["lead", "discovery", "demo", "proposal", "negotiation", "closed_won", "closed_lost"])
    .default("discovery"),
  win_probability: z.coerce.number().min(0).max(100).default(20),
  identified_budget: z.coerce.number().min(0).nullish(),
  key_blockers: z.array(z.string()).default([]),
  next_steps: z.array(z.string()).default([]),
  executive_summary: z.string().min(1, "executive_summary is required"),
  follow_up_email: z.object({
    subject: z.string().min(1),
    body: z.string().min(1),
  }),
  sentiment_score: z.coerce.number().min(-1).max(1).default(0),
  /** v2 §4.1: stakeholder influence mapping (Champion, Economic Buyer, Blocker, Influencer). */
  stakeholders: z
    .array(
      z.object({
        name: z.string().min(1),
        role: z.enum(["Champion", "Economic Buyer", "Blocker", "Influencer", "Technical Evaluator"]),
      }),
    )
    .default([]),
  /** v2 §4.2: concession governance — discount percentage discussed, if any. */
  discount_mentioned_pct: z.coerce.number().min(0).max(100).nullish(),
});

export type Extraction = z.infer<typeof ExtractionSchema>;

export const DealAnswerSchema = z.object({
  answer: z.string().min(1),
});
