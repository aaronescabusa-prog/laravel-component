import { useEffect, useMemo, useState } from "react";
import "./Events.css";
import AppShell from "./components/AppShell";
import Toast from "./components/Toast";
import ConfirmDialog from "./components/ConfirmDialog";
import { useToast } from "./lib/useToast";
import { logActivity, nextId } from "./lib/storage";
import { api, eventsApi, mapEventFromApi, mapEventToApi, EVENT_STATUSES, EVENT_TARGET_ROLES } from "./lib/api";
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
const STATUSES = EVENT_STATUSES;
const TARGET_ROLES = EVENT_TARGET_ROLES;

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

function formatEventTime(value) {
    if (!value) return "";
    const [hours, minutes] = String(value).split(":").map(Number);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return value;
    return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
    });
}

function eventTimeLabel(row) {
    if (!row.startTime && !row.endTime) return "All day";
    const start = formatEventTime(row.startTime);
    const end = formatEventTime(row.endTime);
    if (start && end) return `${start} – ${end}`;
    return start || end;
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
    const [departmentFilter, setDepartmentFilter] = useState("all");
    const [courseFilter, setCourseFilter] = useState("all");
    const [yearFilter, setYearFilter] = useState("all");
    const [roleFilter, setRoleFilter] = useState("all");
    const [sortKey, setSortKey] = useState("date");
    const [sortDir, setSortDir] = useState("asc");
    const [editingEvent, setEditingEvent] = useState(null);
    const [isNewEvent, setIsNewEvent] = useState(false);
    const [isSavingEvent, setIsSavingEvent] = useState(false);
    const [formErrors, setFormErrors] = useState({});
    const [viewingEvent, setViewingEvent] = useState(null);
    const [courses, setCourses] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [years, setYears] = useState([]);

    useEffect(() => {
        let active = true;
        api.list("events")
            .then((rows) => { if (active) setEvents(rows.map(mapEventFromApi)); })
            .catch((err) => { if (active) setLoadError(err.message); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, []);

    // Keep the admin audience options aligned with the server eligibility rules.
    useEffect(() => {
        let active = true;
        api.academicStructure()
            .then((structure) => {
                if (!active) return;
                setCourses(structure.courses);
                setDepartments(structure.departments);
                setYears(structure.years);
            })
            .catch((err) => {
                if (active) setLoadError(`Could not load event eligibility options: ${err.message}`);
            });
        return () => { active = false; };
    }, []);

    useEffect(() => {
        if (!viewingEvent && !editingEvent) return undefined;

        function closeOnEscape(event) {
            if (event.key === "Escape" && !isSavingEvent) {
                setViewingEvent(null);
                setEditingEvent(null);
            }
        }

        window.addEventListener("keydown", closeOnEscape);
        return () => window.removeEventListener("keydown", closeOnEscape);
    }, [viewingEvent, editingEvent, isSavingEvent]);

    function audienceLabel(row) {
        const department = departments.find((item) => item.code === row.targetDepartment);
        const parts = [
            department ? `${department.code} — ${department.name}` : null,
            row.targetCourse,
            row.targetYear ? `Year ${row.targetYear}` : null,
            row.targetRole && row.targetRole !== "All" ? row.targetRole : null,
        ].filter(Boolean);

        return parts.length > 0 ? parts.join(" · ") : "All departments, roles, programs, and years";
    }

    const filteredRows = useMemo(() => {
        let rows = events.filter((row) => {
            const term = search.trim().toLowerCase();
            const matchesSearch = !term || row.name.toLowerCase().includes(term) || row.organizer.toLowerCase().includes(term) || String(row.category ?? "").toLowerCase().includes(term);
            const matchesStatus = statusFilter === "all" || row.status.toLowerCase() === statusFilter;
            const matchesCategory = categoryFilter === "all" || row.category === categoryFilter;
            const matchesDepartment = departmentFilter === "all" || row.targetDepartment === departmentFilter;
            const matchesCourse = courseFilter === "all" || row.targetCourse === courseFilter;
            const matchesYear = yearFilter === "all" || String(row.targetYear ?? "") === yearFilter;
            const matchesRole = roleFilter === "all" || row.targetRole === roleFilter;
            return matchesSearch && matchesStatus && matchesCategory && matchesDepartment && matchesCourse && matchesYear && matchesRole;
        });

        rows = [...rows].sort((a, b) => {
            const dir = sortDir === "asc" ? 1 : -1;
            if (a[sortKey] < b[sortKey]) return -1 * dir;
            if (a[sortKey] > b[sortKey]) return 1 * dir;
            return 0;
        });

        return rows;
    }, [events, search, statusFilter, categoryFilter, departmentFilter, courseFilter, yearFilter, roleFilter, sortKey, sortDir]);

    const pager = usePagination(filteredRows, {
        resetKey: [search, statusFilter, categoryFilter, departmentFilter, courseFilter, yearFilter, roleFilter, sortKey, sortDir].join("|"),
    });

    const selection = useRowSelection({
        pageRows: pager.pageRows,
        matchingRows: filteredRows,
        resetKey: [search, statusFilter, categoryFilter, departmentFilter, courseFilter, yearFilter, roleFilter, sortKey, sortDir].join("|"),
    });

    function toggleSort(key) {
        if (sortKey === key) {
            setSortDir(sortDir === "asc" ? "desc" : "asc");
        } else {
            setSortKey(key);
            setSortDir("asc");
        }
    }

    function updateEventField(field, value) {
        setEditingEvent((current) => ({ ...current, [field]: value }));
        setFormErrors((current) => ({
            ...current,
            [field]: "",
            ...(["startTime", "endDate"].includes(field) ? { endTime: "" } : {}),
        }));
    }

    function exportCSV() {
        const rows = [
            ["Event", "Category", "Audience and eligibility", "Organizer", "Date", "Time", "Duration", "Venue", "Status", "Participants", "Capacity"],
            ...filteredRows.map((r) => [r.name, r.category, audienceLabel(r), r.organizer, r.date, eventTimeLabel(r), durationLabel(r), r.venue, r.status, r.participants, r.hasCapacity ? r.capacity : "No limit"]),
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
                const note = audienceNote(updated);
                showToast(`${row.name} marked as ${status}.${note ? ` ${note}` : ""}`);
                logActivity({
                    category: "Event",
                    action: `${status} event ${row.id}`,
                    details: `${row.name} · ${row.venue}`,
                });
            })
            .catch((err) => {
                setEvents((prev) => prev.map((e) => (e._id === row._id ? row : e)));
                showToast(`Could not update ${row.name}: ${err.message}`, "danger");
            });
    }

    /* ---------- Audience auto-enrolment ---------- */

    // Saving an event enrols everyone in its selected audience, which would
    // otherwise happen invisibly: the roster grows and nobody is told why.
    // Returns the note to show, or null when the save enrolled nobody.
    function audienceNote(result) {
        const audience = result?.audience;
        const added = audience?.added?.length ?? 0;
        if (!(audience?.target_course || audience?.target_department || audience?.target_year || audience?.target_role) || !added) return null;

        const department = departments.find((item) => item.code === audience.target_department);
        const target = [
            department ? `${department.code} — ${department.name}` : null,
            audience.target_course,
            audience.target_year ? audience.target_year : null,
            audience.target_role,
        ].filter(Boolean).join(" · ");
        const capacityNote = audience.capacity_remaining === 0 && audience.matched > added
            ? " Capacity was reached; remaining accounts were not registered."
            : "";

        return `${added} matching account${added === 1 ? "" : "s"}${target ? ` (${target})` : ""} automatically registered.${capacityNote}`;
    }

    /* ---------- Delete (behind a confirmation) ---------- */

    function requestDelete(row) {
        setPendingDelete({ rows: [row], label: `${row.name} (${row.id})` });
    }

    /** Same columns as exportCSV, narrowed to whatever is ticked. */
    function exportSelectedCSV() {
        const rows = [
            ["Event", "Category", "Audience and eligibility", "Organizer", "Date", "Time", "Duration", "Venue", "Status", "Participants", "Capacity"],
            ...selection.selectedRows.map((r) => [r.name, r.category, audienceLabel(r), r.organizer, r.date, eventTimeLabel(r), durationLabel(r), r.venue, r.status, r.participants, r.hasCapacity ? r.capacity : "No limit"]),
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
        setFormErrors({});
        setIsNewEvent(false);
    }

    function handleEventSaveError(error) {
        const fieldMap = {
            title: "name",
            event_date: "date",
            start_time: "startTime",
            end_date: "endDate",
            end_time: "endTime",
            registration_deadline: "registrationDeadline",
        };
        const fieldIds = {
            name: "evName",
            date: "evDate",
            startTime: "evTime",
            endDate: "evEndDate",
            endTime: "evEndTime",
            registrationDeadline: "evRegistrationDeadline",
            capacity: "evCapacity",
            budget: "evBudget",
            penalty_amount: "evPenaltyAmount",
            venue: "evVenue",
        };
        const mappedErrors = Object.fromEntries(
            Object.entries(error.payload?.errors ?? {}).map(([field, messages]) => [
                fieldMap[field] || field,
                Array.isArray(messages) ? messages[0] : String(messages),
            ]),
        );

        if (Object.keys(mappedErrors).length > 0) {
            setFormErrors(mappedErrors);
            const firstFocusable = Object.keys(mappedErrors).find((field) => fieldIds[field]);
            if (firstFocusable) {
                requestAnimationFrame(() => document.getElementById(fieldIds[firstFocusable])?.focus());
                showToast("Please review the highlighted fields.", "danger");
            } else {
                showToast(error.message, "danger");
            }
            return;
        }

        showToast(error.message, "danger");
    }

    function openCreate() {
        setFormErrors({});
        setEditingEvent({
            id: nextId(events, "EVT", 3001),
            name: "",
            category: "",
            bannerUrl: "",
            bannerFile: null,
            organizer: "",
            date: "",
            registrationDeadline: "",
            registrationOpen: true,
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
            targetDepartment: "",
            targetYear: "",
        });
        setIsNewEvent(true);
    }

    function saveEvent(event) {
        event?.preventDefault();
        if (isSavingEvent) return;
        const item = { ...editingEvent };
        const errors = {};
        if (!item.name.trim()) errors.name = "Enter an event name.";
        if (!item.date) errors.date = "Choose a start date.";
        if (!item.venue.trim()) errors.venue = "Enter a venue.";
        if (!item.allDay && !item.startTime) errors.startTime = "Choose a start time, or mark the event as all-day.";
        if (!item.allDay && !item.endTime) errors.endTime = "Choose an end time, or mark the event as all-day.";
        if (item.date && item.endDate && item.endDate < item.date) {
            errors.endDate = "The end date cannot be before the start date.";
        }
        const lastDate = item.endDate || item.date;
        if (!item.allDay && item.date && lastDate === item.date && item.startTime && item.endTime && item.endTime <= item.startTime) {
            errors.endTime = "End time must be later than the start time.";
        }
        if (item.date && item.registrationDeadline && item.registrationDeadline > item.date) {
            errors.registrationDeadline = "The registration deadline cannot be after the event start date.";
        }
        if (item.hasCapacity && (!Number.isInteger(Number(item.capacity)) || Number(item.capacity) < 1)) {
            errors.capacity = "Enter a whole-number capacity of at least 1.";
        }
        if (!Number.isInteger(Number(item.budget)) || Number(item.budget) < 0) {
            errors.budget = "Enter a whole-number budget of zero or more.";
        }
        if (item.penalty_amount !== null && item.penalty_amount !== "" && item.penalty_amount !== undefined
            && (!Number.isInteger(Number(item.penalty_amount)) || Number(item.penalty_amount) < 0)) {
            errors.penalty_amount = "Enter a whole-number penalty amount of zero or more.";
        }
        if (Object.keys(errors).length > 0) {
            setFormErrors(errors);
            const fieldIds = {
                name: "evName", date: "evDate", startTime: "evTime", endDate: "evEndDate",
                endTime: "evEndTime", registrationDeadline: "evRegistrationDeadline",
                capacity: "evCapacity", budget: "evBudget", penalty_amount: "evPenaltyAmount", venue: "evVenue",
            };
            requestAnimationFrame(() => document.getElementById(fieldIds[Object.keys(errors)[0]])?.focus());
            return;
        }

        const payload = mapEventToApi(item);
        setIsSavingEvent(true);
        let bannerUploadFailed = false;
        const withUploadedBanner = async (saved) => {
            if (!item.bannerFile) return saved;
            try {
                return { ...saved, ...(await eventsApi.uploadBanner(saved.reference, item.bannerFile)) };
            } catch {
                // The event itself has already been saved. Keep it in the list
                // and close the form so a retry cannot create a second event.
                bannerUploadFailed = true;
                return saved;
            }
        };

        if (isNewEvent) {
            api.create("events", payload)
                .then(withUploadedBanner)
                .then((created) => {
                    setEvents((prev) => [mapEventFromApi(created), ...prev]);
                    logActivity({
                        category: "Event",
                        action: `Created event ${created.reference}`,
                        details: `${item.name} · ${item.date} · ${item.venue}`,
                    });
                    showToast(bannerUploadFailed
                        ? `${item.name} was created, but the banner upload failed. Edit the event to try again.`
                        : `${item.name} was created.${audienceNote(created) ? ` ${audienceNote(created)}` : ""}`,
                        bannerUploadFailed ? "danger" : "success");
                    setEditingEvent(null);
                })
                .catch(handleEventSaveError)
                .finally(() => setIsSavingEvent(false));
        } else {
            api.update("events", item.id, payload)
                .then(withUploadedBanner)
                .then((updated) => {
                    setEvents((prev) => prev.map((e) => (e._id === item._id ? mapEventFromApi(updated) : e)));
                    logActivity({
                        category: "Event",
                        action: `Updated event ${item.id}`,
                        details: `${item.name} · ${item.status}`,
                    });
                    showToast(bannerUploadFailed
                        ? `${item.name} was updated, but the banner upload failed. Edit the event to try again.`
                        : `${item.name} was updated.${audienceNote(updated) ? ` ${audienceNote(updated)}` : ""}`,
                        bannerUploadFailed ? "danger" : "success");
                    setEditingEvent(null);
                })
                .catch(handleEventSaveError)
                .finally(() => setIsSavingEvent(false));
        }
    }

    const totalEvents = events.length;
    const upcoming = events.filter((e) => e.status === "Approved" && new Date(e.date) >= new Date("2026-09-06")).length;
    const pendingApproval = events.filter((e) => e.status === "Pending").length;
    const completedThisMonth = events.filter((e) => e.status === "Completed").length;

    return (
        <AppShell
            title="Events"
            prefix="events-"
            headerActions={
                <div className="events-topbar-actions">
                    <input
                        type="search"
                        className="events-topbar-search"
                        placeholder="Search events or organizer"
                        aria-label="Search events"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                    <button
                        type="button"
                        className="events-topbar-notifications"
                        aria-label={`Show ${pendingApproval} pending event approvals`}
                        onClick={() => {
                            setSearch("");
                            setCategoryFilter("all");
                            setStatusFilter("pending");
                            setDepartmentFilter("all");
                            setCourseFilter("all");
                            setYearFilter("all");
                            setRoleFilter("all");
                        }}
                    >
                        Pending approvals <span>{pendingApproval}</span>
                    </button>
                </div>
            }
        >

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
                    <select
                        className="events-input-select"
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        aria-label="Filter by status"
                    >
                        <option value="all">All statuses</option>
                        {STATUSES.map((s) => <option key={s} value={s.toLowerCase()}>{s}</option>)}
                    </select>

                    <select
                        className="events-input-select"
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                        aria-label="Filter by event category"
                    >
                        <option value="all">All categories</option>
                        {[...new Set(events.map((event) => event.category).filter(Boolean))].sort().map((category) => (
                            <option key={category} value={category}>{category}</option>
                        ))}
                    </select>

                    <select
                        className="events-input-select"
                        value={departmentFilter}
                        onChange={(e) => setDepartmentFilter(e.target.value)}
                        aria-label="Filter by target college"
                    >
                        <option value="all">All colleges</option>
                        {departments.map((department) => (
                            <option key={department.code} value={department.code}>
                                {department.code} — {department.name}
                            </option>
                        ))}
                    </select>

                    <select
                        className="events-input-select"
                        value={courseFilter}
                        onChange={(e) => setCourseFilter(e.target.value)}
                        aria-label="Filter by target program"
                    >
                        <option value="all">All programs</option>
                        {courses.map((course) => (
                            <option key={course} value={course}>{course}</option>
                        ))}
                    </select>

                    <select
                        className="events-input-select"
                        value={yearFilter}
                        onChange={(e) => setYearFilter(e.target.value)}
                        aria-label="Filter by target year"
                    >
                        <option value="all">All target years</option>
                        {years.map((year) => (
                            <option key={year} value={year}>{year}</option>
                        ))}
                    </select>

                    <select
                        className="events-input-select"
                        value={roleFilter}
                        onChange={(e) => setRoleFilter(e.target.value)}
                        aria-label="Filter by target role"
                    >
                        <option value="all">All target roles</option>
                        {TARGET_ROLES.map((role) => (
                            <option key={role} value={role}>{role === "All" ? "All roles" : role}</option>
                        ))}
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
                                <th className="events-th-sortable" aria-sort={sortKey === "name" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                                    <button type="button" onClick={() => toggleSort("name")} aria-label={`Sort by event name${sortKey === "name" ? `, ${sortDir === "asc" ? "ascending" : "descending"}` : ""}`}>
                                        Event Name <SortIcon active={sortKey === "name"} dir={sortDir} />
                                    </button>
                                </th>
                                <th>Audience &amp; eligibility</th>
                                <th>Category</th>
                                <th>Organizer</th>
                                <th className="events-th-sortable" aria-sort={sortKey === "date" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                                    <button type="button" onClick={() => toggleSort("date")} aria-label={`Sort by date${sortKey === "date" ? `, ${sortDir === "asc" ? "ascending" : "descending"}` : ""}`}>
                                        Date <SortIcon active={sortKey === "date"} dir={sortDir} />
                                    </button>
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
                                            <span className="events-row-icon">{initialsOf(row.name)}</span>
                                            <div className="events-cell-text">
                                                <span className="events-cell-name">{row.name}</span>
                                                <span className="events-cell-id">{row.id}</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="events-cell-muted">{audienceLabel(row)}</td>
                                    <td className="events-cell-muted">{row.category || "—"}</td>
                                    <td className="events-cell-muted">{row.organizer}</td>
                                    <td className="events-cell-muted">{row.date}</td>
                                    <td className="events-cell-muted">{eventTimeLabel(row)}</td>
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
                            {loading && filteredRows.length === 0 && (
                                <tr>
                                    <td colSpan="12" className="events-empty-row" role="status">Loading events…</td>
                                </tr>
                            )}
                            {!loading && !loadError && filteredRows.length === 0 && (
                                <tr>
                                    <td colSpan="12" className="events-empty-row">
                                        {events.length === 0 ? (
                                            <>
                                                <strong className="events-empty-title">No events have been created yet.</strong>
                                                <div className="events-empty-actions">
                                                    <button
                                                        type="button"
                                                        className="events-btn events-btn-primary events-empty-action"
                                                        onClick={openCreate}
                                                    >
                                                        Create Event
                                                    </button>
                                                </div>
                                            </>
                                        ) : (
                                            <>
                                                <strong className="events-empty-title">No events match your filters.</strong>
                                                <div className="events-empty-actions">
                                                    <button
                                                        type="button"
                                                        className="events-btn events-btn-secondary events-empty-action"
                                                        onClick={() => {
                                                            setSearch("");
                                                            setCategoryFilter("all");
                                                            setStatusFilter("all");
                                                            setDepartmentFilter("all");
                                                            setCourseFilter("all");
                                                            setYearFilter("all");
                                                            setRoleFilter("all");
                                                        }}
                                                        aria-label="Clear all event filters"
                                                    >
                                                        Clear filters
                                                    </button>
                                                </div>
                                            </>
                                        )}
                                    </td>
                                </tr>
                            )}
                            {!loading && loadError && events.length === 0 && (
                                <tr>
                                    <td colSpan="12" className="events-empty-row">Events could not be displayed.</td>
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
                    <div className="events-modal-card" role="dialog" aria-modal="true" aria-labelledby="event-details-title" onClick={(e) => e.stopPropagation()}>
                        <div className="events-modal-header">
                            <h3 id="event-details-title">{viewingEvent.name}</h3>
                            <button type="button" className="events-modal-close" onClick={() => setViewingEvent(null)} aria-label="Close event details">×</button>
                        </div>
                        <div className="events-modal-body">
                            <dl className="events-detail-list">
                                <dt>Event ID</dt><dd>{viewingEvent.id}</dd>
                                <dt>Category</dt><dd>{viewingEvent.category || "—"}</dd>
                                {viewingEvent.bannerUrl && <><dt>Banner</dt><dd><a href={viewingEvent.bannerUrl} target="_blank" rel="noreferrer">View event banner</a></dd></>}
                                <dt>Audience &amp; eligibility</dt>
                                <dd>{audienceLabel(viewingEvent)}</dd>
                                <dt>Organizer</dt><dd>{viewingEvent.organizer}</dd>
                                <dt>Date</dt><dd>{viewingEvent.date}</dd>
                                <dt>Start time</dt>
                                <dd>
                                    {eventTimeLabel(viewingEvent)}
                                </dd>
                                <dt>End</dt>
                                <dd>
                                    {viewingEvent.endDate || viewingEvent.date || "—"}
                                </dd>
                                <dt>Registration</dt>
                                <dd>{viewingEvent.registrationOpen === false ? "Closed" : "Accepting registrations"}</dd>
                                {viewingEvent.registrationDeadline && (
                                    <><dt>Registration deadline</dt><dd>{viewingEvent.registrationDeadline}</dd></>
                                )}
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
                <div className="events-modal-overlay" onClick={() => !isSavingEvent && setEditingEvent(null)}>
                    <div className="events-modal-card events-editor-modal" role="dialog" aria-modal="true" aria-labelledby="event-editor-title" onClick={(e) => e.stopPropagation()}>
                        <form className="events-editor-form" onSubmit={saveEvent} noValidate>
                        <div className="events-modal-header">
                            <div className="events-editor-heading">
                                <h3 id="event-editor-title">{isNewEvent ? "Create Event" : "Edit Event"}</h3>
                                <p>{isNewEvent ? "Add the event details, schedule, and registration options." : "Update the event details and registration options."}</p>
                            </div>
                            <button type="button" className="events-modal-close" onClick={() => !isSavingEvent && setEditingEvent(null)} disabled={isSavingEvent} aria-label="Close event form">×</button>
                        </div>
                        <div className="events-modal-body">
                            <div className="events-form-group">
                                <label htmlFor="evName">Event name <span className="events-required">*</span></label>
                                <input
                                    id="evName"
                                    type="text"
                                    maxLength="255"
                                    required
                                    autoFocus
                                    value={editingEvent.name}
                                    aria-invalid={Boolean(formErrors.name)}
                                    aria-describedby={formErrors.name ? "evName-error" : undefined}
                                    onChange={(e) => updateEventField("name", e.target.value)}
                                />
                                {formErrors.name && <small className="events-field-error" id="evName-error">{formErrors.name}</small>}
                            </div>

                            <div className="events-form-group">
                                <label htmlFor="evCategory">Event category</label>
                                <input
                                    id="evCategory"
                                    type="text"
                                    maxLength="80"
                                    placeholder="e.g. Seminar, Workshop, Sports"
                                    value={editingEvent.category ?? ""}
                                    onChange={(e) => updateEventField("category", e.target.value)}
                                />
                            </div>

                            <div className="events-form-section">
                                <h4 className="events-form-section-title">Registration</h4>
                                <label className="events-form-checkbox">
                                    <input
                                        type="checkbox"
                                        checked={editingEvent.registrationOpen !== false}
                                        onChange={(e) => updateEventField("registrationOpen", e.target.checked)}
                                    />
                                    <span>Accept registrations</span>
                                </label>
                                <div className="events-form-group">
                                    <label htmlFor="evRegistrationDeadline">Registration deadline</label>
                                    <input
                                        id="evRegistrationDeadline"
                                        type="date"
                                        max={editingEvent.date || undefined}
                                        value={editingEvent.registrationDeadline || ""}
                                        onChange={(e) => updateEventField("registrationDeadline", e.target.value)}
                                        aria-invalid={Boolean(formErrors.registrationDeadline)}
                                        aria-describedby={formErrors.registrationDeadline ? "evRegistrationDeadline-error" : undefined}
                                    />
                                    {formErrors.registrationDeadline && (
                                        <small className="events-field-error" id="evRegistrationDeadline-error">
                                            {formErrors.registrationDeadline}
                                        </small>
                                    )}
                                    <small className="events-form-hint">
                                        Registration closes at the end of this date. Leave blank to accept registrations until the event date.
                                    </small>
                                </div>
                            </div>

                                <h4 className="events-form-section-title events-audience-heading">Audience eligibility</h4>
                                <div className="events-form-row-split events-audience-grid">
                                    <div className="events-form-group">
                                        <label htmlFor="evTargetDepartment">Target department</label>
                                        <select
                                            id="evTargetDepartment"
                                            value={editingEvent.targetDepartment ?? ""}
                                            onChange={(e) => {
                                                const targetDepartment = e.target.value;
                                                setEditingEvent({
                                                    ...editingEvent,
                                                    targetDepartment,
                                                    // A department choice should include every program there;
                                                    // the user can narrow it afterward if needed.
                                                    targetCourse: PUBLIC_AUDIENCE,
                                                });
                                            }}
                                        >
                                            <option value="">All departments</option>
                                            {departments.map((department) => (
                                                <option key={department.code} value={department.code}>
                                                    {department.code} — {department.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="events-form-group">
                                        <label htmlFor="evAudience">Target program</label>
                                        <select
                                            id="evAudience"
                                            value={editingEvent.targetCourse ?? PUBLIC_AUDIENCE}
                                            onChange={(e) => setEditingEvent({ ...editingEvent, targetCourse: e.target.value })}
                                        >
                                            <option value={PUBLIC_AUDIENCE}>All programs</option>
                                            {(departments.find((item) => item.code === editingEvent.targetDepartment)?.courses ?? courses).map((course) => (
                                                <option key={course} value={course}>{course}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="events-form-group">
                                        <label htmlFor="evTargetYear">Target year level</label>
                                        <select
                                            id="evTargetYear"
                                            value={editingEvent.targetYear ?? ""}
                                            onChange={(e) => setEditingEvent({ ...editingEvent, targetYear: e.target.value })}
                                        >
                                            <option value="">All year levels</option>
                                            {years.map((year) => (
                                                <option key={year} value={year}>{year}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                <small className="events-form-hint">
                                    Department, program, and year filters are combined and checked against each active participant&apos;s profile.
                                </small>
                                <div className="events-form-group">
                                    <label htmlFor="evOrganizer">Organizer</label>
                                    <input
                                        id="evOrganizer"
                                        type="text"
                                        value={editingEvent.organizer}
                                        onChange={(e) => setEditingEvent({ ...editingEvent, organizer: e.target.value })}
                                    />
                                </div>

                            <div className="events-form-section events-schedule-section">
                                <div className="events-schedule-heading">
                                    <div>
                                        <h4 className="events-form-section-title">Date and time</h4>
                                        <p>Set the event schedule. Times use your local time zone.</p>
                                    </div>
                                    <span className="events-schedule-badge">Required schedule</span>
                                </div>

                                <label className={`events-form-checkbox events-all-day-toggle${editingEvent.allDay ? " is-active" : ""}`}>
                                    <input
                                        type="checkbox"
                                        checked={Boolean(editingEvent.allDay)}
                                        onChange={(e) => {
                                            const allDay = e.target.checked;
                                            setEditingEvent({
                                                ...editingEvent,
                                                allDay,
                                                // Keep the timed schedule around while all-day mode is on,
                                                // so toggling it back off restores the user's values.
                                                _savedStartTime: allDay ? editingEvent.startTime || editingEvent._savedStartTime : editingEvent._savedStartTime,
                                                _savedEndTime: allDay ? editingEvent.endTime || editingEvent._savedEndTime : editingEvent._savedEndTime,
                                                startTime: allDay ? "" : editingEvent._savedStartTime || editingEvent.startTime || "08:00",
                                                endTime: allDay ? "" : editingEvent._savedEndTime || editingEvent.endTime || "17:00",
                                            });
                                        }}
                                    />
                                    <span className="events-all-day-copy">
                                        <strong>All-day event</strong>
                                        <small>Turn this on to schedule the event without specific times.</small>
                                    </span>
                                </label>

                                <div className="events-form-row-split">
                                    <div className="events-form-group">
                                        <label htmlFor="evDate">
                                            Start date <span className="events-required">*</span>
                                        </label>
                                        <input
                                            id="evDate"
                                            type="date"
                                            required
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
                                                setFormErrors((current) => ({ ...current, date: "", endDate: "", endTime: "" }));
                                            }}
                                            aria-invalid={Boolean(formErrors.date)}
                                            aria-describedby={formErrors.date ? "evDate-error" : undefined}
                                        />
                                        {formErrors.date && <small className="events-field-error" id="evDate-error">{formErrors.date}</small>}
                                    </div>
                                    <div className="events-form-group">
                                        <label htmlFor="evTime">
                                            Start time {!editingEvent.allDay && <span className="events-required">*</span>}
                                        </label>
                                        <input
                                            id="evTime"
                                            type="time"
                                            required={!editingEvent.allDay}
                                            value={editingEvent.startTime || ""}
                                            disabled={editingEvent.allDay}
                                            aria-invalid={Boolean(formErrors.startTime)}
                                            aria-describedby={formErrors.startTime ? "evTime-error" : undefined}
                                            onChange={(e) => updateEventField("startTime", e.target.value)}
                                        />
                                        {formErrors.startTime && <small className="events-field-error" id="evTime-error">{formErrors.startTime}</small>}
                                    </div>
                                </div>

                                <div className="events-form-row-split">
                                    <div className="events-form-group">
                                        <label htmlFor="evEndDate">
                                            End date
                                        </label>
                                        <input
                                            id="evEndDate"
                                            type="date"
                                            min={editingEvent.date || undefined}
                                            value={editingEvent.endDate || ""}
                                            onChange={(e) => updateEventField("endDate", e.target.value)}
                                            aria-invalid={Boolean(formErrors.endDate)}
                                            aria-describedby={formErrors.endDate ? "evEndDate-error" : undefined}
                                        />
                                        {formErrors.endDate && <small className="events-field-error" id="evEndDate-error">{formErrors.endDate}</small>}
                                        {!formErrors.endDate && <small className="events-form-hint">Optional for a one-day event.</small>}
                                    </div>
                                    <div className="events-form-group">
                                        <label htmlFor="evEndTime">
                                            End time {!editingEvent.allDay && <span className="events-required">*</span>}
                                        </label>
                                        <input
                                            id="evEndTime"
                                            type="time"
                                            required={!editingEvent.allDay}
                                            value={editingEvent.endTime || ""}
                                            disabled={editingEvent.allDay}
                                            aria-invalid={Boolean(formErrors.endTime)}
                                            aria-describedby={formErrors.endTime ? "evEndTime-error" : undefined}
                                            onChange={(e) => updateEventField("endTime", e.target.value)}
                                        />
                                        {formErrors.endTime && <small className="events-field-error" id="evEndTime-error">{formErrors.endTime}</small>}
                                        {editingEvent.allDay && <small className="events-form-hint">Time fields are disabled for an all-day event.</small>}
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
                                                setFormErrors((current) => ({ ...current, capacity: "" }));
                                            }}
                                        />
                                        <span>Limit capacity</span>
                                    </label>
                                    {editingEvent.hasCapacity && (
                                        <div className="events-form-subgroup">
                                            <label htmlFor="evCapacity">Capacity <span className="events-required">*</span></label>
                                            <input
                                                id="evCapacity"
                                                type="number"
                                                min="1"
                                                step="1"
                                                required
                                                value={editingEvent.capacity ?? ""}
                                                onChange={(e) => updateEventField(
                                                    "capacity",
                                                    e.target.value === "" ? null : Number(e.target.value),
                                                )}
                                                aria-invalid={Boolean(formErrors.capacity)}
                                                aria-describedby={formErrors.capacity ? "evCapacity-error" : undefined}
                                            />
                                            {formErrors.capacity && <small className="events-field-error" id="evCapacity-error">{formErrors.capacity}</small>}
                                            <small className="events-form-hint">
                                                New registrations and automatic audience enrolment stop when capacity is reached.
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
                                        step="1"
                                        aria-invalid={Boolean(formErrors.budget)}
                                        aria-describedby={formErrors.budget ? "evBudget-error" : undefined}
                                        onChange={(e) => updateEventField("budget", e.target.value === "" ? 0 : Number(e.target.value))}
                                    />
                                    {formErrors.budget && <small className="events-field-error" id="evBudget-error">{formErrors.budget}</small>}
                                </div>
                            </div>


                            <div className="events-form-group">
                                <label htmlFor="evVenue">Venue <span className="events-required">*</span></label>
                                <input
                                    id="evVenue"
                                    type="text"
                                    maxLength="255"
                                    required
                                    value={editingEvent.venue}
                                    onChange={(e) => updateEventField("venue", e.target.value)}
                                    aria-invalid={Boolean(formErrors.venue)}
                                    aria-describedby={formErrors.venue ? "evVenue-error" : undefined}
                                />
                                {formErrors.venue && <small className="events-field-error" id="evVenue-error">{formErrors.venue}</small>}
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

                            <div className="events-form-group">
                                <label htmlFor="evBanner">Event banner</label>
                                {editingEvent.bannerUrl && (
                                    <img className="events-banner-preview" src={editingEvent.bannerUrl} alt="Current event banner" />
                                )}
                                <input
                                    id="evBanner"
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp"
                                    onChange={(e) => setEditingEvent({ ...editingEvent, bannerFile: e.target.files?.[0] ?? null })}
                                />
                                <small className="events-form-hint">Optional. JPG, PNG, or WebP, up to 5 MB.</small>
                            </div>

                            <div className="events-form-group">
                                <label htmlFor="evPenaltyType">Penalty type</label>
                                <select
                                    id="evPenaltyType"
                                    value={editingEvent.penalty_type ?? ''}
                                    onChange={(e) => setEditingEvent({ ...editingEvent, penalty_type: e.target.value })}
                                >
                                    <option value="">Select penalty type</option>
                                    <option value="No Certificate">No Certificate</option>
                                    <option value="Late Fee">Late Fee</option>
                                    <option value="No Show Fee">No Show Fee</option>
                                    <option value="Administrative Fee">Administrative Fee</option>
                                </select>
                            </div>

                            <div className="events-form-group">
                                <label htmlFor="evPenaltyAmount">Penalty amount</label>
                                <input
                                    id="evPenaltyAmount"
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={editingEvent.penalty_amount ?? ''}
                                    aria-invalid={Boolean(formErrors.penalty_amount)}
                                    aria-describedby={formErrors.penalty_amount ? "evPenaltyAmount-error" : undefined}
                                    onChange={(e) => updateEventField("penalty_amount", e.target.value ? Number(e.target.value) : null)}
                                />
                                {formErrors.penalty_amount && <small className="events-field-error" id="evPenaltyAmount-error">{formErrors.penalty_amount}</small>}
                            </div>
                        </div>
                        <div className="events-form-section events-status-section">
                            <div>
                                <h4 className="events-form-section-title">Event status</h4>
                                <small className="events-form-hint">Set the event&apos;s current stage in the approval and publication workflow.</small>
                            </div>
                            <div className="events-form-group">
                                <label htmlFor="evStatus">Status</label>
                                <select
                                    id="evStatus"
                                    value={editingEvent.status}
                                    onChange={(e) => setEditingEvent({ ...editingEvent, status: e.target.value })}
                                >
                                    {STATUSES.map((status) => <option key={status}>{status}</option>)}
                                </select>
                            </div>
                        </div>
                        <div className="events-modal-footer">
                            <button type="button" className="events-btn events-btn-secondary" onClick={() => setEditingEvent(null)} disabled={isSavingEvent}>Cancel</button>
                            <button type="submit" className="events-btn events-btn-primary" disabled={isSavingEvent}>
                                {isSavingEvent ? "Saving..." : isNewEvent ? "Create Event" : "Save Changes"}
                            </button>
                        </div>
                        </form>
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
