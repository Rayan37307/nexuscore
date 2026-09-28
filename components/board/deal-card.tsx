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
      className="animate-card-drop group relative w-full cursor-grab rounded-xl border border-slate-800/90 bg-slate-900/90 p-3.5 text-left shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-slate-700 hover:bg-slate-850 hover:shadow-lg hover:shadow-black/40 active:cursor-grabbing active:translate-y-0"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-slate-100 group-hover:text-indigo-200 transition-colors">
            {deal.title}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] font-medium text-slate-400">
            <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />
            <span className="truncate">{deal.company?.name ?? "—"}</span>
          </div>
        </div>
        <ProbRing value={prob} />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span className="text-sm font-bold tabular-nums text-white">
          {formatMoney(deal.amount, deal.currency)}
        </span>
        {deal.stalled_warning && (
          <span
            title="No activity for 14+ days — re-engagement play queued"
            className="rounded-full border border-amber-500/40 bg-amber-950/60 px-2 py-0.5 text-[10px] font-bold text-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.2)]"
          >
            Stalled
          </span>
        )}
        <Badge className={cn("ml-auto text-[10px] font-semibold", stageMeta.chip)}>{stageMeta.label}</Badge>
      </div>

      {blockers.length > 0 && (
        <div className="mt-2.5 flex items-center gap-1.5 rounded-md border border-amber-500/20 bg-amber-950/30 px-2 py-1 text-[11px] text-amber-300">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-amber-400" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <path d="M12 9v4" /><path d="M12 17h.01" />
          </svg>
          <span className="truncate">{blockers[0]}</span>
          {blockers.length > 1 && <span className="text-amber-400/70 font-semibold">+{blockers.length - 1}</span>}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-slate-800/80 pt-2 text-[11px] text-slate-400">
        <div className="flex items-center gap-1.5">
          <svg viewBox="0 0 24 24" className="h-3 w-3 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
          <span>{timeAgo(deal.last_interaction_date)}</span>
        </div>
        <span className="text-[10px] font-semibold text-slate-500 group-hover:text-slate-300 transition-colors">
          View →
        </span>
      </div>
    </button>
  );
}

function ProbRing({ value }: { value: number }) {
  const color =
    value >= 70
      ? "stroke-emerald-400 drop-shadow-[0_0_4px_rgba(52,211,153,0.5)]"
      : value >= 40
        ? "stroke-amber-400 drop-shadow-[0_0_4px_rgba(251,191,36,0.5)]"
        : "stroke-rose-400 drop-shadow-[0_0_4px_rgba(244,63,94,0.5)]";
  const r = 12;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-8 w-8 shrink-0" title={`Win probability ${value}%`}>
      <svg viewBox="0 0 32 32" className="h-8 w-8 -rotate-90">
        <circle cx="16" cy="16" r={r} className="fill-none stroke-slate-800" strokeWidth="3" />
        <circle
          cx="16" cy="16" r={r}
          className={cn("fill-none", color)}
          strokeWidth="3"
          strokeDasharray={`${(value / 100) * c} ${c}`}
          strokeLinecap="round"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-slate-200">
        {value}
      </span>
    </div>
  );
}
