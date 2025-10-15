// Supabase Edge Function: global-timer (server-side bracket materialization)
// Rounds: R32 -> R16 -> QF -> SF -> Final (idempotent; no ::tick writes)
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
  d.setMinutes(0, 0, 0);                   // bucket by hour (matches UI logic)
  return d.toISOString();
}
function adminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}
function serviceHeaders() {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
}
function anonHeaders() {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
  };
}

// ───────────────────────────────── DB helpers
async function getExisting(admin: ReturnType<typeof createClient>, keys: string[]) {
  const { data, error } = await admin.from("winners").select("phase_key").in("phase_key", keys);
  if (error) { console.warn("getExisting error", error); return new Set<string>(); }
  return new Set((data ?? []).map((r: any) => r.phase_key as string));
}

async function callDecideWinner(phaseKey: string) {
  try {
    const resp = await fetch(`${REST}/rpc/decide_winner`, {
      method: "POST",
      headers: serviceHeaders(),                // Service role for writes
      body: JSON.stringify({ p_phase_key: phaseKey }),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      console.warn("decide_winner failed", phaseKey, resp.status, txt);
    }
  } catch (e) {
    console.warn("decide_winner error", phaseKey, e);
  }
}

// ───────────────────────────────── Backfills
// 1) Ensure 16 r32_* winners exist for a base
async function backfillR32(admin: ReturnType<typeof createClient>, baseISO: string) {
  const keys = Array.from({ length: 16 }, (_, i) => `${baseISO}::r32_${i + 1}`);
  const have = await getExisting(admin, keys);
  for (const k of keys) if (!have.has(k)) await callDecideWinner(k);
}

// 2) Generic "pair up" round: make outPrefix_# from inPrefix_# pairs
async function backfillPairs(
  admin: ReturnType<typeof createClient>,
  baseISO: string,
  inPrefix: "r32_" | "r16_" | "qf_" | "sf_",
  outPrefix: "r16_" | "qf_" | "sf_",
  outCount: number
) {
  const inKeys = Array.from({ length: outCount * 2 }, (_, i) => `${baseISO}::${inPrefix}${i + 1}`);
  const outKeys = Array.from({ length: outCount }, (_, i) => `${baseISO}::${outPrefix}${i + 1}`);

  const haveIn = await getExisting(admin, inKeys);
  const haveOut = await getExisting(admin, outKeys);

  for (let i = 0; i < outCount; i++) {
    const outK = outKeys[i];
    if (haveOut.has(outK)) continue;
    const a = `${baseISO}::${inPrefix}${i * 2 + 1}`;
    const b = `${baseISO}::${inPrefix}${i * 2 + 2}`;
    if (haveIn.has(a) && haveIn.has(b)) await callDecideWinner(outK);
  }
}

// 3) Final (sf_1 + sf_2 -> final)
async function backfillFinal(admin: ReturnType<typeof createClient>, baseISO: string) {
  const in1 = `${baseISO}::sf_1`;
  const in2 = `${baseISO}::sf_2`;
  const out = `${baseISO}::final`;

  const have = await getExisting(admin, [in1, in2, out]);
  if (!have.has(out) && have.has(in1) && have.has(in2)) {
    await callDecideWinner(out);
  }
}

// Convenience wrappers by round
async function backfillR16(admin: ReturnType<typeof createClient>, baseISO: string) {
  // r32_1+2 -> r16_1, ..., r32_15+16 -> r16_8
  await backfillPairs(admin, baseISO, "r32_", "r16_", 8);
}
async function backfillQF(admin: ReturnType<typeof createClient>, baseISO: string) {
  // r16_1+2 -> qf_1, ..., r16_7+8 -> qf_4
  await backfillPairs(admin, baseISO, "r16_", "qf_", 4);
}
async function backfillSF(admin: ReturnType<typeof createClient>, baseISO: string) {
  // qf_1+2 -> sf_1, qf_3+4 -> sf_2
  await backfillPairs(admin, baseISO, "qf_", "sf_", 2);
}

// Single entry point: run all rounds in order (safe & idempotent)
async function backfillAllRounds(admin: ReturnType<typeof createClient>, baseISO: string) {
  await backfillR32(admin, baseISO);
  await backfillR16(admin, baseISO);
  await backfillQF(admin, baseISO);
  await backfillSF(admin, baseISO);
  await backfillFinal(admin, baseISO);
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
      await backfillR32(admin, body.base);
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    }

    // Manual force-advance for testing (no client writes)
    if (body?.force === true) {
      const finishedBase = baseFromISO(s!.phase_end_at ?? nowIso());
      await new Promise((r) => setTimeout(r, GRACE_MS));
      await backfillAllRounds(admin, finishedBase);

      // Roll the timer forward
      const nextEnd = new Date(Date.now() + period * 1000).toISOString();
      await admin.from("timer_state").update({ phase_end_at: nextEnd, updated_at: nowIso() }).eq("id", 1);
      const { data: s1 } = await admin.from("timer_state").select("*").eq("id", 1).single();
      return new Response(JSON.stringify({ state: s1 }), { headers: corsHeaders });
    }
  }

  // ── GET: headless catch-up loop (process all overdue phases)
  let safety = 0;
  while (safety++ < 64) {
    const remain = secondsUntil(s!.phase_end_at);
    if (remain > 0 || s!.paused) break;

    const finishedBase = baseFromISO(s!.phase_end_at ?? nowIso());
    await new Promise((r) => setTimeout(r, GRACE_MS));
    await backfillAllRounds(admin, finishedBase);

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