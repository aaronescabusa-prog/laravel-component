import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import "./Login.css";
import logo from "./assets/Tmc_Logo.png";
import campusPhoto from "./assets/campus.png";
import { authApi, setSession } from "./lib/api";

function Login() {
    const navigate = useNavigate();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [remember, setRemember] = useState(false);
    const [error, setError] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [suspendedPopup, setSuspendedPopup] = useState(null);

    const handleSubmit = (e) => {
        e.preventDefault();

        if (!email || !password) {
            setError("Please enter both your email and password.");
            return;
        }

        if (password.length < 6) {
            setError("Email or password is incorrect. If you've forgotten your password, use the link below.");
            return;
        }

        setError("");
        setIsLoading(true);
        
        authApi.login(email, password)
            .then(({ user, token }) => {
                setIsLoading(false);
                setSuspendedPopup(null);
                setSession(token, { name: user.name, role: user.role, email: user.email });
                navigate("/dashboard");
            })
            .catch((err) => {
                setIsLoading(false);
                const message = err.payload?.message || err.message || "Email or password is incorrect.";
                const status = err.payload?.status || err.status || null;
                if (status === "Suspended" || message.toLowerCase().includes("suspend")) {
                    setSuspendedPopup({ message });
                    setError("");
                } else {
                    setSuspendedPopup(null);
                    setError(message);
                }
            });
    };

    return (
        <div className="auth-page">

            <a href="#login-form" className="skip-link">Skip to sign in form</a>

            <div className="auth-body">

                <div
                    className="auth-side"
                    style={{ backgroundImage: `linear-gradient(rgba(15,32,60,0.92), rgba(15,32,60,0.96)), url(${campusPhoto})` }}
                >
                    <div className="auth-side-header">
                        <h1 className="auth-side-title">TMC EventEase</h1>
                        <p className="auth-side-tagline">
                            The official event management platform of Trinidad Municipal College
                        </p>
                    </div>

                    <div className="auth-side-features">
                        <div className="auth-side-feature">
                            <div className="feature-number">01</div>
                            <div>
                                <strong>Event Registration</strong>
                                <p>Register for school events and activities</p>
                            </div>
                        </div>
                        <div className="auth-side-feature">
                            <div className="feature-number">02</div>
                            <div>
                                <strong>Certificate Management</strong>
                                <p>View and download event certificates</p>
                            </div>
                        </div>
                        <div className="auth-side-feature">
                            <div className="feature-number">03</div>
                            <div>
                                <strong>Budget Monitoring</strong>
                                <p>Monitor event budgets and reports</p>
                            </div>
                        </div>
                    </div>

                </div>

                <div className="auth-main">
                    <div className="auth-form-wrapper">
                        <div className="auth-form-card">

                            <div className="auth-form-header">
                                <img src={logo} alt="TMC Logo" className="auth-form-logo" />
                                <div className="auth-form-header-text">
                                    <h1 className="auth-form-title" id="login-form">Welcome Back!</h1>
                                    <p className="auth-form-subtitle">Login to your account</p>
                                </div>
                            </div>

                            {error && (
                                <div className="auth-error" role="alert">
                                    {error}
                                </div>
                            )}

                            <form onSubmit={handleSubmit}>

                                <div className="form-group">
                                    <label htmlFor="email">
                                        Email Address <span className="required"></span>
                                    </label>
                                    <input
                                        id="email"
                                        type="email"
                                        placeholder="Enter your email"
                                        value={email}
                                        onChange={(e) => { setEmail(e.target.value); setError(""); }}
                                        autoComplete="username"
                                    />
                                    <span className="field-help">Use your official TMC email address</span>
                                </div>

                                <div className="form-group">
                                    <label htmlFor="password">
                                        Password <span className="required"></span>
                                    </label>
                                    <div className="password-wrapper">
                                        <input
                                            id="password"
                                            type={showPassword ? "text" : "password"}
                                            placeholder="Enter your password"
                                            value={password}
                                            onChange={(e) => { setPassword(e.target.value); setError(""); }}
                                            autoComplete="current-password"
                                        />
                                        <button
                                            type="button"
                                            className="toggle-password"
                                            onClick={() => setShowPassword(!showPassword)}
                                            aria-label={showPassword ? "Hide password" : "Show password"}
                                        >
                                            {showPassword ? "Hide" : "Show"}
                                        </button>
                                    </div>
                                </div>

                                <div className="form-row">
                                    <label className="checkbox-label">
                                        <input
                                            type="checkbox"
                                            checked={remember}
                                            onChange={(e) => setRemember(e.target.checked)}
                                        />
                                        Remember me
                                    </label>

                                    <a href="#" className="form-link">Forgot password?</a>
                                </div>

                                <button 
                                    type="submit" 
                                    className="btn btn-primary btn-block"
                                    disabled={isLoading}
                                >
                                    {isLoading ? (
                                        <>
                                            <span className="spinner"></span>
                                            Logging in...
                                        </>
                                    ) : (
                                        "Login"
                                    )}
                                </button>

                            </form>

                            <p className="auth-switch">
                                Don't have an account? <Link to="/register" className="register-link">Sign up</Link>
                            </p>

                        </div>
                    </div>
                </div>

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