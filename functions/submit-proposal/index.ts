// submit-proposal/index.ts
// Depends on: 003_developer_proposals migration (developer_proposals table)
// Called by: frontend/proposal-form/proposal-form.js
// Note: verify_jwt is disabled — form is publicly accessible in Phase 1.
//       In Phase 2, token validation logic should be added before insert.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400, headers: corsHeaders });
  }

  // Required field validation
  const required = ["dev_name", "dev_email", "dev_role", "status",
                    "est_weeks", "est_cost", "availability", "comments"];
  for (const field of required) {
    if (!body[field]) {
      return new Response(`Missing required field: ${field}`, { status: 400, headers: corsHeaders });
    }
  }

  // Status value validation
  const validStatuses = ["accept", "counter", "decline"];
  if (!validStatuses.includes(body.status as string)) {
    return new Response("Invalid status value", { status: 400, headers: corsHeaders });
  }

  // Phase 2: validate invite_id here before insert
  // const invite = await validateInvite(supabase, body.invite_id);
  // if (!invite.valid) return new Response(invite.reason, { status: 403 });

  const { error } = await supabase.from("developer_proposals").insert({
    dev_name:       body.dev_name,
    dev_email:      body.dev_email,
    dev_role:       body.dev_role,
    dev_portfolio:  body.dev_portfolio ?? null,
    status:         body.status,
    scope:          body.scope ?? [],
    est_weeks:      body.est_weeks,
    est_cost:       body.est_cost,
    availability:   body.availability,
    concerns:       body.concerns ?? [],
    comments:       body.comments,
    internal_notes: body.internal_notes ?? null,
    invite_id:      body.invite_id ?? null,
  });

  if (error) {
    return new Response(error.message, { status: 500, headers: corsHeaders });
  }

  return new Response(JSON.stringify({ status: "submitted" }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
