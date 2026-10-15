import { useNavigate } from "react-router-dom";
import { authApi, clearSession, getSessionUser } from "./api";

export function useUser() {
    return getSessionUser() || { name: "", role: "" };
}

export function initialsOf(name = "") {
    return (
        name
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
        Student: "Student",
        Scanner: "Scanner",
    };
    return labels[role] || role;
}

export function useLogout() {
    const navigate = useNavigate();

    return () => {
        authApi.logout().catch(() => {});
        clearSession();
        navigate("/login");
    };
}
