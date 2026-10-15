import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import logo from "./assets/Tmc_Logo.png";
import { authApi } from "./lib/api";
import "./PasswordReset.css";

function PasswordReset() {
    const { token } = useParams();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const isReset = Boolean(token);
    const [email, setEmail] = useState(() => searchParams.get("email") ?? "");
    const [password, setPassword] = useState("");
    const [confirmation, setConfirmation] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [complete, setComplete] = useState(false);

    async function submit(event) {
        event.preventDefault();
        if (busy) return;

        setBusy(true);
        setError("");
        try {
            if (isReset) {
                await authApi.resetPassword({
                    email: email.trim(),
                    token,
                    password,
                    password_confirmation: confirmation,
                });
            } else {
                await authApi.sendPasswordResetLink(email.trim());
            }
            setComplete(true);
        } catch (requestError) {
            setError(requestError.message || "We couldn't complete that request. Please try again.");
        } finally {
            setBusy(false);
        }
    }

    return (
        <main className="password-flow-page">
            <section className="password-flow-card" aria-labelledby="password-flow-title">
                <Link to="/login" className="password-flow-brand">
                    <img src={logo} alt="" />
                    <span>TMC EventEase</span>
                </Link>

                {complete ? (
                    <div className="password-flow-result" role="status">
                        <span className="password-flow-check" aria-hidden="true">✓</span>
                        <h1 id="password-flow-title">{isReset ? "Password updated" : "Check your email"}</h1>
                        <p>
                            {isReset
                                ? "Your password has been changed. You can sign in with the new password."
                                : "If an account uses that email, we sent a password reset link. The link expires in 60 minutes."}
                        </p>
                        <button type="button" className="btn btn-primary btn-block" onClick={() => navigate("/login", { replace: true })}>
                            Return to sign in
                        </button>
                    </div>
                ) : (
                    <>
                        <div className="password-flow-heading">
                            <span className="password-flow-eyebrow">ACCOUNT RECOVERY</span>
                            <h1 id="password-flow-title">{isReset ? "Choose a new password" : "Forgot your password?"}</h1>
                            <p>
                                {isReset
                                    ? "Enter the email address for your account and choose a new password."
                                    : "Enter your account email and we’ll send a secure link to reset your password."}
                            </p>
                        </div>

                        {error && <div className="password-flow-error" role="alert">{error}</div>}

                        <form onSubmit={submit} aria-busy={busy}>
                            <label className="password-flow-field" htmlFor="recovery-email">
                                Email address
                                <input
                                    id="recovery-email"
                                    type="email"
                                    autoComplete="email"
                                    required
                                    maxLength={255}
                                    value={email}
                                    onChange={(event) => { setEmail(event.target.value); setError(""); }}
                                    disabled={busy || (isReset && Boolean(email))}
                                />
                            </label>

                            {isReset && (
                                <>
                                    <label className="password-flow-field" htmlFor="new-password">
                                        New password
                                        <input
                                            id="new-password"
                                            type="password"
                                            autoComplete="new-password"
                                            minLength={8}
                                            maxLength={255}
                                            required
                                            value={password}
                                            onChange={(event) => { setPassword(event.target.value); setError(""); }}
                                            disabled={busy}
                                        />
                                        <small>Use at least 8 characters.</small>
                                    </label>
                                    <label className="password-flow-field" htmlFor="password-confirmation">
                                        Confirm new password
                                        <input
                                            id="password-confirmation"
                                            type="password"
                                            autoComplete="new-password"
                                            required
                                            value={confirmation}
                                            onChange={(event) => { setConfirmation(event.target.value); setError(""); }}
                                            disabled={busy}
                                        />
                                    </label>
                                </>
                            )}

                            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
                                {busy ? "Please wait…" : isReset ? "Reset password" : "Send reset link"}
                            </button>
                        </form>

                        <Link className="password-flow-back" to="/login">Back to sign in</Link>
                    </>
                )}
            </section>
        </main>
    );
}

export default PasswordReset;
