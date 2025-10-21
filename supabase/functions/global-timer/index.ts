// supabase/functions/global-timer/index.ts
// Deno deploy function — global timer + phase rollover + winners upsert + admin actions.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supa = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

// ---------- Types the frontend expects ----------
type TimerState = {
  phase_end_at: string;       // ISO string, Z, no ms
  period_sec: number;         // defaults to 30 if null in DB
  paused: boolean;
  remaining_sec: number | null;
};

// ---------- Helpers ----------
function isoZ(d: Date | number | string) {
  const s = new Date(d).toISOString();
  // strip ms to match UI and make equals checks saner
  return s.replace(/\.\d{3}Z$/, "Z");
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "*",
    // be explicit about caching (clients poll frequently)
    "Cache-Control": "no-store",
  };
}

function ok(body: unknown, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", ...cors(), ...extraHeaders },
  });
}

function bad(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json", ...cors() },
  });
}

// ---------- DB helpers ----------
async function getTimer(): Promise<TimerState> {
  // We use a single-row table `timer_state` with id=1
  const { data, error } = await supa
    .from("timer_state")
    .select("*")
    .eq("id", 1)
    .single();

  if (error || !data) throw new Error(error?.message || "timer_state missing");

  const phase_end_at = isoZ(data.phase_end_at);
  const period_sec = Number(data.period_sec ?? 30); // default 30s now
  const paused = !!data.paused;

  const rem =
    paused
      ? Number.isFinite(data.remaining_sec) ? Number(data.remaining_sec) : null
      : Math.max(0, Math.ceil((Date.parse(phase_end_at) - Date.now()) / 1000));

  return { phase_end_at, period_sec, paused, remaining_sec: rem };
}

async function setPause(paused: boolean) {
  const { error } = await supa
    .from("timer_state")
    .update({ paused, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) throw error;
}

async function setNextPhaseEnd(nextEnd: string) {
  const { error } = await supa
    .from("timer_state")
    .update({ phase_end_at: nextEnd, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) throw error;
}

async function setRemainingSec(value: number | null) {
  const { error } = await supa
    .from("timer_state")
    .update({ remaining_sec: value, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) throw error;
}

async function setPeriodSec(value: number) {
  const { error } = await supa
    .from("timer_state")
    .update({ period_sec: value, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) throw error;
}

function r32Slots() {
  return Array.from({ length: 16 }, (_, i) => `r32_${i + 1}`);
}
function r16Slots() {
  return Array.from({ length: 8 }, (_, i) => `r16_${i + 1}`);
}
function qfSlots() {
  return Array.from({ length: 4 }, (_, i) => `qf${i + 1}`);
}
function sfSlots() {
  return ["sf1", "sf2"];
}

// Count votes for a phase_key (red/blue)
async function countRB(pk: string): Promise<{ r: number; b: number }> {
  const { data, error } = await supa
    .from("phase_votes")
    .select("vote", { count: "exact", head: false })
    .eq("phase_key", pk);

  if (error) throw error;
  let r = 0, b = 0;
  for (const row of data ?? []) {
    if ((row as any).vote === "red") r++;
    else if ((row as any).vote === "blue") b++;
  }
  return { r, b };
}

async function upsertWinner(pk: string, color: "red" | "blue") {
  const { error } = await supa
    .from("winners")
    .upsert({ phase_key: pk, color }, { onConflict: "phase_key" });
  if (error) throw error;
}

// Decide winners for all possible slots at a base (idempotent)
async function decideAllForBase(baseISO: string) {
  const tasks: Promise<unknown>[] = [];

  // R32 (16)
  for (const s of r32Slots()) {
    const pk = `${baseISO}::${s}`;
    tasks.push(
      (async () => {
        const { data: exists } = await supa
          .from("winners")
          .select("phase_key")
          .eq("phase_key", pk)
          .maybeSingle();
        if (exists) return;

        const { r, b } = await countRB(pk);
        const color = r > b ? "red" : b > r ? "blue" as const : "red"; // tie → red
        await upsertWinner(pk, color);
      })()
    );
  }

  // R16 (8)
  for (const s of r16Slots()) {
    const pk = `${baseISO}::${s}`;
    tasks.push(
      (async () => {
        const { data: exists } = await supa
          .from("winners")
          .select("phase_key")
          .eq("phase_key", pk)
          .maybeSingle();
        if (exists) return;

        const { r, b } = await countRB(pk);
        const color = r > b ? "red" : b > r ? "blue" as const : "red";
        await upsertWinner(pk, color);
      })()
    );
  }

  // QF (4)
  for (const s of qfSlots()) {
    const pk = `${baseISO}::${s}`;
    tasks.push(
      (async () => {
        const { data: exists } = await supa
          .from("winners")
          .select("phase_key")
          .eq("phase_key", pk)
          .maybeSingle();
        if (exists) return;

        const { r, b } = await countRB(pk);
        const color = r > b ? "red" : b > r ? "blue" as const : "red";
        await upsertWinner(pk, color);
      })()
    );
  }

  // SF (2)
  for (const s of sfSlots()) {
    const pk = `${baseISO}::${s}`;
    tasks.push(
      (async () => {
        const { data: exists } = await supa
          .from("winners")
          .select("phase_key")
          .eq("phase_key", pk)
          .maybeSingle();
        if (exists) return;

        const { r, b } = await countRB(pk);
        const color = r > b ? "red" : b > r ? "blue" as const : "red";
        await upsertWinner(pk, color);
      })()
    );
  }

  // Final (1)
  {
    const pk = `${baseISO}::final`;
    tasks.push(
      (async () => {
        const { data: exists } = await supa
          .from("winners")
          .select("phase_key")
          .eq("phase_key", pk)
          .maybeSingle();
        if (exists) return;

        const { r, b } = await countRB(pk);
        const color = r > b ? "red" : b > r ? "blue" as const : "red";
        await upsertWinner(pk, color);
      })()
    );
  }

  await Promise.all(tasks);
}

// Advance the timer if due; returns the *updated* state
async function maybeAdvance(): Promise<TimerState> {
  // load current
  const cur = await getTimer();

  if (cur.paused) return cur;

  const now = Date.now();
  const end = Date.parse(cur.phase_end_at);

  if (now < end) {
    return { ...cur, remaining_sec: Math.ceil((end - now) / 1000) };
  }

  // Phase has ended → decide winners for the just-ended base
  const endedBaseISO = isoZ(cur.phase_end_at);

  try {
    await decideAllForBase(endedBaseISO);
  } catch (e) {
    // Don’t explode the function; return state anyway. UI will retry.
    console.error("decideAllForBase failed:", e);
  }

  // Set next phase end
  const nextEnd = isoZ(new Date(end + cur.period_sec * 1000));
  await setNextPhaseEnd(nextEnd);

  // Return fresh state
  return await getTimer();
}

// ---------- Admin-style actions ----------
async function advanceNow(): Promise<TimerState> {
  // Decide winners for the *current* base (the one ending at phase_end_at)
  const cur = await getTimer();
  const curBaseISO = isoZ(cur.phase_end_at);

  try {
    await decideAllForBase(curBaseISO);
  } catch (e) {
    console.error("decideAllForBase (advanceNow) failed:", e);
  }

  // Move to next phase starting now + period
  const nextEnd = isoZ(new Date(Date.now() + cur.period_sec * 1000));
  await setNextPhaseEnd(nextEnd);
  return await getTimer();
}

async function resetTimer(periodOverride?: number): Promise<TimerState> {
  const cur = await getTimer();
  const newPeriod = Number.isFinite(periodOverride) && periodOverride! > 0
    ? Math.floor(periodOverride!)
    : cur.period_sec;

  // Persist the period change if overridden
  if (newPeriod !== cur.period_sec) {
    await setPeriodSec(newPeriod);
  }

  await setNextPhaseEnd(isoZ(new Date(Date.now() + newPeriod * 1000)));
  await setRemainingSec(null);
  return await getTimer();
}

// ---------- HTTP handler ----------
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors() });
  }

  // Accept action in GET ?action= or POST {action}
  let action: "pause" | "resume" | "advance" | "reset" | undefined;
  let periodOverride: number | undefined;

  try {
    const u = new URL(req.url);
    const q = (u.searchParams.get("action") || "").toLowerCase();
    if (q === "pause" || q === "resume" || q === "advance" || q === "reset") {
      action = q as typeof action;
    }
    const p = u.searchParams.get("period");
    if (p != null) {
      const n = Number(p);
      if (Number.isFinite(n) && n > 0) periodOverride = n;
    }
  } catch {}

  if (!action && req.method === "POST") {
    try {
      const j = await req.json();
      const a = String(j?.action || "").toLowerCase();
      if (a === "pause" || a === "resume" || a === "advance" || a === "reset") {
        action = a as typeof action;
      }
      const n = Number(j?.period);
      if (Number.isFinite(n) && n > 0) periodOverride = n;
    } catch { /* ignore */ }
  }

  try {
    if (action === "pause") {
      await setPause(true);
      const state = await getTimer();
      return ok({ ok: true, state });
    }
    if (action === "resume") {
      await setPause(false);
      const state = await getTimer();
      return ok({ ok: true, state });
    }
    if (action === "advance") {
      const state = await advanceNow();
      return ok({ ok: true, state });
    }
    if (action === "reset") {
      const state = await resetTimer(periodOverride);
      return ok({ ok: true, state });
    }

    // No action → regular poll: maybe advance, then return state
    const state = await maybeAdvance();
    return ok({ state });
  } catch (e) {
    console.error("global-timer error:", e);
    return bad(500, (e as any)?.message || "server error");
  }
});