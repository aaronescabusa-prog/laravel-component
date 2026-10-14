import {
    IconAward,
    IconCalendar,
    IconChart,
    IconClipboard,
    IconDashboard,
    IconList,
    IconMegaphone,
    IconReport,
    IconScanner,
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
    { to: "/dashboard", label: "Dashboard", icon: IconDashboard, roles: ["Admin", "Staff", "Organizer", "Student"] },
    { to: "/users", label: "User Accounts", icon: IconUsers, roles: ["Admin", "Staff", "Organizer"] },
    { to: "/events", label: "Events", icon: IconCalendar, roles: ["Admin", "Staff", "Organizer", "Student"] },
    { to: "/my-events", label: "My Events", icon: IconClipboard, roles: ["Student"] },
    { to: "/scanner-permissions", label: "Scanner Permissions", icon: IconShield, roles: ["Admin"] },
    { to: "/attendance-reports", label: "Attendance Reports", icon: IconReport, roles: ["Admin"] },
    { to: "/registrations", label: "Registrations", icon: IconClipboard, roles: ["Admin", "Staff", "Organizer"] },
    { to: "/check-in", label: "Check-In", icon: IconScanner, roles: ["Admin", "Scanner"] },
    { to: "/certificates", label: "Certificates", icon: IconAward, roles: ["Admin", "Staff", "Organizer", "Student"] },
    { to: "/evaluations", label: "Evaluations", icon: IconStar, roles: ["Admin"] },
    { to: "/announcements", label: "Announcements", icon: IconMegaphone, roles: ["Admin", "Staff", "Organizer", "Student"] },
    { to: "/profile", label: "My Profile", icon: IconUsers, roles: ["Student"] },
    { to: "/activity-logs", label: "Activity Logs", icon: IconList, roles: ["Admin", "Staff"] },
    { to: "/reports", label: "Reports", icon: IconChart, roles: ["Admin", "Staff", "Organizer"] },
    { to: "/settings", label: "Settings", icon: IconSettings, roles: ["Admin", "Staff"] },
];

/** Roles allowed to visit a path. `null` = any authenticated account. */
export function rolesForPath(pathname) {
    const item = NAV_ITEMS.find((entry) => entry.to === pathname || (entry.to === "/check-in" && pathname.startsWith("/check-in/")));
    return item ? (item.roles ?? null) : null;
}

/** Nav entries visible to a role. Admin sees everything. */
export function visibleNavItems(role) {
    if (!role) return NAV_ITEMS;
    return NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(role));
}

