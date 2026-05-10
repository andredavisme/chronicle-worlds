// proposal-form.js
// Depends on: supabase-client.js (auth + realtime init)
// Submits to: submit-proposal Edge Function
// Used by: proposal-form/index.html

import { supabase } from '../supabase-client.js';

// Read invite_id passed from invite-gate.html
const params = new URLSearchParams(window.location.search);
const inviteId = params.get('invite_id') ?? null;

// Character counter helper
export function updateCount(el, counterId) {
  document.getElementById(counterId).textContent =
    `${el.value.length} / ${el.maxLength}`;
}

// Build structured payload from form
function buildPayload(form) {
  const scope    = [...form.querySelectorAll('[name="scope"]:checked')].map(cb => cb.value);
  const concerns = [...form.querySelectorAll('[name="concern"]:checked')].map(cb => cb.value);

  return {
    dev_name:       form.devName.value,
    dev_email:      form.devEmail.value,
    dev_role:       form.devRole.value,
    dev_portfolio:  form.devPortfolio.value || null,
    status:         form.querySelector('[name="status"]:checked')?.value,
    scope,
    est_weeks:      form.estWeeks.value,
    est_cost:       form.estCost.value,
    availability:   form.estAvailability.value,
    concerns,
    comments:       form.proposalComments.value,
    internal_notes: form.internalNotes?.value || null,
    invite_id:      inviteId,
  };
}

// Submit handler
export async function handleSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const btn  = form.querySelector('.btn-submit');

  btn.disabled    = true;
  btn.textContent = 'Submitting…';

  const payload = buildPayload(form);

  const { error } = await supabase.functions.invoke('submit-proposal', {
    body: payload,
  });

  if (error) {
    btn.disabled    = false;
    btn.textContent = 'Submit Proposal →';
    showFormError('Submission failed — please try again.');
  } else {
    window.location.href = '/proposal-form/proposal-submitted.html';
  }
}

function showFormError(msg) {
  let el = document.getElementById('formError');
  if (!el) {
    el = document.createElement('p');
    el.id        = 'formError';
    el.style.cssText = 'color:#f87171;font-size:13px;margin-top:12px;text-align:center';
    document.querySelector('.form-footer').appendChild(el);
  }
  el.textContent = msg;
}
