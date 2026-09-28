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
    <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-[#090d16]/85 backdrop-blur-md shadow-lg shadow-black/30">
      <div className="mx-auto flex max-w-[1600px] items-center gap-4 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 text-white shadow-[0_0_16px_rgba(99,102,241,0.45)]">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold tracking-tight text-white">NexusCore</span>
              <span className="rounded-full border border-indigo-500/30 bg-indigo-950/60 px-2 py-0.2 text-[10px] font-semibold text-indigo-300">
                PRO
              </span>
            </div>
            <div className="text-[11px] text-slate-400">Autonomous revenue intelligence</div>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-3 sm:gap-4">
          <Stat label="Open deals" value={String(stats.openCount)} />
          <Stat label="Open pipeline" value={formatMoney(stats.openValue)} />
          <Stat label="Weighted" value={formatMoney(stats.weightedPipeline)} highlight />
          <Stat label="Closed won" value={formatMoney(stats.wonValue)} success />

          <button
            type="button"
            onClick={onTogglePause}
            title={agentsPaused ? "Agents paused — Passive Read-Only Mode (click to resume)" : "Agents active (click for Emergency Stop, SOP §3.6)"}
            className={cn(
              "hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all sm:inline-flex cursor-pointer shadow-sm",
              agentsPaused
                ? "border-rose-500/40 bg-rose-950/50 text-rose-300 hover:bg-rose-900/60"
                : "border-emerald-500/40 bg-emerald-950/50 text-emerald-300 hover:bg-emerald-900/60 shadow-[0_0_12px_rgba(16,185,129,0.15)]",
            )}
          >
            <span className={cn("h-2 w-2 rounded-full", agentsPaused ? "bg-rose-500" : "animate-pulse bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]")} />
            {agentsPaused ? "Agents paused" : "Agents active"}
          </button>

          <Button variant="secondary" size="sm" onClick={onQueueClick} className="relative">
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-indigo-400" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 12l2 2 4-4" />
              <rect x="3" y="4" width="18" height="16" rx="2" />
            </svg>
            <span>Queue</span>
            {pendingAgentActions > 0 && (
              <span className="ml-1 rounded-full bg-indigo-500 px-1.5 py-0.2 text-[10px] font-bold text-white shadow-[0_0_8px_rgba(99,102,241,0.7)]">
                {pendingAgentActions}
              </span>
            )}
          </Button>

          <Button size="sm" onClick={onIngestClick} className="gap-1.5">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span>Ingest</span>
          </Button>

          <Button variant="ghost" size="icon" aria-label="Sign out" onClick={onSignOut} title="Sign out">
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-400 hover:text-slate-200" fill="none" stroke="currentColor" strokeWidth="2">
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

function Stat({
  label,
  value,
  highlight,
  success,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  success?: boolean;
}) {
  return (
    <div className="hidden text-right md:block">
      <div className="text-[10px] uppercase font-semibold tracking-wider text-slate-400">{label}</div>
      <div
        className={cn(
          "text-sm font-bold tabular-nums",
          highlight ? "text-indigo-400" : success ? "text-emerald-400" : "text-slate-100",
        )}
      >
        {value}
      </div>
    </div>
  );
}
