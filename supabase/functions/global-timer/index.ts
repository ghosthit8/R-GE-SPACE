// supabase/functions/global-timer/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Row = { id: number; phase_end_at: string | null; period_sec: number; paused: boolean };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Always work with the singleton row id=1
  async function getOrInit(): Promise<Row> {
    const { data, error } = await supabase
      .from("tournament_state")
      .select("id, phase_end_at, period_sec, paused")
      .eq("id", 1)
      .maybeSingle(); // returns null if none

    if (error) throw error;

    if (data) return data as Row;

    // Seed a fresh row if missing
    const now = new Date();
    const initEnd = new Date(now.getTime() + 10 * 1000).toISOString();
    const { data: seeded, error: insErr } = await supabase
      .from("tournament_state")
      .insert({ id: 1, phase_end_at: initEnd, period_sec: 10, paused: false })
      .select("id, phase_end_at, period_sec, paused")
      .single();

    if (insErr) throw insErr;
    return seeded as Row;
  }

  try {
    // Handle POST actions (pause/resume/force)
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const action = body?.action as "pause" | "resume" | "force" | undefined;

      if (action === "pause") {
        const { data, error } = await supabase
          .from("tournament_state")
          .update({ paused: true })
          .eq("id", 1)
          .select("id, phase_end_at, period_sec, paused")
          .single();
        if (error) throw error;
        return new Response(JSON.stringify({ state: data }), { headers: corsHeaders });
      }

      if (action === "resume") {
        const now = new Date();
        const { data, error } = await supabase
          .from("tournament_state")
          .update({ paused: false, updated_at: now.toISOString() })
          .eq("id", 1)
          .select("id, phase_end_at, period_sec, paused")
          .single();
        if (error) throw error;
        return new Response(JSON.stringify({ state: data }), { headers: corsHeaders });
      }

      if (action === "force") {
        const state = await getOrInit();
        const now = new Date();
        const newEnd = new Date(now.getTime() + (state.period_sec ?? 10) * 1000);
        const { data, error } = await supabase
          .from("tournament_state")
          .update({ phase_end_at: newEnd.toISOString(), updated_at: now.toISOString() })
          .eq("id", 1)
          .select("id, phase_end_at, period_sec, paused")
          .single();
        if (error) throw error;
        return new Response(JSON.stringify({ state: data }), { headers: corsHeaders });
      }
      // Unknown/empty action falls through to “GET-like” behavior
    }

    // GET (or POST without action): return current state; roll forward if needed and not paused
    const state = await getOrInit();
    const now = new Date();
    let end = state.phase_end_at ? new Date(state.phase_end_at) : null;
    const periodSec = state.period_sec ?? 10;

    if (!state.paused) {
      if (!end || now >= end) {
        const newEnd = new Date(now.getTime() + periodSec * 1000);
        const { data, error } = await supabase
          .from("tournament_state")
          .update({
            phase_end_at: newEnd.toISOString(),
            updated_at: now.toISOString(),
          })
          .eq("id", 1)
          .select("id, phase_end_at, period_sec, paused")
          .single();
        if (error) throw error;
        return new Response(JSON.stringify({ state: data }), { headers: corsHeaders });
      }
    }

    // Return unchanged state (paused or not yet expired)
    return new Response(
      JSON.stringify({
        state: {
          phase_end_at: state.phase_end_at,
          period_sec: periodSec,
          paused: state.paused,
        },
      }),
      { headers: corsHeaders }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message ?? String(err) }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});