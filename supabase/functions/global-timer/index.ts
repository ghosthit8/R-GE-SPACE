// supabase/functions/global-timer/index.ts
// Minimal global timer authority: returns current phase_end_at and extends it when expired.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type State = { phase_end_at: string | null; period_sec: number };

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json"
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!; // service role ONLY on server
  const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Fetch current state (single row id=1)
  const { data, error } = await client
    .from("tournament_state")
    .select("phase_end_at, period_sec")
    .eq("id", 1)
    .single();

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: cors });
  }

  const now = new Date();
  const periodSec = data.period_sec ?? 10; // default to 10 sec if not set
  let end = data.phase_end_at ? new Date(data.phase_end_at) : null;

  // If no end set, or time is up, roll forward by one period from *now*
  if (!end || now >= end) {
    const newEnd = new Date(now.getTime() + periodSec * 1000);
    const { error: upErr } = await client
      .from("tournament_state")
      .update({
        phase_end_at: newEnd.toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("id", 1);

    if (upErr) {
      return new Response(JSON.stringify({ error: upErr.message }), { status: 500, headers: cors });
    }
    end = newEnd;
  }

  // Optional: POST {force:true} to bump immediately (for testing)
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (body?.force === true) {
      const newEnd = new Date(Date.now() + periodSec * 1000);
      await client
        .from("tournament_state")
        .update({
          phase_end_at: newEnd.toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("id", 1);
      end = newEnd;
    }
  }

  const state: State = { phase_end_at: end!.toISOString(), period_sec: periodSec };
  return new Response(JSON.stringify({ state }), { headers: cors });
});