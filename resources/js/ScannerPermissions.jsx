import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "./components/AppShell";
import Toast from "./components/Toast";
import { ActionIcon, IconCheck, IconScanner, IconX } from "./components/Icons";
import { api, eventScannersApi, mapEventFromApi } from "./lib/api";
import { useToast } from "./lib/useToast";
import "./ScannerPermissions.css";

/**
 * Admin surface: assign Scanner accounts to an event.
 *
 * GET /events/{event}/scanners returns every Scanner account plus the ids that
 * are currently assigned to the event; PUT replaces the whole assignment with
 * the list we send. We keep a single `activeIds` set as the source of truth —
 * checking a box adds to it, unchecking (or the remove button) removes from it —
 * and always send that full set, so a freshly-ticked scanner can never be
 * dropped the way a "diff against the original list" save would drop it.
 *
 * `{event}` binds on the event `reference` (Event::getRouteKeyName), which is
 * what mapEventFromApi exposes as `id`.
 */

// Tones that map onto the shared status badge palette in ui.css.
const STATUS_CLASS = {
    Active: "events-status-approved",
    Pending: "events-status-pending",
    Suspended: "events-status-cancelled",
    Inactive: "events-status-cancelled",
};

const statusClass = (status) => STATUS_CLASS[status] || "events-status-pending";

export default function ScannerPermissions() {
    const { toast, showToast, dismissToast } = useToast();

    const [events, setEvents] = useState([]);
    const [eventsLoading, setEventsLoading] = useState(true);
    const [loadError, setLoadError] = useState("");

    const [selectedRef, setSelectedRef] = useState("");
    const [scanners, setScanners] = useState([]);
    const [activeIds, setActiveIds] = useState(() => new Set());
    const [savedIds, setSavedIds] = useState(() => new Set());
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState("");
    const [saving, setSaving] = useState(false);

    // Load the event picker once. Reuse the same mapping Events.jsx uses so the
    // list shape (title, reference, status, date) stays identical.
    useEffect(() => {
        let active = true;
        setEventsLoading(true);
        api
            .list("events", { per_page: "all" })
            .then((rows) => {
                if (!active) return;
                setEvents(rows.map(mapEventFromApi));
                setLoadError("");
            })
            .catch((err) => {
                if (active) setLoadError(err.message || "Could not load events.");
            })
            .finally(() => {
                if (active) setEventsLoading(false);
            });
        return () => {
            active = false;
        };
    }, []);

    // Load the scanner roster whenever the picked event changes.
    const loadScanners = useCallback(async (ref) => {
        if (!ref) {
            setScanners([]);
            setActiveIds(new Set());
            setSavedIds(new Set());
            setDetailError("");
            return;
        }
        setDetailLoading(true);
        setDetailError("");
        try {
            const payload = await eventScannersApi.get(ref);
            const assigned = new Set((payload.assigned ?? []).map(Number));
            setScanners(payload.scanners ?? []);
            setActiveIds(new Set(assigned));
            setSavedIds(new Set(assigned));
        } catch (err) {
            setDetailError(err.message || "Could not load scanners for this event.");
        } finally {
            setDetailLoading(false);
        }
    }, []);

    useEffect(() => {
        loadScanners(selectedRef);
    }, [selectedRef, loadScanners]);

    const toggleScanner = (id) => {
        setActiveIds((prev) => {
            const next = new Set(prev);
            const key = Number(id);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const removeScanner = (id) => {
        setActiveIds((prev) => {
            const next = new Set(prev);
            next.delete(Number(id));
            return next;
        });
    };

    const assignedScanners = useMemo(
        () => scanners.filter((scanner) => activeIds.has(Number(scanner.id))),
        [scanners, activeIds]
    );
    const availableScanners = useMemo(
        () => scanners.filter((scanner) => !activeIds.has(Number(scanner.id))),
        [scanners, activeIds]
    );

    const dirty = useMemo(() => {
        if (activeIds.size !== savedIds.size) return true;
        for (const id of activeIds) if (!savedIds.has(id)) return true;
        return false;
    }, [activeIds, savedIds]);

    const saveAssignment = async () => {
        if (!selectedEvent) return;
        setSaving(true);
        try {
            const payload = await eventScannersApi.update(
                selectedEvent.id,
                Array.from(activeIds)
            );
            // The endpoint echoes back the fresh roster; adopt it so the UI
            // reflects exactly what the server stored.
            const assigned = new Set((payload.assigned ?? []).map(Number));
            setScanners(payload.scanners ?? scanners);
            setActiveIds(new Set(assigned));
            setSavedIds(new Set(assigned));
            showToast(`Scanners updated for ${selectedEvent.name}.`);
        } catch (err) {
            showToast(err.message || "Could not save the assignment.", "danger");
        } finally {
            setSaving(false);
        }
    };

    const selectedEvent = useMemo(
        () => events.find((event) => event.id === selectedRef) || null,
        [events, selectedRef]
    );

    return (
        <AppShell
            title="Scanner Permissions"
            subtitle="Assign the Scanner accounts allowed to check attendees in for each event."
        >
            <div className="scanner-page">
                <div className="events-form-group">
                    <label htmlFor="scannerEvent">Event</label>
                    <select
                        id="scannerEvent"
                        value={selectedRef}
                        onChange={(e) => setSelectedRef(e.target.value)}
                        disabled={eventsLoading || !!loadError}
                    >
                        <option value="">
                            {eventsLoading ? "Loading events…" : "Choose an event…"}
                        </option>
                        {events.map((event) => (
                            <option key={event._id} value={event.id}>
                                {event.name} — {event.date}
                                {event.status ? ` (${event.status})` : ""}
                            </option>
                        ))}
                    </select>
                    {loadError && <p className="events-field-help">{loadError}</p>}
                </div>

                {!selectedRef && !eventsLoading && !loadError && (
                    <div className="events-empty-row">
                        Pick an event to manage who can scan it.
                    </div>
                )}

                {selectedRef && (
                    <div className="scanner-panels">
                        {detailError && (
                            <div className="events-empty-row" role="alert">
                                {detailError}
                            </div>
                        )}

                        {detailLoading && !detailError && (
                            <div className="events-empty-row">Loading scanners…</div>
                        )}

                        {!detailLoading && !detailError && (
                            <>
                                <section className="scanner-panel" aria-labelledby="assignedHead">
                                    <div className="scanner-panel-head">
                                        <span className="scanner-panel-icon" aria-hidden="true">
                                            <IconScanner size={16} />
                                        </span>
                                        <h2 id="assignedHead">
                                            Assigned scanners{" "}
                                            <span className="scanner-count">
                                                ({assignedScanners.length})
                                            </span>
                                        </h2>
                                    </div>

                                    {assignedScanners.length === 0 ? (
                                        <p className="events-field-help">
                                            No scanners assigned yet. Add one from the list below.
                                        </p>
                                    ) : (
                                        <ul className="events-scanner-list">
                                            {assignedScanners.map((scanner) => (
                                                <li key={scanner.id} className="events-scanner-row">
                                                    <span className="events-checkbox events-checkbox-on">
                                                        <IconCheck size={14} />
                                                    </span>
                                                    <span className="events-scanner-name">
                                                        {scanner.name}
                                                    </span>
                                                    <span className="events-cell-muted">
                                                        {scanner.email}
                                                    </span>
                                                    <span className={statusClass(scanner.status)}>
                                                        {scanner.status}
                                                    </span>
                                                    <ActionIcon
                                                        icon={IconX}
                                                        label={`Remove ${scanner.name}`}
                                                        tone="danger"
                                                        onClick={() => removeScanner(scanner.id)}
                                                    />
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </section>

                                <section className="scanner-panel" aria-labelledby="addHead">
                                    <div className="scanner-panel-head">
                                        <h2 id="addHead">Add scanners</h2>
                                    </div>

                                    {availableScanners.length === 0 ? (
                                        <p className="events-field-help">
                                            {scanners.length === 0
                                                ? "No Scanner accounts exist yet. Create one in User Accounts first."
                                                : "All scanners are already assigned to this event."}
                                        </p>
                                    ) : (
                                        <ul className="events-scanner-list">
                                            {availableScanners.map((scanner) => {
                                                const disabled =
                                                    scanner.status && scanner.status !== "Active";
                                                return (
                                                    <li key={scanner.id} className="events-scanner-row">
                                                        <label
                                                            className={`events-checkbox${
                                                                disabled ? " events-checkbox-disabled" : ""
                                                            }`}
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={activeIds.has(Number(scanner.id))}
                                                                disabled={disabled}
                                                                onChange={() => toggleScanner(scanner.id)}
                                                            />
                                                        </label>
                                                        <span className="events-scanner-name">
                                                            {scanner.name}
                                                        </span>
                                                        <span className="events-cell-muted">
                                                            {scanner.email}
                                                        </span>
                                                        <span className={statusClass(scanner.status)}>
                                                            {scanner.status}
                                                        </span>
                                                        {disabled && (
                                                            <span className="events-cell-muted">
                                                                not active
                                                            </span>
                                                        )}
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    )}
                                </section>

                                <div className="events-toolbar">
                                    <button
                                        type="button"
                                        className="events-btn events-btn-primary"
                                        onClick={saveAssignment}
                                        disabled={saving || !dirty}
                                    >
                                        {saving ? "Saving…" : dirty ? "Save assignment" : "Saved"}
                                    </button>
                                    <button
                                        type="button"
                                        className="events-btn"
                                        onClick={() => loadScanners(selectedRef)}
                                        disabled={detailLoading}
                                    >
                                        Reset
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>

            {toast && <Toast {...toast} onDismiss={dismissToast} />}
        </AppShell>
    );
}

