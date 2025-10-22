<script type="module">
// ===== Matchup App (v2) =====
const C = window.MATCHUP_CONFIG;

// ----- Supabase init -----
const { createClient } = window.supabase;
const supabase = createClient(C.supabaseUrl, C.supabaseAnonKey);

// ----- DOM -----
const elClock = document.getElementById("clock");
const elDecision = document.getElementById("decisionText"); // "Decision in"
const elLeftBtn = document.getElementById("voteLeft");
const elRightBtn = document.getElementById("voteRight");
const elLeftVotes = document.getElementById("leftVotes");
const elRightVotes = document.getElementById("rightVotes");

// ----- Global state -----
let serverOffsetMs = 0;          // now_ms(server) - now_ms(client)
let tickTimer = null;            // UI interval
let triggerGuardKey = "";        // prevents re-firing within same second
let lastPhaseBaseIso = null;     // e.g. "2025-10-22T01:47:00.000Z"

// Helpers
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const nowMsClient = () => Date.now();
const nowMsServer = () => nowMsClient() + serverOffsetMs;

// Align base ISO to the start of the current 100s window
function currentBaseIso() {
  const ms = nowMsServer();
  const sec = Math.floor(ms / 1000);
  const aligned = Math.floor(sec / C.periodSecs) * C.periodSecs;
  return new Date(aligned * 1000).toISOString();
}

// Seconds remaining in this 100s period (100 → 0)
function secondsRemaining() {
  const ms = nowMsServer();
  const sec = Math.floor(ms / 1000);
  const into = sec % C.periodSecs;       // 0..99
  return (C.periodSecs - into) % C.periodSecs; // 99..0
}

// Server-sync via Edge function
async function syncServerTime() {
  log("EDGE", "GET", C.supabaseUrl + C.timerFnPath);
  const t0 = performance.now();
  const res = await fetch(C.supabaseUrl + C.timerFnPath);
  const latency = performance.now() - t0;

  if (!res.ok) throw new Error("Timer GET failed " + res.status);
  const json = await res.json(); // { now_ms, now_iso }
  serverOffsetMs = json.now_ms - nowMsClient() + Math.round(latency / 2);
  lastPhaseBaseIso = currentBaseIso();
  log("CLOCK", "sync", `offset=${serverOffsetMs}ms base=${lastPhaseBaseIso}`);
}

// Vote handling (example wiring—keep your existing endpoints if different)
async function submitVote(side) {
  // your current phase key: base_iso::r32_1 (example)
  const phaseKey = `${lastPhaseBaseIso}::${window.ACTIVE_PHASE || "r32_1"}`;
  const vote = side === "left" ? "L" : "R";

  const payload = { phase_key: phaseKey, vote };
  const { error } = await supabase.from(C.tables.votes).insert(payload);
  if (error) {
    console.error(error);
    return;
  }
  markVotedUI(side);
  await refreshVotes(); // update counts after voting
}

function markVotedUI(side) {
  document.getElementById("votedBadge")?.classList.remove("hidden");
  if (side === "left") {
    elLeftBtn.disabled = true;
    elRightBtn.disabled = false;
  } else {
    elRightBtn.disabled = true;
    elLeftBtn.disabled = false;
  }
}

// Read votes for current pair
async function refreshVotes() {
  const phaseKey = `${lastPhaseBaseIso}::${window.ACTIVE_PHASE || "r32_1"}`;
  const { data, error } = await supabase
    .from(C.tables.votes)
    .select("vote")
    .eq("phase_key", phaseKey);

  if (error) {
    console.error(error);
    return;
  }
  let L = 0, R = 0;
  for (const row of data) (row.vote === "L" ? L++ : R++);
  elLeftVotes.textContent = L.toString();
  elRightVotes.textContent = R.toString();
}

// Compute winners at 80/60/40/20 seconds
async function decideRoundIfNeeded(tRemaining) {
  // 80/60/40/20 → decide round winners (not final),
  // 0 → finalize final winner
  const marks = new Set(C.decisionMarks);
  if (!marks.has(tRemaining)) return;

  // guard so we only fire once per second per baseIso
  const guard = `${lastPhaseBaseIso}:${tRemaining}`;
  if (triggerGuardKey === guard) return;
  triggerGuardKey = guard;

  if (tRemaining === 0) {
    await finalizeFinal();
  } else {
    await decideActiveRound(tRemaining);
  }
}

async function decideActiveRound(tRemaining) {
  // Example: call your Edge function to compute round winners
  log("DECIDE", "round", `@t=${tRemaining} base=${lastPhaseBaseIso}`);
  await fetch(C.supabaseUrl + C.timerFnPath, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "decide-round",
      base_iso: lastPhaseBaseIso
    })
  }).catch(console.error);

  // Afterwards, refresh bracket and winners lists if you show them
  await refreshVotes();
}

async function finalizeFinal() {
  log("DECIDE", "final", `@t=0 base=${lastPhaseBaseIso}`);
  await fetch(C.supabaseUrl + C.timerFnPath, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "decide-final",
      base_iso: lastPhaseBaseIso
    })
  }).catch(console.error);

  // Reset guard so next cycle can trigger
  triggerGuardKey = "";
}

// UI clock tick
function startClock() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(async () => {
    const t = secondsRemaining(); // 99..0
    elClock.textContent = t.toString().padStart(2, "0");

    // When we rolled to a new base window, update & refresh
    const base = currentBaseIso();
    if (base !== lastPhaseBaseIso) {
      lastPhaseBaseIso = base;
      triggerGuardKey = "";
      await refreshVotes();
    }

    await decideRoundIfNeeded(t);
  }, 1000);
}

// ----- Wire vote buttons -----
elLeftBtn?.addEventListener("click", () => submitVote("left"));
elRightBtn?.addEventListener("click", () => submitVote("right"));

// ----- Boot -----
(async function boot() {
  try {
    console.log("[LOG] Debugger ready");
    await syncServerTime();
    await refreshVotes();
    startClock();
  } catch (e) {
    console.error(e);
    // If server time fails, fall back to local time
    startClock();
  }
})();

// ----- tiny logger in page (optional) -----
function log(tag, ...rest) {
  console.log(`[${tag}]`, ...rest);
}
</script>