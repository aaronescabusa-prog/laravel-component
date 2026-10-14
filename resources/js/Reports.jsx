import { useEffect, useMemo, useState } from "react";
import "./Reports.css";
import AppShell from "./components/AppShell";
import { reportsApi } from "./lib/api";
import { downloadCSV } from "./lib/csv";

const REPORT_TYPES = [
    { key: "registration", label: "Registration Report" },
    { key: "attendance", label: "Attendance Report" },
    { key: "financial", label: "Financial Report" },
    { key: "event", label: "Event Summary Report" },
];

function peso(n) {
    return `₱${Number(n).toLocaleString()}`;
}

function Reports() {
    const [reportType, setReportType] = useState("registration");
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const [exportMessage, setExportMessage] = useState("");

    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");

    useEffect(() => {
        let active = true;
        setLoading(true);
        setLoadError("");
        const params = {};
        if (dateFrom) params.from = dateFrom;
        if (dateTo) params.to = dateTo;

        reportsApi.get(params)
            .then((payload) => { if (active) setData(payload); })
            .catch((err) => { if (active) setLoadError(err.message); })
            .finally(() => { if (active) setLoading(false); });

        return () => { active = false; };
    }, [dateFrom, dateTo]);

    const registrations = useMemo(() => data?.registrations ?? [], [data]);
    const attendance = useMemo(() => data?.attendance ?? [], [data]);
    const financial = useMemo(() => data?.financial ?? [], [data]);
    const eventSummary = useMemo(() => data?.events ?? [], [data]);

    const financialTotals = useMemo(() => {
        const income = financial.reduce((sum, r) => sum + Number(r.income || 0), 0);
        const expenses = financial.reduce((sum, r) => sum + Number(r.expenses || 0), 0);
        return { income, expenses, net: income - expenses };
    }, [financial]);

    const registrationMax = Math.max(...registrations.map((r) => Number(r.capacity) || 0), 1);
    const financialMax = Math.max(...financial.flatMap((r) => [Number(r.income) || 0, Number(r.expenses) || 0]), 1);

    function flashExport(message) {
        setExportMessage(message);
        setTimeout(() => setExportMessage(""), 3000);
    }

    function handleExport() {
        const filename = `${reportType}-report-${dateKey()}.csv`;
        let rows = [];

        if (reportType === "registration") {
            rows = [
                ["Event", "Registered", "Paid", "Pending", "Capacity", "Fill Rate"],
                ...registrations.map((r) => [r.event, r.registered, r.paid, r.pending, r.capacity, `${r.fill_rate === null ? "" : `${r.fill_rate}%`}`]),
            ];
        } else if (reportType === "attendance") {
            rows = [
                ["Event", "Registered", "Present", "Attendance Rate"],
                ...attendance.map((r) => [r.event, r.registered, r.present, `${r.rate}%`]),
            ];
        } else if (reportType === "financial") {
            rows = [
                ["Event", "Income", "Expenses", "Net"],
                ...financial.map((r) => [r.event, r.income, r.expenses, r.net]),
            ];
        } else {
            rows = [
                ["Event", "Category", "Organizer", "Status", "Date", "Participants", "Capacity"],
                ...eventSummary.map((r) => [r.title, r.category, r.organizer, r.status, r.event_date, r.participants, r.capacity]),
            ];
        }

        downloadCSV(filename, rows);
        flashExport(`Exported ${rows.length - 1} rows to ${filename}.`);
    }

    function dateKey() {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    }

    function handlePrint() {
        window.print();
    }

    return (
        <AppShell title="Reports" prefix="rpt-">

            <section className="rpt-controls">
                <div className="rpt-report-filter">
                    <label htmlFor="reportType">Report type</label>
                    <select id="reportType" value={reportType} onChange={(e) => setReportType(e.target.value)}>
                        {REPORT_TYPES.map((type) => (
                            <option key={type.key} value={type.key}>{type.label}</option>
                        ))}
                    </select>
                </div>

                <div className="rpt-date-range">
                    <div className="rpt-date-field">
                        <label htmlFor="dateFrom">From</label>
                        <input id="dateFrom" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                    </div>
                    <div className="rpt-date-field">
                        <label htmlFor="dateTo">To</label>
                        <input id="dateTo" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                    </div>
                </div>
                <div className="rpt-export-actions">
                    <button className="rpt-btn rpt-btn-secondary" onClick={handleExport} disabled={loading}>Export CSV</button>
                    <button className="rpt-btn rpt-btn-secondary" onClick={handlePrint}>Print</button>
                </div>

                {exportMessage && <div className="rpt-export-toast">{exportMessage}</div>}
            </section>

            {loading && <div className="rpt-loading">Loading report data…</div>}

            {!loading && loadError && <div className="rpt-loading rpt-loading-error">Could not load reports: {loadError}</div>}

            {!loading && !loadError && reportType === "registration" && (
                <>
                    <div className="rpt-kpi-strip">
                        <div className="rpt-kpi-item">
                            <span className="rpt-kpi-label">Total Registered</span>
                            <span className="rpt-kpi-value">{registrations.reduce((s, r) => s + Number(r.registered || 0), 0).toLocaleString()}</span>
                        </div>
                        <div className="rpt-kpi-item">
                            <span className="rpt-kpi-label">Events Covered</span>
                            <span className="rpt-kpi-value">{registrations.length}</span>
                        </div>
                    </div>

                    <section className="rpt-panel">
                        <h2>Registrations by Event</h2>
                        {registrations.length === 0 ? (
                            <p className="rpt-empty">No registration data in this date range.</p>
                        ) : (
                            <div className="rpt-chart">
                                {registrations.map((row) => (
                                    <div key={row.event} className="rpt-bar-row">
                                        <span className="rpt-bar-label">{row.event}</span>
                                        <div className="rpt-bar-track">
                                            <div
                                                className="rpt-bar-fill"
                                                style={{ width: `${(Number(row.registered || 0) / registrationMax) * 100}%` }}
                                            ></div>
                                        </div>
                                        <span className="rpt-bar-value">{row.registered}{row.capacity ? `/${row.capacity}` : ""}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                    <section className="rpt-panel">
                        <h2>Detailed Breakdown</h2>
                        <div className="rpt-table-wrapper">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Event</th>
                                        <th>Registered</th>
                                        <th>Capacity</th>
                                        <th>Fill Rate</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {registrations.map((row) => (
                                        <tr key={row.event}>
                                            <td>{row.event}</td>
                                            <td className="rpt-cell-muted">{row.registered}</td>
                                            <td className="rpt-cell-muted">{row.capacity ?? "—"}</td>
                                            <td className="rpt-cell-muted">{row.fill_rate === null ? "—" : `${row.fill_rate}%`}</td>
                                        </tr>
                                    ))}
                                    {registrations.length === 0 && (
                                        <tr><td colSpan={4} className="rpt-cell-muted">No data.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </section>
                </>
            )}

            {!loading && !loadError && reportType === "attendance" && (
                <>
                    <div className="rpt-kpi-strip">
                        <div className="rpt-kpi-item">
                            <span className="rpt-kpi-label">Average Attendance Rate</span>
                            <span className="rpt-kpi-value">
                                {attendance.filter((r) => Number(r.present) > 0).length > 0
                                    ? `${Math.round(attendance.filter((r) => Number(r.present) > 0).reduce((s, r) => s + Number(r.rate || 0), 0) / attendance.filter((r) => Number(r.present) > 0).length)}%`
                                    : "—"}
                            </span>
                        </div>
                        <div className="rpt-kpi-item">
                            <span className="rpt-kpi-label">Total Present</span>
                            <span className="rpt-kpi-value">{attendance.reduce((s, r) => s + Number(r.present || 0), 0)}</span>
                        </div>
                        <div className="rpt-kpi-item rpt-kpi-alert">
                            <span className="rpt-kpi-label">Events Not Yet Held</span>
                            <span className="rpt-kpi-value">{attendance.filter((r) => Number(r.present) === 0).length}</span>
                        </div>
                    </div>

                    <section className="rpt-panel">
                        <h2>Attendance Rate by Event</h2>
                        <div className="rpt-table-wrapper">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Event</th>
                                        <th>Registered</th>
                                        <th>Present</th>
                                        <th>Attendance Rate</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {attendance.map((row) => (
                                        <tr key={row.event}>
                                            <td>{row.event}</td>
                                            <td className="rpt-cell-muted">{row.registered}</td>
                                            <td className="rpt-cell-muted">{row.present}</td>
                                            <td>
                                                {Number(row.present) > 0 ? (
                                                    <span className={`rpt-rate-badge ${Number(row.rate) >= 90 ? "rpt-rate-high" : Number(row.rate) >= 70 ? "rpt-rate-mid" : "rpt-rate-low"}`}>
                                                        {row.rate}%
                                                    </span>
                                                ) : (
                                                    <span className="rpt-cell-muted">Not held yet</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                    {attendance.length === 0 && (
                                        <tr><td colSpan={4} className="rpt-cell-muted">No data.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </section>
                </>
            )}

            {!loading && !loadError && reportType === "financial" && (
                <>
                    <div className="rpt-kpi-strip">
                        <div className="rpt-kpi-item">
                            <span className="rpt-kpi-label">Total Income</span>
                            <span className="rpt-kpi-value">{peso(financialTotals.income)}</span>
                        </div>
                        <div className="rpt-kpi-item">
                            <span className="rpt-kpi-label">Total Expenses</span>
                            <span className="rpt-kpi-value">{peso(financialTotals.expenses)}</span>
                        </div>
                        <div className={`rpt-kpi-item ${financialTotals.net < 0 ? "rpt-kpi-alert" : ""}`}>
                            <span className="rpt-kpi-label">Net Balance</span>
                            <span className="rpt-kpi-value">{peso(financialTotals.net)}</span>
                        </div>
                    </div>

                    <section className="rpt-panel">
                        <h2>Income vs. Expenses by Event</h2>
                        {financial.length === 0 ? (
                            <p className="rpt-empty">No financial data in this date range.</p>
                        ) : (
                            <div className="rpt-chart">
                                {financial.map((row) => (
                                    <div key={row.event} className="rpt-bar-row rpt-bar-row-dual">
                                        <span className="rpt-bar-label">{row.event}</span>
                                        <div className="rpt-bar-group">
                                            <div className="rpt-bar-track">
                                                <div className="rpt-bar-fill rpt-bar-income" style={{ width: `${(Number(row.income || 0) / financialMax) * 100}%` }}></div>
                                            </div>
                                            <div className="rpt-bar-track">
                                                <div className="rpt-bar-fill rpt-bar-expense" style={{ width: `${(Number(row.expenses || 0) / financialMax) * 100}%` }}></div>
                                            </div>
                                        </div>
                                        <span className="rpt-bar-value">{peso(row.income)} / {peso(row.expenses)}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="rpt-legend">
                            <span className="rpt-legend-item"><span className="rpt-legend-dot rpt-legend-income"></span>Income</span>
                            <span className="rpt-legend-item"><span className="rpt-legend-dot rpt-legend-expense"></span>Expenses</span>
                        </div>
                    </section>

                    <section className="rpt-panel">
                        <h2>Detailed Breakdown</h2>
                        <div className="rpt-table-wrapper">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Event</th>
                                        <th>Income</th>
                                        <th>Expenses</th>
                                        <th>Net</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {financial.map((row) => (
                                        <tr key={row.event}>
                                            <td>{row.event}</td>
                                            <td className="rpt-cell-muted">{peso(row.income)}</td>
                                            <td className="rpt-cell-muted">{peso(row.expenses)}</td>
                                            <td className={Number(row.net) < 0 ? "rpt-cell-negative" : "rpt-cell-positive"}>
                                                {peso(row.net)}
                                            </td>
                                        </tr>
                                    ))}
                                    {financial.length === 0 && (
                                        <tr><td colSpan={4} className="rpt-cell-muted">No data.</td></tr>
                                    )}
                                </tbody>
                                <tfoot>
                                    <tr>
                                        <td><strong>Total</strong></td>
                                        <td><strong>{peso(financialTotals.income)}</strong></td>
                                        <td><strong>{peso(financialTotals.expenses)}</strong></td>
                                        <td className={financialTotals.net < 0 ? "rpt-cell-negative" : "rpt-cell-positive"}>
                                            <strong>{peso(financialTotals.net)}</strong>
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </section>
                </>
            )}

            {!loading && !loadError && reportType === "event" && (
                <>
                    <div className="rpt-kpi-strip">
                        <div className="rpt-kpi-item">
                            <span className="rpt-kpi-label">Total Events</span>
                            <span className="rpt-kpi-value">{eventSummary.length}</span>
                        </div>
                        <div className="rpt-kpi-item">
                            <span className="rpt-kpi-label">Completed</span>
                            <span className="rpt-kpi-value">{eventSummary.filter((e) => e.status === "Completed").length}</span>
                        </div>
                        <div className="rpt-kpi-item">
                            <span className="rpt-kpi-label">Approved / Upcoming</span>
                            <span className="rpt-kpi-value">{eventSummary.filter((e) => e.status === "Approved").length}</span>
                        </div>
                    </div>

                    <section className="rpt-panel">
                        <h2>Event Summary</h2>
                        <div className="rpt-table-wrapper">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Event</th>
                                        <th>Category</th>
                                        <th>Organizer</th>
                                        <th>Status</th>
                                        <th>Participants</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {eventSummary.map((row) => (
                                        <tr key={row.reference}>
                                            <td>{row.title}</td>
                                            <td className="rpt-cell-muted">{row.category}</td>
                                            <td className="rpt-cell-muted">{row.organizer}</td>
                                            <td><span className={`rpt-status rpt-status-${row.status.toLowerCase()}`}>{row.status}</span></td>
                                            <td className="rpt-cell-muted">{row.participants}{row.capacity ? `/${row.capacity}` : ""}</td>
                                        </tr>
                                    ))}
                                    {eventSummary.length === 0 && (
                                        <tr><td colSpan={5} className="rpt-cell-muted">No data.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </section>
                </>
            )}

        </AppShell>
    );
}

export default Reports;
