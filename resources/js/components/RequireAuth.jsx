import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { clearSession, getToken } from "../lib/api";
import { useAuth } from "../lib/auth";

/**
 * The web SPA is the administrator back office; user and scanner accounts
 * authenticate through the separate mobile-facing API, not this application.
 */
function RequireAuth({ children }) {
    const location = useLocation();
    const { user, ready, setUser } = useAuth();
    const isAdmin = user?.role === "Admin";

    useEffect(() => {
        if (ready && getToken() && user && !isAdmin) {
            clearSession();
            setUser(null);
        }
    }, [ready, user, isAdmin, setUser]);

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

    if (!user || !isAdmin) {
        return <Navigate to="/login" replace state={{ from: location.pathname }} />;
    }

    return children;
}

export default RequireAuth;