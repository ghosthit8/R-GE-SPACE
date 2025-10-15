// Supabase Edge Function: global-timer (server-side R32 backfill, no ::tick writes)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ───────────────────────────────── CORS
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

// ───────────────────────────────── Env
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const DEFAULT_PERIOD_SEC = 30;     // 30s for testing; raise later
const GRACE_MS = 1200;             // absorb last-second votes
const REST = `${SUPABASE_URL}/rest/v1`;

type TimerRow = {
  id: number;
  phase_end_at: string | null;
  period_sec: number;
  paused: boolean;
  paused_remaining_sec: number | null;
  updated_at: string;
};

// ───────────────────────────────── Utils
const nowIso = () => new Date().toISOString();
const isoToMs = (iso: string | null) => (iso ? Date.parse(iso) : 0);
function secondsUntil(iso: string | null): number {
  if (!iso) return 0;
  const ms = isoToMs(iso) - Date.now();
  return Math.max(0, Math.floor(ms / 1000));
}
function baseFromISO(iso: string) {
  const d = new Date(iso);
  d.setMinutes(0, 0, 0);           // bucket by hour (matches your UI logic)
  return d.toISOString();
}
function adminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}
function anonHeaders() {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
  };
}

// ───────────────────────────────── R32 backfill (idempotent)
async function backfillR32Winners(admin: ReturnType<typeof createClient>, baseISO: string) {
  const r32Keys = Array.from({ length: 16 }, (_, i) => `${baseISO}::r32_${i + 1}`);

  const { data: have, error: selErr } = await admin
    .from("winners")
    .select("phase_key")
    .in("phase_key", r32Keys);

  if (selErr) {
    console.warn("backfillR32Winners select err", selErr);
    return;
  }

  const haveSet = new Set((have ?? []).map((r: any) => r.phase_key));
  for (const k of r32Keys) {
    if (!haveSet.has(k)) {
      try {
        const resp = await fetch(`${REST}/rpc/decide_winner`, {
          method: "POST",
          headers: anonHeaders(),
          body: JSON.stringify({ p_phase_key: k }), // ✅ correct arg name
        });
        if (!resp.ok) {
          const txt = await resp.text();
          console.warn("decide_winner RPC failed", k, resp.status, txt);
        }
      } catch (e) {
        console.warn("decide_winner RPC error", k, e);
      }
    }
  }
}

// ───────────────────────────────── HTTP handler
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = adminClient();

  // Ensure timer_state row exists
  const { data: s0 } = await admin.from("timer_state").select("*").eq("id", 1).single();
  let s = s0 as TimerRow | null;
  const period = s?.period_sec ?? DEFAULT_PERIOD_SEC;

  if (!s) {
    const end = new Date(Date.now() + period * 1000).toISOString();
    const { data: upserted, error: ue } = await admin
      .from("timer_state")
      .upsert({
        id: 1,
        phase_end_at: end,
        period_sec: period,
        paused: false,
        paused_remaining_sec: null,
        updated_at: nowIso(),
      })
      .select("*")
      .single();
    if (ue) return new Response(JSON.stringify({ error: ue.message }), { status: 500, headers: corsHeaders });
    s = upserted as TimerRow;
  }

  // ── POST controls
  if (req.method === "POST") {
    let body: any = {};
    try { body = await req.json(); } catch {}

    // Optional idempotent nudge from submit.html
    if (body?.action === "backfill_r32" && body?.base) {
      await backfillR32Winners(admin, body.base);
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    }

    // Manual force-advance for testing (no ::tick writes)
    if (body?.force === true) {
      const finishedBase = baseFromISO(s!.phase_end_at ?? nowIso());
      await new Promise((r) => setTimeout(r, GRACE_MS));
      await backfillR32Winners(admin, finishedBase);     // ← ONLY write path

      // Roll the timer forward
      const nextEnd = new Date(Date.now() + period * 1000).toISOString();
      await admin.from("timer_state").update({ phase_end_at: nextEnd, updated_at: nowIso() }).eq("id", 1);
      const { data: s1 } = await admin.from("timer_state").select("*").eq("id", 1).single();
      return new Response(JSON.stringify({ state: s1 }), { headers: corsHeaders });
    }
  }

  // ── GET: headless catch-up loop (no ::tick writes; just backfill + roll)
  let safety = 0;
  while (safety++ < 64) {
    const remain = secondsUntil(s!.phase_end_at);
    if (remain > 0 || s!.paused) break;

    const finishedBase = baseFromISO(s!.phase_end_at ?? nowIso());
    await new Promise((r) => setTimeout(r, GRACE_MS));
    await backfillR32Winners(admin, finishedBase);       // ← idempotent R32 materialization

    // roll forward
    const nextEnd = new Date(Date.now() + period * 1000).toISOString();
    const { data: s2 } = await admin
      .from("timer_state")
      .update({ phase_end_at: nextEnd, updated_at: nowIso() })
      .eq("id", 1)
      .select("*")
      .single();
    s = s2 as TimerRow;
  }

  const remaining = s!.paused
    ? (s!.paused_remaining_sec ?? secondsUntil(s!.phase_end_at))
    : secondsUntil(s!.phase_end_at);

  const state = {
    phase_end_at: s!.phase_end_at ?? nowIso(),
    period_sec: s!.period_sec,
    paused: s!.paused,
    remaining_sec: Math.max(0, Math.ceil(Number(remaining ?? 0))),
  };
  return new Response(JSON.stringify({ state }), { headers: corsHeaders });
});