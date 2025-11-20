// js/auth-guard.js  (NO <script> tags in this file)

// 1) Import Supabase client from CDN
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// 2) Your real Supabase URL + anon key
const SUPABASE_URL = 'https://tuqvpcevrhciursxrgav.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1cXZwY2V2cmhjaXVyc3hyZ2F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY1MDA0NDQsImV4cCI6MjA3MjA3NjQ0NH0.JbIWJmioBNB_hN9nrLXX83u4OazV49UokvTjNB6xa_Y';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 3) Pages that can be visited without login
const PUBLIC_PAGES = ['index.html', 'login.html', 'signup.html'];

function getPageNameFromPath(path) {
  // Works on GitHub Pages & real domains — always extract filename
  let last = path.substring(path.lastIndexOf('/') + 1);
  if (!last || last === '') last = 'index.html';
  return last.toLowerCase();
}

function isPublicPage(pathname) {
  const current = getPageNameFromPath(pathname);
  return PUBLIC_PAGES.includes(current);
}

async function requireLoginForThisPage() {
  // If visiting a public page, just show it
  if (isPublicPage(window.location.pathname)) {
    document.body.style.display = 'block';
    return;
  }

  // Check login
  const { data } = await supabase.auth.getUser();
  const user = data?.user || null;

  if (!user) {
    // Not logged in → redirect
    window.location.href = 'index.html';
    return;
  }

  // Logged in → reveal page
  window.currentUser = user;
  document.body.style.display = 'block';
}

function setupLinkGuard() {
  document.addEventListener('click', async (e) => {
    const link = e.target.closest('a');
    if (!link) return;

    const href = link.getAttribute('href') || '';

    // Ignore non-navigation links
    if (
      href.startsWith('#') ||
      href.startsWith('mailto:') ||
      href.startsWith('tel:')
    ) {
      return;
    }

    const url = new URL(href, window.location.href);

    if (isPublicPage(url.pathname)) return;

    let user = window.currentUser;

    // If not cached, request user
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

// Hide content until login check finishes (prevents flashing protected content)
document.body.style.display = 'none';

document.addEventListener('DOMContentLoaded', () => {
  requireLoginForThisPage();
  setupLinkGuard();
});