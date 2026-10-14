import { useState } from "react";
import { Link } from "react-router-dom";
import "./Register.css";
import logo from "./assets/Tmc_Logo.png";
import campusPhoto from "./assets/campus.png";
import { authApi } from "./lib/api";

const DEPARTMENT_COURSES = {
    "College of Computer Studies": ["BS Information Technology"],
    "College of Education": ["Bachelor of Elementary Education", "BS Education Major in English"],
    "College of Criminal Justice Education": ["BS Criminology"],
    "College of Office Administration": ["BS Office Administration"],
    "College of Arts and Sciences": ["BA Political Science", "BA Communications"],
};

const YEARS = ["1st Year", "2nd Year", "3rd Year", "4th Year"];

function Register() {
    const [fullName, setFullName] = useState("");
    const [studentId, setStudentId] = useState("");
    const [email, setEmail] = useState("");
    const [department, setDepartment] = useState("");
    const [course, setCourse] = useState("");
    const [year, setYear] = useState("");
    const [blockNo, setBlockNo] = useState("");
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

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (isLoading) return;

        const cleanFullName = fullName.trim();
        const cleanStudentId = studentId.trim();
        const cleanEmail = email.trim().toLowerCase();
        const cleanBlockNo = blockNo.trim();

        if (!cleanFullName || !cleanStudentId || !cleanEmail || !department || !course || !year || !cleanBlockNo || !password || !confirmPassword) {
            setError("Please complete all required fields.");
            setSuccess(false);
            return;
        }

        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
            setError("Enter a valid email address.");
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

        try {
            await authApi.register({
                name: cleanFullName,
                student_id: cleanStudentId,
                email: cleanEmail,
                course,
                year,
                block_no: cleanBlockNo,
                password,
            });
            setSuccess(true);
        } catch (err) {
            setError(err.message || "Registration failed. Please try again.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="auth-page auth-register-page">

            <a href="#register-form" className="skip-link">Skip to registration form</a>

            <div className="auth-body">

                <div
                    className="auth-side"
                    style={{ backgroundImage: `linear-gradient(rgba(8, 36, 72, 0.86), rgba(8, 36, 72, 0.94)), url(${campusPhoto})` }}
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
                                <img src={logo} alt="Trinidad Municipal College" className="auth-form-logo" />
                                <div className="auth-form-header-text">

                                    <h1 className="auth-form-title" id="register-form">Create Account</h1>
                                    <p className="auth-form-subtitle">Join TMC EventEase today.</p>
                                </div>
                            </div>

                            {error && (
                                <div className="auth-error" role="alert">
                                    {error}
                                </div>
                            )}
                            {success && (
                                <div className="auth-success auth-register-success" role="status">
                                    <strong>Account request submitted.</strong>
                                    <span>An administrator must activate your account before you can sign in to EventEase.</span>
                                    <Link to="/login" className="btn btn-primary auth-success-login">Return to login</Link>
                                </div>
                            )}

                            {!success && <form onSubmit={handleSubmit} aria-busy={isLoading}>

                                <p className="section-label">Personal Information</p>

                                <div className="form-group">
                                    <label htmlFor="fullName">
                                        Full Name <span className="required"></span>
                                    </label>
                                    <input
                                        id="fullName"
                                        type="text"
                                        value={fullName}
                                        onChange={(e) => { setFullName(e.target.value); setError(""); }}
                                        className={fullName ? "has-value" : ""}
                                        autoComplete="name"
                                        maxLength={255}
                                        required
                                    />
                                </div>

                                <p className="section-label">Account Details</p>

                                <div className="form-group">
                                    <label htmlFor="studentId">
                                        Student ID <span className="required"></span>
                                    </label>
                                    <input
                                        id="studentId"
                                        type="text"
                                        placeholder=""
                                        value={studentId}
                                        onChange={(e) => { setStudentId(e.target.value); setError(""); }}
                                        autoComplete="off"
                                        maxLength={50}
                                        required
                                    />
                                </div>

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
                                        required
                                    />
                                </div>

                                <p className="section-label">Academic Information</p>

                                <div className="form-group">
                                    <label htmlFor="department">
                                        Department <span className="required"></span>
                                    </label>
                                    <select
                                        id="department"
                                        value={department}
                                        onChange={(e) => {
                                            const nextDepartment = e.target.value;
                                            setDepartment(nextDepartment);
                                            setCourse(DEPARTMENT_COURSES[nextDepartment]?.[0] || "");
                                            setError("");
                                        }}
                                        className={department ? "has-value" : ""}
                                        required
                                    >
                                        <option value="">Select your department...</option>
                                        {Object.keys(DEPARTMENT_COURSES).map((name) => (
                                            <option key={name} value={name}>{name}</option>
                                        ))}
                                    </select>
                                </div>

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
                                            required
                                        >
                                            <option value="">Select your course...</option>
                                            {(DEPARTMENT_COURSES[department] || []).map((c) => <option key={c} value={c}>{c}</option>)}
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
                                            required
                                        >
                                            <option value="">Select year...</option>
                                            {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                                        </select>
                                    </div>
                                </div>

                                <div className="form-group">
                                    <label htmlFor="blockNo">
                                        Block <span className="required"></span>
                                    </label>
                                    <input
                                        id="blockNo"
                                        value={blockNo}
                                        onChange={(e) => { setBlockNo(e.target.value); setError(""); }}
                                        className={blockNo ? "has-value" : ""}
                                        type="text"
                                        placeholder=""
                                        maxLength={50}
                                        required
                                    />
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
                                            required
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
                                            required
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

                            </form>}

                            {!success && <p className="auth-switch">Already have an account? <Link to="/login" className="register-link">Login</Link></p>}
                            <p className="auth-approval-note"></p>


                        </div>
                    </div>
                </div>

            </div>

        </div>
    );
}

export default Register;
