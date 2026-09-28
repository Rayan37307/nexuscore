"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { DEAL_STAGES, STAGE_LABELS, type DealStage } from "@/lib/constants";
import type { Deal } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/primitives";
import { BoardHeader } from "./board-header";
import { DealCard } from "./deal-card";
import { DealColumn } from "./deal-column";
import { IngestionDrawer } from "./ingestion-drawer";
import { FollowUpStudio } from "./follow-up-studio";
import { ActionQueue } from "./action-queue";

interface BoardClientProps {
  initialDeals: Deal[];
  userId: string;
}

export function BoardClient({ initialDeals, userId }: BoardClientProps) {
  const router = useRouter();
  const [deals, setDeals] = useState<Deal[]>(initialDeals);
  const [ingestOpen, setIngestOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [pendingAgentActions, setPendingAgentActions] = useState(0);
  const [agentsPaused, setAgentsPaused] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [optimisticStage, setOptimisticStage] = useState<Record<string, DealStage>>({});
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 12000);
    return () => clearTimeout(t);
  }, [toast]);

  // Keep local state in sync when the server re-renders with fresh deals.
  useEffect(() => {
    setDeals(initialDeals);
  }, [initialDeals]);

  // ── Agent workforce status: pending count + kill switch state ───────
  useEffect(() => {
    let cancelled = false;
    async function loadAgentState() {
      try {
        const [queueRes, settingsRes] = await Promise.all([
          fetch("/api/agents/queue"),
          fetch("/api/agents/settings"),
        ]);
        const queueJson = await queueRes.json();
        const settingsJson = await settingsRes.json();
        if (cancelled) return;
        if (queueRes.ok && queueJson.success) {
          setPendingAgentActions(
            (queueJson.data as { status: string }[]).filter((a) => a.status === "pending").length,
          );
        }
        if (settingsRes.ok && settingsJson.success) {
          setAgentsPaused(settingsJson.data.agents_paused === true);
        }
      } catch {
        /* non-fatal: header falls back to defaults */
      }
    }
    void loadAgentState();
    return () => {
      cancelled = true;
    };
  }, [router]);

  // ── Realtime: any insert/update on deals refreshes the board ─────────
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel("deals-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "deals" },
        () => router.refresh(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const routerDeals = useMemo(() => {
    if (Object.keys(optimisticStage).length === 0) return deals;
    return deals.map((d) =>
      optimisticStage[d.id] ? { ...d, stage: optimisticStage[d.id] } : d,
    );
  }, [deals, optimisticStage]);

  const grouped = useMemo(() => {
    const map = new Map<DealStage, Deal[]>();
    for (const s of DEAL_STAGES) map.set(s.value, []);
    for (const d of routerDeals) {
      const list = map.get(d.stage);
      if (list) list.push(d);
    }
    return map;
  }, [routerDeals]);

  const refresh = useCallback(() => router.refresh(), [router]);

  const handleDrop = useCallback(
    async (dealId: string, targetStage: DealStage) => {
      const deal = deals.find((d) => d.id === dealId);
      if (!deal || deal.stage === targetStage) return;
      setOptimisticStage((prev) => ({ ...prev, [dealId]: targetStage }));
      const res = await fetch("/api/deals/stage", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dealId, stage: targetStage }),
      });
      if (!res.ok) {
        setOptimisticStage((prev) => {
          const next = { ...prev };
          delete next[dealId];
          return next;
        });
        setToast("Could not move the deal — check the server logs.");
        return;
      }
      setTimeout(refresh, 300);
    },
    [deals, refresh],
  );

  const handleSignOut = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }, []);

  const selected = useMemo(
    () => routerDeals.find((d) => d.id === selectedDeal?.id) ?? null,
    [routerDeals, selectedDeal],
  );

  const stats = useMemo(() => {
    let openCount = 0;
    let openValue = 0;
    let weightedPipeline = 0;
    let wonValue = 0;
    for (const d of routerDeals) {
      const amount = Number(d.amount ?? 0);
      const prob = Number(d.win_probability ?? 0);
      if (d.stage === "closed_won") {
        wonValue += amount;
      } else if (d.stage !== "closed_lost") {
        openCount += 1;
        openValue += amount;
        weightedPipeline += (amount * prob) / 100;
      }
    }
    return { openCount, openValue, weightedPipeline, wonValue };
  }, [routerDeals]);

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 relative selection:bg-indigo-500/30">
      {/* Subtle ambient lighting */}
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,119,198,0.15),rgba(255,255,255,0))]" />

      <BoardHeader
        stats={stats}
        pendingAgentActions={pendingAgentActions}
        agentsPaused={agentsPaused}
        onQueueClick={() => setQueueOpen(true)}
        onTogglePause={async () => {
          const next = !agentsPaused;
          setAgentsPaused(next);
          const res = await fetch("/api/agents/settings", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ agents_paused: next }),
          });
          if (!res.ok) {
            setAgentsPaused(!next);
            setToast("Could not update the agent switch.");
            return;
          }
          setToast(next ? "Emergency Stop — Passive Read-Only Mode (SOP §3.6)" : "Agents resumed");
        }}
        onIngestClick={() => setIngestOpen(true)}
        onSignOut={handleSignOut}
      />

      <main className="mx-auto max-w-[1600px] px-4 pb-16 pt-6">
        {deals.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-12 text-center shadow-xl backdrop-blur-sm">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-950/60 text-indigo-400 border border-indigo-500/30 shadow-[0_0_15px_rgba(99,102,241,0.3)]">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <h2 className="text-lg font-bold tracking-tight text-white">Your pipeline is empty</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-400 leading-relaxed">
              Ingest your first meeting transcript or email thread — NexusCore creates the company,
              deal, stage, and a follow-up draft automatically.
            </p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <Button onClick={() => setIngestOpen(true)} className="gap-2 shadow-lg shadow-indigo-500/20">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Ingest interaction
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-flow-col auto-cols-[minmax(250px,1fr)] gap-3.5 overflow-x-auto pb-4">
            {DEAL_STAGES.map((stage) => (
              <DealColumn
                key={stage.value}
                stage={stage}
                deals={grouped.get(stage.value) ?? []}
                onCardClick={setSelectedDeal}
                onDrop={handleDrop}
              />
            ))}
          </div>
        )}
      </main>

      <IngestionDrawer
        open={ingestOpen}
        onClose={() => setIngestOpen(false)}
        deals={deals}
        onIngested={(msg) => {
          setToast(msg);
          setIngestOpen(false);
          refresh();
          // Refresh the agent badge too — ingestion may have queued proposals.
          fetch("/api/agents/queue")
            .then((r) => r.json())
            .then((j) => {
              if (j?.success) {
                setPendingAgentActions(
                  (j.data as { status: string }[]).filter((a) => a.status === "pending").length,
                );
              }
            })
            .catch(() => {});
        }}
      />

      <FollowUpStudio
        deal={selected}
        onClose={() => setSelectedDeal(null)}
        onToast={setToast}
      />

      <ActionQueue
        open={queueOpen}
        onClose={() => setQueueOpen(false)}
        onToast={setToast}
        onChanged={refresh}
      />

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 flex items-center gap-2 rounded-full border border-slate-700/80 bg-slate-900/95 px-5 py-2.5 text-sm font-medium text-slate-100 shadow-2xl shadow-black/80 backdrop-blur-md animate-card-drop">
          <span className="h-2 w-2 rounded-full bg-indigo-400 shadow-[0_0_8px_rgba(99,102,241,0.8)]" />
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}
