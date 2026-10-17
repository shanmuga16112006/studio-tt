import test from 'node:test';
import assert from 'node:assert/strict';
import { renderLogin, renderShell, renderSetup, renderGenerated } from '../src/ui.js';
import { getSession, login, logout, saveTimetable, listTimetables, getTimetable } from '../src/auth.js';

const week = () => ({ MON: Array(8).fill(null), TUE: Array(8).fill(null), WED: Array(8).fill(null), THU: Array(8).fill(null), FRI: Array(8).fill(null), SAT: Array(8).fill(null) });

test('login screen shows the studio title, read-only Rpsit_admin, and a masked password', () => {
  const html = renderLogin();
  assert.match(html, /RPSIT Timetable Studio/);
  assert.match(html, /id="login-username"[^>]*value="Rpsit_admin"[^>]*readonly/);
  assert.match(html, /id="login-password"[^>]*type="password"/);
  assert.match(html, /id="login-button"/);
  assert.match(html, /id="login-error"/);
  assert.doesNotMatch(html, /rpsit123/);
});

test('shell exposes the username and a logout control without the dashboard or timetable buttons', () => {
  const html = renderShell('Rpsit_admin');
  assert.doesNotMatch(html, /id="toggle-dashboard"/);
  assert.doesNotMatch(html, /id="toggle-timetable"/);
  assert.doesNotMatch(html, /class="view-toggle/);
  assert.match(html, /Rpsit_admin/);
  assert.match(html, /id="logout-button"/);
});

test('dashboard includes the Previously Generated Timetables toggle and panel', () => {
  const html = renderSetup();
  assert.match(html, /id="history-toggle"[^>]*>Previously Generated Timetables</);
  assert.match(html, /id="history-panel"/);
  assert.match(html, /id="history-status"/);
});

test('shell exposes the sidebar history trigger and slide-out drawer', () => {
  const html = renderShell('Rpsit_admin');
  assert.match(html, /data-history-open/);
  assert.match(html, /id="history-drawer"/);
  assert.match(html, /id="history-drawer-close"/);
  assert.match(html, /id="history-drawer-status"/);
  assert.match(html, /id="history-drawer-list"/);
});

test('generated view exposes independent Save Timetable and Export PDF buttons', () => {
  const html = renderGenerated({ ...week(), className: 'AIDS' }, { metadata: {}, subjects: [], classes: ['AIDS'] }, []);
  assert.match(html, /id="save-button"[^>]*>Save Timetable</);
  assert.match(html, /id="export-button"[^>]*>Export PDF\s*</);
  assert.match(html, /id="allocate-button"/);
  assert.match(html, /id="manual-button"/);
});

function withFetch(handler, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (path, options = {}) => {
    calls.push({ path, options });
    return handler(path, options);
  };
  return Promise.resolve(fn(calls)).finally(() => { globalThis.fetch = original; });
}

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body
});

test('auth client calls the protected endpoints with same-origin credentials', async () => {
  await withFetch(
    () => jsonResponse({ authenticated: true, username: 'Rpsit_admin', timetables: [] }),
    async calls => {
      await getSession();
      await login('Rpsit_admin', 'rpsit123');
      await logout();
      await saveTimetable({ name: 'x' });
      await listTimetables();
      await getTimetable('abc');
      assert.deepEqual(calls.map(c => `${c.options.method || 'GET'} ${c.path}`), [
        'GET /api/auth/session',
        'POST /api/auth/login',
        'POST /api/auth/logout',
        'POST /api/timetables',
        'GET /api/timetables',
        'GET /api/timetables/abc'
      ]);
      assert.ok(calls.every(c => c.options.credentials === 'same-origin'));
    }
  );
});

test('auth client surfaces the backend error message', async () => {
  await withFetch(
    () => jsonResponse({ error: 'invalid_credentials', message: 'Invalid username or password. Please try again.' }, 401),
    async () => {
      await assert.rejects(() => login('Rpsit_admin', 'bad'), err => {
        assert.equal(err.status, 401);
        assert.equal(err.message, 'Invalid username or password. Please try again.');
        return true;
      });
    }
  );
});

const offline = () => { const error = new Error('Request failed (405).'); error.status = 405; throw error; };

test('login falls back to the fixed credentials when the API is unavailable', async () => {
  await withFetch(offline, async () => {
    const session = await login('Rpsit_admin', 'rpsit123');
    assert.equal(session.authenticated, true);
    assert.equal(session.username, 'Rpsit_admin');
    await assert.rejects(() => login('Rpsit_admin', 'wrong'), err => {
      assert.equal(err.status, 401);
      return true;
    });
  });
});

test('saved timetables fall back to local storage when the API is unavailable', async () => {
  await withFetch(offline, async () => {
    const created = await saveTimetable({ name: 'A · AIDS', class_name: 'AIDS', template: 'class', payload: { marker: 1 } });
    assert.ok(created.id);
    const listed = await listTimetables();
    assert.ok(listed.timetables.some(item => item.name === 'A · AIDS' && item.id === created.id));
    const opened = await getTimetable(created.id);
    assert.deepEqual(opened.payload, { marker: 1 });
    await assert.rejects(() => getTimetable('missing'), err => {
      assert.equal(err.status, 404);
      return true;
    });
  });
});
