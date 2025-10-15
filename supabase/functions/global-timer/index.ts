import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ===== CORS =====
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

// ===== Config (env) =====
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Round length for testing; you can override via DB "timer_state" row (period_sec)
const DEFAULT_PERIOD_SEC = 30;
const GRACE_MS = 1200; // absorb last-second votes
const REST = `${SUPABASE_URL}/rest/v1`;

// ===== Types =====
type Row = {
  id: number;
  phase_end_at: string | null;
  period_sec: number;
  paused: boolean;
  paused_remaining_sec: number | null;
  updated_at: string;
};

// ===== Utils =====
const nowIso = () => new Date().toISOString();
const isoToMs = (iso: string | null) => (iso ? Date.parse(iso) : 0);
function secondsUntil(iso: string | null): number {
  if (!iso) return 0;
  const ms = isoToMs(iso) - Date.now();
  return Math.max(0, Math.floor(ms / 1000));
}
function canonicalISO(iso: string): string {
  const d = new Date(iso);
  d.setMinutes(0, 0, 0);
  const base = d.toISOString();
  return `${base}::r32`;
}

// ===== DB Clients =====
function adminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}
function anonHeaders() {
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json" };
}

// ===== R32 backfill (idempotent) =====
async function backfillR32Winners(admin: ReturnType<typeof createClient>, baseISO: string) {
  const r32Keys = Array.from({ length: 16 }, (_, i) => `${baseISO}::r32_${i + 1}`);
  const { data: have, error: selErr } = await admin
    .from('winners')
    .select('phase_key')
    .in('phase_key', r32Keys);
  if (selErr) {
    console.warn('backfillR32Winners select err', selErr);
    return;
  }
  const haveSet = new Set((have ?? []).map(r => (r as any).phase_key));
  for (const k of r32Keys) {
    if (!haveSet.has(k)) {
      try {
        await fetch(`${REST}/rpc/decide_winner`, { method: 'POST', headers: anonHeaders(), body: JSON.stringify({ phase_key: k }) });
      } catch (e) {
        console.warn('backfill decide_winner failed', k, e);
      }
    }
  }
}

// ===== Decide one phase now =====
async function decideInDB(phaseKey: string) {
  try {
    await fetch(`${REST}/rpc/decide_winner`, { method: 'POST', headers: anonHeaders(), body: JSON.stringify({ phase_key: phaseKey }) });
  } catch (_) {}
}

// ===== Request Handler =====
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const admin = adminClient();

  // Ensure single row "timer_state" exists
  const { data: s0 } = await admin.from('timer_state').select('*').eq('id', 1).single();
  let s = s0 as Row | null;
  const period = (s?.period_sec ?? DEFAULT_PERIOD_SEC);
  if (!s) {
    const end = new Date(Date.now() + period * 1000).toISOString();
    const { data: upserted } = await admin
      .from('timer_state')
      .upsert({ id: 1, phase_end_at: end, period_sec: period, paused: false, paused_remaining_sec: null, updated_at: nowIso() })
      .select('*')
      .single();
    s = upserted as Row;
  }

  if (req.method === "POST") {
    let body: any = {};
    try { body = await req.json(); } catch {}

    if (body?.action === "backfill_r32" && body?.base) {
      await backfillR32Winners(admin, body.base);
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    }

    if (body?.force === true) {
      const finishedBase = canonicalISO(s!.phase_end_at ?? nowIso()).split('::')[0];
      await new Promise((r) => setTimeout(r, GRACE_MS));
      await decideInDB(`${finishedBase}::tick`);
      await backfillR32Winners(admin, finishedBase);

      const nextEnd = new Date(Date.now() + period * 1000).toISOString();
      await admin.from('timer_state').update({ phase_end_at: nextEnd, updated_at: nowIso() }).eq('id', 1);
      const { data: s1 } = await admin.from('timer_state').select('*').eq('id', 1).single();
      return new Response(JSON.stringify({ state: s1 }), { headers: corsHeaders });
    }
  }

  // ===== GET catch-up loop =====
  let safety = 0;
  while (safety++ < 64) {
    const remain = secondsUntil(s!.phase_end_at);
    if (remain > 0 || s!.paused) break;

    const finishedBase = canonicalISO(s!.phase_end_at ?? nowIso()).split('::')[0];
    await new Promise((r) => setTimeout(r, GRACE_MS));
    await decideInDB(`${finishedBase}::tick`);
    await backfillR32Winners(admin, finishedBase);

    const nextEnd = new Date(Date.now() + period * 1000).toISOString();
    const { data: s2 } = await admin.from('timer_state').update({ phase_end_at: nextEnd, updated_at: nowIso() }).eq('id', 1).select('*').single();
    s = s2 as Row;
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