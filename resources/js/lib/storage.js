import { useEffect, useRef, useState } from "react";
import {
  api,
  getSessionUser,
  mapCertificateFromApi,
  mapCertificateToApi,
  mapEvaluationFromApi,
  mapEvaluationToApi,
  mapLogFromApi,
  mapLogToApi,
  mapRegistrationFromApi,
  mapRegistrationToApi,
  mapUserFromApi,
  mapUserToApi,
} from "./api";

/* ==========================================================================
   Persistence layer
   --------------------------------------------------------------------------
   Every admin screen edits a collection (users, events, registrations,
   certificates, announcements, evaluation responses, the audit trail...).
   The Laravel backend is the single source of truth: collections are loaded
   from /api, and every mutation is reconciled back to the API as create /
   update / delete calls. There is no hardcoded seed data on the client.
   ========================================================================== */

export const ACTIVITY_LOG_KEY = "activity-logs";

/** Map a collection key to its API resource + field mappers. */
const RESOURCE_MAP = {
  users: { resource: "user-accounts", fromApi: mapUserFromApi, toApi: mapUserToApi },
  registrations: { resource: "registrations", fromApi: mapRegistrationFromApi, toApi: mapRegistrationToApi },
  certificates: { resource: "certificates", fromApi: mapCertificateFromApi, toApi: mapCertificateToApi },
  evaluations: { resource: "evaluations", fromApi: mapEvaluationFromApi, toApi: mapEvaluationToApi },
  [ACTIVITY_LOG_KEY]: { resource: "activity-logs", fromApi: mapLogFromApi, toApi: mapLogToApi },
};

/**
 * Drop-in replacement for `useState` backed by the backend API.
 *
 * const [users, setUsers] = useCollection("users");
 * setUsers((prev) => prev.map(...));   // changed rows are PUT to the API
 * setUsers((prev) => [...prev, newRow]); // new rows are POSTed
 * setUsers((prev) => prev.filter(...));  // removed rows are DELETEd
 *
 * Pass `onError(message)` to surface API failures (toast) instead of
 * silently swallowing them. A failed mutation rolls the UI back to the
 * last committed state so the screen never shows unsaved data as saved.
 */
export function useCollection(key, onError) {
  const cfg = RESOURCE_MAP[key];
  const [rows, setRows] = useState([]);
  const committedRef = useRef([]);
  const mountedRef = useRef(true);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const fail = (err) => {
    const message = err?.payload?.message || err?.message || "Could not save. Please try again.";
    try { onErrorRef.current?.(message); } catch { /* never break UI on toast errors */ }
  };

  useEffect(() => {
    mountedRef.current = true;

    api.list(cfg.resource)
      .then((data) => {
        if (!mountedRef.current) return;
        const mapped = (Array.isArray(data) ? data : []).map(cfg.fromApi);
        committedRef.current = mapped;
        setRows(mapped);
      })
      .catch((err) => {
        if (!mountedRef.current) return;
        setRows([]);
        fail(err);
      });

    return () => {
      mountedRef.current = false;
    };
  }, [cfg]);

  /**
   * Re-read the collection from the API without going through the diff/persist
   * path.
   *
   * Needed after an action that changed rows outside this hook, for example the
   * certificate generator creating rows server-side. Calling `update()` with a
   * new array would make `reconcile` treat every row it has never seen as a
   * create and POST it a second time.
   */
  function refresh() {
    return api
      .list(cfg.resource)
      .then((data) => {
        if (!mountedRef.current) return [];
        const mapped = (Array.isArray(data) ? data : []).map(cfg.fromApi);
        committedRef.current = mapped;
        setRows(mapped);
        return mapped;
      })
      .catch((err) => {
        if (!mountedRef.current) return [];
        fail(err);
        return [];
      });
  }

  function update(updater) {
    const prev = committedRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    reconcile(cfg, prev, next, fail, (committed) => {
      committedRef.current = committed;
      setRows(committed);
    });
    committedRef.current = next;
    setRows(next);
  }

  return [rows, update, refresh];
}

/** Diff `prev` against `next` and persist the changes to the backend. */
function reconcile(cfg, prev, next, onFail, onSettled) {
  const prevById = new Map(prev.map((r) => [r.id, r]));
  const nextIdSet = new Set(next.map((r) => r.id));

  const ops = [];

  for (const prevRow of prev) {
    if (!nextIdSet.has(prevRow.id)) {
      ops.push(
        api.remove(cfg.resource, prevRow.id).catch((err) => {
          onFail(err);
          throw err;
        })
      );
    }
  }

  for (const nextRow of next) {
    const prevRow = prevById.get(nextRow.id);
    if (!prevRow) {
      ops.push(
        api.create(cfg.resource, cfg.toApi(nextRow)).catch((err) => {
          onFail(err);
          throw err;
        })
      );
    } else if (JSON.stringify(prevRow) !== JSON.stringify(nextRow)) {
      ops.push(
        api.update(cfg.resource, nextRow.id, cfg.toApi(nextRow)).catch((err) => {
          onFail(err);
          throw err;
        })
      );
    }
  }

  if (ops.length === 0) return;

  // Any failure rolls the UI back to the last server-confirmed state and
  // reloads it, so a rejected write never lingers on screen as if saved.
  Promise.allSettled(ops).then((results) => {
    if (results.some((r) => r.status === "rejected")) {
      api
        .list(cfg.resource)
        .then((data) => {
          const mapped = (Array.isArray(data) ? data : []).map(cfg.fromApi);
          onSettled(mapped);
        })
        .catch(() => onSettled(prev));
    }
  });
}

/* ------------------------------ helpers ------------------------------ */

/** Local `YYYY-MM-DD` (not UTC, so date filters and "today" agree with the user's clock). */
export function dateKey(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local `YYYY-MM-DD HH:mm:ss`, the format the Activity Logs table expects. */
export function timestampKey(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${dateKey(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Sequential id for a collection, e.g. nextId("users", "USR", 2210) -> "USR-2211".
 * Existing ids can contain extra segments (ANN-501-3), only the first number
 * after the prefix is considered.
 */
export function nextId(rows, prefix, start = 1) {
  const highest = rows.reduce((acc, row) => {
    const match = String(row?.id ?? "").match(new RegExp(`^${prefix}-(\\d+)`));
    return match ? Math.max(acc, Number(match[1])) : acc;
  }, start - 1);
  return `${prefix}-${highest + 1}`;
}

/* ------------------------------ legacy localStorage cache ------------------------------
   Kept for reference only: collections are now loaded from /api via
   useCollection above. Do not write new code against these helpers. */

const KEY_PREFIX = "tmc-eventease:";

function storageKey(key) {
  return `${KEY_PREFIX}${key}`;
}

/** Read a collection from the localStorage cache. Returns `fallback` when empty/corrupt. */
export function loadCollection(key, fallback = []) {
  try {
    const raw = window.localStorage.getItem(storageKey(key));
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

/** Write a collection to the localStorage cache. */
export function saveCollection(key, value) {
  try {
    window.localStorage.setItem(storageKey(key), JSON.stringify(value));
  } catch {
    /* Quota or private-mode errors must never break the UI. */
  }
}

/* --------------------------- audit trail --------------------------- */

/**
 * Append an entry to the shared audit trail (used by every CRUD action).
 * The Activity Logs screen reads the same collection from the API, so any
 * newly created entry is visible once that screen loads.
 */
export function logActivity({ category = "Settings", action, details = "", user, role } = {}) {
  const session = getSessionUser() || {};

  const entry = {
    timestamp: timestampKey(),
    user: user || session.name || "Admin User",
    role: role || session.role || "Admin",
    category,
    action,
    details,
  };

  api.create("activity-logs", entry).catch(() => {});

  return entry;
}