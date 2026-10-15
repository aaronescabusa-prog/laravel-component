import {
    IconAward,
    IconCalendar,
    IconChart,
    IconClipboard,
    IconDashboard,
    IconList,
    IconMegaphone,
    IconReport,
    IconSettings,
    IconShield,
    IconStar,
    IconUsers,
} from "../components/Icons";

/**
 * Single source of truth for role navigation + route access.
 * ---------------------------------------------------------------------------
 * The Laravel backend enforces per-resource roles in EnsureRole (read/write
 * matrix). These lists mirror its *read* side, so the sidebar never offers a
 * page the API would reject, and RequireAuth enforces the same list on
 * direct-URL visits. Admin always has full access (same as the middleware).
 *
 * Keep the `to` values in sync with the <Route> paths in App.jsx.
 */
export const NAV_ITEMS = [
    { to: "/dashboard", label: "Dashboard", icon: IconDashboard, roles: ["Admin", "Student"] },
    { to: "/users", label: "User Accounts", icon: IconUsers, roles: ["Admin"] },
    { to: "/events", label: "Events", icon: IconCalendar, roles: ["Admin", "Student"] },
    { to: "/my-events", label: "My Events", icon: IconClipboard, roles: ["Student"] },
    { to: "/scanner-permissions", label: "Scanner Permissions", icon: IconShield, roles: ["Admin"] },
    { to: "/registrations", label: "Registrations", icon: IconClipboard, roles: ["Admin"] },
    { to: "/attendance", label: "Attendance", icon: IconReport, roles: ["Admin", "Scanner"] },
    { to: "/certificates", label: "Certificates", icon: IconAward, roles: ["Admin", "Student"] },
    { to: "/evaluations", label: "Evaluations", icon: IconStar, roles: ["Admin"] },
    { to: "/announcements", label: "Announcements", icon: IconMegaphone, roles: ["Admin", "Student"] },
    { to: "/profile", label: "My Profile", icon: IconUsers, roles: ["Student"] },
    { to: "/activity-logs", label: "Activity Logs", icon: IconList, roles: ["Admin"] },
    { to: "/reports", label: "Reports", icon: IconChart, roles: ["Admin"] },
    { to: "/settings", label: "Settings", icon: IconSettings, roles: ["Admin"] },
];

/** Roles allowed to visit a path. `null` = any authenticated account. */
export function rolesForPath(pathname) {
    const path = pathname === "/check-in" || pathname.startsWith("/check-in/") || pathname === "/attendance-reports"
        ? "/attendance"
        : pathname;
    const item = NAV_ITEMS.find((entry) => (
        entry.to === path || (entry.to === "/attendance" && path.startsWith("/attendance/"))
    ));
    return item ? (item.roles ?? null) : null;
}

/** Nav entries visible to a role. Admin sees everything. */
export function visibleNavItems(role) {
    if (!role) return NAV_ITEMS;
    return NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(role));
}

