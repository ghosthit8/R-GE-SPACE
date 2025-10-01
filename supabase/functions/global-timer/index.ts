import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

const nowIso = () => new Date().toISOString();
function secondsUntil(iso: string | null): number {
  if (!iso) return 0;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 1000));
}

type Row = {
  id: number;
  phase_end_at: string | null;
  period_sec: number;
  paused: boolean;
  paused_remaining_sec: number | null;
  updated_at: string | null;
};
type State = { phase_end_at: string; period_sec: number; paused: boolean; remaining_sec: number; };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceRole = Deno.env.get("SERVICE_ROLE_KEY")!;
  const client = createClient(url, serviceRole);

  async function logZero(rolledFromISO: string | null) {
    try {
      const rollover_at = rolledFromISO ?? nowIso();
      const { error } = await client
        .from("zero_rollovers")
        .insert({ rollover_at, phase_end_at: rolledFromISO, source: "edge-fn" });
      if (error) console.error("zero_rollovers insert failed:", error.message);
    } catch (e) {
      console.error("zero_rollovers insert exception:", (e as Error).message);
    }
  }

  // singleton row
  const { data: s0, error: e0 } = await client
    .from("tournament_state")
    .select("id, phase_end_at, period_sec, paused, paused_remaining_sec, updated_at")
    .eq("id", 1)
    .single();

  let s = s0 as Row | null;
  if (!s || e0) {
    const period = 10;
    const end = new Date(Date.now() + period * 1000).toISOString();
    const { data: upserted, error: ue } = await client
      .from("tournament_state")
      .upsert({ id: 1, phase_end_at: end, period_sec: period, paused: false, paused_remaining_sec: null, updated_at: nowIso() })
      .select("id, phase_end_at, period_sec, paused, paused_remaining_sec, updated_at")
      .single();
    if (ue) return new Response(JSON.stringify({ error: ue.message }), { status: 500, headers: corsHeaders });
    s = upserted as Row;
  }

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({} as any));

    if (body?.force === true) {
      await logZero(s!.phase_end_at);
      const newEnd = new Date(Date.now() + s!.period_sec * 1000).toISOString();
      const { data: upd, error: ue } = await client
        .from("tournament_state")
        .update({ phase_end_at: newEnd, paused: false, paused_remaining_sec: null, updated_at: nowIso() })
        .eq("id", 1)
        .select("id, phase_end_at, period_sec, paused, paused_remaining_sec, updated_at")
        .single();
      if (ue) return new Response(JSON.stringify({ error: ue.message }), { status: 500, headers: corsHeaders });
      s = upd as Row;
    }

    if (body?.action === "pause" && !s!.paused) {
      const remainingNow = secondsUntil(s!.phase_end_at);
      const { data: upd, error: ue } = await client
        .from("tournament_state")
        .update({ paused: true, paused_remaining_sec: remainingNow, updated_at: nowIso() })
        .eq("id", 1)
        .select("id, phase_end_at, period_sec, paused, paused_remaining_sec, updated_at")
        .single();
      if (ue) return new Response(JSON.stringify({ error: ue.message }), { status: 500, headers: corsHeaders });
      s = upd as Row;
    }

    if (body?.action === "resume" && s!.paused) {
      const remaining = (s!.paused_remaining_sec ?? secondsUntil(s!.phase_end_at));
      const newEnd = new Date(Date.now() + remaining * 1000).toISOString();
      const { data: upd, error: ue } = await client
        .from("tournament_state")
        .update({ phase_end_at: newEnd, paused: false, paused_remaining_sec: null, updated_at: nowIso() })
        .eq("id", 1)
        .select("id, phase_end_at, period_sec, paused, paused_remaining_sec, updated_at")
        .single();
      if (ue) return new Response(JSON.stringify({ error: ue.message }), { status: 500, headers: corsHeaders });
      s = upd as Row;
    }
  }

  // ===== Catch-up loop: backfill all missed rollovers =====
  if (!s!.paused) {
    // While now >= phase_end_at, log the ending phase and push to the next
    while (secondsUntil(s!.phase_end_at) <= 0) {
      await logZero(s!.phase_end_at);
      const nextEnd = new Date(new Date(s!.phase_end_at ?? nowIso()).getTime() + s!.period_sec * 1000).toISOString();
      const { data: upd, error: ue } = await client
        .from("tournament_state")
        .update({ phase_end_at: nextEnd, updated_at: nowIso() })
        .eq("id", 1)
        .select("id, phase_end_at, period_sec, paused, paused_remaining_sec, updated_at")
        .single();
      if (ue) return new Response(JSON.stringify({ error: ue.message }), { status: 500, headers: corsHeaders });
      s = upd as Row;
    }
  }
  // =======================================================

  const state: State = {
    phase_end_at: s!.phase_end_at ?? nowIso(),
    period_sec: s!.period_sec,
    paused: s!.paused,
    remaining_sec: (s!.paused ? (s!.paused_remaining_sec ?? secondsUntil(s!.phase_end_at))
                              : secondsUntil(s!.phase_end_at)),
  };

  return new Response(JSON.stringify({ state }), { headers: corsHeaders });
});