import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "./components/AppShell";
import Toast from "./components/Toast";
import { ActionIcon, IconCheck, IconScanner, IconX } from "./components/Icons";
import { api, eventScannersApi, mapEventFromApi } from "./lib/api";
import { useToast } from "./lib/useToast";
import "./ScannerPermissions.css";

const STATUS_CLASS = {
    Active: "events-status-approved",
    Pending: "events-status-pending",
    Suspended: "events-status-cancelled",
    Inactive: "events-status-cancelled",
};

const statusClass = (status) => STATUS_CLASS[status] || "events-status-pending";
const initials = (name = "") => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "S";

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
    const [query, setQuery] = useState("");

    const loadEvents = useCallback(async () => {
        setEventsLoading(true);
        setLoadError("");
        try {
            const rows = await api.list("events", { per_page: "all" });
            setEvents(rows.map(mapEventFromApi));
        } catch (err) {
            setLoadError(err.message || "Could not load events.");
        } finally {
            setEventsLoading(false);
        }
    }, []);

    useEffect(() => { loadEvents(); }, [loadEvents]);

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

    useEffect(() => { setQuery(""); loadScanners(selectedRef); }, [selectedRef, loadScanners]);

    const selectedEvent = useMemo(() => events.find((event) => event.id === selectedRef) || null, [events, selectedRef]);
    const dirty = useMemo(() => activeIds.size !== savedIds.size || [...activeIds].some((id) => !savedIds.has(id)), [activeIds, savedIds]);
    const matchingScanners = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return scanners.filter((scanner) => !needle || `${scanner.name} ${scanner.email}`.toLowerCase().includes(needle));
    }, [scanners, query]);
    const assignedScanners = matchingScanners.filter((scanner) => activeIds.has(Number(scanner.id)));
    const availableScanners = matchingScanners.filter((scanner) => !activeIds.has(Number(scanner.id)));

    const toggleScanner = (id) => setActiveIds((prev) => {
        const next = new Set(prev);
        const key = Number(id);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
    });

    const saveAssignment = async () => {
        if (!selectedEvent) return;
        setSaving(true);
        try {
            const payload = await eventScannersApi.update(selectedEvent.id, Array.from(activeIds));
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

    const renderScanner = (scanner, assigned) => {
        const disabled = scanner.status && scanner.status !== "Active";
        return (
            <li key={scanner.id} className={`scanner-row${disabled ? " is-disabled" : ""}`}>
                {assigned ? (
                    <span className="scanner-selection-mark" aria-hidden="true"><IconCheck size={14} /></span>
                ) : (
                    <label className="scanner-checkbox" aria-label={`Assign ${scanner.name}`}>
                        <input type="checkbox" checked={activeIds.has(Number(scanner.id))} disabled={disabled} onChange={() => toggleScanner(scanner.id)} />
                    </label>
                )}
                <span className="scanner-avatar" aria-hidden="true">{initials(scanner.name)}</span>
                <span className="scanner-identity"><strong>{scanner.name}</strong><span>{scanner.email}</span></span>
                <span className={statusClass(scanner.status)}>{scanner.status || "Unknown"}</span>
                {assigned ? <ActionIcon icon={IconX} label={`Remove ${scanner.name}`} tone="danger" onClick={() => toggleScanner(scanner.id)} /> : disabled ? <span className="scanner-inactive-note">Unavailable</span> : null}
            </li>
        );
    };

    return (
        <AppShell title="Scanner Permissions" subtitle="Control which scanner accounts can check attendees in to each event.">
            <div className="scanner-page">
                <section className="scanner-event-card" aria-labelledby="scanner-event-title">
                    <div className="scanner-section-heading">
                        <span className="scanner-heading-icon"><IconScanner size={18} /></span>
                        <div><p className="scanner-eyebrow">ACCESS MANAGEMENT</p><h2 id="scanner-event-title">Choose an event</h2></div>
                    </div>
                    <div className="scanner-event-control">
                        <div className="scanner-select-wrap">
                            <label htmlFor="scannerEvent">Event</label>
                            <select id="scannerEvent" value={selectedRef} onChange={(e) => setSelectedRef(e.target.value)} disabled={eventsLoading || !!loadError}>
                                <option value="">{eventsLoading ? "Loading events..." : "Select an event to manage access"}</option>
                                {events.map((event) => <option key={event._id} value={event.id}>{event.name} — {event.date}{event.status ? ` (${event.status})` : ""}</option>)}
                            </select>
                        </div>
                        <p className="scanner-event-hint">{eventsLoading ? "Getting your event list ready." : `${events.length} ${events.length === 1 ? "event" : "events"} available`}</p>
                    </div>
                    {loadError && <div className="scanner-inline-error" role="alert"><span>{loadError}</span><button type="button" onClick={loadEvents}>Try again</button></div>}
                </section>

                {!selectedRef && !eventsLoading && !loadError && <div className="scanner-empty-state"><span className="scanner-empty-icon"><IconScanner size={22} /></span><strong>{events.length ? "Select an event to continue" : "No events to manage"}</strong><span>{events.length ? "The assigned scanner list will appear here." : "Create an event first, then return to assign scanner access."}</span></div>}

                {selectedRef && <>
                    {selectedEvent && <section className="scanner-event-summary" aria-label="Selected event">
                        <div><p className="scanner-eyebrow">SELECTED EVENT</p><h2>{selectedEvent.name}</h2><p>{[selectedEvent.category, selectedEvent.date, selectedEvent.venue].filter(Boolean).join(" · ")}</p></div>
                        <div className="scanner-summary-count"><strong>{activeIds.size}</strong><span>assigned</span></div>
                    </section>}

                    {detailError && <div className="scanner-inline-error" role="alert"><span>{detailError}</span><button type="button" onClick={() => loadScanners(selectedRef)}>Try again</button></div>}
                    {detailLoading && <div className="scanner-empty-state scanner-loading" role="status"><span className="scanner-loader" /><strong>Loading scanner accounts</strong><span>Fetching the access list for this event.</span></div>}
                    {!detailLoading && !detailError && <>
                        <div className="scanner-roster-tools"><div><h2>Scanner access</h2><p>Assign active scanner accounts to this event.</p></div><label className="scanner-search"><span className="scanner-search-symbol" aria-hidden="true">⌕</span><input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or email" aria-label="Search scanner accounts" /></label></div>
                        <div className="scanner-panels">
                            <section className="scanner-panel" aria-labelledby="assignedHead">
                                <div className="scanner-panel-head"><div><h3 id="assignedHead">Assigned scanners</h3><p>Can check attendees in to this event.</p></div><span className="scanner-count">{activeIds.size}</span></div>
                                {assignedScanners.length ? <ul className="scanner-list">{assignedScanners.map((scanner) => renderScanner(scanner, true))}</ul> : <div className="scanner-panel-empty"><span>No scanners assigned yet</span><small>Select an active account from the available list.</small></div>}
                            </section>
                            <section className="scanner-panel" aria-labelledby="availableHead">
                                <div className="scanner-panel-head"><div><h3 id="availableHead">Available scanners</h3><p>Choose who can scan this event.</p></div><span className="scanner-count">{scanners.filter((scanner) => !activeIds.has(Number(scanner.id))).length}</span></div>
                                {availableScanners.length ? <ul className="scanner-list">{availableScanners.map((scanner) => renderScanner(scanner, false))}</ul> : <div className="scanner-panel-empty"><span>{scanners.length === 0 ? "No scanner accounts found" : query ? "No matches found" : "All scanners are assigned"}</span><small>{scanners.length === 0 ? "Create a Scanner account in User Accounts to get started." : query ? "Try a different name or email." : "Every scanner account already has access to this event."}</small></div>}
                            </section>
                        </div>
                        <div className="scanner-savebar"><div className={`scanner-save-status${dirty ? " is-dirty" : ""}`}><span className="scanner-save-dot" />{dirty ? "You have unsaved changes" : "All changes saved"}</div><div className="scanner-save-actions"><button type="button" className="events-btn" onClick={() => { setActiveIds(new Set(savedIds)); }} disabled={!dirty || saving}>Discard changes</button><button type="button" className="events-btn events-btn-primary" onClick={saveAssignment} disabled={saving || !dirty}>{saving ? "Saving..." : "Save permissions"}</button></div></div>
                    </>}
                </>}
            </div>
            {toast && <Toast {...toast} onDismiss={dismissToast} />}
        </AppShell>
    );
}
