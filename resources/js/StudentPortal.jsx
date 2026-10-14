import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import AppShell from "./components/AppShell";
import QrCode from "./components/QrCode";
import { IconCalendar, IconMegaphone, IconClipboard, IconArrowRight } from "./components/Icons";
import { api, authApi, mapEventFromApi, mapRegistrationFromApi, registrationsApi, studentEvaluationsApi, getSessionUser, setSession } from "./lib/api";
import { useAuth } from "./lib/auth";
import "./StudentPortal.css";

const viewCopy = {
    home: ["Welcome to EventEase", "Discover campus events and keep your event activity in one place."],
    events: ["Explore Events", "Find an event that interests you and register with your student account."],
    "my-events": ["My Events", "View your event passes, attendance, and feedback."],
    profile: ["My Profile", "Keep your student and academic details up to date."],
};

function StudentPortal({ view = "home" }) {
    const user = getSessionUser() ?? {};
    const { setUser } = useAuth();
    const [events, setEvents] = useState([]);
    const [registrations, setRegistrations] = useState([]);
    const [announcements, setAnnouncements] = useState([]);
    const [academic, setAcademic] = useState({ courses: [], years: [] });
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState("");
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const [evaluation, setEvaluation] = useState(null);
    const [rating, setRating] = useState(5);
    const [comment, setComment] = useState("");
    const [profile, setProfile] = useState({ name: user.name ?? "", course: user.course ?? "", year: user.year ?? "", block_no: user.block_no ?? "" });

    const load = async () => {
        setLoading(true);
        setError("");
        try {
            const [eventRows, registrationRows, announcementRows, structure] = await Promise.all([
                api.list("events"), api.list("registrations"), api.list("announcements"), api.academicStructure(),
            ]);
            setEvents(eventRows.map(mapEventFromApi));
            setRegistrations(registrationRows.map(mapRegistrationFromApi));
            setAnnouncements(announcementRows);
            setAcademic(structure);
        } catch (loadError) {
            setError(loadError.message || "Could not load your EventEase data.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const registeredIds = useMemo(() => new Set(registrations.map((row) => row.event)), [registrations]);
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const upcomingEvents = events.filter((event) => {
        const deadline = event.registrationDeadline || event.date;
        return event.status === "Approved" && event.date >= today && deadline >= today && event.registrationOpen && !registeredIds.has(event.name);
    });
    const upcomingRegistrationCount = registrations.filter((row) => {
        const event = events.find((item) => item.name === row.event);
        return event?.date >= today;
    }).length;
    const title = viewCopy[view]?.[0] ?? viewCopy.home[0];
    const subtitle = viewCopy[view]?.[1] ?? viewCopy.home[1];

    async function register(event) {
        setBusy(event.id); setMessage(""); setError("");
        try {
            await registrationsApi.selfRegister(event.id);
            setMessage(`You are registered for ${event.name}.`);
            await load();
        } catch (registerError) {
            setError(registerError.message || "Registration could not be completed.");
        } finally { setBusy(""); }
    }

    async function cancel(registration) {
        setBusy(registration.id); setMessage(""); setError("");
        try {
            await registrationsApi.cancel(registration.id);
            setMessage(`Your registration for ${registration.event} was cancelled.`);
            await load();
        } catch (cancelError) {
            setError(cancelError.message || "This registration could not be cancelled.");
        } finally { setBusy(""); }
    }

    async function submitEvaluation(event) {
        event.preventDefault();
        setBusy(evaluation.id); setError("");
        try {
            await studentEvaluationsApi.submit(evaluation.id, rating, comment.trim());
            setMessage(`Thank you for sharing feedback about ${evaluation.name}.`);
            setEvaluation(null); setComment(""); await load();
        } catch (submitError) {
            setError(submitError.message || "Feedback could not be submitted.");
        } finally { setBusy(""); }
    }

    async function saveProfile(event) {
        event.preventDefault(); setBusy("profile"); setError(""); setMessage("");
        try {
            const updated = await authApi.updateProfile(profile);
            const nextUser = { ...user, ...updated };
            setSession(null, nextUser);
            setUser(nextUser);
            setProfile({ name: nextUser.name ?? "", course: nextUser.course ?? "", year: nextUser.year ?? "", block_no: nextUser.block_no ?? "" });
            setMessage("Your profile was updated.");
        } catch (saveError) {
            setError(saveError.message || "Your profile could not be saved.");
        } finally { setBusy(""); }
    }

    return (
        <AppShell title={title} subtitle={subtitle}>
            <div className="student-portal">
                {message && <div className="student-notice success" role="status">{message}<button onClick={() => setMessage("")} aria-label="Dismiss">×</button></div>}
                {error && <div className="student-notice error" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss">×</button></div>}
                {loading ? <div className="student-empty">Loading your EventEase data…</div> : null}

                {!loading && view === "home" && <>
                    <section className="student-welcome">
                        <div><span className="student-eyebrow">STUDENT PORTAL</span><h2>Hello, {user.name?.split(" ")[0] || "there"}!</h2><p>See what’s happening on campus and stay up to date with your registrations.</p></div>
                        <Link className="student-primary-link" to="/events">Browse events <IconArrowRight size={17} /></Link>
                    </section>
                    <section className="student-stat-grid" aria-label="Your event summary">
                        <SummaryCard icon={<IconCalendar />} label="Your upcoming events" value={upcomingRegistrationCount} />
                        <SummaryCard icon={<IconClipboard />} label="Events to explore" value={upcomingEvents.length} />
                        <SummaryCard icon={<IconMegaphone />} label="Announcements" value={announcements.length} />
                    </section>
                    <SectionHeading title="Recommended events" link="/events" linkText="View all" />
                    <div className="student-card-grid">{upcomingEvents.slice(0, 3).map((event) => <EventCard key={event.id} event={event} onRegister={register} busy={busy} />)}</div>
                    <SectionHeading title="Latest announcements" link="/announcements" linkText="View all" />
                    <div className="student-announcement-list">{announcements.slice(0, 3).map((item) => <article key={item.id} className="student-announcement"><span className="student-announcement-tag">{item.category || "Announcement"}</span><h3>{item.title}</h3><p>{item.message}</p></article>)}</div>
                </>}

                {!loading && view === "events" && <>
                    <div className="student-section-intro"><h2>Upcoming campus events</h2><p>Registrations are connected to your student account.</p></div>
                    {upcomingEvents.length ? <div className="student-card-grid">{upcomingEvents.map((event) => <EventCard key={event.id} event={event} onRegister={register} busy={busy} />)}</div> : <div className="student-empty">You’re all caught up. Check back when new events are published.</div>}
                </>}

                {!loading && view === "my-events" && <>
                    {registrations.length ? <div className="student-registration-list">{registrations.map((row) => {
                        const event = events.find((item) => item.name === row.event);
                        const canCancel = event && new Date(`${event.date}T23:59:59`) > new Date() && row.attendance === "Not Yet Recorded";
                        return <article className="student-registration" key={row.id}>
                            <div className="student-registration-main"><span className="student-announcement-tag">{row.attendance || "Registered"}</span><h2>{row.event}</h2><p>{event ? `${formatDate(event.date)}${event.venue ? ` · ${event.venue}` : ""}` : "Your registration is confirmed."}</p><span className="student-reference">Pass {row.id}</span>
                                <div className="student-card-actions"><button className="student-secondary-button" onClick={() => { setEvaluation({ id: event?.id, name: row.event }); setRating(5); setComment(""); }} disabled={!event || row.attendance !== "Present" || busy === row.id}>{row.attendance === "Present" ? "Give feedback" : "Feedback after check-in"}</button>{canCancel && <button className="student-text-button" onClick={() => cancel(row)} disabled={busy === row.id}>{busy === row.id ? "Cancelling…" : "Cancel registration"}</button>}</div>
                            </div>
                            {row.qrCode && <div className="student-pass"><QrCode value={row.qrCode} /><span>Show this pass at check-in</span></div>}
                        </article>;
                    })}</div> : <div className="student-empty"><h2>No registrations yet</h2><p>Browse events and register to get your event pass.</p><Link className="student-primary-link" to="/events">Explore events <IconArrowRight size={17} /></Link></div>}
                </>}

                {!loading && view === "profile" && <form className="student-profile-card" onSubmit={saveProfile}>
                    <div className="student-section-intro"><h2>Student information</h2><p>Your student ID is managed by the college. You can update your name and academic details.</p></div>
                    <label>Full name<input required value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></label>
                    <label>Email address<input value={user.email || ""} disabled /></label>
                    <label>Student ID<input value={user.student_id || ""} disabled /></label>
                    <label>Course / program<select required value={profile.course} onChange={(e) => setProfile({ ...profile, course: e.target.value })}><option value="">Select your program</option>{academic.courses.map((course) => <option key={course} value={course}>{course}</option>)}</select></label>
                    <div className="student-profile-row"><label>Year level<select required value={profile.year} onChange={(e) => setProfile({ ...profile, year: e.target.value })}><option value="">Select year</option>{academic.years.map((year) => <option key={year} value={year}>{year}</option>)}</select></label><label>Block<input value={profile.block_no} onChange={(e) => setProfile({ ...profile, block_no: e.target.value })} /></label></div>
                    <button className="student-primary-link" type="submit" disabled={busy === "profile"}>{busy === "profile" ? "Saving…" : "Save profile"}</button>
                </form>}
            </div>

            {evaluation && <div className="student-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setEvaluation(null); }}><form className="student-evaluation-modal" onSubmit={submitEvaluation}>
                <button className="student-modal-close" type="button" onClick={() => setEvaluation(null)} aria-label="Close">×</button><span className="student-eyebrow">EVENT FEEDBACK</span><h2>{evaluation.name}</h2><p>Your attendance must be checked in before feedback can be submitted.</p>
                <label>Rating<select value={rating} onChange={(e) => setRating(Number(e.target.value))}>{[5, 4, 3, 2, 1].map((number) => <option key={number} value={number}>{number} {number === 1 ? "star" : "stars"}</option>)}</select></label>
                <label>Comment<textarea maxLength={5000} rows={4} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Share your feedback (optional)" /></label>
                <button className="student-primary-link" disabled={busy === evaluation.id}>{busy === evaluation.id ? "Submitting…" : "Submit feedback"}</button>
            </form></div>}
        </AppShell>
    );
}

function SummaryCard({ icon, label, value }) { return <article className="student-summary-card"><span className="student-summary-icon">{icon}</span><div><span>{label}</span><strong>{value}</strong></div></article>; }
function SectionHeading({ title, link, linkText }) { return <div className="student-section-heading"><h2>{title}</h2><Link to={link}>{linkText} <IconArrowRight size={15} /></Link></div>; }
function EventCard({ event, onRegister, busy }) { return <article className="student-event-card">{event.bannerUrl ? <img className="student-event-banner" src={event.bannerUrl} alt="" /> : <div className="student-event-banner-placeholder"><IconCalendar size={28} /></div>}<div className="student-event-content"><span className="student-announcement-tag">{event.category || "Campus event"}</span><h3>{event.name}</h3><p>{event.description || "Join the TMC community for this campus event."}</p><div className="student-event-meta"><span>{formatDate(event.date)}</span>{event.startTime && <span>{event.startTime}</span>}{event.venue && <span>{event.venue}</span>}</div><button className="student-primary-link" onClick={() => onRegister(event)} disabled={busy === event.id}>{busy === event.id ? "Registering…" : "Register for event"}</button></div></article>; }
function formatDate(value) { if (!value) return "Date to be announced"; const date = new Date(`${value}T00:00:00`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date); }

export default StudentPortal;
