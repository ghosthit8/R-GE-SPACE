// fullscreen.js — robust auto-reenter across pages
(function(){
  const onReady = (fn) => {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once:true });
    } else fn();
  };

  onReady(() => {
    const fsBtn = document.getElementById("fsAppBtn"); // optional but nice
    const WANT_KEY = "rs_fs";

    const isActive = () =>
      !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);

    const setBtn = (on) => { if (fsBtn) fsBtn.textContent = on ? "✕" : "⛶"; };

    function requestFSNow(){
      const el  = document.documentElement;
      const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
      if (!req) return false;
      try {
        const ret = req.call(el);                 // may be undefined (Safari)
        if (ret && typeof ret.then === "function") {
          ret.catch(()=>{});                      // avoid unhandled rejections
        }
        return true;
      } catch { return false; }
    }

    function exitFSNow(){
      const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
      try { if (exit) exit.call(document); } catch {}
    }

    // Try to enter OS fullscreen; optionally re-check after a tick
    function tryEnterFullscreen({ verify = false } = {}){
      const invoked = requestFSNow();
      if (!verify) return invoked;
      // After a short tick, did it take?
      setTimeout(() => {
        if (!isActive()) armAutoReenter();        // fall back to gesture capture
      }, 120);
      return invoked;
    }

    // Capture-phase "first gesture anywhere" → enter fullscreen, then cleanup
    function armAutoReenter(){
      // Avoid re-arming multiple times
      if (armAutoReenter._armed) return;
      armAutoReenter._armed = true;

      const opts = { capture:true, once:false };  // non-passive to be extra safe
      const handler = () => {
        // call synchronously inside the gesture
        requestFSNow();
        // give the browser a moment to switch
        setTimeout(() => {
          if (isActive()) cleanup();
        }, 0);
      };
      function cleanup(){
        ["pointerdown","touchend","click","keydown"].forEach(type =>
          window.removeEventListener(type, handler, opts)
        );
        armAutoReenter._armed = false;
      }
      ["pointerdown","touchend","click","keydown"].forEach(type =>
        window.addEventListener(type, handler, opts)
      );
    }

    async function toggleFullscreen(){
      const goingOn = !document.body.classList.contains("fs");
      if (goingOn){
        document.body.classList.add("fs");
        localStorage.setItem(WANT_KEY, "1");
        setBtn(true);
        // Try immediately; if blocked, verification arms auto-gesture
        tryEnterFullscreen({ verify:true });
        window.scrollTo(0,0);
      } else {
        document.body.classList.remove("fs");
        localStorage.removeItem(WANT_KEY);
        setBtn(false);
        exitFSNow();
      }
    }

    if (fsBtn){
      fsBtn.type = "button";
      fsBtn.addEventListener("click", toggleFullscreen);
    }

    // Restore preference on load
    const want = localStorage.getItem(WANT_KEY) === "1";
    if (want){
      document.body.classList.add("fs"); // instant full-bleed
      setBtn(true);
      // One immediate attempt; if it doesn't "take", we arm gesture capture
      tryEnterFullscreen({ verify:true });
    } else {
      setBtn(false);
    }

    // Keep UI in sync if user ESC/back exits OS fullscreen
    document.addEventListener("fullscreenchange", () => {
      if (!isActive()){
        if (localStorage.getItem(WANT_KEY) === "1"){
          // They still want FS: keep CSS full-bleed; button stays ✕
          setBtn(true);
          // If OS FS dropped (e.g., navigation, ESC), re-arm gesture capture
          armAutoReenter();
        } else {
          document.body.classList.remove("fs");
          setBtn(false);
        }
      }
    });
  });
})();