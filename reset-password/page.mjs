import { recoveryAuthOptions, readRecoveryLink, requestReset, createPasswordRecovery, invalidLinkMessage } from './auth.mjs';

const byId = id => document.getElementById(id);
const requestForm = byId('request-form');
const passwordForm = byId('password-form');
// An email link can reuse an already-open reset tab without loading a new document.
window.addEventListener('hashchange', () => {
  if (window.location.hash) window.location.reload();
});
function message(text, error = false) {
  byId('message').textContent = text;
  byId('message').classList.toggle('error', error);
  byId('message').hidden = false;
}
function requestView() {
  requestForm.hidden = false;
  passwordForm.hidden = true;
  byId('title').textContent = 'Reset your password';
  byId('description').textContent = 'Enter your email and we’ll send you a new reset link.';
}

let token;
try {
  token = readRecoveryLink(window.location.href, path => window.history.replaceState(null, '', path));
} catch (error) {
  message(error.message, true);
}

if (!window.supabase) {
  requestForm.hidden = true;
  message('Couldn’t load the password reset service. Check your connection and reload this page, or reopen the link from your email.', true);
} else {
  const { auth } = window.supabase.createClient(
    'https://qfnouotdhfltgvjhfbld.supabase.co',
    'sb_publishable_1csWLFwsCRBlVAXag1rcHQ_Jpz9t2_l',
    { auth: recoveryAuthOptions },
  );
  const savePassword = createPasswordRecovery(auth, token);
  if (token) {
    requestForm.hidden = true;
    passwordForm.hidden = false;
    byId('title').textContent = 'Choose a new password';
    byId('description').textContent = 'A fresh password, the same sleep journey. Enter your new password below.';
  }

  requestForm.addEventListener('submit', async event => {
    event.preventDefault();
    const button = requestForm.querySelector('button');
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = 'Sending…';
    try {
      await requestReset(auth, byId('email').value, window.location.origin);
      byId('title').textContent = 'Check your inbox';
      byId('description').textContent = 'If an account matches that email, a reset link is on the way. Check your spam folder too.';
      message('Open the link in your email to choose a new password.');
    } catch (error) {
      message(error.message || 'Check your connection and try again.', true);
    } finally {
      button.disabled = false;
      button.textContent = 'Send reset link →';
    }
  });

  passwordForm.addEventListener('submit', async event => {
    event.preventDefault();
    const button = passwordForm.querySelector('button');
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = 'Saving…';
    try {
      await savePassword(byId('password').value, byId('confirm-password').value);
      passwordForm.reset();
      passwordForm.hidden = true;
      byId('title').textContent = 'You’re all set.';
      byId('description').textContent = 'Your password has been updated. Log in with your new password to continue your sleep journey.';
      byId('message').hidden = true;
      byId('success-link').hidden = false;
      byId('success-link').focus();
    } catch (error) {
      message(error.message || 'Check your connection and try again.', true);
      if (error.message === invalidLinkMessage) {
        passwordForm.reset();
        requestView();
        byId('email').focus();
      }
    } finally {
      button.disabled = false;
      button.textContent = 'Save new password →';
    }
  });
}

byId('show-password').addEventListener('change', event => {
  const type = event.target.checked ? 'text' : 'password';
  byId('password').type = type;
  byId('confirm-password').type = type;
});
