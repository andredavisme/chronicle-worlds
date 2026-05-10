// resolve-turn/index.ts
// Handles all 5 player actions: exchange_information, resolve_conflict,
// introduce_conflict, exchange_material, travel.
// Depends on: 001_core_schema, 002_multiplayer_extensions migrations.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Base duration units for non-travel actions (1 unit = 1/100 of a time unit)
const DURATION_MAP: Record<string, number> = {
  exchange_information: 10,
  resolve_conflict: 7,
  introduce_conflict: 5,
  exchange_material: 3,
};

// ---------------------------------------------------------------------------
// Travel duration formula
// Inputs pulled from character + environment rows; all default to neutral 1.
// Formula: base env difficulty × char penalty ÷ mat bonus × inspiration bonus
// ---------------------------------------------------------------------------

function computeTravelDuration(details: Record<string, number>): number {
  const {
    density = 1,
    hydration = 1,
    size = 1,
    health = 1,
    durability = 1,
    implementation = 1,
    inspiration = 0,
  } = details;
  const base = (density + hydration) / 2;
  const charPenalty = size / Math.max(health, 0.1);
  const matBonus = durability * implementation;
  const inspirationBonus = inspiration > 0 ? 0.9 : 1.0;
  return Math.max(1, Math.round((base * charPenalty) / matBonus * inspirationBonus));
}

// ---------------------------------------------------------------------------
// Attribute modifier map
// For introduce_conflict the target is the *opponent* character, not the actor.
// ---------------------------------------------------------------------------

interface ModifierSpec {
  target_attribute: string;
  operator: '+' | '-';
  value: number;
  target_is_opponent?: boolean; // if true, target_entity_id = details.target_character_id
}

const ACTION_MODIFIERS: Record<string, ModifierSpec> = {
  exchange_information: { target_attribute: 'inspiration', operator: '+', value: 3 },
  resolve_conflict:     { target_attribute: 'health',      operator: '+', value: 3 },
  introduce_conflict:   { target_attribute: 'health',      operator: '-', value: 3, target_is_opponent: true },
  exchange_material:    { target_attribute: 'wealth',      operator: '+', value: 3 },
};

// ---------------------------------------------------------------------------
// Insert attribute_modifier row AND apply it immediately to the character row
// ---------------------------------------------------------------------------

async function applyModifier(
  supabase: SupabaseClient,
  action: string,
  eventId: number,
  actorCharacterId: number,
  details: Record<string, number>,
  now: number
) {
  const spec = ACTION_MODIFIERS[action];
  if (!spec) return;

  const targetId = spec.target_is_opponent
    ? (details.target_character_id ?? actorCharacterId)
    : actorCharacterId;

  // Record the modifier
  await supabase.from('attribute_modifiers').insert({
    source_entity_type: 'event',
    source_entity_id: eventId,
    target_entity_type: 'character',
    target_entity_id: targetId,
    target_attribute: spec.target_attribute,
    operator: spec.operator,
    value: spec.value,
    priority: 0,
    start_timestamp: now,
    end_timestamp: null,
  });

  // Apply modifier immediately to the character row
  const delta = spec.operator === '+' ? spec.value : -spec.value;
  const { data: char } = await supabase
    .from('characters')
    .select(spec.target_attribute)
    .eq('character_id', targetId)
    .single();

  if (char) {
    const current = (char as Record<string, number>)[spec.target_attribute] ?? 0;
    await supabase
      .from('characters')
      .update({ [spec.target_attribute]: current + delta })
      .eq('character_id', targetId);
  }
}

// ---------------------------------------------------------------------------
// exchange_material: transfer wealth from actor to target (or vice-versa)
// details.wealth_amount defaults to 1; details.target_character_id required
// ---------------------------------------------------------------------------

async function handleExchangeMaterial(
  supabase: SupabaseClient,
  actorCharacterId: number,
  details: Record<string, number>
) {
  const amount = Math.max(1, details.wealth_amount ?? 1);
  const targetId = details.target_character_id ?? actorCharacterId;

  if (targetId === actorCharacterId) return; // no-op if no target specified

  // Deduct from actor
  const { data: actor } = await supabase
    .from('characters')
    .select('wealth')
    .eq('character_id', actorCharacterId)
    .single();

  if (!actor || (actor as Record<string, number>).wealth < amount) return; // insufficient wealth

  await supabase
    .from('characters')
    .update({ wealth: (actor as Record<string, number>).wealth - amount })
    .eq('character_id', actorCharacterId);

  // Add to target
  const { data: target } = await supabase
    .from('characters')
    .select('wealth')
    .eq('character_id', targetId)
    .single();

  if (target) {
    await supabase
      .from('characters')
      .update({ wealth: (target as Record<string, number>).wealth + amount })
      .eq('character_id', targetId);
  }
}

// ---------------------------------------------------------------------------
// travel: close old entity_position, open new one at destination grid cell
// details.destination_grid_cell_id required
// ---------------------------------------------------------------------------

async function handleTravel(
  supabase: SupabaseClient,
  actorCharacterId: number,
  details: Record<string, number>,
  now: number
) {
  const destCellId = details.destination_grid_cell_id;
  if (!destCellId) return;

  // Close current open position
  await supabase
    .from('entity_positions')
    .update({ timestamp_end: now })
    .eq('entity_type', 'character')
    .eq('entity_id', actorCharacterId)
    .is('timestamp_end', null);

  // Open new position at destination
  await supabase.from('entity_positions').insert({
    entity_type: 'character',
    entity_id: actorCharacterId,
    grid_cell_id: destCellId,
    effective_size: details.size ?? 1.0,
    occupied_units: 1,
    timestamp_start: now,
    timestamp_end: null,
  });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { action, player_id, details = {} } = await req.json();

    if (!action || !player_id) {
      return new Response(
        JSON.stringify({ error: 'Missing action or player_id' }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // ------------------------------------------------------------------
    // 1. Race resolution — check queue position
    // ------------------------------------------------------------------
    const { data: queue } = await supabase
      .from('turn_queue')
      .select('queue_pos')
      .eq('player_id', player_id)
      .limit(1);

    if (queue && queue[0]?.queue_pos > 1) {
      return new Response(
        JSON.stringify({ status: 'queued' }),
        { status: 202, headers: CORS_HEADERS }
      );
    }

    // ------------------------------------------------------------------
    // 2. Resolve player → character
    // ------------------------------------------------------------------
    const { data: player, error: playerErr } = await supabase
      .from('players')
      .select('controlled_character_id')
      .eq('player_id', player_id)
      .single();

    if (playerErr || !player) {
      return new Response(
        JSON.stringify({ error: 'Player not found' }),
        { status: 404, headers: CORS_HEADERS }
      );
    }
    const characterId: number = player.controlled_character_id;

    // ------------------------------------------------------------------
    // 3. Validate action and compute duration
    // ------------------------------------------------------------------
    let duration: number;
    if (action === 'travel') {
      duration = computeTravelDuration(details);
    } else if (DURATION_MAP[action]) {
      duration = DURATION_MAP[action];
    } else {
      return new Response(
        JSON.stringify({ error: `Unknown action: ${action}` }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const now = Date.now() / 1000;
    const submitTimestamp: number = details.submit_timestamp ?? now;
    const sequenceIndex: number = details.sequence_index ?? 0;
    const endTimestamp: number = now + duration; // duration units map 1:1 to seconds for simplicity

    // ------------------------------------------------------------------
    // 4. Branch fork limit check (time travel backward)
    // ------------------------------------------------------------------
    if (details.branch_fork && details.parent_branch_id !== undefined) {
      const { count } = await supabase
        .from('branches')
        .select('*', { count: 'exact', head: true })
        .eq('parent_branch_id', details.parent_branch_id);

      if ((count ?? 0) >= 3) {
        return new Response(
          JSON.stringify({ error: 'Branch fork limit reached (max 3)' }),
          { status: 409, headers: CORS_HEADERS }
        );
      }

      await supabase.from('branches').insert({
        fork_timestamp: now,
        player_id,
        parent_branch_id: details.parent_branch_id,
      });
    }

    // ------------------------------------------------------------------
    // 5. Insert event (pending)
    // ------------------------------------------------------------------
    const { data: event, error: eventErr } = await supabase
      .from('events')
      .insert({
        setting_id: details.setting_id ?? null,
        age: details.age ?? 0,
        duration_units: duration,
        start_timestamp: now,
        end_timestamp: endTimestamp,
        submit_timestamp: submitTimestamp,
        sequence_index: sequenceIndex,
        event_type: action,
        resolution_state: 'pending',
        details: JSON.stringify(details),
      })
      .select('event_id, turn_number')
      .single();

    if (eventErr || !event) {
      return new Response(
        JSON.stringify({ error: eventErr?.message ?? 'Event insert failed' }),
        { status: 500, headers: CORS_HEADERS }
      );
    }

    const eventId: number = event.event_id;

    // ------------------------------------------------------------------
    // 6. Action-specific side effects
    // ------------------------------------------------------------------
    if (action === 'exchange_material') {
      await handleExchangeMaterial(supabase, characterId, details);
    } else if (action === 'travel') {
      await handleTravel(supabase, characterId, details, now);
    }

    // Apply attribute modifier (all non-travel actions)
    if (action !== 'travel') {
      await applyModifier(supabase, action, eventId, characterId, details, now);
    }

    // ------------------------------------------------------------------
    // 7. Insert chronicle entry
    // ------------------------------------------------------------------
    const { error: chronicleErr } = await supabase.from('chronicle').insert({
      timestamp: now,
      sequence_index: sequenceIndex,
      character_id: characterId,
      setting_id: details.setting_id ?? null,
      event_id: eventId,
      player_id,
      branch_id: details.branch_id ?? 0,
      submit_timestamp: submitTimestamp,
      details_json: JSON.stringify(details),
    });

    if (chronicleErr) {
      return new Response(
        JSON.stringify({ error: chronicleErr.message }),
        { status: 500, headers: CORS_HEADERS }
      );
    }

    // ------------------------------------------------------------------
    // 8. Mark event resolved
    // ------------------------------------------------------------------
    await supabase
      .from('events')
      .update({ resolution_state: 'resolved' })
      .eq('event_id', eventId);

    // ------------------------------------------------------------------
    // 9. Broadcast resolved turn to all clients
    // ------------------------------------------------------------------
    await supabase.channel('turns').send({
      type: 'broadcast',
      event: 'turn_resolved',
      payload: {
        player_id,
        character_id: characterId,
        action,
        turn_number: event.turn_number ?? null,
        duration_units: duration,
      },
    });

    return new Response(
      JSON.stringify({ status: 'resolved', event_id: eventId, duration_units: duration }),
      { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
});
