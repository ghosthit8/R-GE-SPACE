name: Supabase Edge Functions (Deploy + Keepalive)

on:
  push:
    paths:
      - "supabase/functions/**"
      - ".github/workflows/supabase-edge.yml"
  workflow_dispatch:
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
        run: |
          ls -R supabase/functions || true

      - name: 🚀 Deploy Edge Function (dynamic-task)
        run: supabase functions deploy dynamic-task --project-ref "$SUPABASE_PROJECT_REF"
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
          SUPABASE_PROJECT_REF: ${{ secrets.SUPABASE_PROJECT_REF }}

      - name: 🫀 Keepalive ping
        run: |
          set -euo pipefail
          : "${SUPABASE_URL:=${SUPABASE_FUNCTION_URL}}"
          curl -sS -X POST \
            -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
            -H "Content-Type: application/json" \
            "$SUPABASE_URL/functions/v1/dynamic-task" \
            >/dev/null || true
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_FUNCTION_URL: ${{ secrets.SUPABASE_FUNCTION_URL }}
          SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}