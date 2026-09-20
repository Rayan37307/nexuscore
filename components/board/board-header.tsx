"use client";

import { Button } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/utils";
import type { BoardStats } from "@/lib/data/deals";
import { cn } from "@/lib/utils";

interface BoardHeaderProps {
  stats: BoardStats;
  pendingAgentActions: number;
  agentsPaused: boolean;
  onQueueClick: () => void;
  onTogglePause: () => void;
  onIngestClick: () => void;
  onSignOut: () => void;
}

export function BoardHeader({
  stats,
  pendingAgentActions,
  agentsPaused,
  onQueueClick,
  onTogglePause,
  onIngestClick,
  onSignOut,
}: BoardHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] items-center gap-4 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900">NexusCore</div>
            <div className="text-[11px] text-slate-500">Autonomous revenue intelligence</div>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <Stat label="Open deals" value={String(stats.openCount)} />
          <Stat label="Open pipeline" value={formatMoney(stats.openValue)} />
          <Stat label="Weighted" value={formatMoney(stats.weightedPipeline)} />
          <Stat label="Closed won" value={formatMoney(stats.wonValue)} />

          <button
            type="button"
            onClick={onTogglePause}
            title={agentsPaused ? "Agents paused — Passive Read-Only Mode (click to resume)" : "Agents active (click for Emergency Stop, SOP §3.6)"}
            className={cn(
              "hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors sm:inline-flex",
              agentsPaused
                ? "border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100"
                : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", agentsPaused ? "bg-rose-500" : "animate-pulse bg-emerald-500")} />
            {agentsPaused ? "Agents paused" : "Agents active"}
          </button>

          <Button variant="secondary" size="sm" onClick={onQueueClick}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 12l2 2 4-4" />
              <rect x="3" y="4" width="18" height="16" rx="2" />
            </svg>
            Agent queue
            {pendingAgentActions > 0 && (
              <span className="ml-0.5 rounded-full bg-slate-900 px-1.5 text-[10px] font-semibold text-white">
                {pendingAgentActions}
              </span>
            )}
          </Button>

          <Button size="sm" onClick={onIngestClick}>+ Ingest</Button>
          <Button variant="ghost" size="icon" aria-label="Sign out" onClick={onSignOut}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
              <path d="M16 17l5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
          </Button>
        </div>
      </div>
    </header>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="hidden text-right md:block">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-sm font-semibold tabular-nums text-slate-800">{value}</div>
    </div>
  );
}
