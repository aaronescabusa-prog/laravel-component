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

function eventDateLabel(value) {
    if (!value) return "Date to be announced";
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function localDateInputValue(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function eventAudienceSummary(row, departments) {
    const department = departments.find((item) => item.code === row.targetDepartment)
        ?? departments.find((item) => row.targetCourse && item.courses?.includes(row.targetCourse));
    return department ? `${department.code} Students Only` : "All TMC Students";
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
    const [attendanceRoster, setAttendanceRoster] = useState(null);
    const [attendanceBusy, setAttendanceBusy] = useState(false);

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

    useEffect(() => {
        let active = true;
        if (!viewingEvent?.attendanceCompulsory) {
            setAttendanceRoster(null);
            return undefined;
        }
        eventsApi.attendanceRoster(viewingEvent.id)
            .then((data) => { if (active) setAttendanceRoster(data); })
            .catch(() => { if (active) setAttendanceRoster(null); });
        return () => { active = false; };
    }, [viewingEvent?.id, viewingEvent?.attendanceCompulsory]);

    async function runAttendanceAction(action) {
        if (!viewingEvent) return;
        setAttendanceBusy(true);
        try {
            const result = action === "finalize"
                ? await eventsApi.finalizeAttendanceRoster(viewingEvent.id)
                : await eventsApi.assessFines(viewingEvent.id);
            const data = await eventsApi.attendanceRoster(viewingEvent.id);
            setAttendanceRoster(data);
            showToast(result.message || "Attendance policy updated.");
        } catch (error) {
            showToast(error.message, "danger");
        } finally {
            setAttendanceBusy(false);
        }
    }

    async function reviewProposedFine(fineId, decision) {
        setAttendanceBusy(true);
        try {
            await eventsApi.reviewFine(fineId, decision);
            const data = await eventsApi.attendanceRoster(viewingEvent.id);
            setAttendanceRoster(data);
            showToast(`Fine ${decision}d.`);
        } catch (error) {
            showToast(error.message, "danger");
        } finally {
            setAttendanceBusy(false);
        }
    }

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
                showToast(`${row.name} marked as ${status}.`);
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
        setEditingEvent({
            ...row,
            allDay: !row.startTime && !row.endTime,
            hasCapacity: row.hasCapacity,
            audienceType: row.targetDepartment || row.targetCourse ? "Department-Specific" : "School-Wide",
        });
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
            hasCapacity: true,
            capacity: null,
            hasCertificate: true,
            targetDepartment: "",
            targetYear: "",
            targetBlock: "",
            attendanceCompulsory: false,
            attendanceRequiresCheckout: true,
            absenceFineAmount: "",
            incompleteFineAmount: "",
            attendanceCorrectionDeadline: "",
            excuseDeadline: "",
            audienceType: "School-Wide",
        });
        setIsNewEvent(true);
    }

    function saveEvent(event) {
        event?.preventDefault();
        if (isSavingEvent) return;
        const item = { ...editingEvent };
        const errors = {};
        if (!item.name.trim()) errors.name = "Enter an event name.";
        if (isNewEvent && !item.audienceType) errors.audienceType = "Choose who can join this event.";
        if (isNewEvent && item.audienceType === "Department-Specific" && !item.targetDepartment) errors.targetDepartment = "Choose a department.";
        if (!item.date) errors.date = "Choose a start date.";
        if (isNewEvent && item.date && item.date < localDateInputValue()) errors.date = "The event date cannot be in the past.";
        if (!item.venue.trim()) errors.venue = "Enter a venue.";
        if (isNewEvent && String(item.description || "").trim().length < 20) errors.description = "Add an event description of at least 20 characters.";
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
        if (isNewEvent && !item.registrationDeadline) errors.registrationDeadline = "Choose a registration deadline.";
        if (isNewEvent && !item.hasCapacity) errors.capacity = "Set the total number of event slots.";
        if (item.hasCapacity && (!Number.isInteger(Number(item.capacity)) || Number(item.capacity) < 1)) {
            errors.capacity = "Enter a whole-number capacity of at least 1.";
        }
        if (Object.keys(errors).length > 0) {
            setFormErrors(errors);
            const fieldIds = {
                name: "evName", date: "evDate", startTime: "evTime", endDate: "evEndDate",
                endTime: "evEndTime", registrationDeadline: "evRegistrationDeadline",
                capacity: "evCapacity", budget: "evBudget", penalty_amount: "evPenaltyAmount", venue: "evVenue",
                targetDepartment: "evTargetDepartment", targetCourse: "evAudience", audienceType: "evAudienceType", description: "evDescription",
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
                        : `${item.name} was created. Students can register from the event page.`,
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
                        : `${item.name} was updated. Students must register themselves.`,
                        bannerUploadFailed ? "danger" : "success");
                    setEditingEvent(null);
                })
                .catch(handleEventSaveError)
                .finally(() => setIsSavingEvent(false));
        }
    }

    const totalEvents = events.length;
    const today = localDateInputValue();
    const currentMonth = today.slice(0, 7);
    const upcoming = events.filter((e) => e.status === "Approved" && e.date && e.date >= today).length;
    const pendingApproval = events.filter((e) => e.status === "Pending").length;
    const completedThisMonth = events.filter((e) => e.status === "Completed" && e.date?.startsWith(currentMonth)).length;
    const activeFilterCount = [
        Boolean(search.trim()),
        statusFilter !== "all",
        categoryFilter !== "all",
        departmentFilter !== "all",
        courseFilter !== "all",
        yearFilter !== "all",
        roleFilter !== "all",
    ].filter(Boolean).length;

    function clearFilters() {
        setSearch("");
        setCategoryFilter("all");
        setStatusFilter("all");
        setDepartmentFilter("all");
        setCourseFilter("all");
        setYearFilter("all");
        setRoleFilter("all");
    }

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
                        clearFilters();
                        setStatusFilter("pending");
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
                    <span className="events-kpi-label">Completed this month</span>
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

                <div className="events-filter-summary" aria-live="polite">
                    <span>
                        {activeFilterCount > 0
                            ? `${activeFilterCount} filter${activeFilterCount === 1 ? "" : "s"} applied · ${filteredRows.length} matching event${filteredRows.length === 1 ? "" : "s"}`
                            : `Showing all ${filteredRows.length} event${filteredRows.length === 1 ? "" : "s"}`}
                    </span>
                    {activeFilterCount > 0 && (
                        <button type="button" className="events-clear-filters" onClick={clearFilters}>
                            Clear filters
                        </button>
                    )}
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
                                                        onClick={clearFilters}
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
                    <div className="events-modal-card events-detail-modal" role="dialog" aria-modal="true" aria-labelledby="event-details-title" onClick={(e) => e.stopPropagation()}>
                        <div className="events-detail-topbar">
                            <button type="button" className="events-detail-back" onClick={() => setViewingEvent(null)} aria-label="Back to events">←</button>
                            <span>Event Details</span>
                            <button type="button" className="events-modal-close" onClick={() => setViewingEvent(null)} aria-label="Close event details">×</button>
                        </div>
                        <div className="events-detail-body">
                            <div className={`events-detail-hero${viewingEvent.bannerUrl ? " has-banner" : ""}`} style={viewingEvent.bannerUrl ? { backgroundImage: `linear-gradient(90deg, rgba(8, 36, 74, .78), rgba(8, 36, 74, .15)), url("${viewingEvent.bannerUrl}")` } : undefined}>
                                {!viewingEvent.bannerUrl && <span className="events-detail-hero-mark" aria-hidden="true">✓</span>}
                                <span className="events-detail-category">{viewingEvent.category || "Campus event"}</span>
                            </div>
                            <div className="events-detail-content">
                                <div className="events-detail-title-row">
                                    <div><p className="events-detail-eyebrow">{viewingEvent.id} · {viewingEvent.organizer || "Event organizer"}</p><h3 id="event-details-title">{viewingEvent.name}</h3></div>
                                    <span className={`events-status events-status-${viewingEvent.status.toLowerCase()}`}>{viewingEvent.status}</span>
                                </div>
                                <section className="events-detail-section" aria-label="Event information">
                                    <div className="events-detail-info-row"><span className="events-detail-info-icon" aria-hidden="true">T</span><div><small>Event type</small><strong>{viewingEvent.targetDepartment || viewingEvent.targetCourse ? "Department-specific" : "School-wide"}</strong></div></div>
                                    {viewingEvent.targetDepartment && <div className="events-detail-info-row"><span className="events-detail-info-icon" aria-hidden="true">D</span><div><small>Department</small><strong>{departments.find((item) => item.code === viewingEvent.targetDepartment)?.name || viewingEvent.targetDepartment}</strong></div></div>}
                                    <div className="events-detail-info-row"><span className="events-detail-info-icon" aria-hidden="true">▣</span><div><small>Date</small><strong>{eventDateLabel(viewingEvent.date)}{viewingEvent.endDate && viewingEvent.endDate !== viewingEvent.date ? ` – ${eventDateLabel(viewingEvent.endDate)}` : ""}</strong></div></div>
                                    <div className="events-detail-info-row"><span className="events-detail-info-icon" aria-hidden="true">◷</span><div><small>Time</small><strong>{eventTimeLabel(viewingEvent)}</strong></div></div>
                                    <div className="events-detail-info-row"><span className="events-detail-info-icon" aria-hidden="true">●</span><div><small>Venue</small><strong>{viewingEvent.venue || "To be announced"}</strong></div></div>
                                </section>
                                <section className="events-detail-section events-detail-prose"><h4>About the Event</h4><p>{viewingEvent.description || "No event description has been provided."}</p></section>
                                <section className="events-detail-section events-detail-eligibility">
                                    <h4>Who Can Join</h4>
                                    <div className="events-detail-info-row"><span className="events-detail-info-icon" aria-hidden="true">P</span><div><small>Eligible participants</small><strong>{eventAudienceSummary(viewingEvent, departments)}</strong></div></div>
                                    <div className="events-detail-info-row"><span className="events-detail-info-icon" aria-hidden="true">C</span><div><small>Allowed courses</small><strong>{viewingEvent.targetCourse || "All programs"}</strong></div></div>
                                    <div className="events-detail-info-row"><span className="events-detail-info-icon" aria-hidden="true">Y</span><div><small>Year level</small><strong>{viewingEvent.targetYear || "All year levels (1st–4th Year)"}</strong></div></div>
                                    <div className="events-detail-info-row"><span className="events-detail-info-icon" aria-hidden="true">S</span><div><small>Available slots</small><strong>{viewingEvent.hasCapacity ? `${Math.max(0, Number(viewingEvent.capacity) - Number(viewingEvent.participants || 0))} available out of ${viewingEvent.capacity} slots` : `${viewingEvent.participants || 0} registered · No capacity limit`}</strong></div></div>
                                    <div className="events-detail-info-row"><span className="events-detail-info-icon" aria-hidden="true">D</span><div><small>Registration deadline</small><strong>{viewingEvent.registrationDeadline ? eventDateLabel(viewingEvent.registrationDeadline) : "Until the event date"}</strong></div></div>
                                </section>
                                {viewingEvent.attendanceCompulsory && <section className="events-detail-section events-detail-eligibility">
                                    <h4>Compulsory attendance</h4>
                                    <p>Required-student roster: {attendanceRoster?.event?.roster_finalized_at ? `${attendanceRoster?.obligations?.length ?? 0} students finalized` : "Not finalized"}. QR attendance is validated by the server; proposed fines require review.</p>
                                    <div className="events-detail-actions">
                                        <button type="button" className="events-btn events-btn-secondary" disabled={attendanceBusy || Boolean(attendanceRoster?.event?.roster_finalized_at) || !["Approved", "Completed"].includes(viewingEvent.status)} onClick={() => runAttendanceAction("finalize")}>{attendanceRoster?.event?.roster_finalized_at ? "Roster finalized" : ["Approved", "Completed"].includes(viewingEvent.status) ? "Finalize student roster" : "Approve event to finalize roster"}</button>
                                        <button type="button" className="events-btn events-btn-primary" disabled={attendanceBusy || !attendanceRoster?.event?.roster_finalized_at} onClick={() => runAttendanceAction("assess")}>Assess proposed fines</button>
                                    </div>
                                    {attendanceRoster?.obligations?.filter((item) => item.fine?.assessment_status === "proposed").map((item) => <div className="events-detail-info-row" key={item.id}>
                                        <span className="events-detail-info-icon" aria-hidden="true">₱</span><div><small>{item.student_name} · {item.fine.reason === "absence" ? "Absent" : "Incomplete attendance"}</small><strong>₱{Number(item.fine.amount).toFixed(2)} proposed</strong></div>
                                        <button type="button" className="events-btn events-btn-secondary" disabled={attendanceBusy} onClick={() => reviewProposedFine(item.fine.id, "approve")}>Approve</button>
                                        <button type="button" className="events-btn events-btn-secondary" disabled={attendanceBusy} onClick={() => reviewProposedFine(item.fine.id, "reject")}>Reject</button>
                                    </div>)}
                                </section>}
                                <section className="events-detail-registration"><div><small>Registration</small><strong>{viewingEvent.registrationOpen === false ? "Registration closed" : "Registration open"}</strong></div><span className={`events-registration-indicator${viewingEvent.registrationOpen === false ? " is-closed" : ""}`} aria-hidden="true" /></section>
                            </div>
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
                            <div className="events-form-section">
                                <h4 className="events-form-section-title">Event information</h4>
                                <div className="events-form-group">
                                <label htmlFor="evName">Event name <span className="events-required"></span></label>
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
                            </div>

                            <div className="events-form-section events-audience-section">
                                <h4 className="events-form-section-title events-audience-heading">Audience eligibility</h4>
                                <div className="events-form-row-split events-audience-grid">
                                    <div className="events-form-group">
                                        <label htmlFor="evAudienceType">Event type</label>
                                        <select
                                            id="evAudienceType"
                                            value={editingEvent.audienceType || "School-Wide"}
                                            onChange={(e) => {
                                                const audienceType = e.target.value;
                                                setEditingEvent((current) => ({
                                                    ...current,
                                                    audienceType,
                                                    targetDepartment: audienceType === "School-Wide" ? "" : current.targetDepartment,
                                                    targetCourse: audienceType === "School-Wide" ? PUBLIC_AUDIENCE : current.targetCourse,
                                                    targetYear: audienceType === "School-Wide" ? "" : current.targetYear,
                                                }));
                                                setFormErrors((current) => ({ ...current, audienceType: "", targetDepartment: "", targetCourse: "" }));
                                            }}
                                        >
                                            <option value="School-Wide">School-wide</option>
                                            <option value="Department-Specific">Department-specific</option>
                                        </select>
                                        {formErrors.audienceType && <small className="events-field-error">{formErrors.audienceType}</small>}
                                    </div>
                                    {editingEvent.audienceType === "Department-Specific" && <div className="events-form-group">
                                        <label htmlFor="evTargetDepartment">Target department <span className="events-required"></span></label>
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
                                                setFormErrors((current) => ({ ...current, targetDepartment: "", targetCourse: "" }));
                                            }}
                                        >
                                            <option value="">Choose a department</option>
                                            {departments.map((department) => (
                                                <option key={department.code} value={department.code}>
                                                    {department.code} — {department.name}
                                                </option>
                                            ))}
                                        </select>
                                        {formErrors.targetDepartment && <small className="events-field-error">{formErrors.targetDepartment}</small>}
                                    </div>}
                                    {editingEvent.audienceType === "Department-Specific" && <div className="events-form-group">
                                        <label htmlFor="evAudience">Target program</label>
                                        <select
                                            id="evAudience"
                                            value={editingEvent.targetCourse ?? PUBLIC_AUDIENCE}
                                            onChange={(e) => {
                                                setEditingEvent({ ...editingEvent, targetCourse: e.target.value });
                                                setFormErrors((current) => ({ ...current, targetCourse: "" }));
                                            }}
                                        >
                                            <option value={PUBLIC_AUDIENCE}>All programs</option>
                                            {(departments.find((item) => item.code === editingEvent.targetDepartment)?.courses ?? courses).map((course) => (
                                                <option key={course} value={course}>{course}</option>
                                            ))}
                                        </select>
                                    </div>}
                                    {editingEvent.audienceType === "Department-Specific" && <div className="events-form-group">
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
                                    </div>}
                                    {editingEvent.audienceType === "Department-Specific" && <div className="events-form-group">
                                        <label htmlFor="evTargetBlock">Target block</label>
                                        <input id="evTargetBlock" type="text" maxLength="50" placeholder="All blocks" value={editingEvent.targetBlock ?? ""} onChange={(e) => updateEventField("targetBlock", e.target.value)} />
                                    </div>}
                                </div>
                            </div>
                            <div className="events-form-section">
                                <h4 className="events-form-section-title">Attendance policy</h4>
                                <label className="events-form-checkbox">
                                    <input type="checkbox" checked={Boolean(editingEvent.attendanceCompulsory)} onChange={(e) => updateEventField("attendanceCompulsory", e.target.checked)} />
                                    <span>Compulsory attendance</span>
                                </label>
                                <small className="events-form-hint">Required students are snapshotted when the event is approved. Registration is not required to be included.</small>
                                {editingEvent.attendanceCompulsory && <>
                                    <label className="events-form-checkbox">
                                        <input type="checkbox" checked={editingEvent.attendanceRequiresCheckout !== false} onChange={(e) => updateEventField("attendanceRequiresCheckout", e.target.checked)} />
                                        <span>Require check-in and check-out</span>
                                    </label>
                                    <div className="events-form-row-split">
                                        <div className="events-form-group"><label htmlFor="evAbsenceFine">Proposed fine for absence (₱)</label><input id="evAbsenceFine" type="number" min="0" step="0.01" value={editingEvent.absenceFineAmount ?? ""} onChange={(e) => updateEventField("absenceFineAmount", e.target.value)} placeholder="No fine configured" /></div>
                                        <div className="events-form-group"><label htmlFor="evIncompleteFine">Proposed fine for incomplete attendance (₱)</label><input id="evIncompleteFine" type="number" min="0" step="0.01" value={editingEvent.incompleteFineAmount ?? ""} onChange={(e) => updateEventField("incompleteFineAmount", e.target.value)} placeholder="No fine configured" /></div>
                                    </div>
                                    <div className="events-form-row-split">
                                        <div className="events-form-group"><label htmlFor="evCorrectionDeadline">Attendance correction deadline</label><input id="evCorrectionDeadline" type="datetime-local" value={editingEvent.attendanceCorrectionDeadline?.slice(0, 16) ?? ""} onChange={(e) => updateEventField("attendanceCorrectionDeadline", e.target.value)} /></div>
                                        <div className="events-form-group"><label htmlFor="evExcuseDeadline">Excuse submission deadline</label><input id="evExcuseDeadline" type="datetime-local" value={editingEvent.excuseDeadline?.slice(0, 16) ?? ""} onChange={(e) => updateEventField("excuseDeadline", e.target.value)} /></div>
                                    </div>
                                    <small className="events-form-hint">Fines stay proposed until administrator review. Configure only amounts approved by TMC policy.</small>
                                </>}
                            </div>
                            <div className="events-form-section events-schedule-section">
                                <div className="events-schedule-heading">
                                    <div>
                                        <h4 className="events-form-section-title">Date and time</h4>
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
                                            Start date <span className="events-required"></span>
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
                                            Start time {!editingEvent.allDay && <span className="events-required"></span>}
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
                                        {!formErrors.endDate && <small className="events-form-hint"></small>}
                                    </div>
                                    <div className="events-form-group">
                                        <label htmlFor="evEndTime">
                                            End time {!editingEvent.allDay && <span className="events-required"></span>}
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

                            <div className="events-form-section events-capacity-section">
                                <h4 className="events-form-section-title">Capacity and venue</h4>
                                <div className="events-form-row-split">
                                    <div className="events-form-group events-form-group-wide">
                                    {!isNewEvent && <label className="events-form-checkbox">
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
                                    </label>}
                                    {(editingEvent.hasCapacity || isNewEvent) && (
                                        <div className="events-form-subgroup">
                                            <label htmlFor="evCapacity">Total slots <span className="events-required"></span></label>
                                            <input
                                                id="evCapacity"
                                                type="number"
                                                min="1"
                                                step="1"
                                                required={isNewEvent || Boolean(editingEvent.hasCapacity)}
                                                value={editingEvent.capacity ?? ""}
                                                onChange={(e) => updateEventField(
                                                    "capacity",
                                                    e.target.value === "" ? null : Number(e.target.value),
                                                )}
                                                aria-invalid={Boolean(formErrors.capacity)}
                                                aria-describedby={formErrors.capacity ? "evCapacity-error" : undefined}
                                            />
                                            {formErrors.capacity && <small className="events-field-error" id="evCapacity-error">{formErrors.capacity}</small>}
                                        </div>
                                    )}
                                    </div>
                                    <div className="events-form-group events-form-group-wide">
                                        <label htmlFor="evVenue">Venue <span className="events-required"></span></label>
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
                                </div>
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
                                    <label htmlFor="evRegistrationDeadline">Registration deadline {isNewEvent && <span className="events-required"></span>}</label>
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
                                </div>
                            </div>

                            <div className="events-form-section events-description-section">
                                <h4 className="events-form-section-title">About the event</h4>
                                <div className="events-form-group">
                                <label htmlFor="evDescription">Description {isNewEvent && <span className="events-required"></span>}</label>
                                <textarea
                                    id="evDescription"
                                    rows="3"
                                    aria-invalid={Boolean(formErrors.description)}
                                    aria-describedby={formErrors.description ? "evDescription-error" : undefined}
                                    value={editingEvent.description}
                                    onChange={(e) => updateEventField("description", e.target.value)}
                                />
                                {isNewEvent && <small className="events-form-hint">Add at least 20 characters describing the event.</small>}
                                {formErrors.description && <small className="events-field-error" id="evDescription-error">{formErrors.description}</small>}
                                </div>
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
