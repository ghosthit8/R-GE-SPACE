<script>
// ===== Matchup Config (v2) =====
window.MATCHUP_CONFIG = {
  // Supabase
  supabaseUrl: "https://tuqvpcevrhciursxrgav.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1cXZwY2V2cmhjaXVyc3hyZ2F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY1MDA0NDQsImV4cCI6MjA3MjA3NjQ0NH0.JbIWJmioBNB_hN9nrLXX83u4OazV49UokvTjNB6xa_Y",

  // Edge function path that returns server time
  timerFnPath: "/functions/v1/global-timer-v2",

  // Global period and decision moments (in seconds)
  periodSecs: 100,
  decisionMarks: [80, 60, 40, 20, 0], // winners at 80/60/40/20, final at 0

  // Tables (v2)
  tables: {
    votes: "phase_votes_v2",
    winners: "winners_v2",
    advancers: "advancers_v2"
  }
};
</script>