/**
 * Single source of truth for admin navigation + route access.
 * ---------------------------------------------------------------------------
 * The Laravel backend enforces per-resource roles in EnsureRole (read/write
 * matrix). These lists mirror its *read* side, so the sidebar never offers a
 * page the API would reject, and RequireAuth enforces the same list on
 * direct-URL visits. Admin always has full access (same as the middleware).
 *
 * Keep the `to` values in sync with the <Route> paths in App.jsx.
 */
export const NAV_ITEMS = [
    { to: "/dashboard", label: "Dashboard", roles: ["Admin", "Staff", "Organizer"] },
    { to: "/users", label: "User Accounts", roles: ["Admin", "Staff", "Organizer"] },
    { to: "/events", label: "Events", roles: ["Admin", "Staff", "Organizer", "Student"] },
    { to: "/scanner-permissions", label: "Scanner Permissions", roles: ["Admin"] },
    { to: "/attendance-reports", label: "Attendance Reports", roles: ["Admin"] },
    { to: "/registrations", label: "Registrations", roles: ["Admin", "Staff", "Organizer"] },
    { to: "/check-in", label: "Check-In", roles: ["Admin", "Scanner"] },
    { to: "/certificates", label: "Certificates", roles: ["Admin", "Staff", "Organizer", "Student"] },
    { to: "/evaluations", label: "Evaluations", roles: ["Admin"] },
    { to: "/announcements", label: "Announcements", roles: ["Admin", "Staff", "Organizer", "Student"] },
    { to: "/activity-logs", label: "Activity Logs", roles: ["Admin", "Staff"] },
    { to: "/reports", label: "Reports", roles: ["Admin", "Staff", "Organizer"] },
    { to: "/settings", label: "Settings", roles: ["Admin", "Staff"] },
];

/** Roles allowed to visit a path. `null` = any authenticated account. */
export function rolesForPath(pathname) {
    const item = NAV_ITEMS.find((entry) => entry.to === pathname);
    return item ? (item.roles ?? null) : null;
}

/** Nav entries visible to a role. Admin sees everything. */
export function visibleNavItems(role) {
    if (!role || role === "Admin") return NAV_ITEMS;
    return NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(role));
}
