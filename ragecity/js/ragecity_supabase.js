// js/ragecity_supabase.js

// TODO: put your real project values here:
const SUPABASE_URL = "https://tuqvpcevrhciursxrgav.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1cXZwY2V2cmhjaXVyc3hyZ2F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY1MDA0NDQsImV4cCI6MjA3MjA3NjQ0NH0.JbIWJmioBNB_hN9nrLXX83u4OazV49UokvTjNB6xa_Y";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn("Supabase URL / anon key not set for Rage City.");
}

const supabaseClient =
  window.supabaseClient ||
  (window.supabaseClient = supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
  ));