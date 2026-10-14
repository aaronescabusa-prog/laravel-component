import { useState } from "react";
import { Link } from "react-router-dom";
import "./Register.css";
import logo from "./assets/Tmc_Logo.png";
import campusPhoto from "./assets/campus.png";
import { authApi } from "./lib/api";

const COURSES = [
    "BS Information Technology",
    "BS Criminology",
    "BS Office Administration",
    "BS Education Major in English",
    "Bachelor of Elementary Education",
    "BA Political Science",
    "BA Communications",
];

const YEARS = ["1st Year", "2nd Year", "3rd Year", "4th Year"];

/* Roles a visitor may request. Administrator accounts are created by an
   existing admin in User Accounts, never through self-registration. */
const ROLES = ["Student", "Organizer", "Staff"];

function Register() {
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [email, setEmail] = useState("");
    const [course, setCourse] = useState("");
    const [year, setYear] = useState("");
    const [role, setRole] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    const passwordChecks = {
        length: password.length >= 8,
        upper: /[A-Z]/.test(password),
        number: /[0-9]/.test(password),
    };

    const handleSubmit = (e) => {
        e.preventDefault();

        if (!firstName || !lastName || !email || !course || !year || !role || !password || !confirmPassword) {
            setError("Please complete all required fields.");
            setSuccess(false);
            return;
        }

        if (!passwordChecks.length || !passwordChecks.upper || !passwordChecks.number) {
            setError("Your password doesn't meet the minimum requirements below.");
            setSuccess(false);
            return;
        }

        if (password !== confirmPassword) {
            setError("Password and confirmation do not match.");
            setSuccess(false);
            return;
        }

        setError("");
        setIsLoading(true);
        
        authApi.register({
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            email: email.trim(),
            course,
            year,
            role,
            password,
        })
            .then(() => {
                setIsLoading(false);
                setSuccess(true);
            })
            .catch((err) => {
                setIsLoading(false);
                setError(err.message || "Registration failed. Please try again.");
            });
    };

    return (
        <div className="auth-page">

            <a href="#register-form" className="skip-link">Skip to registration form</a>

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
                                <strong>Create Your Account</strong>
                                <p>Register for school events and activities</p>
                            </div>
                        </div>
                        <div className="auth-side-feature">
                            <div className="feature-number">02</div>
                            <div>
                                <strong>Account Verification</strong>
                                <p>Accounts are reviewed before activation</p>
                            </div>
                        </div>
                        <div className="auth-side-feature">
                            <div className="feature-number">03</div>
                            <div>
                                <strong>Quick Approval</strong>
                                <p>Use your official school email for faster processing</p>
                            </div>
                        </div>
                    </div>

                    <div className="auth-side-footer">
                        <div className="auth-notice">
                            <span className="auth-notice-label">Note</span>
                            <p>New accounts are typically approved within 1 business day by the Student Affairs Office.</p>
                        </div>
                    </div>
                </div>

                <div className="auth-main">
                    <div className="auth-form-wrapper">
                        <div className="auth-form-card">

                            <div className="auth-form-header">
                                <img src={logo} alt="TMC Logo" className="auth-form-logo" />
                                <div className="auth-form-header-text">

                                    <h1 className="auth-form-title" id="register-form">Create an account</h1>
                                    <p className="auth-form-subtitle">Join TMC EventEase to get started</p>
                                </div>
                            </div>

                            {error && (
                                <div className="auth-error" role="alert">
                                    {error}
                                </div>
                            )}
                            {success && (
                                <div className="auth-success">
                                    Account request submitted. You'll receive an email once it's approved.
                                </div>
                            )}

                            <form onSubmit={handleSubmit}>

                                <p className="section-label">Personal Information</p>

                                <div className="form-row-split">
                                    <div className="form-group">
                                        <label htmlFor="firstName">
                                            First Name <span className="required"></span>
                                        </label>
                                        <input
                                            id="firstName"
                                            type="text"
                                            placeholder=""
                                            value={firstName}
                                            onChange={(e) => { setFirstName(e.target.value); setError(""); }}
                                            className={firstName ? "has-value" : ""}
                                        />
                                    </div>

                                    <div className="form-group">
                                        <label htmlFor="lastName">
                                            Last Name <span className="required"></span>
                                        </label>
                                        <input
                                            id="lastName"
                                            type="text"
                                            placeholder=""
                                            value={lastName}
                                            onChange={(e) => { setLastName(e.target.value); setError(""); }}
                                            className={lastName ? "has-value" : ""}
                                        />
                                    </div>
                                </div>

                                <p className="section-label">Account Details</p>

                                <div className="form-group">
                                    <label htmlFor="email">
                                        Email Address <span className="required"></span>
                                    </label>
                                    <input
                                        id="email"
                                        type="email"
                                        placeholder=""
                                        value={email}
                                        onChange={(e) => { setEmail(e.target.value); setError(""); }}
                                        autoComplete="username"
                                        className={email ? "has-value" : ""}
                                    />
                                    <span className="field-help">Use your official TMC email address</span>
                                </div>

                                <div className="form-group">
                                    <label htmlFor="role">
                                        Role <span className="required"></span>
                                    </label>
                                    <select
                                        id="role"
                                        value={role}
                                        onChange={(e) => { setRole(e.target.value); setError(""); }}
                                        className={role ? "has-value" : ""}
                                    >
                                        <option value="">Select your role...</option>
                                        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                                    </select>
                                    <span className="field-help">How you'll use TMC EventEase. Administrator accounts are created by the Student Affairs Office.</span>
                                </div>

                                <p className="section-label">Academic Information</p>

                                <div className="form-row-split">
                                    <div className="form-group">
                                        <label htmlFor="course">
                                            Course <span className="required"></span>
                                        </label>
                                        <select
                                            id="course"
                                            value={course}
                                            onChange={(e) => { setCourse(e.target.value); setError(""); }}
                                            className={course ? "has-value" : ""}
                                        >
                                            <option value="">Select your course...</option>
                                            {COURSES.map((c) => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                    </div>

                                    <div className="form-group">
                                        <label htmlFor="year">
                                            Year Level <span className="required"></span>
                                        </label>
                                        <select
                                            id="year"
                                            value={year}
                                            onChange={(e) => { setYear(e.target.value); setError(""); }}
                                            className={year ? "has-value" : ""}
                                        >
                                            <option value="">Select year...</option>
                                            {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                                        </select>
                                    </div>
                                </div>

                                <div className="form-group">
                                    <label htmlFor="password">
                                        Password <span className="required"></span>
                                    </label>
                                    <div className="password-wrapper">
                                        <input
                                            id="password"
                                            type={showPassword ? "text" : "password"}
                                            placeholder=""
                                            value={password}
                                            onChange={(e) => { setPassword(e.target.value); setError(""); }}
                                            autoComplete="new-password"
                                            className={password ? "has-value" : ""}
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

                                    <ul className="password-checklist">
                                        <li className={passwordChecks.length ? "met" : ""}>At least 8 characters</li>
                                        <li className={passwordChecks.upper ? "met" : ""}>One uppercase letter</li>
                                        <li className={passwordChecks.number ? "met" : ""}>One number</li>
                                    </ul>
                                </div>

                                <div className="form-group">
                                    <label htmlFor="confirmPassword">
                                        Confirm Password <span className="required"></span>
                                    </label>
                                    <div className="password-wrapper">
                                        <input
                                            id="confirmPassword"
                                            type={showConfirmPassword ? "text" : "password"}
                                            placeholder=""
                                            value={confirmPassword}
                                            onChange={(e) => { setConfirmPassword(e.target.value); setError(""); }}
                                            autoComplete="new-password"
                                            className={confirmPassword ? "has-value" : ""}
                                        />
                                        <button
                                            type="button"
                                            className="toggle-password"
                                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                            aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                                        >
                                            {showConfirmPassword ? "Hide" : "Show"}
                                        </button>
                                    </div>
                                </div>

                                <button 
                                    type="submit" 
                                    className="btn btn-primary btn-block"
                                    disabled={isLoading}
                                >
                                    {isLoading ? (
                                        <>
                                            <span className="spinner"></span>
                                            Creating account...
                                        </>
                                    ) : (
                                        "Create account"
                                    )}
                                </button>

                            </form>

                            <p className="auth-switch">
                                Already have an account? <Link to="/login" className="register-link">Sign in</Link>
                            </p>


                        </div>
                    </div>
                </div>

            </div>

        </div>
    );
}

export default Register;