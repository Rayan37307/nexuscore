"use client";

import { DEAL_STAGES } from "@/lib/constants";
import type { Deal } from "@/lib/types";
import { cn, formatMoney, timeAgo } from "@/lib/utils";
import { Badge } from "@/components/ui/primitives";

interface DealCardProps {
  deal: Deal;
  onClick: () => void;
}

export function DealCard({ deal, onClick }: DealCardProps) {
  const stageMeta = DEAL_STAGES.find((s) => s.value === deal.stage) ?? DEAL_STAGES[0];
  const blockers = deal.key_blockers ?? [];
  const prob = Math.max(0, Math.min(100, Number(deal.win_probability ?? 0)));

  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/deal-id", deal.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={onClick}
      className="animate-card-drop group w-full cursor-grab rounded-lg border border-slate-200 bg-white p-3 text-left shadow-sm transition-all hover:border-slate-300 hover:shadow active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-slate-900">{deal.title}</div>
          <div className="mt-0.5 truncate text-[11px] text-slate-500">
            {deal.company?.name ?? "—"}
          </div>
        </div>
        <ProbRing value={prob} />
      </div>

      <div className="mt-2 flex items-center gap-2">
        <span className="text-sm font-semibold tabular-nums text-slate-800">
          {formatMoney(deal.amount, deal.currency)}
        </span>
        {deal.stalled_warning && (
          <span
            title="No activity for 14+ days — re-engagement play queued"
            className="rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
          >
            Stalled
          </span>
        )}
        <Badge className={cn("ml-auto", stageMeta.chip)}>{stageMeta.label}</Badge>
      </div>

      {blockers.length > 0 && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-700">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <path d="M12 9v4" /><path d="M12 17h.01" />
          </svg>
          <span className="truncate">{blockers[0]}</span>
          {blockers.length > 1 && <span className="text-slate-400">+{blockers.length - 1}</span>}
        </div>
      )}

      <div className="mt-2 flex items-center gap-1.5 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
        Last interaction {timeAgo(deal.last_interaction_date)}
      </div>
    </button>
  );
}

function ProbRing({ value }: { value: number }) {
  const color = value >= 70 ? "stroke-emerald-500" : value >= 40 ? "stroke-amber-500" : "stroke-rose-400";
  const r = 12;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-8 w-8 shrink-0" title={`Win probability ${value}%`}>
      <svg viewBox="0 0 32 32" className="h-8 w-8 -rotate-90">
        <circle cx="16" cy="16" r={r} className="fill-none stroke-slate-200" strokeWidth="3" />
        <circle
          cx="16" cy="16" r={r}
          className={cn("fill-none", color)}
          strokeWidth="3"
          strokeDasharray={`${(value / 100) * c} ${c}`}
          strokeLinecap="round"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-slate-600">
        {value}
      </span>
    </div>
  );
}
