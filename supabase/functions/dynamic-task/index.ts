// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const TIMER_TABLE = "global_timer";
const META_TABLE = "tournament_meta";
const MATCHES = "matches";
const WINNERS = "winners";

const ROUND_IDS = ["", "r32", "r16", "qf", "sf", "final"] as const;
type RoundNum = 1 | 2 | 3 | 4 | 5;

const ROUND_SECONDS = 20; // testing (set 86400 for 24h in prod)

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

  try {
    const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Ensure meta exists
    let { data: meta } = await supa.from(META_TABLE).select("*").eq("id", 1).maybeSingle();
    if (!meta) {
      await supa.from(META_TABLE).insert({ id: 1, current_round: 1 });
      ({ data: meta } = await supa.from(META_TABLE).select("*").eq("id", 1).maybeSingle());
    }
    let current_round: RoundNum = Math.max(1, Math.min(5, meta?.current_round ?? 1)) as RoundNum;

    // Get timer row
    let { data: trow } = await supa.from(TIMER_TABLE).select("*").eq("id", "global").maybeSingle();
    const now = new Date();
    const expired = !trow?.end_at || new Date(trow.end_at).getTime() <= now.getTime();

    if (expired) {
      // reseed timer
      const endISO = new Date(Date.now() + ROUND_SECONDS * 1000).toISOString();
      if (!trow) {
        await supa.from(TIMER_TABLE).insert({ id: "global", end_at: endISO, paused: false });
      } else {
        await supa.from(TIMER_TABLE).update({ end_at: endISO, paused: false }).eq("id", "global");
      }

      // decide matches
      const { data: matches } = await supa
        .from(MATCHES)
        .select("*")
        .eq("round", current_round)
        .order("idx");

      const active = (matches ?? []).filter((m: any) => !!(m.a_img && m.b_img));
      for (const m of active) {
        if (m.decided) continue;
        const a = m.votes_a ?? 0, b = m.votes_b ?? 0;
        const pickA = a > b ? true : a < b ? false : Math.random() < 0.5;
        const winner = pickA ? { name: m.a_name, img: m.a_img } : { name: m.b_name, img: m.b_img };

        await supa.from(MATCHES).update({ decided: true }).eq("id", m.id);

        if (m.next_id) {
          const { data: nxt } = await supa.from(MATCHES).select("*").eq("id", m.next_id).maybeSingle();
          if (nxt) {
            if (!nxt.a_img) {
              await supa.from(MATCHES).update({ a_name: winner.name, a_img: winner.img }).eq("id", m.next_id);
            } else if (!nxt.b_img) {
              await supa.from(MATCHES).update({ b_name: winner.name, b_img: winner.img }).eq("id", m.next_id);
            }
          }
        } else if (current_round === 5) {
          // FINAL: log the champion
          await supa.from(WINNERS).insert({
            match_id: m.id,
            image_url: winner.img,
            won_at: new Date().toISOString(),
          }).catch(()=>{});
        }
      }

      // advance round if done
      const { data: after } = await supa.from(MATCHES).select("id,decided,a_img,b_img").eq("round", current_round);
      const stillOpen = (after ?? []).some((m: any) => (m.a_img && m.b_img && !m.decided));
      if (!stillOpen && current_round < 5) {
        current_round = (current_round + 1) as RoundNum;
        await supa.from(META_TABLE).update({ current_round }).eq("id", 1);
      }
    }

    return json({ ok: true, round: current_round, end_at: trow?.end_at });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: String(e) }, { status: 500 });
  }
});