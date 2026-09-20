/**
 * Deal-memory embeddings (SOP-OPS-NC-001 §5.1) — pure JS core shared by the
 * Next.js app (via lib/embeddings.ts) and the node scripts.
 *
 * Provider priority:
 *   1. HF_TOKEN set  → BAAI/bge-small-en-v1.5 (384-dim) via the free Hugging
 *      Face Inference API — true semantic retrieval. On any API failure we
 *      transparently fall back to the local hashed embedder (same dimension)
 *      so ingestion never blocks.
 *   2. No HF_TOKEN   → deterministic $0 feature-hashing embedder: tokens +
 *      n-grams sign-hashed into a 384-dim unit vector. Cosine similarity
 *      behaves like weighted keyword overlap.
 *
 * NOTE: never mix providers in one database — after adding HF_TOKEN, clear
 * old memory rows (re-run `npm run db:seed` or re-ingest; the schema's dim
 * migration resets them automatically).
 */

export const EMBEDDING_DIM = 384;
export const EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5";

export const EMBEDDING_PROVIDER = process.env.HF_TOKEN
  ? `hf:${EMBEDDING_MODEL}`
  : "hash-384-v1";

export function chunkText(text, maxLen = 1200, overlapChars = 150) {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= maxLen) return [clean];

  const rawSentences = clean.split(/(?<=[.!?])\s+|\n{2,}/g);
  const sentences = [];
  for (const s of rawSentences) {
    let part = s.trim();
    if (!part) continue;
    while (part.length > maxLen) {
      sentences.push(part.slice(0, maxLen));
      part = part.slice(Math.max(0, maxLen - overlapChars));
    }
    sentences.push(part);
  }

  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + 1 + sentence.length > maxLen) {
      chunks.push(current);
      current = `${current.slice(-overlapChars).trimStart()} `;
    }
    current += sentence;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function fnv1a(input, seed = 0x811c9dc5) {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function hashEmbed(text) {
  const tokens = text.toLowerCase().match(/[a-z0-9][a-z0-9'.+&/-]*/g) ?? [];

  const tf = new Map();
  for (let i = 0; i < tokens.length; i++) {
    tf.set(tokens[i], (tf.get(tokens[i]) ?? 0) + 1);
    if (i + 1 < tokens.length) {
      const bigram = `${tokens[i]}_${tokens[i + 1]}`;
      tf.set(bigram, (tf.get(bigram) ?? 0) + 0.5);
      if (i + 2 < tokens.length) {
        const trigram = `${tokens[i]}_${tokens[i + 1]}_${tokens[i + 2]}`;
        tf.set(trigram, (tf.get(trigram) ?? 0) + 0.25);
        const skipgram = `${tokens[i]}_${tokens[i + 2]}`;
        tf.set(skipgram, (tf.get(skipgram) ?? 0) + 0.2);
      }
    }
  }

  return normalizeWeighted(tf);
}

function normalizeWeighted(tf) {
  const v = new Float64Array(EMBEDDING_DIM);
  for (const [token, count] of tf) {
    const idx = fnv1a(token) % EMBEDDING_DIM;
    const sign = fnv1a(token, 0x9dc5811c) % 2 === 0 ? 1 : -1;
    v[idx] += sign * (1 + Math.log(1 + count));
  }
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  const out = new Array(EMBEDDING_DIM);
  for (let i = 0; i < EMBEDDING_DIM; i++) out[i] = v[i] / norm;
  return out;
}

// ── Hugging Face Inference API (free tier, bge-small-en-v1.5) ──────────
const HF_URL = `https://router.huggingface.co/hf-inference/models/${EMBEDDING_MODEL}`;
let hfWarned = false;

async function hfEmbed(texts) {
  const res = await fetch(HF_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.HF_TOKEN}`,
    },
    body: JSON.stringify({ inputs: texts, options: { wait_for_model: true } }),
  });
  if (!res.ok) {
    throw new Error(`HF embeddings failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const json = await res.json();
  if (!Array.isArray(json) || json.length !== texts.length || !Array.isArray(json[0])) {
    throw new Error("HF embeddings returned an unexpected payload shape.");
  }
  return json;
}

/**
 * Embed documents. `prefix` follows bge-small conventions ("passage: " for
 * indexed content, "query: " for search questions) — the hashed fallback
 * simply ignores it.
 */
export async function embedTexts(texts, prefix = "passage: ") {
  if (texts.length === 0) return [];
  const prepared = texts.map((t) => `${prefix}${t}`);

  if (process.env.HF_TOKEN) {
    try {
      const out = [];
      for (let i = 0; i < prepared.length; i += 64) {
        out.push(...(await hfEmbed(prepared.slice(i, i + 64))));
      }
      return out;
    } catch (err) {
      if (!hfWarned) {
        hfWarned = true;
        console.warn(`[embeddings] HF provider unavailable (${err.message}); using hashed fallback.`);
      }
    }
  }
  return prepared.map(hashEmbed);
}

export async function embedOne(text) {
  const [vec] = await embedTexts([text], "query: ");
  return vec;
}
