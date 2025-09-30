// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---- ENV ----
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ---- TABLES ----
const TIMER_TABLE = "global_timer";      // one row: { id:'global', end_at, paused, updated_at }
const META_TABLE  = "tournament_meta";   // one row: { id:1, current_round }
const MATCHES     = "matches";           // your bracket rows
const WINNERS     = "winners";           // optional log of champions

// ---- CONSTANTS ----
type RoundNum = 1 | 2 | 3 | 4 | 5;       // 1:R32, 2:R16, 3:QF, 4:SF, 5:FINAL
const ROUND_SECONDS = 20;                // ⏱ for testing (set 86400 for 24h)
const DECISIONS_PER_TICK = 4;            // decide up to N matches per heartbeat so progress is guaranteed
const RESET_AFTER_FINAL = false;         // set true if you want auto-reset to R32 after a champion

// ---- HELPERS ----
const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "POST,OPTIONS",
    },
    ...init,
  });

function flip(a: number, b: number) {
  if (a > b) return true;
  if (b > a) return false;
  return Math.random() < 0.5;
}

async function reseedTimer(supa: any) {
  const endISO = new Date(Date.now() + ROUND_SECONDS * 1000).toISOString();
  await supa
    .from(TIMER_TABLE)
    .upsert({ id: "global", end_at: endISO, paused: false, updated_at: new Date().toISOString() }, { onConflict: "id" });
  return endISO;
}

async function ensureMeta(supa: any): Promise<RoundNum> {
  let { data: meta } = await supa.from(META_TABLE).select("*").eq("id", 1).maybeSingle();
  if (!meta) {
    await supa.from(META_TABLE).insert({ id: 1, current_round: 1 });
    ({ data: meta } = await supa.from(META_TABLE).select("*").eq("id", 1).maybeSingle());
  }
  const cur = Math.max(1, Math.min(5, meta?.current_round ?? 1)) as RoundNum;
  return cur;
}

async function setRound(supa: any, r: RoundNum) {
  await supa.from(META_TABLE).update({ current_round: r }).eq("id", 1);
}

// ---- MAIN ----
serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    // 0) meta + timer rows exist
    let current_round = await ensureMeta(supa);

    const { data: trow } = await supa
      .from(TIMER_TABLE)
      .select("*")
      .eq("id", "global")
      .maybeSingle();

    const now = Date.now();
    const endAt = trow?.end_at ? new Date(trow.end_at).getTime() : 0;
    const paused = !!trow?.paused;

    // If paused, do nothing—just echo status
    if (paused) {
      return json({ ok: true, state: "paused", round: current_round, end_at: trow?.end_at ?? null });
    }

    // If timer not set or expired, reseed first so every hit always moves time forward
    let reseeded = false;
    if (!endAt || endAt <= now) {
      await reseedTimer(supa);
      reseeded = true;
    }

    // If the timer hasn't expired yet, just report status
    if (endAt && endAt > now) {
      return json({ ok: true, state: "ticking", round: current_round, end_at: trow!.end_at });
    }

    // 1) TIMER JUST EXPIRED → decide some matches in the current round
    //    choose only undecided matches that have both contestants
    const { data: candidates } = await supa
      .from(MATCHES)
      .select("*")
      .eq("round", current_round)
      .eq("decided", false)
      .not("a_img", "is", null)
      .not("b_img", "is", null)
      .order("idx", { ascending: true })
      .limit(DECISIONS_PER_TICK);

    let decidedCount = 0;
    for (const m of candidates ?? []) {
      const a = m.votes_a ?? 0;
      const b = m.votes_b ?? 0;
      const pickA = flip(a, b);
      const winner = pickA
        ? { name: m.a_name, img: m.a_img }
        : { name: m.b_name, img: m.b_img };

      // mark decided
      await supa.from(MATCHES).update({ decided: true }).eq("id", m.id);

      // push winner forward
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
        // FINAL → record champion
        await supa
          .from(WINNERS)
          .insert({ match_id: m.id, image_url: winner.img, won_at: new Date().toISOString() })
          .catch(() => {});
      }

      decidedCount++;
    }

    // 2) If nothing to decide in this round, advance the round
    let advanced = false;
    if (decidedCount === 0) {
      // Are there any still-open active matches left in this round?
      const { data: still } = await supa
        .from(MATCHES)
        .select("id")
        .eq("round", current_round)
        .eq("decided", false)
        .not("a_img", "is", null)
        .not("b_img", "is", null)
        .limit(1);

      if (!still || still.length === 0) {
        if (current_round < 5) {
          current_round = (current_round + 1) as RoundNum;
          await setRound(supa, current_round);
          advanced = true;
        } else {
          // FINAL finished: either pause or reset according to preference
          if (RESET_AFTER_FINAL) {
            // Reset meta only (content reset is up to a manual SQL or separate function)
            await setRound(supa, 1);
            current_round = 1;
            advanced = true;
          } else {
            // Pause the global timer so UI rests at 00:00 until you kick/reset
            await supa.from(TIMER_TABLE).update({ paused: true }).eq("id", "global");
          }
        }
      }
    }

    // 3) Always reseed the timer for the next window
    const nextEnd = await reseedTimer(supa);

    return json({
      ok: true,
      state: decidedCount > 0 ? "decided-some" : advanced ? "advanced-round" : "idle-no-open-matches",
      decided: decidedCount,
      round: current_round,
      end_at: nextEnd,
      reseeded,
    });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: String(e) }, { status: 500 });
  }
});