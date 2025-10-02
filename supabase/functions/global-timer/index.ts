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

// deterministic pick off an ISO string
function pickBlue(phaseKey: string) {
  let h = 5381;
  for (let i = 0; i < phaseKey.length; i++) h = ((h << 5) + h) + phaseKey.charCodeAt(i);
  return (h & 1) === 1;
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
  phase_end_at: string;
  period_sec: number;
  paused: boolean;
  remaining_sec: number;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceRole = Deno.env.get("SERVICE_ROLE_KEY")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const client = createClient(url, serviceRole);

  async function decideWinnerForPhase(phaseKey: string) {
    const blue = pickBlue(phaseKey);
    const payload = [{
      decided_at: new Date().toISOString(),
      phase_key: phaseKey,
      round_num: 1,
      name: blue ? "BLUE" : "RED",
      color: blue ? "blue" : "red",
      image_url: blue
        ? "https://dummyimage.com/800x600/0060ff/ffffff&text=BLUE"
        : "https://dummyimage.com/800x600/ff0000/ffffff&text=RED",
      meta: { source: "edge-global-timer" }
    }];

    const res = await fetch(`${url}/rest/v1/winners?on_conflict=phase_key`, {
      method: "POST",
      headers: {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok && res.status !== 409) {
      const t = await res.text().catch(()=>"");
      console.error("winner upsert failed", res.status, t);
    }
  }

  // fetch or bootstrap singleton
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
      const finishedPhase = s!.phase_end_at ?? nowIso();
      await decideWinnerForPhase(finishedPhase);
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

  // ===== Catch-up loop: for every elapsed phase, DECIDE & roll forward =====
  if (!s!.paused) {
    while (secondsUntil(s!.phase_end_at) <= 0) {
      const finishedPhase = s!.phase_end_at ?? nowIso();
      await decideWinnerForPhase(finishedPhase);
      const nextEnd = new Date(new Date(finishedPhase).getTime() + s!.period_sec * 1000).toISOString();
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

  const remaining = s!.paused
    ? (s!.paused_remaining_sec ?? secondsUntil(s!.phase_end_at))
    : secondsUntil(s!.phase_end_at);

  const state: State = {
    phase_end_at: s!.phase_end_at ?? nowIso(),
    period_sec: s!.period_sec,
    paused: s!.paused,
    remaining_sec: Math.max(0, Math.ceil(Number(remaining ?? 0))),
  };

  return new Response(JSON.stringify({ state }), { headers: corsHeaders });
});