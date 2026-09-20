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
    <div className="min-h-screen">
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
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <h2 className="text-lg font-semibold text-slate-900">Your pipeline is empty</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
              Ingest your first meeting transcript or email thread — NexusCore creates the company,
              deal, stage, and a follow-up draft automatically. Or run{" "}
              <code className="rounded bg-slate-100 px-1 text-xs">npm run db:seed</code> for demo data.
            </p>
            <Button className="mt-4" onClick={() => setIngestOpen(true)}>
              Ingest your first interaction
            </Button>
          </div>
        ) : (
          <div className="grid grid-flow-col auto-cols-[minmax(230px,1fr)] gap-3 overflow-x-auto pb-4">
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
        <div className="fixed bottom-4 left-1/2 z-[70] -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
