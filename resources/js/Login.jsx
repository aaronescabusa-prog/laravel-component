import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./Login.css";
import logo from "./assets/Tmc_Logo.png";
import campusPhoto from "./assets/campus.png";
import { authApi, setSession } from "./lib/api";

function Login() {
    const navigate = useNavigate();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [showSignInHelp, setShowSignInHelp] = useState(false);
    const [error, setError] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [suspendedPopup, setSuspendedPopup] = useState(null);

    const handleSubmit = async (e) => {
        e.preventDefault();

        const normalizedEmail = email.trim();
        if (!normalizedEmail || !password) {
            setError("Please enter both your email and password.");
            return;
        }

        setError("");
        setIsLoading(true);

        try {
            const response = await authApi.login(normalizedEmail, password);
            if (!response?.user || !response?.token) {
                setError("Sign-in could not be completed. Please try again.");
                return;
            }

            setSuspendedPopup(null);
            setSession(response.token, {
                name: response.user.name,
                role: response.user.role,
                email: response.user.email,
            });
            navigate("/dashboard");
        } catch (err) {
            const message = err?.payload?.message
                || (err?.httpStatus ? err.message : "Unable to connect. Check your connection and try again.");
            const status = err?.payload?.status || err?.status || null;

            if (status === "Suspended" || message.toLowerCase().includes("suspend")) {
                setSuspendedPopup({ message });
                setError("");
            } else {
                setSuspendedPopup(null);
                setError(message || "Email or password is incorrect.");
            }
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="auth-page">

            <a href="#login-form" className="skip-link">Skip to sign in form</a>

            <div className="auth-body">

                <aside
                    className="auth-side"
                    aria-label="About TMC EventEase"
                    style={{ backgroundImage: `linear-gradient(rgba(15,32,60,0.92), rgba(15,32,60,0.96)), url(${campusPhoto})` }}
                >
                    <div className="auth-side-header">
                        <h1 className="auth-side-title">TMC EventEase</h1>
                        <p className="auth-side-tagline">
                            Administrator portal for Trinidad Municipal College events
                        </p>
                    </div>

                    <div className="auth-side-features">
                        <div className="auth-side-feature">
                            <div className="feature-number">01</div>
                            <div>
                                <strong>Event Administration</strong>
                                <p>Manage campus events, schedules, and approvals</p>
                            </div>
                        </div>
                        <div className="auth-side-feature">
                            <div className="feature-number">02</div>
                            <div>
                                <strong>Accounts &amp; Access</strong>
                                <p>Manage user accounts and scanner permissions</p>
                            </div>
                        </div>
                        <div className="auth-side-feature">
                            <div className="feature-number">03</div>
                            <div>
                                <strong>Attendance &amp; Reporting</strong>
                                <p>Review attendance, certificates, and reports</p>
                            </div>
                        </div>
                    </div>

                </aside>

                <main className="auth-main">
                    <div className="auth-form-wrapper">
                        <div className="auth-form-card">

                            <div className="auth-form-header">
                                <img src={logo} alt="TMC Logo" className="auth-form-logo" />
                                <div className="auth-form-header-text">
                                    <h1 className="auth-form-title">Welcome back</h1>
                                    <p className="auth-form-subtitle">Administrator sign in</p>
                                </div>
                            </div>

                            {error && (
                                <div className="auth-error" role="alert">
                                    {error}
                                </div>
                            )}

                            <form id="login-form" onSubmit={handleSubmit} aria-busy={isLoading}>

                                <div className="form-group">
                                    <label htmlFor="email">
                                        Email address <span className="required" aria-hidden="true">*</span>
                                    </label>
                                    <input
                                        id="email"
                                        type="email"
                                        placeholder="Enter your email"
                                        value={email}
                                        onChange={(e) => { setEmail(e.target.value); setError(""); }}
                                        autoComplete="email"
                                        required
                                        disabled={isLoading}
                                    />
                                    <span className="field-help">                                    Use your administrator account email</span>
                                </div>

                                <div className="form-group">
                                    <label htmlFor="password">
                                        Password <span className="required" aria-hidden="true">*</span>
                                    </label>
                                    <div className="password-wrapper">
                                        <input
                                            id="password"
                                            type={showPassword ? "text" : "password"}
                                            placeholder="Enter your password"
                                            value={password}
                                            onChange={(e) => { setPassword(e.target.value); setError(""); }}
                                            autoComplete="current-password"
                                            required
                                            disabled={isLoading}
                                        />
                                        <button
                                            type="button"
                                            className="toggle-password"
                                            onClick={() => setShowPassword(!showPassword)}
                                            aria-label={showPassword ? "Hide password" : "Show password"}
                                            disabled={isLoading}
                                        >
                                            {showPassword ? "Hide" : "Show"}
                                        </button>
                                    </div>
                                </div>

                                <div className="form-row">
                                    <span className="signin-security-note">Your session stays in this browser tab.</span>
                                    <button
                                        type="button"
                                        className="form-link signin-help-toggle"
                                        aria-expanded={showSignInHelp}
                                        aria-controls="signin-help"
                                        onClick={() => setShowSignInHelp((shown) => !shown)}
                                    >
                                        Need help signing in?
                                    </button>
                                </div>

                                {showSignInHelp && (
                                    <p className="signin-help" id="signin-help">
                                        Password resets aren't available here yet. Please contact your college administrator for help.
                                    </p>
                                )}

                                <button 
                                    type="submit" 
                                    className="btn btn-primary btn-block"
                                    disabled={isLoading}
                                    aria-live="polite"
                                >
                                    {isLoading ? (
                                        <>
                                            <span className="spinner" aria-hidden="true"></span>
                                            Logging in...
                                        </>
                                    ) : (
                                        "Login"
                                    )}
                                </button>

                            </form>

                            <p className="auth-switch">
                                This portal is for TMC administrators only.
                            </p>

                        </div>
                    </div>
                </main>

            </div>

            {suspendedPopup && (
                <div className="modal-overlay suspended-overlay" onClick={() => setSuspendedPopup(null)}>
                    <div
                        className="modal-card suspended-popup"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="suspended-popup-title"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="modal-header suspended-popup-header">
                            <h3 id="suspended-popup-title">Account Suspended</h3>
                            <button type="button" className="modal-close" onClick={() => setSuspendedPopup(null)} aria-label="Close">×</button>
                        </div>
                        <div className="modal-body suspended-popup-body">
                            <div className="suspended-icon" aria-hidden="true">!</div>
                            <p className="suspended-message">{suspendedPopup.message}</p>
                            <p className="suspended-hint">If you believe this is a mistake, please contact your administrator to request reactivation.</p>
                        </div>
                        <div className="modal-footer">
                            <button type="button" className="btn btn-primary" onClick={() => setSuspendedPopup(null)}>Understood</button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}

export default Login;