import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

// ---- tuning ----
const DEFAULT_PERIOD_SEC = 30;   // was 10
const GRACE_MS = 1200;           // wait a bit after 0s to absorb last-second votes

const nowIso = () => new Date().toISOString();
function secondsUntil(iso: string | null): number {
  if (!iso) return 0;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 1000));
}
const canonicalISO = (iso: string) => new Date(iso).toISOString();

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
  const admin = createClient(url, serviceRole);

  // -----------------------
  // Helpers for winners/base
  // -----------------------
  function baseOf(phaseKey: string | null | undefined) {
    if (!phaseKey) return null;
    const i = phaseKey.indexOf(":::");
    return i === -1 ? null : phaseKey.slice(0, i);
  }

  async function getLatestBase(): Promise<string | null> {
    const { data, error } = await admin
      .from("winners")
      .select("phase_key")
      .order("phase_key", { ascending: false })
      .limit(1);
    if (error) {
      console.error("getLatestBase error", error.message);
      return null;
    }
    return baseOf(data?.[0]?.phase_key) ?? null;
  }

  async function isBaseFinalDecided(base: string): Promise<boolean> {
    // final row exists AND has decided_at not null
    const { count, error } = await admin
      .from("winners")
      .select("id", { head: true, count: "exact" })
      .like("phase_key", `${base}%::final`)
      .not("decided_at", "is", null);
    if (error) {
      console.error("isBaseFinalDecided error", error.message);
      return false;
    }
    return (count ?? 0) > 0;
  }

  // helper: idempotent winner check
  async function winnerExists(phaseKey: string) {
    const { data } = await admin
      .from("winners")
      .select("id")
      .eq("phase_key", phaseKey)
      .limit(1);
    return (data?.length ?? 0) > 0;
  }

  // helper: atomic decision inside the DB (always using canonical ISO)
  async function decideInDB(phaseKeyRaw: string) {
    const phaseKey = canonicalISO(phaseKeyRaw);
    if (await winnerExists(phaseKey)) return; // fast-path
    const res = await fetch(`${url}/rest/v1/rpc/decide_winner`, {
      method: "POST",
      headers: {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ phase_key: phaseKey }),
    });
    // 204/200 OK; 409 is fine (conflict handled by SQL). Log other errors.
    if (!res.ok && res.status !== 409) {
      const t = await res.text().catch(() => "");
      console.error("decide_winner RPC failed", res.status, t);
    }
  }

  // OPTIONAL: where you'd seed a NEW tournament (Round of 32) once the previous base is fully finished.
  // Keep this a no-op unless you actually want this function to create a new base automatically.
  async function seedNewBaseIfYouWant() {
    // e.g. call a SQL function/rpc you wrote that creates the next tournament phase rows.
    // await fetch(`${url}/rest/v1/rpc/seed_new_base`, { ... });
    return;
  }

  // -----------------------
  // load or bootstrap timer
  // -----------------------
  const { data: s0, error: e0 } = await admin
    .from("tournament_state")
    .select("id, phase_end_at, period_sec, paused, paused_remaining_sec, updated_at")
    .eq("id", 1)
    .single();
  let s = s0 as Row | null;
  if (!s || e0) {
    const period = DEFAULT_PERIOD_SEC; // ← use constant
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
    if (ue) return new Response(JSON.stringify({ error: ue.message }), { status: 500, headers: corsHeaders });
    s = upserted as Row;
  }

  // -----------------------
  // Admin/Control endpoints
  // -----------------------
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({} as any));

    // Force: decide (with a short grace), then roll
    if (body?.force === true) {
      const finishedPhase = canonicalISO(s!.phase_end_at ?? nowIso());
      await new Promise((r) => setTimeout(r, GRACE_MS)); // grace
      await decideInDB(finishedPhase);
      const newEnd = new Date(Date.parse(finishedPhase) + s!.period_sec * 1000).toISOString();
      const { data: upd, error: ue } = await admin
        .from("tournament_state")
        .update({ phase_end_at: newEnd, paused: false, paused_remaining_sec: null, updated_at: nowIso() })
        .eq("id", 1)
        .select("*")
        .single();
      if (ue) return new Response(JSON.stringify({ error: ue.message }), { status: 500, headers: corsHeaders });
      s = upd as Row;
    }

    // Pause captures remaining and freezes
    if (body?.action === "pause" && !s!.paused) {
      const remainingNow = secondsUntil(s!.phase_end_at);
      const { data: upd, error: ue } = await admin
        .from("tournament_state")
        .update({ paused: true, paused_remaining_sec: remainingNow, updated_at: nowIso() })
        .eq("id", 1)
        .select("*")
        .single();
      if (ue) return new Response(JSON.stringify({ error: ue.message }), { status: 500, headers: corsHeaders });
      s = upd as Row;
    }

    // Resume re-computes a new canonical end
    if (body?.action === "resume" && s!.paused) {
      const remaining = s!.paused_remaining_sec ?? secondsUntil(s!.phase_end_at);
      const newEnd = new Date(Date.now() + remaining * 1000).toISOString();
      const { data: upd, error: ue } = await admin
        .from("tournament_state")
        .update({ phase_end_at: newEnd, paused: false, paused_remaining_sec: null, updated_at: nowIso() })
        .eq("id", 1)
        .select("*")
        .single();
      if (ue) return new Response(JSON.stringify({ error: ue.message }), { status: 500, headers: corsHeaders });
      s = upd as Row;
    }

    // Optional manual hook: try to seed a new base, but ONLY if last base is finished.
    // Call this with { "action": "maybe_seed" } if you want this function to own seeding.
    if (body?.action === "maybe_seed") {
      const latest = await getLatestBase();
      if (!latest) {
        // If no base exists yet, you may want to seed the very first one here.
        await seedNewBaseIfYouWant();
      } else {
        const finished = await isBaseFinalDecided(latest);
        if (!finished) {
          return new Response(JSON.stringify({ ok: true, note: `Latest base ${latest} not finished yet; skipped seeding.` }), { headers: corsHeaders });
        }
        await seedNewBaseIfYouWant();
      }
    }
  }

  // -----------------------
  // Phase tick loop
  // -----------------------
  if (!s!.paused) {
    while (secondsUntil(s!.phase_end_at) <= 0) {
      const finishedPhase = canonicalISO(s!.phase_end_at ?? nowIso());
      await new Promise((r) => setTimeout(r, GRACE_MS)); // grace
      await decideInDB(finishedPhase);

      const nextEnd = new Date(Date.parse(finishedPhase) + s!.period_sec * 1000).toISOString();
      const { data: upd, error: ue } = await admin
        .from("tournament_state")
        .update({ phase_end_at: nextEnd, updated_at: nowIso() })
        .eq("id", 1)
        .select("*")
        .single();
      if (ue) return new Response(JSON.stringify({ error: ue.message }), { status: 500, headers: corsHeaders });
      s = upd as Row;
    }
  }

  // -----------------------
  // Guard: never spawn a NEW base unless the previous base finished
  // (This only matters if something external calls your seeding logic without checking.)
  // You can ping this function with { action: "maybe_seed" } to use the guarded seeding path above.
  // -----------------------
  // Example: if you later move seeding here automatically, keep this guard:
  // const latest = await getLatestBase();
  // if (!latest || await isBaseFinalDecided(latest)) {
  //   await seedNewBaseIfYouWant();
  // }

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