// supabase/functions/global-timer/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type State = {
  phase_end_at: string | null;
  period_sec: number;
  paused: boolean;
  paused_remaining_sec: number | null;
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SERVICE_ROLE_KEY")!; // or SUPABASE_SERVICE_ROLE_KEY, if you prefer
  const db = createClient(url, key);

  async function getState(): Promise<State> {
    const { data, error } = await db
      .from("tournament_state")
      .select("phase_end_at, period_sec, paused, paused_remaining_sec")
      .eq("id", 1)
      .maybeSingle();
    if (error || !data) throw new Error(error?.message ?? "state row missing");
    return {
      phase_end_at: data.phase_end_at,
      period_sec: data.period_sec ?? 10,
      paused: !!data.paused,
      paused_remaining_sec: data.paused_remaining_sec ?? null,
    };
  }

  function nowUTC() {
    return new Date();
  }

  function secondsUntil(endISO: string | null): number {
    if (!endISO) return 0;
    const diff = Date.parse(endISO) - Date.now();
    return Math.max(0, Math.ceil(diff / 1000));
  }

  try {
    // POST: mutate (pause/resume/force)
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({} as any));
      const wantedPause: boolean | undefined = body.pause;
      const force: boolean | undefined = body.force;

      // Read current
      let s = await getState();

      // Toggle pause
      if (typeof wantedPause === "boolean") {
        if (wantedPause && !s.paused) {
          // Going from LIVE -> PAUSED: freeze remaining on the server
          const remaining = s.paused_remaining_sec ?? secondsUntil(s.phase_end_at) || s.period_sec;
          const { data, error } = await db
            .from("tournament_state")
            .update({
              paused: true,
              paused_remaining_sec: remaining,
              updated_at: nowUTC().toISOString(),
            })
            .eq("id", 1)
            .select("phase_end_at, period_sec, paused, paused_remaining_sec")
            .single();
          if (error) throw new Error(error.message);
          s = {
            phase_end_at: data.phase_end_at,
            period_sec: data.period_sec ?? 10,
            paused: !!data.paused,
            paused_remaining_sec: data.paused_remaining_sec ?? null,
          };
        } else if (!wantedPause && s.paused) {
          // Going from PAUSED -> LIVE: resume from frozen remaining
          const remaining = s.paused_remaining_sec ?? s.period_sec;
          const newEnd = new Date(Date.now() + remaining * 1000).toISOString();
          const { data, error } = await db
            .from("tournament_state")
            .update({
              paused: false,
              paused_remaining_sec: null,
              phase_end_at: newEnd,
              updated_at: nowUTC().toISOString(),
            })
            .eq("id", 1)
            .select("phase_end_at, period_sec, paused, paused_remaining_sec")
            .single();
          if (error) throw new Error(error.message);
          s = {
            phase_end_at: data.phase_end_at,
            period_sec: data.period_sec ?? 10,
            paused: !!data.paused,
            paused_remaining_sec: data.paused_remaining_sec ?? null,
          };
        }
      }

      // Optional: force jump to next period (works regardless of paused)
      if (force === true) {
        const period = s.period_sec ?? 10;
        const newEnd = new Date(Date.now() + period * 1000).toISOString();
        const { data, error } = await db
          .from("tournament_state")
          .update({
            phase_end_at: newEnd,
            updated_at: nowUTC().toISOString(),
          })
          .eq("id", 1)
          .select("phase_end_at, period_sec, paused, paused_remaining_sec")
          .single();
        if (error) throw new Error(error.message);
        s = {
          phase_end_at: data.phase_end_at,
          period_sec: data.period_sec ?? 10,
          paused: !!data.paused,
          paused_remaining_sec: data.paused_remaining_sec ?? null,
        };
      }

      return new Response(JSON.stringify({ state: s }), { headers: cors });
    }

    // GET: read + roll if expired and not paused
    let s = await getState();

    if (!s.paused) {
      if (!s.phase_end_at || Date.now() >= Date.parse(s.phase_end_at)) {
        const next = new Date(Date.now() + (s.period_sec ?? 10) * 1000).toISOString();
        const { data, error } = await db
          .from("tournament_state")
          .update({
            phase_end_at: next,
            updated_at: nowUTC().toISOString(),
          })
          .eq("id", 1)
          .select("phase_end_at, period_sec, paused, paused_remaining_sec")
          .single();
        if (error) throw new Error(error.message);
        s = {
          phase_end_at: data.phase_end_at,
          period_sec: data.period_sec ?? 10,
          paused: !!data.paused,
          paused_remaining_sec: data.paused_remaining_sec ?? null,
        };
      }
    } else {
      // While paused: ensure paused_remaining_sec is set (in case older rows existed)
      if (s.paused_remaining_sec == null) {
        const remaining = secondsUntil(s.phase_end_at) || s.period_sec;
        await db
          .from("tournament_state")
          .update({
            paused_remaining_sec: remaining,
            updated_at: nowUTC().toISOString(),
          })
          .eq("id", 1);
        s.paused_remaining_sec = remaining;
      }
    }

    return new Response(JSON.stringify({ state: s }), { headers: cors });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ error: e.message ?? String(e) }), {
      status: 500,
      headers: cors,
    });
  }
});