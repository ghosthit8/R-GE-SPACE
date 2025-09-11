// fullscreen.js (robust auto-reenter)
(function initFS(){
  const ready = (fn) => {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  };

  ready(() => {
    const fsBtn = document.getElementById("fsAppBtn"); // optional but recommended

    async function enterTrueFullscreen(){
      const el  = document.documentElement;
      const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
      if (req) return req.call(el);
      throw new Error("Fullscreen API not available");
    }
    async function exitTrueFullscreen(){
      const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
      const active = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
      if (active && exit) return exit.call(document);
    }

    function setBtn(on){
      if (!fsBtn) return;
      fsBtn.textContent = on ? "✕" : "⛶";
    }

    async function toggleFullscreen(){
      const on = !document.body.classList.contains("fs");
      if (on){
        document.body.classList.add("fs");            // CSS fallback immediately
        localStorage.setItem("rs_fs","1");            // remember pref
        setBtn(true);
        try { await enterTrueFullscreen(); } catch {/* ok, will auto-reenter on gesture */}
        window.scrollTo(0,0);
      } else {
        document.body.classList.remove("fs");
        localStorage.removeItem("rs_fs");
        setBtn(false);
        try { await exitTrueFullscreen(); } catch {}
      }
    }

    // ——— Auto-reenter on first *any* gesture (capture so nothing can swallow it)
    function primeAutoReenter(){
      let done = false;
      const tryEnter = () => {
        if (done) return;
        done = true;
        remove();
        enterTrueFullscreen().catch(()=>{/* ignore; user can tap FAB */});
      };
      const opts = { capture:true, once:true, passive:true };
      function remove(){
        window.removeEventListener("pointerdown", tryEnter, opts);
        window.removeEventListener("click",       tryEnter, opts);
        window.removeEventListener("touchend",    tryEnter, opts);
        window.removeEventListener("keydown",     tryEnter, opts);
      }
      window.addEventListener("pointerdown", tryEnter, opts);
      window.addEventListener("click",       tryEnter, opts);
      window.addEventListener("touchend",    tryEnter, opts);
      window.addEventListener("keydown",     tryEnter, opts);
    }

    // Wire FAB (if present)
    if (fsBtn) {
      fsBtn.type = "button";
      fsBtn.addEventListener("click", toggleFullscreen);
    }

    // Restore preference on load
    const wantFS = localStorage.getItem("rs_fs") === "1";
    if (wantFS){
      document.body.classList.add("fs");   // instant full-bleed
      setBtn(true);
      // Try immediately; if blocked by browser, re-enter on first gesture
      enterTrueFullscreen().catch(primeAutoReenter);
    } else {
      setBtn(false);
    }

    // Keep UI in sync if user hits ESC/back to leave OS fullscreen
    document.addEventListener("fullscreenchange", () => {
      const active = !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
      if (!active){
        if (localStorage.getItem("rs_fs") === "1"){
          // user prefers FS: keep CSS full-bleed; button stays "✕"
          setBtn(true);
        } else {
          document.body.classList.remove("fs");
          setBtn(false);
        }
      }
    });
  });
})();