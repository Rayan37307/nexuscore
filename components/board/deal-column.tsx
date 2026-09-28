"use client";

import { useState } from "react";
import { DEAL_STAGES } from "@/lib/constants";
import type { Deal } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DealCard } from "./deal-card";

interface DealColumnProps {
  stage: (typeof DEAL_STAGES)[number];
  deals: Deal[];
  onCardClick: (deal: Deal) => void;
  onDrop: (dealId: string, stage: DealStageValue) => void;
}

type DealStageValue = (typeof DEAL_STAGES)[number]["value"];

export function DealColumn({ stage, deals, onCardClick, onDrop }: DealColumnProps) {
  const [isOver, setIsOver] = useState(false);

  const total = deals.reduce((sum, d) => sum + Number(d.amount ?? 0), 0);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsOver(true);
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsOver(false);
        const dealId = e.dataTransfer.getData("text/deal-id");
        if (dealId) onDrop(dealId, stage.value);
      }}
      className={cn(
        "flex min-h-[360px] flex-col rounded-xl border transition-all duration-200 shadow-sm",
        isOver
          ? "border-indigo-500/60 bg-slate-900/90 shadow-[0_0_20px_rgba(99,102,241,0.15)] scale-[1.01]"
          : "border-slate-800/70 bg-slate-900/40 backdrop-blur-sm",
      )}
    >
      <div className="flex items-center gap-2 border-b border-slate-800/80 bg-slate-900/70 px-3 py-2.5 rounded-t-xl">
        <span className={cn("h-2 w-2 rounded-full", stage.dot)} />
        <span className={cn("text-xs font-bold uppercase tracking-wider", stage.header)}>
          {stage.label}
        </span>
        <span className="ml-auto text-[11px] font-medium text-slate-400 tabular-nums">
          {deals.length} · ${total >= 1000 ? `${Math.round(total / 1000)}k` : total}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2.5 p-2.5">
        {deals.map((deal) => (
          <DealCard key={deal.id} deal={deal} onClick={() => onCardClick(deal)} />
        ))}
        {deals.length === 0 && (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-slate-800/80 bg-slate-950/20 p-4 text-[11px] font-medium text-slate-500">
            Drop deal here
          </div>
        )}
      </div>
    </div>
  );
}
