// Fixed account used when the Flask API is not reachable (static hosting such
// as Live Server). When the server is available it remains the authority and
// this offline path is never used.
const FALLBACK_USERNAME = 'Rpsit_admin';
const FALLBACK_PASSWORD = 'rpsit123';

const SESSION_KEY = 'rpsit-session';
const HISTORY_KEY = 'rpsit-timetables';

let memorySession = null;
let memoryHistory = [];

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok) {
    const error = new Error((data && data.message) || `Request failed (${response.status}).`);
    error.status = response.status;
    error.code = data && data.error;
    throw error;
  }
  return data;
}

function readSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : memorySession;
  } catch {
    return memorySession;
  }
}

function writeSession(username) {
  memorySession = { authenticated: true, username };
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(memorySession)); } catch { /* storage may be blocked */ }
}

function clearSession() {
  memorySession = null;
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

function readHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return memoryHistory;
  }
}

function writeHistory(records) {
  memoryHistory = records;
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(records)); } catch { /* storage may be blocked */ }
}

function newId() {
  const random = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : Math.random().toString(36).slice(2);
  return String(random).replace(/-/g, '');
}

function saveLocalTimetable(record) {
  const payload = record.payload;
  const fingerprint = JSON.stringify([record.name, record.class_name || '', payload]);
  const created = new Date().toISOString();
  const history = readHistory();
  const duplicate = history.find(item =>
    item.fingerprint === fingerprint && (Date.now() - Date.parse(item.created_at)) <= 15000
  );
  if (duplicate) return { ...metaOf(duplicate), duplicate: true };
  const entry = {
    id: newId(),
    name: record.name,
    class_name: record.class_name || '',
    template: record.template || 'class',
    payload,
    created_at: created,
    fingerprint
  };
  writeHistory([entry, ...history]);
  return { ...metaOf(entry), duplicate: false };
}

function metaOf(entry) {
  return {
    id: entry.id,
    name: entry.name,
    class_name: entry.class_name,
    template: entry.template,
    created_at: entry.created_at
  };
}

export function getSession() {
  return api('/api/auth/session').catch(error => {
    if (error.status === 401) return { authenticated: false, username: null };
    return readSession() || { authenticated: false, username: null };
  });
}

export function login(username, password) {
  return api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })
    .then(session => {
      writeSession(session.username || username);
      return session;
    })
    .catch(error => {
      if (error.status === 401) throw error;
      if (String(username).trim() === FALLBACK_USERNAME && password === FALLBACK_PASSWORD) {
        writeSession(FALLBACK_USERNAME);
        return { authenticated: true, username: FALLBACK_USERNAME };
      }
      const invalid = new Error('Invalid username or password. Please try again.');
      invalid.status = 401;
      throw invalid;
    });
}

export function logout() {
  clearSession();
  return api('/api/auth/logout', { method: 'POST', body: '{}' })
    .catch(error => {
      if (error.status === 401) throw error;
      return { authenticated: false, username: null };
    });
}

export function saveTimetable(record) {
  return api('/api/timetables', { method: 'POST', body: JSON.stringify(record) })
    .catch(error => {
      if (error.status === 401) throw error;
      return saveLocalTimetable(record);
    });
}

export function listTimetables() {
  return api('/api/timetables')
    .catch(error => {
      if (error.status === 401) throw error;
      return { timetables: readHistory().map(metaOf) };
    });
}

export function getTimetable(id) {
  return api(`/api/timetables/${encodeURIComponent(id)}`)
    .catch(error => {
      if (error.status === 401) throw error;
      const record = readHistory().find(item => item.id === id);
      if (!record) {
        const notFound = new Error('Saved timetable not found.');
        notFound.status = 404;
        throw notFound;
      }
      return record;
    });
}
