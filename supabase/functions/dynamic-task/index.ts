// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---- ENV ----
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ---- TABLES ----
const TIMER = "global_timer";          // <— single row { id='global' }
const META = "tournament_meta";        // { id=1, current_round int }
const MATCHES = "matches";
const WINNERS = "winners";

// ---- CONST ----
const FINAL_ROUND = 5;                 // 1:R32 2:R16 3:QF 4:SF 5:FINAL
const ROUND_SECONDS = 45;              // adjust (e.g. 86400 for 24h)

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "POST,OPTIONS",
    },
    ...init,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);
  const now = new Date();

  try {
    // Ensure timer row exists
    let { data: t } = await supa
      .from(TIMER)
      .select("*")
      .eq("id", "global")
      .maybeSingle();

    if (!t) {
      const end = new Date(Date.now() + ROUND_SECONDS * 1000).toISOString();
      await supa.from(TIMER).insert({ id: "global", end_at: end, paused: false });
      t = { id: "global", end_at: end, paused: false } as any;
    }

    // Read current round
    let { data: meta } = await supa
      .from(META)
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    if (!meta) {
      await supa.from(META).insert({ id: 1, current_round: 1 });
      ({ data: meta } = await supa.from(META).select("*").eq("id", 1).maybeSingle());
    }
    let current_round: number = Math.max(1, Math.min(FINAL_ROUND, meta?.current_round ?? 1));

    // If paused or timer still running, just echo status
    const endMs = t?.end_at ? new Date(t.end_at).getTime() : 0;
    const expired = !t?.end_at || endMs <= now.getTime();
    if (t?.paused) {
      return json({ ok: true, state: "paused", round: current_round, end_at: t.end_at });
    }

    // Helper: reseed timer
    const reseed = async () => {
      const nextEnd = new Date(Date.now() + ROUND_SECONDS * 1000).toISOString();
      await supa.from(TIMER).update({ end_at: nextEnd, paused: false, updated_at: new Date().toISOString() }).eq("id", "global");
      return nextEnd;
    };

    if (!expired) {
      // nothing to do yet
      return json({ ok: true, state: "waiting", round: current_round, end_at: t?.end_at });
    }

    // ---- TIMER EXPIRED: ADVANCE BRACKET ----

    // Get matches in current round, active first (have both contestants)
    const { data: matches, error: mErr } = await supa
      .from(MATCHES)
      .select("*")
      .eq("round", current_round)
      .order("decided", { ascending: true })
      .order("idx", { ascending: true });

    if (mErr) throw mErr;

    const all = matches ?? [];
    const active = all.filter((m: any) => !!(m.a_img && m.b_img));
    const open = active.filter((m: any) => !m.decided);

    let state = "noop";
    // Decide exactly ONE open match per heartbeat (keeps things smooth)
    if (open.length > 0) {
      const m = open[0]; // earliest undecided
      const a = m.votes_a ?? 0;
      const b = m.votes_b ?? 0;
      const pickA = a > b ? true : a < b ? false : Math.random() < 0.5;
      const winner = pickA
        ? { name: m.a_name, img: m.a_img }
        : { name: m.b_name, img: m.b_img };

      // Mark decided
      await supa.from(MATCHES).update({ decided: true }).eq("id", m.id);

      // Advance winner to next slot, or record final
      if (m.next_id) {
        const { data: nxt } = await supa.from(MATCHES).select("*").eq("id", m.next_id).maybeSingle();
        if (nxt) {
          if (!nxt.a_img) {
            await supa.from(MATCHES).update({ a_name: winner.name, a_img: winner.img }).eq("id", m.next_id);
          } else if (!nxt.b_img) {
            await supa.from(MATCHES).update({ b_name: winner.name, b_img: winner.img }).eq("id", m.next_id);
          }
        }
      } else if (current_round === FINAL_ROUND) {
        // Record champion
        try {
          await supa.from(WINNERS).insert({
            match_id: m.id,
            image_url: winner.img,
            won_at: new Date().toISOString(),
          });
        } catch (_e) { /* ignore unique violations */ }
      }

      state = "decided-one";
    } else {
      // No open active matches; either round is empty or finished → maybe advance round
      const anyActive = active.length > 0;
      const allDecided = anyActive && active.every((m: any) => !!m.decided);
      if (allDecided && current_round < FINAL_ROUND) {
        current_round += 1;
        await supa.from(META).update({ current_round }).eq("id", 1);
        state = "advance-round";
      } else if (!anyActive) {
        state = "no-active";
      } else if (current_round === FINAL_ROUND) {
        state = "final-complete-or-waiting";
      }
    }

    const nextEnd = await reseed();
    return json({ ok: true, state, round: current_round, end_at: nextEnd });
  } catch (e) {
    console.error("dynamic-task error:", e);
    return json({ ok: false, error: String(e) }, { status: 500 });
  }
});