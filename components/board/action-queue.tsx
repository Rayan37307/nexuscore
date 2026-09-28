"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Label, Textarea, Badge } from "@/components/ui/primitives";
import type { AgentAction } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ActionQueueProps {
  open: boolean;
  onClose: () => void;
  onToast: (message: string) => void;
  onChanged: () => void;
}

const AGENT_META: Record<AgentAction["agent_type"], { label: string; chip: string }> = {
  sdr: { label: "SDR Agent", chip: "bg-violet-950/60 text-violet-300 border-violet-500/40" },
  deal_strategist: { label: "Deal Strategist", chip: "bg-amber-950/60 text-amber-300 border-amber-500/40" },
  health_sentinel: { label: "Health Sentinel", chip: "bg-rose-950/60 text-rose-300 border-rose-500/40" },
};

/** Split the stored "Subject: …\n\n…" draft back into parts (deals table format). */
function splitDraft(text: string): { subject: string; body: string } {
  if (!text) return { subject: "", body: "" };
  const match = text.match(/^Subject:\s*(.*)\n+/i);
  if (!match) return { subject: "", body: text };
  return { subject: match[1], body: text.slice(match.index! + match[0].length).replace(/^\s+/, "") };
}

export function ActionQueue({ open, onClose, onToast, onChanged }: ActionQueueProps) {
  const [actions, setActions] = useState<AgentAction[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/agents/queue");
      const json = await res.json();
      if (res.ok && json.success) setActions(json.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const pending = useMemo(() => actions.filter((a) => a.status === "pending"), [actions]);
  const reviewed = useMemo(
    () => actions.filter((a) => a.status !== "pending").slice(0, 12),
    [actions],
  );

  async function review(
    action: AgentAction,
    decision: "accepted" | "edited" | "rejected" | "dismissed",
    payload?: { subject: string; body: string },
    reason?: string,
  ) {
    const res = await fetch("/api/agents/queue", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: action.id,
        action: decision,
        reason,
        ...(payload ? { payload: { ...action.proposed_payload, draft_email: payload } } : {}),
      }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      onToast(json.error || "Could not record the review.");
      return;
    }
    onToast(
      decision === "accepted"
        ? "Agent action approved ✓"
        : decision === "edited"
          ? "Edited draft saved as human feedback ✓"
          : decision === "rejected"
            ? "Draft rejected — feedback recorded"
            : "Dismissed",
    );
    setEditingId(null);
    setRejectingId(null);
    setRejectReason("");
    await load();
    onChanged();
  }

  function startEdit(action: AgentAction) {
    const draft = action.proposed_payload.draft_email;
    const parts = draft ? { subject: draft.subject, body: draft.body } : splitDraft("");
    setEditSubject(parts.subject);
    setEditBody(parts.body);
    setEditingId(action.id);
  }

  function copyDraft(action: AgentAction) {
    const d = action.proposed_payload.draft_email;
    if (!d) return;
    void navigator.clipboard.writeText(`Subject: ${d.subject}\n\n${d.body}`);
    onToast("Draft copied to clipboard");
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity" onClick={onClose} />
      <aside className="animate-drawer-in absolute inset-y-0 right-0 flex w-full max-w-xl flex-col border-l border-slate-800/90 bg-[#0b0f19] text-slate-100 shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-800/90 bg-slate-900/60 px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold tracking-tight text-white">
                Autonomous agent queue
              </h2>
              {pending.length > 0 && (
                <span className="rounded-full bg-indigo-500 px-2.5 py-0.5 text-[11px] font-bold text-white shadow-[0_0_8px_rgba(99,102,241,0.7)]">
                  {pending.length} pending
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              Human-in-the-loop review (SOP §3.4) — agents propose, you decide.
            </p>
          </div>
          <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </Button>
        </header>

        <div className="flex-1 space-y-3.5 overflow-y-auto px-6 py-5">
          {loading && actions.length === 0 && (
            <p className="text-xs text-slate-400">Loading queue…</p>
          )}

          {!loading && pending.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-8 text-center">
              <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-950/60 text-emerald-400 border border-emerald-500/30">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-slate-200">Queue is clear</p>
              <p className="mt-1 text-xs text-slate-400 leading-relaxed max-w-sm mx-auto">
                Agents propose outreach, deal saves, and health plays after each meeting transcript is ingested.
              </p>
            </div>
          )}

          {pending.map((a) => {
            const meta = AGENT_META[a.agent_type];
            const draft = a.proposed_payload.draft_email;
            const actions2 = a.proposed_payload.recommended_actions ?? [];
            return (
              <article
                key={a.id}
                className={cn(
                  "rounded-xl border bg-slate-900/80 p-4 shadow-sm transition-all",
                  a.requires_dual_approval
                    ? "border-amber-500/50 bg-amber-950/10 shadow-[0_0_12px_rgba(245,158,11,0.1)]"
                    : "border-slate-800",
                )}
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge className={meta.chip}>{meta.label}</Badge>
                      {a.requires_dual_approval && (
                        <Badge className="border-amber-500/40 bg-amber-950/60 text-amber-300">
                          Dual approval required
                        </Badge>
                      )}
                      {a.proposed_payload.health_score != null && (
                        <Badge className="border-slate-700 bg-slate-800 text-slate-300">
                          Health {a.proposed_payload.health_score}/100
                        </Badge>
                      )}
                      {a.proposed_payload.icp_match != null && (
                        <Badge
                          className={
                            a.proposed_payload.icp_match
                              ? "border-emerald-500/40 bg-emerald-950/60 text-emerald-300"
                              : "border-slate-700 bg-slate-800 text-slate-400"
                          }
                        >
                          {a.proposed_payload.icp_match ? "ICP match" : "Below ICP"}
                        </Badge>
                      )}
                    </div>
                    <h3 className="mt-2 text-sm font-semibold text-slate-100">{a.action_title}</h3>
                    <p className="text-[11px] font-medium text-indigo-400 mt-0.5">{a.deal_title ?? a.deal_id}</p>
                  </div>
                </div>

                {a.rationale && (
                  <p className="mt-2.5 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs leading-relaxed text-slate-300">
                    {a.rationale}
                  </p>
                )}

                {draft && editingId !== a.id && (
                  <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
                    <p className="text-xs font-semibold text-slate-200">{draft.subject}</p>
                    <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-slate-300 font-mono">
                      {draft.body}
                    </p>
                  </div>
                )}

                {editingId === a.id && (
                  <div className="mt-3 space-y-2.5">
                    <div>
                      <Label htmlFor={`s-${a.id}`}>Subject</Label>
                      <Input
                        id={`s-${a.id}`}
                        className="mt-1"
                        value={editSubject}
                        onChange={(e) => setEditSubject(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor={`b-${a.id}`}>Body (your edits train the agent memory)</Label>
                      <Textarea
                        id={`b-${a.id}`}
                        rows={8}
                        className="mt-1 font-mono text-xs leading-relaxed"
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                {actions2.length > 0 && editingId !== a.id && (
                  <ul className="mt-2.5 list-inside list-disc text-xs text-slate-400 space-y-1">
                    {actions2.slice(0, 5).map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                )}

                <div className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-slate-800/80 pt-3">
                  {editingId === a.id ? (
                    <>
                      <Button
                        size="sm"
                        onClick={() =>
                          void review(a, "edited", { subject: editSubject, body: editBody })
                        }
                      >
                        Save & approve
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                        Cancel
                      </Button>
                    </>
                  ) : rejectingId === a.id ? (
                    <>
                      <Textarea
                        rows={1}
                        placeholder="Reason (optional) — recorded as agent feedback"
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        className="min-h-9 flex-1 text-xs"
                      />
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => void review(a, "rejected", undefined, rejectReason)}
                      >
                        Confirm reject
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setRejectingId(null)}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      {draft && (
                        <Button
                          size="sm"
                          onClick={() => {
                            copyDraft(a);
                            void review(a, "accepted");
                          }}
                        >
                          Accept & copy
                        </Button>
                      )}
                      {draft && (
                        <a
                          href={`mailto:?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`}
                          onClick={() => void review(a, "accepted")}
                          className="inline-flex h-8 items-center rounded-lg border border-slate-700 bg-slate-800 px-3 text-xs font-medium text-slate-200 hover:bg-slate-700 hover:text-white"
                        >
                          Open in mail
                        </a>
                      )}
                      {!draft && (
                        <Button size="sm" onClick={() => void review(a, "accepted")}>
                          Accept
                        </Button>
                      )}
                      {draft && (
                        <Button size="sm" variant="secondary" onClick={() => startEdit(a)}>
                          Edit
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-rose-400 hover:bg-rose-950/40"
                        onClick={() => setRejectingId(a.id)}
                      >
                        Reject
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void review(a, "dismissed")}>
                        Dismiss
                      </Button>
                    </>
                  )}
                </div>
              </article>
            );
          })}

          {reviewed.length > 0 && (
            <div className="pt-3 border-t border-slate-800/80">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Recently reviewed
              </p>
              <ul className="space-y-1.5">
                {reviewed.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 text-xs text-slate-400">
                    <Badge
                      className={cn(
                        "shrink-0",
                        a.status === "accepted" && "border-emerald-500/40 bg-emerald-950/60 text-emerald-300",
                        a.status === "edited" && "border-sky-500/40 bg-sky-950/60 text-sky-300",
                        (a.status === "rejected" || a.status === "dismissed") &&
                          "border-slate-700 bg-slate-800 text-slate-400",
                      )}
                    >
                      {a.status}
                    </Badge>
                    <span className="truncate">{a.action_title}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
