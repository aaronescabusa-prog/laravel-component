import { useEffect, useMemo, useState } from "react";
import "./Announcements.css";
import { logActivity, nextId } from "./lib/storage";
import { api, mapAnnouncementFromApi, mapAnnouncementToApi, ANNOUNCEMENT_AUDIENCES, ANNOUNCEMENT_CATEGORIES, ANNOUNCEMENT_STATUSES, getSessionUser } from "./lib/api";
import { useToast } from "./lib/useToast";
import AppShell from "./components/AppShell";
import Toast from "./components/Toast";
import ConfirmDialog from "./components/ConfirmDialog";
import { ActionIcon, IconEdit, IconTrash, IconMegaphone } from "./components/Icons";



const AUDIENCES = ANNOUNCEMENT_AUDIENCES;
const CATEGORIES = ANNOUNCEMENT_CATEGORIES;

function initialsOf(text) {
    return text.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}

function Announcements() {
    const [announcements, setAnnouncements] = useState([]);
    const sessionRole = getSessionUser()?.role ?? "Admin";
    // Only administrators may create, edit or
    // delete notices; every other reader gets the published list without
    // mutation affordances. The API enforces the same split.
    const canManage = sessionRole === "Admin";
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [pendingDelete, setPendingDelete] = useState(null);
    const { toast, showToast, dismissToast } = useToast();
    const [search, setSearch] = useState("");
    const [audienceFilter, setAudienceFilter] = useState("all");
    const [statusFilter, setStatusFilter] = useState("all");
    const [editingItem, setEditingItem] = useState(null);
    const [isNewItem, setIsNewItem] = useState(false);
    const [viewingItem, setViewingItem] = useState(null);

    useEffect(() => {
        let active = true;
        api.list("announcements")
            .then((rows) => { if (active) setAnnouncements(rows.map(mapAnnouncementFromApi)); })
            .catch((err) => { if (active) setLoadError(err.message); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, []);

    const filteredRows = useMemo(() => {
        return announcements.filter((row) => {
            const term = search.trim().toLowerCase();
            const matchesSearch = !term || row.title.toLowerCase().includes(term) || row.author.toLowerCase().includes(term);
            const matchesAudience = audienceFilter === "all" || row.audience === audienceFilter;
            const matchesStatus = statusFilter === "all" || row.status.toLowerCase() === statusFilter;
            return matchesSearch && matchesAudience && matchesStatus;
        }).sort((a, b) => (a.publishDate < b.publishDate ? 1 : -1));
    }, [announcements, search, audienceFilter, statusFilter]);

    function setStatus(row, status) {
        const next = {
            ...row,
            status,
            publishDate: status === "Published" && !row.publishDate ? new Date().toISOString().slice(0, 10) : row.publishDate,
        };
        setAnnouncements((prev) => prev.map((a) => (a.id === row.id ? next : a)));
        api.update("announcements", row.id, mapAnnouncementToApi(next))
            .then((updated) => setAnnouncements((prev) => prev.map((a) => (a.id === row.id ? mapAnnouncementFromApi(updated) : a))))
            .catch((err) => showToast(err.message, "danger"));
    }

    function deleteItem(row) {
        setPendingDelete(row);
    }

    function confirmDelete() {
        if (!pendingDelete) return;
        api.remove("announcements", pendingDelete.id)
            .then(() => {
                setAnnouncements((prev) => prev.filter((a) => a.id !== pendingDelete.id));
                logActivity({ category: "Announcement", action: `Deleted announcement ${pendingDelete.id}`, details: pendingDelete.title });
                showToast("Announcement deleted.");
            })
            .catch((err) => showToast(err.message, "danger"))
            .finally(() => setPendingDelete(null));
    }

    function openEdit(row) {
        setEditingItem({ ...row });
        setIsNewItem(false);
    }

    function openCreate() {
        setEditingItem({
            id: nextId(announcements, "ANN", 501),
            title: "",
            message: "",
            audience: "All Users",
            category: "General",
            status: "Draft",
            publishDate: "",
            author: "Admin User",
        });
        setIsNewItem(true);
    }

    function saveItem() {
        if (!editingItem.title.trim() || !editingItem.message.trim()) {
            showToast("Title and message are required.", "danger");
            return;
        }
        if (editingItem.status === "Scheduled" && !editingItem.publishDate) {
            showToast("Choose a scheduled date.", "danger");
            return;
        }

        const item = { ...editingItem };
        const payload = mapAnnouncementToApi(item);

        if (isNewItem) {
            api.create("announcements", payload)
                .then((created) => {
                    setAnnouncements((prev) => [mapAnnouncementFromApi(created), ...prev]);
                    logActivity({ category: "Announcement", action: `Created announcement ${created.reference}`, details: item.title });
                    showToast("Announcement saved.");
                    setEditingItem(null);
                })
                .catch((err) => showToast(err.message, "danger"));
        } else {
            api.update("announcements", item.id, payload)
                .then((updated) => {
                    setAnnouncements((prev) => prev.map((a) => (a.id === item.id ? mapAnnouncementFromApi(updated) : a)));
                    logActivity({ category: "Announcement", action: `Updated announcement ${item.id}`, details: item.title });
                    showToast("Announcement saved.");
                    setEditingItem(null);
                })
                .catch((err) => showToast(err.message, "danger"));
        }
    }

    const total = announcements.length;
    const published = announcements.filter((a) => a.status === "Published").length;
    const scheduled = announcements.filter((a) => a.status === "Scheduled").length;
    const drafts = announcements.filter((a) => a.status === "Draft").length;

    return (
        <AppShell title="Announcements" prefix="ann-">

            {loadError && (
                <div className="ann-empty" role="alert">Could not load announcements: {loadError}</div>
            )}

            <div className="ann-kpi-strip">
                <div className="ann-kpi-item">
                    <span className="ann-kpi-label">Total Announcements</span>
                    <span className="ann-kpi-value">{total}</span>
                </div>
                <div className="ann-kpi-item">
                    <span className="ann-kpi-label">Published</span>
                    <span className="ann-kpi-value">{published}</span>
                </div>
                <div className="ann-kpi-item">
                    <span className="ann-kpi-label">Scheduled</span>
                    <span className="ann-kpi-value">{scheduled}</span>
                </div>
                <div className="ann-kpi-item ann-kpi-alert">
                    <span className="ann-kpi-label">Drafts</span>
                    <span className="ann-kpi-value">{drafts}</span>
                </div>
            </div>

            <section className="ann-panel">
                <div className="ann-panel-header">
                    <h2>All Announcements</h2>
                    <button className="ann-btn ann-btn-primary" onClick={openCreate}>+ New Announcement</button>
                </div>

                <div className="ann-toolbar">
                    <input
                        type="text"
                        className="ann-input-search"
                        placeholder="Search by title or author"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        aria-label="Search announcements"
                    />

                    <select
                        className="ann-input-select"
                        value={audienceFilter}
                        onChange={(e) => setAudienceFilter(e.target.value)}
                        aria-label="Filter by audience"
                    >
                        <option value="all">All Users</option>
                        {AUDIENCES.filter((a) => a !== "All Users").map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>

                    <select
                        className="ann-input-select"
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        aria-label="Filter by status"
                    >
                        <option value="all">All statuses</option>
                        {ANNOUNCEMENT_STATUSES.map((s) => <option key={s} value={s.toLowerCase()}>{s}</option>)}
                    </select>
                </div>

                <div className="ann-list">
                    {filteredRows.map((row) => (
                        <article key={row.id} className="ann-card">
                            <div className="ann-card-icon">{initialsOf(row.category)}</div>

                            <div className="ann-card-body">
                                <div className="ann-card-top">
                                    <h3 className="ann-card-title" onClick={() => setViewingItem(row)}>{row.title}</h3>
                                    <span className={`ann-status ann-status-${row.status.toLowerCase()}`}>{row.status}</span>
                                </div>

                                <p className="ann-card-message">{row.message}</p>

                                <div className="ann-card-meta">
                                    <span className={`ann-audience-badge ann-audience-${row.audience.replace(" ", "").toLowerCase()}`}>{row.audience}</span>
                                    <span className="ann-card-category">{row.category}</span>
                                    <span className="ann-card-dot">•</span>
                                    <span className="ann-card-author">{row.author}</span>
                                    {row.publishDate && (
                                        <>
                                            <span className="ann-card-dot">•</span>
                                            <span>{row.status === "Scheduled" ? "Scheduled for" : "Published"} {row.publishDate}</span>
                                        </>
                                    )}
                                </div>
                            </div>

                            <div className="ann-card-actions">
                                <ActionIcon icon={IconEdit} label="Edit" onClick={() => openEdit(row)} />
                                {row.status !== "Published" && (
                                    <ActionIcon icon={IconMegaphone} label="Publish" tone="approve" onClick={() => setStatus(row, "Published")} />
                                )}
                                <ActionIcon icon={IconTrash} label="Delete" tone="danger" onClick={() => deleteItem(row)} />
                            </div>
                        </article>
                    ))}

                    {loading && (
                        <div className="ann-empty">Loading announcements…</div>
                    )}

                    {!loading && filteredRows.length === 0 && (
                        <div className="ann-empty">No announcements match your filters.</div>
                    )}
                </div>
            </section>


            {viewingItem && (
                <div className="ann-modal-overlay" onClick={() => setViewingItem(null)}>
                    <div className="ann-modal-card" onClick={(e) => e.stopPropagation()}>
                        <div className="ann-modal-header">
                            <h3>{viewingItem.title}</h3>
                            <button className="ann-modal-close" onClick={() => setViewingItem(null)} aria-label="Close">×</button>
                        </div>
                        <div className="ann-modal-body">
                            <div className="ann-view-meta">
                                <span className={`ann-status ann-status-${viewingItem.status.toLowerCase()}`}>{viewingItem.status}</span>
                                <span className={`ann-audience-badge ann-audience-${viewingItem.audience.replace(" ", "").toLowerCase()}`}>{viewingItem.audience}</span>
                                <span className="ann-card-category">{viewingItem.category}</span>
                            </div>
                            <p className="ann-view-message">{viewingItem.message}</p>
                            <p className="ann-view-footer">Posted by {viewingItem.author}{viewingItem.publishDate ? ` on ${viewingItem.publishDate}` : ""}</p>
                        </div>
                        <div className="ann-modal-footer">
                            <button className="ann-btn ann-btn-secondary" onClick={() => setViewingItem(null)}>Close</button>
                            <button className="ann-btn ann-btn-primary" onClick={() => { setViewingItem(null); openEdit(viewingItem); }}>Edit</button>
                        </div>
                    </div>
                </div>
            )}

            {editingItem && (
                <div className="ann-modal-overlay" onClick={() => setEditingItem(null)}>
                    <div className="ann-modal-card" onClick={(e) => e.stopPropagation()}>
                        <div className="ann-modal-header">
                            <h3>{isNewItem ? "New Announcement" : "Edit Announcement"}</h3>
                            <button className="ann-modal-close" onClick={() => setEditingItem(null)} aria-label="Close">×</button>
                        </div>
                        <div className="ann-modal-body">
                            <div className="ann-form-group">
                                <label htmlFor="annTitle">Title</label>
                                <input
                                    id="annTitle"
                                    type="text"
                                    value={editingItem.title}
                                    onChange={(e) => setEditingItem({ ...editingItem, title: e.target.value })}
                                />
                            </div>

                            <div className="ann-form-group">
                                <label htmlFor="annMessage">Message</label>
                                <textarea
                                    id="annMessage"
                                    rows="4"
                                    value={editingItem.message}
                                    onChange={(e) => setEditingItem({ ...editingItem, message: e.target.value })}
                                />
                            </div>

                            <div className="ann-form-row-split">
                                <div className="ann-form-group">
                                    <label htmlFor="annAudience">Audience</label>
                                    <select
                                        id="annAudience"
                                        value={editingItem.audience}
                                        onChange={(e) => setEditingItem({ ...editingItem, audience: e.target.value })}
                                    >
                                        {AUDIENCES.map((a) => <option key={a}>{a}</option>)}
                                    </select>
                                </div>
                                <div className="ann-form-group">
                                    <label htmlFor="annCategory">Category</label>
                                    <select
                                        id="annCategory"
                                        value={editingItem.category}
                                        onChange={(e) => setEditingItem({ ...editingItem, category: e.target.value })}
                                    >
                                        {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div className="ann-form-row-split">
                                <div className="ann-form-group">
                                    <label htmlFor="annStatus">Status</label>
                                    <select
                                        id="annStatus"
                                        value={editingItem.status}
                                        onChange={(e) => setEditingItem({ ...editingItem, status: e.target.value })}
                                    >
                                        {ANNOUNCEMENT_STATUSES.map((s) => <option key={s}>{s}</option>)}
                                    </select>
                                </div>
                                <div className="ann-form-group">
                                    <label htmlFor="annDate">
                                        {editingItem.status === "Scheduled" ? "Scheduled date" : "Publish date"}
                                    </label>
                                    <input
                                        id="annDate"
                                        type="date"
                                        value={editingItem.publishDate}
                                        onChange={(e) => setEditingItem({ ...editingItem, publishDate: e.target.value })}
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="ann-modal-footer">
                            <button className="ann-btn ann-btn-secondary" onClick={() => setEditingItem(null)}>Cancel</button>
                            <button className="ann-btn ann-btn-primary" onClick={saveItem}>
                                {isNewItem ? "Create" : "Save Changes"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <ConfirmDialog open={Boolean(pendingDelete)} title="Delete announcement?" message={`Delete "${pendingDelete?.title}"? This cannot be undone.`} onConfirm={confirmDelete} onCancel={() => setPendingDelete(null)} />
            {toast && <Toast {...toast} onDismiss={dismissToast} />}
        </AppShell>
    );
}

export default Announcements;
