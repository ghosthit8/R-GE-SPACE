// Minimal global timer with true global pause/resume.
//
// Table expected (single row with id=1):
//   id int primary key default 1
//   phase_end_at timestamptz
//   period_sec int not null default 10
//   paused boolean not null default false
//   paused_remaining_sec int null
//   updated_at timestamptz
//
// The function returns:
//   { state: { phase_end_at, period_sec, paused, remaining_sec } }
//
// POST body supports:
//   { action: "pause" }      -> freeze now
//   { action: "resume" }     -> resume from frozen remaining
//   { force: true }          -> roll forward by one period (also clears pause)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// --- CORS ---
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

// --- Helpers ---
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

type State = {
  phase_end_at: string;     // authoritative next end
  period_sec: number;
  paused: boolean;
  remaining_sec: number;    // what clients should show *right now*
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Edge env
  const url = Deno.env.get("SUPABASE_URL")!;
  // NOTE: you called this SERVICE_ROLE_KEY in your file — keep that env var set
  const serviceRole = Deno.env.get("SERVICE_ROLE_KEY")!;
  const client = createClient(url, serviceRole);

  // --- NEW: server-side zero logger (uses service role, bypasses RLS) ---
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

  // Ensure singleton row exists
  const { data: s0, error: e0 } = await client
    .from("tournament_state")
    .select(
      "id, phase_end_at, period_sec, paused, paused_remaining_sec, updated_at"
    )
    .eq("id", 1)
    .single();

  let s = s0 as Row | null;

  if (!s || e0) {
    const period = 10;
    const end = new Date(Date.now() + period * 1000).toISOString();
    const { data: upserted, error: ue } = await client
      .from("tournament_state")
      .upsert({
        id: 1,
        phase_end_at: end,
        period_sec: period,
        paused: false,
        paused_remaining_sec: null,
        updated_at: nowIso(),
      })
      .select(
        "id, phase_end_at, period_sec, paused, paused_remaining_sec, updated_at"
      )
      .single();
    if (ue) {
      return new Response(JSON.stringify({ error: ue.message }), {
        status: 500,
        headers: corsHeaders,
      });
    }
    s = upserted as Row;
  }

  // Handle POST actions
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({} as any));

    // Admin "force" -> always jump one period from *now*, clear pause
    if (body?.force === true) {
      // LOG: write a row for the phase that just ended
      await logZero(s!.phase_end_at);

      const newEnd = new Date(Date.now() + s!.period_sec * 1000).toISOString();
      const { data: upd, error: ue } = await client
        .from("tournament_state")
        .update({
          phase_end_at: newEnd,
          paused: false,
          paused_remaining_sec: null,
          updated_at: nowIso(),
        })
        .eq("id", 1)
        .select(
          "id, phase_end_at, period_sec, paused, paused_remaining_sec, updated_at"
        )
        .single();
      if (ue) {
        return new Response(JSON.stringify({ error: ue.message }), {
          status: 500,
          headers: corsHeaders,
        });
      }
      s = upd as Row;
    }

    // Pause immediately -> freeze remaining seconds *now*
    if (body?.action === "pause") {
      if (!s!.paused) {
        const remainingNow = secondsUntil(s!.phase_end_at);
        const { data: upd, error: ue } = await client
          .from("tournament_state")
          .update({
            paused: true,
            paused_remaining_sec: remainingNow,
            updated_at: nowIso(),
          })
          .eq("id", 1)
          .select(
            "id, phase_end_at, period_sec, paused, paused_remaining_sec, updated_at"
          )
          .single();
        if (ue) {
          return new Response(JSON.stringify({ error: ue.message }), {
            status: 500,
            headers: corsHeaders,
          });
        }
        s = upd as Row;
      }
    }

    // Resume -> schedule end = now + frozen remaining, clear pause
    if (body?.action === "resume") {
      if (s!.paused) {
        const remaining =
          (s!.paused_remaining_sec ?? secondsUntil(s!.phase_end_at));
        const newEnd = new Date(Date.now() + remaining * 1000).toISOString();
        const { data: upd, error: ue } = await client
          .from("tournament_state")
          .update({
            phase_end_at: newEnd,
            paused: false,
            paused_remaining_sec: null,
            updated_at: nowIso(),
          })
          .eq("id", 1)
          .select(
            "id, phase_end_at, period_sec, paused, paused_remaining_sec, updated_at"
          )
          .single();
        if (ue) {
          return new Response(JSON.stringify({ error: ue.message }), {
            status: 500,
            headers: corsHeaders,
          });
        }
        s = upd as Row;
      }
    }
  }

  // Auto-roll if not paused and time has elapsed
  if (!s!.paused) {
    const ended = secondsUntil(s!.phase_end_at) <= 0;
    if (ended) {
      // LOG: write a row for the phase that just ended
      await logZero(s!.phase_end_at);

      const newEnd = new Date(Date.now() + s!.period_sec * 1000).toISOString();
      const { data: upd, error: ue } = await client
        .from("tournament_state")
        .update({
          phase_end_at: newEnd,
          updated_at: nowIso(),
        })
        .eq("id", 1)
        .select(
          "id, phase_end_at, period_sec, paused, paused_remaining_sec, updated_at"
        )
        .single();
      if (ue) {
        return new Response(JSON.stringify({ error: ue.message }), {
          status: 500,
          headers: corsHeaders,
        });
      }
      s = upd as Row;
    }
  }

  // Compose response state
  const remaining = s!.paused
    ? (s!.paused_remaining_sec ?? secondsUntil(s!.phase_end_at))
    : secondsUntil(s!.phase_end_at);

  // NOTE: Wrap the ?? expression in parens to satisfy the Deno TS parser.
  const state: State = {
    phase_end_at: s!.phase_end_at ?? new Date().toISOString(),
    period_sec: s!.period_sec,
    paused: s!.paused,
    remaining_sec: (s!.paused
      ? (s!.paused_remaining_sec ?? secondsUntil(s!.phase_end_at))
      : secondsUntil(s!.phase_end_at)),
  };

  return new Response(JSON.stringify({ state }), { headers: corsHeaders });
});