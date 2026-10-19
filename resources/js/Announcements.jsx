import { useEffect, useMemo, useState } from "react";
import "./Announcements.css";
import { logActivity, nextId } from "./lib/storage";
import { api, mapAnnouncementFromApi, mapAnnouncementToApi, ANNOUNCEMENT_AUDIENCES, ANNOUNCEMENT_CATEGORIES, ANNOUNCEMENT_STATUSES, getSessionUser } from "./lib/api";
import { useToast } from "./lib/useToast";
import AppShell from "./components/AppShell";
import Toast from "./components/Toast";
import ConfirmDialog from "./components/ConfirmDialog";
import useDialogA11y from "./components/useDialogA11y";
import { ActionIcon, IconEdit, IconTrash, IconMegaphone, IconCalendar, IconCheckCircle, IconClipboard } from "./components/Icons";



const CATEGORIES = ANNOUNCEMENT_CATEGORIES;
const AUDIENCES = ANNOUNCEMENT_AUDIENCES;

function initialsOf(text) {
    return text.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}

function audienceSummary(item, departments) {
    const department = departments.find((entry) => entry.code === item.targetDepartment);
    return [
        item.targetDepartment ? (department?.name || item.targetDepartment) : "School-wide",
        item.targetRole && item.targetRole !== "All" ? `${item.targetRole} accounts` : "All roles",
        item.targetCourse || null,
        item.targetYear || null,
        item.targetBlock ? `Block ${item.targetBlock}` : null,
    ].filter(Boolean).join(" · ");
}

function Announcements() {
    const [announcements, setAnnouncements] = useState([]);
    const [courses, setCourses] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [years, setYears] = useState([]);
    const [eligibilityError, setEligibilityError] = useState("");
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
    const [updatingIds, setUpdatingIds] = useState(() => new Set());
    const [editingItem, setEditingItem] = useState(null);
    const [isNewItem, setIsNewItem] = useState(false);
    const [viewingItem, setViewingItem] = useState(null);
    const viewDialogRef = useDialogA11y(Boolean(viewingItem), () => setViewingItem(null));
    const editDialogRef = useDialogA11y(Boolean(editingItem), () => setEditingItem(null));

    useEffect(() => {
        let active = true;
        api.list("announcements")
            .then((rows) => { if (active) setAnnouncements(rows.map(mapAnnouncementFromApi)); })
            .catch((err) => { if (active) setLoadError(err.message); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, []);

    useEffect(() => {
        let active = true;
        api.academicStructure()
            .then((structure) => {
                if (!active) return;
                setCourses(structure.courses);
                setDepartments(structure.departments);
                setYears(structure.years);
            })
            .catch((err) => { if (active) setEligibilityError(err.message); });
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
        if (updatingIds.has(row.id)) return;
        setUpdatingIds((current) => new Set(current).add(row.id));
        const next = {
            ...row,
            status,
            publishDate: status === "Published" && !row.publishDate ? new Date().toISOString().slice(0, 10) : row.publishDate,
        };
        setAnnouncements((prev) => prev.map((a) => (a.id === row.id ? next : a)));
        api.update("announcements", row.id, mapAnnouncementToApi(next))
            .then((updated) => setAnnouncements((prev) => prev.map((a) => (a.id === row.id ? mapAnnouncementFromApi(updated) : a))))
            .catch((err) => {
                setAnnouncements((prev) => prev.map((a) => (a.id === row.id ? row : a)));
                showToast(err.message, "danger");
            })
            .finally(() => setUpdatingIds((current) => {
                const nextIds = new Set(current);
                nextIds.delete(row.id);
                return nextIds;
            }));
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
            audienceType: "School-Wide",
            targetRole: "All",
            targetDepartment: "",
            targetCourse: "",
            targetYear: "",
            targetBlock: "",
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
        if (editingItem.audienceType === "Department-Specific" && !editingItem.targetDepartment) {
            showToast("Choose a target department.", "danger");
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

            <section className="ann-intro" aria-labelledby="ann-intro-title">
                <div className="ann-intro-icon" aria-hidden="true"><IconMegaphone size={28} /></div>
                <div className="ann-intro-copy">
                    <span className="ann-intro-eyebrow">CAMPUS COMMUNICATION</span>
                    <h2 id="ann-intro-title">Keep everyone in the loop.</h2>
                    <p>Share timely updates with the students, staff, and organizers who need them.</p>
                </div>
                {canManage && <button type="button" className="ann-btn ann-btn-primary ann-intro-action" onClick={openCreate}>+ New Announcement</button>}
            </section>

            <div className="ann-kpi-strip">
                <div className="ann-kpi-item">
                    <span className="ann-kpi-icon" aria-hidden="true"><IconClipboard size={19} /></span>
                    <span className="ann-kpi-label">Total Announcements</span>
                    <span className="ann-kpi-value">{total}</span>
                </div>
                <div className="ann-kpi-item">
                    <span className="ann-kpi-icon ann-kpi-icon-success" aria-hidden="true"><IconCheckCircle size={19} /></span>
                    <span className="ann-kpi-label">Published</span>
                    <span className="ann-kpi-value">{published}</span>
                </div>
                <div className="ann-kpi-item">
                    <span className="ann-kpi-icon ann-kpi-icon-info" aria-hidden="true"><IconCalendar size={19} /></span>
                    <span className="ann-kpi-label">Scheduled</span>
                    <span className="ann-kpi-value">{scheduled}</span>
                </div>
                <div className="ann-kpi-item ann-kpi-alert">
                    <span className="ann-kpi-icon ann-kpi-icon-warning" aria-hidden="true"><IconEdit size={19} /></span>
                    <span className="ann-kpi-label">Drafts</span>
                    <span className="ann-kpi-value">{drafts}</span>
                </div>
            </div>

            <section className="ann-panel">
                <div className="ann-panel-header">
                    <h2>All Announcements</h2>
                    <span className="ann-results-count" aria-live="polite">{filteredRows.length} {filteredRows.length === 1 ? "announcement" : "announcements"}</span>
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
                                    <button type="button" className="ann-card-title" onClick={() => setViewingItem(row)}>{row.title}</button>
                                    <span className={`ann-status ann-status-${row.status.toLowerCase()}`}>{row.status}</span>
                                </div>

                                <p className="ann-card-message">{row.message}</p>

                                <div className="ann-card-meta">
                                    <span className={`ann-audience-badge ann-audience-${row.audience.replace(" ", "").toLowerCase()}`} title={audienceSummary(row, departments)}>{audienceSummary(row, departments)}</span>
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

                            {canManage && <div className="ann-card-actions">
                                <ActionIcon icon={IconEdit} label="Edit" onClick={() => openEdit(row)} />
                                {row.status !== "Published" && <ActionIcon icon={IconMegaphone} label={updatingIds.has(row.id) ? "Publishing…" : "Publish"} tone="approve" disabled={updatingIds.has(row.id)} onClick={() => setStatus(row, "Published")} />}
                                <ActionIcon icon={IconTrash} label="Delete" tone="danger" onClick={() => deleteItem(row)} />
                            </div>}
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
                <div className="ann-modal-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) setViewingItem(null); }}>
                    <div ref={viewDialogRef} tabIndex={-1} className="ann-modal-card ann-view-modal" role="dialog" aria-modal="true" aria-labelledby="ann-view-title" onClick={(e) => e.stopPropagation()}>
                        <div className="ann-modal-header">
                            <div><span className="ann-modal-eyebrow">ANNOUNCEMENT DETAILS</span><h3 id="ann-view-title">{viewingItem.title}</h3></div>
                            <button type="button" className="ann-modal-close" onClick={() => setViewingItem(null)} aria-label="Close">×</button>
                        </div>
                        <div className="ann-modal-body">
                            <div className="ann-view-meta">
                                <span className={`ann-status ann-status-${viewingItem.status.toLowerCase()}`}>{viewingItem.status}</span>
                                <span className={`ann-audience-badge ann-audience-${viewingItem.audience.replace(" ", "").toLowerCase()}`}>{audienceSummary(viewingItem, departments)}</span>
                                <span className="ann-card-category">{viewingItem.category}</span>
                            </div>
                            <p className="ann-view-message">{viewingItem.message}</p>
                            <p className="ann-view-footer">Posted by {viewingItem.author}{viewingItem.publishDate ? ` on ${viewingItem.publishDate}` : ""}</p>
                        </div>
                        <div className="ann-modal-footer">
                            <button className="ann-btn ann-btn-secondary" onClick={() => setViewingItem(null)}>Close</button>
                            {canManage && <button type="button" className="ann-btn ann-btn-primary" onClick={() => { setViewingItem(null); openEdit(viewingItem); }}>Edit announcement</button>}
                        </div>
                    </div>
                </div>
            )}

            {editingItem && (
                <div className="ann-modal-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) setEditingItem(null); }}>
                    <div ref={editDialogRef} tabIndex={-1} className="ann-modal-card ann-editor-modal" role="dialog" aria-modal="true" aria-labelledby="ann-editor-title" onClick={(e) => e.stopPropagation()}>
                        <div className="ann-modal-header">
                            <div><span className="ann-modal-eyebrow">CAMPUS COMMUNICATION</span><h3 id="ann-editor-title">{isNewItem ? "Create announcement" : "Edit announcement"}</h3></div>
                            <button type="button" className="ann-modal-close" onClick={() => setEditingItem(null)} aria-label="Close">×</button>
                        </div>
                        <form id="announcementEditor" className="ann-editor-form" onSubmit={(e) => { e.preventDefault(); saveItem(); }}>
                        <div className="ann-modal-body">
                            <p className="ann-form-intro">Write a clear update and choose who should receive it. Required information is checked before saving.</p>
                            <div className="ann-form-section-heading"><span>01</span><div><strong>Announcement content</strong><small>Give your update a clear title and message.</small></div></div>
                            <div className="ann-form-group">
                                <label htmlFor="annTitle">Title <span>Required</span></label>
                                <input
                                    id="annTitle"
                                    type="text"
                                    maxLength={255}
                                    required
                                    value={editingItem.title}
                                    onChange={(e) => setEditingItem({ ...editingItem, title: e.target.value })}
                                />
                            </div>

                            <div className="ann-form-group">
                                <label htmlFor="annMessage">Message <span>Required</span></label>
                                <textarea
                                    id="annMessage"
                                    rows="4"
                                    required
                                    value={editingItem.message}
                                    onChange={(e) => setEditingItem({ ...editingItem, message: e.target.value })}
                                />
                            </div>

                            <div className="ann-form-section-heading ann-form-section-heading--delivery"><span>02</span><div><strong>Audience eligibility</strong><small>Choose who can see this announcement.</small></div></div>
                            {eligibilityError && <p className="ann-form-hint" role="alert">Could not load eligibility options: {eligibilityError}</p>}
                            <div className="ann-form-row-split">
                                <div className="ann-form-group">
                                    <label htmlFor="annAudienceType">Audience type</label>
                                    <select
                                        id="annAudienceType"
                                        value={editingItem.audienceType || "School-Wide"}
                                        onChange={(e) => setEditingItem((current) => ({
                                            ...current,
                                            audienceType: e.target.value,
                                            targetDepartment: e.target.value === "School-Wide" ? "" : current.targetDepartment,
                                            targetCourse: e.target.value === "School-Wide" ? "" : current.targetCourse,
                                            targetYear: e.target.value === "School-Wide" ? "" : current.targetYear,
                                            targetBlock: e.target.value === "School-Wide" ? "" : current.targetBlock,
                                        }))}
                                    >
                                        <option value="School-Wide">School-wide</option>
                                        <option value="Department-Specific">Department-specific</option>
                                    </select>
                                </div>
                                <div className="ann-form-group">
                                    <label htmlFor="annTargetRole">Eligible account roles</label>
                                    <select
                                        id="annTargetRole"
                                        value={editingItem.targetRole || "All"}
                                        onChange={(e) => setEditingItem({
                                            ...editingItem,
                                            targetRole: e.target.value,
                                            audience: e.target.value === "Student" ? "Students" : "All Users",
                                        })}
                                    >
                                        <option value="All">All roles</option>
                                        <option value="Student">Students</option>
                                        <option value="Admin">Administrators</option>
                                    </select>
                                </div>
                            </div>
                            {editingItem.audienceType === "Department-Specific" && <div className="ann-form-row-split">
                                <div className="ann-form-group">
                                    <label htmlFor="annTargetDepartment">Target department</label>
                                    <select id="annTargetDepartment" required value={editingItem.targetDepartment || ""} onChange={(e) => setEditingItem({ ...editingItem, targetDepartment: e.target.value, targetCourse: "" })}>
                                        <option value="" disabled>Choose a department</option>
                                        {departments.map((department) => <option key={department.code} value={department.code}>{department.code} — {department.name}</option>)}
                                    </select>
                                </div>
                                <div className="ann-form-group">
                                    <label htmlFor="annTargetCourse">Target program</label>
                                    <select id="annTargetCourse" value={editingItem.targetCourse || ""} onChange={(e) => setEditingItem({ ...editingItem, targetCourse: e.target.value })}>
                                        <option value="">All programs</option>
                                        {(departments.find((item) => item.code === editingItem.targetDepartment)?.courses ?? courses).map((course) => <option key={course} value={course}>{course}</option>)}
                                    </select>
                                </div>
                                <div className="ann-form-group">
                                    <label htmlFor="annTargetYear">Target year level</label>
                                    <select id="annTargetYear" value={editingItem.targetYear || ""} onChange={(e) => setEditingItem({ ...editingItem, targetYear: e.target.value })}>
                                        <option value="">All year levels</option>
                                        {years.map((year) => <option key={year} value={year}>{year}</option>)}
                                    </select>
                                </div>
                                <div className="ann-form-group">
                                    <label htmlFor="annTargetBlock">Target block</label>
                                    <input id="annTargetBlock" type="text" maxLength="50" placeholder="All blocks" value={editingItem.targetBlock || ""} onChange={(e) => setEditingItem({ ...editingItem, targetBlock: e.target.value })} />
                                </div>
                            </div>}
                            <div className="ann-form-section-heading ann-form-section-heading--delivery"><span>03</span><div><strong>Publishing</strong><small>Set the category and publication timing.</small></div></div>
                            <div className="ann-form-row-split">
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
                                        required={editingItem.status === "Scheduled"}
                                        value={editingItem.publishDate}
                                        onChange={(e) => setEditingItem({ ...editingItem, publishDate: e.target.value })}
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="ann-modal-footer">
                            <button type="button" className="ann-btn ann-btn-secondary" onClick={() => setEditingItem(null)}>Cancel</button>
                            <button type="submit" className="ann-btn ann-btn-primary">
                                {isNewItem ? "Create" : "Save Changes"}
                            </button>
                        </div>
                        </form>
                    </div>
                </div>
            )}

            <ConfirmDialog open={Boolean(pendingDelete)} title="Delete announcement?" message={`Delete "${pendingDelete?.title}"? This cannot be undone.`} onConfirm={confirmDelete} onCancel={() => setPendingDelete(null)} />
            {toast && <Toast {...toast} onDismiss={dismissToast} />}
        </AppShell>
    );
}

export default Announcements;
