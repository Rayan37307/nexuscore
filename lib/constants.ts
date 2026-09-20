export const DEAL_STAGES = [
  {
    value: "lead",
    label: "Lead",
    dot: "bg-slate-400",
    chip: "bg-slate-100 text-slate-700 border-slate-200",
    header: "text-slate-600",
  },
  {
    value: "discovery",
    label: "Discovery",
    dot: "bg-sky-500",
    chip: "bg-sky-50 text-sky-700 border-sky-200",
    header: "text-sky-700",
  },
  {
    value: "demo",
    label: "Demo",
    dot: "bg-indigo-500",
    chip: "bg-indigo-50 text-indigo-700 border-indigo-200",
    header: "text-indigo-700",
  },
  {
    value: "proposal",
    label: "Proposal",
    dot: "bg-violet-500",
    chip: "bg-violet-50 text-violet-700 border-violet-200",
    header: "text-violet-700",
  },
  {
    value: "negotiation",
    label: "Negotiation",
    dot: "bg-amber-500",
    chip: "bg-amber-50 text-amber-700 border-amber-200",
    header: "text-amber-700",
  },
  {
    value: "closed_won",
    label: "Closed Won",
    dot: "bg-emerald-500",
    chip: "bg-emerald-50 text-emerald-700 border-emerald-200",
    header: "text-emerald-700",
  },
  {
    value: "closed_lost",
    label: "Closed Lost",
    dot: "bg-rose-400",
    chip: "bg-rose-50 text-rose-700 border-rose-200",
    header: "text-rose-700",
  },
] as const;

export type DealStage = (typeof DEAL_STAGES)[number]["value"];

export const STAGE_VALUES = DEAL_STAGES.map((s) => s.value) as DealStage[];

export const STAGE_LABELS: Record<DealStage, string> = Object.fromEntries(
  DEAL_STAGES.map((s) => [s.value, s.label]),
) as Record<DealStage, string>;

export function stageMeta(stage: string) {
  return DEAL_STAGES.find((s) => s.value === stage) ?? DEAL_STAGES[0];
}

export const INTERACTION_TYPES = ["meeting_transcript", "email", "call_recording", "note"] as const;
export type InteractionType = (typeof INTERACTION_TYPES)[number];

/** Shared secret for the n8n webhook ingestion route (NEXUSCORE_WEBHOOK_SECRET). */
export const WEBHOOK_HEADER = "x-nexuscore-secret";
