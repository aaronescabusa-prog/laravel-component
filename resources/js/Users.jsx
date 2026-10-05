import { useMemo, useRef, useState } from "react";
import "./Dashboard.css";
import "./Users.css";
import AppShell from "./components/AppShell";
import Toast from "./components/Toast";
import ConfirmDialog from "./components/ConfirmDialog";
import { useToast } from "./lib/useToast";
import { useCollection, logActivity, nextId, dateKey } from "./lib/storage";
import { api, mapUserToApi, usersApi, USER_ROLES } from "./lib/api";
import { downloadCSV, dateStamp, parseCSV } from "./lib/csv";
import { usePagination } from "./lib/usePagination";
import { useRowSelection } from "./lib/useRowSelection";
import Pagination from "./components/Pagination";
import { ActionIcon, IconEdit, IconPower, IconTrash } from "./components/Icons";
import { useUser } from "./lib/session";

const COURSES = [
    "BS Information Technology",
    "BS Criminology",
    "BS Office Administration",
    "BS Education Major in English",
    "Bachelor of Elementary Education",
    "BA Political Science",
    "BA Communications",
];

const YEARS = ["1", "2", "3", "4"];

/* Values a CSV import may set, in the exact spelling the API accepts. */
const IMPORT_ROLES = USER_ROLES;
const IMPORT_STATUSES = ["Active", "Pending", "Suspended"];

/* Columns the importer understands, keyed by the field each one fills. A header
   is matched on its letters and digits only, so "Block No.", "block_no" and
   "BlockNo" resolve to the same field and an edited copy of the Export CSV
   imports without any header juggling. */
const IMPORT_COLUMNS = {
    id: ["id", "reference"],
    name: ["name", "fullname", "studentname"],
    email: ["email", "emailaddress"],
    role: ["role", "userrole"],
    course: ["course", "program"],
    blockNo: ["blockno", "block", "blocknumber"],
    year: ["year", "yearlevel"],
    status: ["status"],
    date: ["dateregistered", "date", "registrationdate"],
    password: ["password", "temporarypassword"],
};

/* Each row is a separate request, so an unbounded file would tie up the tab and
   hammer the API. Anything larger has to be split by hand. */
const IMPORT_ROW_LIMIT = 500;
const IMPORT_PASSWORD_MIN = 8;

/** Header text reduced to a comparable key: case, spaces and punctuation drop out. */
const headerKey = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Column position holding `field`, or -1 when the file has no such column. */
function headerColumn(headers, field) {
    return headers.findIndex((header) => IMPORT_COLUMNS[field].includes(headerKey(header)));
}

/** Resolve free text to the exact spelling the API accepts, or null. */
function canonicalOption(value, allowed) {
    const needle = headerKey(value);
    return allowed.find((option) => headerKey(option) === needle) ?? null;
}

/** Numeric part of an account reference (USR-2215 -> 2215), or 0. */
function referenceNumber(reference) {
    const digits = String(reference ?? "").replace(/\D+/g, "");
    return digits ? Number(digits) : 0;
}

function initialsOf(name) {
    return name
        .split(" ")
        .filter(Boolean)
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
}

function Users() {
    const user = useUser();
    const { toast, showToast, dismissToast } = useToast();
    const [users, setUsers, refreshUsers] = useCollection("users", (msg) => showToast(msg, "danger"));
    const [pendingDelete, setPendingDelete] = useState(null);
    const [pendingSuspend, setPendingSuspend] = useState(null);
    const [search, setSearch] = useState("");
    const [roleFilter, setRoleFilter] = useState("all");
    const [statusFilter, setStatusFilter] = useState("all");
    const [courseFilter, setCourseFilter] = useState("all");
    const [blockFilter, setBlockFilter] = useState("all");
    const [yearFilter, setYearFilter] = useState("all");
    const [sortKey, setSortKey] = useState("date");
    const [sortDir, setSortDir] = useState("desc");
    const [editingUser, setEditingUser] = useState(null);
    const [isNewUser, setIsNewUser] = useState(false);
    const [savingUser, setSavingUser] = useState(false);
    const [importOpen, setImportOpen] = useState(false);
    const [importFile, setImportFile] = useState(null);
    const [importPassword, setImportPassword] = useState("");
    const [importBusy, setImportBusy] = useState(false);
    const [importReport, setImportReport] = useState(null);
    const importInputRef = useRef(null);

    const filteredRows = useMemo(() => {
        let rows = users.filter((row) => {
            const term = search.trim().toLowerCase();
            const matchesSearch = !term || row.name.toLowerCase().includes(term) || row.email.toLowerCase().includes(term);
            const matchesRole = roleFilter === "all" || row.role.toLowerCase() === roleFilter;
            const matchesStatus = statusFilter === "all" || row.status.toLowerCase() === statusFilter;
            const matchesCourse = courseFilter === "all" || (row.course || "") === courseFilter;
            const matchesBlock = blockFilter === "all" || String(row.blockNo ?? "").toLowerCase() === blockFilter;
            const matchesYear = yearFilter === "all" || (row.year || "") === yearFilter;
            return matchesSearch && matchesRole && matchesStatus && matchesCourse && matchesBlock && matchesYear;
        });

        rows = [...rows].sort((a, b) => {
            const dir = sortDir === "asc" ? 1 : -1;
            if (a[sortKey] < b[sortKey]) return -1 * dir;
            if (a[sortKey] > b[sortKey]) return 1 * dir;
            return 0;
        });

        return rows;
    }, [users, search, roleFilter, statusFilter, courseFilter, blockFilter, yearFilter, sortKey, sortDir]);

    const pager = usePagination(filteredRows, {
        resetKey: [search, roleFilter, statusFilter, courseFilter, blockFilter, yearFilter, sortKey, sortDir].join("|"),
    });

    const selection = useRowSelection({
        pageRows: pager.pageRows,
        matchingRows: filteredRows,
        resetKey: [search, roleFilter, statusFilter, courseFilter, blockFilter, yearFilter, sortKey, sortDir].join("|"),
    });

    /* Block numbers come from the accounts themselves, so the filter always
       reflects what the registrar saved in the form. */
    const blockOptions = useMemo(() => {
        const seen = new Set();
        return users
            .map((row) => String(row.blockNo ?? "").trim())
            .filter((block) => {
                if (!block || seen.has(block.toLowerCase())) return false;
                seen.add(block.toLowerCase());
                return true;
            })
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    }, [users]);

    function toggleSort(key) {
        if (sortKey === key) {
            setSortDir(sortDir === "asc" ? "desc" : "asc");
        } else {
            setSortKey(key);
            setSortDir("asc");
        }
    }

    function exportCSV() {
        const rows = [
            ["ID", "Name", "Email", "Role", "Course", "Block No.", "Year", "Status", "Date Registered"],
            ...filteredRows.map((r) => [r.id, r.name, r.email, r.role, r.course || "", r.blockNo || "", r.year || "", r.status, r.date || ""]),
        ];
        downloadCSV(`users-${dateStamp()}.csv`, rows);
        showToast(`Exported ${filteredRows.length} account${filteredRows.length === 1 ? "" : "s"}.`);
    }

    /** Same columns as exportCSV, narrowed to whatever is ticked. */
    function exportSelectedCSV() {
        const rows = [
            ["ID", "Name", "Email", "Role", "Course", "Block No.", "Year", "Status", "Date Registered"],
            ...selection.selectedRows.map((r) => [r.id, r.name, r.email, r.role, r.course || "", r.blockNo || "", r.year || "", r.status, r.date || ""]),
        ];
        downloadCSV(`users-selected-${dateStamp()}.csv`, rows);
        showToast(`Exported ${selection.selectedRows.length} selected account${selection.selectedRows.length === 1 ? "" : "s"}.`);
    }

    /* ---------- CSV import ---------- */

    function openImport() {
        // The toolbar button is hidden from non-admins, but that is presentation
        // only. Re-checked here so the modal cannot be reached by any other path
        // into this screen.
        if (user.role !== "Admin") {
            showToast("Only an administrator can import accounts.", "danger");
            return;
        }

        setImportFile(null);
        setImportPassword("");
        setImportReport(null);
        setImportOpen(true);
    }

    function downloadImportTemplate() {
        downloadCSV("users-template.csv", [
            ["ID", "Name", "Email", "Role", "Course", "Block No.", "Year", "Status", "Date Registered", "Password"],
            ["USR-2216", "Paolo Ramos", "paolo.ramos@tmc.edu.ph", "Student", "BS Information Technology", "B3", "3", "Pending", dateKey(), "secret1234"],
        ]);
    }

    /**
     * Create every account in the chosen CSV through the administrator-only
     * bulk endpoint.
     *
     * The rows go out as one request. The endpoint still validates and writes
     * them one at a time, so a single bad line is reported as a skip instead of
     * failing the whole file - the tolerance this importer had when it posted
     * each row separately, without the round trips.
     *
     * Rows this screen can already judge on its own - a blank name, an email
     * repeated within the file, a missing password - are skipped here so the
     * reason is specific. Everything else is sent and judged by the server,
     * which is the only place that can check the database.
     *
     * Nothing is written through setUsers() - the list is re-read from the API
     * afterwards, the same way saveUser() treats password-carrying rows.
     */
    async function runImport() {
        if (!importFile) {
            showToast("Choose a CSV file to import.", "danger");
            return;
        }

        if (importPassword && importPassword.length < IMPORT_PASSWORD_MIN) {
            showToast(`The default password must be at least ${IMPORT_PASSWORD_MIN} characters.`, "danger");
            return;
        }

        setImportBusy(true);

        try {
            const { headers, rows } = parseCSV(await importFile.text());

            if (headers.length === 0 || rows.length === 0) {
                showToast("That file has no data rows.", "danger");
                return;
            }

            if (rows.length > IMPORT_ROW_LIMIT) {
                showToast(`That file has ${rows.length} rows; the limit is ${IMPORT_ROW_LIMIT}.`, "danger");
                return;
            }

            const columns = Object.fromEntries(
                Object.keys(IMPORT_COLUMNS).map((field) => [field, headerColumn(headers, field)])
            );

            if (columns.name < 0 || columns.email < 0) {
                showToast("The file needs at least Name and Email columns.", "danger");
                return;
            }

            const cell = (row, field) => (columns[field] >= 0 ? row[columns[field]] : "");

            // Start past the highest reference already in use, so a file with no
            // ID column can never collide with an account that already exists.
            let nextReference = referenceNumber(nextId(users, "USR", 2001));

            const imported = [];
            const skipped = [];
            const pending = [];
            const seenEmails = new Set();

            for (let offset = 0; offset < rows.length; offset += 1) {
                const row = rows[offset];
                const line = offset + 2; // 1-based line in the file, past the header

                const name = cell(row, "name");
                const email = cell(row, "email");

                if (!name || !email) {
                    skipped.push({ line, name: name || "(blank row)", reason: "Name and email are required." });
                    continue;
                }

                const emailKey = email.toLowerCase();
                if (seenEmails.has(emailKey)) {
                    skipped.push({ line, name, reason: `Duplicate email in this file (${email}).` });
                    continue;
                }

                const role = canonicalOption(cell(row, "role"), IMPORT_ROLES) ?? "Student";
                const status = canonicalOption(cell(row, "status"), IMPORT_STATUSES) ?? "Pending";

                // store() refuses an Admin row from a non-admin caller, so drop it
                // here with a readable reason rather than provoke one 403 per row.
                if (role === "Admin" && user.role !== "Admin") {
                    skipped.push({ line, name, reason: "Only an administrator can create Admin accounts." });
                    continue;
                }

                // A Password column wins; a blank cell falls back to the value
                // typed in the dialog, which is why that field matters when the
                // file carries no password column at all.
                const password = cell(row, "password") || importPassword;
                if (password.length < IMPORT_PASSWORD_MIN) {
                    skipped.push({ line, name, reason: `No password of at least ${IMPORT_PASSWORD_MIN} characters.` });
                    continue;
                }

                const suppliedId = cell(row, "id");
                let reference = suppliedId;
                if (suppliedId) {
                    // Keep generated references ahead of any id the file supplies.
                    const number = referenceNumber(suppliedId);
                    if (number > 0 && number >= nextReference) nextReference = number + 1;
                } else {
                    reference = `USR-${nextReference}`;
                    nextReference += 1;
                }

                seenEmails.add(emailKey);

                pending.push({
                    line,
                    ...mapUserToApi({
                        id: reference,
                        name,
                        email,
                        role,
                        status,
                        course: cell(row, "course"),
                        blockNo: cell(row, "blockNo"),
                        year: cell(row, "year"),
                        date: cell(row, "date") || dateKey(),
                        password,
                    }),
                });
            }

            // One request for everything this screen could not rule out itself.
            // The endpoint reports per-row outcomes, so the two sets of skips
            // are simply concatenated.
            if (pending.length > 0) {
                try {
                    const result = await usersApi.importRows(pending);

                    imported.push(...(Array.isArray(result?.imported) ? result.imported : []));
                    skipped.push(...(Array.isArray(result?.skipped) ? result.skipped : []));
                } catch (err) {
                    // The request itself failed, so none of these rows were
                    // written. Report every one of them rather than losing the
                    // file silently.
                    pending.forEach((row) => skipped.push({ line: row.line, name: row.name, reason: err.message }));
                }
            }

            setImportReport({ imported, skipped });

            if (imported.length > 0) {
                logActivity({
                    category: "User Management",
                    action: `Imported ${imported.length} account${imported.length === 1 ? "" : "s"} from CSV`,
                    details: imported.map((row) => `${row.name} (${row.reference})`).join(", "),
                });
                await refreshUsers();
            }

            showToast(
                imported.length > 0
                    ? `${imported.length} account${imported.length === 1 ? "" : "s"} imported${skipped.length > 0 ? `, ${skipped.length} skipped` : ""}.`
                    : "No accounts were imported.",
                imported.length > 0 ? "success" : "danger"
            );
        } catch (err) {
            showToast(err.message || "Could not read that file.", "danger");
        } finally {
            setImportBusy(false);
        }
    }

    function applyStatusChange(rows, nextStatus) {
        const ids = rows.map((r) => r.id);
        setUsers((prev) => prev.map((u) => (ids.includes(u.id) ? { ...u, status: nextStatus } : u)));
        logActivity({
            category: "User Management",
            action: `${rows.length > 1 ? "Bulk " : ""}${nextStatus === "Suspended" ? "Suspended" : "Reactivated"} ${rows.length > 1 ? `${rows.length} accounts` : `account ${rows[0].id}`}`,
            details: rows.map((r) => `${r.name} (${r.email})`).join(", "),
        });
        showToast(rows.length > 1
            ? `${rows.length} accounts ${nextStatus === "Suspended" ? "suspended" : "activated"}.`
            : `${rows[0].name} is now ${nextStatus.toLowerCase()}.`);
    }

    function toggleStatus(row) {
        // Reactivate immediately, but require confirmation before suspending.
        if (row.status === "Suspended") {
            applyStatusChange([row], "Active");
            return;
        }
        setPendingSuspend({ rows: [row], label: `${row.name} (${row.email})` });
    }

    function confirmSuspend() {
        const rows = pendingSuspend?.rows ?? [];
        if (rows.length === 0) return;
        applyStatusChange(rows, "Suspended");
        selection.deselect(rows.map((r) => r.id));
        setPendingSuspend(null);
    }

    function bulkSetStatus(status) {
        const affected = selection.selectedRows;
        if (affected.length === 0) return;

        // Suspending locks an account out, so confirm it like deletes.
        if (status === "Suspended") {
            setPendingSuspend({
                rows: affected,
                label: `${affected.length} selected account${affected.length === 1 ? "" : "s"}`,
            });
            return;
        }

        applyStatusChange(affected, status);
        selection.clear();
    }

    /* ---------- Delete (single + bulk, behind a confirmation) ---------- */

    function requestDelete(row) {
        setPendingDelete({ rows: [row], label: `${row.name} (${row.id})` });
    }

    function requestBulkDelete() {
        const rows = selection.selectedRows;
        setPendingDelete({ rows, label: `${rows.length} selected account${rows.length === 1 ? "" : "s"}` });
    }

    function confirmDelete() {
        const rows = pendingDelete?.rows ?? [];
        const ids = rows.map((r) => r.id);

        setUsers((prev) => prev.filter((u) => !ids.includes(u.id)));
        selection.deselect(ids);
        logActivity({
            category: "User Management",
            action: `Deleted ${ids.length} account${ids.length === 1 ? "" : "s"}`,
            details: rows.map((r) => `${r.name} (${r.id})`).join(", "),
        });
        showToast(`${ids.length} account${ids.length === 1 ? "" : "s"} deleted.`);
        setPendingDelete(null);
    }

    function openEdit(row) {
        setEditingUser({ ...row, password: "" });
        setIsNewUser(false);
    }

    function openAdd() {
        setEditingUser({
            id: nextId(users, "USR", 2001),
            name: "",
            role: "Student",
            email: "",
            course: "BS Information Technology",
            blockNo: "",
            year: "1",
            status: "Pending",
            date: dateKey(),
            password: "",
        });
        setIsNewUser(true);
    }

    async function saveUser() {
        if (!editingUser.name.trim() || !editingUser.email.trim()) {
            showToast("Name and email are required.", "danger");
            return;
        }

        if (isNewUser && (!editingUser.password || editingUser.password.length < 8)) {
            showToast("New accounts need a password of at least 8 characters.", "danger");
            return;
        }

        if (!isNewUser && editingUser.password && editingUser.password.length < 8) {
            showToast("New password must be at least 8 characters.", "danger");
            return;
        }

        const clean = { ...editingUser };
        delete clean.password;

        // Anything carrying a password is written straight to the API and the
        // list is re-read afterwards, rather than going through setUsers.
        //
        // Two reasons. Creating an account requires a password, and stripping it
        // from the row first made every "Add User" fail validation with
        // "The password field is required." And a row that still carried one
        // would re-send it on every later edit - which silently resets that
        // person's password and invalidates their sessions, or is refused
        // outright for anyone who is not an administrator.
        if (isNewUser || editingUser.password) {
            setSavingUser(true);
            try {
                const payload = mapUserToApi({ ...clean, password: editingUser.password });

                if (isNewUser) {
                    await api.create("user-accounts", payload);
                    logActivity({
                        category: "User Management",
                        action: `Created account ${editingUser.id}`,
                        details: `${editingUser.name} · ${editingUser.role}`,
                    });
                    showToast(`${editingUser.name} was added.`);
                } else {
                    await api.update("user-accounts", editingUser.id, payload);
                    logActivity({
                        category: "User Management",
                        action: `Updated account ${editingUser.id}`,
                        details: `${editingUser.name} · ${editingUser.role} · ${editingUser.status}`,
                    });
                    showToast(`${editingUser.name} was updated.`);
                }

                await refreshUsers();
                setEditingUser(null);
            } catch (err) {
                // The optimistic "added" toast used to fire before the POST and
                // be contradicted a moment later by the rollback, so nothing is
                // claimed here until the server has accepted it.
                showToast(err.message, "danger");
            } finally {
                setSavingUser(false);
            }

            return;
        }

        setUsers((prev) => prev.map((u) => (u.id === editingUser.id ? clean : u)));
        logActivity({
            category: "User Management",
            action: `Updated account ${editingUser.id}`,
            details: `${editingUser.name} · ${editingUser.role} · ${editingUser.status}`,
        });
        showToast(`${editingUser.name} was updated.`);
        setEditingUser(null);
    }

    return (
        <AppShell title="User Accounts">
            <div className="kpi-strip">
                <div className="kpi-item">
                    <span className="kpi-label">Total Accounts</span>
                    <span className="kpi-value">{users.length}</span>
                </div>
                <div className="kpi-item">
                    <span className="kpi-label">Active</span>
                    <span className="kpi-value">{users.filter((u) => u.status === "Active").length}</span>
                </div>
                <div className="kpi-item kpi-alert">
                    <span className="kpi-label">Pending Approval</span>
                    <span className="kpi-value">{users.filter((u) => u.status === "Pending").length}</span>
                </div>
                <div className="kpi-item">
                    <span className="kpi-label">Suspended</span>
                    <span className="kpi-value">{users.filter((u) => u.status === "Suspended").length}</span>
                </div>
            </div>

            <section className="panel">
                <div className="panel-header">
                    <h2>All Accounts</h2>
                    <button className="btn btn-primary" onClick={openAdd}>+ Add User</button>
                </div>

                <div className="toolbar">
                    <input
                        type="text"
                        className="input-search"
                        placeholder="Search by name or email"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        aria-label="Search users"
                    />

                    <select
                        className="input-select"
                        value={roleFilter}
                        onChange={(e) => setRoleFilter(e.target.value)}
                        aria-label="Filter by role"
                    >
                        <option value="all">All roles</option>
                        <option value="admin">Admin</option>
                        <option value="staff">Staff</option>
                        <option value="organizer">Organizer</option>
                        <option value="student">Student</option>
                    </select>

                    <select
                        className="input-select"
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        aria-label="Filter by status"
                    >
                        <option value="all">All statuses</option>
                        <option value="active">Active</option>
                        <option value="pending">Pending</option>
                        <option value="suspended">Suspended</option>
                    </select>

                    <select
                        className="input-select"
                        value={courseFilter}
                        onChange={(e) => setCourseFilter(e.target.value)}
                        aria-label="Filter by course"
                    >
                        <option value="all">All courses</option>
                        {COURSES.map((course) => (
                            <option key={course} value={course}>{course}</option>
                        ))}
                    </select>

                    <select
                        className="input-select"
                        value={blockFilter}
                        onChange={(e) => setBlockFilter(e.target.value)}
                        aria-label="Filter by block number"
                    >
                        <option value="all">All blocks</option>
                        {blockOptions.map((block) => (
                            <option key={block} value={block.toLowerCase()}>{block}</option>
                        ))}
                    </select>

                    <select
                        className="input-select"
                        value={yearFilter}
                        onChange={(e) => setYearFilter(e.target.value)}
                        aria-label="Filter by year"
                    >
                        <option value="all">All years</option>
                        {YEARS.map((year) => (
                            <option key={year} value={year}>Year {year}</option>
                        ))}
                    </select>

                    {/* Bulk import creates accounts in bulk with a password the
                        importer chooses, so it is an administrator action only.
                        Export stays available to every role: it reveals nothing
                        beyond the listing already on screen, and carries no
                        password column. */}
                    {user.role === "Admin" && (
                        <button className="btn btn-secondary btn-toolbar" onClick={openImport}>Import CSV</button>
                    )}
                    <button className="btn btn-secondary" onClick={exportCSV}>Export CSV</button>
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
                            <button className="btn btn-secondary" onClick={() => bulkSetStatus("Active")}>Activate</button>
                            <button className="btn btn-secondary btn-danger-outline" onClick={() => bulkSetStatus("Suspended")}>Suspend</button>
                            <button className="btn btn-secondary" onClick={exportSelectedCSV}>Export selected</button>
                            <button className="btn btn-danger" onClick={requestBulkDelete}>Delete</button>
                            <button className="btn-clear" onClick={selection.clear}>Clear</button>
                        </div>
                    </div>
                )}

                <div className="table-wrapper">
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
                                        aria-label="Select all users on this page"
                                    />
                                </th>
                                <th className="th-sortable" onClick={() => toggleSort("name")}>
                                    Name <SortIcon active={sortKey === "name"} dir={sortDir} />
                                </th>
                                <th>Role</th>
                                <th>Email</th>
                                <th>Course</th>
                                <th>Block No.</th>
                                <th>Year</th>
                                <th>Status</th>
                                <th className="th-sortable" onClick={() => toggleSort("date")}>
                                    Date Registered <SortIcon active={sortKey === "date"} dir={sortDir} />
                                </th>
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
                                            aria-label={`Select ${row.name}`}
                                        />
                                    </td>
                                    <td>
                                        <div className="user-cell">
                                            <span className="row-avatar">{initialsOf(row.name)}</span>
                                            <div className="user-cell-text">
                                                <span className="user-cell-name">{row.name}</span>
                                                <span className="user-cell-id">{row.id}</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td><span className={`role-badge role-${row.role.toLowerCase()}`}>{row.role}</span></td>
                                    <td className="cell-muted">{row.email}</td>
                                    <td className="cell-muted">{row.course || "—"}</td>
                                    <td className="cell-muted">{row.blockNo || "—"}</td>
                                    <td className="cell-muted">{row.year ? `Year ${row.year}` : "—"}</td>
                                    <td>
                                        <span className={`status status-${row.status.toLowerCase()}`}>
                                            {row.status}
                                        </span>
                                    </td>
                                    <td className="cell-muted">{row.date}</td>
                                    <td className="cell-actions">
                                        <ActionIcon icon={IconEdit} label="Edit" onClick={() => openEdit(row)} />
                                        <ActionIcon icon={IconPower} label={row.status === "Suspended" ? "Reactivate" : "Suspend"} tone={row.status === "Suspended" ? undefined : "danger"} onClick={() => toggleStatus(row)} />
                                        <ActionIcon icon={IconTrash} label="Delete" tone="danger" onClick={() => requestDelete(row)} />
                                    </td>
                                </tr>
                            ))}
                            {filteredRows.length === 0 && (
                                <tr>
                                    <td colSpan="10" className="empty-row">No accounts match your filters.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                <Pagination
                    {...pager}
                    unit="accounts"
                />
            </section>


            {editingUser && (
                <div className="modal-overlay" onClick={() => setEditingUser(null)}>
                    <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>{isNewUser ? "Add User" : "Edit User"}</h3>
                            <button className="modal-close" onClick={() => setEditingUser(null)} aria-label="Close">×</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label htmlFor="editName">Full name</label>
                                <input
                                    id="editName"
                                    type="text"
                                    value={editingUser.name}
                                    onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })}
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="editEmail">Email</label>
                                <input
                                    id="editEmail"
                                    type="email"
                                    value={editingUser.email}
                                    onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })}
                                />
                            </div>
                            <div className="form-row-split">
                                <div className="form-group">
                                    <label htmlFor="editCourse">Course</label>
                                    <select
                                        id="editCourse"
                                        value={editingUser.course || ""}
                                        onChange={(e) => setEditingUser({ ...editingUser, course: e.target.value })}
                                    >
                                        <option value="">Select course...</option>
                                        {COURSES.map((c) => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label htmlFor="editYear">Year</label>
                                    <select
                                        id="editYear"
                                        value={editingUser.year || ""}
                                        onChange={(e) => setEditingUser({ ...editingUser, year: e.target.value })}
                                    >
                                        <option value="">Select year...</option>
                                        {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div className="form-group">
                                <label htmlFor="editBlockNo">Block No.</label>
                                <input
                                    id="editBlockNo"
                                    type="text"
                                    placeholder=""
                                    value={editingUser.blockNo || ""}
                                    onChange={(e) => setEditingUser({ ...editingUser, blockNo: e.target.value })}
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="editPassword">
                                    {isNewUser ? "Password" : "Reset password (leave blank to keep current)"}
                                </label>
                                <input
                                    id="editPassword"
                                    type="password"
                                    autoComplete="new-password"
                                    value={editingUser.password}
                                    onChange={(e) => setEditingUser({ ...editingUser, password: e.target.value })}
                                />
                            </div>
                            <div className="form-row-split">
                                <div className="form-group">
                                    <label htmlFor="editRole">Role</label>
                                    <select
                                        id="editRole"
                                        value={editingUser.role}
                                        onChange={(e) => setEditingUser({ ...editingUser, role: e.target.value })}
                                    >
                                        {user.role === "Admin" && <option>Admin</option>}
                                        <option>Staff</option>
                                        <option>Organizer</option>
                                        <option>Student</option>
                                    </select>
                                </div>
                                {!isNewUser && (
                                    <div className="form-group">
                                        <label htmlFor="editStatus">Status</label>
                                        <select
                                            id="editStatus"
                                            value={editingUser.status}
                                            onChange={(e) => setEditingUser({ ...editingUser, status: e.target.value })}
                                        >
                                            <option>Active</option>
                                            <option>Pending</option>
                                            <option>Suspended</option>
                                        </select>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setEditingUser(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={saveUser} disabled={savingUser}>
                    {savingUser ? "Saving…" : isNewUser ? "Add User" : "Save Changes"}
                </button>
                        </div>
                    </div>
                </div>
            )}

            <ConfirmDialog
                open={Boolean(pendingDelete)}
                title="Delete account"
                message={pendingDelete ? `Permanently delete ${pendingDelete.label}? This cannot be undone.` : ""}
                confirmLabel="Delete"
                onConfirm={confirmDelete}
                onCancel={() => setPendingDelete(null)}
            />

            <ConfirmDialog
                open={Boolean(pendingSuspend)}
                title="Suspend account"
                message={pendingSuspend ? `Suspend ${pendingSuspend.label}? They will not be able to sign in until reactivated.` : ""}
                confirmLabel="Suspend"
                onConfirm={confirmSuspend}
                onCancel={() => setPendingSuspend(null)}
            />

            {importOpen && user.role === "Admin" && (
                <div className="modal-overlay" onClick={() => !importBusy && setImportOpen(false)}>
                    <div className="modal-card" onClick={(event) => event.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Import Users from CSV</h3>
                            <button
                                className="modal-close"
                                onClick={() => setImportOpen(false)}
                                aria-label="Close"
                                disabled={importBusy}
                            >
                                {"\u00d7"}
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>CSV file</label>
                                <div className="import-file-row">
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={() => importInputRef.current?.click()}
                                        disabled={importBusy}
                                    >
                                        Choose file
                                    </button>
                                    <span className="import-filename">
                                        {importFile ? importFile.name : "No file chosen"}
                                    </span>
                                </div>
                                <input
                                    ref={importInputRef}
                                    type="file"
                                    accept=".csv,text/csv"
                                    hidden
                                    onChange={(event) => {
                                        setImportFile(event.target.files?.[0] ?? null);
                                        setImportReport(null);
                                    }}
                                />
                                <p className="field-help">
                                    Name and Email are required. ID, Role, Course, Block No., Year, Status,
                                    Date Registered and Password are optional; anything the file leaves out
                                    falls back to the defaults on this page. Download the template for the
                                    exact layout.
                                </p>
                            </div>

                            <div className="form-group">
                                <label htmlFor="importPassword">Default password</label>
                                <input
                                    id="importPassword"
                                    type="text"
                                    autoComplete="off"
                                    placeholder="Used for rows with no Password column"
                                    value={importPassword}
                                    onChange={(event) => setImportPassword(event.target.value)}
                                    disabled={importBusy}
                                />
                                <p className="field-help">
                                    At least {IMPORT_PASSWORD_MIN} characters. Imported accounts are created
                                    as Pending unless the file says otherwise, so nobody can sign in until an
                                    administrator activates them.
                                </p>
                            </div>

                            {importReport && (
                                <div className="import-report">
                                    <strong>{importReport.imported.length} imported</strong>
                                    {importReport.skipped.length > 0 && (
                                        <>
                                            <span className="import-report-skipped">
                                                {" - "}
                                                {importReport.skipped.length} skipped
                                            </span>
                                            <ul>
                                                {importReport.skipped.map((row) => (
                                                    <li key={`${row.line}-${row.name}`}>
                                                        Line {row.line} - {row.name}: {row.reason}
                                                    </li>
                                                ))}
                                            </ul>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={downloadImportTemplate}
                                disabled={importBusy}
                            >
                                Download template
                            </button>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => setImportOpen(false)}
                                disabled={importBusy}
                            >
                                Close
                            </button>
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={runImport}
                                disabled={importBusy || !importFile}
                            >
                                {importBusy ? "Importing..." : "Import"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={dismissToast} />}

        </AppShell>
    );
}

function SortIcon({ active, dir }) {
    return (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className={`sort-icon ${active ? "active" : ""} ${active && dir === "desc" ? "flipped" : ""}`}>
            <path d="M5 1.5v7M2 5.5 5 8.5 8 5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

export default Users;