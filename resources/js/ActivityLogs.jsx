import { useMemo, useState } from "react";
import "./ActivityLogs.css";
import { useCollection, ACTIVITY_LOG_KEY, dateKey } from "./lib/storage";
import { usePagination } from "./lib/usePagination";
import { downloadCSV, dateStamp } from "./lib/csv";
import AppShell from "./components/AppShell";
import Pagination from "./components/Pagination";
import { ActionIcon, IconInfo } from "./components/Icons";



const CATEGORIES = ["Login", "User Management", "Event", "Registration", "Payment", "Certificate", "Announcement", "Evaluation", "Settings"];

const INITIAL_LOGS = [
    { id: "LOG-10021", timestamp: "2026-09-06 09:14:02", user: "Admin User", role: "Admin", category: "Login", action: "Logged in successfully", details: "IP 192.168.1.14 · Chrome on Windows" },
    { id: "LOG-10020", timestamp: "2026-09-06 09:02:47", user: "Ana Cruz", role: "Staff", category: "Payment", action: "Verified payment for TMC-8840", details: "IT Congress: AI in Education — ₱150.00" },
    { id: "LOG-10019", timestamp: "2026-09-06 08:55:31", user: "Admin User", role: "Admin", category: "Certificate", action: "Generated certificate CERT-9004", details: "Research Colloquium 2026 — Maria Santos" },
    { id: "LOG-10018", timestamp: "2026-09-05 17:40:09", user: "Grace Villanueva", role: "Admin", category: "Event", action: "Approved event proposal", details: "IT Congress: AI in Education" },
    { id: "LOG-10017", timestamp: "2026-09-05 16:12:55", user: "Liza Fernandez", role: "Organizer", category: "Event", action: "Submitted event for approval", details: "Leadership Training Workshop" },
];

function initialsOf(text) {
    return text.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}

function ActivityLogs() {
    const [logs] = useCollection(ACTIVITY_LOG_KEY, INITIAL_LOGS);
    const [search, setSearch] = useState("");
    const [categoryFilter, setCategoryFilter] = useState("all");
    const [userFilter, setUserFilter] = useState("all");
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const [viewingLog, setViewingLog] = useState(null);

    /* Distinct actors, taken from the entries themselves so the picker can never
       offer somebody who has not actually done anything yet. A free-text search
       is not a substitute: it matches actions as well as names, so "who touched
       the audit log" stays ambiguous. */
    const userOptions = useMemo(() => {
        return Array.from(new Set(logs.map((row) => row.user).filter(Boolean)))
            .sort((a, b) => a.localeCompare(b));
    }, [logs]);

    const filteredRows = useMemo(() => {
        return logs.filter((row) => {
            const term = search.trim().toLowerCase();
            const matchesSearch = !term || row.user.toLowerCase().includes(term) || row.action.toLowerCase().includes(term);
            const matchesCategory = categoryFilter === "all" || row.category === categoryFilter;
            const matchesUser = userFilter === "all" || row.user === userFilter;
            const rowDate = row.timestamp.slice(0, 10);
            const matchesFrom = !dateFrom || rowDate >= dateFrom;
            const matchesTo = !dateTo || rowDate <= dateTo;
            return matchesSearch && matchesCategory && matchesUser && matchesFrom && matchesTo;
        });
    }, [logs, search, categoryFilter, userFilter, dateFrom, dateTo]);

    const pager = usePagination(filteredRows, {
        resetKey: [search, categoryFilter, userFilter, dateFrom, dateTo].join("|"),
    });

    const todayCount = logs.filter((l) => l.timestamp.startsWith(dateKey())).length;
    const failedLogins = logs.filter((l) => l.action.toLowerCase().includes("failed")).length;

    function exportCSV() {
        const rows = [
            ["Timestamp", "User", "Role", "Category", "Action", "Details"],
            ...filteredRows.map((r) => [r.timestamp, r.user, r.role, r.category, r.action, r.details]),
        ];
        downloadCSV(`activity-logs-${dateStamp()}.csv`, rows);
    }

    return (
        <AppShell title="Activity Logs" prefix="log-">

            <div className="log-kpi-strip">
                <div className="log-kpi-item">
                    <span className="log-kpi-label">Total Logged Events</span>
                    <span className="log-kpi-value">{logs.length}</span>
                </div>
                <div className="log-kpi-item">
                    <span className="log-kpi-label">Events Today</span>
                    <span className="log-kpi-value">{todayCount}</span>
                </div>
                <div className="log-kpi-item log-kpi-alert">
                    <span className="log-kpi-label">Failed Login Attempts</span>
                    <span className="log-kpi-value">{failedLogins}</span>
                </div>
            </div>

            <section className="log-panel">
                <div className="log-panel-header">
                    <h2>System Activity</h2>
                    <p className="log-panel-subtitle">Read-only audit trail — logs cannot be edited or deleted.</p>
                </div>

                <div className="log-toolbar">
                    <input
                        type="text"
                        className="log-input-search"
                        placeholder="Search by user or action"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />

                    <select
                        className="log-input-select"
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                        aria-label="Filter by category"
                    >
                        <option value="all">All categories</option>
                        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>

                    <select
                        className="log-input-select"
                        value={userFilter}
                        onChange={(e) => setUserFilter(e.target.value)}
                        aria-label="Filter by user"
                    >
                        <option value="all">All users</option>
                        {userOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>

                    <input type="date" className="log-input-date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                    <input type="date" className="log-input-date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />

                    <button className="log-btn log-btn-secondary log-btn-toolbar" onClick={exportCSV}>Export CSV</button>
                </div>

                <div className="log-table-wrapper">
                    <table>
                        <thead>
                            <tr>
                                <th>Timestamp</th>
                                <th>User</th>
                                <th>Category</th>
                                <th>Action</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {pager.pageRows.map((row) => (
                                <tr key={row.id}>
                                    <td className="log-cell-muted log-cell-timestamp">{row.timestamp}</td>
                                    <td>
                                        <div className="log-cell">
                                            <span className="log-row-avatar">{initialsOf(row.user)}</span>
                                            <div className="log-cell-text">
                                                <span className="log-cell-name">{row.user}</span>
                                                <span className="log-cell-role">{row.role}</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td><span className={`log-category log-category-${row.category.toLowerCase().replace(" ", "")}`}>{row.category}</span></td>
                                    <td>{row.action}</td>
                                    <td className="log-cell-actions">
                                        <ActionIcon icon={IconInfo} label="Details" onClick={() => setViewingLog(row)} />
                                    </td>
                                </tr>
                            ))}
                            {filteredRows.length === 0 && (
                                <tr>
                                    <td colSpan="5" className="log-empty-row">No log entries match your filters.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                <Pagination
                    {...pager}
                    classPrefix="log-"
                    unit="log entries"
                />
            </section>


            {viewingLog && (
                <div className="log-modal-overlay" onClick={() => setViewingLog(null)}>
                    <div className="log-modal-card" onClick={(e) => e.stopPropagation()}>
                        <div className="log-modal-header">
                            <h3>Log Entry Details</h3>
                            <button className="log-modal-close" onClick={() => setViewingLog(null)} aria-label="Close">×</button>
                        </div>
                        <div className="log-modal-body">
                            <dl className="log-detail-list">
                                <dt>Log ID</dt><dd>{viewingLog.id}</dd>
                                <dt>Timestamp</dt><dd>{viewingLog.timestamp}</dd>
                                <dt>User</dt><dd>{viewingLog.user} ({viewingLog.role})</dd>
                                <dt>Category</dt><dd><span className={`log-category log-category-${viewingLog.category.toLowerCase().replace(" ", "")}`}>{viewingLog.category}</span></dd>
                                <dt>Action</dt><dd>{viewingLog.action}</dd>
                                <dt>Details</dt><dd>{viewingLog.details}</dd>
                            </dl>
                        </div>
                        <div className="log-modal-footer">
                            <button className="log-btn log-btn-secondary" onClick={() => setViewingLog(null)}>Close</button>
                        </div>
                    </div>
                </div>
            )}

        </AppShell>
    );
}

export default ActivityLogs;