/**
 * Creates a dedicated demo account for demos/screenshots, e.g.:
 *   node scripts/create-demo-user.mjs
 * Idempotent: re-running prints the credentials again (password reset if missing).
 * Uses the service-role key; run only in trusted environments.
 */
try { process.loadEnvFile(".env.local"); } catch {}

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.example).");
  process.exit(1);
}

const EMAIL = process.env.DEMO_EMAIL || "demo@nexuscore.app";
const PASSWORD = process.env.DEMO_PASSWORD || "DemoBoard!2026";

const db = createClient(url, serviceKey, { auth: { persistSession: false } });

const { data: existing } = await db.auth.admin.listUsers();
const found = existing?.users?.find((u) => u.email === EMAIL);

if (found) {
  // Ensure the password matches what we print (demo account, safe to reset).
  const { error } = await db.auth.admin.updateUserById(found.id, { password: PASSWORD });
  if (error) throw error;
  console.log(`Demo user already existed — password reset.\n  email: ${EMAIL}\n  password: ${PASSWORD}`);
} else {
  const { data, error } = await db.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: "Demo Seller" },
  });
  if (error) throw error;
  console.log(`Demo user created.\n  email: ${EMAIL}\n  password: ${PASSWORD}\n  id: ${data.user.id}`);
}
