import { Navigate, useLocation } from "react-router-dom";
import { getToken } from "../lib/api";
import { useAuth } from "../lib/auth";
import { rolesForPath } from "../lib/nav";

/**
 * Role checks mirror the API's read permissions. A valid session may use only
 * the screens listed for its role in the shared navigation map.
 */
function RequireAuth({ children }) {
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

    if (!user) {
        return <Navigate to="/login" replace state={{ from: location.pathname }} />;
    }

    const allowedRoles = rolesForPath(location.pathname);
    if (allowedRoles && !allowedRoles.includes(user.role)) {
        const home = user.role === "Student" ? "/dashboard" : user.role === "Scanner" ? "/check-in" : "/dashboard";
        return <Navigate to={home} replace />;
    }

    return children;
}

export default RequireAuth;
