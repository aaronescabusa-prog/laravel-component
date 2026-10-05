import { useEffect, useMemo, useState } from "react";
import "./Events.css";
import AppShell from "./components/AppShell";
import Toast from "./components/Toast";
import ConfirmDialog from "./components/ConfirmDialog";
import { useToast } from "./lib/useToast";
import { logActivity, nextId } from "./lib/storage";
import { api, mapEventFromApi, mapEventToApi, EVENT_CATEGORIES, EVENT_STATUSES } from "./lib/api";
import { downloadCSV, dateStamp } from "./lib/csv";
import { usePagination } from "./lib/usePagination";
import { useRowSelection } from "./lib/useRowSelection";
import Pagination from "./components/Pagination";
import { ActionIcon, IconView, IconEdit, IconCheck, IconX, IconTrash } from "./components/Icons";

function initialsOf(text) {
    return String(text ?? "")
        .split(" ")
        .filter(Boolean)
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
}
const CATEGORIES = EVENT_CATEGORIES;
const STATUSES = EVENT_STATUSES;

/**
 * Shown when no course is chosen: the event is offered to everyone and shows up
 * in listings and search.
 */
const PUBLIC_AUDIENCE = "";

/**
 * "8 hours" / "3 days", or an em dash when the event has no end date yet.
 *
 * Mirrors Event::durationLabel() on the server so the table, the detail view
 * and the CSV export all read the same way.
 */
function durationLabel(row) {
    const value = Number(row?.durationValue);
    if (!Number.isFinite(value) || value <= 0) return "—";

    const noun = row.durationUnit === "Days" ? "day" : "hour";
    return `${value} ${value === 1 ? noun : `${noun}s`}`;
}

function Events() {
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [pendingDelete, setPendingDelete] = useState(null);
    const [bulkBusy, setBulkBusy] = useState(false);
    const { toast, showToast, dismissToast } = useToast();
    const [search, setSearch] = useState("");
    const [categoryFilter, setCategoryFilter] = useState("all");
    const [statusFilter, setStatusFilter] = useState("all");
    const [sortKey, setSortKey] = useState("date");
    const [sortDir, setSortDir] = useState("asc");
    const [editingEvent, setEditingEvent] = useState(null);
    const [isNewEvent, setIsNewEvent] = useState(false);
    const [viewingEvent, setViewingEvent] = useState(null);
    const [courses, setCourses] = useState([]);

    useEffect(() => {
        let active = true;
        api.list("events")
            .then((rows) => { if (active) setEvents(rows.map(mapEventFromApi)); })
            .catch((err) => { if (active) setLoadError(err.message); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, []);

    // Feeds the Target courses picker. A failure only narrows the
    // picker to its public option, so it is not surfaced as a page error.
    useEffect(() => {
        let active = true;
        api.courses()
            .then((list) => { if (active) setCourses(list); })
            .catch(() => { if (active) setCourses([]); });
        return () => { active = false; };
    }, []);

    const filteredRows = useMemo(() => {
        let rows = events.filter((row) => {
            const term = search.trim().toLowerCase();
            const matchesSearch = !term || row.name.toLowerCase().includes(term) || row.organizer.toLowerCase().includes(term);
            const matchesCategory = categoryFilter === "all" || row.category === categoryFilter;
            const matchesStatus = statusFilter === "all" || row.status.toLowerCase() === statusFilter;
            return matchesSearch && matchesCategory && matchesStatus;
        });

        rows = [...rows].sort((a, b) => {
            const dir = sortDir === "asc" ? 1 : -1;
            if (a[sortKey] < b[sortKey]) return -1 * dir;
            if (a[sortKey] > b[sortKey]) return 1 * dir;
            return 0;
        });

        return rows;
    }, [events, search, categoryFilter, statusFilter, sortKey, sortDir]);

    const pager = usePagination(filteredRows, {
        resetKey: [search, categoryFilter, statusFilter, sortKey, sortDir].join("|"),
    });

    const selection = useRowSelection({
        pageRows: pager.pageRows,
        matchingRows: filteredRows,
        resetKey: [search, categoryFilter, statusFilter, sortKey, sortDir].join("|"),
    });

    function toggleSort(key) {
        if (sortKey === key) {
            setSortDir(sortDir === "asc" ? "desc" : "asc");
        } else {
            setSortKey(key);
            setSortDir("asc");
        }
    }

    function exportCSV() {
        const rows = [
            ["Event", "Category", "Target courses", "Organizer", "Date", "Time", "Duration", "Venue", "Status", "Participants", "Capacity"],
            ...filteredRows.map((r) => [r.name, r.category, r.targetCourse || "All courses", r.organizer, r.date, r.startTime, durationLabel(r), r.venue, r.status, r.participants, r.hasCapacity ? r.capacity : "No limit"]),
        ];
        downloadCSV(`events-${dateStamp()}.csv`, rows);
        showToast(`Exported ${filteredRows.length} event${filteredRows.length === 1 ? "" : "s"}.`);
    }

    function setStatus(row, status) {
        const next = { ...row, status: row.status === status ? row.status : status };
        setEvents((prev) => prev.map((e) => (e._id === row._id ? next : e)));
        api.update("events", row.id, mapEventToApi(next))
            .then((updated) => {
                setEvents((prev) => prev.map((e) => (e._id === row._id ? mapEventFromApi(updated) : e)));
                // A status change re-runs the audience match, so it can enrol
                // people just as a full save does.
                if (audienceNote(updated)) showToast(audienceNote(updated));
            })
            .catch((err) => showToast(err.message, "danger"));
        logActivity({
            category: "Event",
            action: `${status} event ${row.id}`,
            details: `${row.name} · ${row.venue}`,
        });
        showToast(`${row.name} marked as ${status}.`);
    }

    /* ---------- Course audience auto-enrolment ---------- */

    // Saving an event enrols everyone in its target course, which would
    // otherwise happen invisibly: the roster grows and nobody is told why.
    // Returns the note to show, or null when the save enrolled nobody.
    function audienceNote(result) {
        const audience = result?.audience;
        const added = audience?.added?.length ?? 0;
        if (!audience?.target_course || !added) return null;
        return `${added} from ${audience.target_course} automatically registered.`;
    }

    /* ---------- Delete (behind a confirmation) ---------- */

    function requestDelete(row) {
        setPendingDelete({ rows: [row], label: `${row.name} (${row.id})` });
    }

    /** Same columns as exportCSV, narrowed to whatever is ticked. */
    function exportSelectedCSV() {
        const rows = [
            ["Event", "Category", "Target courses", "Organizer", "Date", "Time", "Duration", "Venue", "Status", "Participants", "Capacity"],
            ...selection.selectedRows.map((r) => [r.name, r.category, r.targetCourse || "All courses", r.organizer, r.date, r.startTime, durationLabel(r), r.venue, r.status, r.participants, r.hasCapacity ? r.capacity : "No limit"]),
        ];
        downloadCSV(`events-selected-${dateStamp()}.csv`, rows);
        showToast(`Exported ${selection.selectedRows.length} selected event${selection.selectedRows.length === 1 ? "" : "s"}.`);
    }

    function requestBulkDelete() {
        const rows = selection.selectedRows;
        if (rows.length === 0) return;
        setPendingDelete({
            rows,
            label: `${rows.length} selected event${rows.length === 1 ? "" : "s"}`,
        });
    }

    /**
     * Move every ticked event to one status.
     *
     * Applied optimistically, one update per row through the ordinary endpoint
     * so each one is authorised exactly as a single change would be. A row that
     * the server rejects is re-read rather than left showing a status it never
     * reached.
     */
    async function bulkSetStatus(status) {
        const rows = selection.selectedRows;
        if (rows.length === 0) return;

        setBulkBusy(true);

        const previous = rows.map((row) => ({ _id: row._id, status: row.status }));

        // Optimistic: show the new status immediately.
        setEvents((prev) => prev.map((e) => (
            selection.isSelected(e.id) ? { ...e, status } : e
        )));

        const failed = [];

        for (const row of rows) {
            try {
                const updated = await api.update("events", row.id, mapEventToApi({ ...row, status }));
                setEvents((prev) => prev.map((e) => (e._id === row._id ? mapEventFromApi(updated) : e)));
            } catch (err) {
                failed.push(`${row.name} (${err.message})`);
            }
        }

        // Put back anything that did not stick.
        if (failed.length > 0) {
            setEvents((prev) => prev.map((e) => {
                const before = previous.find((p) => p._id === e._id);
                return before ? { ...e, status: before.status } : e;
            }));
        }

        logActivity({
            category: "Event",
            action: `${status} ${rows.length} event${rows.length === 1 ? "" : "s"}`,
            details: rows.map((r) => `${r.name} (${r.id})`).join(", "),
        });

        showToast(
            failed.length > 0
                ? `${rows.length - failed.length} updated, ${failed.length} failed: ${failed[0]}`
                : `${rows.length} event${rows.length === 1 ? "" : "s"} marked as ${status}.`,
            failed.length > 0 ? "danger" : "success"
        );

        setBulkBusy(false);
    }

    function confirmDelete() {
        const rows = pendingDelete?.rows ?? [];
        const ids = rows.map((r) => r.id);

        Promise.all(rows.map((r) => api.remove("events", r.id)))
            .then(() => {
                setEvents((prev) => prev.filter((e) => !ids.includes(e.id)));
                logActivity({
                    category: "Event",
                    action: `Deleted ${ids.length} event${ids.length === 1 ? "" : "s"}`,
                    details: rows.map((r) => `${r.name} (${r.id})`).join(", "),
                });
                showToast(`${ids.length} event${ids.length === 1 ? "" : "s"} deleted.`);
            })
            .catch((err) => showToast(err.message, "danger"))
            .finally(() => setPendingDelete(null));
    }

    function openEdit(row) {
        // All-day is not stored as a flag: it is simply the absence of times,
        // so it is read back off the row rather than round-tripped.
        setEditingEvent({ ...row, allDay: !row.startTime && !row.endTime, hasCapacity: row.hasCapacity });
        setIsNewEvent(false);
    }

    function openCreate() {
        setEditingEvent({
            id: nextId(events, "EVT", 3001),
            name: "",
            category: "Seminar",
            organizer: "",
            date: "",
            startTime: "08:00",
            endDate: "",
            endTime: "17:00",
            allDay: false,
            venue: "",
            targetRole: "All",
            targetCourse: PUBLIC_AUDIENCE,
            description: "",
            budget: 0,
            status: "Draft",
            participants: 0,
            // Uncapped by default: an event nobody has put a limit on.
            hasCapacity: false,
            capacity: null,
            hasCertificate: true,
        });
        setIsNewEvent(true);
    }

    function saveEvent() {
        const item = { ...editingEvent };
        if (!item.name.trim() || !item.date || !item.venue.trim()) {
            showToast("Event name, date and venue are required.", "danger");
            return;
        }

        const payload = mapEventToApi(item);

        if (isNewEvent) {
            api.create("events", payload)
                .then((created) => {
                    setEvents((prev) => [mapEventFromApi(created), ...prev]);
                    logActivity({
                        category: "Event",
                        action: `Created event ${created.reference}`,
                        details: `${item.name} · ${item.date} · ${item.venue}`,
                    });
                    showToast(
                        `${item.name} was created.${audienceNote(created) ? ` ${audienceNote(created)}` : ""}`,
                    );
                    setEditingEvent(null);
                })
                .catch((err) => showToast(err.message, "danger"));
        } else {
            api.update("events", item.id, payload)
                .then((updated) => {
                    setEvents((prev) => prev.map((e) => (e._id === item._id ? mapEventFromApi(updated) : e)));
                    logActivity({
                        category: "Event",
                        action: `Updated event ${item.id}`,
                        details: `${item.name} · ${item.status}`,
                    });
                    showToast(
                        `${item.name} was updated.${audienceNote(updated) ? ` ${audienceNote(updated)}` : ""}`,
                    );
                    setEditingEvent(null);
                })
                .catch((err) => showToast(err.message, "danger"));
        }
    }

    const totalEvents = events.length;
    const upcoming = events.filter((e) => e.status === "Approved" && new Date(e.date) >= new Date("2026-09-06")).length;
    const pendingApproval = events.filter((e) => e.status === "Pending").length;
    const completedThisMonth = events.filter((e) => e.status === "Completed").length;

    return (
        <AppShell title="Events" prefix="events-">

            {loadError && (
                <div className="events-empty-row" role="alert">Could not load events: {loadError}</div>
            )}

            <div className="events-kpi-strip">
                <div className="events-kpi-item">
                    <span className="events-kpi-label">Total Events</span>
                    <span className="events-kpi-value">{totalEvents}</span>
                </div>
                <div className="events-kpi-item">
                    <span className="events-kpi-label">Upcoming (Approved)</span>
                    <span className="events-kpi-value">{upcoming}</span>
                </div>
                <div className="events-kpi-item events-kpi-alert">
                    <span className="events-kpi-label">Pending Approval</span>
                    <span className="events-kpi-value">{pendingApproval}</span>
                </div>
                <div className="events-kpi-item">
                    <span className="events-kpi-label">Completed</span>
                    <span className="events-kpi-value">{completedThisMonth}</span>
                </div>
            </div>

            <section className="events-panel">
                <div className="events-panel-header">
                    <h2>All Events</h2>
                    <button className="events-btn events-btn-primary" onClick={openCreate}>+ Create Event</button>
                </div>

                <div className="events-toolbar">
                    <input
                        type="text"
                        className="events-input-search"
                        placeholder="Search by event name or organizer"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        aria-label="Search events"
                    />

                    <select
                        className="events-input-select"
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                        aria-label="Filter by category"
                    >
                        <option value="all">All categories</option>
                        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>

                    <select
                        className="events-input-select"
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        aria-label="Filter by status"
                    >
                        <option value="all">All statuses</option>
                        {STATUSES.map((s) => <option key={s} value={s.toLowerCase()}>{s}</option>)}
                    </select>

                    <button className="events-btn events-btn-secondary events-btn-toolbar" onClick={exportCSV}>Export CSV</button>
                </div>

                {selection.selectedCount > 0 && (
                    <div className="bulk-bar">
                        <span>{selection.selectedCount} selected</span>

                        {selection.pageOnlySelection && (
                            <span className="bulk-select-all">
                                All {selection.pageCount} on this page selected.
                                <button type="button" className="bulk-select-all-link" onClick={selection.selectAllMatching}>
                                    Select all {selection.matchingCount} matching
                                </button>
                            </span>
                        )}

                        {selection.allMatchingSelected && selection.matchingCount > selection.pageCount && (
                            <span className="bulk-select-all">
                                All {selection.matchingCount} matching rows selected.
                            </span>
                        )}

                        <div className="bulk-bar-actions">
                            <button className="events-btn events-btn-secondary" onClick={() => bulkSetStatus("Approved")} disabled={bulkBusy}>
                                Approve selected
                            </button>
                            <button className="events-btn events-btn-secondary" onClick={() => bulkSetStatus("Rejected")} disabled={bulkBusy}>
                                Reject selected
                            </button>
                            <button className="events-btn events-btn-secondary" onClick={exportSelectedCSV} disabled={bulkBusy}>
                                Export selected
                            </button>
                            <button className="events-btn events-btn-secondary events-btn-danger-outline" onClick={requestBulkDelete} disabled={bulkBusy}>
                                Delete selected
                            </button>
                            <button className="btn-clear" onClick={selection.clear} disabled={bulkBusy}>Clear</button>
                        </div>
                    </div>
                )}

                <div className="events-table-wrapper">
                    <table>
                        <thead>
                            <tr>
                                <th className="th-checkbox">
                                    <input
                                        type="checkbox"
                                        checked={selection.pageAllSelected}
                                        ref={(node) => {
                                            if (node) {
                                                node.indeterminate = selection.pageSomeSelected;
                                            }
                                        }}
                                        onChange={selection.togglePage}
                                        aria-label="Select all events on this page"
                                    />
                                </th>
                                <th className="events-th-sortable" onClick={() => toggleSort("name")}>
                                    Event Name <SortIcon active={sortKey === "name"} dir={sortDir} />
                                </th>
                                <th>Category</th>
                                <th>Target courses</th>
                                <th>Organizer</th>
                                <th className="events-th-sortable" onClick={() => toggleSort("date")}>
                                    Date <SortIcon active={sortKey === "date"} dir={sortDir} />
                                </th>
                                <th>Time</th>
                                <th>Duration</th>
                                <th>Venue</th>
                                <th>Status</th>
                                <th>Participants</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {pager.pageRows.map((row) => (
                                <tr key={row.id} className={selection.isSelected(row.id) ? "row-selected" : ""}>
                                    <td className="th-checkbox">
                                        <input
                                            type="checkbox"
                                            checked={selection.isSelected(row.id)}
                                            onChange={() => selection.toggleOne(row.id)}
                                            aria-label={`Select ${row.name}`}
                                        />
                                    </td>
                                    <td>
                                        <div className="events-cell">
                                            <span className="events-row-icon">{initialsOf(row.category)}</span>
                                            <div className="events-cell-text">
                                                <span className="events-cell-name">{row.name}</span>
                                                <span className="events-cell-id">{row.id}</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="events-cell-muted">{row.category}</td>
                                    <td className="events-cell-muted">{row.targetCourse || "All courses"}</td>
                                    <td className="events-cell-muted">{row.organizer}</td>
                                    <td className="events-cell-muted">{row.date}</td>
                                    <td className="events-cell-muted">{row.startTime}</td>
                                    <td className="events-cell-muted">{durationLabel(row)}</td>
                                    <td className="events-cell-muted">{row.venue}</td>
                                    <td>
                                        <span className={`events-status events-status-${row.status.toLowerCase()}`}>
                                            {row.status}
                                        </span>
                                    </td>
                                    <td className="events-cell-muted">
                                        {row.participants}
                                        {row.hasCapacity ? `/${row.capacity}` : ""}
                                    </td>
                                    <td className="events-cell-actions">
                                        <ActionIcon icon={IconView} label="View" onClick={() => setViewingEvent(row)} />
                                        <ActionIcon icon={IconEdit} label="Edit" onClick={() => openEdit(row)} />
                                        {row.status === "Pending" && (
                                            <ActionIcon icon={IconCheck} label="Approve" tone="approve" onClick={() => setStatus(row, "Approved")} />
                                        )}
                                        {(row.status === "Approved" || row.status === "Pending") && (
                                            <ActionIcon icon={IconX} label="Cancel" tone="danger" onClick={() => setStatus(row, "Cancelled")} />
                                        )}
                                        <ActionIcon icon={IconTrash} label="Delete" tone="danger" onClick={() => requestDelete(row)} />
                                    </td>
                                </tr>
                            ))}
                            {filteredRows.length === 0 && (
                                <tr>
                                    <td colSpan="11" className="events-empty-row">No events match your filters.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                <Pagination
                    {...pager}
                    unit="events"
                    loading={loading}
                />
            </section>


            {viewingEvent && (
                <div className="events-modal-overlay" onClick={() => setViewingEvent(null)}>
                    <div className="events-modal-card" onClick={(e) => e.stopPropagation()}>
                        <div className="events-modal-header">
                            <h3>{viewingEvent.name}</h3>
                            <button className="events-modal-close" onClick={() => setViewingEvent(null)} aria-label="Close">×</button>
                        </div>
                        <div className="events-modal-body">
                            <dl className="events-detail-list">
                                <dt>Event ID</dt><dd>{viewingEvent.id}</dd>
                                <dt>Category</dt><dd>{viewingEvent.category}</dd>
                                <dt>Target courses</dt>
                                <dd>{viewingEvent.targetCourse || "All courses"}</dd>
                                <dt>Organizer</dt><dd>{viewingEvent.organizer}</dd>
                                <dt>Date</dt><dd>{viewingEvent.date}</dd>
                                <dt>Start time</dt>
                                <dd>
                                    {!viewingEvent.startTime && !viewingEvent.endTime
                                        ? "All day"
                                        : viewingEvent.startTime}
                                </dd>
                                <dt>End</dt>
                                <dd>
                                    {viewingEvent.endDate || "—"}
                                    {viewingEvent.endDate && viewingEvent.endTime
                                        ? ` · ${viewingEvent.endTime}`
                                        : ""}
                                </dd>
                                <dt>Duration</dt><dd>{durationLabel(viewingEvent)}</dd>
                                <dt>Venue</dt><dd>{viewingEvent.venue}</dd>
                                <dt>Budget</dt><dd>₱{Number(viewingEvent.budget || 0).toLocaleString()}</dd>
                                <dt>Description</dt><dd>{viewingEvent.description || "—"}</dd>
                                <dt>Status</dt><dd><span className={`events-status events-status-${viewingEvent.status.toLowerCase()}`}>{viewingEvent.status}</span></dd>
                                <dt>Participants</dt><dd>{viewingEvent.participants}{viewingEvent.hasCapacity ? ` / ${viewingEvent.capacity}` : " (no capacity limit)"}</dd>
                            </dl>
                        </div>
                        <div className="events-modal-footer">
                            <button className="events-btn events-btn-secondary" onClick={() => setViewingEvent(null)}>Close</button>
                            <button className="events-btn events-btn-primary" onClick={() => { setViewingEvent(null); openEdit(viewingEvent); }}>Edit Event</button>
                        </div>
                    </div>
                </div>
            )}

            {editingEvent && (
                <div className="events-modal-overlay" onClick={() => setEditingEvent(null)}>
                    <div className="events-modal-card" onClick={(e) => e.stopPropagation()}>
                        <div className="events-modal-header">
                            <h3>{isNewEvent ? "Create Event" : "Edit Event"}</h3>
                            <button className="events-modal-close" onClick={() => setEditingEvent(null)} aria-label="Close">×</button>
                        </div>
                        <div className="events-modal-body">
                            <div className="events-form-group">
                                <label htmlFor="evName">Event name</label>
                                <input
                                    id="evName"
                                    type="text"
                                    value={editingEvent.name}
                                    onChange={(e) => setEditingEvent({ ...editingEvent, name: e.target.value })}
                                />
                            </div>

                            <div className="events-form-row-split">
                                <div className="events-form-group">
                                    <label htmlFor="evCategory">Category</label>
                                    <select
                                        id="evCategory"
                                        value={editingEvent.category}
                                        onChange={(e) => setEditingEvent({ ...editingEvent, category: e.target.value })}
                                    >
                                        {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                                    </select>
                                </div>
                                <div className="events-form-group">
                                    <label htmlFor="evStatus">Status</label>
                                    <select
                                        id="evStatus"
                                        value={editingEvent.status}
                                        onChange={(e) => setEditingEvent({ ...editingEvent, status: e.target.value })}
                                    >
                                        {STATUSES.map((s) => <option key={s}>{s}</option>)}
                                    </select>
                                </div>
                            </div>

                                <div className="events-form-group events-form-group-wide">
                                    <label htmlFor="evAudience">Target courses</label>
                                    <select
                                        id="evAudience"
                                        value={editingEvent.targetCourse ?? PUBLIC_AUDIENCE}
                                        onChange={(e) => setEditingEvent({ ...editingEvent, targetCourse: e.target.value })}
                                    >
                                        <option value={PUBLIC_AUDIENCE}>All courses</option>
                                        {courses.map((course) => (
                                            <option key={course} value={course}>
                                                {course}
                                            </option>
                                        ))}
                                    </select>
                                    <small className="events-form-hint">
                                        Choose All courses to list the event for everyone, or limit it to one course.
                                    </small>
                                </div>
                                <div className="events-form-group">
                                    <label htmlFor="evOrganizer">Organizer</label>
                                    <input
                                        id="evOrganizer"
                                        type="text"
                                        value={editingEvent.organizer}
                                        onChange={(e) => setEditingEvent({ ...editingEvent, organizer: e.target.value })}
                                    />
                                </div>

                            <div className="events-form-section">
                                <h4 className="events-form-section-title">Date and time</h4>

                                <label className="events-form-checkbox">
                                    <input
                                        type="checkbox"
                                        checked={Boolean(editingEvent.allDay)}
                                        onChange={(e) => {
                                            const allDay = e.target.checked;
                                            setEditingEvent({
                                                ...editingEvent,
                                                allDay,
                                                // An all-day event spans whole days,
                                                // so it carries no times.
                                                startTime: allDay ? "" : editingEvent.startTime || "08:00",
                                                endTime: allDay ? "" : editingEvent.endTime || "17:00",
                                            });
                                        }}
                                    />
                                    <span>All-day event</span>
                                </label>

                                <div className="events-form-row-split">
                                    <div className="events-form-group">
                                        <label htmlFor="evDate">
                                            Start date <span className="events-required">*</span>
                                        </label>
                                        <input
                                            id="evDate"
                                            type="date"
                                            value={editingEvent.date}
                                            onChange={(e) => {
                                                const date = e.target.value;
                                                setEditingEvent({
                                                    ...editingEvent,
                                                    date,
                                                    // Default the end to the same day,
                                                    // and pull it forward when the new
                                                    // start would otherwise overtake it.
                                                    endDate:
                                                        !editingEvent.endDate || editingEvent.endDate < date
                                                            ? date
                                                            : editingEvent.endDate,
                                                });
                                            }}
                                        />
                                    </div>
                                    <div className="events-form-group">
                                        <label htmlFor="evTime">
                                            Start time <span className="events-required">*</span>
                                        </label>
                                        <input
                                            id="evTime"
                                            type="time"
                                            value={editingEvent.startTime || ""}
                                            disabled={editingEvent.allDay}
                                            onChange={(e) => setEditingEvent({ ...editingEvent, startTime: e.target.value })}
                                        />
                                    </div>
                                </div>

                                <div className="events-form-row-split">
                                    <div className="events-form-group">
                                        <label htmlFor="evEndDate">
                                            End date <span className="events-required">*</span>
                                        </label>
                                        <input
                                            id="evEndDate"
                                            type="date"
                                            min={editingEvent.date || undefined}
                                            value={editingEvent.endDate || ""}
                                            onChange={(e) => setEditingEvent({ ...editingEvent, endDate: e.target.value })}
                                        />
                                    </div>
                                    <div className="events-form-group">
                                        <label htmlFor="evEndTime">
                                            End time <span className="events-required">*</span>
                                        </label>
                                        <input
                                            id="evEndTime"
                                            type="time"
                                            value={editingEvent.endTime || ""}
                                            disabled={editingEvent.allDay}
                                            onChange={(e) => setEditingEvent({ ...editingEvent, endTime: e.target.value })}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="events-form-row-split">
                                <div className="events-form-group events-form-group-wide">
                                    <label className="events-form-checkbox">
                                        <input
                                            type="checkbox"
                                            checked={Boolean(editingEvent.hasCapacity)}
                                            onChange={(e) => {
                                                const on = e.target.checked;
                                                setEditingEvent({
                                                    ...editingEvent,
                                                    hasCapacity: on,
                                                    // Uncapped means no number at all,
                                                    // which the API sends as null.
                                                    capacity: on ? editingEvent.capacity || 100 : null,
                                                });
                                            }}
                                        />
                                        <span>Limit capacity</span>
                                    </label>
                                    {editingEvent.hasCapacity && (
                                        <div className="events-form-subgroup">
                                            <label htmlFor="evCapacity">Capacity</label>
                                            <input
                                                id="evCapacity"
                                                type="number"
                                                min="1"
                                                value={editingEvent.capacity ?? ""}
                                                onChange={(e) =>
                                                    setEditingEvent({
                                                        ...editingEvent,
                                                        capacity: e.target.value === "" ? null : Number(e.target.value),
                                                    })
                                                }
                                            />
                                            <small className="events-form-hint">
                                                Advisory only: registrations are not blocked once this is reached.
                                            </small>
                                        </div>
                                    )}
                                </div>
                                <div className="events-form-group">
                                    <label htmlFor="evBudget">Budget (₱)</label>
                                    <input
                                        id="evBudget"
                                        type="number"
                                        min="0"
                                        value={editingEvent.budget}
                                        onChange={(e) => setEditingEvent({ ...editingEvent, budget: Number(e.target.value) })}
                                    />
                                </div>
                            </div>


                            <div className="events-form-group">
                                <label htmlFor="evVenue">Venue</label>
                                <input
                                    id="evVenue"
                                    type="text"
                                    value={editingEvent.venue}
                                    onChange={(e) => setEditingEvent({ ...editingEvent, venue: e.target.value })}
                                />
                            </div>

                            <div className="events-form-group">
                                <label htmlFor="evDescription">Description</label>
                                <textarea
                                    id="evDescription"
                                    rows="3"
                                    value={editingEvent.description}
                                    onChange={(e) => setEditingEvent({ ...editingEvent, description: e.target.value })}
                                />
                            </div>

                            <div className="events-form-group events-cert-toggle-row">
                                <div className="events-cert-toggle-top">
                                    <label htmlFor="evHasCertificate">Issue certificates for this event</label>
                                    <button
                                        type="button"
                                        id="evHasCertificate"
                                        role="switch"
                                        aria-checked={Boolean(editingEvent.hasCertificate ?? true)}
                                        aria-label="Issue certificates for this event"
                                        className={`events-toggle${(editingEvent.hasCertificate ?? true) ? " events-toggle-on" : ""}`}
                                        onClick={() => setEditingEvent({ ...editingEvent, hasCertificate: !(editingEvent.hasCertificate ?? true) })}
                                    >
                                        <span className="events-toggle-knob" aria-hidden="true" />
                                    </button>
                                </div>
                                <span className="events-cert-toggle-hint">
                                    {editingEvent.hasCertificate ?? true
                                        ? "Certificates can be issued to participants."
                                        : "No certificates will be issued for this event."}
                                </span>
                            </div>
                        </div>
                        <div className="events-modal-footer">
                            <button className="events-btn events-btn-secondary" onClick={() => setEditingEvent(null)}>Cancel</button>
                            <button className="events-btn events-btn-primary" onClick={saveEvent}>
                                {isNewEvent ? "Create Event" : "Save Changes"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <ConfirmDialog
                open={Boolean(pendingDelete)}
                title="Delete event"
                message={pendingDelete ? `Permanently delete ${pendingDelete.label}? This cannot be undone.` : ""}
                confirmLabel="Delete event"
                onConfirm={confirmDelete}
                onCancel={() => setPendingDelete(null)}
            />

            {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={dismissToast} />}

        </AppShell>
    );
}

function SortIcon({ active, dir }) {
    return (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className={`events-sort-icon ${active ? "active" : ""} ${active && dir === "desc" ? "flipped" : ""}`}>
            <path d="M5 1.5v7M2 5.5 5 8.5 8 5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

export default Events;
