/**
 * SOP-OPS-NC-001 §3.4 Phase 1 step 3 — inline data scrubbing before storage,
 * extraction, and vectorization. Zero-tolerance PII policy (§3.5): payment
 * card numbers, SSNs, and private credentials are replaced with typed
 * markers. Deliberately does NOT redact emails, names, or company data —
 * those are first-class CRM entities.
 */

const RULES: { type: string; pattern: RegExp }[] = [
  // Payment cards: 13-19 digits grouped by spaces/dashes, validated with the
  // Luhn checksum so random IDs (PO numbers, phone numbers) don't match.
  {
    type: "PAYMENT_CARD",
    pattern: /\b(?:\d[ -]?){12,18}\d\b/g,
  },
  // US SSN (with dashes only — bare 9-digit runs are too collision-prone).
  {
    type: "SSN",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
  },
  // Private credentials: common key prefixes and bearer-style tokens.
  {
    type: "CREDENTIAL",
    pattern:
      /\b(?:sk-[A-Za-z0-9_-]{8,}|gsk_[A-Za-z0-9_-]{8,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{8,}|gh[pousr]_[A-Za-z0-9]{8,}|Bearer\s+[A-Za-z0-9._-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----)/g,
  },
  // Bank routing/account pair (US-style).
  {
    type: "BANK_ACCOUNT",
    pattern: /\b(?:routing|account)\s*(?:number|no\.?|#)?\s*[:=]?\s*\d{8,17}\b/gi,
  },
];

/** Luhn checksum for candidate card numbers. */
function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Redact PII from raw content. Returns the sanitized string plus a list of
 * redaction types applied (useful for audit logs — §3.5 PII leakage = 0.00%).
 */
export function sanitizeContent(raw: string): {
  sanitized: string;
  redactions: string[];
} {
  const redactions = new Set<string>();
  let out = raw;

  for (const rule of RULES) {
    out = out.replace(rule.pattern, (match) => {
      if (rule.type === "PAYMENT_CARD") {
        const digits = match.replace(/\D/g, "");
        // Luhn-gate: only redact if it really is a card; too-short or
        // checksum-failing digit runs are left intact.
        if (digits.length < 13 || digits.length > 19 || !luhnValid(digits)) {
          return match;
        }
      }
      redactions.add(rule.type);
      return `[REDACTED:${rule.type}]`;
    });
  }

  return { sanitized: out, redactions: [...redactions] };
}
