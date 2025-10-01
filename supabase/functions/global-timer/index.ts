// supabase/functions/global-timer/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type State = { phase_end_at: string | null; period_sec: number; paused: boolean };

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json"
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
  const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Handle POST admin operations (pause/unpause/force)
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({} as any));

    // Toggle pause
    if (typeof body.pause === "boolean") {
      const { error } = await client
        .from("tournament_state")
        .update({ paused: body.pause, updated_at: new Date().toISOString() })
        .eq("id", 1);
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: cors });
      }
    }

    // Optional: force advance (ignored if paused unless overridePause=true)
    if (body.force === true) {
      const { data: cur, error: readErr } = await client
        .from("tournament_state")
        .select("period_sec, paused")
        .eq("id", 1)
        .single();

      if (readErr) {
        return new Response(JSON.stringify({ error: readErr.message }), { status: 500, headers: cors });
      }

      const periodSec = cur?.period_sec ?? 10;
      const isPaused = !!cur?.paused;

      if (!isPaused || body.overridePause === true) {
        const newEnd = new Date(Date.now() + periodSec * 1000);
        const { error: upErr } = await client
          .from("tournament_state")
          .update({ phase_end_at: newEnd.toISOString(), updated_at: new Date().toISOString() })
          .eq("id", 1);
        if (upErr) {
          return new Response(JSON.stringify({ error: upErr.message }), { status: 500, headers: cors });
        }
      }
    }
    // fall through to return current state after updates
  }

  // GET (and POST fall-through): return state and do rollover if needed
  const { data, error } = await client
    .from("tournament_state")
    .select("phase_end_at, period_sec, paused")
    .eq("id", 1)
    .single();

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: cors });
  }

  const now = new Date();
  const periodSec = data.period_sec ?? 10;
  const isPaused = !!data.paused;
  let end = data.phase_end_at ? new Date(data.phase_end_at) : null;

  // If not paused: ensure we always have a future end time
  if (!isPaused) {
    if (!end || now >= end) {
      const newEnd = new Date(now.getTime() + periodSec * 1000);
      const { error: upErr } = await client
        .from("tournament_state")
        .update({ phase_end_at: newEnd.toISOString(), updated_at: new Date().toISOString() })
        .eq("id", 1);
      if (upErr) {
        return new Response(JSON.stringify({ error: upErr.message }), { status: 500, headers: cors });
      }
      end = newEnd;
    }
  }

  const state: State = {
    phase_end_at: end ? end.toISOString() : null,
    period_sec: periodSec,
    paused: isPaused
  };

  return new Response(JSON.stringify({ state }), { headers: cors });
});