#!/usr/bin/env npx tsx
/**
 * Dev-only: delete all BEATAGE quizzes (service role). Frees active quiz limits for testing.
 *
 * Usage:
 *   npx tsx scripts/dev/reset-beatage-quizzes.ts
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvFiles() {
  for (const name of [".env.local", ".env"]) {
    const path = resolve(process.cwd(), name);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

async function main() {
  loadEnvFiles();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: before, error: countError } = await supabase
    .from("beatage_quizzes")
    .select("id, title, join_code, status, host_user_id");

  if (countError) {
    console.error("Failed to list quizzes:", countError.message);
    process.exit(1);
  }

  const rows = before ?? [];
  if (rows.length === 0) {
    console.log("No BEATAGE quizzes to delete.");
    return;
  }

  console.log(`Deleting ${rows.length} quiz(es):`);
  for (const row of rows) {
    console.log(`  - ${row.join_code} "${row.title}" (${row.status})`);
  }

  const { error: deleteError } = await supabase
    .from("beatage_quizzes")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");

  if (deleteError) {
    console.error("Delete failed:", deleteError.message);
    process.exit(1);
  }

  console.log("Done. All BEATAGE quizzes removed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
