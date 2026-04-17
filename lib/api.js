// ============================================================
// lib/api.js — Apps Script API client
// All calls go through the single Apps Script Web App URL.
// The action is passed as a query param; the body as POST JSON.
// ============================================================

const PROXY_URL = '/api/apps-script';

function summarizeResponseText(text) {
  const raw = String(text || '').trim();
  if (!raw) return 'No response body.';
  if (/<!doctype html>|<html[\s>]/i.test(raw)) {
    return 'Received HTML instead of API JSON. Check NEXT_PUBLIC_APPS_SCRIPT_URL is a deployed Apps Script Web App /exec URL.';
  }
  return raw.slice(0, 220);
}

/**
 * Core request wrapper.
 * Apps Script requires Content-Type: text/plain to avoid CORS preflight.
 */
async function request(action, payload = {}) {
  try {
    const res = await fetch(`${PROXY_URL}?action=${encodeURIComponent(action)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const contentType = (res.headers.get('content-type') || '').toLowerCase();

    if (!res.ok) {
      const errText = await res.text();
      let message = summarizeResponseText(errText);

      // If response contains HTML, that's a critical indicator of a misconfigured endpoint
      if (/<!doctype html>|<html[\s>]/i.test(errText)) {
        message = 'Received HTML error from server. Check that NEXT_PUBLIC_APPS_SCRIPT_URL is a deployed Apps Script Web App /exec URL.';
      } else if (contentType.includes('application/json')) {
        try {
          const parsed = JSON.parse(errText);
          if (parsed?.error) message = parsed.error;
          if (parsed?.detail) message = `${message} (${parsed.detail})`;
        } catch (e) {
          // keep summarized text
        }
      }

      throw new Error(`Request failed (${res.status}): ${message}`);
    }

    if (!contentType.includes('application/json')) {
      const bodyText = await res.text();
      throw new Error(`Invalid API response: ${summarizeResponseText(bodyText)}`);
    }

    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Unknown error from Apps Script');
    return data;
  } catch (err) {
    console.error(`API ${action} failed:`, err);
    throw err;
  }
}

// ── Auth ─────────────────────────────────────────────────────

/**
 * login({ identifier, password })
 * identifier = email OR phone number
 * Returns { user: { email, phone, username, active, createdAt } }
 */
export const login = (identifier, password) =>
  request('login', { identifier, password });

/**
 * register({ email, phone, username, password })
 * email OR phone must be provided (or both)
 */
export const register = ({ email, phone, username, password }) =>
  request('register', { email, phone, username, password });

export const getUser = (identifier) =>
  request('getUser', { identifier });

/**
 * getPassword — retrieve user's password (for admin use only)
 * Returns { password, username, email, phone }
 */
export const getPassword = (identifier) =>
  request('getPassword', { identifier });

export const setActive = (identifier, active) =>
  request('setActive', { identifier, active });

/**
 * Admin: getAllUsers — fetch all users in system
 * adminUsername must be admin to access
 */
export const getAllUsers = (adminUsername) =>
  request('getAllUsers', { adminUsername });

/**
 * Admin: getAllMeetings — fetch all meetings from all users
 * adminUsername must be admin to access
 */
export const getAllMeetings = (adminUsername) =>
  request('getAllMeetings', { adminUsername });

// ── Meetings ─────────────────────────────────────────────────

/** Fetch all meetings for a user (sorted newest first) */
export const getMeetings = (username) =>
  request('getMeetings', { username });

/** Save a complete meeting record */
export const saveMeeting = (username, meeting) =>
  request('saveMeeting', { username, meeting });

/**
 * saveTranscript — call RIGHT after Deepgram finishes.
 * Creates a new row with transcript only (analysis fields blank).
 * Returns { id } — use this id to call saveAnalysis.
 */
export const saveTranscript = (username, { meetingId, title, transcript, duration, type }) =>
  request('saveTranscript', { username, meetingId, title, transcript, duration, type });

/**
 * saveAnalysis — call after OpenRouter returns.
 * Finds the row by meetingId and fills in summary/actionPoints/decisions/nextSteps.
 */
export const saveAnalysis = (username, meetingId, analysis) =>
  request('saveAnalysis', { username, meetingId, analysis });

export const updateMeeting = (username, meetingId, updates) =>
  request('updateMeeting', { username, meetingId, updates });

export const deleteMeeting = (username, meetingId) =>
  request('deleteMeeting', { username, meetingId });

// ── Pipeline logging ─────────────────────────────────────────
// Call this from the frontend at each step of the audio pipeline.
// It writes directly to the LOGS tab in Sheets.

export const pipelineLog = (username, { action, step, level = 'INFO', message, detail, latencyMs }) =>
  request('pipelineLog', { username, action, step, level, message, detail, latencyMs })
    .catch(() => { }); // Never let logging crash the main flow