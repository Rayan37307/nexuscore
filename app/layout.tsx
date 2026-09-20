import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NexusCore — Zero-Touch Revenue Intelligence",
  description:
    "Upload a transcript or email thread; NexusCore updates your pipeline, win probability, and follow-up drafts automatically.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
