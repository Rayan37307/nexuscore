# NexusCore MVP — Zero-Cost Revenue Intelligence

**SPEC-ENG-NC-MVP-002 implementation, evolved to SOP-OPS-NC-001 v2.** Upload a
meeting transcript or email thread; NexusCore sanitizes PII, extracts
participants + stakeholders, upserts company/contact/deal entities,
recalibrates stage + win probability, writes a ready-to-send follow-up draft,
embeds every conversation into pgvector deal memory for Q&A, and runs the
three-agent workforce (SDR · Deal Strategist · Health Sentinel) whose proposals
land in a human-in-the-loop Action Queue — nothing sends without operator
Accept/Edit/Reject.

Total infra cost: **$0.00/month** (Supabase Free, Groq Free, Vercel Hobby, n8n
Community Edition).

## Stack

| Layer | Tech |
| --- | --- |
| Frontend | Next.js 15 (App Router) · React 19 · Tailwind CSS v4 · shadcn-style primitives |
| Database/Auth | Supabase Free — Postgres + pgvector (HNSW) + Auth (password / magic link / Google) |
| AI | Groq Free — `openai/gpt-oss-120b` (JSON-mode extraction, memory Q&A), `whisper-large-v3` (audio) |
| Embeddings | Built-in deterministic 384-dim embedder ($0); optional upgrade to `BAAI/bge-small-en-v1.5` via Hugging Face (`HF_TOKEN`, free tier) |
| Automation | n8n Community Edition → `/api/webhooks/ingest` |
| Hosting | Vercel Hobby |

## Repo layout

```
app/
  page.tsx                 # board (server: auth + data load)
  login/                   # password + magic link + Google
  auth/callback/           # OAuth/magic-link code exchange
  api/extract/             # spec §3.3 route (raw extraction)
  api/ingest/              # text/file/audio ingestion → pipeline
  api/webhooks/ingest/     # n8n webhook (secret-header auth)
  api/deals/stage|follow-up|ask
  api/agents/queue/        # Action Queue: list + Accept/Edit/Reject
  api/agents/settings/     # kill switch (agents_enabled)
components/board/          # Kanban, cards, ingestion + Follow-Up Studio + Action Queue drawers
lib/
  groq.ts                  # extraction prompt + zod schema + memory Q&A
  ingest.ts                # Module A→B pipeline (entities, interaction, embeddings, agents)
  agents.ts                # SDR · Deal Strategist · Health Sentinel playbooks
  sanitize.ts              # SOP §3.4 Phase 1 step 3 — PII scrubbing
  embeddings-core.mjs      # $0 hashed-embedding provider (384-dim, unit norm); HF bge-small optional
  supabase/                # browser / server / service clients
middleware.ts              # session refresh + route protection
supabase/schema.sql        # full DDL + RLS + match_deal_chunks RPC
n8n/                       # importable webhook workflow
scripts/                   # db seeder + Groq extraction test suite
```

## 1. Supabase (free tier)

1. Create a project at [supabase.com](https://supabase.com).
2. SQL Editor → paste **`supabase/schema.sql`** → Run. (Includes RLS policies,
   signup trigger, and the `match_deal_chunks` vector-search RPC.)
3. **Auth → Providers**: enable Email (confirm-on optional for dev) and Google
   (callback `https://<project-ref>.supabase.co/auth/v1/callback`).
   For local magic links, add `http://localhost:3000/auth/callback` to the
   redirect-allowlist.
4. Copy **Project URL** + **anon key** (Settings → API). The service-role key is
   only needed server-side for the webhook route and the demo seeder.

## 2. Groq (free tier)

1. Create an API key at [console.groq.com](https://console.groq.com) (`gsk_...`).
2. Free limits on `openai/gpt-oss-120b` (Groq moved `llama-3.3-70b-versatile` to Enterprise-only in Aug 2026) — plenty for a
   5-user beta.

## 3. Run locally

```bash
cp .env.example .env.local     # fill in the keys from steps 1-2
npm install
npm run db:seed                # optional: two realistic demo deals (needs service key)
npm run dev                    # http://localhost:3000
```

Sign up with email/password (or Google), then ingest your first interaction:
**+ Ingest → Paste text** and drop in a real call transcript. The deal appears
on the board with stage, probability, blockers, and a follow-up draft.

## 4. Extraction test suite (Day-3 deliverable)

```bash
npm run test:extract
```

Runs the production prompt against four scenario fixtures (discovery with
budget, negotiation with legal redlines, email objection with no budget,
closed-won) and validates stage band, probability rubric, budget, contacts,
blockers, and email draft — prints a pass/fail report per assertion.

## 5. n8n webhook pipeline (Days 9–11)

```bash
docker run -d --name n8n -p 5678:5678 -v ~/.n8n:/home/node/.n8n n8nio/n8n:latest
```

1. Import `n8n/nexuscore-webhook-pipeline.json`.
2. Set env vars on the n8n container: `NEXUSCORE_WEBHOOK_SECRET`,
   `NEXUSCORE_APP_URL` (e.g. ngrok/localhost of the Next app), `GROQ_API_KEY`,
   and optionally `NEXUSCORE_EXTRACTION_PROMPT`.
3. Activate the workflow; POST JSON to
   `http://localhost:5678/webhook/nexuscore-ingest`:

```bash
curl -X POST http://localhost:5678/webhook/nexuscore-ingest \
  -H 'content-type: application/json' \
  -H "x-nexuscore-secret: $NEXUSCORE_WEBHOOK_SECRET" \
  -d '{"content":"Mara Chen: budget of $60,000 for 25 seats…","type":"email","userEmail":"you@company.com"}'
```

Webhook auth: `x-nexuscore-secret` header must equal `NEXUSCORE_WEBHOOK_SECRET`
(timing-safe compare). Target user resolution: `userEmail` in the body, else
`NEXUSCORE_DEFAULT_USER_EMAIL` env var. The route runs the same pipeline as the
UI, so Kanban cards update within seconds and realtime pushes the refresh.

Alternatively, skip n8n and POST directly to `/api/webhooks/ingest` from any
email forwarder or transcription service.

## 5b. Auto-capture with Attendee meeting bots

NexusCore can send a bot to your Zoom / Google Meet / Teams calls; when the meeting
ends, the diarized transcript flows through the same pipeline (sanitize → extract →
stage/probability update → follow-up draft → deal memory → agent queue) with zero
pasting.

1. Get an API key from [attendee.dev](https://attendee.dev) (hosted, free signup) or
   self-host the [open-source API](https://github.com/attendee-labs/attendee).
2. Put it in `.env.local`:

   ```
   ATTENDEE_API_KEY=your_key_here
   ATTENDEE_BASE_URL=https://app.attendee.dev/api/v1
   ```

3. In the Attendee dashboard **Settings**, configure your Zoom OAuth app
   (client id/secret) and a transcription provider (e.g. Deepgram free tier).
4. Restart `npm run dev`, then in the Ingest drawer use the **Meeting bot** tab:
   paste a meeting URL (optionally schedule a join time), launch, and press
   **Check & ingest** after the call. Each bot's transcript is ingested exactly
   like a pasted one.

Notes: polling is the primary sync path (`GET /api/attendee/bots?sync=1`), so this
works on localhost without a public URL. For hosted deployments you can point an
Attendee webhook at `/api/attendee/webhook` with the `x-nexuscore-secret` header
(`NEXUSCORE_WEBHOOK_SECRET`) to trigger ingestion the moment a call ends. Bot
mappings live in the `meeting_bots` table — run the updated `supabase/schema.sql`
once (it's re-run safe).

## 6. Deploy to Vercel (Hobby, $0)

1. Push to GitHub → **Import Project** on Vercel (Hobby plan).
2. Environment variables: `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `GROQ_API_KEY`,
   `NEXUSCORE_WEBHOOK_SECRET` (generate with `openssl rand -hex 32`).
   Add `SUPABASE_SERVICE_ROLE_KEY` + `NEXUSCORE_DEFAULT_USER_EMAIL` only if you
   enable the n8n webhook route in production.
3. In Supabase Auth settings, add `https://<your-app>.vercel.app/auth/callback`
   to the redirect allowlist.
4. Add your production domain to Supabase Auth URL configuration.

## 7. Beta QA checklist (Days 12–14)

- [ ] New user signup creates a `profiles` row (trigger) and an empty board.
- [ ] Text-paste ingestion creates company + deal + interaction + embeddings.
- [ ] Ingesting an existing company's transcript **updates** the same deal
      (company-name match, open-deal only) instead of duplicating.
- [ ] `.vtt` upload strips WEBVTT headers/timecodes; audio upload transcribes
      via Whisper before extraction.
- [ ] Drag a card → stage persists after refresh; realtime pushes to other tabs.
- [ ] Follow-Up Studio: edit draft → Save draft → reload → draft persists.
- [ ] "Ask the deal memory" returns cited answers from earlier interactions.
- [ ] Edge cases: long transcripts (60k-char cap), foreign names (title-cased),
      non-standard pricing ("$1.2M", "120k AUD"), empty/short input rejected.
- [ ] RLS isolation: user B sees zero rows of user A's deals/contacts/memory.
- [ ] Budget metrics: time-to-log under 60s per call; stage/probability
      alignment and draft-send rate tracked per Section 6 of the spec.

## SOP-OPS-NC-001 v2 coverage

| SOP requirement | Implementation |
| --- | --- |
| §3.4 Phase 1 · Data scrubbing before vectorization | `lib/sanitize.ts` runs on every ingest before storage/extraction/embedding. Luhn-validated card numbers, SSNs, and private keys → typed markers (`[REDACTED:CARD]` etc.). Emails/names/companies deliberately kept — first-class CRM entities. |
| §3.4 Phase 1 · Speaker transcription | Groq `whisper-large-v3` on `.mp3/.m4a/.wav/.webm/.ogg/.flac` upload. |
| §4.2 · Autonomous multi-agent workforce | `lib/agents.ts` — SDR, Deal Strategist, Health Sentinel. Deterministic playbooks computed from each extraction (zero extra LLM calls, so ingestion latency stays the same); every proposal lands in `agent_action_queue` with `status='Pending'`. |
| §3.4 Phase 3 · Human-in-the-loop approval | Action Queue drawer: **Accept** (marks Approved + executes the safe action, e.g. applies follow-up draft to the deal), **Edit**, **Reject**. Nothing sends or mutates without operator action. |
| §3.6 · Emergency kill switch | Header toggle → `/api/agents/settings` sets `agents_enabled=false`; agents skip proposing while off. |
| §4.1 · Health scoring signals | Deals carry `health_score`, `usage_trend_pct`, `sponsor_absence_days`, `open_high_sev_tickets_7d`; the Sentinel triggers on usage drop ≥ 25% WoW, sponsor absence > 30 days, or > 2 high-sev tickets in 7 days. |
| §4.2 · Concession governance | `discount_mentioned_pct` extracted; Deal Strategist flags any mention > 15% for dual approval. |
| §4.1 · Stall detection | `stalled_warning` auto-set at 14+ days since last interaction; re-engagement play queued. |
| §3.7 · Vector isolation | All tables RLS-scoped to `auth.uid()`; memory chunks owned through the parent deal. |

## Notes & trade-offs

- **Embeddings at $0**: Groq has no embeddings endpoint, so the default is a
  deterministic **384-dim** hashed bag-of-words embedder (tokens + bigrams,
  sign-hashed, unit norm) — dimension-aligned with `BAAI/bge-small-en-v1.5` so
  the schema never changes. Set `HF_TOKEN` to upgrade to real semantic vectors
  via the Hugging Face free tier (re-embed historical rows before switching;
  never mix providers in one table).
- **Whisper diarization**: `whisper-large-v3` returns segment-level turns, not
  named speakers; extraction handles attribution from conversational context.
- **Deal matching**: ingestion attaches to the user's most recent open deal for
  a matching company name (exact/normalized), else creates a new one. Attach
  manually via the drawer's "Attach to deal" for ambiguous cases.
- **Free-tier watch items**: Vercel Hobby fluid compute timeout (~300s) covers
  Whisper + extraction for long audio; Groq 30 RPM is the realistic ceiling for
  concurrent beta users.
