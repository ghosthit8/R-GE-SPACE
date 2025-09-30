// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const META_TABLE = "tournament_meta";
const MATCHES = "matches";
const WINNERS = "winners";
const GLOBAL_TIMER = "global_timer";

type RoundNum = 1 | 2 | 3 | 4 | 5;
const ROUND_SECONDS = 60; // <= change match duration here

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "POST,OPTIONS",
    }, ...init,
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  try {
    // make sure timer row exists
    const { data: g0 } = await sb.from(GLOBAL_TIMER).select("*").eq("id","global").maybeSingle();
    if (!g0) await sb.from(GLOBAL_TIMER).insert({ id: "global", end_at: null, paused: false });

    // load timer + meta
    const { data: timer } = await sb.from(GLOBAL_TIMER).select("*").eq("id","global").maybeSingle();
    const { data: meta }  = await sb.from(META_TABLE).select("*").eq("id",1).maybeSingle();
    if (!meta) throw new Error("missing tournament_meta id=1");

    let current_round = Math.max(1, Math.min(5, meta.current_round ?? 1)) as RoundNum;

    if (timer?.paused) return json({ ok:true, state:"paused" });

    const expired = !timer?.end_at || new Date(timer.end_at).getTime() <= Date.now();

    const seed = async (secs: number) => {
      const endISO = new Date(Date.now() + secs * 1000).toISOString();
      await sb.from(GLOBAL_TIMER)
        .update({ end_at: endISO, updated_at: new Date().toISOString() })
        .eq("id","global");
      return endISO;
    };

    if (!expired) {
      return json({ ok:true, state:"ticking", round: current_round, end_at: timer!.end_at });
    }

    // === timer expired ===
    // decide one open match in current round
    const { data: open } = await sb
      .from(MATCHES)
      .select("*")
      .eq("round", current_round)
      .eq("decided", false)
      .order("idx", { ascending: true })
      .limit(1);

    if (open && open.length) {
      const m = open[0];
      const a = m.votes_a ?? 0, b = m.votes_b ?? 0;
      const winnerIsA = a > b ? true : b > a ? false : Math.random() < 0.5;

      // idempotent decide
      const { data: upd } = await sb
        .from(MATCHES)
        .update({ decided: true })
        .eq("id", m.id)
        .eq("decided", false)
        .select("id");

      if (upd && upd.length) {
        if (m.next_id) {
          const { data: next } = await sb.from(MATCHES).select("a_img,b_img").eq("id", m.next_id).maybeSingle();
          const name = winnerIsA ? m.a_name : m.b_name;
          const img  = winnerIsA ? m.a_img  : m.b_img;
          if (next && !next.a_img) {
            await sb.from(MATCHES).update({ a_name: name, a_img: img }).eq("id", m.next_id);
          } else {
            await sb.from(MATCHES).update({ b_name: name, b_img: img }).eq("id", m.next_id);
          }
        } else if (current_round === 5) {
          const img = winnerIsA ? m.a_img : m.b_img;
          if (img) { try { await sb.from(WINNERS).insert({ image_url: img, won_at: new Date().toISOString() }); } catch {} }
        }
      }

      const end_at = await seed(ROUND_SECONDS);      // same round, next match window
      return json({ ok:true, state:"decided-one", round: current_round, end_at });
    }

    // no open matches → advance or finish
    if (current_round < 5) {
      current_round = (current_round + 1) as RoundNum;
      await sb.from(META_TABLE).update({ current_round }).eq("id",1);
      const end_at = await seed(ROUND_SECONDS);
      return json({ ok:true, state:"advance-round", round: current_round, end_at });
    }

    // FINAL complete → stop (no loop for now)
    await sb.from(GLOBAL_TIMER).update({ end_at: null, updated_at: new Date().toISOString() }).eq("id","global");
    return json({ ok:true, state:"final-complete", round: 5, end_at: null });

  } catch (e) {
    console.error(e);
    return json({ ok:false, error: String(e) }, { status: 500 });
  }
});