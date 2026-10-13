(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const loading = $('loading');
  const loginForm = $('login-form');
  const anonymousForm = $('anonymous-form');
  const connectedState = $('connected-state');
  const message = $('message');
  const dialog = $('policy-dialog');
  const isLocalPreview = location.protocol === 'file:' || ['localhost', '127.0.0.1'].includes(location.hostname);
  const redirurl = new URLSearchParams(location.search).get('redirurl');

  $('year').textContent = new Date().getFullYear();

  function showMessage(text, kind = 'error') {
    message.textContent = text;
    message.className = kind === 'info' ? 'message info' : 'message';
    message.hidden = false;
  }

  function clearMessage() {
    message.hidden = true;
    message.textContent = '';
  }

  function showView(view) {
    loading.hidden = view !== 'loading';
    loginForm.hidden = view !== 'password';
    anonymousForm.hidden = view !== 'anonymous';
    connectedState.hidden = view !== 'connected';
    $('access-description').textContent = view === 'anonymous'
      ? 'No account needed. Review the guidelines and connect.'
      : view === 'password'
        ? 'Enter your school network credentials to continue.'
        : view === 'connected'
          ? 'Your campus Wi-Fi session is active.'
          : 'Checking how this network grants access…';
  }

  function destination() {
    if (!redirurl) return null;
    try {
      const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(redirurl) ? redirurl : `http://${redirurl}`);
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      url.searchParams.set('refresh', '');
      return url.href;
    } catch {
      return null;
    }
  }

  function showConnected(data = {}) {
    clearMessage();
    showView('connected');
    const user = typeof data.userName === 'string' ? data.userName : '';
    const ip = typeof data.ipAddress === 'string' ? data.ipAddress : '';
    $('session-details').hidden = !user && !ip;
    $('session-user-row').hidden = !user;
    $('session-ip-row').hidden = !ip;
    $('session-user').textContent = user;
    $('session-ip').textContent = ip;
    const next = destination();
    $('continue-link').href = next || 'http://neverssl.com/';
    $('continue-link').textContent = next ? 'Continue to your page →' : 'Continue browsing →';
  }

  async function portalRequest(action, fields = {}) {
    const response = await fetch(`/api/captiveportal/access/${action}/`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: new URLSearchParams(fields).toString(),
      cache: 'no-store'
    });
    if (!response.ok) throw new Error(`Portal returned ${response.status}`);
    return response.json();
  }

  async function checkStatus() {
    if (isLocalPreview) {
      showView('anonymous');
      showMessage('Local preview: accept-and-connect needs an OPNsense captive portal zone to grant internet access.', 'info');
      return;
    }
    try {
      const data = await portalRequest('status', { user: '', password: '' });
      if (data.clientState === 'AUTHORIZED') showConnected(data);
      else showView(data.authType === 'none' ? 'anonymous' : 'password');
    } catch {
      showView('password');
      showMessage('Could not check the network status. You can try signing in again.');
    }
  }

  async function signIn(event, anonymous) {
    event.preventDefault();
    const form = anonymous ? anonymousForm : loginForm;
    if (!form.reportValidity()) return;
    if (isLocalPreview) {
      showMessage('This preview cannot grant internet access. Upload the template to OPNsense to test sign-in.', 'info');
      return;
    }
    const button = anonymous ? $('anonymous-button') : $('signin-button');
    const fields = anonymous ? { user: '', password: '' } : { user: $('username').value.trim(), password: $('password').value };
    clearMessage();
    button.disabled = true;
    try {
      const data = await portalRequest('logon', fields);
      if (data.clientState === 'AUTHORIZED') {
        $('password').value = '';
        const next = destination();
        if (next) location.assign(next);
        else showConnected(data);
      } else {
        $('password').value = '';
        showMessage('Sign-in failed. Check your username and password, then try again.');
      }
    } catch {
      showMessage('The sign-in service is unavailable. Please try again or contact the school IT coordinator.');
    } finally {
      button.disabled = false;
    }
  }

  loginForm.addEventListener('submit', (event) => signIn(event, false));
  anonymousForm.addEventListener('submit', (event) => signIn(event, true));

  $('logout-button').addEventListener('click', async () => {
    if (isLocalPreview) return;
    $('logout-button').disabled = true;
    try {
      await portalRequest('logoff', { user: '', password: '' });
      clearMessage();
      await checkStatus();
    } catch {
      showMessage('Could not disconnect this device. Please try again.');
    } finally {
      $('logout-button').disabled = false;
    }
  });

  $('show-password').addEventListener('click', () => {
    const field = $('password');
    const showing = field.type === 'password';
    field.type = showing ? 'text' : 'password';
    $('show-password').textContent = showing ? 'Hide' : 'Show';
    $('show-password').setAttribute('aria-label', showing ? 'Hide password' : 'Show password');
  });

  document.querySelectorAll('[data-open-policy]').forEach((button) => button.addEventListener('click', () => dialog.showModal()));
  $('close-policy').addEventListener('click', () => dialog.close());
  $('policy-done').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });

  checkStatus();
})();
