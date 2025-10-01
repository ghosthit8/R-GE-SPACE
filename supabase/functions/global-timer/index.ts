// supabase/functions/global-timer/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseKey);

serve(async (req) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("tournament_state")
        .select("phase_end_at, period_sec, paused")
        .eq("id", 1)
        .single();
      if (error) throw error;

      return new Response(JSON.stringify({ state: data }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (req.method === "POST") {
      const body = await req.json();
      let update: Record<string, any> = {};

      if (body.action === "pause") {
        update.paused = true;
      } else if (body.action === "resume") {
        update.paused = false;
      } else if (body.action === "next") {
        // jump forward one phase
        const { data } = await supabase
          .from("tournament_state")
          .select("period_sec")
          .eq("id", 1)
          .single();
        const period = data?.period_sec ?? 10;
        update.phase_end_at = new Date(Date.now() + period * 1000).toISOString();
      }

      const { data, error } = await supabase
        .from("tournament_state")
        .update(update)
        .eq("id", 1)
        .select()
        .single();

      if (error) throw error;
      return new Response(JSON.stringify({ state: data }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    return new Response("Method not allowed", { status: 405 });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};