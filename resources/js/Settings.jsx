import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./Settings.css";
import logo from "./assets/Tmc_Logo.png";
import AppShell from "./components/AppShell";
import { settingsApi } from "./lib/api";

const TABS = [
    { key: "general", label: "General" },
    { key: "notifications", label: "Notifications" },
    { key: "security", label: "Security" },
    { key: "roles", label: "Roles & Permissions" },
];

const ROLE_PERMISSIONS = [
    { role: "Admin", manageUsers: true, manageEvents: true, approveEvents: true, viewReports: true, manageSettings: true },
    { role: "Student", manageUsers: false, manageEvents: false, approveEvents: false, viewReports: false, manageSettings: false },
    { role: "Scanner", manageUsers: false, manageEvents: false, approveEvents: false, viewReports: false, manageSettings: false },
];

const PERMISSION_FIELDS = [
    { key: "manageUsers", api: "manage_users", label: "Manage Users" },
    { key: "manageEvents", api: "manage_events", label: "Manage Events" },
    { key: "approveEvents", api: "approve_events", label: "Approve Events" },
    { key: "viewReports", api: "view_reports", label: "View Reports" },
    { key: "manageSettings", api: "manage_settings", label: "Manage Settings" },
];

const DEFAULT_GENERAL = {
    systemName: "EventEase",
    institution: "Trinidad Municipal College",
    contactEmail: "eventease@tmc.edu.ph",
    timezone: "Asia/Manila (GMT+8)",
};

const DEFAULT_NOTIFICATIONS = {
    newRegistration: true,
    pendingApproval: true,
    eventReminders: true,
    paymentReceived: false,
    weeklyDigest: true,
};

function apiPermissions(rows) {
    if (!rows) return null;
    return rows.map((row) => {
        const out = { role: row.role };
        for (const field of PERMISSION_FIELDS) out[field.key] = Boolean(row[field.api]);
        return out;
    });
}

function Settings() {
    const [activeTab, setActiveTab] = useState("general");
    const [saved, setSaved] = useState(false);
    const [saving, setSaving] = useState(false);
    const [settingsError, setSettingsError] = useState("");
    const [settingsLoadError, setSettingsLoadError] = useState("");
    const [settingsLoading, setSettingsLoading] = useState(true);
    const [settingsReload, setSettingsReload] = useState(0);

    const [general, setGeneral] = useState(DEFAULT_GENERAL);
    const [notifications, setNotifications] = useState(DEFAULT_NOTIFICATIONS);
    const [security, setSecurity] = useState({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
        twoFactor: false,
        sessionTimeout: "30",
    });

    const [permissions, setPermissions] = useState(ROLE_PERMISSIONS);
    const [passwordError, setPasswordError] = useState("");
    const [logoUrl, setLogoUrl] = useState(logo);
    const [darkTheme, setDarkTheme] = useState(
        () => localStorage.getItem("eventease-theme") === "dark"
    );
    const fileInputRef = useRef(null);

    useLayoutEffect(() => {
        document.documentElement.dataset.theme = darkTheme ? "dark" : "light";
        localStorage.setItem("eventease-theme", darkTheme ? "dark" : "light");
    }, [darkTheme]);

    useEffect(() => {
        let active = true;
        setSettingsLoading(true);
        setSettingsLoadError("");
        settingsApi.get()
            .then((cfg) => {
                if (!active || !cfg) return;

                if (cfg.general) {
                    setGeneral({
                        systemName: cfg.general.system_name ?? DEFAULT_GENERAL.systemName,
                        institution: cfg.general.institution ?? DEFAULT_GENERAL.institution,
                        contactEmail: cfg.general.contact_email ?? DEFAULT_GENERAL.contactEmail,
                        timezone: cfg.general.timezone ?? DEFAULT_GENERAL.timezone,
                    });
                }

                if (cfg.notifications) {
                    setNotifications({
                        newRegistration: cfg.notifications.new_registration ?? true,
                        pendingApproval: cfg.notifications.pending_approval ?? true,
                        eventReminders: cfg.notifications.event_reminders ?? true,
                        paymentReceived: cfg.notifications.payment_received ?? false,
                        weeklyDigest: cfg.notifications.weekly_digest ?? true,
                    });
                }

                if (cfg.security) {
                    setSecurity((prev) => ({
                        ...prev,
                        twoFactor: Boolean(cfg.security.two_factor),
                        sessionTimeout: cfg.security.session_timeout ?? "30",
                    }));
                }

                const rows = apiPermissions(cfg.roles_permissions);
                if (rows) setPermissions(rows);

                if (cfg.logo_url) setLogoUrl(cfg.logo_url);
            })
            .catch((err) => {
                if (active) setSettingsLoadError(err.message || "Settings could not be loaded.");
            })
            .finally(() => { if (active) setSettingsLoading(false); });
        return () => { active = false; };
    }, [settingsReload]);

    function showSaved() {
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
    }

    async function persist(payload) {
        setSaving(true);
        setSettingsError("");
        try {
            await settingsApi.update(payload);
            showSaved();
        } catch (err) {
            setSettingsError(err.message);
        } finally {
            setSaving(false);
        }
    }

    async function handleGeneralSave(e) {
        e.preventDefault();
        await persist({
            general: {
                system_name: general.systemName,
                institution: general.institution,
                contact_email: general.contactEmail,
                timezone: general.timezone,
            },
        });
    }

    function toggleNotification(key) {
        setNotifications((prev) => ({ ...prev, [key]: !prev[key] }));
    }

    async function handleNotificationsSave() {
        await persist({ notifications: { ...notifications } });
    }

    async function handlePasswordSave(e) {
        e.preventDefault();

        if (!security.currentPassword || !security.newPassword || !security.confirmPassword) {
            setPasswordError("Please fill in all password fields.");
            return;
        }

        if (security.newPassword !== security.confirmPassword) {
            setPasswordError("New password and confirmation do not match.");
            return;
        }

        setPasswordError("");
        setSaving(true);
        setSettingsError("");
        try {
            await settingsApi.changePassword({
                current_password: security.currentPassword,
                new_password: security.newPassword,
                new_password_confirmation: security.confirmPassword,
            });
            setSecurity((prev) => ({ ...prev, currentPassword: "", newPassword: "", confirmPassword: "" }));
            showSaved("Password updated successfully.");
        } catch (err) {
            setPasswordError(err.message);
        } finally {
            setSaving(false);
        }
    }

    async function handleSecuritySave() {
        await persist({ security: { two_factor: security.twoFactor, session_timeout: security.sessionTimeout } });
    }

    function togglePermission(roleIndex, key) {
        if (permissions[roleIndex].role === "Admin") return;
        setPermissions((prev) => prev.map((p, i) => i === roleIndex ? { ...p, [key]: !p[key] } : p));
    }

    async function handlePermissionsSave() {
        await persist({
            roles_permissions: permissions.map((row) => {
                const out = { role: row.role };
                for (const field of PERMISSION_FIELDS) out[field.api] = Boolean(row[field.key]);
                return out;
            }),
        });
    }

    async function handleLogoChange(e) {
        const file = e.target.files?.[0];
        if (!file) return;

        setSaving(true);
        setSettingsError("");
        try {
            const result = await settingsApi.uploadLogo(file);
            if (result?.logo_url) setLogoUrl(result.logo_url);
            showSaved("Logo updated successfully.");
        } catch (err) {
            setSettingsError(err.message);
        } finally {
            setSaving(false);
            e.target.value = "";
        }
    }

    return (
        <AppShell title="Settings" prefix="settings-" logoSrc={logoUrl}>

            {saved && !settingsError && <div className="settings-toast">Changes saved successfully.</div>}
            {settingsError && <div className="settings-error" role="alert">{settingsError}</div>}
            {settingsLoadError && <div className="settings-error settings-load-error" role="alert">
                <span>Could not load saved settings{settingsLoading ? "…" : `: ${settingsLoadError}`}. Default values are shown until settings load successfully.</span>
                <button type="button" className="settings-btn settings-btn-secondary" onClick={() => setSettingsReload((value) => value + 1)} disabled={settingsLoading}>
                    {settingsLoading ? "Retrying…" : "Retry"}
                </button>
            </div>}

            <div className="settings-layout">

                <nav className="settings-tabs">
                    {TABS.map((tab) => (
                        <button
                            key={tab.key}
                            className={activeTab === tab.key ? "settings-tab active" : "settings-tab"}
                            onClick={() => setActiveTab(tab.key)}
                        >
                            {tab.label}
                        </button>
                    ))}
                </nav>

                <div className="settings-tab-content">

                    {activeTab === "general" && (
                        <section className="settings-panel">
                            <div className="settings-panel-header">
                                <h2>General Information</h2>
                                <p className="settings-panel-subtitle">Basic details about your EventEase instance.</p>
                            </div>

                            <form onSubmit={handleGeneralSave}>
                                <div className="settings-form-group">
                                    <label htmlFor="systemName">System name</label>
                                    <input
                                        id="systemName"
                                        type="text"
                                        value={general.systemName}
                                        onChange={(e) => setGeneral({ ...general, systemName: e.target.value })}
                                    />
                                </div>

                                <div className="settings-form-group">
                                    <label htmlFor="institution">Institution name</label>
                                    <input
                                        id="institution"
                                        type="text"
                                        value={general.institution}
                                        onChange={(e) => setGeneral({ ...general, institution: e.target.value })}
                                    />
                                </div>

                                <div className="settings-form-row-split">
                                    <div className="settings-form-group">
                                        <label htmlFor="contactEmail">Contact email</label>
                                        <input
                                            id="contactEmail"
                                            type="email"
                                            value={general.contactEmail}
                                            onChange={(e) => setGeneral({ ...general, contactEmail: e.target.value })}
                                        />
                                    </div>
                                    <div className="settings-form-group">
                                        <label htmlFor="timezone">Timezone</label>
                                        <select
                                            id="timezone"
                                            value={general.timezone}
                                            onChange={(e) => setGeneral({ ...general, timezone: e.target.value })}
                                        >
                                            <option>Asia/Manila (GMT+8)</option>
                                            <option>Asia/Singapore (GMT+8)</option>
                                            <option>UTC</option>
                                        </select>
                                    </div>
                                </div>

                                <div className="settings-form-group settings-form-row-split">
                                    <div className="settings-form-group">
                                        <label htmlFor="themeToggle">Appearance</label>
                                        <button
                                            id="themeToggle"
                                            type="button"
                                            className={`settings-toggle-switch ${darkTheme ? "on" : ""}`}
                                            onClick={() => setDarkTheme((current) => !current)}
                                            role="switch"
                                            aria-checked={darkTheme}
                                            aria-label={`Switch to ${darkTheme ? "light" : "dark"} theme`}
                                        >
                                            <span className="settings-toggle-knob" />
                                            <span className="settings-toggle-label">
                                                {darkTheme ? "Dark mode" : "Light mode"}
                                            </span>
                                        </button>
                                    </div>
                                </div>

                                <div className="settings-logo-row">
                                    <img src={logoUrl} alt="Current system logo" className="settings-logo-preview" />
                                    <div>
                                        <button
                                            type="button"
                                            className="settings-btn settings-btn-secondary"
                                            onClick={() => fileInputRef.current?.click()}
                                            disabled={saving}
                                        >
                                            Change Logo
                                        </button>
                                        <p className="settings-field-help">PNG or SVG, at least 256×256px.</p>
                                    </div>
                                </div>

                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/png,image/jpeg,image/svg+xml,image/webp"
                                    hidden
                                    onChange={handleLogoChange}
                                />

                                <div className="settings-form-actions">
                                    <button type="submit" className="settings-btn settings-btn-primary" disabled={saving}>
                                        {saving ? "Saving..." : "Save Changes"}
                                    </button>
                                </div>
                            </form>
                        </section>
                    )}

                    {activeTab === "notifications" && (
                        <section className="settings-panel">
                            <div className="settings-panel-header">
                                <h2>Notification Preferences</h2>
                                <p className="settings-panel-subtitle">Choose which admin alerts you want to receive by email.</p>
                            </div>

                            <div className="settings-toggle-list">
                                <ToggleRow
                                    label="New user registration"
                                    description="Get notified when a new account signs up and needs approval."
                                    checked={notifications.newRegistration}
                                    onChange={() => toggleNotification("newRegistration")}
                                />
                                <ToggleRow
                                    label="Event pending approval"
                                    description="Get notified when an organizer submits a new event for review."
                                    checked={notifications.pendingApproval}
                                    onChange={() => toggleNotification("pendingApproval")}
                                />
                                <ToggleRow
                                    label="Event reminders"
                                    description="Receive a reminder 24 hours before an approved event starts."
                                    checked={notifications.eventReminders}
                                    onChange={() => toggleNotification("eventReminders")}
                                />
                                <ToggleRow
                                    label="Payment received"
                                    description="Get notified whenever a participant payment is confirmed."
                                    checked={notifications.paymentReceived}
                                    onChange={() => toggleNotification("paymentReceived")}
                                />
                                <ToggleRow
                                    label="Weekly summary digest"
                                    description="Receive a weekly email summarizing registrations and activity."
                                    checked={notifications.weeklyDigest}
                                    onChange={() => toggleNotification("weeklyDigest")}
                                />
                            </div>

                            <div className="settings-form-actions">
                                <button type="button" className="settings-btn settings-btn-primary" onClick={handleNotificationsSave} disabled={saving}>
                                    {saving ? "Saving..." : "Save Preferences"}
                                </button>
                            </div>
                        </section>
                    )}

                    {activeTab === "security" && (
                        <>
                            <section className="settings-panel">
                                <div className="settings-panel-header">
                                    <h2>Change Password</h2>
                                    <p className="settings-panel-subtitle">Use a strong password you don't use anywhere else.</p>
                                </div>

                                {passwordError && <div className="settings-error">{passwordError}</div>}

                                <form onSubmit={handlePasswordSave}>
                                    <div className="settings-form-group">
                                        <label htmlFor="currentPassword">Current password</label>
                                        <input
                                            id="currentPassword"
                                            type="password"
                                            value={security.currentPassword}
                                            onChange={(e) => setSecurity({ ...security, currentPassword: e.target.value })}
                                        />
                                    </div>

                                    <div className="settings-form-row-split">
                                        <div className="settings-form-group">
                                            <label htmlFor="newPassword">New password</label>
                                            <input
                                                id="newPassword"
                                                type="password"
                                                value={security.newPassword}
                                                onChange={(e) => setSecurity({ ...security, newPassword: e.target.value })}
                                            />
                                        </div>
                                        <div className="settings-form-group">
                                            <label htmlFor="confirmPassword">Confirm new password</label>
                                            <input
                                                id="confirmPassword"
                                                type="password"
                                                value={security.confirmPassword}
                                                onChange={(e) => setSecurity({ ...security, confirmPassword: e.target.value })}
                                            />
                                        </div>
                                    </div>

                                    <div className="settings-form-actions">
                                        <button type="submit" className="settings-btn settings-btn-primary" disabled={saving}>
                                            {saving ? "Updating..." : "Update Password"}
                                        </button>
                                    </div>
                                </form>
                            </section>

                            <section className="settings-panel">
                                <div className="settings-panel-header">
                                    <h2>Session & Access</h2>
                                </div>

                                <ToggleRow
                                    label="Two-factor authentication"
                                    description="Require a verification code in addition to your password when signing in."
                                    checked={security.twoFactor}
                                    onChange={() => setSecurity({ ...security, twoFactor: !security.twoFactor })}
                                />

                                <div className="settings-form-group settings-form-group-inline">
                                    <label htmlFor="sessionTimeout">Auto-logout after inactivity</label>
                                    <select
                                        id="sessionTimeout"
                                        value={security.sessionTimeout}
                                        onChange={(e) => setSecurity({ ...security, sessionTimeout: e.target.value })}
                                    >
                                        <option value="15">15 minutes</option>
                                        <option value="30">30 minutes</option>
                                        <option value="60">1 hour</option>
                                        <option value="never">Never</option>
                                    </select>
                                </div>

                                <div className="settings-form-actions">
                                    <button type="button" className="settings-btn settings-btn-primary" onClick={handleSecuritySave} disabled={saving}>
                                        {saving ? "Saving..." : "Save Settings"}
                                    </button>
                                </div>
                            </section>
                        </>
                    )}

                    {activeTab === "roles" && (
                        <section className="settings-panel">
                            <div className="settings-panel-header">
                                <h2>Roles & Permissions</h2>
                                <p className="settings-panel-subtitle">Control what each role can access. Admin permissions cannot be changed.</p>
                            </div>

                            <div className="settings-table-wrapper">
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Role</th>
                                            {PERMISSION_FIELDS.map((field) => (
                                                <th key={field.key}>{field.label}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {permissions.map((p, i) => (
                                            <tr key={p.role}>
                                                <td className="settings-role-name">{p.role}</td>
                                                {PERMISSION_FIELDS.map((field) => (
                                                    <td key={field.key}>
                                                        <PermissionCheckbox
                                                            checked={p[field.key]}
                                                            onChange={() => togglePermission(i, field.key)}
                                                            disabled={p.role === "Admin"}
                                                        />
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <div className="settings-form-actions">
                                <button type="button" className="settings-btn settings-btn-primary" onClick={handlePermissionsSave} disabled={saving}>
                                    {saving ? "Saving..." : "Save Permissions"}
                                </button>
                            </div>
                        </section>
                    )}

                </div>
            </div>

        </AppShell>
    );
}

function ToggleRow({ label, description, checked, onChange }) {
    return (
        <div className="settings-toggle-row">
            <div className="settings-toggle-text">
                <span className="settings-toggle-label">{label}</span>
                {description && <span className="settings-toggle-description">{description}</span>}
            </div>
            <button
                type="button"
                className={`settings-toggle-switch ${checked ? "on" : ""}`}
                onClick={onChange}
                role="switch"
                aria-checked={checked}
                aria-label={label}
            >
                <span className="settings-toggle-knob" />
            </button>
        </div>
    );
}

function PermissionCheckbox({ checked, onChange, disabled }) {
    return (
        <input
            type="checkbox"
            checked={checked}
            onChange={onChange}
            disabled={disabled}
            className="settings-permission-checkbox"
        />
    );
}

export default Settings;
