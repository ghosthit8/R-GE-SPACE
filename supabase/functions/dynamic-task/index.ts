name: Supabase Edge Functions (Deploy + Keepalive)

on:
  push:
    paths:
      - "supabase/functions/**"
      - ".github/workflows/supabase-edge.yml"
  workflow_dispatch:
  # Optional: keep the function warm / advance rounds even if no one has the page open
  schedule:
    - cron: "*/2 * * * *"

permissions:
  contents: read

concurrency:
  group: supabase-edge
  cancel-in-progress: true

jobs:
  deploy_and_keepalive:
    runs-on: ubuntu-latest
    timeout-minutes: 5

    steps:
      - name: ⬇️ Check out repo
        uses: actions/checkout@v4

      - name: 🧰 Install Supabase CLI
        uses: supabase/setup-cli@v1

      - name: 🗂️ Show functions tree (debug)
        run: ls -R supabase/functions || true

      # Assert secrets exist (prints only lengths; values stay masked)
      - name: 🔎 Assert required secrets
        run: |
          pr="${{ secrets.SUPABASE_PROJECT_REF }}"
          at="${{ secrets.SUPABASE_ACCESS_TOKEN }}"
          [ -n "$pr" ] || { echo "❌ SUPABASE_PROJECT_REF is missing"; exit 1; }
          [ -n "$at" ] || { echo "❌ SUPABASE_ACCESS_TOKEN is missing"; exit 1; }
          echo "Project ref length: $(printf "%s" "$pr" | wc -c)"

      # —— Deploy the function named *dynamic-task* ——
      - name: 🚀 Deploy Edge Function (dynamic-task)
        run: |
          supabase functions deploy dynamic-task \
            --project-ref "${{ secrets.SUPABASE_PROJECT_REF }}" \
            --debug
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}

      # Keepalive ping (idempotent). Uses ANON key; safe when timer is live.
      - name: 🫀 Keepalive ping
        run: |
          set -euo pipefail
          URL="${{ secrets.SUPABASE_URL }}"
          if [ -z "$URL" ]; then URL="${{ secrets.SUPABASE_FUNCTION_URL }}"; fi
          if [ -z "$URL" ]; then echo "ℹ️ No SUPABASE_URL/FUNCTION_URL secret; skipping ping"; exit 0; fi
          curl -sS -X POST \
            -H "Authorization: Bearer ${{ secrets.SUPABASE_ANON_KEY }}" \
            -H "Content-Type: application/json" \
            "$URL/functions/v1/dynamic-task" >/dev/null || true