// supabase/functions/global-timer/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type State = { phase_end_at: string; period_sec: number; paused: boolean };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url  = Deno.env.get("SUPABASE_URL")!;
  const key  = Deno.env.get("SERVICE_ROLE_KEY")!; // server-only key
  const db   = createClient(url, key);

  // Always read current row first
  const { data, error } = await db
    .from("tournament_state")
    .select("id, phase_end_at, period_sec, paused")
    .eq("id", 1)
    .maybeSingle();

  if (error || !data) {
    return new Response(JSON.stringify({ error: error?.message ?? "state row missing" }), { status: 500, headers: corsHeaders });
  }

  let { phase_end_at, period_sec, paused } = data;

  // Handle POST actions
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({} as any));

    // Global pause toggle
    if (typeof body.pause === "boolean") {
      paused = body.pause;
      await db.from("tournament_state").update({ paused, updated_at: new Date().toISOString() }).eq("id", 1);
    }

    // Force next (even if paused)
    if (body.force === true) {
      const now = new Date();
      const next = new Date(now.getTime() + (period_sec ?? 10) * 1000);
      phase_end_at = next.toISOString();
      await db.from("tournament_state").update({ phase_end_at, updated_at: new Date().toISOString() }).eq("id", 1);
    }
  }

  // Roll forward when expired and NOT paused
  const now = new Date();
  const end = new Date(phase_end_at ?? now.toISOString());
  if (!paused && now >= end) {
    const next = new Date(now.getTime() + (period_sec ?? 10) * 1000);
    phase_end_at = next.toISOString();
    await db.from("tournament_state").update({ phase_end_at, updated_at: new Date().toISOString() }).eq("id", 1);
  }

  const state: State = {
    phase_end_at: phase_end_at ?? new Date().toISOString(),
    period_sec: period_sec ?? 10,
    paused: !!paused,
  };

  return new Response(JSON.stringify({ state }), { headers: corsHeaders });
});