import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi, clearSession, getSessionUser, getToken, setSession } from "./api";

const AuthContext = createContext(null);

export function initialsOf(name = "") {
    return (
        String(name ?? "")
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((word) => word[0].toUpperCase())
            .join("") || "US"
    );
}

export function roleLabel(role) {
    const labels = {
        Admin: "Administrator",
        Staff: "Staff Member",
        Organizer: "Event Organizer",
        Student: "Student",
    };
    return labels[role] || role;
}

/**
 * Reactive auth state for the whole SPA.
 * ---------------------------------------------------------------------------
 * The old useUser() helper returned a static snapshot read once from
 * sessionStorage, so a role change (or a token that died server-side) never
 * propagated. This provider holds the current user in state, revalidates it
 * against GET auth/me on boot, and every consumer re-renders on change.
 */
export function AuthProvider({ children }) {
    const navigate = useNavigate();
    const [user, setUser] = useState(() => getSessionUser());
    const [ready, setReady] = useState(false);

    useEffect(() => {
        let active = true;

        // No token at all: nothing to revalidate, render immediately.
        if (!getToken()) {
            setReady(true);
            return () => { active = false; };
        }

        authApi.me()
            .then((me) => {
                if (!active) return;
                const next = me?.user ?? me ?? null;
                setUser(next);
                setSession(null, next);
            })
            .catch(() => {
                // Invalid/expired token (or suspended account): request() has
                // already cleared the session and redirected to /login.
                if (active) setUser(null);
            })
            .finally(() => {
                if (active) setReady(true);
            });

        return () => { active = false; };
    }, []);

    const logout = useCallback(() => {
        authApi.logout().catch(() => {});
        clearSession();
        setUser(null);
        navigate("/login");
    }, [navigate]);

    const value = useMemo(() => ({ user, setUser, logout, ready }), [user, logout, ready]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
    return ctx;
}

/** Backwards-compatible snapshot for pages not yet converted to useAuth(). */
export function useUser() {
    return useAuth().user || { name: "", role: "" };
}

export function useLogout() {
    return useAuth().logout;
}
