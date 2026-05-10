import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const DURATION_MAP: Record<string, number> = {
  exchange_information: 10,
  resolve_conflict: 7,
  introduce_conflict: 5,
  exchange_material: 3,
};

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
  const inspirationBonus = inspiration > 0 ? 0.9 : 1;
  return Math.max(1, Math.round(base * charPenalty / matBonus * inspirationBonus));
}

async function applyModifiers(
  supabase: ReturnType<typeof createClient>,
  action: string,
  playerId: string,
  eventId: number,
  characterId: number,
  now: number
) {
  const modifiersByAction: Record<string, object> = {
    exchange_information: {
      target_attribute: 'inspiration',
      operator: '+',
      value: 3,
    },
    resolve_conflict: {
      target_attribute: 'health',
      operator: '+',
      value: 3,
    },
    introduce_conflict: {
      target_attribute: 'health',
      operator: '-',
      value: 3,
    },
    exchange_material: {
      target_attribute: 'wealth',
      operator: '+',
      value: 3,
    },
  };

  const mod = modifiersByAction[action];
  if (!mod) return;

  await supabase.from('attribute_modifiers').insert({
    source_entity_type: 'event',
    source_entity_id: eventId,
    target_entity_type: 'character',
    target_entity_id: characterId,
    ...mod,
    priority: 0,
    start_timestamp: now,
    end_timestamp: null,
  });
}

serve(async (req: Request) => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { action, player_id, details = {} } = await req.json();

    if (!action || !player_id) {
      return new Response(JSON.stringify({ error: 'Missing action or player_id' }), { status: 400 });
    }

    // --- 1. Check queue position ---
    const { data: queue } = await supabase
      .from('turn_queue')
      .select('queue_pos')
      .eq('player_id', player_id)
      .limit(1);

    if (queue && queue[0]?.queue_pos > 1) {
      return new Response(JSON.stringify({ status: 'queued' }), { status: 202 });
    }

    // --- 2. Resolve player's character ---
    const { data: player, error: playerErr } = await supabase
      .from('players')
      .select('controlled_character_id')
      .eq('player_id', player_id)
      .single();

    if (playerErr || !player) {
      return new Response(JSON.stringify({ error: 'Player not found' }), { status: 404 });
    }
    const characterId: number = player.controlled_character_id;

    // --- 3. Compute duration ---
    let duration: number;
    if (action === 'travel') {
      duration = computeTravelDuration(details);
    } else {
      duration = DURATION_MAP[action];
      if (!duration) {
        return new Response(JSON.stringify({ error: 'Unknown action type' }), { status: 400 });
      }
    }

    const now = Date.now() / 1000;
    const submitTimestamp: number = details.submit_timestamp ?? now;
    const sequenceIndex: number = details.sequence_index ?? 0;

    // --- 4. Check branch fork limit (time-travel backward only) ---
    if (details.branch_fork && details.parent_branch_id !== undefined) {
      const { count } = await supabase
        .from('branches')
        .select('*', { count: 'exact', head: true })
        .eq('parent_branch_id', details.parent_branch_id);

      if ((count ?? 0) >= 3) {
        return new Response(JSON.stringify({ error: 'Branch fork limit reached (max 3)' }), { status: 409 });
      }

      // Insert new branch
      await supabase.from('branches').insert({
        fork_timestamp: now,
        player_id,
        parent_branch_id: details.parent_branch_id,
      });
    }

    // --- 5. Insert event ---
    const { data: event, error: eventErr } = await supabase
      .from('events')
      .insert({
        setting_id: details.setting_id ?? null,
        age: details.age ?? 0,
        duration_units: duration,
        start_timestamp: now,
        submit_timestamp: submitTimestamp,
        sequence_index: sequenceIndex,
        event_type: action,
        resolution_state: 'pending',
        details: JSON.stringify(details),
      })
      .select()
      .single();

    if (eventErr || !event) {
      return new Response(JSON.stringify({ error: eventErr?.message ?? 'Event insert failed' }), { status: 500 });
    }

    // --- 6. Apply attribute modifiers ---
    await applyModifiers(supabase, action, player_id, event.eventid, characterId, now);

    // --- 7. Insert chronicle entry ---
    const { error: chronicleErr } = await supabase.from('chronicle').insert({
      timestamp: now,
      sequence_index: sequenceIndex,
      character_id: characterId,
      setting_id: details.setting_id ?? null,
      event_id: event.eventid,
      player_id,
      branch_id: details.branch_id ?? 0,
      submit_timestamp: submitTimestamp,
      details_json: JSON.stringify(details),
    });

    if (chronicleErr) {
      return new Response(JSON.stringify({ error: chronicleErr.message }), { status: 500 });
    }

    // --- 8. Update event resolution state ---
    await supabase
      .from('events')
      .update({ resolution_state: 'resolved' })
      .eq('eventid', event.eventid);

    // --- 9. Broadcast to Realtime ---
    await supabase.channel('turns').send({
      type: 'broadcast',
      event: 'turn_resolved',
      payload: { player_id, turn_number: event.turn_number ?? null },
    });

    return new Response(
      JSON.stringify({ status: 'resolved', event }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
