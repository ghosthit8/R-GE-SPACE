// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const TIMER_TABLE = "shared_timer";
const META_TABLE  = "tournament_meta";
const MATCHES     = "matches";
const WINNERS     = "winners";

// Round map
const ROUND_IDS = ["", "r32", "r16", "qf", "sf", "final"] as const;
type RoundNum = 1|2|3|4|5;

const ROUND_SECONDS = 10; // change to 86400 (24h) for prod

function json(res: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(res), {
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
  if (req.method === "OPTIONS") return json({ ok: true }); // CORS preflight

  try {
    const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Ensure meta row exists
    let { data: meta } = await supa.from(META_TABLE).select("*").eq("id", 1).maybeSingle();
    if (!meta) {
      await supa.from(META_TABLE).insert({ id: 1, current_round: 1 });
      ({ data: meta } = await supa.from(META_TABLE).select("*").eq("id", 1).maybeSingle());
    }
    let current_round: RoundNum = Math.max(1, Math.min(5, meta?.current_round ?? 1)) as RoundNum;

    // 1) Seed/extend timer for the current round
    const timerId = ROUND_IDS[current_round];
    let { data: trow } = await supa.from(TIMER_TABLE).select("*").eq("id", timerId).maybeSingle();
    const now = new Date();
    if (!trow || !trow.end_at || new Date(trow.end_at).getTime() <= now.getTime()) {
      const end = new Date(Date.now() + ROUND_SECONDS * 1000).toISOString();
      if (!trow) {
        await supa.from(TIMER_TABLE).insert({ id: timerId, end_at: end });
      } else {
        await supa.from(TIMER_TABLE).update({ end_at: end }).eq("id", timerId);
      }
      trow = { id: timerId, end_at: end } as any;
    }

    // 2) If the previous timer had expired (i.e., we just reseeded), decide any undecided matches
    //    and move winners forward.
    //    We do this opportunistically on every POST, harmless if already decided.
    const { data: matches } = await supa
      .from(MATCHES)
      .select("*")
      .eq("round", current_round)
      .order("idx", { ascending: true });

    if (matches && matches.length) {
      for (const m of matches) {
        // Decide only matches that have both sides and are not decided
        const hasBoth = !!(m.a_img && m.b_img);
        if (!m.decided && hasBoth) {
          const a = m.votes_a ?? 0;
          const b = m.votes_b ?? 0;
          let winner = null as null | { name: string; img: string };

          if (a > b) winner = { name: m.a_name, img: m.a_img };
          else if (b > a) winner = { name: m.b_name, img: m.b_img };
          else {
            // tie-breaker
            winner = (Math.random() < 0.5)
              ? { name: m.a_name, img: m.a_img }
              : { name: m.b_name, img: m.b_img };
          }

          // Mark decided
          await supa.from(MATCHES).update({ decided: true }).eq("id", m.id);

          // Advance into next match (if exists)
          if (m.next_id) {
            const { data: next } = await supa.from(MATCHES).select("*").eq("id", m.next_id).maybeSingle();
            if (next) {
              if (!next.a_img) {
                await supa.from(MATCHES).update({
                  a_name: winner.name, a_img: winner.img
                }).eq("id", m.next_id);
              } else if (!next.b_img) {
                await supa.from(MATCHES).update({
                  b_name: winner.name, b_img: winner.img
                }).eq("id", m.next_id);
              }
            }
          } else if (current_round === 5) {
            // FINAL: record winner
            try {
              await supa.from(WINNERS).insert({
                match_id: m.id,
                image_url: winner.img,
                won_at: new Date().toISOString(),
              });
            } catch {}
          }
        }
      }

      // If all matches in the current round are decided, bump round and reseed its timer
      const { data: after } = await supa
        .from(MATCHES)
        .select("id, decided")
        .eq("round", current_round);

      const allDecided = !!after && after.every((x: any) => x.decided);
      if (allDecided && current_round < 5) {
        current_round = (current_round + 1) as RoundNum;
        await supa.from(META_TABLE).update({ current_round }).eq("id", 1);

        const nextTimerId = ROUND_IDS[current_round];
        const nextEnd = new Date(Date.now() + ROUND_SECONDS * 1000).toISOString();
        const { data: existingNext } = await supa.from(TIMER_TABLE).select("*").eq("id", nextTimerId).maybeSingle();
        if (!existingNext) {
          await supa.from(TIMER_TABLE).insert({ id: nextTimerId, end_at: nextEnd });
        } else {
          await supa.from(TIMER_TABLE).update({ end_at: nextEnd }).eq("id", nextTimerId);
        }
      }
    }

    return json({
      ok: true,
      round: current_round,
      timer_id: timerId,
      end_at: trow?.end_at,
    });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: String(e) }, { status: 500 });
  }
});