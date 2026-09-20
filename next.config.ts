import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // groq-sdk (built on the openai core) ships dual CJS/ESM shims that break
  // when webpack inlines them into route handlers — the classic symptom is
  // "TypeError: Cannot read properties of undefined (reading 'call')" at
  // runtime while typecheck and build pass. Keep it external to the bundle.
  serverExternalPackages: ["groq-sdk"],
};

export default nextConfig;
