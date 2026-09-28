import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NexusCore — Zero-Touch Revenue Intelligence",
  description:
    "Upload a transcript or email thread; NexusCore updates your pipeline, win probability, and follow-up drafts automatically.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#090d16] text-slate-100 font-sans selection:bg-indigo-500/30 selection:text-indigo-200">
        {children}
      </body>
    </html>
  );
}
