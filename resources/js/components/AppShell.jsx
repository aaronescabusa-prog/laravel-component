import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import logo from "../assets/Tmc_Logo.png";
import { initialsOf, roleLabel, useAuth } from "../lib/auth";
import { NAV_ITEMS, visibleNavItems } from "../lib/nav";

/**
 * Shared admin shell: sidebar + topbar + mobile backdrop.
 * ---------------------------------------------------------------------------
 * Every admin screen used to re-implement this (~100 lines each, with drift:
 * hardcoded "Admin" subtitles, unfiltered nav). Pages now render only their
 * content inside <AppShell title="...">.
 *
 * `prefix` selects the page's own class namespace so existing per-page CSS
 * keeps matching ("" for Dashboard/Users, "regs-" for check-in, "events-",
 * "eval-", ...). The mobile toggle/backdrop classes stay generic because
 * ui.css only styles the unprefixed .nav-toggle/.nav-backdrop/.topbar-lead.
 */
function AppShell({ title, subtitle = null, prefix = "", headerActions = null, children }) {
    const { user, logout } = useAuth();
    const [navOpen, setNavOpen] = useState(false);
    const closeNav = () => setNavOpen(false);
    const items = visibleNavItems(user?.role);

    useEffect(() => {
        if (!navOpen) return undefined;

        const closeOnEscape = (event) => {
            if (event.key === "Escape") closeNav();
        };

        document.addEventListener("keydown", closeOnEscape);
        return () => document.removeEventListener("keydown", closeOnEscape);
    }, [navOpen]);

    const shellClass = prefix ? `${prefix}shell` : "app-shell";
    const sidebarClass = prefix ? `${prefix}sidebar` : "sidebar";
    const avatarClass = prefix ? `${prefix}avatar` : "user-avatar";
    // Dashboard/Users use .user-text/.user-name/.user-role; every prefixed
    // page uses .{prefix}topbar-text/-name/-role (see ui.css avatar group).
    const textClass = prefix ? `${prefix}topbar-text` : "user-text";
    const nameClass = prefix ? `${prefix}topbar-name` : "user-name";
    const roleClass = prefix ? `${prefix}topbar-role` : "user-role";

    return (
        <div className={`${shellClass}${navOpen ? " nav-open" : ""}`}>
            <aside className={sidebarClass} id="primary-navigation" aria-label="Primary navigation">
                <div className={`${sidebarClass}-brand`}>
                    <img src={logo} alt="TMC Logo" className={`${sidebarClass}-logo`} />
                    <div className={`${sidebarClass}-brand-text`}>
                        <span className={`${sidebarClass}-title`}>TMC EventEase</span>
                        <span className={`${sidebarClass}-subtitle`}>{roleLabel(user?.role)}</span>
                    </div>
                </div>

                <nav className={`${sidebarClass}-nav`}>
                    {items.map((item) => (
                        <NavLink
                            key={item.to}
                            to={item.to}
                            end={item.to === "/check-in"}
                            className={({ isActive }) =>
                                `${sidebarClass}-link${isActive ? " active" : ""}`
                            }
                            onClick={closeNav}
                        >
                            {item.icon ? <item.icon className="sidebar-link-icon" size={17} /> : null}
                            {item.label}
                        </NavLink>
                    ))}
                </nav>

                <div className={`${sidebarClass}-footer`}>
                    <button
                        className={`${sidebarClass}-logout`}
                        onClick={logout}
                    >
                        Log out
                    </button>
                </div>
            </aside>

            <button
                type="button"
                className="nav-backdrop"
                aria-label="Close navigation menu"
                tabIndex={navOpen ? 0 : -1}
                onClick={closeNav}
            />

            <div className={prefix ? `${prefix}main-column` : "main-column"}>
                <header className={prefix ? `${prefix}topbar` : "topbar"}>
                    <div className="topbar-lead">
                        <button
                            type="button"
                            className="nav-toggle"
                            onClick={() => setNavOpen((open) => !open)}
                            aria-label={navOpen ? "Close navigation menu" : "Open navigation menu"}
                            aria-controls="primary-navigation"
                            aria-expanded={navOpen}
                        >
                            <span className="nav-toggle-bar" />
                            <span className="nav-toggle-bar" />
                            <span className="nav-toggle-bar" />
                        </button>

                        <div>
                            <h1 className={prefix ? `${prefix}page-title` : "page-title"}>{title}</h1>
                            {subtitle ? <p className="checkin-page-subtitle">{subtitle}</p> : null}
                        </div>
                    </div>

                    {headerActions}

                    <div className={prefix ? `${prefix}topbar-user` : "topbar-user"}>
                        <div className={avatarClass} aria-label={user?.name || "Account"} title={user?.name || "Account"}>
                            {initialsOf(user?.name)}
                        </div>
                        <div className={textClass}>
                            <span className={nameClass}>{user?.name}</span>
                            <span className={roleClass}>{roleLabel(user?.role)}</span>
                        </div>
                    </div>
                </header>

                <main className={prefix ? `${prefix}page-content` : "page-content"}>
                    {children}
                </main>
            </div>
        </div>
    );
}

export default AppShell;
