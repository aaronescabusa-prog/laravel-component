import axios from "axios";

// Thin client for the Laravel backend served from the same origin.
// The backend sits beside this page rather than at the server root, so the
// mount point is read from the <meta name="app-base"> tag that app.blade.php
// renders. Under XAMPP that is "/laravel-component/public"; with
// `php artisan serve` it is "" and every URL below falls back to the root.
// A meta tag is used rather than an inline script because the production
// Content-Security-Policy sets script-src 'self' and blocks inline scripts.
// Override with VITE_API_URL.
const readAppBase = () => {
    const meta = typeof document !== "undefined" && document.querySelector('meta[name="app-base"]');
    return (meta?.getAttribute("content") || "").replace(/\/+$/, "");
};

export const APP_BASE = readAppBase();

export const API_BASE = (import.meta.env.VITE_API_URL || `${APP_BASE}/api`).replace(/\/+$/, "");

export const EVENT_STATUSES = ["Draft", "Pending", "Approved", "Rejected", "Completed", "Cancelled"];
export const ANNOUNCEMENT_AUDIENCES = ["All Users", "Students"];
export const ANNOUNCEMENT_CATEGORIES = ["General", "Event", "Emergency", "Maintenance"];
export const ANNOUNCEMENT_STATUSES = ["Draft", "Scheduled", "Published"];
export const USER_ROLES = ["Admin", "Student", "Scanner"];
export const REGISTRATION_ROLES = ["Admin", "Student"];
export const EVENT_TARGET_ROLES = ["All", "Admin", "Student"];

export const TOKEN_KEY = "tmc_token";
export const USER_KEY = "tmc_user";

// The bearer token is kept in memory and mirrored into sessionStorage, not
// localStorage. sessionStorage is scoped to the tab and is dropped when it
// closes, so the token does not outlive the browsing session or sit on disk
// where any later script on the origin can read it. The in-memory copy is what
// requests actually use, so once this tab's script context is gone the token is
// unrecoverable even if sessionStorage survives.
let memoryToken = null;

export function getToken() {
  if (memoryToken) return memoryToken;

  try {
    memoryToken = window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    // Private mode or a blocked storage partition: fall back to memory only.
    memoryToken = null;
  }

  return memoryToken;
}

export function setSession(token, user) {
  if (token) {
    memoryToken = token;
    try {
      window.sessionStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* memory-only session is still usable */
    }
  }

  if (user) {
    try {
      window.sessionStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch {
      /* ignore */
    }
  }

  try {
    window.localStorage.setItem("tmc_last_login", new Date().toLocaleString());
  } catch {
    /* ignore */
  }
}

export function getSessionUser() {
  try {
    const raw = window.sessionStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearSession() {
  memoryToken = null;

  try {
    window.sessionStorage.removeItem(TOKEN_KEY);
    window.sessionStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }

  // Remove tokens left in localStorage by an earlier version so an upgrade does
  // not leave a long-lived credential readable on the origin.
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

async function request(path, options = {}) {
  const { body, data = body, method = "GET", ...config } = options;
  const headers = { Accept: "application/json", ...(config.headers || {}) };
  if (data !== undefined && !(data instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const response = await axios({ ...config, url: `${API_BASE}${path}`, method, data, headers });
    return response.status === 204 ? null : response.data;
  } catch (cause) {
    const response = cause.response;
    const payload = response?.data;
    if (response?.status === 401 && !path.startsWith("/auth/login")) {
      clearSession();
      const loginPath = `${APP_BASE}/login`;
      if (!window.location.pathname.startsWith(loginPath)) window.location.assign(loginPath);
    }
    const detail = payload?.errors
      ? Object.entries(payload.errors).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`).join("; ")
      : payload?.message || response?.statusText || cause.message;
    const error = new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    if (payload && typeof payload === "object") {
      if (typeof payload.status === "string") error.status = payload.status;
      error.payload = payload;
    }
    error.httpStatus = response?.status;
    throw error;
  }
}

/**
 * Follow Laravel pagination links until every page has been collected.
 *
 * Two server behaviours have to be handled here:
 *
 * 1. The server caps `per_page`, so asking for "everything" is a multi-page
 *    walk rather than one oversized request. Without this the client would
 *    silently receive only the first page.
 * 2. Laravel's `next_page_url` carries only `?page=N`; it does NOT repeat the
 *    caller's `per_page`. Following that link verbatim therefore drops the page
 *    size back to the server default (15) and makes every later page overlap
 *    the rows already collected. Each request re-sends the resolved page size
 *    so every page covers a distinct, contiguous slice.
 */
async function collectAllPages(firstPage, resource, params = {}) {
  let rows = Array.isArray(firstPage?.data) ? firstPage.data : [];
  let next = firstPage?.next_page_url ?? null;

  // The server may have clamped our request, so echo back what it actually used.
  const perPage = Number.isFinite(Number(firstPage?.per_page))
    ? String(Number(firstPage.per_page))
    : null;

  while (next) {
    const url = new URL(next, window.location.origin);
    const path = url.pathname.replace(/^\/api/, "") || `/${resource}`;

    if (perPage) {
      url.searchParams.set("per_page", perPage);
    }

    // Preserve any filters the caller sent alongside the listing.
    for (const [key, value] of Object.entries(params)) {
      if (key === "per_page" || key === "all" || value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }

    const page = await request(`${path}${url.search}`);
    const pageRows = Array.isArray(page?.data) ? page.data : [];

    rows = rows.concat(pageRows);
    next = page?.next_page_url ?? null;
  }

  return rows;
}

export const api = {
  /**
   * Courses an event may be aimed at, straight from the enrolled accounts so
   * the audience picker never offers a course nobody is in.
   */
  courses: async () => {
    const body = await request("/events/courses");
    return Array.isArray(body?.courses) ? body.courses : [];
  },

  academicStructure: async () => {
    const body = await request("/events/courses");

    if (
      !Array.isArray(body?.courses)
      || !Array.isArray(body?.departments)
      || !Array.isArray(body?.years)
    ) {
      throw new Error("The academic structure response is incomplete.");
    }

    return {
      courses: body.courses,
      departments: body.departments,
      years: body.years,
    };
  },

  /** Dashboard aggregates in one request (see ReportController::summary). */
  summary: () => request("/reports/summary"),

  list: async (resource, params = {}) => {
    const all = params.per_page === "all" || params.all === true;
    const base = { ...(all ? {} : { per_page: 1000 }), ...params };
    if (all) {
      delete base.per_page;
      delete base.all;
    }
    const qs = new URLSearchParams(base).toString();
    const body = await request(`/${resource}${qs ? `?${qs}` : ""}`);

    if (!body || typeof body !== "object" || !Array.isArray(body.data)) {
      return body;
    }

    // Forward the caller's filters (search, role, ...) so every page is fetched
    // under the same conditions as the first one.
    return await collectAllPages(body, resource, base);
  },
  create: (resource, data) => request(`/${resource}`, { method: "POST", body: JSON.stringify(data) }),
  update: (resource, id, data) => request(`/${resource}/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  remove: (resource, id) => request(`/${resource}/${id}`, { method: "DELETE" }),
};

export const usersApi = {
  /**
   * Create many accounts from a parsed CSV in one request.
   *
   * Administrator-only server-side, and deliberately a separate endpoint from
   * the ordinary create used by the Add User form: bulk import sets a password
   * for every row at once, so it is gated harder than adding a single user and
   * cannot be delegated through the roles & permissions settings.
   *
   * Rows are validated and written one at a time, so one bad line is reported
   * as a skip instead of failing the whole file.
   */
  importRows: (rows) =>
    request("/user-accounts/import", { method: "POST", body: JSON.stringify({ rows }) }),
};

export const eventScannersApi = {
  get: (eventRef) => request(`/events/${encodeURIComponent(eventRef)}/scanners`),
  update: (eventRef, scannerIds) =>
    request(`/events/${encodeURIComponent(eventRef)}/scanners`, {
      method: "PUT",
      body: JSON.stringify({ scanner_ids: scannerIds }),
    }),
};

/**
 * Per-session attendance roster for one event (AttendanceReportController).
 *
 * Returns { event, sessions[], roster[], counts }. Each roster row carries a
 * `sessions` map keyed by session id (stringified) so the table can render one
 * column per session with that participant's punch (time_in/time_out/status).
 */
export const attendanceApi = {
  get: (eventRef) => request(`/events/${encodeURIComponent(eventRef)}/attendance`),
};

/**
 * Events the signed-in Scanner account is assigned to (EventScannerController
 * ::assignedEvents). Used by a scanner's own "Scanner Mode" surface.
 */
export const scannerEventsApi = {
  list: () => request("/scanner/events"),
};

export const authApi = {
  login: (identifier, password) => {
    const value = identifier.trim();
    const credentials = value.includes("@")
      ? { email: value.toLowerCase(), password }
      : { school_id: value, password };
    return request("/auth/login", { method: "POST", body: JSON.stringify(credentials) });
  },
  register: (data) => request("/auth/register", { method: "POST", body: JSON.stringify(data) }),
  sendPasswordResetLink: (email) => request("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }),
  resetPassword: (data) => request("/auth/reset-password", { method: "POST", body: JSON.stringify(data) }),
  logout: () => request("/auth/logout", { method: "POST" }),
  me: () => request("/auth/me"),
  updateProfile: (data) => request("/auth/profile", { method: "PUT", body: JSON.stringify(data) }),
};

export const settingsApi = {
  get: () => request("/settings"),
  update: (data) => request("/settings", { method: "PUT", body: JSON.stringify(data) }),
  changePassword: (data) => request("/settings/password", { method: "PUT", body: JSON.stringify(data) }),
  uploadLogo: (file) => {
    const body = new FormData();
    body.append("logo", file);
    return request("/settings/logo", { method: "POST", body });
  },
};

/* ---------- certificate generation: template -> eligible -> send ---------- */

export const certificatesApi = {
  /** Upload the certificate artwork for an event. */
  uploadTemplate: (file, event, name) => {
    const body = new FormData();
    body.append("template", file);
    body.append("event", event);
    if (name) body.append("name", name);
    return request("/certificates/template", { method: "POST", body });
  },

  templates: () => request("/certificates/templates"),

  deleteTemplate: (event) =>
    request(`/certificates/templates/${encodeURIComponent(event)}`, { method: "DELETE" }),

  /** "# view student eligible" — who qualifies for this event and why not. */
  eligible: (event) => request("/certificates/eligible", { method: "POST", body: JSON.stringify({ event }) }),

  /** Confirmation step: create Pending certificates, send nothing. */
  issue: (event) => request("/certificates/issue", { method: "POST", body: JSON.stringify({ event }) }),

  send: (reference) => request(`/certificates/${encodeURIComponent(reference)}/send`, { method: "POST" }),

  sendBulk: (references) =>
    request("/certificates/send-bulk", { method: "POST", body: JSON.stringify({ references }) }),

  /**
   * Fetch a rendered certificate as a blob URL.
   *
   * A plain <a href> to the endpoint would not work because the API
   * authenticates with a bearer token in the Authorization header, which a
   * browser does not send when following a link. Fetching with the token and
   * handing the PDF to the browser's viewer through a blob URL keeps the
   * preview inside the authenticated session.
   */
  preview: async (reference) => {
    const blob = await request(`/certificates/${encodeURIComponent(reference)}/preview`, {
      responseType: "blob",
      headers: { Accept: "application/pdf" },
    });
    return URL.createObjectURL(blob);
  },

  /**
   * Download a rendered certificate as a file.
   *
   * Same reason preview() cannot be a plain link: the endpoint authenticates
   * with a bearer token, so following a link would 401. Fetching the bytes and
   * handing them to a temporary anchor keeps the download inside the
   * authenticated session.
   */
  download: async (reference) => {
    const blob = await request(`/certificates/${encodeURIComponent(reference)}/download`, {
      responseType: "blob",
      headers: { Accept: "application/pdf" },
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `${reference}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();

    // Revoked on the next tick rather than immediately: clearing the object URL
    // in the same statement as the click aborts the save in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },
};

/* ---------- event check-in: QR scan -> roster -> punches ---------- */

export const checkinApi = {
  /**
   * The roster for the event a QR code names.
   *
   * The token only identifies the event. It carries no authority of its own:
   * the request still travels with the bearer token and is refused without an
   * account that holds the registrations role.
   */
  roster: (token) => request(`/checkin/${encodeURIComponent(token)}`),
  assignedEvents: () => request("/scanner/events"),

  /** Check a set of participants in or out of one session. */
  punch: (token, payload) =>
    request(`/checkin/${encodeURIComponent(token)}/punch`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  /** Record Absent or Excused for a set of participants in one session. */
  mark: (token, payload) =>
    request(`/checkin/${encodeURIComponent(token)}/mark`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  /** Token and canonical QR target for an event's printable poster. */
  poster: (eventRef) =>
    request(`/events/${encodeURIComponent(eventRef)}/checkin`),

  /** Create the morning/afternoon windows if the event has none yet. */
  ensureSessions: (eventRef) =>
    request(`/events/${encodeURIComponent(eventRef)}/sessions/ensure`, { method: "POST" }),

  /**
   * Add a window beyond the morning/afternoon pair, e.g. an evening session.
   *
   * The server scopes the label per event and date, so re-posting the same
   * label for the same day is refused rather than silently duplicated.
   */
  createSession: (eventRef, payload) =>
    request(`/events/${encodeURIComponent(eventRef)}/sessions`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  /**
   * PATCH rather than the generic api.update helper, which sends PUT.
   */
  updateSession: (sessionId, data) =>
    request(`/sessions/${sessionId}`, { method: "PATCH", body: JSON.stringify(data) }),

  closeSession: (sessionId) => request(`/sessions/${sessionId}/close`, { method: "POST" }),

  reopenSession: (sessionId) => request(`/sessions/${sessionId}/reopen`, { method: "POST" }),
};

export const reportsApi = {
  get: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/reports${qs ? `?${qs}` : ""}`);
  },
};

export const eventsApi = {
  uploadBanner: (eventReference, file) => {
    const form = new FormData();
    form.append("banner", file);
    return request(`/events/${encodeURIComponent(eventReference)}/banner`, {
      method: "POST",
      body: form,
    });
  },
  attendanceRoster: (eventReference) => request(`/admin/events/${encodeURIComponent(eventReference)}/attendance-roster`),
  finalizeAttendanceRoster: (eventReference) => request(`/admin/events/${encodeURIComponent(eventReference)}/attendance-roster/finalize`, { method: "POST" }),
  assessFines: (eventReference) => request(`/admin/events/${encodeURIComponent(eventReference)}/assess-fines`, { method: "POST" }),
  reviewFine: (fineId, decision) => request(`/admin/fines/${fineId}/review`, { method: "PATCH", body: JSON.stringify({ decision }) }),
};

export const registrationsApi = {
  /** Create an event registration from the signed-in student's account. */
  selfRegister: (eventReference) =>
    request("/registrations/self", {
      method: "POST",
      body: JSON.stringify({ event_reference: eventReference }),
    }),

  /** Students receive only their own registrations from this authenticated endpoint. */
  mine: () => request("/registrations"),

  /** Cancel a future registration owned by the signed-in student. */
  cancel: (reference) => request(`/registrations/${encodeURIComponent(reference)}/cancel`, { method: "DELETE" }),

  /**
   * Download a .ics calendar file for a registration's event.
   *
   * Uses a bearer-token-authenticated fetch (same as certificatesApi.download)
   * because a plain <a href> would not carry the Authorization header.
   */
  downloadCalendar: async (reference) => {
    const blob = await request(`/registrations/${encodeURIComponent(reference)}/calendar`, {
      responseType: "blob",
      headers: { Accept: "text/calendar" },
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${reference}.ics`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },

  /**
   * Queue a reminder email for each of the given registration references.
   *
   * One request for the whole batch; the server dispatches a queued job per
   * registration and returns straight away, so the browser never waits on mail.
   * Registrations it cannot resolve an event for come back in `skipped` rather
   * than being dropped silently.
   */
  sendReminders: (references) =>
    request("/registrations/send-reminders", {
      method: "POST",
      body: JSON.stringify({ references }),
    }),
};

export const studentEvaluationsApi = {
  submit: (eventReference, rating, comment) => request("/evaluations/submit", {
    method: "POST",
    body: JSON.stringify({ event_reference: eventReference, rating, comment }),
  }),
};

/* ---------- field mapping: backend (snake_case) <-> frontend (camelCase) ---------- */

export function mapEventFromApi(row) {
  const normalizeTime = (value) => value ? String(value).slice(0, 5) : "";
  return {
    _id: row.id,
    id: row.reference,
    name: row.title,
    category: row.category ?? "",
    organizer: row.organizer ?? "",
    date: row.event_date ?? "",
    registrationDeadline: row.registration_deadline ?? "",
    registrationOpen: row.registration_open ?? true,
    // A missing start time means all-day. SQL time values may include seconds,
    // while the form's time input expects HH:mm.
    startTime: normalizeTime(row.start_time),
    endDate: row.end_date ?? row.endDate ?? "",
    endTime: normalizeTime(row.end_time ?? row.endTime),
    durationValue: row.duration_value ?? row.durationValue ?? null,
    durationUnit: row.duration_unit ?? row.durationUnit ?? "Hours",
    venue: row.venue ?? "",
    description: row.description ?? "",
    bannerUrl: row.banner_url ?? "",
    budget: row.budget ?? 0,
    capacity: row.capacity ?? 0,
    // Derived here too, so the toggle always reflects the number instead of
    // trusting a second source of truth that could disagree with it.
    hasCapacity: row.capacity !== null && row.capacity !== undefined,
    participants: row.registrations_count ?? row.participants ?? 0,
    status: row.status,
    targetRole: row.target_role ?? row.targetRole ?? "All",
    targetCourse: row.target_course ?? row.targetCourse ?? null,
    targetDepartment: row.target_department ?? row.targetDepartment ?? null,
    targetYear: row.target_year ?? row.targetYear ?? null,
    targetBlock: row.target_block ?? row.targetBlock ?? null,
    attendanceCompulsory: row.attendance_compulsory ?? false,
    attendanceRequiresCheckout: row.attendance_requires_checkout ?? true,
    absenceFineAmount: row.absence_fine_amount ?? null,
    incompleteFineAmount: row.incomplete_fine_amount ?? null,
    attendanceCorrectionDeadline: row.attendance_correction_deadline ?? "",
    excuseDeadline: row.excuse_deadline ?? "",
    hasCertificate: row.has_certificate ?? row.hasCertificate ?? true,
    checkinToken: row.checkin_token ?? row.checkinToken ?? null,
  };
}

export function mapEventToApi(row) {
  return {
    reference: row.id,
    title: row.name,
    category: row.category || null,
    organizer: row.organizer,
    event_date: row.date || null,
    registration_deadline: row.registrationDeadline || null,
    registration_open: row.registrationOpen !== false,
    start_time: row.startTime,
    end_date: row.endDate || null,
    end_time: row.endTime || null,
    venue: row.venue,
    description: row.description,
    banner_url: row.bannerUrl || null,
    budget: row.budget ?? 0,
    // No capacity means uncapped, so send null rather than 0 - a zero capacity
    // would render as "completely full" on the fill-rate report.
    capacity: row.hasCapacity && row.capacity !== "" ? Number(row.capacity) : null,
    participants: row.participants ?? 0,
    status: row.status,
    target_role: row.targetRole ?? "All",
    target_course: row.targetCourse || null,
    target_department: row.targetDepartment || null,
    target_year: row.targetYear || null,
    target_block: row.targetBlock || null,
    attendance_compulsory: Boolean(row.attendanceCompulsory),
    attendance_requires_checkout: Boolean(row.attendanceRequiresCheckout),
    absence_fine_amount: row.absenceFineAmount === "" ? null : row.absenceFineAmount,
    incomplete_fine_amount: row.incompleteFineAmount === "" ? null : row.incompleteFineAmount,
    attendance_correction_deadline: row.attendanceCorrectionDeadline || null,
    excuse_deadline: row.excuseDeadline || null,
    has_certificate: row.hasCertificate ?? true,
  };
}

export function mapAnnouncementFromApi(row) {
  return {
    _id: row.id,
    id: row.reference,
    title: row.title,
    message: row.message,
    audience: row.audience,
    category: row.category,
    status: row.status,
    publishDate: row.publish_date ?? "",
    author: row.author ?? "",
  };
}

export function mapAnnouncementToApi(row) {
  return {
    reference: row.id,
    title: row.title,
    message: row.message,
    audience: row.audience,
    category: row.category,
    status: row.status,
    publish_date: row.publishDate || null,
    author: row.author || null,
  };
}

/* ---------- user accounts ---------- */

export function mapUserFromApi(row) {
  return {
    id: row.reference,
    studentId: row.student_id ?? row.studentId ?? "",
    name: row.name,
    email: row.email,
    role: row.role ?? "Student",
    status: row.status ?? "Pending",
    course: row.course ?? "",
    department: row.department ?? null,
    departmentName: row.department_name ?? row.departmentName ?? null,
    blockNo: row.block_no ?? row.blockNo ?? "",
    year: row.year ?? "",
    date: row.date ?? "",
  };
}

export function mapUserToApi(row) {
  const payload = {
    reference: row.id,
    student_id: row.studentId || null,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
    course: row.course || null,
    block_no: row.blockNo || null,
    year: row.year || null,
    date: row.date || null,
  };
  if (row.password) payload.password = row.password;
  return payload;
}

/* ---------- registrations ---------- */

export function mapRegistrationFromApi(row) {
  return {
    id: row.reference,
    participant: row.participant,
    email: row.email,
    role: row.role ?? "Student",
    blockNo: row.block_no ?? row.blockNo ?? "",
    event: row.event,
    payment: row.payment ?? "",
    paymentStatus: row.payment_status,
    attendance: row.attendance,
    regDate: row.reg_date ?? "",
    qrCode: row.qr_code ?? "",
  };
}

export function mapRegistrationToApi(row) {
  return {
    reference: row.id,
    participant: row.participant,
    email: row.email,
    role: row.role || "Student",
    block_no: row.blockNo || null,
    event: row.event,
    payment: row.payment || null,
    payment_status: row.paymentStatus,
    attendance: row.attendance,
    reg_date: row.regDate || null,
    qr_code: row.qrCode || null,
  };
}

/* ---------- certificates ---------- */

export function mapCertificateFromApi(row) {
  return {
    id: row.reference,
    participant: row.participant,
    email: row.email,
    event: row.event,
    status: row.status,
    dateIssued: row.date_issued ?? "",
    qrCode: row.qr_code ?? "",
  };
}

export function mapCertificateToApi(row) {
  return {
    reference: row.id,
    participant: row.participant,
    email: row.email,
    event: row.event,
    status: row.status,
    date_issued: row.dateIssued || null,
    qr_code: row.qrCode || null,
  };
}

/* ---------- evaluations ---------- */

export function mapEvaluationFromApi(row) {
  return {
    id: row.reference,
    event: row.event,
    participant: row.participant,
    rating: row.rating,
    comment: row.comment ?? "",
    date: row.date ?? "",
  };
}

export function mapEvaluationToApi(row) {
  return {
    reference: row.id,
    event: row.event,
    participant: row.participant,
    rating: row.rating,
    comment: row.comment || null,
    date: row.date || null,
  };
}

/* ---------- activity logs ---------- */

export function mapLogFromApi(row) {
  return {
    id: row.reference,
    timestamp: row.timestamp,
    user: row.user,
    role: row.role,
    category: row.category,
    action: row.action,
    details: row.details ?? "",
  };
}

export function mapLogToApi(row) {
  return {
    reference: row.id,
    timestamp: row.timestamp,
    user: row.user,
    role: row.role,
    category: row.category,
    action: row.action,
    details: row.details || null,
  };
}
