import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

// --- tuning ---
const GRACE_MS = 700;               // wait this long after 0s to let last-second votes land

const nowIso = () => new Date().toISOString();
const toIso  = (x: string) => new Date(x).toISOString();
const secUntil = (iso: string | null) => {
  if (!iso) return 0;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 1000));
};

type Row = {
  id: number;
  phase_end_at: string | null;
  period_sec: number;
  paused: boolean;
  paused_remaining_sec: number | null;
  updated_at: string | null;
};
type State = {
  phase_end_at: string;
  period_sec: number;
  paused: boolean;
  remaining_sec: number;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url  = Deno.env.get("SUPABASE_URL")!;
  const svc  = Deno.env.get("SERVICE_ROLE_KEY")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin = createClient(url, svc);

  async function winnerExists(phaseKey: string) {
    const { data } = await admin.from("winners").select("id").eq("phase_key", phaseKey).limit(1);
    return (data?.length ?? 0) > 0;
  }

  async function decideInDB(rawKey: string) {
    const phaseKey = toIso(rawKey);
    if (await winnerExists(phaseKey)) return;
    const res = await fetch(`${url}/rest/v1/rpc/decide_winner`, {
      method: "POST",
      headers: { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" },
      body: JSON.stringify({ phase_key: phaseKey }),
    });
    if (!res.ok && res.status !== 409) {
      console.error("decide_winner RPC failed", res.status, await res.text().catch(()=>""));
    }
  }

  // load/boot state
  const { data: s0 } = await admin
    .from("tournament_state")
    .select("id, phase_end_at, period_sec, paused, paused_remaining_sec, updated_at")
    .eq("id", 1).single();
  let s = s0 as Row | null;

  if (!s) {
    const period = 10;
    const end = new Date(Date.now() + period * 1000).toISOString();
    const { data: upserted, error: ue } = await admin
      .from("tournament_state")
      .upsert({ id: 1, phase_end_at: end, period_sec: period, paused: false, paused_remaining_sec: null, updated_at: nowIso() })
      .select("*").single();
    if (ue) return new Response(JSON.stringify({ error: ue.message }), { status: 500, headers: corsHeaders });
    s = upserted as Row;
  }

  if (req.method === "POST") {
    const body = await req.json().catch(()=> ({} as any));

    if (body?.force === true) {
      const finished = toIso(s!.phase_end_at ?? nowIso());
      // short grace even on force to absorb nearly-simultaneous vote click
      await new Promise(r=> setTimeout(r, GRACE_MS));
      await decideInDB(finished);

      const nextEnd = new Date(Date.parse(finished) + s!.period_sec * 1000).toISOString();
      const { data: upd, error: ue } = await admin
        .from("tournament_state")
        .update({ phase_end_at: nextEnd, paused: false, paused_remaining_sec: null, updated_at: nowIso() })
        .eq("id", 1).select("*").single();
      if (ue) return new Response(JSON.stringify({ error: ue.message }), { status: 500, headers: corsHeaders });
      s = upd as Row;
    }

    if (body?.action === "pause" && !s!.paused) {
      const remaining = secUntil(s!.phase_end_at);
      const { data: upd, error: ue } = await admin
        .from("tournament_state")
        .update({ paused: true, paused_remaining_sec: remaining, updated_at: nowIso() })
        .eq("id", 1).select("*").single();
      if (ue) return new Response(JSON.stringify({ error: ue.message }), { status: 500, headers: corsHeaders });
      s = upd as Row;
    }

    if (body?.action === "resume" && s!.paused) {
      const remaining = s!.paused_remaining_sec ?? secUntil(s!.phase_end_at);
      const newEnd = new Date(Date.now() + remaining * 1000).toISOString();
      const { data: upd, error: ue } = await admin
        .from("tournament_state")
        .update({ phase_end_at: newEnd, paused: false, paused_remaining_sec: null, updated_at: nowIso() })
        .eq("id", 1).select("*").single();
      if (ue) return new Response(JSON.stringify({ error: ue.message }), { status: 500, headers: corsHeaders });
      s = upd as Row;
    }
  }

  // boundary / catch-up with grace
  if (!s!.paused) {
    while (secUntil(s!.phase_end_at) <= 0) {
      const finished = toIso(s!.phase_end_at ?? nowIso());
      await new Promise(r=> setTimeout(r, GRACE_MS)); // ← let last-second votes land
      await decideInDB(finished);

      const nextEnd = new Date(Date.parse(finished) + s!.period_sec * 1000).toISOString();
      const { data: upd, error: ue } = await admin
        .from("tournament_state")
        .update({ phase_end_at: nextEnd, updated_at: nowIso() })
        .eq("id", 1).select("*").single();
      if (ue) return new Response(JSON.stringify({ error: ue.message }), { status: 500, headers: corsHeaders });
      s = upd as Row;
    }
  }

  const remaining = s!.paused
    ? (s!.paused_remaining_sec ?? secUntil(s!.phase_end_at))
    : secUntil(s!.phase_end_at);

  const state: State = {
    phase_end_at: s!.phase_end_at ?? nowIso(),
    period_sec: s!.period_sec,
    paused: s!.paused,
    remaining_sec: Math.max(0, Math.ceil(Number(remaining ?? 0))),
  };

  return new Response(JSON.stringify({ state }), { headers: corsHeaders });
});