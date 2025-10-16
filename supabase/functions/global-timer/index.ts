import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/* ---------------- CORS ---------------- */
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

/* ---------------- Tuning ---------------- */
const DEFAULT_PERIOD_SEC = 30;
const GRACE_MS = 1200;

const nowIso = () => new Date().toISOString();
const canonicalISO = (iso: string) => new Date(iso).toISOString();
function secondsUntil(iso: string | null): number {
  if (!iso) return 0;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 1000));
}

/* ---------------- Types ---------------- */
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

/* ---------------- Serve ---------------- */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceRole = Deno.env.get("SERVICE_ROLE_KEY")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin = createClient(url, serviceRole);

  // Parse JSON body (if any) and query params (always)
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const urlObj = new URL(req.url);
  const intent = {
    action: (body?.action || urlObj.searchParams.get("action") || "").toLowerCase(), // "pause"|"resume"|""
    force: body?.force === true || urlObj.searchParams.get("force") === "true",
  };

  function replyOK(state: State) {
    return new Response(JSON.stringify({ state }), { headers: corsHeaders });
  }
  function replyErr(status: number, message: string) {
    return new Response(JSON.stringify({ error: message }), { status, headers: corsHeaders });
  }

  async function winnerExists(phaseKey: string) {
    const { data, error } = await admin.from("winners").select("id").eq("phase_key", phaseKey).limit(1);
    if (error) console.error("winnerExists error:", error.message);
    return (data?.length ?? 0) > 0;
  }
  async function decideInDB(phaseKeyRaw: string) {
    const phaseKey = canonicalISO(phaseKeyRaw);
    if (await winnerExists(phaseKey)) return;
    const res = await fetch(`${url}/rest/v1/rpc/decide_winner`, {
      method: "POST",
      headers: { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" },
      body: JSON.stringify({ phase_key: phaseKey }),
    });
    if (!res.ok && res.status !== 409) {
      const t = await res.text().catch(() => "");
      console.error("decide_winner RPC failed", res.status, t);
    }
  }

  async function loadOrBootstrap(): Promise<Row> {
    const { data, error } = await admin
      .from("tournament_state")
      .select("id, phase_end_at, period_sec, paused, paused_remaining_sec, updated_at")
      .eq("id", 1)
      .single();

    if (!error && data) return data as Row;

    const period = DEFAULT_PERIOD_SEC;
    const end = new Date(Date.now() + period * 1000).toISOString();
    const { data: upserted, error: ue } = await admin
      .from("tournament_state")
      .upsert({
        id: 1,
        phase_end_at: end,
        period_sec: period,
        paused: false,
        paused_remaining_sec: null,
        updated_at: nowIso(),
      })
      .select("id, phase_end_at, period_sec, paused, paused_remaining_sec, updated_at")
      .single();

    if (ue) throw new Error(ue.message);
    return upserted as Row;
  }

  try {
    let s = await loadOrBootstrap();

    // Pause/Resume/Force regardless of method (supports GET ?action=… and POST)
    if (intent.force) {
      const finishedPhase = canonicalISO(s.phase_end_at ?? nowIso());
      await new Promise((r) => setTimeout(r, GRACE_MS));
      await decideInDB(finishedPhase);
      const newEnd = new Date(Date.parse(finishedPhase) + s.period_sec * 1000).toISOString();
      const { data: upd, error: ue } = await admin
        .from("tournament_state")
        .update({ phase_end_at: newEnd, paused: false, paused_remaining_sec: null, updated_at: nowIso() })
        .eq("id", 1)
        .select("*")
        .single();
      if (ue) throw new Error(ue.message);
      s = upd as Row;
    }

    if (intent.action === "pause" && !s.paused) {
      const remainingNow = secondsUntil(s.phase_end_at);
      const { data: upd, error: ue } = await admin
        .from("tournament_state")
        .update({ paused: true, paused_remaining_sec: remainingNow, updated_at: nowIso() })
        .eq("id", 1)
        .select("*")
        .single();
      if (ue) throw new Error(ue.message);
      s = upd as Row;
    }

    if (intent.action === "resume" && s.paused) {
      const remaining = s.paused_remaining_sec ?? secondsUntil(s.phase_end_at);
      const newEnd = new Date(Date.now() + remaining * 1000).toISOString();
      const { data: upd, error: ue } = await admin
        .from("tournament_state")
        .update({ phase_end_at: newEnd, paused: false, paused_remaining_sec: null, updated_at: nowIso() })
        .eq("id", 1)
        .select("*")
        .single();
      if (ue) throw new Error(ue.message);
      s = upd as Row;
    }

    // Catch-up loop (when not paused)
    if (!s.paused) {
      while (secondsUntil(s.phase_end_at) <= 0) {
        const finishedPhase = canonicalISO(s.phase_end_at ?? nowIso());
        await new Promise((r) => setTimeout(r, GRACE_MS));
        await decideInDB(finishedPhase);
        const nextEnd = new Date(Date.parse(finishedPhase) + s.period_sec * 1000).toISOString();
        const { data: upd, error: ue } = await admin
          .from("tournament_state")
          .update({ phase_end_at: nextEnd, updated_at: nowIso() })
          .eq("id", 1)
          .select("*")
          .single();
        if (ue) throw new Error(ue.message);
        s = upd as Row;
      }
    }

    const remaining = s.paused
      ? (s.paused_remaining_sec ?? secondsUntil(s.phase_end_at))
      : secondsUntil(s.phase_end_at);

    const state: State = {
      phase_end_at: s.phase_end_at ?? nowIso(),
      period_sec: s.period_sec,
      paused: s.paused,
      remaining_sec: Math.max(0, Math.ceil(Number(remaining ?? 0))),
    };

    return replyOK(state);
  } catch (e: any) {
    console.error("global-timer error:", e?.message || e);
    return replyErr(500, e?.message || "Unexpected error");
  }
});