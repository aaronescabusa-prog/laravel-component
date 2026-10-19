import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import "./Registrations.css";
import AppShell from "./components/AppShell";
import Toast from "./components/Toast";
import ConfirmDialog from "./components/ConfirmDialog";
import useDialogA11y from "./components/useDialogA11y";
import QrCode from "./components/QrCode";
import { useToast } from "./lib/useToast";
import { useCollection, logActivity, nextId, dateKey } from "./lib/storage";
import { api, mapEventFromApi, REGISTRATION_ROLES, registrationsApi } from "./lib/api";
import { downloadCSV, dateStamp } from "./lib/csv";
import { usePagination } from "./lib/usePagination";
import { useRowSelection } from "./lib/useRowSelection";
import Pagination from "./components/Pagination";
import StatusBadge from "./components/StatusBadge";
import { ActionIcon, IconView, IconEdit, IconCheck, IconTrash, IconCheckCircle, IconCheckSquare } from "./components/Icons";

const EVENT_NAMES = [];
const STUDENT_PASS_QR_PREFIX = "EVENTEASE_STUDENT:";

function createStudentPassCode() {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(5));
    const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
    return `PASS-${token}`;
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

function formatEventSchedule(event) {
    const formatDate = (value) => {
        if (!value) return "Date to be announced";
        const date = new Date(`${value}T00:00:00`);
        return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
    };
    const start = formatDate(event.date);
    return event.endDate && event.endDate !== event.date ? `${start} – ${formatDate(event.endDate)}` : start;
}

function Registrations() {
    const { toast, showToast, dismissToast } = useToast();
    const [registrations, setRegistrations] = useCollection("registrations", (msg) => showToast(msg, "danger"));
    const [search, setSearch] = useState("");
    const [eventFilter, setEventFilter] = useState(() => new URLSearchParams(window.location.search).get("event") || "all");
    const [viewingItem, setViewingItem] = useState(null);
    const [duplicateWarning, setDuplicateWarning] = useState(null);
    const [editingReg, setEditingReg] = useState(null);
    const [isNewReg, setIsNewReg] = useState(false);
    const [pendingDelete, setPendingDelete] = useState(null);
    const [bulkBusy, setBulkBusy] = useState(false);
    const [reminderSkipped, setReminderSkipped] = useState(null);
    const viewDialogRef = useDialogA11y(Boolean(viewingItem), () => setViewingItem(null));
    const editDialogRef = useDialogA11y(Boolean(editingReg), () => setEditingReg(null));

    // Event choices follow the Events collection from the backend, so a newly
    // created event is immediately selectable here.
    const [eventOptions, setEventOptions] = useState([]);
    useEffect(() => {
        let active = true;
        api.list("events")
            .then((rows) => { if (active) setEventOptions(rows.map(mapEventFromApi)); })
            .catch(() => {});
        return () => { active = false; };
    }, []);

    const filteredRows = useMemo(() => {
        return registrations.filter((row) => {
            const term = search.trim().toLowerCase();
            const matchesSearch = !term || row.participant.toLowerCase().includes(term) || row.email.toLowerCase().includes(term) || row.id.toLowerCase().includes(term);
            const matchesEvent = eventFilter === "all" || row.event === eventFilter;
            return matchesSearch && matchesEvent;
        });
    }, [registrations, search, eventFilter]);

    const pager = usePagination(filteredRows, {
        resetKey: [search, eventFilter].join("|"),
    });

    const selection = useRowSelection({
        pageRows: pager.pageRows,
        matchingRows: filteredRows,
        resetKey: [search, eventFilter].join("|"),
    });
    const viewingEvent = eventOptions.find((event) => event.name === viewingItem?.event);

    function toggleAttendance(row) {
        const next = row.attendance === "Present" ? "Not Yet Recorded" : "Present";

        setRegistrations((prev) => prev.map((r) => (r.id === row.id ? { ...r, attendance: next } : r)));
        logActivity({
            category: "Registration",
            action: `${next === "Present" ? "Checked in" : "Undid check-in for"} ${row.id}`,
            details: `${row.participant} · ${row.event}`,
        });
        showToast(`${row.participant} ${next === "Present" ? "checked in" : "check-in undone"}.`);
    }

    function verifyPayment(row) {
        setRegistrations((prev) => prev.map((r) => (r.id === row.id ? { ...r, paymentStatus: "Paid" } : r)));
        logActivity({
            category: "Payment",
            action: `Verified payment for ${row.id}`,
            details: `${row.event} — ${row.payment}`,
        });
        showToast(`Payment for ${row.participant} verified.`);
    }

    /**
     * Mark every ticked registration that is still Pending as Paid in one pass.
     * Rows already Paid/Refunded/N-A are left untouched so the action is safe
     * to run against a mixed selection.
     */
    function verifySelectedPayments() {
        const rows = selection.selectedRows;
        if (rows.length === 0) return;

        const pendingIds = new Set(rows.filter((r) => r.paymentStatus === "Pending").map((r) => r.id));
        if (pendingIds.size === 0) {
            showToast("No pending payments in the current selection.", "danger");
            return;
        }

        setRegistrations((prev) =>
            prev.map((r) => (pendingIds.has(r.id) ? { ...r, paymentStatus: "Paid" } : r))
        );
        logActivity({
            category: "Payment",
            action: `Verified payment for ${pendingIds.size} registration${pendingIds.size === 1 ? "" : "s"}`,
            details: rows.filter((r) => pendingIds.has(r.id)).map((r) => `${r.participant} (${r.id})`).join(", "),
        });
        showToast(`Verified ${pendingIds.size} pending payment${pendingIds.size === 1 ? "" : "s"}.`);
    }

    function exportCSV() {
        const rows = [
            ["ID", "Participant", "Email", "Role", "Block No.", "Event", "Reg. Date", "Payment", "Payment Status", "Attendance"],
            ...filteredRows.map((r) => [r.id, r.participant, r.email, r.role, r.blockNo, r.event, r.regDate, r.payment, r.paymentStatus, r.attendance]),
        ];
        downloadCSV(`registrations-${dateStamp()}.csv`, rows);
        showToast(`Exported ${filteredRows.length} registration${filteredRows.length === 1 ? "" : "s"}.`);
    }

    /** Same columns as exportCSV, narrowed to whatever is ticked. */
    function exportSelectedCSV() {
        const rows = [
            ["ID", "Participant", "Email", "Role", "Block No.", "Event", "Reg. Date", "Payment", "Payment Status", "Attendance"],
            ...selection.selectedRows.map((r) => [r.id, r.participant, r.email, r.role, r.blockNo, r.event, r.regDate, r.payment, r.paymentStatus, r.attendance]),
        ];
        downloadCSV(`registrations-selected-${dateStamp()}.csv`, rows);
        showToast(`Exported ${selection.selectedRows.length} selected registration${selection.selectedRows.length === 1 ? "" : "s"}.`);
    }

    function requestBulkDelete() {
        const rows = selection.selectedRows;
        if (rows.length === 0) return;
        setPendingDelete({
            rows,
            label: `${rows.length} selected registration${rows.length === 1 ? "" : "s"}`,
        });
    }

    /**
     * Queue a reminder for every ticked registration.
     *
     * The rows are handed over as references in a single request; the server
     * dispatches one queued job each, so the browser is not left waiting on
     * mail. Registrations with no resolvable event are reported back as skipped
     * rather than silently dropped.
     */
    async function sendReminders() {
        const rows = selection.selectedRows;
        if (rows.length === 0) return;

        setBulkBusy(true);

        try {
            const result = await registrationsApi.sendReminders(rows.map((r) => r.id));
            const queued = result?.queued ?? 0;
            const skipped = Array.isArray(result?.skipped) ? result.skipped : [];

            logActivity({
                category: "Registration",
                action: `Sent reminders to ${queued} registration${queued === 1 ? "" : "s"}`,
                details: rows.map((r) => `${r.participant} (${r.id})`).join(", "),
            });

            showToast(
                skipped.length > 0
                    ? `${queued} reminder${queued === 1 ? "" : "s"} queued, ${skipped.length} skipped.`
                    : `${queued} reminder${queued === 1 ? "" : "s"} queued.`,
                queued > 0 ? "success" : "danger"
            );

            if (skipped.length > 0) {
                setReminderSkipped(skipped);
            }

            selection.clear();
        } catch (err) {
            showToast(err.message || "Could not queue the reminders.", "danger");
        } finally {
            setBulkBusy(false);
        }
    }

    /* ---------- Create / update / delete ---------- */

    function openCreateReg() {
        setEditingReg({
            id: nextId(registrations, "TMC", 8841),
            participant: "",
            email: "",
            role: "Student",
            blockNo: "",
            event: eventOptions[0]?.name ?? "",
            regDate: dateKey(),
            payment: "Free",
            paymentStatus: "N/A",
            attendance: "Not Yet Recorded",
            qrCode: "",
        });
        setIsNewReg(true);
    }

    function openEditReg(row) {
        setEditingReg({ ...row });
        setIsNewReg(false);
    }

    function openRegistrationDetails(row) {
        if (row.qrCode) {
            setViewingItem(row);
            return;
        }

        const updated = { ...row, qrCode: createStudentPassCode() };
        setViewingItem(updated);
        setRegistrations((prev) => prev.map((registration) => (
            registration.id === row.id ? updated : registration
        )));
    }

    function saveReg() {
        if (!editingReg.participant.trim() || !editingReg.email.trim() || !editingReg.event.trim()) {
            showToast("Participant, email and event are required.", "danger");
            return;
        }

        if (isNewReg) {
            const created = {
                ...editingReg,
                qrCode: editingReg.qrCode || createStudentPassCode(),
            };

            setRegistrations((prev) => [created, ...prev]);
            logActivity({
                category: "Registration",
                action: `Created registration ${created.id}`,
                details: `${created.participant} · ${created.event}`,
            });
            showToast(`Registration ${created.id} was added.`);
        } else {
            const updated = { ...editingReg, qrCode: editingReg.qrCode || createStudentPassCode() };
            setRegistrations((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
            logActivity({
                category: "Registration",
                action: `Updated registration ${updated.id}`,
                details: `${editingReg.participant} · ${editingReg.event} · ${editingReg.paymentStatus}`,
            });
            showToast(`Registration ${updated.id} was updated.`);
        }
        setEditingReg(null);
    }

    function requestDelete(row) {
        setPendingDelete({ rows: [row], label: `${row.participant} (${row.id})` });
    }

    function confirmDelete() {
        const rows = pendingDelete?.rows ?? [];
        const ids = rows.map((r) => r.id);

        setRegistrations((prev) => prev.filter((r) => !ids.includes(r.id)));
        logActivity({
            category: "Registration",
            action: `Deleted ${ids.length} registration${ids.length === 1 ? "" : "s"}`,
            details: rows.map((r) => `${r.participant} (${r.id})`).join(", "),
        });
        showToast(`${ids.length} registration${ids.length === 1 ? "" : "s"} deleted.`);
        setPendingDelete(null);
    }

    function checkDuplicates() {
        const seen = new Map();
        const duplicates = [];

        registrations.forEach((r) => {
            const key = `${r.email}|${r.event}`;
            if (seen.has(key)) {
                duplicates.push({ participant: r.participant, event: r.event });
            } else {
                seen.set(key, true);
            }
        });

        setDuplicateWarning(duplicates.length > 0 ? duplicates : []);
    }

    const total = registrations.length;
    const present = registrations.filter((r) => r.attendance === "Present").length;
    const pendingPayment = registrations.filter((r) => r.paymentStatus === "Pending").length;
    const totalCollected = registrations
        .filter((r) => r.paymentStatus === "Paid")
        .reduce((sum, r) => sum + (parseFloat(r.payment.replace(/[₱,]/g, "")) || 0), 0);

    return (
        <AppShell title="Registrations" prefix="regs-">

            <div className="regs-kpi-strip">
                <div className="regs-kpi-item">
                    <span className="regs-kpi-label">Total Registrations</span>
                    <span className="regs-kpi-value">{total}</span>
                </div>
                <div className="regs-kpi-item">
                    <span className="regs-kpi-label">Present</span>
                    <span className="regs-kpi-value">{present}</span>
                </div>
                <div className="regs-kpi-item regs-kpi-alert">
                    <span className="regs-kpi-label">Pending Payment</span>
                    <span className="regs-kpi-value">{pendingPayment}</span>
                </div>
                <div className="regs-kpi-item">
                    <span className="regs-kpi-label">Total Collected</span>
                    <span className="regs-kpi-value">₱{totalCollected.toFixed(2)}</span>
                </div>
            </div>

            <section className="regs-panel">
                <div className="regs-panel-header">
                    <h2>{eventFilter === "all" ? "All Registrations" : `Registrations · ${eventFilter}`}</h2>
                    <div className="regs-panel-actions">
                        <Link className="regs-btn regs-btn-secondary regs-return-link" to="/events"><span aria-hidden="true">←</span> Back to Events</Link>
                        <button className="regs-btn regs-btn-secondary" onClick={checkDuplicates}>Check Duplicates</button>
                        <button className="regs-btn regs-btn-primary" onClick={openCreateReg}>+ Add Registration</button>
                    </div>
                </div>

                {duplicateWarning !== null && (
                    <div className={`regs-duplicate-banner ${duplicateWarning.length === 0 ? "regs-duplicate-clear" : ""}`}>
                        {duplicateWarning.length === 0 ? (
                            <span>✓ No duplicate registrations found.</span>
                        ) : (
                            <span>
                                ⚠ {duplicateWarning.length} duplicate registration{duplicateWarning.length > 1 ? "s" : ""} found:{" "}
                                {duplicateWarning.map((d, i) => (
                                    <span key={i}>{d.participant} ({d.event}){i < duplicateWarning.length - 1 ? ", " : ""}</span>
                                ))}
                            </span>
                        )}
                        <button className="regs-duplicate-dismiss" onClick={() => setDuplicateWarning(null)}>×</button>
                    </div>
                )}

                <div className="regs-toolbar">
                    <input
                        type="text"
                        className="regs-input-search"
                        placeholder="Search by name, email, or ID"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        aria-label="Search registrations"
                    />

                    <button className="regs-btn regs-btn-secondary regs-btn-toolbar" onClick={exportCSV}>Export CSV</button>
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
                            <button className="regs-btn regs-btn-secondary" onClick={verifySelectedPayments} disabled={bulkBusy}>
                                Verify payment for selected
                            </button>
                            <button className="regs-btn regs-btn-secondary" onClick={sendReminders} disabled={bulkBusy}>
                                Send reminder to selected
                            </button>
                            <button className="regs-btn regs-btn-secondary" onClick={exportSelectedCSV} disabled={bulkBusy}>
                                Export selected
                            </button>
                            <button className="regs-btn regs-btn-secondary regs-btn-danger-outline" onClick={requestBulkDelete} disabled={bulkBusy}>
                                Delete selected
                            </button>
                            <button className="btn-clear" onClick={selection.clear} disabled={bulkBusy}>Clear</button>
                        </div>
                    </div>
                )}

                <div className="regs-table-wrapper">
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
                                        aria-label="Select all registrations on this page"
                                    />
                                </th>
                                <th>Participant</th>
                                <th>Block No.</th>
                                <th>Role</th>
                                <th>Event</th>
                                <th>Reg. Date</th>
                                <th>Payment</th>
                                <th>Attendance</th>
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
                                            aria-label={`Select ${row.participant}`}
                                        />
                                    </td>
                                    <td>
                                        <div className="regs-cell">
                                            <span className="regs-row-avatar">{initialsOf(row.participant)}</span>
                                            <div className="regs-cell-text">
                                                <span className="regs-cell-name">{row.participant}</span>
                                                <span className="regs-cell-email">{row.email || "No email on file"}</span>
                                                <span className="regs-cell-id">{row.id}</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="regs-cell-muted">{row.blockNo || "—"}</td>
                                    <td>
                                        <span className={`role-badge role-${(row.role || "Student").toLowerCase()}`}>{row.role || "Student"}</span>
                                    </td>
                                    <td className="regs-cell-muted">{row.event}</td>
                                    <td className="regs-cell-muted">{row.regDate}</td>
                                    <td>
                                        <div className="regs-payment-cell">
                                            <span className="regs-payment-amount">{row.payment}</span>
                                            <StatusBadge status={row.paymentStatus} className="regs-payment-status" />
                                        </div>
                                    </td>
                                    <td>
                                        <StatusBadge status={row.attendance} className="regs-attendance" />
                                    </td>
                                    <td className="regs-cell-actions">
                                        <ActionIcon icon={IconView} label="View" onClick={() => openRegistrationDetails(row)} />
                                        {row.paymentStatus === "Pending" && (
                                            <ActionIcon icon={IconCheck} label="Verify Payment" tone="approve" onClick={() => verifyPayment(row)} />
                                        )}
                                        <ActionIcon icon={IconCheckSquare} label={row.attendance === "Present" ? "Undo Check-in" : "Check In"} tone={row.attendance === "Present" ? undefined : "approve"} onClick={() => toggleAttendance(row)} />
                                        <ActionIcon icon={IconEdit} label="Edit" onClick={() => openEditReg(row)} />
                                        <ActionIcon icon={IconTrash} label="Delete" tone="danger" onClick={() => requestDelete(row)} />
                                    </td>
                                </tr>
                            ))}
                            {filteredRows.length === 0 && (
                                <tr>
                                    <td colSpan="9" className="regs-empty-row">No registrations match your filters.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                <Pagination
                    {...pager}
                    unit="registrations"
                />
            </section>


            {viewingItem && (
                <div className="regs-modal-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) setViewingItem(null); }}>
                    <div ref={viewDialogRef} tabIndex={-1} className="regs-modal-card" role="dialog" aria-modal="true" aria-labelledby="registration-details-title" onClick={(e) => e.stopPropagation()}>
                        <div className="regs-modal-header">
                            <h3 id="registration-details-title">Registration Details</h3>
                            <button type="button" className="regs-modal-close" onClick={() => setViewingItem(null)} aria-label="Close">×</button>
                        </div>
                        <div className="regs-modal-body">
                            <div className="regs-qr-block">
                                <strong>Student Pass QR</strong>
                                <QrCode
                                    value={viewingItem.qrCode ? `${STUDENT_PASS_QR_PREFIX}${viewingItem.qrCode}` : ""}
                                    alt={`Student pass QR code for ${viewingItem.participant}`}
                                />
                                <span className="regs-qr-code">{viewingItem.qrCode}</span>
                            </div>

                            <dl className="regs-detail-list">
                                <dt>Registration ID</dt><dd>{viewingItem.id}</dd>
                                <dt>Participant</dt><dd>{viewingItem.participant}</dd>
                                <dt>Email</dt><dd>{viewingItem.email}</dd>
                                <dt>Role</dt><dd>{viewingItem.role || "Student"}</dd>
                                <dt>Block No.</dt><dd>{viewingItem.blockNo || "—"}</dd>
                                <dt>Event</dt><dd>{viewingItem.event}</dd>
                                {viewingEvent && <>
                                    <dt>Event Schedule</dt><dd>{formatEventSchedule(viewingEvent)}{viewingEvent.startTime ? ` · ${viewingEvent.startTime}` : ""}{viewingEvent.endTime ? `–${viewingEvent.endTime}` : ""}</dd>
                                    <dt>Venue</dt><dd>{viewingEvent.venue || "—"}</dd>
                                    <dt>Organizer</dt><dd>{viewingEvent.organizer || "—"}</dd>
                                </>}
                                <dt>Registration Date</dt><dd>{viewingItem.regDate}</dd>
                                <dt>Payment</dt><dd>{viewingItem.payment} — {viewingItem.paymentStatus}</dd>
                                <dt>Attendance</dt><dd>{viewingItem.attendance}</dd>
                            </dl>
                        </div>
                        <div className="regs-modal-footer">
                            <button
                                className="regs-btn regs-btn-secondary"
                                onClick={async () => {
                                    try {
                                        await registrationsApi.downloadCalendar(viewingItem.id);
                                    } catch {
                                        showToast("Could not download the calendar invite.", "danger");
                                    }
                                }}
                            >
                                📅 Add to Calendar
                            </button>
                            <button className="regs-btn regs-btn-secondary" onClick={() => setViewingItem(null)}>Close</button>
                        </div>
                    </div>
                </div>
            )}

            {editingReg && (
                <div className="regs-modal-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) setEditingReg(null); }}>
                    <div ref={editDialogRef} tabIndex={-1} className="regs-modal-card" role="dialog" aria-modal="true" aria-labelledby="registration-editor-title" onClick={(e) => e.stopPropagation()}>
                        <div className="regs-modal-header">
                            <h3 id="registration-editor-title">{isNewReg ? "Add Registration" : "Edit Registration"}</h3>
                            <button type="button" className="regs-modal-close" onClick={() => setEditingReg(null)} aria-label="Close">×</button>
                        </div>
                        <div className="regs-modal-body">
                            <div className="form-group">
                                <label htmlFor="regParticipant">Participant name</label>
                                <input
                                    id="regParticipant"
                                    type="text"
                                    value={editingReg.participant}
                                    onChange={(e) => setEditingReg({ ...editingReg, participant: e.target.value })}
                                />
                            </div>

                            <div className="form-group">
                                <label htmlFor="regEmail">Email</label>
                                <input
                                    id="regEmail"
                                    type="email"
                                    value={editingReg.email}
                                    onChange={(e) => setEditingReg({ ...editingReg, email: e.target.value })}
                                />
                            </div>

                            <div className="form-row-split">
                                <div className="form-group">
                                    <label htmlFor="regBlockNo">Block No.</label>
                                    <input
                                        id="regBlockNo"
                                        type="text"
                                        placeholder="Block A"
                                        value={editingReg.blockNo || ""}
                                        onChange={(e) => setEditingReg({ ...editingReg, blockNo: e.target.value })}
                                    />
                                </div>
                                <div className="form-group">
                                    <label htmlFor="regRole">Role</label>
                                    <select
                                        id="regRole"
                                        value={editingReg.role || "Student"}
                                        onChange={(e) => setEditingReg({ ...editingReg, role: e.target.value })}
                                    >
                                        {REGISTRATION_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div className="form-group">
                                <label htmlFor="regEvent">Event</label>
                                <select
                                    id="regEvent"
                                    value={editingReg.event}
                                    onChange={(e) => setEditingReg({ ...editingReg, event: e.target.value })}
                                >
                                    {eventOptions.map((event) => <option key={event.id} value={event.name}>{event.name}</option>)}
                                </select>
                            </div>

                            <div className="form-row-split">
                                <div className="form-group">
                                    <label htmlFor="regDate">Registration date</label>
                                    <input
                                        id="regDate"
                                        type="date"
                                        value={editingReg.regDate}
                                        onChange={(e) => setEditingReg({ ...editingReg, regDate: e.target.value })}
                                    />
                                </div>
                                <div className="form-group">
                                    <label htmlFor="regPayment">Payment</label>
                                    <input
                                        id="regPayment"
                                        type="text"
                                        placeholder="Free or ₱150.00"
                                        value={editingReg.payment}
                                        onChange={(e) => setEditingReg({ ...editingReg, payment: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="form-row-split">
                                <div className="form-group">
                                    <label htmlFor="regPaymentStatus">Payment status</label>
                                    <select
                                        id="regPaymentStatus"
                                        value={editingReg.paymentStatus}
                                        onChange={(e) => setEditingReg({ ...editingReg, paymentStatus: e.target.value })}
                                    >
                                        <option>N/A</option>
                                        <option>Paid</option>
                                        <option>Pending</option>
                                        <option>Refunded</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label htmlFor="regAttendance">Attendance</label>
                                    <select
                                        id="regAttendance"
                                        value={editingReg.attendance}
                                        onChange={(e) => setEditingReg({ ...editingReg, attendance: e.target.value })}
                                    >
                                        <option>Not Yet Recorded</option>
                                        <option>Present</option>
                                        <option>Absent</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                        <div className="regs-modal-footer">
                            <button className="regs-btn regs-btn-secondary" onClick={() => setEditingReg(null)}>Cancel</button>
                            <button className="regs-btn regs-btn-primary" onClick={saveReg}>
                                {isNewReg ? "Add Registration" : "Save Changes"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <ConfirmDialog
                open={Boolean(pendingDelete)}
                title="Delete registration"
                message={pendingDelete ? `Permanently delete ${pendingDelete.label}? This cannot be undone.` : ""}
                confirmLabel="Delete registration"
                onConfirm={confirmDelete}
                onCancel={() => setPendingDelete(null)}
            />

            {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={dismissToast} />}

        </AppShell>
    );
}

export default Registrations;
