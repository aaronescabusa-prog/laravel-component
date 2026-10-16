import { NavLink } from "react-router-dom";
import { useEffect, useState } from "react";
import "./Dashboard.css";
import AppShell from "./components/AppShell";
import KpiCard from "./components/KpiCard";
import { api, mapEventFromApi, mapLogFromApi } from "./lib/api";
import {
    IconCalendar,
    IconCheckSquare,
    IconAward,
    IconReport,
} from "./components/Icons";

const QUICK_ACTIONS = [
    { to: "/events", label: "Create Event", icon: IconCalendar },
    { to: "/registrations", label: "Verify Registrations", icon: IconCheckSquare },
    { to: "/certificates", label: "Generate Certificate", icon: IconAward },
    { to: "/reports", label: "View Reports", icon: IconReport },
];


function formatTime(ts) {
    const parts = ts.split(" ");
    const date = parts[0] ?? "";
    const [h, m] = (parts[1] ?? "").split(":");
    return h && m ? `${date}, ${h}:${m} ${Number(h) >= 12 ? "PM" : "AM"}` : ts;
}

const REFRESH_INTERVAL_MS = 60_000;

function Dashboard() {

    const [summary, setSummary] = useState(null);
    const [upcomingEvents, setUpcomingEvents] = useState([]);
    const [recentActivity, setRecentActivity] = useState([]);
    const [lastUpdated, setLastUpdated] = useState(null);
    const [refreshing, setRefreshing] = useState(false);
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [refreshToken, setRefreshToken] = useState(0);

    // Bumping refreshToken re-runs this effect, which is how the manual button
    // and the auto-refresh timer both trigger a reload without each needing its
    // own copy of the fetch, and without the timer capturing stale props.
    useEffect(() => {
        let active = true;
        setRefreshing(true);

        // Counts and averages come from one aggregate endpoint instead of six
        // full-table downloads; the two preview lists stay lightweight reads.
        Promise.allSettled([
            api.summary(),
            api.list("events", { per_page: 4, status: "Approved" }),
            api.list("activity-logs", { per_page: 5 }),
        ]).then((results) => {
            if (!active) return;
            const pick = (r) => (r.status === "fulfilled" ? r.value ?? null : null);
            const [s, upcoming, activity] = results.map(pick);
            if (s) setSummary(s);
            if (Array.isArray(upcoming)) setUpcomingEvents(upcoming.map(mapEventFromApi));
            else if (upcoming?.data) setUpcomingEvents(upcoming.data.map(mapEventFromApi));
            if (Array.isArray(activity)) setRecentActivity(activity.map(mapLogFromApi));
            else if (activity?.data) setRecentActivity(activity.data.map(mapLogFromApi));
            setLastUpdated(new Date());
        }).finally(() => {
            if (active) setRefreshing(false);
        });

        return () => { active = false; };
    }, [refreshToken]);

    // Only armed when the operator opts in, so nobody's dashboard silently
    // re-renders while they are reading a panel.
    useEffect(() => {
        if (!autoRefresh) return undefined;

        const id = setInterval(() => setRefreshToken((n) => n + 1), REFRESH_INTERVAL_MS);

        return () => clearInterval(id);
    }, [autoRefresh]);

    function lastUpdatedLabel() {
        if (!lastUpdated) return "Loading…";
        return `Last updated ${lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
    }

    // The summary endpoint reports pending event approvals as `events_pending`
    // (ReportController::summary).
    const pendingRequests = Number(summary?.events_pending ?? 0);
    const activeEvents = Number(summary?.events_active ?? 0);
    const issuedCerts = Number(summary?.certificates_issued ?? 0);
    const paidCount = Number(summary?.registrations_paid ?? 0);
    const pendingPayment = Number(summary?.registrations_pending_payment ?? 0);
    const attendedCount = Number(summary?.registrations_attended ?? 0);
    const pendingCerts = Number(summary?.certificates_pending ?? 0);
    const totalCertificates = Number(summary?.certificates_total ?? 0);
    const notEligibleCerts = Number(summary?.certificates_not_eligible ?? 0);
    const totalRegistrations = Number(summary?.registrations ?? 0);
    const totalUsers = Number(summary?.users ?? 0);
    const evaluationResponses = Number(summary?.evaluations ?? 0);
    const eventsRated = Number(summary?.evaluations_events ?? 0);
    const eventCategories = Number(summary?.event_categories ?? 0);
    const avgRating = summary?.avg_rating ?? "0.0";

    return (
        <AppShell title="Dashboard">

        {/* KPI Strip - using KpiCard components */}
        <div className="kpi-strip">
          {[
            { label: "Total Registered Users", value: totalUsers.toLocaleString(), trend: "up", trendLabel: "From the User Accounts list" },
            { label: "Active Events", value: activeEvents, trend: "up", trendLabel: "from the Events list" },
            { label: "Events awaiting approval", value: pendingRequests, trend: "", trendLabel: "Admin review required", alert: pendingRequests > 0 },
            { label: "Certificates Issued", value: issuedCerts, trend: "up", trendLabel: "from the Certificates list" },
          ].map((kpi, idx) => (
            <KpiCard
              key={idx}
              label={kpi.label}
              value={kpi.value}
              trend={kpi.trend}
              trendLabel={kpi.trendLabel}
              alert={kpi.alert}
            />
          ))}
        </div>
        {pendingRequests > 0 && (
            <div className="dash-approval-notice" role="status">
                <div>
                    <strong>{pendingRequests} event{pendingRequests === 1 ? "" : "s"} need{pendingRequests === 1 ? "s" : ""} review</strong>
                    <span>Review pending submissions before they appear as active events.</span>
                </div>
                <NavLink to="/events" className="dash-approval-link">Review events</NavLink>
            </div>
        )}
            <div className="dash-refresh-bar">
                <span className="dash-refresh-stamp">
                    Last updated: {lastUpdated ? lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}
                </span>
                <div className="dash-refresh-actions">
                    <label className="dash-refresh-auto">
                        <input
                            type="checkbox"
                            checked={autoRefresh}
                            onChange={(e) => setAutoRefresh(e.target.checked)}
                        />
                        <span>Auto-refresh every 60s</span>
                    </label>
                    <button
                        type="button"
                        className="dash-refresh-btn"
                        onClick={() => setRefreshToken((n) => n + 1)}
                        disabled={refreshing}
                        aria-label="Refresh dashboard data"
                    >
                        ⟳ {refreshing ? "Refreshing…" : "Refresh"}
                    </button>
                </div>
            </div>

            <nav className="dash-actions">
                {QUICK_ACTIONS.map((action) => (
                    <NavLink key={action.to} to={action.to} className="dash-action-link">
                        {action.icon && <action.icon className="dash-action-icon" size={16} />}
                        {action.label}
                    </NavLink>
                ))}
            </nav>


            <div className="dash-bento-grid">

                <section className="dash-panel dash-bento-card bento-wide">
                    <div className="dash-panel-header">
                        <h2>Upcoming Events</h2>
                        <NavLink to="/events" className="dash-link">View all</NavLink>
                    </div>

                    <div className="table-wrapper">
                        <table>
                            <thead>
                                <tr>
                                    <th>Event</th>
                                    <th>Date</th>
                                    <th>Venue</th>
                                    <th>Slots</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {upcomingEvents.length === 0 && (
                                    <tr><td colSpan={5} className="cell-muted">No upcoming events yet.</td></tr>
                                )}
                                {upcomingEvents.map((evt) => {
                                    const pct = evt.capacity ? Math.round((evt.participants / evt.capacity) * 100) : 0;
                                    return (
                                        <tr key={evt.id}>
                                            <td>{evt.name}</td>
                                            <td className="cell-muted">{evt.date}</td>
                                            <td className="cell-muted">{evt.venue}</td>
                                            <td>
                                                <div className="dash-slots">
                                                    <span>{evt.participants} / {evt.capacity.toLocaleString()}</span>
                                                    <span className="dash-progress">
                                                        <span className="dash-progress-fill" style={{ width: `${pct}%` }} />
                                                    </span>
                                                </div>
                                            </td>
                                            <td>
                                                <span className={`status status-${evt.status.toLowerCase()}`}>
                                                    {evt.status}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </section>

                <section className="dash-panel dash-bento-card bento-tall">
                    <div className="dash-panel-header">
                        <h2>Recent Activity</h2>
                        <NavLink to="/activity-logs" className="dash-link">View all</NavLink>
                    </div>

                    <div className="dash-feed">
                        {recentActivity.length === 0 && (
                            <div className="dash-feed-item"><div className="dash-feed-main">No activity recorded yet.</div></div>
                        )}
                        {recentActivity.map((item, idx) => (
                            <div className="dash-feed-item" key={idx}>
                                <span className={`dash-feed-cat dash-cat-${item.category.toLowerCase()}`}>
                                    {item.category}
                                </span>
                                <div className="dash-feed-main">
                                    <div className="dash-feed-action">{item.action}</div>
                                    <div className="dash-feed-meta">{item.user}</div>
                                </div>
                                <span className="dash-feed-time">{formatTime(item.timestamp)}</span>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="dash-panel dash-bento-card">
                    <div className="dash-panel-header">
                        <h2>Registrations</h2>
                        <NavLink to="/registrations" className="dash-link">View all</NavLink>
                    </div>
                    <div className="dash-snapshot">
                        <div>
                            <div className="dash-stat-value">{totalRegistrations.toLocaleString()}</div>
                            <div className="dash-stat-label">Total registrations</div>
                        </div>
                        <div className="dash-snapshot-grid">
                            <div className="dash-mini">
                                <span className="dash-mini-value">{paidCount}</span>
                                <span className="dash-mini-label">Paid</span>
                            </div>
                            <div className="dash-mini">
                                <span className="dash-mini-value">{pendingPayment}</span>
                                <span className="dash-mini-label">Pending payment</span>
                            </div>
                            <div className="dash-mini">
                                <span className="dash-mini-value">{attendedCount}</span>
                                <span className="dash-mini-label">Attended</span>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="dash-panel dash-bento-card">
                    <div className="dash-panel-header">
                        <h2>Certificates</h2>
                        <NavLink to="/certificates" className="dash-link">View all</NavLink>
                    </div>
                    <div className="dash-snapshot">
                        <div>
                            <div className="dash-stat-value">{issuedCerts}</div>
                            <div className="dash-stat-label">Issued</div>
                        </div>
                        <div className="dash-snapshot-grid">
                            <div className="dash-mini">
                                <span className="dash-mini-value">{pendingCerts}</span>
                                <span className="dash-mini-label">Pending</span>
                            </div>
                            <div className="dash-mini">
                                <span className="dash-mini-value">{totalCertificates}</span>
                                <span className="dash-mini-label">Total certificates</span>
                            </div>
                            <div className="dash-mini">
                                <span className="dash-mini-value">{notEligibleCerts}</span>
                                <span className="dash-mini-label">Not eligible</span>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="dash-panel dash-bento-card">
                    <div className="dash-panel-header">
                        <h2>Evaluations &amp; Announcements</h2>
                        <NavLink to="/evaluations" className="dash-link">View all</NavLink>
                    </div>
                    <div className="dash-snapshot">
                        <div>
                            <div className="dash-stat-value">{avgRating}<span className="dash-stat-suffix"> / 5</span></div>
                            <div className="dash-stat-label">Avg. event rating</div>
                        </div>
                        <div className="dash-snapshot-grid">
                            <div className="dash-mini">
                                <span className="dash-mini-value">{evaluationResponses}</span>
                                <span className="dash-mini-label">Responses</span>
                            </div>
                            <div className="dash-mini">
                                <span className="dash-mini-value">{eventsRated}</span>
                                <span className="dash-mini-label">Events rated</span>
                            </div>
                            <div className="dash-mini">
                                <span className="dash-mini-value">{eventCategories}</span>
                                <span className="dash-mini-label">Event categories</span>
                            </div>
                        </div>
                    </div>
                </section>

            </div>

        </AppShell>
    );
}

export default Dashboard;
