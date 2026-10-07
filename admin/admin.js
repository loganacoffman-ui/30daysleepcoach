import { adminAuthOptions, signInAdminWithGoogle, restoreAdminSession } from './auth.mjs';
import { matchesState, filterInventory, stepLabels, concernLabels } from './inventory.mjs';
const ADMIN_SUPABASE_URL = 'https://qfnouotdhfltgvjhfbld.supabase.co';
const ADMIN_PUBLIC_KEY = 'sb_publishable_1csWLFwsCRBlVAXag1rcHQ_Jpz9t2_l';
const adminClient = supabase.createClient(ADMIN_SUPABASE_URL, ADMIN_PUBLIC_KEY, {
  auth: adminAuthOptions(sessionStorage),
});
const byId = id => document.getElementById(id);
const form = byId('scenario-form');
let domain = 'example.test';
let pending;
let busy = false;
let inventory = [];
let inventoryPage = 0;
let inventoryHasMore = false;
const presets = {
  week: { emailConfirmed: true, onboardingStep: 'complete', checkinCount: 7, trend: 'improving' },
  new: { emailConfirmed: false, onboardingStep: 'intro', checkinCount: 0, trend: 'mixed' },
  onboarding: { emailConfirmed: true, onboardingStep: 'followup', checkinCount: 0, trend: 'mixed' },
  ready: { emailConfirmed: true, onboardingStep: 'complete', checkinCount: 0, trend: 'improving' },
  month: { emailConfirmed: true, onboardingStep: 'complete', checkinCount: 30, trend: 'mixed' },
};
function message(text, error = false) {
  byId('message').textContent = text;
  byId('message').classList.toggle('error', error);
}
function showWorkspace(show) {
  byId('workspace').hidden = !show;
  byId('login-panel').hidden = show;
  byId('logout').hidden = !show;
  if (!show) {
    inventory = [];
    byId('accounts').replaceChildren();
    form.elements.password.value = '';
    byId('generated-password').textContent = '';
    byId('generated-password').hidden = true;
    byId('confirm-dialog').close();
    pending = undefined;
  }
}
async function api(body) {
  const { data: { session } } = await adminClient.auth.getSession();
  if (!session) throw new Error('Sign in to continue.');
  const response = await fetch(`${ADMIN_SUPABASE_URL}/functions/v1/admin-test-users`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ADMIN_PUBLIC_KEY, Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
  let result;
  try { result = await response.json(); } catch { throw new Error('The admin service is unavailable. Check that its migration and function are deployed.'); }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      await adminClient.auth.signOut({ scope: 'local' });
      showWorkspace(false);
    }
    throw new Error(result.error ?? 'The request failed.');
  }
  return result;
}
async function run(action) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('button').forEach(button => { button.disabled = true; });
  try { await action(); } catch (error) { message(error.message ?? 'Something went wrong.', true); }
  finally {
    busy = false;
    document.querySelectorAll('button').forEach(button => { button.disabled = false; });
  }
}
function options() {
  const value = name => form.elements[name].value;
  return {
    emailConfirmed: value('emailConfirmed') === 'true', onboardingStep: value('onboardingStep'),
    primaryConcern: value('primaryConcern'), followUpAnswer: value('followUpAnswer'),
    bedtime: value('bedtime'), wakeTime: value('wakeTime'), reminderTime: value('reminderTime'), timezone: value('timezone'),
    scheduleVaries: form.elements.scheduleVaries.checked,
    checkinCount: Number(value('checkinCount')), trend: value('trend'),
    feedback: form.elements.feedback.checked, includeToday: form.elements.includeToday.checked,
  };
}
function followUpChoices() {
  const behavior = ['unrefreshed', 'irregular_schedule'].includes(form.elements.primaryConcern.value);
  const choices = behavior ? [['scrolling_in_bed', 'Scrolling in bed'], ['trying_to_sleep', 'Trying to sleep'], ['varies', 'Varies']]
    : [['under_30', 'Under 30 minutes'], ['30_to_60', '30–60 minutes'], ['over_60', 'Over an hour']];
  form.elements.followUpAnswer.replaceChildren(...choices.map(([value, label]) => new Option(label, value)));
  form.elements.followUpAnswer.value = behavior ? 'trying_to_sleep' : '30_to_60';
}
function onboardingChanged() {
  const complete = form.elements.onboardingStep.value === 'complete';
  form.elements.checkinCount.disabled = !complete;
  if (!complete) form.elements.checkinCount.value = '0';
}
function emailPreview() {
  byId('email-preview').textContent = `sleepcoach-test+${form.elements.alias.value || 'your-test-name'}@${domain}`;
}
function ask(action, user) {
  pending = { action, userId: user.user_id, options: action === 'reset' ? options() : undefined };
  byId('confirm-title').textContent = action === 'reset' ? 'Reset this test account?' : 'Delete this test account?';
  byId('confirm-description').textContent = action === 'reset'
    ? `${user.email}: replace all app history and coaching memory with ${pending.options.checkinCount} check-ins, onboarding “${pending.options.onboardingStep}”, and ${pending.options.emailConfirmed ? 'confirmed' : 'unconfirmed'} email. The password stays the same. Sign out of the test app first.`
    : `Permanently delete ${user.email}, its app data, and coaching memory.`;
  byId('confirm-email').value = '';
  byId('confirm-email').placeholder = user.email;
  byId('confirm-action').textContent = action === 'reset' ? 'Reset test account' : 'Delete test account';
  byId('confirm-dialog').showModal();
}
function renderInventory() {
  const scenario = options();
  const matches = inventory.filter(user => matchesState(user, scenario));
  byId('reuse-hint').textContent = matches.length
    ? `${matches.length} existing account${matches.length === 1 ? ' matches' : 's match'} this state. Check the inventory before creating another.`
    : `No matching account in the loaded inventory.${inventoryHasMore ? ' Load more to check older accounts.' : ''}`;
  const visible = filterInventory(inventory, scenario, {
    search: byId('inventory-search').value,
    confirmation: byId('filter-confirmation').value,
    onboarding: byId('filter-onboarding').value,
    matchesOnly: byId('filter-matches').checked,
  });
  byId('inventory-summary').textContent = `${visible.length} shown · ${inventory.length} loaded · ${matches.length} match selected state${inventoryHasMore ? ' · More accounts available' : ''}`;
  byId('load-more').hidden = !inventoryHasMore;
  byId('accounts').replaceChildren();
  if (!visible.length) {
    const empty = document.createElement('p');
    empty.textContent = inventory.length ? 'No accounts match these filters.' : 'No test accounts yet. Choose a preset to create your first one.';
    byId('accounts').append(empty);
  }
  for (const user of visible) {
    const article = document.createElement('article'); article.className = 'account';
    const name = document.createElement('strong'); name.textContent = user.email;
    article.append(name);
    if (matchesState(user, scenario)) {
      const badge = document.createElement('span'); badge.className = 'badge inventory-match'; badge.textContent = 'MATCHES SELECTED STATE'; article.append(badge);
    }
    const state = document.createElement('p');
    state.textContent = `${user.email_confirmed ? 'Email confirmed' : 'Email unconfirmed'} · Onboarding: ${stepLabels[user.onboarding_step] ?? 'Unknown'} · ${user.checkin_count} check-ins · ${user.feedback_count} coaching reports · ${user.status}`;
    const profile = document.createElement('p');
    profile.textContent = `${concernLabels[user.primary_concern] ?? 'No concern selected'} · ${user.typical_bedtime?.slice(0, 5) ?? '—'}–${user.typical_wake_time?.slice(0, 5) ?? '—'} · ${user.timezone ?? 'No time zone'}`;
    const activity = document.createElement('p');
    const date = value => value ? new Date(value).toLocaleString() : 'Never';
    activity.textContent = `Created: ${date(user.created_at)} · Last sign-in: ${date(user.last_sign_in_at)} · Latest check-in: ${user.last_checkin_date ?? 'None'}`;
    const actions = document.createElement('div'); actions.className = 'actions';
    const copy = document.createElement('button'); copy.textContent = 'Copy email';
    copy.addEventListener('click', () => run(async () => {
      await navigator.clipboard.writeText(user.email);
      message('Test email copied. Use the password saved when you created this account to sign in.');
    }));
    actions.append(copy);
    if (user.manageable) {
      for (const [action, label] of [['reset', 'Reset to scenario'], ['delete', 'Delete']]) {
        const button = document.createElement('button'); button.textContent = label;
        if (action === 'delete') button.className = 'danger';
        button.addEventListener('click', () => ask(action, user)); actions.append(button);
      }
    } else {
      const warning = document.createElement('p'); warning.textContent = 'Protected account details changed. Reset and delete are blocked.'; article.append(warning);
    }
    article.append(state, profile, activity, actions); byId('accounts').append(article);
  }
}
async function refresh(append = false) {
  const page = append ? inventoryPage + 1 : 0;
  const result = await api({ action: 'list', page });
  domain = result.domain;
  emailPreview();
  inventory = [...new Map([...(append ? inventory : []), ...result.users].map(user => [user.user_id, user])).values()];
  inventoryPage = page;
  inventoryHasMore = result.hasMore;
  renderInventory();
}
byId('google-login').addEventListener('click', () => run(async () => {
  message('Opening Google sign-in…');
  await signInAdminWithGoogle(adminClient.auth, window.location.origin);
}));
byId('login-form').addEventListener('submit', event => {
  event.preventDefault(); run(async () => {
    const login = event.target;
    const { error } = await adminClient.auth.signInWithPassword({ email: login.elements.email.value.trim(), password: login.elements.password.value });
    login.elements.password.value = '';
    if (error) throw new Error('Sign-in failed. Check your email and password.');
    try { await refresh(); } catch (error) {
      await adminClient.auth.signOut({ scope: 'local' }); showWorkspace(false); throw error;
    }
    showWorkspace(true); message('Signed in to admin.');
  });
});
byId('logout').addEventListener('click', () => run(async () => {
  await adminClient.auth.signOut({ scope: 'local' }); showWorkspace(false); message('Signed out of admin.');
}));
byId('refresh').addEventListener('click', () => run(() => refresh()));
byId('load-more').addEventListener('click', () => run(() => refresh(true)));
for (const id of ['inventory-search', 'filter-confirmation', 'filter-onboarding', 'filter-matches']) {
  byId(id).addEventListener('input', renderInventory);
}
form.addEventListener('input', renderInventory);
form.addEventListener('change', renderInventory);
byId('preset').addEventListener('change', event => {
  for (const [key, value] of Object.entries(presets[event.target.value])) form.elements[key].value = String(value);
  onboardingChanged();
  renderInventory();
});
form.elements.primaryConcern.addEventListener('change', followUpChoices);
form.elements.onboardingStep.addEventListener('change', onboardingChanged);
form.elements.alias.addEventListener('input', emailPreview);
form.elements.password.addEventListener('input', () => {
  byId('generated-password').textContent = ''; byId('generated-password').hidden = true;
});
byId('generate-password').addEventListener('click', () => {
  const password = `Sc!${Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('')}`;
  form.elements.password.value = password;
  byId('generated-password').textContent = password; byId('generated-password').hidden = false;
});
form.addEventListener('submit', event => {
  event.preventDefault(); run(async () => {
    message('Creating test account…');
    const result = await api({ action: 'create', alias: form.elements.alias.value, password: form.elements.password.value, options: options() });
    message(`Created ${result.email}. Save your test password before leaving this page.`);
    await refresh();
  });
});
byId('cancel-confirm').addEventListener('click', () => { byId('confirm-dialog').close(); pending = undefined; });
byId('confirm-form').addEventListener('submit', event => {
  event.preventDefault();
  const operation = pending;
  if (!operation) return;
  const confirmEmail = byId('confirm-email').value;
  byId('confirm-dialog').close(); pending = undefined;
  run(async () => {
    message(operation.action === 'reset' ? 'Resetting test account…' : 'Deleting test account…');
    const result = await api({ ...operation, confirmEmail });
    message(`${operation.action === 'reset' ? 'Reset' : 'Deleted'} ${result.email}.`);
    await refresh();
  });
});
adminClient.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') showWorkspace(false); });
followUpChoices(); emailPreview();
run(async () => {
  const authorized = await restoreAdminSession(
    adminClient.auth, window.location.href,
    path => window.history.replaceState(null, '', path),
    () => refresh(),
  );
  if (authorized) { showWorkspace(true); message('Signed in to admin.'); }
});
