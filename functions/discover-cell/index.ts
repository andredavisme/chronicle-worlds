import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ROOT_REALITY_ID = 1;

// ─────────────────────────────────────────────────────────────────────────────
// Procedural name generation from proc_words
// Pattern: "<impl> <source>"  e.g. "forged ice", "woven stone"
// Deterministic: seeded by setting_id mod word-list lengths
// ─────────────────────────────────────────────────────────────────────────────
async function generateSettingIdentity(
  setting_id: number
): Promise<{ name: string; description: string }> {
  const { data: words } = await supabase
    .from("proc_words")
    .select("word, category")
    .in("category", ["impl", "source"]);

  const impls = (words ?? []).filter((w) => w.category === "impl").map((w) => w.word).sort();
  const sources = (words ?? []).filter((w) => w.category === "source").map((w) => w.word).sort();

  const implWord = impls.length > 0 ? impls[setting_id % impls.length] : "unknown";
  const sourceWord = sources.length > 0 ? sources[Math.floor(setting_id / (impls.length || 1)) % sources.length] : "place";

  const name = `${implWord} ${sourceWord}`;
  const description = `A setting of ${sourceWord}, ${implWord} by time.`;

  return { name, description };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ensure entity_copy exists for a setting;
// create it if not. Returns name + description.
// ─────────────────────────────────────────────────────────────────────────────
async function ensureSettingCopy(
  setting_id: number
): Promise<{ copy_name: string; copy_description: string }> {
  const { data: existing } = await supabase
    .from("entity_copies")
    .select("name, description")
    .eq("reality_id", ROOT_REALITY_ID)
    .eq("truth_entity_type", "setting")
    .eq("truth_entity_id", setting_id)
    .maybeSingle();

  if (existing) {
    return { copy_name: existing.name ?? "", copy_description: existing.description ?? "" };
  }

  const { name, description } = await generateSettingIdentity(setting_id);

  await supabase.from("entity_copies").insert({
    reality_id: ROOT_REALITY_ID,
    truth_entity_type: "setting",
    truth_entity_id: setting_id,
    name,
    description,
    local_attributes: {},
  });

  return { copy_name: name, copy_description: description };
}

// ─────────────────────────────────────────────────────────────────────────────
// Z-scaffold check
// For z >= 1 (air): the layer directly below (z-1) must exist in this setting
//   at the same x,y column.
// For z <= -2 (deep water): the layer directly above (z+1) must exist.
// For z = 0 or z = -1: always permitted (ground / shallow water).
// Returns { permitted, reason? }
// ─────────────────────────────────────────────────────────────────────────────
async function checkZScaffold(
  x: number,
  y: number,
  z: number,
  setting_id: number
): Promise<{ permitted: boolean; reason?: string }> {
  if (z === 0 || z === -1) return { permitted: true };

  const scaffold_z = z >= 1 ? z - 1 : z + 1;

  const { data: scaffold } = await supabase
    .from("grid_cells")
    .select("grid_cell_id")
    .eq("setting_id", setting_id)
    .eq("x", x)
    .eq("y", y)
    .eq("z", scaffold_z)
    .maybeSingle();

  if (!scaffold) {
    const layerLabel = z >= 1 ? `air (z=${z})` : `deep water (z=${z})`;
    return {
      permitted: false,
      reason: `no scaffold at z=${scaffold_z} — cannot enter ${layerLabel}`,
    };
  }

  return { permitted: true };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { x: number; y: number; z: number; from_cell_id?: number };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { x, y, z, from_cell_id } = body;
  if (x === undefined || y === undefined || z === undefined) {
    return new Response(JSON.stringify({ error: "x, y, z required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 1. Check if cell already exists — if so, return immediately (no scaffold check needed)
  const { data: existing } = await supabase
    .from("grid_cells")
    .select("grid_cell_id, setting_id")
    .eq("x", x).eq("y", y).eq("z", z)
    .maybeSingle();

  if (existing) {
    const { copy_name, copy_description } = await ensureSettingCopy(existing.setting_id);
    return new Response(
      JSON.stringify({
        grid_cell_id: existing.grid_cell_id,
        setting_id: existing.setting_id,
        spawned: false,
        blocked: false,
        copy_name,
        copy_description,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // 2. Determine which setting to assign (needed before scaffold check)
  let setting_id: number;

  if (from_cell_id) {
    const { data: fromCell } = await supabase
      .from("grid_cells")
      .select("setting_id")
      .eq("grid_cell_id", from_cell_id)
      .single();

    const candidate_setting_id = fromCell?.setting_id;

    if (candidate_setting_id) {
      const { data: setting } = await supabase
        .from("settings")
        .select("setting_id, max_cells, cycle_order")
        .eq("setting_id", candidate_setting_id)
        .single();

      const { count } = await supabase
        .from("grid_cells")
        .select("grid_cell_id", { count: "exact", head: true })
        .eq("setting_id", candidate_setting_id);

      if (setting && count !== null && count < setting.max_cells) {
        setting_id = candidate_setting_id;
      } else {
        setting_id = await getOrCreateNextSetting(setting?.cycle_order ?? 1);
      }
    } else {
      setting_id = await getOrCreateRandomSetting();
    }
  } else {
    setting_id = await getOrCreateRandomSetting();
  }

  // 3. Z-scaffold check — only for vertical travel (z ≠ 0 and z ≠ -1)
  if (z !== 0 && z !== -1) {
    const { permitted, reason } = await checkZScaffold(x, y, z, setting_id);
    if (!permitted) {
      return new Response(
        JSON.stringify({ blocked: true, reason }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  // 4. Insert the new grid cell
  const { data: newCell, error: insertError } = await supabase
    .from("grid_cells")
    .insert({ x, y, z, setting_id, capacity_units: 1, expansion_state: "active" })
    .select("grid_cell_id, setting_id")
    .single();

  if (insertError || !newCell) {
    return new Response(
      JSON.stringify({ error: insertError?.message ?? "Insert failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // 5. Ensure entity_copy exists for this setting (creates if new)
  const { copy_name, copy_description } = await ensureSettingCopy(newCell.setting_id);

  return new Response(
    JSON.stringify({
      grid_cell_id: newCell.grid_cell_id,
      setting_id: newCell.setting_id,
      spawned: true,
      blocked: false,
      copy_name,
      copy_description,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});

async function getOrCreateNextSetting(current_cycle_order: number): Promise<number> {
  const { data: next } = await supabase
    .from("settings")
    .select("setting_id")
    .gt("cycle_order", current_cycle_order)
    .order("cycle_order", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (next) return next.setting_id;

  const { data: first } = await supabase
    .from("settings")
    .select("setting_id")
    .lt("cycle_order", current_cycle_order)
    .order("cycle_order", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (first) return first.setting_id;

  return await spawnNewSetting(current_cycle_order + 1);
}

async function getOrCreateRandomSetting(): Promise<number> {
  const { data: allSettings } = await supabase
    .from("settings")
    .select("setting_id");

  if (allSettings && allSettings.length > 0) {
    const pick = allSettings[Math.floor(Math.random() * allSettings.length)];
    return pick.setting_id;
  }

  return await spawnNewSetting(1);
}

async function spawnNewSetting(cycle_order: number): Promise<number> {
  const { data: maxRow } = await supabase
    .from("settings")
    .select("cycle_order")
    .order("cycle_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const next_cycle_order = maxRow ? maxRow.cycle_order + 1 : cycle_order;
  const max_cells = Math.floor(Math.random() * 14) + 7;

  const { data: newSetting, error } = await supabase
    .from("settings")
    .insert({
      time_unit: 0,
      origin_x: 0,
      origin_y: 0,
      origin_z: 0,
      max_cells,
      cycle_order: next_cycle_order,
    })
    .select("setting_id")
    .single();

  if (error || !newSetting) throw new Error(error?.message ?? "Failed to spawn setting");
  return newSetting.setting_id;
}
