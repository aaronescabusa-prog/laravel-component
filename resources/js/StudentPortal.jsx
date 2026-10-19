import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import AppShell from "./components/AppShell";
import QrCode from "./components/QrCode";
import useDialogA11y from "./components/useDialogA11y";
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
const STUDENT_PASS_QR_PREFIX = "EVENTEASE_STUDENT:";

function StudentPortal({ view = "home" }) {
    const user = getSessionUser() ?? {};
    const { setUser } = useAuth();
    const [events, setEvents] = useState([]);
    const [registrations, setRegistrations] = useState([]);
    const [announcements, setAnnouncements] = useState([]);
    const [academic, setAcademic] = useState({ courses: [], years: [] });
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [busy, setBusy] = useState("");
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const [evaluation, setEvaluation] = useState(null);
    const [rating, setRating] = useState(5);
    const [comment, setComment] = useState("");
    const [eventSearch, setEventSearch] = useState("");
    const [eventCategory, setEventCategory] = useState("all");
    const [selectedEvent, setSelectedEvent] = useState(null);
    const eventDialogRef = useDialogA11y(Boolean(selectedEvent), () => setSelectedEvent(null));
    const evaluationDialogRef = useDialogA11y(Boolean(evaluation), () => setEvaluation(null));
    const [profile, setProfile] = useState({ name: user.name ?? "", course: user.course ?? "", year: user.year ?? "", block_no: user.block_no ?? "" });

    const load = async () => {
        setLoading(true);
        setLoadError("");
        setError("");
        try {
            const [eventRows, registrationRows, announcementRows, structure] = await Promise.all([
                api.list("events"), api.list("registrations"), api.list("announcements"), api.academicStructure(),
            ]);
            setEvents(eventRows.map(mapEventFromApi));
            setRegistrations(registrationRows.map(mapRegistrationFromApi));
            setAnnouncements(announcementRows);
            setAcademic(structure);
        } catch (requestError) {
            setLoadError(requestError.message || "Could not load your EventEase data.");
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
    const eventCategories = [...new Set(upcomingEvents.map((event) => event.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const filteredEvents = upcomingEvents.filter((event) => {
        const term = eventSearch.trim().toLowerCase();
        const matchesSearch = !term || [event.name, event.description, event.category, event.venue]
            .some((value) => String(value ?? "").toLowerCase().includes(term));
        return matchesSearch && (eventCategory === "all" || event.category === eventCategory);
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
            setSelectedEvent(null);
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
                {message && <div className="student-notice success" role="status">{message}<button onClick={() => setMessage("")} aria-label="Dismiss">Ã—</button></div>}
                {error && <div className="student-notice error" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss">Ã—</button></div>}
                {loading ? <div className="student-empty">Loading your EventEase dataâ€¦</div> : null}

                {loadError && <div className="student-notice error student-load-error" role="alert"><span>{loadError}</span><button type="button" className="student-secondary-button" onClick={load}>Try again</button></div>}

                {!loading && view === "home" && <>
                    <section className="student-welcome">
                        <div><span className="student-eyebrow">STUDENT PORTAL</span><h2>Hello, {user.name?.split(" ")[0] || "there"}!</h2><p>See whatâ€™s happening on campus and stay up to date with your registrations.</p></div>
                        <Link className="student-primary-link" to="/events">Browse events <IconArrowRight size={17} /></Link>
                    </section>
                    <section className="student-stat-grid" aria-label="Your event summary">
                        <SummaryCard icon={<IconCalendar />} label="Your upcoming events" value={upcomingRegistrationCount} />
                        <SummaryCard icon={<IconClipboard />} label="Events to explore" value={upcomingEvents.length} />
                        <SummaryCard icon={<IconMegaphone />} label="Announcements" value={announcements.length} />
                    </section>
                    <SectionHeading title="Recommended events" link="/events" linkText="View all" />
                    {!loadError && (upcomingEvents.length ? <div className="student-card-grid">{upcomingEvents.slice(0, 3).map((event) => <EventCard key={event.id} event={event} onViewDetails={setSelectedEvent} />)}</div> : <div className="student-empty student-inline-empty"><h3>No events to recommend yet</h3><p>New approved events will appear here when registration opens.</p></div>)}
                    <SectionHeading title="Latest announcements" link="/announcements" linkText="View all" />
                    {!loadError && (announcements.length ? <div className="student-announcement-list">{announcements.slice(0, 3).map((item) => <article key={item.id} className="student-announcement"><span className="student-announcement-tag">{item.category || "Announcement"}</span><h3>{item.title}</h3><div className="student-announcement-meta">{item.author && <span>Posted by {item.author}</span>}{(item.publish_date || item.publishDate) && <time dateTime={item.publish_date || item.publishDate}>{formatDate(item.publish_date || item.publishDate)}</time>}{item.audience && <span>For {item.audience}</span>}</div><p>{item.message}</p></article>)}</div> : <div className="student-empty student-inline-empty"><h3>No announcements yet</h3><p>Campus updates will appear here.</p></div>)}
                </>}

                {!loading && view === "events" && <>
                    <div className="student-section-intro"><h2>Upcoming campus events</h2><p>Registrations are connected to your student account.</p></div>
                    <div className="student-event-filters" role="search">
                        <input
                            type="search"
                            aria-label="Search events"
                            placeholder="Search events by title, venue, or category"
                            value={eventSearch}
                            onChange={(event) => setEventSearch(event.target.value)}
                        />
                        <select aria-label="Filter events by category" value={eventCategory} onChange={(event) => setEventCategory(event.target.value)}>
                            <option value="all">All categories</option>
                            {eventCategories.map((category) => <option key={category} value={category}>{category}</option>)}
                        </select>
                    </div>
                    {!loadError && (filteredEvents.length ? (
                        <div className="student-card-grid">
                            {filteredEvents.map((event) => <EventCard key={event.id} event={event} onViewDetails={setSelectedEvent} />)}
                        </div>
                    ) : (
                        <div className="student-empty">
                            <h2>{upcomingEvents.length ? "No events match your search" : "No upcoming events yet"}</h2>
                            <p>{upcomingEvents.length ? "Try another title, venue, or category." : "Check back when new campus events are published."}</p>
                            {(eventSearch || eventCategory !== "all") && <button className="student-secondary-button" onClick={() => { setEventSearch(""); setEventCategory("all"); }}>Clear filters</button>}
                        </div>
                    ))}
                </>}

                {!loading && view === "my-events" && <>
                    {registrations.length ? <div className="student-registration-list">{registrations.map((row) => {
                        const event = events.find((item) => item.name === row.event);
                        const canCancel = event && new Date(`${event.date}T23:59:59`) > new Date() && row.attendance === "Not Yet Recorded";
                        return <article className="student-registration" key={row.id}>
                            <div className="student-registration-main"><span className="student-announcement-tag">{row.attendance || "Registered"}</span><h2>{row.event}</h2><div className="student-registration-meta">
                                <span><strong>Schedule</strong>{event ? formatEventSchedule(event) : "To be announced"}{event?.startTime ? ` · ${formatTime(event.startTime)}` : ""}{event?.endTime ? `–${formatTime(event.endTime)}` : ""}</span>
                                {event?.venue && <span><strong>Location</strong>{event.venue}</span>}
                                <span><strong>Registered</strong>{formatDate(row.regDate)}</span>
                                {row.role && <span><strong>Registrant</strong>{row.role}{row.blockNo ? ` · ${row.blockNo}` : ""}</span>}
                                {row.paymentStatus && <span><strong>Payment</strong>{row.paymentStatus}{row.payment ? ` · ${row.payment}` : ""}</span>}
                            </div><span className="student-reference">Pass {row.id}</span>
                                <div className="student-card-actions"><button className="student-secondary-button" onClick={() => { setEvaluation({ id: event?.id, name: row.event }); setRating(5); setComment(""); }} disabled={!event || row.attendance !== "Present" || busy === row.id}>{row.attendance === "Present" ? "Give feedback" : "Feedback after check-in"}</button>{canCancel && <button className="student-text-button" onClick={() => cancel(row)} disabled={busy === row.id}>{busy === row.id ? "Cancellingâ€¦" : "Cancel registration"}</button>}</div>
                            </div>
                            {row.qrCode && <div className="student-pass"><QrCode value={`${STUDENT_PASS_QR_PREFIX}${row.qrCode}`} alt={`Student pass QR code for ${row.event}`} /><span>Show this pass at check-in</span></div>}
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
                    <button className="student-primary-link" type="submit" disabled={busy === "profile"}>{busy === "profile" ? "Savingâ€¦" : "Save profile"}</button>
                </form>}
            </div>

            {selectedEvent && <div className="student-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setSelectedEvent(null); }}><section ref={eventDialogRef} tabIndex={-1} className="student-event-detail-modal" role="dialog" aria-modal="true" aria-labelledby="student-event-detail-title">
                <button className="student-modal-close" type="button" onClick={() => setSelectedEvent(null)} aria-label="Close event details">Ã—</button>
                {selectedEvent.bannerUrl ? <img className="student-detail-banner" src={selectedEvent.bannerUrl} alt="" /> : <div className="student-detail-banner student-event-banner-placeholder"><IconCalendar size={32} /></div>}
                <div className="student-detail-content">
                    <div className="student-event-source-row">
                        <span className="student-event-source">LIVE LARAVEL EVENT</span>
                        <span className="student-announcement-tag">{selectedEvent.category || "Campus event"}</span>
                    </div>
                    <h2 id="student-event-detail-title">{selectedEvent.name}</h2>
                    <p className="student-event-reference">Event reference: <strong>{selectedEvent.id}</strong><span className={`student-event-status status-${String(selectedEvent.status || "Draft").toLowerCase()}`}>{selectedEvent.status || "Draft"}</span></p>
                    <div className="student-detail-grid">
                        <DetailItem label="Schedule" value={`${formatEventSchedule(selectedEvent)}${selectedEvent.startTime ? ` · ${formatTime(selectedEvent.startTime)}` : ""}${selectedEvent.endTime ? `–${formatTime(selectedEvent.endTime)}` : ""}`} />
                        <DetailItem label="Venue" value={selectedEvent.venue} />
                        <DetailItem label="Organizer" value={selectedEvent.organizer} />
                        <DetailItem label="Audience" value={formatAudience(selectedEvent)} />
                        <DetailItem label="Capacity" value={selectedEvent.hasCapacity ? `${selectedEvent.participants} of ${selectedEvent.capacity} registered${selectedEvent.capacity > selectedEvent.participants ? ` · ${selectedEvent.capacity - selectedEvent.participants} spots left` : ""}` : `${selectedEvent.participants} registered · no capacity limit`} />
                        <DetailItem label="Certificate" value={selectedEvent.hasCertificate ? "Certificate offered" : "No certificate offered"} />
                    </div>
                    <p>{selectedEvent.description || "Join the TMC community for this campus event."}</p>
                    {selectedEvent.registrationDeadline && <p className="student-detail-deadline">Registration closes {formatDate(selectedEvent.registrationDeadline)}.</p>}
                    {selectedEvent.attendanceCompulsory && <p className="student-detail-deadline">Attendance is required{selectedEvent.attendanceRequiresCheckout ? ", including check-out" : ""} to complete this event.</p>}
                    <div className="student-detail-actions">
                        <button className="student-secondary-button" type="button" onClick={() => setSelectedEvent(null)}>Close details</button>
                        <button className="student-primary-link" type="button" onClick={() => register(selectedEvent)} disabled={busy === selectedEvent.id}>{busy === selectedEvent.id ? "Registeringâ€¦" : "Register for event"}</button>
                    </div>
                </div>
            </section></div>}

            {evaluation && <div className="student-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setEvaluation(null); }}><form ref={evaluationDialogRef} tabIndex={-1} className="student-evaluation-modal" role="dialog" aria-modal="true" aria-label="Event feedback form" onSubmit={submitEvaluation}>
                <button className="student-modal-close" type="button" onClick={() => setEvaluation(null)} aria-label="Close">Ã—</button><span className="student-eyebrow">EVENT FEEDBACK</span><h2>{evaluation.name}</h2><p>Your attendance must be checked in before feedback can be submitted.</p>
                <label>Rating<select value={rating} onChange={(e) => setRating(Number(e.target.value))}>{[5, 4, 3, 2, 1].map((number) => <option key={number} value={number}>{number} {number === 1 ? "star" : "stars"}</option>)}</select></label>
                <label>Comment<textarea maxLength={5000} rows={4} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Share your feedback (optional)" /></label>
                <button className="student-primary-link" disabled={busy === evaluation.id}>{busy === evaluation.id ? "Submittingâ€¦" : "Submit feedback"}</button>
            </form></div>}
        </AppShell>
    );
}

function SummaryCard({ icon, label, value }) { return <article className="student-summary-card"><span className="student-summary-icon">{icon}</span><div><span>{label}</span><strong>{value}</strong></div></article>; }
function SectionHeading({ title, link, linkText }) { return <div className="student-section-heading"><h2>{title}</h2><Link to={link}>{linkText} <IconArrowRight size={15} /></Link></div>; }
function EventCard({ event, onViewDetails }) {
    return <article className="student-event-card">
        {event.bannerUrl ? <img className="student-event-banner" src={event.bannerUrl} alt="" /> : <div className="student-event-banner-placeholder"><IconCalendar size={28} /></div>}
        <div className="student-event-content">
            <span className="student-announcement-tag">{event.category || "Campus event"}</span>
            <h3>{event.name}</h3>
            <p>{event.description || "Join the TMC community for this campus event."}</p>
            <div className="student-event-meta"><span>{formatEventSchedule(event)}{event.startTime ? ` · ${formatTime(event.startTime)}` : ""}</span>{event.venue && <span>{event.venue}</span>}{event.organizer && <span>Hosted by {event.organizer}</span>}{event.registrationDeadline && <span>Registration closes {formatDate(event.registrationDeadline)}</span>}</div>
            <div className="student-event-actions">
                <button type="button" className="student-primary-link" onClick={() => onViewDetails(event)}>View details &amp; registration</button>
            </div>
        </div>
    </article>;
}
function DetailItem({ label, value }) { return value ? <div className="student-detail-item"><span>{label}</span><strong>{value}</strong></div> : null; }
function formatAudience(event) {
    return [event.targetRole && event.targetRole !== "All" ? event.targetRole : "All roles", event.targetCourse, event.targetDepartment, event.targetYear, event.targetBlock]
        .filter(Boolean)
        .join(" · ");
}
function formatEventSchedule(event) {
    if (!event?.date) return "Date to be announced";
    const start = formatDate(event.date);
    return event.endDate && event.endDate !== event.date ? `${start} – ${formatDate(event.endDate)}` : start;
}
function formatTime(value) {
    const [hours, minutes] = String(value).split(":").map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value;
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, hours, minutes));
}
function formatDate(value) { if (!value) return "Date to be announced"; const date = new Date(`${value}T00:00:00`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date); }

export default StudentPortal;
