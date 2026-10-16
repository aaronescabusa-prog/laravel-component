import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import AppShell from "./components/AppShell";
import Toast from "./components/Toast";
import { IconDownload } from "./components/Icons";
import { api, attendanceApi, mapEventFromApi } from "./lib/api";
import { useToast } from "./lib/useToast";
import { downloadCSV, dateStamp } from "./lib/csv";
import { initialsOf } from "./lib/auth";
import "./AttendanceReports.css";

/**
 * Per-session attendance roster for one event.
 *
 * GET /events/{event}/attendance (AttendanceReportController) returns
 *   { event, sessions[], roster[], counts }
 * where each roster row has a `sessions` map keyed by session id (stringified)
 * holding { time_in, time_out, status, complete }. We render one column per
 * session and colour each cell by its punch status.
 *
 * `{event}` binds on the event `reference` (Event::getRouteKeyName), which is
 * what mapEventFromApi exposes as `id`.
 */

// Attendance model status constants (app/Models/Attendance.php).
const PRESENT = "Present";
const LATE = "Late";
const EXCUSED = "Excused";
const ABSENT = "Absent";
const NOT_RECORDED = "Not Yet Recorded";

const STATUS_CLASS = {
    [PRESENT]: "present",
    [LATE]: "late",
    [EXCUSED]: "excused",
    [ABSENT]: "absent",
    [NOT_RECORDED]: "not-recorded",
};

const STATUS_LABELS = {
    [NOT_RECORDED]: "—",
};

const statusOf = (punch) => {
    return punch?.status ?? NOT_RECORDED;
};

const statusClass = (status) => `events-cell-status-${STATUS_CLASS[status] ?? "not-recorded"}`;
const statusLabel = (status) => STATUS_LABELS[status] ?? status;

export default function AttendanceReports({ embedded = false }) {
    const [searchParams, setSearchParams] = useSearchParams();
    const { toast, showToast, dismissToast } = useToast();

    const [events, setEvents] = useState([]);
    const [eventsLoading, setEventsLoading] = useState(true);
    const [eventsError, setEventsError] = useState("");
    const [eventsReload, setEventsReload] = useState(0);
    const [eventSearch, setEventSearch] = useState("");
    const [eventSearchOpen, setEventSearchOpen] = useState(false);

    const selectedRef = searchParams.get("event") || "";
    const selectedEvent = events.find((event) => event.id === selectedRef);
    const matchingEvents = useMemo(() => {
        const query = eventSearch.trim().toLowerCase();
        if (!query) return events.slice(0, 8);
        return events.filter((event) =>
            [event.name, event.date, event.venue, event.id]
                .some((value) => String(value ?? "").toLowerCase().includes(query))
        ).slice(0, 8);
    }, [events, eventSearch]);
    const reportRequest = useRef(0);
    const [report, setReport] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [exporting, setExporting] = useState(false);

    // Load the event picker once (same mapping Events.jsx uses).
    useEffect(() => {
        let active = true;
        setEventsLoading(true);
        api
            .list("events", { per_page: "all" })
            .then((rows) => {
                if (!active) return;
                setEvents(rows.map(mapEventFromApi));
                setEventsError("");
            })
            .catch((err) => {
                if (active) setEventsError(err.message || "Could not load events.");
            })
            .finally(() => {
                if (active) setEventsLoading(false);
            });
        return () => {
            active = false;
        };
    }, [eventsReload]);

    const loadReport = useCallback(async (ref) => {
        const requestId = ++reportRequest.current;
        setReport(null);
        setDetailLoading(false);
        if (!ref) {
            setLoadError("");
            return;
        }
        setDetailLoading(true);
        setLoadError("");
        try {
            const payload = await attendanceApi.get(ref);
            if (requestId === reportRequest.current) setReport(payload);
        } catch (err) {
            if (requestId === reportRequest.current) {
                setReport(null);
                setLoadError(err.message || "Could not load the attendance roster.");
            }
        } finally {
            if (requestId === reportRequest.current) setDetailLoading(false);
        }
    }, []);

    useEffect(() => {
        loadReport(selectedRef);
    }, [selectedRef, loadReport]);

    const sessions = report?.sessions ?? [];
    const roster = report?.roster ?? [];
    const counts = report?.counts ?? { registered: 0, fully_recorded: 0 };

    const attendanceRate = useMemo(() => {
        const total = counts.registered ?? 0;
        if (!total) return 0;
        return Math.round(((counts.fully_recorded ?? 0) / total) * 100);
    }, [counts]);

    const exportCSV = async () => {
        if (!report) return;
        setExporting(true);
        try {
            const header = [
                "Event",
                "Participant",
                "Email",
                "Role",
                "Block No.",
                ...sessions.map((s) => `${s.label} (${s.session_date || ""})`),
            ];
            const rows = [
                header,
                ...roster.map((r) => [
                    report.event?.title ?? selectedRef,
                    r.participant,
                    r.email,
                    r.role,
                    r.block_no ?? "",
                    ...sessions.map((s) => {
                        const punch = r.sessions?.[String(s.id)];
                        const status = statusOf(punch);
                        return status === PRESENT ? "Present" : statusLabel(status);
                    }),
                ]),
            ];
            downloadCSV(
                `attendance-${report.event?.reference ?? dateStamp()}.csv`,
                rows
            );
            showToast(`Exported ${roster.length} registrations.`);
        } catch (err) {
            showToast(err.message || "Export failed.", "danger");
        } finally {
            setExporting(false);
        }
    };

    function selectEvent(reference) {
        setSearchParams((current) => {
            const next = new URLSearchParams(current);
            if (reference) next.set("event", reference);
            else next.delete("event");
            return next;
        });
    }


    const content = (
        <div className="attendance-page">
                <section className="attendance-filter-panel" aria-label="Attendance report filters">
                    <div className="attendance-event-field">
                        <label htmlFor="attendanceEventSearch">Search events</label>
                        <div className="attendance-event-search">
                            <input
                                id="attendanceEventSearch"
                                type="search"
                                value={eventSearch}
                                onChange={(e) => {
                                    setEventSearch(e.target.value);
                                    setEventSearchOpen(true);
                                }}
                                onFocus={() => setEventSearchOpen(true)}
                                onBlur={() => window.setTimeout(() => setEventSearchOpen(false), 120)}
                                placeholder={eventsLoading ? "Loading events…" : "Search by event, date, or venue"}
                                aria-label="Search events by name, date, or venue"
                                aria-controls="attendance-event-results"
                                aria-expanded={eventSearchOpen && !eventsLoading && !eventsError}
                                autoComplete="off"
                                disabled={eventsLoading || !!eventsError}
                            />
                            {eventSearchOpen && !eventsLoading && !eventsError && (
                                <div id="attendance-event-results" className="attendance-event-results" role="listbox" aria-label="Matching events">
                                    {matchingEvents.length ? matchingEvents.map((event) => (
                                        <button
                                            key={event.id}
                                            type="button"
                                            role="option"
                                            aria-selected={event.id === selectedRef}
                                            className="attendance-event-result"
                                            onMouseDown={(e) => e.preventDefault()}
                                            onClick={() => {
                                                selectEvent(event.id);
                                                setEventSearch("");
                                                setEventSearchOpen(false);
                                            }}
                                        >
                                            <span>{event.name}</span>
                                            <small>{[event.date, event.venue].filter(Boolean).join(" · ")}</small>
                                        </button>
                                    )) : (
                                        <p className="attendance-event-no-results">No matching events.</p>
                                    )}
                                </div>
                            )}
                        </div>
                        {selectedEvent && (
                            <p className="attendance-selected-event">
                                Showing: <strong>{selectedEvent.name}</strong>
                                <button type="button" onClick={() => selectEvent("")} aria-label="Clear selected event">Clear</button>
                            </p>
                        )}
                        {eventsError && <p className="attendance-error-text">{eventsError}</p>}
                        {eventsError && (
                            <button
                                type="button"
                                className="events-btn events-btn-secondary attendance-retry"
                                onClick={() => setEventsReload((value) => value + 1)}
                                disabled={eventsLoading}
                            >
                                Try again
                            </button>
                        )}
                    </div>

                    {report && (
                        <div className="attendance-event-summary">
                            <div>
                                <h2>{report.event?.title ?? "Attendance"}</h2>
                                <p>
                                    {[report.event?.event_date, report.event?.venue].filter(Boolean).join(" · ")}
                                </p>
                            </div>
                            <button
                                type="button"
                                className="events-btn events-btn-primary"
                                onClick={exportCSV}
                                disabled={exporting || roster.length === 0}
                            >
                                <IconDownload size={15} />
                                {exporting ? "Exporting…" : "Export CSV"}
                            </button>
                        </div>
                    )}
                </section>

                {!selectedRef && !eventsLoading && !eventsError && (
                    <div className="attendance-state">
                        Pick an event to view its attendance roster.
                    </div>
                )}

                {selectedRef && loadError && (
                    <div className="attendance-state attendance-state-error" role="alert">
                        {loadError}
                    </div>
                )}

                {selectedRef && detailLoading && !report && !loadError && (
                    <div className="attendance-state" role="status">Loading attendance…</div>
                )}

                {selectedRef && report && (
                    <div className="attendance-report">
                        {sessions.length === 0 && (
                            <div className="attendance-state" role="status">
                                No attendance sessions are configured for this event yet. The roster below shows registered participants only.
                            </div>
                        )}
                        <div className="events-kpi-strip">
                            <div className="events-kpi-item">
                                <span className="events-kpi-value">{counts.registered ?? 0}</span>
                                <span className="events-kpi-label">Registered</span>
                            </div>
                            <div className="events-kpi-item">
                                <span className="events-kpi-value">{counts.fully_recorded ?? 0}</span>
                                <span className="events-kpi-label">Fully recorded</span>
                            </div>
                            <div className="events-kpi-item events-kpi-alert">
                                <span className="events-kpi-value">{attendanceRate}%</span>
                                <span className="events-kpi-label">Attendance rate</span>
                            </div>
                        </div>

                        <div className="attendance-table-wrapper events-table-wrapper">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Participant</th>
                                        <th>Role</th>
                                        <th>Block No.</th>
                                        {sessions.map((session) => (
                                            <th key={session.id} className="attendance-session-head">
                                                {session.label}
                                                <span className="events-cell-muted">
                                                    {session.session_date}
                                                </span>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {roster.length === 0 ? (
                                        <tr>
                                            <td
                                                className="events-empty-row"
                                                colSpan={3 + sessions.length}
                                            >
                                                No participants are registered for this event yet.
                                            </td>
                                        </tr>
                                    ) : (
                                        roster.map((registration) => (
                                            <tr key={registration.registration_id}>
                                                <td>
                                                    <div className="user-cell">
                                                        <span className="row-avatar">
                                                            {initialsOf(registration.participant)}
                                                        </span>
                                                        <div className="user-cell-text">
                                                            <span className="user-cell-name">
                                                                {registration.participant}
                                                            </span>
                                                            <span className="user-cell-id">
                                                                {registration.reference}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="events-cell-muted">
                                                    {registration.role}
                                                </td>
                                                <td className="events-cell-muted">
                                                    {registration.block_no ?? ""}
                                                </td>
                                                {sessions.map((session) => {
                                                    const punch =
                                                        registration.sessions?.[String(session.id)];
                                                    const status = statusOf(punch);
                                                    return (
                                                        <td key={session.id} title={status}>
                                                            <span className={`attendance-status ${statusClass(status)}`}>
                                                                {statusLabel(status)}
                                                            </span>
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
    );

    return (
        <>
            {embedded ? content : (
                <AppShell
                    title="Attendance Reports"
                    subtitle="Per-session punch status for every registered participant."
                >
                    {content}
                </AppShell>
            )}
            {toast && <Toast {...toast} onDismiss={dismissToast} />}
        </>
    );
}

