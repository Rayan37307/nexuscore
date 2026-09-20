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
  if (status === "ingested") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "failed") return "bg-rose-50 text-rose-700 border-rose-200";
  return "bg-slate-100 text-slate-600 border-slate-200";
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
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="animate-drawer-in absolute inset-y-0 right-0 flex w-full max-w-lg flex-col border-l border-slate-200 bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Ingest interaction</h2>
            <p className="text-xs text-slate-500">
              AI extracts company, contacts, stage, and a follow-up draft automatically.
            </p>
          </div>
          <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </Button>
        </header>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-4 gap-1 rounded-lg bg-slate-100 p-1">
            {(
              [
                ["paste", "Paste text"],
                ["file", "Transcript file"],
                ["audio", "Audio file"],
                ["bot", "Meeting bot"],
              ] as [Mode, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => switchMode(value)}
                className={cn(
                  "rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                  mode === value ? "bg-white shadow-sm text-slate-900" : "text-slate-500",
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
                rows={10}
                placeholder={'Mara Chen: We\'re spending six hours a week per rep on CRM updates…\n\nFrom: igor@globex.com\nSubject: Re: demo follow-up…'}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
          )}

          {mode === "file" && (
            <div className="space-y-1.5">
              <Label>Transcript file (.txt or .vtt)</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.vtt,text/plain"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white"
              />
              {file && <p className="text-xs text-slate-500">{file.name} · {(file.size / 1024).toFixed(1)} KB</p>}
            </div>
          )}

          {mode === "audio" && (
            <div className="space-y-1.5">
              <Label>Audio recording (Groq Whisper large-v3)</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept={AUDIO_EXTENSIONS.join(",")}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white"
              />
              {file && (
                <p className="text-xs text-slate-500">
                  {file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB
                  {file.size > 24 * 1024 * 1024 && " — large files may hit free-tier limits"}
                </p>
              )}
            </div>
          )}

          {mode === "bot" && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="meeting-url">Meeting URL (Zoom, Google Meet, Teams)</Label>
                <Input
                  id="meeting-url"
                  placeholder="https://meet.google.com/abc-defg-hij"
                  value={meetingUrl}
                  onChange={(e) => setMeetingUrl(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="join-at">Join at (optional — schedule for later)</Label>
                <Input
                  id="join-at"
                  type="datetime-local"
                  value={joinAt}
                  onChange={(e) => setJoinAt(e.target.value)}
                />
              </div>
              <Button type="button" onClick={launchBot} disabled={busy} className="w-full">
                {busy ? stage || "Launching…" : "Launch meeting bot"}
              </Button>

              <div className="space-y-2 border-t border-slate-100 pt-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-slate-600">Recent bots</p>
                  <Button type="button" variant="outline" size="sm" onClick={checkBots} disabled={syncingBots}>
                    {syncingBots ? "Checking…" : "Check & ingest"}
                  </Button>
                </div>
                {bots.length === 0 && (
                  <p className="text-xs text-slate-400">No bots yet — launch one above or paste a transcript.</p>
                )}
                <ul className="space-y-1.5">
                  {bots.map((b) => (
                    <li
                      key={b.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-2.5 py-1.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-slate-700">
                          {b.bot_name || "Bot"} · {hostOf(b.meeting_url)}
                        </p>
                        <p
                          className="truncate text-[11px] text-slate-400"
                          title={b.error_message ?? undefined}
                        >
                          {b.status} · {b.ingest_status}
                          {b.ingest_status === "failed" && b.error_message ? ` — ${b.error_message}` : ""}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                          ingestChip(b.ingest_status),
                        )}
                      >
                        {b.ingest_status}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-slate-400">
                  After the call, press “Check &amp; ingest” — the transcript runs the same pipeline
                  (extract → stage → follow-up draft → deal memory). Attendee dashboard Settings must
                  have your Zoom OAuth app + transcription provider configured.
                </p>
              </div>
            </div>
          )}

          {mode !== "bot" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="type">Type</Label>
                <Select id="type" value={type} onChange={(e) => setType(e.target.value)}>
                  {INTERACTION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.replace(/_/g, " ")}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="source">Source (optional)</Label>
                <Input
                  id="source"
                  placeholder="zoom-recording-0412 or email thread"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="deal">Attach to deal (optional — auto-matches by company)</Label>
            <Select id="deal" value={dealId} onChange={(e) => setDealId(e.target.value)}>
              <option value="">Auto (create or match by company name)</option>
              {openDeals.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </Select>
          </div>

          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}

          {mode !== "bot" && (
            <div className="mt-auto flex items-center gap-2 border-t border-slate-100 pt-4">
              <Button type="submit" disabled={busy} className="flex-1">
                {busy ? stage || "Extracting…" : "Extract & update pipeline"}
              </Button>
              <Button type="button" variant="outline" onClick={reset} disabled={busy}>
                Clear
              </Button>
            </div>
          )}
          <p className="text-[11px] text-slate-400">
            Typical extraction: 2–6 seconds on Groq free tier (30 req/min). Audio adds Whisper
            transcription time (~10–15s for a 45-minute call).
          </p>
        </form>
      </aside>
    </div>
  );
}
