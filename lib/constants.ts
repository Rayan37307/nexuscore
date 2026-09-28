export const DEAL_STAGES = [
  {
    value: "lead",
    label: "Lead",
    dot: "bg-slate-400 shadow-[0_0_8px_rgba(148,163,184,0.6)]",
    chip: "bg-slate-800/80 text-slate-300 border-slate-700/80",
    header: "text-slate-300",
  },
  {
    value: "discovery",
    label: "Discovery",
    dot: "bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.6)]",
    chip: "bg-sky-950/60 text-sky-300 border-sky-600/40",
    header: "text-sky-400",
  },
  {
    value: "demo",
    label: "Demo",
    dot: "bg-indigo-400 shadow-[0_0_8px_rgba(129,140,248,0.6)]",
    chip: "bg-indigo-950/60 text-indigo-300 border-indigo-600/40",
    header: "text-indigo-400",
  },
  {
    value: "proposal",
    label: "Proposal",
    dot: "bg-violet-400 shadow-[0_0_8px_rgba(167,139,250,0.6)]",
    chip: "bg-violet-950/60 text-violet-300 border-violet-600/40",
    header: "text-violet-400",
  },
  {
    value: "negotiation",
    label: "Negotiation",
    dot: "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]",
    chip: "bg-amber-950/60 text-amber-300 border-amber-600/40",
    header: "text-amber-400",
  },
  {
    value: "closed_won",
    label: "Closed Won",
    dot: "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]",
    chip: "bg-emerald-950/60 text-emerald-300 border-emerald-600/40",
    header: "text-emerald-400",
  },
  {
    value: "closed_lost",
    label: "Closed Lost",
    dot: "bg-rose-400 shadow-[0_0_8px_rgba(244,63,94,0.6)]",
    chip: "bg-rose-950/60 text-rose-300 border-rose-600/40",
    header: "text-rose-400",
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
