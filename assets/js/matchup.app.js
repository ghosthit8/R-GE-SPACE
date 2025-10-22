// ===== Global tournament clock (20s segment cutoffs) =====

// We receive a monotonic tournament time t in [0..100] (wrapping) from the edge function.
// UI should count DOWN to the next 20s cutoff. At exact cutoffs we trigger a single refresh.
// Cutoffs & stages:
//   80 → r32, 60 → r16, 40 → qf, 20 → sf, 0 → final

// --- display helper: show seconds remaining until the next 20s mark ---
// show 0 only when t === 0 (final), otherwise 20..1 every segment.
function renderCountdownToNextCutoff(t) {
  const tm = ((t % 100) + 100) % 100;      // normalize
  const seg = tm % 20;
  const down = seg === 0 ? (tm === 0 ? 0 : 20) : (20 - seg);
  try {
    const el = document.getElementById('clock');
    if (el) el.textContent = String(down);
  } catch {}
}

// --- figure out what stage should resolve at this exact t (or null if none) ---
function stageAtCutoff(t) {
  const tm = ((t % 100) + 100) % 100;
  if (tm === 80) return 'r32';
  if (tm === 60) return 'r16';
  if (tm === 40) return 'qf';
  if (tm === 20) return 'sf';
  if (tm === 0)  return 'final';
  return null;
}

// ensure we only fire once per cutoff
let _lastCutoffKey = null;

// Call this from your edge-timer tick handler after you compute `t`.
// It both updates the visible clock and decides winners at the correct cutoffs.
async function onGlobalTick(t) {
  renderCountdownToNextCutoff(t);

  const stage = stageAtCutoff(t);
  if (!stage) return;

  const key = `${cycleStart || ''}::${stage}::${t}`;
  if (key === _lastCutoffKey) return; // already handled this exact cutoff
  _lastCutoffKey = key;

  // Decide winners / refresh data at this cutoff.
  // Use your existing loaders if present; fall back gracefully otherwise.
  try {
    // These helpers already exist elsewhere in your app:
    //   - loadWinners(baseISO)
    //   - loadAdvancers(baseISO)
    //   - loadPhaseVotes(baseISO)              (if you want to re-pull visible counts)
    //   - renderBracket() / renderEverything() (whatever you currently call to re-render)
    if (typeof loadWinners === 'function')      await loadWinners(cycleStart);
    if (typeof loadAdvancers === 'function')    await loadAdvancers(cycleStart);
    if (typeof loadPhaseVotes === 'function')   await loadPhaseVotes(cycleStart);

    if (typeof renderEverything === 'function') {
      renderEverything();
    } else if (typeof renderBracket === 'function') {
      renderBracket();
    }
  } catch (err) {
    try { window.RageDebug?.log?.('cutoff refresh error', err); } catch {}
  }
}