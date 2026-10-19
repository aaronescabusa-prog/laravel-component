import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppShell from "./components/AppShell";
import Toast from "./components/Toast";
import { ActionIcon, IconCheck, IconScanner, IconX } from "./components/Icons";
import { api, eventScannersApi, mapEventFromApi } from "./lib/api";
import { useToast } from "./lib/useToast";
import "./ScannerPermissions.css";

const initials = (name = "") => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "S";
const formatEventDate = (value) => {
    if (!value) return "Date to be announced";
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
};

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
    const [bulkSaving, setBulkSaving] = useState(false);
    const [bulkScannerIds, setBulkScannerIds] = useState(() => new Set());
    const [query, setQuery] = useState("");
    const requestVersion = useRef(0);

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
        const version = ++requestVersion.current;
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
            if (version !== requestVersion.current) return;
            const assigned = new Set((payload.assigned ?? []).map(Number));
            setScanners(payload.scanners ?? []);
            setActiveIds(new Set(assigned));
            setSavedIds(new Set(assigned));
        } catch (err) {
            if (version !== requestVersion.current) return;
            setDetailError(err.message || "Could not load scanners for this event.");
        } finally {
            if (version === requestVersion.current) setDetailLoading(false);
        }
    }, []);

    useEffect(() => {
        setQuery("");
        loadScanners(selectedRef);
        return () => { requestVersion.current += 1; };
    }, [selectedRef, loadScanners]);

    const selectedEvent = useMemo(() => events.find((event) => event.id === selectedRef) || null, [events, selectedRef]);
    const dirty = useMemo(() => activeIds.size !== savedIds.size || [...activeIds].some((id) => !savedIds.has(id)), [activeIds, savedIds]);
    const matchingScanners = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return scanners.filter((scanner) => !needle || `${scanner.name} ${scanner.email}`.toLowerCase().includes(needle));
    }, [scanners, query]);
    const assignedScanners = matchingScanners.filter((scanner) => activeIds.has(Number(scanner.id)));
    const availableScanners = matchingScanners.filter((scanner) => !activeIds.has(Number(scanner.id)));
    const inactiveAssignedCount = scanners.filter((scanner) => activeIds.has(Number(scanner.id)) && scanner.status !== "Active").length;
    const activeScanners = scanners.filter((scanner) => scanner.status === "Active");

    const selectEvent = (nextRef) => {
        if (saving || bulkSaving) return;
        if (dirty && nextRef !== selectedRef) {
            showToast("Save or discard your scanner changes before switching events.", "danger");
            return;
        }
        setSelectedRef(nextRef);
    };

    const toggleScanner = (id) => setActiveIds((prev) => {
        if (bulkSaving) return prev;
        const next = new Set(prev);
        const key = Number(id);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
    });

    const saveAssignment = async () => {
        if (!selectedEvent || bulkSaving) return;
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

    const toggleBulkScanner = (id) => setBulkScannerIds((prev) => {
        const next = new Set(prev);
        const key = Number(id);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
    });

    const assignAcrossAllEvents = async () => {
        if (!bulkScannerIds.size || !events.length || dirty || saving || bulkSaving) return;
        setBulkSaving(true);
        try {
            const result = await eventScannersApi.assignToAllEvents(Array.from(bulkScannerIds));
            setBulkScannerIds(new Set());
            showToast(`Added scanner access to ${result.events_updated} events. Existing assignments were kept.`);
            await loadScanners(selectedRef);
        } catch (err) {
            showToast(err.message || "Could not assign scanners across all events.", "danger");
        } finally {
            setBulkSaving(false);
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
                <span className={`scanner-status-pill scanner-status-${(scanner.status || "unknown").toLowerCase()}`}>{scanner.status || "Unknown"}</span>
                {assigned ? <ActionIcon icon={IconX} label={`Remove ${scanner.name}`} tone="danger" onClick={() => toggleScanner(scanner.id)} /> : disabled ? <span className="scanner-inactive-note">Unavailable</span> : null}
            </li>
        );
    };

    return (
        <AppShell title="Scanner Access" subtitle="Assign scanner accounts across all events or manage one event at a time.">
            <div className="scanner-page">
                <header className="scanner-page-heading">
                    <div><p className="scanner-eyebrow">EVENT OPERATIONS / ACCESS</p><h2>Scanner assignments</h2><p>Choose who can check attendees in. All access is verified by the server.</p></div>
                    <div className="scanner-page-metrics" aria-label="Scanner access overview"><div><strong>{events.length}</strong><span>Current events</span></div><div><strong>{activeScanners.length}</strong><span>Active scanners</span></div></div>
                </header>

                <section className="scanner-scopebar" aria-label="Event selection">
                    <div className="scanner-select-wrap"><label htmlFor="scannerEvent">Select an event</label><select id="scannerEvent" value={selectedRef} onChange={(e) => selectEvent(e.target.value)} disabled={eventsLoading || !!loadError || saving || bulkSaving}><option value="">Choose an event to load scanner accounts</option>{events.map((event) => <option key={event._id} value={event.id}>{event.name} — {event.date}{event.status ? ` (${event.status})` : ""}</option>)}</select></div>
                    <p>{selectedRef ? "Use this event to review individual access. The bulk action below covers every current event." : "Select any event to load the scanner list. Bulk assignment still covers every current event."}</p>
                </section>
                {loadError && <div className="scanner-inline-error" role="alert"><span>{loadError}</span><button type="button" onClick={loadEvents}>Try again</button></div>}

                <section className="scanner-bulk-card" aria-labelledby="scanner-bulk-title">
                    <div className="scanner-bulk-heading"><div><p className="scanner-eyebrow">BULK ASSIGNMENT</p><h2 id="scanner-bulk-title">Add scanners to every event</h2><p>Selected accounts are added to all current, non-archived events. Existing assignments stay unchanged.</p></div><span className="scanner-bulk-total">{events.length}<small>events</small></span></div>
                    {eventsLoading ? <div className="scanner-bulk-loading" role="status"><span className="scanner-loader" />Loading events and scanner access…</div> : loadError ? <div className="scanner-inline-error" role="alert"><span>{loadError}</span><button type="button" onClick={loadEvents}>Try again</button></div> : !events.length ? <div className="scanner-panel-empty"><span>No current events found</span><small>Bulk assignment is available when an event has been created.</small></div> : !selectedRef ? <div className="scanner-panel-empty"><span>Select an event below to load scanner accounts</span><small>The event is used to load the scanner directory. Bulk assignment still covers all {events.length} current events.</small></div> : detailLoading ? <div className="scanner-bulk-loading" role="status"><span className="scanner-loader" />Loading active scanner accounts…</div> : detailError ? <div className="scanner-inline-error" role="alert"><span>{detailError}</span><button type="button" onClick={() => loadScanners(selectedRef)}>Try again</button></div> : activeScanners.length ? <>
                        <div className="scanner-bulk-workspace">
                            <div className="scanner-bulk-picker"><div className="scanner-bulk-picker-head"><strong>Select active scanner accounts</strong><span>{bulkScannerIds.size} selected</span></div><div className="scanner-bulk-list" role="group" aria-label="Choose scanner accounts for bulk assignment">
                                {activeScanners.map((scanner) => <label className="scanner-bulk-option" key={scanner.id}><input type="checkbox" checked={bulkScannerIds.has(Number(scanner.id))} disabled={bulkSaving || dirty || saving} onChange={() => toggleBulkScanner(scanner.id)} /><span className="scanner-avatar" aria-hidden="true">{initials(scanner.name)}</span><span><strong>{scanner.name}</strong><small>{scanner.email}</small></span></label>)}
                            </div></div>
                            <aside className="scanner-bulk-summary"><span className="scanner-bulk-summary-icon"><IconScanner size={18} /></span><p className="scanner-eyebrow">WILL BE ADDED TO</p><strong>{events.length} <span>events</span></strong><p>Archived events are excluded. Scanning remains unavailable until an event is approved.</p><button type="button" className="events-btn events-btn-primary" onClick={assignAcrossAllEvents} disabled={!bulkScannerIds.size || dirty || saving || bulkSaving}>{bulkSaving ? "Assigning…" : `Assign ${bulkScannerIds.size || "selected"} scanner${bulkScannerIds.size === 1 ? "" : "s"} to all events`}</button></aside>
                        </div>
                        {dirty && <p className="scanner-bulk-pending-note" role="status">Save or discard the event-specific changes below before bulk assigning.</p>}
                    </> : <div className="scanner-panel-empty"><span>No active scanner accounts available</span><small>Activate a Scanner account before assigning access.</small></div>}
                </section>

                {selectedRef && <>
                    {selectedEvent && <section className="scanner-event-summary" aria-label="Selected event">
                        <div><p className="scanner-eyebrow">EVENT-SPECIFIC ACCESS</p><h2 id="scanner-event-title">{selectedEvent.name}</h2><p>{[
                            selectedEvent.endDate && selectedEvent.endDate !== selectedEvent.date
                                ? `${formatEventDate(selectedEvent.date)} – ${formatEventDate(selectedEvent.endDate)}`
                                : formatEventDate(selectedEvent.date),
                            selectedEvent.startTime,
                            selectedEvent.endTime,
                            selectedEvent.venue,
                            selectedEvent.organizer && `Hosted by ${selectedEvent.organizer}`,
                            selectedEvent.hasCapacity ? `${selectedEvent.participants}/${selectedEvent.capacity} registered` : `${selectedEvent.participants} registered`,
                        ].filter(Boolean).join(" · ")}</p><span className={`scanner-event-access ${selectedEvent.status === "Approved" ? "is-approved" : "is-pending"}`}><span aria-hidden="true" />{selectedEvent.status === "Approved" ? "Approved · scanner access can be used" : `Not approved · scanner access is locked${selectedEvent.status ? ` (${selectedEvent.status})` : ""}`}</span></div>
                        <div className="scanner-summary-count"><strong>{activeIds.size}</strong><span>assigned</span></div>
                    </section>}

                    {detailError && <div className="scanner-inline-error" role="alert"><span>{detailError}</span><button type="button" onClick={() => loadScanners(selectedRef)}>Try again</button></div>}
                    {detailLoading && <div className="scanner-empty-state scanner-loading" role="status"><span className="scanner-loader" /><strong>Loading scanner accounts</strong><span>Fetching the access list for this event.</span></div>}
                    {!detailLoading && !detailError && <>
                        {inactiveAssignedCount > 0 && <div className="scanner-inactive-warning" role="status"><strong>{inactiveAssignedCount} inactive assignment{inactiveAssignedCount === 1 ? "" : "s"} need attention</strong><span>Remove inactive accounts before saving. The server accepts assignments only for active scanner accounts.</span></div>}
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
                        <div className="scanner-savebar"><div className={`scanner-save-status${dirty ? " is-dirty" : ""}`} role="status" aria-live="polite"><span className="scanner-save-dot" />{dirty ? "You have unsaved changes" : "All changes saved"}</div><div className="scanner-save-actions"><button type="button" className="events-btn" onClick={() => { setActiveIds(new Set(savedIds)); }} disabled={!dirty || saving || bulkSaving}>Discard changes</button><button type="button" className="events-btn events-btn-primary" onClick={saveAssignment} disabled={saving || bulkSaving || !dirty}>{saving ? "Saving..." : "Save permissions"}</button></div></div>
                    </>}
                </>}
            </div>
            {toast && <Toast {...toast} onDismiss={dismissToast} />}
        </AppShell>
    );
}
