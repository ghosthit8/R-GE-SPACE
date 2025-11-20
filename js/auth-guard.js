<script type="module">
  const PUBLIC_PAGES = ['index.html', 'login.html', 'signup.html'];

  function getPageNameFromPath(path) {
    // Always extract only the filename, works for GitHub Pages + real domains
    let last = path.substring(path.lastIndexOf('/') + 1);
    if (!last || last === '') last = 'index.html';
    return last.toLowerCase();
  }

  function isPublicPage(pathname) {
    const current = getPageNameFromPath(pathname);
    return PUBLIC_PAGES.includes(current);
  }

  async function requireLoginForThisPage() {
    if (isPublicPage(window.location.pathname)) {
      document.body.style.display = "block";
      return;
    }

    const { data } = await supabase.auth.getUser();
    const user = data?.user || null;

    if (!user) {
      window.location.href = 'index.html';
      return;
    }

    window.currentUser = user;
    document.body.style.display = "block";
  }

  function setupLinkGuard() {
    document.addEventListener('click', async (e) => {
      const link = e.target.closest('a');
      if (!link) return;

      const href = link.getAttribute('href') || '';
      if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;

      const url = new URL(href, window.location.href);
      if (isPublicPage(url.pathname)) return;

      let user = window.currentUser;
      if (!user) {
        const { data } = await supabase.auth.getUser();
        user = data?.user || null;
      }

      if (!user) {
        e.preventDefault();
        window.location.href = 'index.html';
      }
    });
  }

  // Hide content before guard finishes (prevents flashing)
  document.body.style.display = "none";

  document.addEventListener('DOMContentLoaded', () => {
    requireLoginForThisPage();
    setupLinkGuard();
  });
</script>