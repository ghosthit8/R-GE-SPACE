// fullscreen.js — overlay-based auto-reenter fullscreen (most reliable on iOS/Safari)
(function(){
  const WANT_KEY = "rs_fs";

  const onReady = (fn) => {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once:true });
    } else fn();
  };

  // Small helper: is OS fullscreen currently active?
  const isActive = () =>
    !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);

  // Try to request fullscreen *synchronously* (Safari may not return a Promise)
  function requestFSNow(){
    const el  = document.documentElement; // use <html> to cover whole app
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (!req) return false;
    try {
      const ret = req.call(el); // may be undefined on Safari
      if (ret && typeof ret.then === "function") ret.catch(()=>{});
      return true;
    } catch {
      return false;
    }
  }

  function exitFSNow(){
    const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    try { if (exit) exit.call(document); } catch {}
  }

  function setBtn(fsBtn, on){ if (fsBtn) fsBtn.textContent = on ? "✕" : "⛶"; }

  // Create a one-shot full-page transparent overlay that captures the first gesture
  function mountGestureOverlay(){
    // Avoid duplicates
    if (document.getElementById("fs-gesture-overlay")) return;

    const overlay = document.createElement("div");
    overlay.id = "fs-gesture-overlay";
    overlay.style.cssText = [
      "position:fixed","inset:0","z-index:999999","background:transparent",
      "cursor:default","touch-action:manipulation"
    ].join(";");

    // Handler MUST be synchronous and minimal
    const fire = () => {
      requestFSNow();
      // Remove overlay in a microtask—if FS didn't take, we'll re-add later
      setTimeout(()=> overlay.remove(), 0);
    };

    // Bind multiple inputs (Safari/iOS differences). Non-passive, no {once} so it definitely fires.
    overlay.addEventListener("pointerdown", fire, { capture:true });
    overlay.addEventListener("click",       fire, { capture:true });
    overlay.addEventListener("touchend",    fire, { capture:true });
    overlay.addEventListener("keydown",     fire, { capture:true });

    // Make overlay focusable for key events (optional)
    overlay.tabIndex = -1;
    document.body.appendChild(overlay);
    // Try to focus so a quick key press also works
    overlay.focus?.();
  }

  onReady(() => {
    const fsBtn = document.getElementById("fsAppBtn");
    if (fsBtn) fsBtn.type = "button";

    function toggleFullscreen(){
      const turningOn = !document.body.classList.contains("fs");
      if (turningOn){
        document.body.classList.add("fs");      // CSS full-bleed immediately
        localStorage.setItem(WANT_KEY, "1");
        setBtn(fsBtn, true);
        // First try right now; if it doesn't "take", the overlay will handle the next gesture.
        const invoked = requestFSNow();
        if (!invoked || !isActive()) mountGestureOverlay();
        window.scrollTo(0,0);
      } else {
        document.body.classList.remove("fs");
        localStorage.removeItem(WANT_KEY);
        setBtn(fsBtn, false);
        exitFSNow();
        // Clean up any leftover overlay
        document.getElementById("fs-gesture-overlay")?.remove();
      }
    }

    // Wire the FAB
    fsBtn?.addEventListener("click", toggleFullscreen);

    // Restore preference on load
    const want = localStorage.getItem(WANT_KEY) === "1";
    if (want){
      document.body.classList.add("fs");   // instant full-bleed
      setBtn(fsBtn, true);
      // Try immediate enter; if it fails or the browser auto-exits on nav, mount overlay
      const invoked = requestFSNow();
      if (!invoked || !isActive()) mountGestureOverlay();
    } else {
      setBtn(fsBtn, false);
    }

    // If user presses ESC/back and OS fullscreen drops:
    document.addEventListener("fullscreenchange", () => {
      if (!isActive()){
        if (localStorage.getItem(WANT_KEY) === "1"){
          // Keep CSS full-bleed and arm overlay for the next gesture
          setBtn(fsBtn, true);
          mountGestureOverlay();
        } else {
          document.body.classList.remove("fs");
          setBtn(fsBtn, false);
          document.getElementById("fs-gesture-overlay")?.remove();
        }
      } else {
        // If we *did* enter, no need for overlay
        document.getElementById("fs-gesture-overlay")?.remove();
      }
    });
  });
})();