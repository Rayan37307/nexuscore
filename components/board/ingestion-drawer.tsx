"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/primitives";
import { Input, Label, Select, Textarea } from "@/components/ui/primitives";
import { INTERACTION_TYPES, STAGE_LABELS } from "@/lib/constants";
import type { Deal } from "@/lib/types";
import { cn } from "@/lib/utils";

interface IngestionDrawerProps {
  open: boolean;
  onClose: () => void;
  deals: Deal[];
  onIngested: (message: string) => void;
}

type Mode = "paste" | "file" | "audio" | "bot";

const AUDIO_EXTENSIONS = [".mp3", ".m4a", ".wav", ".webm", ".mp4", ".ogg", ".flac"];

interface BotRow {
  id: string;
  attendee_bot_id: string;
  meeting_url: string;
  bot_name: string | null;
  status: string;
  ingest_status: "pending" | "ingested" | "failed";
  error_message: string | null;
  created_at: string;
}

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 32);
  }
}

function ingestChip(status: string) {
  if (status === "ingested") return "bg-emerald-950/60 text-emerald-300 border-emerald-500/40 shadow-[0_0_8px_rgba(52,211,153,0.15)]";
  if (status === "failed") return "bg-rose-950/60 text-rose-300 border-rose-500/40 shadow-[0_0_8px_rgba(244,63,94,0.15)]";
  return "bg-indigo-950/60 text-indigo-300 border-indigo-500/40";
}

export function IngestionDrawer({ open, onClose, deals, onIngested }: IngestionDrawerProps) {
  const [mode, setMode] = useState<Mode>("paste");
  const [content, setContent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [type, setType] = useState<string>("meeting_transcript");
  const [source, setSource] = useState("");
  const [dealId, setDealId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [meetingUrl, setMeetingUrl] = useState("");
  const [joinAt, setJoinAt] = useState("");
  const [bots, setBots] = useState<BotRow[]>([]);
  const [syncingBots, setSyncingBots] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const openDeals = deals.filter((d) => !d.stage.startsWith("closed_"));

  function reset() {
    setContent("");
    setFile(null);
    setSource("");
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function readFileAsText(f: File): Promise<string> {
    const text = await f.text();
    if (f.name.toLowerCase().endsWith(".vtt")) {
      return text
        .split("\n")
        .filter((line) => !/^\s*(WEBVTT|NOTE|STYLE)/i.test(line))
        .filter((line) => !/^\s*\d+\s*$/.test(line))
        .filter((line) => !/^\s*\d{2}:\d{2}/.test(line))
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }
    return text;
  }

  async function loadBots(sync = false): Promise<BotRow[]> {
    const res = await fetch(`/api/attendee/bots${sync ? "?sync=1" : ""}`);
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || `Could not load meeting bots (${res.status}).`);
    }
    const rows = json.data as BotRow[];
    setBots(rows);
    return rows;
  }

  function switchMode(value: Mode) {
    setMode(value);
    setError(null);
    if (value === "bot") void loadBots(false).catch(() => setError("Could not load meeting bots."));
  }

  async function launchBot() {
    setError(null);
    if (!/^https?:\/\//i.test(meetingUrl.trim())) {
      setError("Paste the full meeting URL (Zoom, Google Meet, or Teams link).");
      return;
    }
    setBusy(true);
    setStage("Launching meeting bot…");
    try {
      const res = await fetch("/api/attendee/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meetingUrl: meetingUrl.trim(),
          joinAt: joinAt ? new Date(joinAt).toISOString() : null,
          dealId: dealId || null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `Bot launch failed (${res.status})`);
      }
      setMeetingUrl("");
      setJoinAt("");
      onIngested(
        "Meeting bot launched — it joins the call, and after the meeting its transcript flows through the pipeline automatically.",
      );
      await loadBots(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Bot launch failed.");
    } finally {
      setBusy(false);
      setStage("");
    }
  }

  async function checkBots() {
    setSyncingBots(true);
    setError(null);
    try {
      const before = bots.filter((b) => b.ingest_status === "ingested").length;
      const rows = await loadBots(true);
      const newly = rows.filter((b) => b.ingest_status === "ingested").length - before;
      if (newly > 0) {
        onIngested(
          `Meeting transcript${newly > 1 ? "s" : ""} ingested — deal card${newly > 1 ? "s" : ""} updated with the AI briefing.`,
        );
      } else {
        const failed = rows.filter((b) => b.ingest_status === "failed");
        if (failed.length > 0) setError(failed[0].error_message || "A bot transcript failed to ingest.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Sync failed.");
    } finally {
      setSyncingBots(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "bot") return;

    let payload: { content?: string; audio?: File } = {};
    if (mode === "paste") {
      if (content.trim().length < 40) {
        setError("Paste at least a meaningful excerpt (40+ characters).");
        return;
      }
      payload.content = content;
    } else if (mode === "file") {
      if (!file) {
        setError("Choose a .txt or .vtt transcript file first.");
        return;
      }
      payload.content = await readFileAsText(file);
    } else {
      if (!file) {
        setError("Choose an audio file (.mp3, .m4a, .wav, .webm…).");
        return;
      }
      payload.audio = file;
    }

    setBusy(true);
    setStage("Uploading to extraction pipeline…");
    try {
      const form = new FormData();
      form.set("type", type);
      if (source.trim()) form.set("sourceIdentifier", source.trim());
      if (dealId) form.set("dealId", dealId);
      if (payload.content) {
        form.set("content", payload.content);
      } else if (payload.audio) {
        setStage("Transcribing with Whisper large-v3…");
        form.set("audio", payload.audio);
      }

      const res = await fetch("/api/ingest", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `Ingestion failed (${res.status})`);
      }

      const d = json.data;
      const moved = d.stageChanged ? ` · stage ${d.previousStage} → ${d.stage}` : "";
      const pii = Array.isArray(d.redactions) && d.redactions.length > 0
        ? ` · PII redacted (${(d.redactions as string[]).join(", ")})`
        : "";
      const agentPart = d.queuedActions > 0 ? ` · ${d.queuedActions} agent proposal${d.queuedActions > 1 ? "s" : ""} queued` : "";
      onIngested(
        `Ingested: “${d.dealTitle}” · ${STAGE_LABELS[d.stage as keyof typeof STAGE_LABELS]}${moved} · win probability ${d.winProbability}%${pii}${agentPart}`,
      );
      reset();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Ingestion failed.");
    } finally {
      setBusy(false);
      setStage("");
    }
  }

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity" onClick={onClose} />
      <aside className="animate-drawer-in absolute inset-y-0 right-0 flex w-full max-w-lg flex-col border-l border-slate-800/90 bg-[#0b0f19] text-slate-100 shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-800/90 bg-slate-900/60 px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold tracking-tight text-white">Ingest interaction</h2>
              <span className="rounded-full border border-indigo-500/30 bg-indigo-950/60 px-2 py-0.2 text-[10px] font-semibold text-indigo-300">
                AI Engine
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              Auto-extracts company, contacts, stage, objections, and follow-up draft.
            </p>
          </div>
          <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </Button>
        </header>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-4 gap-1 rounded-xl bg-slate-900/90 border border-slate-800 p-1">
            {(
              [
                ["paste", "Paste text"],
                ["file", "File"],
                ["audio", "Audio"],
                ["bot", "Meeting bot"],
              ] as [Mode, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => switchMode(value)}
                className={cn(
                  "rounded-lg px-2 py-1.5 text-xs font-semibold transition-all cursor-pointer",
                  mode === value
                    ? "bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-md shadow-indigo-950/60"
                    : "text-slate-400 hover:text-slate-200",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === "paste" && (
            <div className="space-y-1.5">
              <Label htmlFor="content">Transcript or email thread</Label>
              <Textarea
                id="content"
                rows={11}
                placeholder={'Mara Chen: We\'re spending six hours a week per rep on CRM updates…\n\nFrom: igor@globex.com\nSubject: Re: demo follow-up…'}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="font-mono text-xs leading-relaxed"
              />
            </div>
          )}

          {mode === "file" && (
            <div className="space-y-2">
              <Label>Transcript file (.txt or .vtt)</Label>
              <div className="rounded-xl border border-dashed border-slate-700/80 bg-slate-900/40 p-5 text-center">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.vtt,text/plain"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-xs text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-indigo-500 file:cursor-pointer"
                />
                {file && (
                  <p className="mt-2 text-xs font-medium text-indigo-300">
                    {file.name} · {(file.size / 1024).toFixed(1)} KB
                  </p>
                )}
              </div>
            </div>
          )}

          {mode === "audio" && (
            <div className="space-y-2">
              <Label>Audio recording (Whisper large-v3)</Label>
              <div className="rounded-xl border border-dashed border-slate-700/80 bg-slate-900/40 p-5 text-center">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={AUDIO_EXTENSIONS.join(",")}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-xs text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-indigo-500 file:cursor-pointer"
                />
                {file && (
                  <p className="mt-2 text-xs font-medium text-indigo-300">
                    {file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB
                    {file.size > 24 * 1024 * 1024 && " — large files may hit limits"}
                  </p>
                )}
              </div>
            </div>
          )}

          {mode === "bot" && (
            <div className="space-y-3.5">
              <div className="space-y-1.5">
                <Label htmlFor="meeting-url">Meeting URL (Google Meet, Zoom, Teams)</Label>
                <Input
                  id="meeting-url"
                  placeholder="https://meet.google.com/abc-defg-hij"
                  value={meetingUrl}
                  onChange={(e) => setMeetingUrl(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="join-at">Schedule join time (optional)</Label>
                <Input
                  id="join-at"
                  type="datetime-local"
                  value={joinAt}
                  onChange={(e) => setJoinAt(e.target.value)}
                />
              </div>
              <Button type="button" onClick={launchBot} disabled={busy} className="w-full shadow-lg shadow-indigo-500/20">
                {busy ? stage || "Launching…" : "Launch meeting bot"}
              </Button>

              <div className="space-y-2.5 border-t border-slate-800/90 pt-3.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Recent bots</p>
                  <Button type="button" variant="outline" size="sm" onClick={checkBots} disabled={syncingBots}>
                    {syncingBots ? "Checking…" : "Check & ingest"}
                  </Button>
                </div>
                {bots.length === 0 && (
                  <p className="text-xs text-slate-500">No bots launched yet — paste a URL above to start.</p>
                )}
                <ul className="space-y-2">
                  {bots.map((b) => (
                    <li
                      key={b.id}
                      className="flex items-center justify-between gap-2 rounded-xl border border-slate-800/80 bg-slate-900/60 p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-slate-200">
                          {b.bot_name || "NexusCore Notetaker"} · {hostOf(b.meeting_url)}
                        </p>
                        <p
                          className="truncate text-[11px] text-slate-400 mt-0.5"
                          title={b.error_message ?? undefined}
                        >
                          {b.status} · {b.ingest_status}
                          {b.ingest_status === "failed" && b.error_message ? ` — ${b.error_message}` : ""}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-bold",
                          ingestChip(b.ingest_status),
                        )}
                      >
                        {b.ingest_status}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  After the call, click “Check &amp; ingest” — the transcript automatically flows into the pipeline and updates your deals.
                </p>
              </div>
            </div>
          )}

          {mode !== "bot" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="type">Interaction Type</Label>
                <Select id="type" value={type} onChange={(e) => setType(e.target.value)}>
                  {INTERACTION_TYPES.map((t) => (
                    <option key={t} value={t} className="bg-slate-900 text-slate-100">
                      {t.replace(/_/g, " ")}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="source">Source tag (optional)</Label>
                <Input
                  id="source"
                  placeholder="demo-0412 or email thread"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="deal">Attach to deal (optional)</Label>
            <Select id="deal" value={dealId} onChange={(e) => setDealId(e.target.value)}>
              <option value="" className="bg-slate-900 text-slate-100">Auto (create or match by company)</option>
              {openDeals.map((d) => (
                <option key={d.id} value={d.id} className="bg-slate-900 text-slate-100">
                  {d.title}
                </option>
              ))}
            </Select>
          </div>

          {error && (
            <div className="rounded-xl bg-rose-950/40 border border-rose-800/50 p-3 text-xs text-rose-300">
              {error}
            </div>
          )}

          {mode !== "bot" && (
            <div className="mt-auto flex items-center gap-2 border-t border-slate-800/90 pt-4">
              <Button type="submit" disabled={busy} className="flex-1 shadow-lg shadow-indigo-500/20">
                {busy ? stage || "Extracting…" : "Extract & update pipeline"}
              </Button>
              <Button type="button" variant="outline" onClick={reset} disabled={busy}>
                Clear
              </Button>
            </div>
          )}
          <p className="text-[11px] text-slate-500">
            Typical extraction takes ~2–4 seconds with Groq LLM. Audio uses Whisper large-v3.
          </p>
        </form>
      </aside>
    </div>
  );
}
