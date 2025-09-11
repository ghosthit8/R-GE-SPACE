document.addEventListener("DOMContentLoaded", () => {
  const fsBtn = document.getElementById("fsAppBtn");
  if (!fsBtn) return;

  async function enterTrueFullscreen(){
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (req) return req.call(el);
  }
  async function exitTrueFullscreen(){
    const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    if (document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement){
      if (exit) return exit.call(document);
    }
  }

  async function toggleFullscreen(){
    const goingOn = !document.body.classList.contains('fs');
    if (goingOn){
      document.body.classList.add('fs');
      localStorage.setItem('rs_fs','1');
      fsBtn.textContent = '✕';
      try{ await enterTrueFullscreen(); }catch{}
      window.scrollTo(0,0);
    } else {
      document.body.classList.remove('fs');
      localStorage.removeItem('rs_fs');
      fsBtn.textContent = '⛶';
      try{ await exitTrueFullscreen(); }catch{}
    }
  }

  fsBtn.addEventListener('click', toggleFullscreen);

  // Restore preference on page load
  if (localStorage.getItem('rs_fs') === '1') {
    document.body.classList.add('fs');
    fsBtn.textContent = '✕';
    enterTrueFullscreen().catch(()=>{
      // If blocked, retry on first user gesture
      const once = () => {
        enterTrueFullscreen().finally(()=>window.removeEventListener('pointerdown', once));
      };
      window.addEventListener('pointerdown', once, { once:true });
    });
  }

  // Keep state in sync if user exits OS fullscreen via ESC/back
  document.addEventListener('fullscreenchange', () => {
    const active = !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
    if (!active && localStorage.getItem('rs_fs') !== '1') {
      document.body.classList.remove('fs');
      fsBtn.textContent = '⛶';
    } else if (localStorage.getItem('rs_fs') === '1') {
      fsBtn.textContent = '✕';
    }
  });
});