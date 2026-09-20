import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatMoney(amount: number | null | undefined, currency = "USD") {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "never";
  const seconds = Math.max(1, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Split a stored follow-up draft ("Subject: ...\n\n<body>") into subject + body. */
export function parseDraft(draft: string | null | undefined): { subject: string; body: string } {
  if (!draft) return { subject: "", body: "" };
  const match = draft.match(/^\s*subject:\s*(.*)\s*\n/i);
  if (!match) return { subject: "", body: draft };
  return { subject: match[1], body: draft.slice(match.index! + match[0].length).replace(/^\s+/, "") };
}

export function mailtoHref(to: string | undefined, subject: string, body: string) {
  const params = new URLSearchParams({ subject, body });
  return `mailto:${to ?? ""}?${params.toString()}`;
}

export function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "") || "unknown";
}
