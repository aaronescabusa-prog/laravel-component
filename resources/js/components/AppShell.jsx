import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import logo from "../assets/Tmc_Logo.png";
import { initialsOf, roleLabel, useAuth } from "../lib/auth";
import { IconPower } from "./Icons";
import { visibleNavItems } from "../lib/nav";

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
    const [sidebarCollapsed, setSidebarCollapsed] = useState(
        () => localStorage.getItem("eventease-sidebar-collapsed") === "true"
    );
    const [darkTheme, setDarkTheme] = useState(
        () => localStorage.getItem("eventease-theme") === "dark"
    );
    const menuToggleRef = useRef(null);
    const closeNav = () => setNavOpen(false);
    const items = visibleNavItems(user?.role);
    const isStudent = user?.role === "Student";

    useEffect(() => {
        localStorage.setItem("eventease-sidebar-collapsed", String(sidebarCollapsed));
    }, [sidebarCollapsed]);

    useLayoutEffect(() => {
        document.documentElement.dataset.theme = darkTheme ? "dark" : "light";
        localStorage.setItem("eventease-theme", darkTheme ? "dark" : "light");
    }, [darkTheme]);

    useEffect(() => {
        if (!navOpen) return undefined;

        const container = document.getElementById(isStudent ? "student-navigation" : "primary-navigation");
        const focusableSelector = 'a[href], button:not(:disabled), [tabindex]:not([tabindex="-1"])';
        const getFocusable = () => [...(container?.querySelectorAll(focusableSelector) ?? [])]
            .filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
        const focusFrame = requestAnimationFrame(() => getFocusable()[0]?.focus());

        const onNavigationKeyDown = (event) => {
            if (event.key === "Escape") {
                setNavOpen(false);
                return;
            }

            if (event.key !== "Tab") return;
            const focusable = getFocusable();
            if (!focusable.length) return;

            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener("keydown", onNavigationKeyDown);
        return () => {
            cancelAnimationFrame(focusFrame);
            document.removeEventListener("keydown", onNavigationKeyDown);
            if (menuToggleRef.current?.isConnected) menuToggleRef.current.focus();
        };
    }, [navOpen, isStudent]);

    const shellClass = prefix ? `${prefix}shell` : "app-shell";
    const sidebarClass = prefix ? `${prefix}sidebar` : "sidebar";
    const avatarClass = prefix ? `${prefix}avatar` : "user-avatar";
    // Dashboard/Users use .user-text/.user-name/.user-role; every prefixed
    // page uses .{prefix}topbar-text/-name/-role (see ui.css avatar group).
    const textClass = prefix ? `${prefix}topbar-text` : "user-text";
    const nameClass = prefix ? `${prefix}topbar-name` : "user-name";
    const roleClass = prefix ? `${prefix}topbar-role` : "user-role";

    if (isStudent) {
        const studentNavigation = (className) => (
            <nav className={className} aria-label="Student navigation">
                {items.map((item) => (
                    <NavLink
                        key={item.to}
                        to={item.to}
                        className={({ isActive }) => `student-nav-link${isActive ? " active" : ""}`}
                        onClick={closeNav}
                    >
                        {item.to === "/dashboard" ? "Home" : item.label}
                    </NavLink>
                ))}
            </nav>
        );

        return (
            <div className={`student-app-shell${navOpen ? " nav-open" : ""}`}>
                <a className="skip-link" href="#main-content">Skip to main content</a>
                <header className="student-app-header">
                    <div className="student-app-header-inner">
                        <NavLink to="/dashboard" className="student-app-brand" onClick={closeNav}>
                            <img src={logo} alt="" />
                            <span><strong>TMC EventEase</strong><small>Student events</small></span>
                        </NavLink>

                        {studentNavigation("student-app-nav")}

                        <div className="student-app-account">
                            <NavLink to="/profile" className="student-account-link" onClick={closeNav}>
                                <span className="student-account-avatar">{initialsOf(user?.name)}</span>
                                <span className="student-account-name">{user?.name || "My profile"}</span>
                            </NavLink>
                            <button type="button" className="student-signout" onClick={logout}>Sign out</button>
                            <button
                                type="button"
                                className="student-menu-toggle"
                                ref={menuToggleRef}
                                onClick={() => setNavOpen((open) => !open)}
                                aria-label={navOpen ? "Close navigation menu" : "Open navigation menu"}
                                aria-controls="student-navigation"
                                aria-expanded={navOpen}
                            >
                                <span /><span /><span />
                            </button>
                        </div>
                    </div>
                    <div id="student-navigation" hidden={!navOpen}>
                            {studentNavigation("student-mobile-nav")}
                            <button type="button" className="student-mobile-signout" onClick={() => { closeNav(); logout(); }}>
                                Sign out
                            </button>
                    </div>
                </header>
                <main className="student-app-main" id="main-content" tabIndex={-1}>
                    {title !== "Welcome to EventEase" && title !== "Explore Events" && (
                        <div className="student-page-heading">
                            <span>STUDENT PORTAL</span>
                            <h1>{title}</h1>
                            {subtitle && <p>{subtitle}</p>}
                        </div>
                    )}
                    {children}
                </main>
            </div>
        );
    }

    return (
        <div className={`${shellClass}${navOpen ? " nav-open" : ""}${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
            <a className="skip-link" href="#main-content">Skip to main content</a>
            <aside className={sidebarClass} id="primary-navigation" aria-label="Primary navigation">
                <div className={`${sidebarClass}-brand`}>
                    <img src={logo} alt="TMC Logo" className={`${sidebarClass}-logo`} />
                    <div className={`${sidebarClass}-brand-text`}>
                        <span className={`${sidebarClass}-title`}>TMC EventEase</span>
                        <span className={`${sidebarClass}-subtitle`}>{roleLabel(user?.role)}</span>
                    </div>
                    <button
                        type="button"
                        className="sidebar-collapse-toggle"
                        onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
                        aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                        aria-expanded={!sidebarCollapsed}
                        aria-controls="primary-navigation"
                        title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                    >
                        <svg className="sidebar-collapse-icon" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="m15 18-6-6 6-6" />
                        </svg>
                    </button>
                </div>

                <nav className={`${sidebarClass}-nav`}>
                    {items.map((item) => (
                        <NavLink
                            key={item.to}
                            to={item.to}
                            className={({ isActive }) =>
                                `${sidebarClass}-link${isActive ? " active" : ""}`
                            }
                            onClick={closeNav}
                            aria-label={item.label}
                            title={sidebarCollapsed ? item.label : undefined}
                        >
                            {item.icon ? <item.icon className="sidebar-link-icon" size={17} /> : null}
                            <span className="sidebar-link-label">{item.label}</span>
                        </NavLink>
                    ))}
                </nav>

                <div className={`${sidebarClass}-footer`}>
                    <button
                        className={`${sidebarClass}-logout`}
                        onClick={logout}
                        aria-label="Log out"
                        title={sidebarCollapsed ? "Log out" : undefined}
                    >
                        <IconPower size={17} />
                        <span className="sidebar-logout-label">Log out</span>
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
                            ref={menuToggleRef}
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

                <main className={prefix ? `${prefix}page-content` : "page-content"} id="main-content" tabIndex={-1}>
                    {children}
                </main>
            </div>
        </div>
    );
}

export default AppShell;
