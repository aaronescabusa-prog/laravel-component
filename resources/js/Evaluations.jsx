import { useEffect, useMemo, useState } from "react";
import "./Evaluations.css";
import { useCollection, logActivity, nextId, dateKey } from "./lib/storage";
import { usePagination } from "./lib/usePagination";
import AppShell from "./components/AppShell";
import Pagination from "./components/Pagination";
import { useToast } from "./lib/useToast";
import Toast from "./components/Toast";
import ConfirmDialog from "./components/ConfirmDialog";
import { api, mapEventFromApi, getSessionUser } from "./lib/api";



function initialsOf(text) {
    return text.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}

function Stars({ value }) {
    return (
        <span className="eval-stars" aria-label={`${value} out of 5`}>
            {"★".repeat(Math.round(value))}{"☆".repeat(5 - Math.round(value))}
        </span>
    );
}

function Evaluations() {
    const { toast, showToast, dismissToast } = useToast();
    const sessionRole = getSessionUser()?.role ?? "Admin";
    // Students may submit evaluations but cannot moderate them: the API allows
    // writes from every role, so the read-only slice here is the summary plus
    // the student's own submissions; edit/delete stay staff-only.
    const isStudent = sessionRole === "Student";
    const sessionEmail = String(getSessionUser()?.email ?? "").trim().toLowerCase();
    const [responses, setResponses] = useCollection("evaluations", (msg) => showToast(msg, "danger"));
    const [editingResponse, setEditingResponse] = useState(null);
    const [isNewResponse, setIsNewResponse] = useState(false);
    const [pendingDelete, setPendingDelete] = useState(null);

    // Event choices follow the Events collection from the backend, so a newly
    // created event is immediately selectable here.
    const [eventOptions, setEventOptions] = useState([]);
    useEffect(() => {
        let active = true;
        api.list("events")
            .then((rows) => { if (active) setEventOptions(rows.map((e) => mapEventFromApi(e).name)); })
            .catch(() => {});
        return () => { active = false; };
    }, []);

    function saveResponse(e) {
        e.preventDefault();
        if (!editingResponse.participant.trim() || !editingResponse.event.trim()) {
            showToast("Participant and event are required.", "danger");
            return;
        }
        const saved = { ...editingResponse, id: isNewResponse ? nextId(responses, "EVL", 701) : editingResponse.id, participant: editingResponse.participant.trim(), event: editingResponse.event.trim(), rating: Number(editingResponse.rating) };
        if (!Number.isInteger(saved.rating) || saved.rating < 1 || saved.rating > 5) {
            showToast("Rating must be between 1 and 5.", "danger");
            return;
        }
        setResponses((prev) => isNewResponse ? [saved, ...prev] : prev.map((r) => r.id === saved.id ? saved : r));
        logActivity({ category: "Evaluation", action: `${isNewResponse ? "Created" : "Updated"} evaluation ${saved.id}`, details: saved.event });
        setEditingResponse(null);
        showToast("Evaluation saved.");
    }

    function deleteResponse() {
        if (!pendingDelete) return;
        setResponses((prev) => prev.filter((r) => r.id !== pendingDelete.id));
        logActivity({ category: "Evaluation", action: `Deleted evaluation ${pendingDelete.id}`, details: pendingDelete.event });
        setPendingDelete(null);
        showToast("Evaluation deleted.");
    }
    const [eventFilter, setEventFilter] = useState("all");
    const [search, setSearch] = useState("");

    const eventNames = eventOptions;

    const filteredResponses = useMemo(() => {
        return responses.filter((r) => {
            const term = search.trim().toLowerCase();
            const matchesSearch = !term || r.participant.toLowerCase().includes(term) || r.comment.toLowerCase().includes(term);
            const matchesEvent = eventFilter === "all" || r.event === eventFilter;
            return matchesSearch && matchesEvent;
        });
    }, [responses, search, eventFilter]);

    const pager = usePagination(filteredResponses, {
        resetKey: [search, eventFilter].join("|"),
    });

    const summary = eventNames.map((event) => {
        const rows = responses.filter((r) => r.event === event);
        return { event, responses: rows.length, avgRating: rows.length ? rows.reduce((sum, r) => sum + r.rating, 0) / rows.length : 0 };
    });
    const totalResponses = responses.length;

    return (
        <AppShell title="Evaluations" prefix="eval-">

            <div className="eval-kpi-strip">
                <div className="eval-kpi-item">
                    <span className="eval-kpi-label">Total Responses</span>
                    <span className="eval-kpi-value">{totalResponses}</span>
                </div>
                <div className="eval-kpi-item eval-kpi-alert">
                    <span className="eval-kpi-label">Events Without Responses</span>
                    <span className="eval-kpi-value">{summary.filter((e) => e.responses === 0).length}</span>
                </div>
            </div>

            <section className="eval-panel">
                <div className="eval-panel-header">
                    <h2>Average Ratings by Event</h2>
                    <p className="eval-panel-subtitle">Overall rating out of 5 stars</p>
                </div>

                <div className="eval-table-wrapper">
                    <table>
                        <thead>
                            <tr>
                                <th>Event</th>
                                <th>Responses</th>
                                <th>Average Rating</th>
                            </tr>
                        </thead>
                        <tbody>
                            {summary.map((row) => (
                                <tr key={row.event}>
                                    <td>{row.event}</td>
                                    <td className="eval-cell-muted">{row.responses}</td>
                                    {row.responses > 0 ? (
                                        <td><Stars value={row.avgRating} /> <span className="eval-cell-muted">{row.avgRating.toFixed(1)}</span></td>
                                    ) : (
                                        <td className="eval-cell-muted">No responses yet</td>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            <section className="eval-panel">
                <div className="eval-panel-header">
                    <h2>Individual Responses</h2>
                    <button className="btn btn-primary" onClick={() => { setEditingResponse({ participant: "", event: eventOptions[0] ?? "", rating: 5, comment: "", date: dateKey() }); setIsNewResponse(true); }}>Add Evaluation</button>
                </div>

                <div className="eval-toolbar">
                    <input
                        type="text"
                        className="eval-input-search"
                        placeholder="Search by participant or comment"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                    <select
                        className="eval-input-select"
                        value={eventFilter}
                        onChange={(e) => setEventFilter(e.target.value)}
                    >
                        <option value="all">All events</option>
                        {eventNames.map((e) => <option key={e} value={e}>{e}</option>)}
                    </select>
                </div>

                <div className="eval-response-list">
                    {pager.pageRows.map((r) => (
                        <article key={r.id} className="eval-response-card">
                            <span className="eval-response-avatar">{initialsOf(r.participant)}</span>
                            <div className="eval-response-body">
                                <div className="eval-response-top">
                                    <span className="eval-response-name">{r.participant}</span>
                                    <span className="eval-response-date">{r.date}</span>
                                </div>
                                <span className="eval-response-event">{r.event}</span>
                                <div className="eval-response-ratings">
                                    <span>Rating <Stars value={r.rating} /></span>
                                </div>
                                {r.comment && <p className="eval-response-comment">"{r.comment}"</p>}
                                <button className="btn btn-secondary" onClick={() => { setEditingResponse({ ...r }); setIsNewResponse(false); }}>Edit</button>
                                <button className="btn btn-danger-outline" onClick={() => setPendingDelete(r)}>Delete</button>
                            </div>
                        </article>
                    ))}

                    {filteredResponses.length === 0 && (
                        <div className="eval-empty">No responses match your filters.</div>
                    )}
                </div>

                <Pagination
                    {...pager}
                    unit="responses"
                />
            </section>


            {editingResponse && (
                <div className="modal-overlay" onClick={() => setEditingResponse(null)}>
                    <form className="modal-card" role="dialog" aria-modal="true" aria-labelledby="evaluation-form-title" onClick={(e) => e.stopPropagation()} onSubmit={saveResponse}>
                        <div className="modal-header">
                            <h3 id="evaluation-form-title">{isNewResponse ? "New Evaluation" : "Edit Evaluation"}</h3>
                            <button type="button" className="modal-close" aria-label="Close" onClick={() => setEditingResponse(null)}>×</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label htmlFor="evaluationParticipant">Participant</label>
                                <input id="evaluationParticipant" required value={editingResponse.participant} onChange={(e) => setEditingResponse({ ...editingResponse, participant: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label htmlFor="evaluationEvent">Event</label>
                                <select id="evaluationEvent" required value={editingResponse.event} onChange={(e) => setEditingResponse({ ...editingResponse, event: e.target.value })}>
                                    {eventOptions.length === 0 && <option value="">No events available</option>}
                                    {eventOptions.map((event) => <option key={event} value={event}>{event}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label htmlFor="evaluationRating">Rating (1–5)</label>
                                <select id="evaluationRating" value={editingResponse.rating} onChange={(e) => setEditingResponse({ ...editingResponse, rating: Number(e.target.value) })}>
                                    {[1, 2, 3, 4, 5].map((rating) => <option key={rating} value={rating}>{rating}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label htmlFor="evaluationComment">Comment</label>
                                <textarea id="evaluationComment" rows="4" value={editingResponse.comment} onChange={(e) => setEditingResponse({ ...editingResponse, comment: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label htmlFor="evaluationDate">Date</label>
                                <input id="evaluationDate" type="date" required value={editingResponse.date} onChange={(e) => setEditingResponse({ ...editingResponse, date: e.target.value })} />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button type="button" className="btn btn-secondary" onClick={() => setEditingResponse(null)}>Cancel</button>
                            <button type="submit" className="btn btn-primary">Save Evaluation</button>
                        </div>
                    </form>
                </div>
            )}
            <ConfirmDialog open={Boolean(pendingDelete)} title="Delete evaluation?" message={`Delete feedback from ${pendingDelete?.participant}? This cannot be undone.`} onConfirm={deleteResponse} onCancel={() => setPendingDelete(null)} />
            {toast && <Toast {...toast} onDismiss={dismissToast} />}
        </AppShell>
    );
}

export default Evaluations;