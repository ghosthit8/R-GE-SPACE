<script type="module">
  // ⬇️ If you already create your Supabase client elsewhere (services.js),
  // just make sure that file is loaded BEFORE this one, and remove this block.
  // const supabase = window.supabaseClient || createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const PUBLIC_PAGES = ['index.html', 'login.html', 'signup.html'];

  function getPageNameFromPath(path) {
    const parts = path.split('/');
    let last = parts[parts.length - 1];
    if (!last || last === '') last = 'index.html'; // root "/"
    return last.toLowerCase();
  }

  function isPublicPage(pathname) {
    const current = getPageNameFromPath(pathname);
    return PUBLIC_PAGES.includes(current);
  }

  async function requireLoginForThisPage() {
    // If this page is public, do nothing
    if (isPublicPage(window.location.pathname)) return;

    // Check auth with Supabase
    const { data, error } = await supabase.auth.getUser();
    const user = data?.user || null;

    if (!user) {
      // Not logged in → kick to landing/login
      window.location.href = 'index.html';
    } else {
      // Store globally so we can use it in link guard, UI, etc.
      window.currentUser = user;
    }
  }

  // Optional: block clicks to protected pages if user is not logged in
  function setupLinkGuard() {
    document.addEventListener('click', async (e) => {
      const link = e.target.closest('a');
      if (!link) return;

      // Allow normal behavior for anchors with href like "#something"
      const href = link.getAttribute('href') || '';
      if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;

      // Figure out if the target page is public or not
      const url = new URL(href, window.location.href);
      if (isPublicPage(url.pathname)) return; // public page, allow it

      // If we already know the user, use that
      let user = window.currentUser;

      // If we don't know yet, ask Supabase once
      if (!user) {
        const { data } = await supabase.auth.getUser();
        user = data?.user || null;
      }

      if (!user) {
        e.preventDefault();
        alert('You must be logged in to use Rage Space.');
      }
    });
  }

  // Run on load
  document.addEventListener('DOMContentLoaded', () => {
    requireLoginForThisPage();
    setupLinkGuard();
  });
</script>