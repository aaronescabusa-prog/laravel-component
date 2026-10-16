import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import "./Login.css";
import logo from "./assets/Tmc_Logo.png";
import campusPhoto from "./assets/campus.png";
import { IconMail, IconLock } from "./components/Icons";
import { authApi, setSession } from "./lib/api";
import { useAuth } from "./lib/auth";

function Login() {
    const navigate = useNavigate();
    const { setUser } = useAuth();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [suspendedPopup, setSuspendedPopup] = useState(null);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (isLoading) return;

        const normalizedEmail = email.trim().toLowerCase();
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
            const role = `${response.user.role ?? ""}`.toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
            const signedInUser = {
                name: response.user.name,
                role,
                email: response.user.email,
                student_id: response.user.student_id,
                course: response.user.course,
                year: response.user.year,
                block_no: response.user.block_no,
            };
            setSession(response.token, signedInUser);
            setUser(signedInUser);
            navigate(role === "Scanner" ? "/attendance" : "/dashboard", { replace: true });
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
        <div className="auth-page auth-login-page">

            <a href="#login-form" className="skip-link">Skip to sign in form</a>

            <div className="auth-body">

                <aside
                    className="auth-side"
                    aria-label="About TMC EventEase"
                    style={{ backgroundImage: `linear-gradient(rgba(8, 36, 72, 0.86), rgba(8, 36, 72, 0.94)), url(${campusPhoto})` }}
                >
                    <div className="auth-side-header">
                        <h1 className="auth-side-title">TMC EventEase</h1>
                        <p className="auth-side-tagline">
                            One place for students and campus teams to manage TMC events
                        </p>
                    </div>

                    <div className="auth-side-features">
                        <div className="auth-side-feature">
                            <div className="feature-number">01</div>
                            <div>
                                        <strong>Discover Campus Events</strong>
                                        <p>Find events and manage your registrations</p>
                            </div>
                        </div>
                        <div className="auth-side-feature">
                            <div className="feature-number">02</div>
                            <div>
                                        <strong>Your Event Pass</strong>
                                        <p>Keep your registrations and attendance pass together</p>
                            </div>
                        </div>
                        <div className="auth-side-feature">
                            <div className="feature-number">03</div>
                            <div>
                                        <strong>Updates &amp; Certificates</strong>
                                        <p>Read campus announcements and access issued certificates</p>
                            </div>
                        </div>
                    </div>

                </aside>

                <main className="auth-main">
                    <div className="auth-form-wrapper">
                        <div className="auth-form-card">

                            <div className="auth-form-header">
                                <img src={logo} alt="Trinidad Municipal College" className="auth-form-logo" />
                                <div className="auth-form-header-text">
                                    <h1 className="auth-form-title">TMC EventEase</h1>
                                    <p className="auth-form-subtitle">Your events, easy access.</p>
                                </div>
                            </div>

                            <p className="auth-form-prompt">Sign in to your account</p>

                            {error && (
                                <div className="auth-error" role="alert">
                                    {error}
                                </div>
                            )}

                            <form id="login-form" onSubmit={handleSubmit} aria-busy={isLoading}>

                                <div className="form-group">
                                    <label htmlFor="email">
                                        Email address <span className="required" aria-hidden="true"></span>
                                    </label>
                                    <div className="auth-input-wrap">
                                        <IconMail size={18} />
                                        <input
                                            id="email"
                                            type="email"
                                            value={email}
                                            onChange={(e) => { setEmail(e.target.value); setError(""); }}
                                            autoComplete="email"
                                            required
                                            disabled={isLoading}
                                        />
                                    </div>
                                    <span className="field-help"></span>
                                </div>

                                <div className="form-group">
                                    <label htmlFor="password">
                                        Password <span className="required" aria-hidden="true"></span>
                                    </label>
                                    <div className="password-wrapper auth-password-wrap">
                                        <IconLock size={18} />
                                        <input
                                            id="password"
                                            type={showPassword ? "text" : "password"}
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
                                    <Link to="/forgot-password" className="form-link signin-help-toggle">
                                        Forgot password?
                                    </Link>
                                </div>

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
