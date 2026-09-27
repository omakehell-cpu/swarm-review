'use strict';

const { layout } = require('../lib/layout');
const { escapeHtml } = require('../lib/util');

function loginPage({ error, notice } = /** @type {{ error?: string, notice?: string }} */ ({})) {
  return layout({
    title: 'Log in',
    user: null,
    flash: notice ? { type: 'info', message: notice } : null,
    body: `
      <div class="auth-card">
        <h1>Log in</h1>
        ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
        <form method="post" action="/login">
          <label>Sign-in name<input type="text" name="username" required autofocus autocomplete="username"></label>
          <label>Password<input type="password" name="password" required autocomplete="current-password"></label>
          <button class="btn" type="submit">Log in</button>
        </form>
        <p class="muted">No account yet? <a href="/register">Register</a></p>
        <p class="muted">Forgot your password? Ask an admin for a reset link.</p>
      </div>`,
  });
}

function registerPage({ error, values = /** @type {FormValues} */ ({}) } = /** @type {{ error?: string, values?: FormValues }} */ ({})) {
  return layout({
    title: 'Register',
    user: null,
    body: `
      <div class="auth-card">
        <h1>Create an account</h1>
        ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
        <form method="post" action="/register">
          <label>Display name<input type="text" name="displayName" value="${escapeHtml(values.displayName || '')}" required></label>
          <label>Username<input type="text" name="username" value="${escapeHtml(values.username || '')}" required pattern="[a-zA-Z0-9_\\-]{3,30}" autocomplete="username"></label>
          <p class="hint">Your handle: the <code>@name</code> a note calls you by and the address of your page. It is also what you sign in with to begin with &mdash; that half you can change later, in Account.</p>
          <label>Password<input type="password" name="password" required minlength="8" autocomplete="new-password"></label>
          <label>Invite code<input type="text" name="inviteCode" value="${escapeHtml(values.inviteCode || '')}" required></label>
          <button class="btn" type="submit">Create account</button>
        </form>
        <p class="muted">Already have an account? <a href="/login">Log in</a></p>
      </div>`,
  });
}

// ---------- password reset (from an admin-generated link, see /admin) ----------

function resetPasswordPage({ token, displayName, error } = /** @type {{ token?: string, displayName?: string, error?: string }} */ ({})) {
  return layout({
    title: 'Reset password',
    user: null,
    body: `
      <div class="auth-card">
        <h1>Reset your password</h1>
        <p class="muted">Setting a new password for ${escapeHtml(displayName)}.</p>
        ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
        <form method="post" action="/reset-password/${escapeHtml(token)}">
          <label>New password<input type="password" name="password" required minlength="8" autofocus></label>
          <label>Confirm new password<input type="password" name="confirm" required minlength="8"></label>
          <button class="btn" type="submit">Set new password</button>
        </form>
      </div>`,
  });
}

function resetPasswordExpiredPage() {
  return layout({
    title: 'Reset link expired',
    user: null,
    body: `
      <div class="auth-card">
        <h1>This reset link no longer works</h1>
        <p class="muted">It may have already been used, or it's older than 24 hours. Ask an admin to generate a new one.</p>
        <p class="muted"><a href="/login">Back to login</a></p>
      </div>`,
  });
}

// ---------- stories list (dashboard) ----------

module.exports = {
  loginPage,
  registerPage,
  resetPasswordExpiredPage,
  resetPasswordPage,
};
