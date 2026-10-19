import { NavLink, useNavigate, useParams } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import "./CheckIn.css";
import logo from "./assets/Tmc_Logo.png";
import Toast from "./components/Toast";
import ConfirmDialog from "./components/ConfirmDialog";
import { useToast } from "./lib/useToast";
import { api, checkinApi, mapEventFromApi } from "./lib/api";
import { downloadCSV, dateStamp } from "./lib/csv";
import { usePagination } from "./lib/usePagination";
import Pagination from "./components/Pagination";
import { roleLabel, useLogout, useUser } from "./lib/session";
import { visibleNavItems } from "./lib/nav";

const STATUS_LABELS = {
    Present: "Present",
    Late: "Late",
    Absent: "Absent",
    Excused: "Excused",
    "Not Yet Recorded": "Not recorded",
};

/* Rank for the Status column sort, so "Present" leads and unrecorded trails. */
const STATUS_ORDER = {
    Present: 0,
    Late: 1,
    Excused: 2,
    Absent: 3,
    "Not Yet Recorded": 4,
};

function SortIcon({ active, dir }) {
    return (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className={`checkin-sort-icon${active ? " active" : ""}${active && dir === "desc" ? " flipped" : ""}`}>
            <path d="M5 1.5v7M2 5.5 5 8.5 8 5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function initialsOf(text) {
    return String(text ?? "")
        .split(" ")
        .filter(Boolean)
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
}

/** "2026-10-05 08:05:00" -> "08:05" for display. */
function clockOf(stamp) {
    if (!stamp) return "—";
    const match = String(stamp).match(/(\d{2}:\d{2})/);
    return match ? match[1] : String(stamp);
}

/**
 * Pick which punch a row still needs for the session on screen.
 *
 * Returns "out" once someone is in, so a single button walks them through the
 * day rather than offering two choices that mostly lead to a validation error.
 */
function nextAction(sessionState) {
    if (!sessionState?.time_in) return "in";
    if (!sessionState?.time_out) return "out";
    return null;
}

function Shell({ children, title, subtitle, navOpen, setNavOpen, user, handleLogout, embedded = false }) {
    if (embedded) return children;

    const closeNav = () => setNavOpen(false);
    const navItems = visibleNavItems(user?.role);

    return (
        <div className={`regs-shell${navOpen ? " nav-open" : ""}`}>
            <aside className="regs-sidebar" id="primary-navigation">
                <div className="regs-sidebar-brand">
                    <img src={logo} alt="TMC Logo" className="regs-sidebar-logo" />
                    <div className="regs-sidebar-brand-text">
                        <span className="regs-sidebar-title">TMC EventEase</span>
                        <span className="regs-sidebar-subtitle">{roleLabel(user.role)}</span>
                    </div>
                </div>

                <nav className="regs-sidebar-nav">
                    {navItems.map((item) => (
                        <NavLink
                            key={item.to}
                            to={item.to}
                            className={({ isActive }) => (isActive ? "regs-sidebar-link active" : "regs-sidebar-link")}
                            onClick={closeNav}
                        >
                            {item.icon ? <item.icon className="sidebar-link-icon" size={17} /> : null}
                            {item.label}
                        </NavLink>
                    ))}
                </nav>

                <div className="regs-sidebar-footer">
                    <button className="regs-sidebar-logout" onClick={handleLogout}>Log out</button>
                </div>
            </aside>

            <button
                type="button"
                className="nav-backdrop"
                aria-label="Close navigation menu"
                tabIndex={navOpen ? 0 : -1}
                onClick={closeNav}
            />

            <div className="regs-main-column">
                <header className="regs-topbar">
                    <div className="topbar-lead">
                        <button
                            type="button"
                            className="nav-toggle"
                            onClick={() => setNavOpen((open) => !open)}
                            aria-label={navOpen ? "Close navigation menu" : "Open navigation menu"}
                            aria-controls="primary-navigation"
                            aria-expanded={navOpen}
                        >
                            <span className="nav-toggle-bar" />
                            <span className="nav-toggle-bar" />
                            <span className="nav-toggle-bar" />
                        </button>

                        <div>
                            <h1 className="regs-page-title">{title}</h1>
                            {subtitle ? <p className="checkin-page-subtitle">{subtitle}</p> : null}
                        </div>
                    </div>

                    <div className="regs-topbar-user">
                        <div className="regs-avatar">{initialsOf(user.name)}</div>
                        <div className="regs-topbar-text">
                            <span className="regs-topbar-name">{user.name}</span>
                            <span className="regs-topbar-role">{roleLabel(user.role)}</span>
                        </div>
                    </div>
                </header>

                <main className="regs-page-content">{children}</main>
            </div>
        </div>
    );
}

/* ------------------------------------------------------------ event picker */

/**
 * Shown at /attendance with no event token: choose an event and open its
 * check-in desk.
 */
function EventPicker({ user, handleLogout, navOpen, setNavOpen, showToast, embedded = false }) {
    const navigate = useNavigate();
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busyRef, setBusyRef] = useState(null);
    const [search, setSearch] = useState("");
    const [sortKey, setSortKey] = useState("name");
    const [sortDir, setSortDir] = useState("asc");

    useEffect(() => {
        let active = true;

        (user.role === "Scanner"
            ? checkinApi.assignedEvents()
            : api.list("events", { per_page: "all" }))
            .then((rows) => {
                if (active) setEvents((Array.isArray(rows) ? rows : []).map(mapEventFromApi));
            })
            .catch((err) => showToast(err.message, "danger"))
            .finally(() => { if (active) setLoading(false); });

        return () => { active = false; };
    }, [showToast]);

    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase();
        const matched = !term
            ? [...events]
            : events.filter((e) =>
                e.name.toLowerCase().includes(term) || String(e.id).toLowerCase().includes(term));

        const pick = {
            name: (e) => e.name.toLowerCase(),
            date: (e) => e.date || "",
            status: (e) => (e.status || "").toLowerCase(),
        }[sortKey] ?? ((e) => e.name.toLowerCase());

        const dir = sortDir === "asc" ? 1 : -1;
        matched.sort((a, b) => {
            const left = pick(a);
            const right = pick(b);
            if (left < right) return -1 * dir;
            if (left > right) return 1 * dir;
            return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
        });
        return matched;
    }, [events, search, sortKey, sortDir]);

    const pager = usePagination(filtered, {
        resetKey: [search, sortKey, sortDir].join("|"),
    });

    function toggleSort(key) {
        if (sortKey === key) {
            setSortDir(sortDir === "asc" ? "desc" : "asc");
        } else {
            setSortKey(key);
            setSortDir("asc");
        }
    }

    async function openEvent(event) {
        setBusyRef(event.id);
        try {
            const token = user.role === "Scanner"
                ? event.checkinToken
                : (await checkinApi.poster(event.id)).token;
            if (!token) throw new Error("This assigned event has no check-in token. Contact an administrator.");
            navigate(`/attendance/check-in/${token}?event=${encodeURIComponent(event.id)}`);
        } catch (err) {
            showToast(err.message, "danger");
        } finally {
            setBusyRef(null);
        }
    }

    return (
        <Shell title="Check-In" subtitle="Pick an event to open its check-in desk." user={user} handleLogout={handleLogout} navOpen={navOpen} setNavOpen={setNavOpen} embedded={embedded}>
            <section className="regs-panel">
                <div className="regs-panel-header">
                    <h2>Events</h2>
                    <div className="regs-panel-actions">
                        <input
                            type="text"
                            className="regs-input-search"
                            placeholder="Search events…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            aria-label="Search events"
                        />
                    </div>
                </div>

                <div className="regs-table-wrapper">
                    <table>
                        <thead>
                            <tr>
                                <th className="checkin-th-sortable" onClick={() => toggleSort("name")}>
                                    Event <SortIcon active={sortKey === "name"} dir={sortDir} />
                                </th>
                                <th className="checkin-th-sortable" onClick={() => toggleSort("date")}>
                                    Date <SortIcon active={sortKey === "date"} dir={sortDir} />
                                </th>
                                <th>Venue</th>
                                <th className="checkin-th-sortable" onClick={() => toggleSort("status")}>
                                    Status <SortIcon active={sortKey === "status"} dir={sortDir} />
                                </th>
                                <th aria-label="Actions" />
                            </tr>
                        </thead>
                        <tbody>
                            {loading && (
                                <tr><td className="regs-empty-row" colSpan={5}>Loading events…</td></tr>
                            )}
                            {!loading && filtered.length === 0 && (
                                <tr>
                                    <td className="regs-empty-row" colSpan={5}>
                                        {user.role === "Scanner" && events.length === 0
                                            ? "You have no approved events assigned for scanning."
                                            : "No events match that search."}
                                    </td>
                                </tr>
                            )}
                            {pager.pageRows.map((event) => (
                                <tr key={event.id}>
                                    <td>
                                        <div className="regs-cell">
                                            <span className="regs-row-avatar">{initialsOf(event.name)}</span>
                                            <div className="regs-cell-text">
                                                <span className="regs-cell-name">{event.name}</span>
                                                <span className="regs-cell-id">{event.id}</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="regs-cell-muted">{event.date || "—"}</td>
                                    <td className="regs-cell-muted">{event.venue || "—"}</td>
                                    <td>
                                        <span className={`checkin-status checkin-status-${event.status.toLowerCase()}`}>
                                            {event.status}
                                        </span>
                                    </td>
                                    <td>
                                        <button
                                            type="button"
                                            className="regs-btn regs-btn-primary"
                                            disabled={busyRef === event.id}
                                            onClick={() => openEvent(event)}
                                        >
                                            {busyRef === event.id ? "Opening…" : "Open check-in"}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <Pagination
                    {...pager}
                    classPrefix="regs"
                    unit="events"
                    loading={loading}
                />
            </section>
        </Shell>
    );
}

/* ------------------------------------------------------------- check-in desk */

function CheckInDesk({ token, user, handleLogout, navOpen, setNavOpen, showToast, embedded = false }) {
    const navigate = useNavigate();
    const canManageSessions = user.role === "Admin";
    const [eventInfo, setEventInfo] = useState(null);
    const [roster, setRoster] = useState(null);
    const [sessions, setSessions] = useState([]);
    const [counts, setCounts] = useState({ registered: 0, fully_recorded: 0 });
    const [activeSessionId, setActiveSessionId] = useState(null);
    const [viewingAllSessions, setViewingAllSessions] = useState(false);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [busy, setBusy] = useState(false);

    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");
    const [departmentFilter, setDepartmentFilter] = useState("all");
    const [courseFilter, setCourseFilter] = useState("all");
    const [yearFilter, setYearFilter] = useState("all");
    const [blockFilter, setBlockFilter] = useState("all");
    const [rosterSortKey, setRosterSortKey] = useState("participant");
    const [rosterSortDir, setRosterSortDir] = useState("asc");
    const [selected, setSelected] = useState(() => new Set());
    const [editingWindow, setEditingWindow] = useState(false);
    const [windowDraft, setWindowDraft] = useState({ time_in: "", time_out: "", grace_minutes: "" });
    const [pendingClose, setPendingClose] = useState(null);
    const [addingSession, setAddingSession] = useState(false);
    const [sessionDraft, setSessionDraft] = useState({
        label: "",
        session_date: "",
        time_in: "",
        time_out: "",
        grace_minutes: "15",
    });

    const load = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const data = await checkinApi.roster(token);
            setRoster(data.roster ?? []);
            setSessions(data.sessions ?? []);
            setCounts(data.counts ?? { registered: 0, fully_recorded: 0 });
            setEventInfo((prev) => prev ?? data.event);
            setActiveSessionId((prev) => {
                if (prev && (data.sessions ?? []).some((s) => s.id === prev)) return prev;
                return (data.sessions ?? [])[0]?.id ?? null;
            });
        } catch (err) {
            setLoadError(err.message);
        } finally {
            setLoading(false);
        }
    }, [token]);

    // Auto-refresh roster so mobile scans appear on web admin without manual refresh
    useEffect(() => {
        const interval = setInterval(() => {
            if (!loading && !busy) load();
        }, 10000);
        return () => clearInterval(interval);
    }, [load, loading, busy]);

    useEffect(() => { load(); }, [load]);

    const activeSession = useMemo(
        () => sessions.find((s) => s.id === activeSessionId) ?? null,
        [sessions, activeSessionId]
    );

    const rows = roster ?? [];

    const academicOptions = useMemo(() => {
        const unique = (values) => [...new Set(values.filter(Boolean))].sort((a, b) =>
            String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" })
        );
        const departmentRows = rows.filter((row) => departmentFilter === "all" || row.department === departmentFilter);
        const courseRows = departmentRows.filter((row) => courseFilter === "all" || row.course === courseFilter);
        const yearRows = courseRows.filter((row) => yearFilter === "all" || row.year === yearFilter);
        return {
            departments: unique(rows.map((row) => row.department)).map((code) => ({
                code,
                name: rows.find((row) => row.department === code)?.department_name || code,
            })),
            courses: unique(departmentRows.map((row) => row.course)),
            years: unique(courseRows.map((row) => row.year)),
            blocks: unique(yearRows.map((row) => row.block_no)),
        };
    }, [rows, departmentFilter, courseFilter, yearFilter]);

    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase();
        const matched = rows.filter((row) => {
            const matchesTerm = !term
                || row.participant.toLowerCase().includes(term)
                || String(row.reference).toLowerCase().includes(term)
                || String(row.department_name ?? row.department ?? "").toLowerCase().includes(term)
                || String(row.course ?? "").toLowerCase().includes(term)
                || String(row.year ?? "").toLowerCase().includes(term)
                || String(row.block_no ?? "").toLowerCase().includes(term);
            if (!matchesTerm) return false;
            if (departmentFilter !== "all" && row.department !== departmentFilter) return false;
            if (courseFilter !== "all" && row.course !== courseFilter) return false;
            if (yearFilter !== "all" && row.year !== yearFilter) return false;
            if (blockFilter !== "all" && row.block_no !== blockFilter) return false;
            if (statusFilter === "all") return true;

            const state = activeSession ? row.sessions?.[String(activeSession.id)] : null;
            if (statusFilter === "complete") return row.sessions_complete === row.sessions_total;
            if (statusFilter === "unrecorded") {
                return viewingAllSessions
                    ? !sessions.some((session) => {
                        const sessionState = row.sessions?.[String(session.id)];
                        return sessionState?.time_in || sessionState?.time_out;
                    })
                    : !state?.time_in && !state?.time_out;
            }
            return viewingAllSessions
                ? sessions.some((session) => row.sessions?.[String(session.id)]?.status === statusFilter)
                : state?.status === statusFilter;
        });

        const stateOf = (row) => activeSession ? row.sessions?.[String(activeSession.id)] : null;
        const pick = {
            participant: (row) => row.participant.toLowerCase(),
            in: (row) => stateOf(row)?.time_in ?? "",
            out: (row) => stateOf(row)?.time_out ?? "",
            status: (row) => STATUS_ORDER[stateOf(row)?.status ?? "Not Yet Recorded"] ?? 99,
            sessions: (row) => (row.sessions_complete ?? 0) - (row.sessions_total ?? 0) / 1000,
        }[rosterSortKey] ?? ((row) => row.participant.toLowerCase());

        const dir = rosterSortDir === "asc" ? 1 : -1;
        matched.sort((a, b) => {
            const left = pick(a);
            const right = pick(b);
            if (left < right) return -1 * dir;
            if (left > right) return 1 * dir;
            return a.participant.toLowerCase() < b.participant.toLowerCase() ? -1 : 1;
        });
        return matched;
    }, [rows, sessions, search, statusFilter, departmentFilter, courseFilter, yearFilter, blockFilter, activeSession, viewingAllSessions, rosterSortKey, rosterSortDir]);

    const rosterPager = usePagination(filtered, {
        resetKey: [search, statusFilter, departmentFilter, courseFilter, yearFilter, blockFilter, activeSessionId, viewingAllSessions, rosterSortKey, rosterSortDir].join("|"),
    });

    const hasActiveFilters = Boolean(
        search || statusFilter !== "all" || departmentFilter !== "all"
        || courseFilter !== "all" || yearFilter !== "all" || blockFilter !== "all"
    );

    function clearRosterFilters() {
        setSearch("");
        setStatusFilter("all");
        setDepartmentFilter("all");
        setCourseFilter("all");
        setYearFilter("all");
        setBlockFilter("all");
        setSelected(new Set());
    }

    function toggleRosterSort(key) {
        if (rosterSortKey === key) {
            setRosterSortDir(rosterSortDir === "asc" ? "desc" : "asc");
        } else {
            setRosterSortKey(key);
            setRosterSortDir("asc");
        }
    }

    function exportRosterCSV() {
        const sessionColumns = sessions.flatMap((session) => [
            `${session.label} in (${session.session_date ?? ""})`,
            `${session.label} out (${session.session_date ?? ""})`,
            `${session.label} status`,
        ]);
        const rows = [
            ["Reference", "Participant", "Email", "Role", "Department", "Course", "Year", "Block", ...sessionColumns, "Sessions complete", "Sessions total"],
            ...filtered.map((row) => {
                return [
                    row.reference,
                    row.participant,
                    row.email ?? "",
                    row.role ?? "",
                    row.department_name ?? row.department ?? "",
                    row.course ?? "",
                    row.year ?? "",
                    row.block_no ?? "",
                    ...sessions.flatMap((session) => {
                        const state = row.sessions?.[String(session.id)];
                        return [state?.time_in ?? "", state?.time_out ?? "", state?.status ?? "Not Yet Recorded"];
                    }),
                    row.sessions_complete ?? 0,
                    row.sessions_total ?? 0,
                ];
            }),
        ];
        const stamp = `${(eventInfo?.title ?? "roster").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "roster"}-${dateStamp()}`;
        downloadCSV(`${stamp}.csv`, rows);
        showToast(`Exported ${filtered.length} participant${filtered.length === 1 ? "" : "s"}.`);
    }

    const sessionStats = useMemo(() => {
        if (!activeSession) return { inCount: 0, outCount: 0, absentCount: 0 };
        const states = rows.map((row) => row.sessions?.[String(activeSession.id)]).filter(Boolean);
        return {
            inCount: states.filter((s) => s.time_in && !s.time_out).length,
            outCount: states.filter((s) => s.time_out).length,
            absentCount: states.filter((s) => s.status === "Absent").length,
        };
    }, [rows, activeSession]);

    const filteredIds = new Set(filtered.map((row) => row.registration_id));
    const selectedIds = [...selected].filter((id) => filteredIds.has(id));
    const visibleIds = rosterPager.pageRows.map((row) => row.registration_id);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

    function toggleOne(id) {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }

    function toggleAllVisible() {
        setSelected((prev) => {
            const next = new Set(prev);
            if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
            else visibleIds.forEach((id) => next.add(id));
            return next;
        });
    }

    /**
     * Report anything the backend refused to record.
     *
     * A bulk punch answers 207 with the rows it skipped, which would otherwise
     * look like a clean success while somebody's record silently stayed empty.
     */
    function reportSkipped(result, verb) {
        const skipped = result?.skipped ?? [];
        if (skipped.length === 0) return;

        const detail = skipped
            .map((item) => `${item.registration_id}: ${item.reason}`)
            .join(" · ");
        showToast(`${skipped.length} could not be ${verb} — ${detail}`, "danger");
    }

    async function punch(direction, ids) {
        if (!activeSession || ids.length === 0) return;

        setBusy(true);
        try {
            const result = await checkinApi.punch(token, {
                session_id: activeSession.id,
                direction,
                registration_ids: ids,
            });
            showToast(result.message);
            reportSkipped(result, direction === "in" ? "checked in" : "checked out");
            await load();
            setSelected(new Set());
        } catch (err) {
            showToast(err.message, "danger");
        } finally {
            setBusy(false);
        }
    }

    async function mark(status, ids) {
        if (!activeSession || ids.length === 0) return;

        setBusy(true);
        try {
            const result = await checkinApi.mark(token, {
                session_id: activeSession.id,
                status,
                registration_ids: ids,
            });
            showToast(result.message);
            await load();
            setSelected(new Set());
        } catch (err) {
            showToast(err.message, "danger");
        } finally {
            setBusy(false);
        }
    }

    async function toggleSessionLock() {
        if (!activeSession) return;

        setBusy(true);
        try {
            if (activeSession.open) {
                // Closing stamps anyone still checked in as having left, so it
                // needs confirming rather than happening on a stray click.
                setBusy(false);
                setPendingClose(activeSession);
                return;
            }
            await checkinApi.reopenSession(activeSession.id);
            showToast(`${activeSession.label} reopened.`);
            await load();
        } catch (err) {
            showToast(err.message, "danger");
        } finally {
            setBusy(false);
        }
    }

    async function confirmClose() {
        const session = pendingClose;
        setPendingClose(null);
        if (!session) return;

        setBusy(true);
        try {
            await checkinApi.closeSession(session.id);
            showToast(`${session.label} closed and outstanding check-outs stamped.`);
            await load();
        } catch (err) {
            showToast(err.message, "danger");
        } finally {
            setBusy(false);
        }
    }

    function startEditWindow() {
        if (!activeSession) return;
        setWindowDraft({
            time_in: activeSession.time_in ?? "",
            time_out: activeSession.time_out ?? "",
            grace_minutes: String(activeSession.grace_minutes ?? 0),
        });
        setEditingWindow(true);
    }

    /**
     * Give an event the morning/afternoon pair.
     *
     * An event with no sessions has no active session, and every punch and mark
     * button is gated on one, so without this the desk is inert with nothing on
     * screen to explain why. Reached when an event was never dated, or was
     * seeded before the check-in feature existed.
     */
    async function setUpSessions() {
        setBusy(true);
        try {
            await checkinApi.ensureSessions(poster.reference);
            showToast("Morning and afternoon windows are ready.");
            await load();
        } catch (err) {
            showToast(err.message, "danger");
        } finally {
            setBusy(false);
        }
    }

    function startAddSession() {
        setSessionDraft({
            label: "",
            session_date: eventInfo?.event_date ?? "",
            time_in: "",
            time_out: "",
            grace_minutes: "15",
        });
        setAddingSession(true);
    }

    async function saveSession(event) {
        event.preventDefault();
        const label = sessionDraft.label.trim();
        if (!label || !sessionDraft.session_date || !sessionDraft.time_in || !sessionDraft.time_out) {
            showToast("Name, date, opens and closes are all required.", "danger");
            return;
        }

        setBusy(true);
        try {
            await checkinApi.createSession(poster.reference, {
                label,
                session_date: sessionDraft.session_date,
                time_in: sessionDraft.time_in,
                time_out: sessionDraft.time_out,
                grace_minutes: Number(sessionDraft.grace_minutes || 0),
            });
            showToast(`${label} added.`);
            setAddingSession(false);
            await load();
        } catch (err) {
            showToast(err.message, "danger");
        } finally {
            setBusy(false);
        }
    }

    async function saveWindow(event) {
        event.preventDefault();
        if (!activeSession) return;

        setBusy(true);
        try {
            await checkinApi.updateSession(activeSession.id, {
                time_in: windowDraft.time_in || null,
                time_out: windowDraft.time_out || null,
                grace_minutes: Number(windowDraft.grace_minutes || 0),
            });
            showToast(`${activeSession.label} window updated.`);
            setEditingWindow(false);
            await load();
        } catch (err) {
            showToast(err.message, "danger");
        } finally {
            setBusy(false);
        }
    }

    if (loadError) {
        return (
            <Shell title="Check-In" user={user} handleLogout={handleLogout} navOpen={navOpen} setNavOpen={setNavOpen} embedded={embedded}>
                <section className="regs-panel">
                    <div className="regs-panel-header"><h2>Cannot open this check-in</h2></div>
                    <p className="checkin-empty">{loadError}</p>
                    <p className="checkin-empty">
                        This check-in link may belong to an event that no longer exists. Open
                        check-in from the Events page to pick another.
                    </p>
                </section>
            </Shell>
        );
    }

    return (
        <Shell
            title="Check-In"
            subtitle={eventInfo ? `${eventInfo.title} · ${eventInfo.event_date ?? "no date"}` : "Loading event…"}
            user={user}
            handleLogout={handleLogout}
            navOpen={navOpen}
            setNavOpen={setNavOpen}
            embedded={embedded}
        >
            <div className="regs-kpi-strip">
                <div className="regs-kpi-item">
                    <span className="regs-kpi-label">Registered</span>
                    <span className="regs-kpi-value">{counts.registered}</span>
                </div>
                <div className="regs-kpi-item">
                    <span className="regs-kpi-label">Checked in now</span>
                    <span className="regs-kpi-value">{sessionStats.inCount}</span>
                </div>
                <div className="regs-kpi-item">
                    <span className="regs-kpi-label">Signed out</span>
                    <span className="regs-kpi-value">{sessionStats.outCount}</span>
                </div>
                <div className="regs-kpi-item">
                    <span className="regs-kpi-label">Full attendance</span>
                    <span className="regs-kpi-value">{counts.fully_recorded}</span>
                </div>
            </div>

            <section className="regs-panel">
                <div className="regs-panel-header">
                    <h2>{eventInfo?.title ?? "Roster"}</h2>
                    <div className="regs-panel-actions">
                        <button
                            type="button"
                            className="regs-btn regs-btn-secondary"
                            onClick={() => navigate("/attendance")}
                        >
                            Choose another event
                        </button>
                        {canManageSessions && sessions.length > 0 && !addingSession && (
                            <button
                                type="button"
                                className="regs-btn regs-btn-secondary"
                                disabled={busy || !eventInfo?.event_date}
                                title={eventInfo?.event_date ? undefined : "Give the event a date first"}
                                onClick={startAddSession}
                            >
                                Add session
                            </button>
                        )}
                        <button type="button" className="regs-btn regs-btn-secondary" onClick={() => void load()}>
                            Refresh
                        </button>
                    </div>
                </div>

                {addingSession && (
                    <form className="checkin-window-form" onSubmit={saveSession}>
                        <label>
                            Name
                            <input
                                type="text"
                                value={sessionDraft.label}
                                placeholder="Evening"
                                onChange={(e) => setSessionDraft({ ...sessionDraft, label: e.target.value })}
                            />
                        </label>
                        <label>
                            Date
                            <input
                                type="date"
                                value={sessionDraft.session_date}
                                onChange={(e) => setSessionDraft({ ...sessionDraft, session_date: e.target.value })}
                            />
                        </label>
                        <label>
                            Opens
                            <input
                                type="time"
                                value={sessionDraft.time_in}
                                onChange={(e) => setSessionDraft({ ...sessionDraft, time_in: e.target.value })}
                            />
                        </label>
                        <label>
                            Closes
                            <input
                                type="time"
                                value={sessionDraft.time_out}
                                onChange={(e) => setSessionDraft({ ...sessionDraft, time_out: e.target.value })}
                            />
                        </label>
                        <label>
                            Grace (min)
                            <input
                                type="number"
                                min="0"
                                max="240"
                                value={sessionDraft.grace_minutes}
                                onChange={(e) => setSessionDraft({ ...sessionDraft, grace_minutes: e.target.value })}
                            />
                        </label>
                        <div className="checkin-window-actions">
                            <button type="button" className="regs-btn regs-btn-secondary" onClick={() => setAddingSession(false)}>
                                Cancel
                            </button>
                            <button type="submit" className="regs-btn regs-btn-primary" disabled={busy}>Add session</button>
                        </div>
                    </form>
                )}

                {sessions.length === 0 ? (
                    <div className="checkin-empty-panel">
                        <p>This event has no check-in windows yet, so there is nothing to record against.</p>
                        {canManageSessions && eventInfo?.event_date ? (
                            <button
                                type="button"
                                className="regs-btn regs-btn-primary"
                                disabled={busy}
                                onClick={() => void setUpSessions()}
                            >
                                {busy ? "Setting up…" : "Set up morning and afternoon"}
                            </button>
                        ) : canManageSessions ? (
                            <p>
                                Give the event a date on the Events page first — sessions are built
                                from it.
                            </p>
                        ) : (
                            <p>Check-in sessions are not configured yet. Contact an administrator.</p>
                        )}
                    </div>
                ) : (
                    <>

                <div className="checkin-session-tabs" role="tablist" aria-label="Sessions">
                    <button
                        type="button"
                        role="tab"
                        aria-selected={viewingAllSessions}
                        className={`checkin-session-tab${viewingAllSessions ? " active" : ""}`}
                        onClick={() => {
                            setViewingAllSessions(true);
                            setRosterSortKey("sessions");
                            setRosterSortDir("desc");
                            setSelected(new Set());
                        }}
                    >
                        <span className="checkin-session-label">All sessions</span>
                        <span className="checkin-session-window">Full attendance report</span>
                    </button>
                    {sessions.map((session) => (
                        <button
                            key={session.id}
                            type="button"
                            role="tab"
                            aria-selected={session.id === activeSessionId}
                            className={`checkin-session-tab${session.id === activeSessionId ? " active" : ""}`}
                            onClick={() => {
                                setActiveSessionId(session.id);
                                setViewingAllSessions(false);
                                setRosterSortKey("participant");
                                setRosterSortDir("asc");
                                setSelected(new Set());
                            }}
                        >
                            <span className="checkin-session-label">{session.label}</span>
                            <span className="checkin-session-window">
                                {clockOf(session.time_in)}–{clockOf(session.time_out)}
                            </span>
                            <span className={`checkin-session-state checkin-session-state-${session.status}`}>
                                {session.status}
                            </span>
                        </button>
                    ))}
                </div>

                {activeSession && !viewingAllSessions && (
                    <div className="checkin-session-bar">
                        <div className="checkin-session-meta">
                            {activeSession.session_date ? <span>{activeSession.session_date}</span> : null}
                            <span>
                                Late after <strong>{clockOf(activeSession.late_after)}</strong>
                            </span>
                            <span>Grace {activeSession.grace_minutes} min</span>
                            {activeSession.open ? (
                                <span className="checkin-open-badge">Open</span>
                            ) : (
                                <span className="checkin-closed-badge">Closed</span>
                            )}
                        </div>

                        <div className="checkin-session-actions">
                            {canManageSessions && !editingWindow && (
                                <button type="button" className="regs-btn regs-btn-secondary" onClick={startEditWindow}>
                                    Edit window
                                </button>
                            )}
                            {canManageSessions && <button
                                type="button"
                                className="regs-btn regs-btn-secondary"
                                disabled={busy}
                                onClick={() => void toggleSessionLock()}
                            >
                                {activeSession.open ? "Close session" : "Reopen session"}
                            </button>}
                        </div>
                    </div>
                )}

                {canManageSessions && editingWindow && activeSession && !viewingAllSessions && (
                    <form className="checkin-window-form" onSubmit={saveWindow}>
                        <label>
                            Opens
                            <input
                                type="time"
                                value={windowDraft.time_in.slice(0, 5)}
                                onChange={(e) => setWindowDraft({ ...windowDraft, time_in: e.target.value })}
                            />
                        </label>
                        <label>
                            Closes
                            <input
                                type="time"
                                value={windowDraft.time_out.slice(0, 5)}
                                onChange={(e) => setWindowDraft({ ...windowDraft, time_out: e.target.value })}
                            />
                        </label>
                        <label>
                            Grace (min)
                            <input
                                type="number"
                                min="0"
                                max="240"
                                value={windowDraft.grace_minutes}
                                onChange={(e) => setWindowDraft({ ...windowDraft, grace_minutes: e.target.value })}
                            />
                        </label>
                        <div className="checkin-window-actions">
                            <button type="button" className="regs-btn regs-btn-secondary" onClick={() => setEditingWindow(false)}>
                                Cancel
                            </button>
                            <button type="submit" className="regs-btn regs-btn-primary" disabled={busy}>Save window</button>
                        </div>
                    </form>
                )}

                <div className="regs-toolbar">
                    <input
                        type="text"
                        className="regs-input-search"
                        placeholder="Search participant or reference…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        aria-label="Search participants"
                    />
                    <select
                        className="regs-input-select"
                        value={departmentFilter}
                        onChange={(e) => {
                            setDepartmentFilter(e.target.value);
                            setCourseFilter("all");
                            setYearFilter("all");
                            setBlockFilter("all");
                        }}
                        aria-label="Filter by department"
                    >
                        <option value="all">All departments</option>
                        {academicOptions.departments.map((department) => (
                            <option key={department.code} value={department.code}>{department.name}</option>
                        ))}
                    </select>
                    <select
                        className="regs-input-select"
                        value={courseFilter}
                        onChange={(e) => {
                            setCourseFilter(e.target.value);
                            setYearFilter("all");
                            setBlockFilter("all");
                        }}
                        aria-label="Filter by course"
                    >
                        <option value="all">All courses</option>
                        {academicOptions.courses.map((course) => <option key={course} value={course}>{course}</option>)}
                    </select>
                    <select
                        className="regs-input-select"
                        value={yearFilter}
                        onChange={(e) => {
                            setYearFilter(e.target.value);
                            setBlockFilter("all");
                        }}
                        aria-label="Filter by year"
                    >
                        <option value="all">All years</option>
                        {academicOptions.years.map((year) => <option key={year} value={year}>{year}</option>)}
                    </select>
                    <select
                        className="regs-input-select"
                        value={blockFilter}
                        onChange={(e) => setBlockFilter(e.target.value)}
                        aria-label="Filter by block"
                    >
                        <option value="all">All blocks</option>
                        {academicOptions.blocks.map((block) => <option key={block} value={block}>{block}</option>)}
                    </select>
                    <select
                        className="regs-input-select"
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        aria-label="Filter by status"
                    >
                        <option value="all">All statuses</option>
                        <option value="unrecorded">Not yet recorded</option>
                        <option value="Present">Present</option>
                        <option value="Late">Late</option>
                        <option value="Absent">Absent</option>
                        <option value="Excused">Excused</option>
                        <option value="complete">Fully recorded (all sessions)</option>
                    </select>

                    <button type="button" className="regs-btn regs-btn-secondary regs-btn-toolbar" onClick={exportRosterCSV}>Export CSV</button>
                    {hasActiveFilters && (
                        <button type="button" className="regs-btn regs-btn-secondary" onClick={clearRosterFilters}>
                            Clear filters
                        </button>
                    )}
                </div>
                <p className="checkin-results-count" aria-live="polite">
                    Showing {filtered.length} of {rows.length} participants. Export includes every session for the filtered roster.
                </p>

                <div className="checkin-bulk">
                    <span>{viewingAllSessions ? `All sessions report · read only${activeSession ? ` · KPIs use ${activeSession.label}` : ""}` : `${selectedIds.length} selected`}</span>
                    <button
                        type="button"
                        className="regs-btn regs-btn-primary"
                        disabled={viewingAllSessions || busy || !activeSession?.open || selectedIds.length === 0}
                        onClick={() => void punch("in", selectedIds)}
                    >
                        Check in
                    </button>
                    <button
                        type="button"
                        className="regs-btn regs-btn-secondary"
                        disabled={viewingAllSessions || busy || !activeSession?.open || selectedIds.length === 0}
                        onClick={() => void punch("out", selectedIds)}
                    >
                        Check out
                    </button>
                    <button
                        type="button"
                        className="regs-btn regs-btn-secondary"
                        disabled={viewingAllSessions || busy || !activeSession?.open || selectedIds.length === 0}
                        onClick={() => void mark("Absent", selectedIds)}
                    >
                        Mark absent
                    </button>
                    <button
                        type="button"
                        className="regs-btn regs-btn-secondary"
                        disabled={viewingAllSessions || busy || !activeSession?.open || selectedIds.length === 0}
                        onClick={() => void mark("Excused", selectedIds)}
                    >
                        Mark excused
                    </button>
                </div>

                <div className="regs-table-wrapper">
                    <table>
                        <thead>
                            <tr>
                                <th className="checkin-check-col">
                                    <input
                                        type="checkbox"
                                            checked={!viewingAllSessions && allVisibleSelected}
                                            disabled={viewingAllSessions}
                                        onChange={toggleAllVisible}
                                        aria-label="Select all shown participants"
                                    />
                                </th>
                                <th className="checkin-th-sortable" onClick={() => toggleRosterSort("participant")}>
                                    Participant <SortIcon active={rosterSortKey === "participant"} dir={rosterSortDir} />
                                </th>
                                <th>Student ID</th>
                                <th>Event ID</th>
                                <th>Department</th>
                                <th>Course</th>
                                <th>Year</th>
                                <th>Block</th>
                                {viewingAllSessions ? sessions.map((session) => (
                                    <th key={session.id} className="checkin-session-report-head">
                                        {session.label}<small>{session.session_date}</small>
                                    </th>
                                )) : activeSession ? (
                                    <th className="checkin-th-sortable" onClick={() => toggleRosterSort("in")}>
                                        {activeSession.label} in <SortIcon active={rosterSortKey === "in"} dir={rosterSortDir} />
                                    </th>
                                ) : null}
                                {!viewingAllSessions && activeSession ? (
                                    <th className="checkin-th-sortable" onClick={() => toggleRosterSort("out")}>
                                        {activeSession.label} out <SortIcon active={rosterSortKey === "out"} dir={rosterSortDir} />
                                    </th>
                                ) : null}
                                {!viewingAllSessions && <th className="checkin-th-sortable" onClick={() => toggleRosterSort("status")}>
                                    Status <SortIcon active={rosterSortKey === "status"} dir={rosterSortDir} />
                                </th>}
                                <th className="checkin-th-sortable" onClick={() => toggleRosterSort("sessions")}>
                                    Sessions <SortIcon active={rosterSortKey === "sessions"} dir={rosterSortDir} />
                                </th>
                                <th aria-label="Actions" />
                            </tr>
                        </thead>
                        <tbody>
                            {loading && (
                                <tr><td className="regs-empty-row" colSpan={viewingAllSessions ? 10 + sessions.length : 13}>Loading roster…</td></tr>
                            )}
                            {!loading && filtered.length === 0 && (
                                <tr><td className="regs-empty-row" colSpan={viewingAllSessions ? 10 + sessions.length : 13}>No participants match those filters.</td></tr>
                            )}
                            {rosterPager.pageRows.map((row) => {
                                const state = activeSession ? row.sessions?.[String(activeSession.id)] : null;
                                const action = activeSession ? nextAction(state) : null;
                                const locked = !activeSession?.open;

                                return (
                                    <tr key={row.registration_id}>
                                        <td className="checkin-check-col">
                                            <input
                                                type="checkbox"
                                                checked={!viewingAllSessions && selected.has(row.registration_id)}
                                                disabled={viewingAllSessions}
                                                onChange={() => toggleOne(row.registration_id)}
                                                aria-label={`Select ${row.participant}`}
                                            />
                                        </td>
                                        <td>
                                            <div className="regs-cell">
                                                <span className="regs-row-avatar">{initialsOf(row.participant)}</span>
                                                <div className="regs-cell-text">
                                                    <span className="regs-cell-name">{row.participant}</span>
                                                    <span className="regs-cell-id">{row.reference}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="regs-cell-muted">{row.student_id ?? "—"}</td>
                                        <td className="regs-cell-muted">{row.event_reference ?? eventInfo?.reference ?? "—"}</td>
                                        <td className="regs-cell-muted">{row.department_name ?? row.department ?? "—"}</td>
                                        <td className="regs-cell-muted">{row.course ?? "—"}</td>
                                        <td className="regs-cell-muted">{row.year ?? "—"}</td>
                                        <td className="regs-cell-muted">{row.block_no ?? "—"}</td>
                                        {viewingAllSessions ? sessions.map((session) => {
                                            const sessionState = row.sessions?.[String(session.id)];
                                            const status = sessionState?.status ?? "Not Yet Recorded";
                                            return (
                                                <td key={session.id}>
                                                    <span className={`checkin-status checkin-status-${status.toLowerCase().replaceAll(" ", "-")}`}>
                                                        {STATUS_LABELS[status] ?? status}
                                                    </span>
                                                    <small className="checkin-session-report-times">
                                                        In {clockOf(sessionState?.time_in)} · Out {clockOf(sessionState?.time_out)}
                                                    </small>
                                                </td>
                                            );
                                        }) : <>
                                        <td>{clockOf(state?.time_in)}</td>
                                        <td>{clockOf(state?.time_out)}</td>
                                        <td>
                                            <span className={`checkin-status checkin-status-${(state?.status ?? "Not Yet Recorded").toLowerCase().replaceAll(" ", "-")}`}>
                                                {STATUS_LABELS[state?.status ?? "Not Yet Recorded"]}
                                            </span>
                                        </td>
                                        </>}
                                        <td>
                                            {row.sessions_complete}/{row.sessions_total}
                                        </td>
                                        <td>
                                            {action && !locked && !viewingAllSessions ? (
                                                <button
                                                    type="button"
                                                    className="regs-btn regs-btn-primary"
                                                    disabled={busy}
                                                    onClick={() => void punch(action, [row.registration_id])}
                                                >
                                                    {action === "in" ? "Check in" : "Check out"}
                                                </button>
                                            ) : (
                                                <span className="checkin-cell-note">
                                                    {viewingAllSessions ? "Use a session tab to act" : action ? "Session closed" : "Complete"}
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                <Pagination
                    {...rosterPager}
                    classPrefix="regs"
                    unit="participants"
                    loading={loading}
                />
                    </>
                )}
            </section>

            <ConfirmDialog
                open={pendingClose !== null}
                title="Close this session?"
                message={
                    pendingClose
                        ? `Closing ${pendingClose.label} stamps everyone still checked in as having left and stops further punches for that session.`
                        : ""
                }
                confirmLabel="Close session"
                onCancel={() => setPendingClose(null)}
                onConfirm={() => void confirmClose()}
            />
        </Shell>
    );
}

function CheckIn({ embedded = false }) {
    const { token } = useParams();
    const user = useUser();
    const handleLogout = useLogout();
    const { toast, showToast, dismissToast } = useToast();
    const [navOpen, setNavOpen] = useState(false);

    return (
        <>
            {token ? (
                <CheckInDesk
                    token={token}
                    user={user}
                    handleLogout={handleLogout}
                    navOpen={navOpen}
                    setNavOpen={setNavOpen}
                    showToast={showToast}
                    embedded={embedded}
                />
            ) : (
                <EventPicker
                    user={user}
                    handleLogout={handleLogout}
                    navOpen={navOpen}
                    setNavOpen={setNavOpen}
                    showToast={showToast}
                    embedded={embedded}
                />
            )}
            {toast && <Toast toast={toast} onDismiss={dismissToast} />}
        </>
    );
}

export default CheckIn;
