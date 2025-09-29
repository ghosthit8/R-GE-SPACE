import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type MatchRow = {
  id: string; round: number; idx: number;
  a_name: string|null; a_img: string|null;
  b_name: string|null; b_img: string|null;
  votes_a: number|null; votes_b: number|null;
  decided: boolean; next_id: string|null;
};

const START_ROUND = 1, FINAL_ROUND = 5, LOOP_BACK_TO = 1;
const RID = {1:"r32",2:"r16",3:"qf",4:"sf",5:"final"} as const;
const DEFAULT_DURATION = 10;

const H = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "content-type": "text/plain",
};

const nowIso = () => new Date().toISOString();
const addSeconds = (d: Date, s: number) => new Date(d.getTime() + s*1000);

async function seedTimer(s: any, round: number, duration: number) {
  const id = (RID as any)[round];
  const end_at = addSeconds(new Date(), duration).toISOString();
  const { error } = await s.from("shared_timer").upsert(
    { id, end_at, duration_seconds: duration, updated_at: nowIso() },
    { onConflict: "id" },
  );
  if (error) throw error;
  return end_at;
}

async function decideAndPropagate(s: any, m: MatchRow) {
  const a = m.votes_a ?? 0, b = m.votes_b ?? 0;
  const winner = (a>b) ? {name:m.a_name, img:m.a_img}
               : (b>a) ? {name:m.b_name, img:m.b_img}
               : (Math.random()<0.5 ? {name:m.a_name, img:m.a_img} : {name:m.b_name, img:m.b_img});
  const u = await s.from("matches").update({decided:true}).eq("id", m.id);
  if (u.error) throw u.error;

  if (m.next_id) {
    const { data: next, error: ne } = await s.from("matches").select("*").eq("id", m.next_id).maybeSingle();
    if (ne) throw ne;
    if (next) {
      if (!next.a_img)
        await s.from("matches").update({ a_name:winner.name, a_img:winner.img }).eq("id", m.next_id);
      else if (!next.b_img)
        await s.from("matches").update({ b_name:winner.name, b_img:winner.img }).eq("id", m.next_id);
    }
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: H });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { ...H, Allow: "POST" } });

  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!auth?.toLowerCase().startsWith("bearer ")) return new Response("Unauthorized", { status: 401, headers: H });

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !service) return new Response("Server misconfigured", { status: 500, headers: H });

    const s = createClient(url, service, { auth: { persistSession: false } });

    // Meta
    const { data: meta, error: me } = await s.from("tournament_meta").select("*").eq("id",1).maybeSingle();
    if (me) throw me;
    const curRound: number = meta?.current_round ?? START_ROUND;
    const duration: number = meta?.duration_seconds ?? DEFAULT_DURATION;

    // If timer still live -> exit
    const { data: t, error: te } = await s.from("shared_timer").select("end_at").eq("id",(RID as any)[curRound]).maybeSingle();
    if (te) throw te;
    const live = t?.end_at && new Date(t.end_at).getTime() > Date.now();
    if (live) return new Response("timer live", { headers: H });

    // Decide any remaining
    const { data: matches, error: me2 } = await s.from("matches").select("*").eq("round", curRound).order("idx");
    if (me2) throw me2;

    for (const m of matches as MatchRow[]) {
      if (!m.decided) {
        if (m.a_img && m.b_img) await decideAndPropagate(s, m);
        else {
          // bye advances
          const u = await s.from("matches").update({decided:true}).eq("id", m.id);
          if (u.error) throw u.error;
          if (m.next_id) {
            const winner = m.a_img ? {name:m.a_name, img:m.a_img} : {name:m.b_name, img:m.b_img};
            const { data: next } = await s.from("matches").select("*").eq("id", m.next_id).maybeSingle();
            if (next) {
              if (!next.a_img) await s.from("matches").update({ a_name:winner.name, a_img:winner.img }).eq("id", m.next_id);
              else if (!next.b_img) await s.from("matches").update({ b_name:winner.name, b_img:winner.img }).eq("id", m.next_id);
            }
          }
        }
      }
    }

    // Any still open?
    const { data: open } = await s.from("matches").select("id").eq("round", curRound).eq("decided", false);
    let nextRound = curRound;

    if (!open || open.length === 0) {
      if (curRound < FINAL_ROUND) {
        nextRound = curRound + 1;
        const uNext = await s.from("matches").update({ votes_a:0, votes_b:0, decided:false }).eq("round", nextRound);
        if (uNext.error) throw uNext.error;
        await s.from("matches").update({ votes_a:0, votes_b:0 }).eq("round", curRound);
        const upM = await s.from("tournament_meta").upsert({ id:1, current_round: nextRound, duration_seconds: duration });
        if (upM.error) throw upM.error;
      } else {
        nextRound = LOOP_BACK_TO;
        await s.from("matches").update({ votes_a:0, votes_b:0, decided:false }).eq("round", START_ROUND);
        for (let r=START_ROUND+1; r<=FINAL_ROUND; r++) {
          await s.from("matches").update({
            a_name:null,a_img:null,b_name:null,b_img:null,votes_a:0,votes_b:0,decided:false
          }).eq("round", r);
        }
        const upM = await s.from("tournament_meta").upsert({ id:1, current_round: nextRound, duration_seconds: duration });
        if (upM.error) throw upM.error;
      }
    }

    const endAt = await seedTimer(s, nextRound, duration); // always seed timer
    return new Response(`ok: ${RID[curRound as 1|2|3|4|5]} -> ${RID[nextRound as 1|2|3|4|5]} end_at=${endAt}`, { headers: H });
  } catch (e) {
    console.error(e);
    return new Response("error", { status: 500, headers: H });
  }
});