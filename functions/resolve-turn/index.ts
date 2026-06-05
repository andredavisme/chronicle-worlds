// resolve-turn/index.ts  v8
// Handles all 6 player actions: exchange_information, resolve_conflict,
// introduce_conflict, exchange_material, travel, rest.
// v8 changes (Milestone 23 — Option I: rest as a real action):
//   - rest: duration 15u, applies +5 health and +2 inspiration to the actor
//     Both stats applied as attribute_modifiers and immediately written to characters row.
//     Returns stat_deltas like all other actions.
// Depends on: migrations 001–018.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DURATION_MAP: Record<string, number> = {
  exchange_information: 10,
  resolve_conflict: 7,
  introduce_conflict: 5,
  exchange_material: 3,
  rest: 15,
};

// ---------------------------------------------------------------------------
// Travel duration formula
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
// Stat delta tracking
// ---------------------------------------------------------------------------

interface StatDelta {
  attribute: string;
  delta: number;
  target_character_id: number;
}

// ---------------------------------------------------------------------------
// Attribute modifier map (single-modifier actions)
// ---------------------------------------------------------------------------

interface ModifierSpec {
  target_attribute: string;
  operator: '+' | '-';
  value: number;
  target_is_opponent?: boolean;
}

const ACTION_MODIFIERS: Record<string, ModifierSpec> = {
  exchange_information: { target_attribute: 'inspiration', operator: '+', value: 3 },
  resolve_conflict:     { target_attribute: 'health',      operator: '+', value: 3 },
  introduce_conflict:   { target_attribute: 'health',      operator: '-', value: 3, target_is_opponent: true },
  exchange_material:    { target_attribute: 'wealth',      operator: '+', value: 3 },
};

// rest is handled separately (two modifiers).

// ---------------------------------------------------------------------------
// applyOneStat — insert attribute_modifier + update character row immediately
// ---------------------------------------------------------------------------

async function applyOneStat(
  supabase: SupabaseClient,
  eventId: number,
  characterId: number,
  attribute: string,
  operator: '+' | '-',
  value: number,
  now: number
): Promise<StatDelta> {
  await supabase.from('attribute_modifiers').insert({
    source_entity_type: 'event',
    source_entity_id: eventId,
    target_entity_type: 'character',
    target_entity_id: characterId,
    target_attribute: attribute,
    operator,
    value,
    priority: 0,
    start_timestamp: now,
    end_timestamp: null,
  });

  const delta = operator === '+' ? value : -value;
  const { data: char } = await supabase
    .from('characters')
    .select(attribute)
    .eq('character_id', characterId)
    .single();

  if (char) {
    const current = (char as Record<string, number>)[attribute] ?? 0;
    await supabase
      .from('characters')
      .update({ [attribute]: current + delta })
      .eq('character_id', characterId);
  }

  return { attribute, delta, target_character_id: characterId };
}

// ---------------------------------------------------------------------------
// applyModifier — single-modifier actions (shared helper)
// ---------------------------------------------------------------------------

async function applyModifier(
  supabase: SupabaseClient,
  action: string,
  eventId: number,
  actorCharacterId: number,
  details: Record<string, number>,
  now: number,
  damageBonus: number = 0
): Promise<StatDelta | null> {
  const spec = ACTION_MODIFIERS[action];
  if (!spec) return null;

  const targetId = spec.target_is_opponent
    ? (details.target_character_id ?? actorCharacterId)
    : actorCharacterId;

  const effectiveValue = spec.value + (spec.operator === '-' ? damageBonus : 0);

  return applyOneStat(supabase, eventId, targetId, spec.target_attribute, spec.operator, effectiveValue, now);
}

// ---------------------------------------------------------------------------
// rest — +5 health, +2 inspiration to actor
// ---------------------------------------------------------------------------

async function handleRest(
  supabase: SupabaseClient,
  eventId: number,
  characterId: number,
  now: number
): Promise<StatDelta[]> {
  const healthDelta     = await applyOneStat(supabase, eventId, characterId, 'health',      '+', 5, now);
  const inspirationDelta = await applyOneStat(supabase, eventId, characterId, 'inspiration', '+', 2, now);
  return [healthDelta, inspirationDelta];
}

// ---------------------------------------------------------------------------
// z helpers
// ---------------------------------------------------------------------------

async function getCharacterZ(
  supabase: SupabaseClient,
  characterId: number
): Promise<number | null> {
  const { data } = await supabase
    .from('entity_positions')
    .select('grid_cells(z)')
    .eq('entity_type', 'character')
    .eq('entity_id', characterId)
    .is('timestamp_end', null)
    .limit(1)
    .single();
  const cell = (data as { grid_cells?: { z?: number } } | null)?.grid_cells;
  return cell?.z ?? null;
}

async function getCellZ(
  supabase: SupabaseClient,
  gridCellId: number
): Promise<number | null> {
  const { data } = await supabase
    .from('grid_cells')
    .select('z')
    .eq('grid_cell_id', gridCellId)
    .single();
  return (data as { z?: number } | null)?.z ?? null;
}

async function getConflictModifier(
  supabase: SupabaseClient,
  z: number
): Promise<number> {
  const { data } = await supabase
    .from('z_properties')
    .select('conflict_modifier')
    .eq('z_layer', z)
    .single();
  return (data as { conflict_modifier?: number } | null)?.conflict_modifier ?? 0;
}

// ---------------------------------------------------------------------------
// exchange_material
// ---------------------------------------------------------------------------

async function handleExchangeMaterial(
  supabase: SupabaseClient,
  actorCharacterId: number,
  details: Record<string, number>
): Promise<StatDelta[]> {
  const amount = Math.max(1, details.wealth_amount ?? 1);
  const targetId = details.target_character_id ?? actorCharacterId;

  if (targetId === actorCharacterId) return [];

  const { data: actor } = await supabase
    .from('characters')
    .select('wealth')
    .eq('character_id', actorCharacterId)
    .single();

  if (!actor || (actor as Record<string, number>).wealth < amount) return [];

  await supabase
    .from('characters')
    .update({ wealth: (actor as Record<string, number>).wealth - amount })
    .eq('character_id', actorCharacterId);

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

  return [
    { attribute: 'wealth', delta: -amount, target_character_id: actorCharacterId },
    { attribute: 'wealth', delta: amount,  target_character_id: targetId },
  ];
}

// ---------------------------------------------------------------------------
// travel
// ---------------------------------------------------------------------------

async function handleTravel(
  supabase: SupabaseClient,
  actorCharacterId: number,
  details: Record<string, number>,
  now: number
): Promise<string | null> {
  const destCellId = details.destination_grid_cell_id;
  if (!destCellId) return null;

  const destZ = await getCellZ(supabase, destCellId);

  if (destZ !== null) {
    const { data: charData } = await supabase
      .from('characters')
      .select('flight, breath')
      .eq('character_id', actorCharacterId)
      .single();

    const flight: number = (charData as Record<string, number> | null)?.flight ?? 0;
    const breath: number = (charData as Record<string, number> | null)?.breath ?? 0;

    if (destZ >= 1 && flight === 0) {
      return `Travel blocked: destination is air layer (z=${destZ}) but character has no flight.`;
    }
    if (destZ <= -2 && breath === 0) {
      return `Travel blocked: destination is deep water (z=${destZ}) but character has no breath.`;
    }
  }

  await supabase
    .from('entity_positions')
    .update({ timestamp_end: now })
    .eq('entity_type', 'character')
    .eq('entity_id', actorCharacterId)
    .is('timestamp_end', null);

  await supabase.from('entity_positions').insert({
    entity_type: 'character',
    entity_id: actorCharacterId,
    grid_cell_id: destCellId,
    effective_size: details.size ?? 1.0,
    occupied_units: 1,
    timestamp_start: now,
    timestamp_end: null,
  });

  return null;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
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

    // 1. Race resolution
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

    // 2. Resolve player → character
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

    // 3. Validate action and compute duration
    let duration: number;
    if (action === 'travel') {
      duration = computeTravelDuration(details);
    } else if (DURATION_MAP[action] !== undefined) {
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
    const endTimestamp: number = now + duration;

    // 4. Branch fork limit check
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

    // 5. Insert event (pending)
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

    // 6. Action-specific side effects
    const statDeltas: StatDelta[] = [];

    if (action === 'rest') {
      const deltas = await handleRest(supabase, eventId, characterId, now);
      statDeltas.push(...deltas);
    } else if (action === 'exchange_material') {
      const deltas = await handleExchangeMaterial(supabase, characterId, details);
      statDeltas.push(...deltas);
    } else if (action === 'travel') {
      const travelError = await handleTravel(supabase, characterId, details, now);
      if (travelError) {
        await supabase.from('events').delete().eq('event_id', eventId);
        return new Response(
          JSON.stringify({ error: travelError }),
          { status: 403, headers: CORS_HEADERS }
        );
      }
    } else {
      // exchange_information, resolve_conflict, introduce_conflict
      let damageBonus = 0;
      if (action === 'introduce_conflict' && details.target_character_id) {
        const actorZ  = await getCharacterZ(supabase, characterId);
        const targetZ = await getCharacterZ(supabase, details.target_character_id);
        if (actorZ !== null && targetZ !== null) {
          const actorMod  = await getConflictModifier(supabase, actorZ);
          const targetMod = await getConflictModifier(supabase, targetZ);
          damageBonus = Math.max(0, Math.floor(actorMod - targetMod));
        }
      }
      const modDelta = await applyModifier(supabase, action, eventId, characterId, details, now, damageBonus);
      if (modDelta) statDeltas.push(modDelta);
    }

    // 7. Insert chronicle entry
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

    // 8. Mark event resolved
    await supabase
      .from('events')
      .update({ resolution_state: 'resolved' })
      .eq('event_id', eventId);

    // 9. Broadcast resolved turn
    await supabase.channel('turns').send({
      type: 'broadcast',
      event: 'turn_resolved',
      payload: {
        player_id,
        character_id: characterId,
        action,
        turn_number: event.turn_number ?? null,
        duration_units: duration,
        stat_deltas: statDeltas,
      },
    });

    return new Response(
      JSON.stringify({ status: 'resolved', event_id: eventId, duration_units: duration, stat_deltas: statDeltas }),
      { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
});
