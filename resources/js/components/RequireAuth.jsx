import { Navigate, useLocation } from "react-router-dom";
import { getToken } from "../lib/api";
import { useAuth } from "../lib/auth";
import { rolesForPath } from "../lib/nav";

/**
 * Route guard backed by the same role map as the sidebar (AppShell).
 * `roles` prop still wins for one-off overrides; otherwise the shared
 * rolesForPath() decides, so nav and guards can never disagree again.
 */
function RequireAuth({ children, roles }) {
    const location = useLocation();
    const { user, ready } = useAuth();

    if (!ready) {
        return (
            <div className="app-shell">
                <main className="page-content">
                    <p className="data-timestamp">Loading…</p>
                </main>
            </div>
        );
    }

    if (!getToken()) {
        return <Navigate to="/login" replace state={{ from: location.pathname }} />;
    }

    const required = roles ?? rolesForPath(location.pathname) ?? null;
    if (required && (!user || !required.includes(user.role))) {
        return <Navigate to="/dashboard" replace />;
    }

    return children;
}

export default RequireAuth;