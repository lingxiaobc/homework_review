(() => {
  'use strict';
  const form = document.getElementById('login-form');
  const button = document.getElementById('login-submit');
  const error = document.getElementById('login-error');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    button.disabled = true;
    error.hidden = true;
    try {
      const res = await fetch('api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: form.elements.username.value, password: form.elements.password.value }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message || '登录失败，请重试');
      form.elements.password.value = '';
      window.location.replace('./');
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally { button.disabled = false; }
  });
  fetch('api/auth/session').then((res) => res.json()).then((body) => {
    if (body.authenticated) window.location.replace('./');
  }).catch(() => {});
})();
