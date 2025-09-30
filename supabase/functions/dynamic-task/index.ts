// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const TIMER_TABLE = "shared_timer";
const META_TABLE = "tournament_meta";
const MATCHES = "matches";
const WINNERS = "winners";

// Round IDs and mapping
const ROUND_IDS = ["", "r32", "r16", "qf", "sf", "final"] as const;
type RoundNum = 1 | 2 | 3 | 4 | 5;

const ROUND_SECONDS = 10; // testing; set to 86400 for 24h in prod

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
  if (req.method === "OPTIONS") return json({ ok: true }); // CORS preflight

  try {
    const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

    // --- Ensure meta row exists ---
    let { data: meta } = await supa
      .from(META_TABLE)
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    if (!meta) {
      await supa.from(META_TABLE).insert({ id: 1, current_round: 1 });
      ({ data: meta } = await supa
        .from(META_TABLE)
        .select("*")
        .eq("id", 1)
        .maybeSingle());
    }

    let current_round: RoundNum = Math.max(
      1,
      Math.min(5, meta?.current_round ?? 1),
    ) as RoundNum;

    const now = new Date();

    // --- Seed or extend timer for the current round ---
    const timerId = ROUND_IDS[current_round];
    let { data: trow } = await supa
      .from(TIMER_TABLE)
      .select("*")
      .eq("id", timerId)
      .maybeSingle();

    const timerExpired =
      !trow?.end_at || new Date(trow.end_at).getTime() <= now.getTime();

    if (timerExpired) {
      // If missing or expired, (re)seed right away
      const endISO = new Date(
        Date.now() + ROUND_SECONDS * 1000,
      ).toISOString();
      if (!trow) {
        await supa.from(TIMER_TABLE).insert({ id: timerId, end_at: endISO });
      } else {
        await supa.from(TIMER_TABLE).update({ end_at: endISO }).eq("id", timerId);
      }
      trow = { id: timerId, end_at: endISO } as any;

      // --- TIMER JUST HIT ZERO (or missing) → DECIDE ACTIVE MATCHES, THEN MAYBE ADVANCE ---
      // Fetch all matches in current round
      const { data: matches } = await supa
        .from(MATCHES)
        .select("*")
        .eq("round", current_round)
        .order("idx", { ascending: true });

      // Active = have both contestants
      const active = (matches ?? []).filter(
        (m: any) => !!(m.a_img && m.b_img),
      );

      // Decide all still-open ACTIVE matches
      for (const m of active) {
        if (m.decided) continue;

        const a = m.votes_a ?? 0;
        const b = m.votes_b ?? 0;

        const pickA = a > b ? true : a < b ? false : Math.random() < 0.5;
        const winner = pickA
          ? { name: m.a_name, img: m.a_img }
          : { name: m.b_name, img: m.b_img };

        // Mark decided
        await supa.from(MATCHES).update({ decided: true }).eq("id", m.id);

        // Advance to next match slot if exists
        if (m.next_id) {
          const { data: nxt } = await supa
            .from(MATCHES)
            .select("*")
            .eq("id", m.next_id)
            .maybeSingle();
          if (nxt) {
            if (!nxt.a_img) {
              await supa
                .from(MATCHES)
                .update({ a_name: winner.name, a_img: winner.img })
                .eq("id", m.next_id);
            } else if (!nxt.b_img) {
              await supa
                .from(MATCHES)
                .update({ b_name: winner.name, b_img: winner.img })
                .eq("id", m.next_id);
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
          } catch {
            /* ignore */
          }
        }
      }

      // Re-check active matches: if none remain open OR there were zero active, advance
      const { data: after } = await supa
        .from(MATCHES)
        .select("id, decided, a_img, b_img")
        .eq("round", current_round);

      const activeAfter = (after ?? []).filter(
        (m: any) => !!(m.a_img && m.b_img),
      );
      const stillOpen = activeAfter.some((m: any) => !m.decided);
      const shouldAdvance = activeAfter.length === 0 || !stillOpen;

      if (shouldAdvance && current_round < 5) {
        current_round = (current_round + 1) as RoundNum;
        await supa.from(META_TABLE).update({ current_round }).eq("id", 1);

        // Seed the next round timer
        const nextId = ROUND_IDS[current_round];
        const nextEnd = new Date(
          Date.now() + ROUND_SECONDS * 1000,
        ).toISOString();
        const { data: ex } = await supa
          .from(TIMER_TABLE)
          .select("*")
          .eq("id", nextId)
          .maybeSingle();
        if (!ex) {
          await supa.from(TIMER_TABLE).insert({ id: nextId, end_at: nextEnd });
        } else {
          await supa.from(TIMER_TABLE).update({ end_at: nextEnd }).eq("id", nextId);
        }
      }
    } else {
      // Timer is running; nothing else to do
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