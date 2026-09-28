"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/primitives";
import { Badge, Label, Textarea, Input } from "@/components/ui/primitives";
import { DEAL_STAGES, STAGE_LABELS } from "@/lib/constants";
import type { Deal } from "@/lib/types";
import { cn, formatMoney, mailtoHref, parseDraft } from "@/lib/utils";

interface FollowUpStudioProps {
  deal: Deal | null;
  onClose: () => void;
  onToast: (msg: string) => void;
}

interface MemoryHit {
  content_chunk: string;
  similarity: number;
}

interface AskState {
  answer: string;
  citations: MemoryHit[];
}

export function FollowUpStudio({ deal, onClose, onToast }: FollowUpStudioProps) {
  const [stage, setStage] = useState("lead");
  const [amount, setAmount] = useState("0");
  const [probability, setProbability] = useState("20");
  const [draft, setDraft] = useState({ subject: "", body: "" });
  const [savingDraft, setSavingDraft] = useState(false);
  const [question, setQuestion] = useState("");
  const [askState, setAskState] = useState<AskState | null>(null);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    if (!deal) return;
    const d = parseDraft(deal.follow_up_draft);
    setDraft(d);
    setStage(deal.stage);
    setAmount(String(deal.amount ?? 0));
    setProbability(String(deal.win_probability ?? 20));
    setQuestion("");
    setAskState(null);
    setAskError(null);
    setShowRaw(false);
  }, [deal?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Narrow `deal` for the closures below (render only continues with a deal).
  const activeDeal = deal as Deal;

  if (!deal) return null;

  const stageMeta = DEAL_STAGES.find((s) => s.value === deal.stage) ?? DEAL_STAGES[0];
  const contacts = (deal as Deal & { contacts?: { first_name: string; last_name: string | null; email: string }[] }).contacts ?? [];
  const primaryContactEmail = contacts[0]?.email;

  async function saveDraft() {
    setSavingDraft(true);
    try {
      const res = await fetch("/api/deals/follow-up", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dealId: activeDeal.id,
          followUpDraft: `${draft.subject ? `Subject: ${draft.subject}\n\n` : ""}${draft.body}`,
        }),
      });
      if (res.ok) {
        onToast("Follow-up draft saved");
      } else {
        onToast("Could not save draft");
      }
    } finally {
      setSavingDraft(false);
    }
  }

  async function askMemory() {
    if (!question.trim()) return;
    setAsking(true);
    setAskError(null);
    setAskState(null);
    try {
      const res = await fetch("/api/deals/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dealId: activeDeal.id, question }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Memory search failed");
      setAskState({ answer: json.data.answer, citations: json.data.citations ?? [] });
    } catch (err: unknown) {
      setAskError(err instanceof Error ? err.message : "Memory search failed.");
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity" onClick={onClose} />
      <aside className="animate-drawer-in absolute inset-y-0 right-0 flex w-full max-w-xl flex-col border-l border-slate-800/90 bg-[#0b0f19] text-slate-100 shadow-2xl">
        <header className="border-b border-slate-800/90 bg-slate-900/60 px-6 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Badge className={cn(stageMeta.chip)}>{stageMeta.label}</Badge>
                <span className="text-xs font-semibold text-slate-400">
                  Win prob {deal.win_probability}%
                </span>
              </div>
              <h2 className="mt-1.5 truncate text-base font-bold tracking-tight text-white">{deal.title}</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {deal.company?.name ?? "—"} · <span className="font-semibold text-slate-200">{formatMoney(deal.amount, deal.currency)}</span>
                {deal.identified_budget ? ` · budget ${formatMoney(deal.identified_budget)}` : ""}
              </p>
            </div>
            <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </Button>
          </div>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <section>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
              AI-synthesized briefing
            </h3>
            <div className="rounded-xl border border-indigo-500/25 bg-indigo-950/20 p-4 text-sm leading-relaxed text-slate-200 shadow-inner">
              {deal.ai_summary ?? "No AI summary yet — ingest a transcript or email for this deal."}
            </div>
          </section>

          {contacts.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                Contacts
              </h3>
              <div className="flex flex-wrap gap-2">
                {contacts.map((c) => (
                  <Badge key={c.email} className="bg-slate-900 text-slate-300 border-slate-700/80 px-2.5 py-1">
                    <span className="font-semibold text-slate-100">{c.first_name} {c.last_name ?? ""}</span>
                    <span className="text-slate-500">·</span>
                    <span className="text-slate-400">{c.email}</span>
                  </Badge>
                ))}
              </div>
            </section>
          )}

          <section className="grid grid-cols-3 gap-3 rounded-xl border border-slate-800/80 bg-slate-900/40 p-3.5">
            <div className="space-y-1.5">
              <Label htmlFor="stage-select">Stage</Label>
              <select
                id="stage-select"
                value={stage}
                onChange={(e) => setStage(e.target.value)}
                className="flex h-9 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 text-xs text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                {DEAL_STAGES.map((s) => (
                  <option key={s.value} value={s.value} className="bg-slate-900 text-slate-100">
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="probability-input">Win prob %</Label>
              <Input
                id="probability-input"
                type="number" min={0} max={100}
                value={probability}
                onChange={(e) => setProbability(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="amount-input">Amount ($)</Label>
              <Input
                id="amount-input"
                type="number" min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
              Identified risks & blockers
            </h3>
            {(deal.key_blockers ?? []).length === 0 ? (
              <p className="text-xs text-slate-500">No blockers detected.</p>
            ) : (
              <ul className="space-y-1.5">
                {(deal.key_blockers ?? []).map((b, i) => (
                  <li key={i} className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
                    <svg viewBox="0 0 24 24" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                      <path d="M12 9v4" /><path d="M12 17h.01" />
                    </svg>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
              Next steps
            </h3>
            {(deal.next_steps ?? []).length === 0 ? (
              <p className="text-xs text-slate-500">None captured yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {(deal.next_steps ?? []).map((s, i) => (
                  <li key={i} className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-200">
                    <svg viewBox="0 0 24 24" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                      <path d="M22 4L12 14.01l-3-3" />
                    </svg>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Ask deal memory (pgvector)
            </h3>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Semantic vector search over all meeting transcripts & emails linked to this deal.
            </p>
            <div className="mt-2.5 flex gap-2">
              <Input
                placeholder="What were the security concerns in the last demo?"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    askMemory();
                  }
                }}
              />
              <Button type="button" onClick={askMemory} disabled={asking || !question.trim()}>
                {asking ? "…" : "Ask"}
              </Button>
            </div>
            {askError && <p className="mt-2 text-xs text-rose-400">{askError}</p>}
            {askState && (
              <div className="mt-3 space-y-2 rounded-lg bg-slate-950/60 p-3 border border-slate-800">
                <p className="text-xs leading-relaxed text-slate-200">{askState.answer}</p>
                {askState.citations.length > 0 && (
                  <details className="pt-1">
                    <summary className="cursor-pointer text-[11px] font-medium text-indigo-400 hover:text-indigo-300">
                      {askState.citations.length} cited memory segments
                    </summary>
                    <div className="mt-2 space-y-1.5">
                      {askState.citations.map((h, i) => (
                        <p key={i} className="rounded-lg bg-slate-900/80 border border-slate-800 p-2 text-[11px] text-slate-400">
                          <span className="font-semibold text-indigo-300">[{i + 1}] · score {h.similarity.toFixed(3)}:</span>{" "}
                          {h.content_chunk.slice(0, 220)}…
                        </p>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Follow-up email draft
              </h3>
              <button
                type="button"
                className="text-[11px] text-slate-500 hover:text-slate-300 underline cursor-pointer"
                onClick={() => setShowRaw((v) => !v)}
              >
                {showRaw ? "hide" : "show"} raw
              </button>
            </div>
            <div className="space-y-2">
              <Input
                placeholder="Subject"
                value={draft.subject}
                onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))}
              />
              <Textarea
                rows={9}
                placeholder="Email body"
                value={draft.body}
                onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                className="font-mono text-xs leading-relaxed"
              />
            </div>
            {showRaw && (
              <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-950 p-3 text-[11px] text-slate-400 font-mono">
                {deal.follow_up_draft}
              </pre>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={saveDraft}
                disabled={savingDraft || !draft.body.trim()}
              >
                {savingDraft ? "Saving…" : "Save draft"}
              </Button>
              <a href={mailtoHref(primaryContactEmail, draft.subject, draft.body)} target="_blank" rel="noreferrer">
                <Button variant="outline">Open in mail client</Button>
              </a>
              <Button
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`);
                  onToast("Draft copied to clipboard");
                }}
              >
                Copy
              </Button>
            </div>
          </section>
        </div>

        <footer className="border-t border-slate-800/90 bg-slate-900/60 px-6 py-4">
          <Button
            className="w-full shadow-lg shadow-indigo-500/20"
            onClick={async () => {
              const res = await fetch("/api/deals/stage", {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  dealId: deal.id,
                  stage,
                  winProbability: probability === "" ? undefined : Number(probability),
                  amount: amount === "" ? undefined : Number(amount),
                }),
              });
              if (res.ok) {
                onToast("Deal updated ✓");
                onClose();
              } else {
                onToast("Update failed — check server logs");
              }
            }}
          >
            Save deal changes
          </Button>
        </footer>
      </aside>
    </div>
  );
}
