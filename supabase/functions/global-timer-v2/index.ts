// supabase/functions/global-timer-v2/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

const CHECKPOINTS = 5; // R32,R16,QF,SF,FINAL
const SLUGS = ["r32","r16","qf","sf","final"]; // map 1..5

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = new URL(req.url);
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  async function loadCycle() {
    const { data: rows } = await supabase.from("cycles_v2").select("*").limit(1);
    let row = rows?.[0];
    if (!row) {
      const { data } = await supabase.from("cycles_v2").insert({}).select().single();
      row = data!;
    }
    return row;
  }

  function calcCheckpoint(cycle_start: string, period_sec: number, nowMs = Date.now()) {
    const startMs = Date.parse(cycle_start);
    const periodMs = period_sec * 1000;
    let elapsed = (nowMs - startMs) % periodMs;
    if (elapsed < 0) elapsed += periodMs;
    const slice = Math.floor(periodMs / CHECKPOINTS);
    // countdown style: decisions at 4,3,2,1,0 slices left
    const remaining = periodMs - elapsed;
    const k = Math.floor((remaining + 1) / slice); // 0..5
    // Convert to progressive checkpoint 0..5 (0 start-of-cycle, 5==final time)
    return CHECKPOINTS - Math.min(CHECKPOINTS, k);
  }

  async function decideRoundOnce(baseISO: string, roundNum: number) {
    // build the list of phase_keys to decide, based on round
    const keys: string[] = [];
    if (roundNum === 1) { // R32
      for (let i = 1; i <= 16; i++) keys.push(`${baseISO}::r32_${i}`);
    } else if (roundNum === 2) { // R16
      for (let i = 1; i <= 8; i++) keys.push(`${baseISO}::r16_${i}`);
    } else if (roundNum === 3) { // QF
      ["qf1","qf2","qf3","qf4"].forEach(k => keys.push(`${baseISO}::${k}`));
    } else if (roundNum === 4) { // SF
      ["sf1","sf2"].forEach(k => keys.push(`${baseISO}::${k}`));
    } else { // 5 final
      keys.push(`${baseISO}::final`);
    }

    for (const pk of keys) {
      // Count votes
      const { data: votes } = await supabase
        .from("phase_votes_v2").select("vote").eq("phase_key", pk);
      let r = 0, b = 0;
      (votes ?? []).forEach(v => { if (v.vote === "red") r++; else if (v.vote === "blue") b++; });

      const color = (r === b) ? (Math.random() < 0.5 ? "red" : "blue") : (r > b ? "red" : "blue");

      // Idempotent insert
      const { error: insErr } = await supabase
        .from("winners_v2")
        .insert({ base_iso: baseISO, phase_key: pk, round_num: roundNum, color });

      if (insErr && !String(insErr.message).includes("duplicate")) {
        console.error("winner insert error", pk, insErr);
      }
    }
  }

  if (req.method === "GET") {
    const c = await loadCycle();
    const k = c.paused ? c.last_checkpoint : calcCheckpoint(c.cycle_start, c.period_sec);
    // Catch up if needed (server-driven)
    if (!c.paused && k > c.last_checkpoint) {
      for (let x = c.last_checkpoint + 1; x <= k; x++) {
        await decideRoundOnce(c.cycle_start, x);
      }
      await supabase.from("cycles_v2").update({ last_checkpoint: k, updated_at: new Date().toISOString() }).eq("id", c.id);
    }

    const phaseEndMs = Date.parse(c.cycle_start) + c.period_sec * 1000; // end of entire cycle
    const sliceMs = Math.floor(c.period_sec * 1000 / CHECKPOINTS);
    const nxt = Math.min(CHECKPOINTS, (c.paused ? c.last_checkpoint + 1 : calcCheckpoint(c.cycle_start, c.period_sec) + 1));
    const nextEdge = phaseEndMs - (CHECKPOINTS - nxt) * sliceMs;

    return new Response(JSON.stringify({
      state: {
        cycle_start: c.cycle_start,
        period_sec: c.period_sec,
        last_checkpoint: k,
        paused: c.paused,
        next_decide_at: new Date(nextEdge).toISOString(),
        remaining_sec: Math.max(0, Math.ceil((phaseEndMs - Date.now()) / 1000)),
      }
    }), { headers: cors });
  }

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const c = await loadCycle();

    if (body.action === "pause") {
      await supabase.from("cycles_v2").update({ paused: true, updated_at: new Date().toISOString() }).eq("id", c.id);
    } else if (body.action === "resume") {
      await supabase.from("cycles_v2").update({ paused: false, updated_at: new Date().toISOString() }).eq("id", c.id);
    } else if (body.action === "reset") {
      // start a fresh cycle now, keep same period_sec
      const start = new Date().toISOString();
      await supabase.from("cycles_v2").update({
        cycle_start: start, last_checkpoint: 0, paused: false, updated_at: start
      }).eq("id", c.id);
    } else if (body.action === "advance") {
      // manual step for testing
      const nextK = Math.min(CHECKPOINTS, c.last_checkpoint + 1);
      await decideRoundOnce(c.cycle_start, nextK);
      await supabase.from("cycles_v2").update({ last_checkpoint: nextK, updated_at: new Date().toISOString() }).eq("id", c.id);
    }

    return new Response(JSON.stringify({ ok: true }), { headers: cors });
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: cors });
});