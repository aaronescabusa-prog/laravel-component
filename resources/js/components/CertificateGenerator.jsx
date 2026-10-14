import { useEffect, useState } from "react";
import { useToast } from "../lib/useToast";
import { certificatesApi } from "../lib/api";
import { IconUpload, IconCheck, IconView, IconX, IconDownload } from "./Icons";

/**
 * Certificate generation flow, matching the drawn hand-off:
 *
 *   1. Upload Template     — pick an event, upload the artwork
 *   2. # view student eligible — who qualifies, and who is excluded and why
 *   3. Confirmation        — create the certificates (nothing is emailed yet)
 *   4. Send                — queue the emails through the Send button
 */
function CertificateGenerator({ events, onIssued }) {
    const { showToast } = useToast();

    const [eventTitle, setEventTitle] = useState("");
    const [templates, setTemplates] = useState([]);
    const [eligibility, setEligibility] = useState(null);
    const [preparedByRegistration, setPreparedByRegistration] = useState({});
    const [uploading, setUploading] = useState(false);
    const [checking, setChecking] = useState(false);
    const [issuing, setIssuing] = useState(false);
    const [sending, setSending] = useState(false);
    const [selected, setSelected] = useState([]);
    const [previewUrl, setPreviewUrl] = useState(null);
    const [previewReference, setPreviewReference] = useState(null);
    const [templateZoom, setTemplateZoom] = useState(false);
    const [templateImageFailed, setTemplateImageFailed] = useState(false);

    const currentTemplate = templates.find((t) => t.event === eventTitle);
    const templateUrl = currentTemplate?.url || null;

    async function loadTemplates() {
        try {
            const rows = await certificatesApi.templates();
            setTemplates(Array.isArray(rows) ? rows : []);
        } catch {
            setTemplates([]);
        }
    }

    useEffect(() => {
        loadTemplates();
    }, []);

    // Choosing a different event invalidates any review already on screen.
    useEffect(() => {
        setEligibility(null);
        setSelected([]);
        setPreparedByRegistration({});
    }, [eventTitle]);

    // A different event means different artwork, so drop a previous load
    // failure and any open zoom rather than carrying it across.
    useEffect(() => {
        setTemplateImageFailed(false);
        setTemplateZoom(false);
    }, [eventTitle]);

    // Escape closes the zoomed template, the same affordance the click-outside
    // handler on the overlay provides.
    useEffect(() => {
        if (!templateZoom) return undefined;

        const onKeyDown = (e) => {
            if (e.key === "Escape") setTemplateZoom(false);
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [templateZoom]);

    async function handleUpload(e) {
        const file = e.target.files?.[0];
        e.target.value = "";

        if (!file) return;
        if (!eventTitle) {
            showToast("Choose the event before uploading a template.", "danger");
            return;
        }

        setUploading(true);
        try {
            await certificatesApi.uploadTemplate(file, eventTitle);
            showToast(`Template uploaded for ${eventTitle}.`);
            await loadTemplates();
        } catch (err) {
            showToast(err.message, "danger");
        } finally {
            setUploading(false);
        }
    }

    async function handleRemoveTemplate() {
        try {
            await certificatesApi.deleteTemplate(eventTitle);
            showToast("Template removed.");
            await loadTemplates();
        } catch (err) {
            showToast(err.message, "danger");
        }
    }

    /* ---- step 2: who is eligible ---- */
    async function checkEligibility() {
        if (!eventTitle) {
            showToast("Choose an event first.", "danger");
            return;
        }

        setChecking(true);
        setPreparedByRegistration({});
        setSelected([]);
        try {
            const result = await certificatesApi.eligible(eventTitle);
            setEligibility(result);
            setSelected((result.rows || []).filter((r) => r.eligible).map((r) => r.reference));
        } catch (err) {
            showToast(err.message, "danger");
        } finally {
            setChecking(false);
        }
    }

    /* ---- step 3: confirmation ---- */
    async function handleIssue() {
        setIssuing(true);
        try {
            const result = await certificatesApi.issue(eventTitle);
            const prepared = Object.fromEntries(
                (result.certificates || []).map((certificate) => [
                    certificate.reference.startsWith("CERT-")
                        ? certificate.reference.slice("CERT-".length)
                        : certificate.reference,
                    certificate.reference,
                ])
            );
            setPreparedByRegistration(prepared);
            showToast(
                `${result.issued_count} certificate(s) prepared. Preview them, then choose who to email.`
            );
            onIssued?.();
        } catch (err) {
            showToast(err.message, "danger");
        } finally {
            setIssuing(false);
        }
    }

    /* ---- step 4: send ---- */
    async function handleSend() {
        if (selected.length === 0) {
            showToast("Select at least one student to send to.", "danger");
            return;
        }

        const certificateReferences = selected
            .map((registrationReference) => preparedByRegistration[registrationReference])
            .filter(Boolean);

        if (certificateReferences.length !== selected.length) {
            showToast("Prepare the certificates before sending them.", "danger");
            return;
        }

        setSending(true);
        try {
            const result = await certificatesApi.sendBulk(certificateReferences);
            showToast(result.message || "Certificates queued for delivery.");
            setSelected([]);
        } catch (err) {
            showToast(err.message, "danger");
        } finally {
            setSending(false);
        }
    }

    async function handlePreview(reference) {
        try {
            const url = await certificatesApi.preview(reference);
            setPreviewReference(reference);
            setPreviewUrl((old) => {
                if (old) URL.revokeObjectURL(old);
                return url;
            });
        } catch (err) {
            showToast(err.message, "danger");
        }
    }

    async function handleDownload(reference) {
        try {
            await certificatesApi.download(reference);
        } catch (err) {
            showToast(err.message, "danger");
        }
    }

    function toggleRow(reference) {
        setSelected((prev) =>
            prev.includes(reference) ? prev.filter((r) => r !== reference) : [...prev, reference]
        );
    }

    const eligibleRows = (eligibility?.rows || []).filter((r) => r.eligible);
    const blockedRows = (eligibility?.rows || []).filter((r) => !r.eligible);
    const preparedCount = Object.keys(preparedByRegistration).length;

    return (
        <section className="cert-panel cert-generator">
            <div className="cert-panel-header">
                <div>
                    <h2>Certificate Generation</h2>
                    <p className="cert-generator-hint">
                        Upload a template, review the eligible students, then send the certificates by email.
                    </p>
                </div>
            </div>

            {/* Step 1 - upload the template */}
            <div className="cert-generator-step">
                <span className="cert-generator-step-number">1</span>
                <div className="cert-generator-step-body">
                    <h3>Upload Template</h3>

                    <div className="cert-generator-row">
                        <select
                            className="cert-input-select"
                            value={eventTitle}
                            onChange={(e) => setEventTitle(e.target.value)}
                            aria-label="Event for this certificate"
                        >
                            <option value="">Select an event…</option>
                            {events.map((event) => (
                                <option key={event.id ?? event.name} value={event.name}>
                                    {event.name}
                                </option>
                            ))}
                        </select>

                        <label className="cert-btn cert-btn-primary">
                            <IconUpload />
                            {uploading ? "Uploading…" : "Upload Template"}
                            <input
                                type="file"
                                accept="image/png,image/jpeg"
                                onChange={handleUpload}
                                hidden
                                disabled={uploading}
                            />
                        </label>

                        {currentTemplate && (
                            <button
                                type="button"
                                className="cert-btn cert-btn-secondary"
                                onClick={handleRemoveTemplate}
                            >
                                Remove template
                            </button>
                        )}
                    </div>

                    {currentTemplate && templateUrl && !templateImageFailed && (
                        <div className="cert-template-preview">
                            <button
                                type="button"
                                className="cert-template-thumb"
                                onClick={() => setTemplateZoom(true)}
                                aria-label={`Enlarge the certificate template for ${currentTemplate.event}`}
                            >
                                <img
                                    src={templateUrl}
                                    alt={`Certificate template for ${currentTemplate.event}`}
                                    onError={() => setTemplateImageFailed(true)}
                                />
                            </button>
                            <p className="cert-generator-note">
                                Template “{currentTemplate.name}” is active for this event. Select the preview
                                to view it full size.
                            </p>
                        </div>
                    )}
                    {currentTemplate && templateImageFailed && (
                        <p className="cert-generator-note cert-generator-note-warn">
                            Template “{currentTemplate.name}” is active, but its artwork could not be loaded.
                        </p>
                    )}
                    {!currentTemplate && eventTitle && (
                        <p className="cert-generator-note cert-generator-note-warn">
                            No template uploaded yet. A default layout will be used.
                        </p>
                    )}
                </div>
            </div>

            {/* Step 2 - "# view student eligible" */}
            <div className="cert-generator-step">
                <span className="cert-generator-step-number">2</span>
                <div className="cert-generator-step-body">
                    <h3>View Eligible Students</h3>

                    <button
                        type="button"
                        className="cert-btn cert-btn-secondary"
                        onClick={checkEligibility}
                        disabled={checking || !eventTitle}
                    >
                        {checking ? "Checking…" : "Check Eligibility"}
                    </button>

                    {eligibility && (
                        <>
                            <p className="cert-generator-note">
                                {eligibility.eligible_count} of {eligibility.total} registered student(s) are
                                eligible.
                                {!eligibility.issues_certificates && " This event does not issue certificates."}
                            </p>

                            {eligibleRows.length > 0 && (
                                <div className="cert-eligible-list">
                                    <div className="cert-eligible-row cert-eligible-header">
                                        <input
                                            type="checkbox"
                                            checked={selected.length === eligibleRows.length}
                                            onChange={() =>
                                                setSelected(
                                                    selected.length === eligibleRows.length
                                                        ? []
                                                        : eligibleRows.map((r) => r.reference)
                                                )
                                            }
                                            aria-label="Select all eligible students to receive a certificate email"
                                        />
                                        <span>Student</span>
                                        <span>Attendance</span>
                                        <span>Email</span>
                                        <span>Preview</span>
                                    </div>

                                    {eligibleRows.map((row) => (
                                        <div key={row.reference} className="cert-eligible-row">
                                            <input
                                                type="checkbox"
                                                checked={selected.includes(row.reference)}
                                                onChange={() => toggleRow(row.reference)}
                                                aria-label={`Select ${row.participant} to receive a certificate email`}
                                            />
                                            <span>{row.participant}</span>
                                            <span className="cert-eligible-attendance">{row.attendance}</span>
                                            <span className="cell-muted">{row.email}</span>
                                            <button
                                                type="button"
                                                className="cert-btn cert-btn-secondary"
                                                onClick={() => handlePreview(preparedByRegistration[row.reference])}
                                                disabled={!preparedByRegistration[row.reference]}
                                                title={preparedByRegistration[row.reference]
                                                    ? `Preview ${row.participant}'s certificate`
                                                    : "Prepare certificates to enable preview"}
                                            >
                                                <IconView />
                                                Preview
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {blockedRows.length > 0 && (
                                <details className="cert-blocked">
                                    <summary>{blockedRows.length} student(s) not eligible</summary>
                                    <ul>
                                        {blockedRows.map((row) => (
                                            <li key={row.reference}>
                                                <strong>{row.participant}</strong> — {row.reason}
                                            </li>
                                        ))}
                                    </ul>
                                </details>
                            )}

                            {eligibleRows.length > 0 && (
                                <div className="cert-generator-prepare">
                                    <button
                                        type="button"
                                        className="cert-btn cert-btn-primary"
                                        onClick={handleIssue}
                                        disabled={issuing || preparedCount > 0 || !eligibility.issues_certificates}
                                    >
                                        {issuing
                                            ? "Preparing…"
                                            : preparedCount > 0
                                                ? `${preparedCount} certificates prepared`
                                                : "Prepare Certificates"}
                                    </button>
                                    <span className="cert-generator-note">
                                        Preparing creates records for all eligible students without sending email.
                                    </span>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* Step 3 - confirmation, and step 4 - send */}
            <div className="cert-generator-step">
                <span className="cert-generator-step-number">3</span>
                <div className="cert-generator-step-body">
                    <h3>Send Certificates</h3>

                    <div className="cert-generator-row">
                        <button
                            type="button"
                            className="cert-btn cert-btn-primary"
                            onClick={handleSend}
                            disabled={sending || selected.length === 0 || preparedCount === 0}
                        >
                            <IconCheck />
                            {sending
                                ? "Sending…"
                                : `Send ${selected.length} Certificate${selected.length === 1 ? "" : "s"}`}
                        </button>
                    </div>

                    <p className="cert-generator-note">
                        {preparedCount > 0
                            ? `${preparedCount} certificate(s) are prepared. Sending queues email for the selected students.`
                            : "Prepare the eligible certificates in Step 2 before sending them. Email is delivered by the background worker."}
                    </p>
                </div>
            </div>

            {templateZoom && templateUrl && (
                <div className="cert-modal-overlay" onClick={() => setTemplateZoom(false)}>
                    <div
                        className="cert-modal-card cert-template-zoom"
                        role="dialog"
                        aria-modal="true"
                        aria-label={`Certificate template for ${currentTemplate.event}`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="cert-modal-header">
                            <h3>{currentTemplate.name}</h3>
                            <button
                                type="button"
                                className="cert-modal-close"
                                onClick={() => setTemplateZoom(false)}
                                aria-label="Close"
                            >
                                <IconX />
                            </button>
                        </div>
                        <div className="cert-modal-body cert-template-zoom-body">
                            <img
                                className="cert-template-zoom-image"
                                src={templateUrl}
                                alt={`Certificate template for ${currentTemplate.event}`}
                            />
                        </div>
                    </div>
                </div>
            )}

            {previewUrl && (
                <div className="cert-modal-overlay" onClick={() => setPreviewUrl(null)}>
                    <div
                        className="cert-modal-card cert-preview-modal"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="cert-modal-header">
                            <h3>Certificate Preview</h3>
                            <button
                                className="cert-modal-close"
                                onClick={() => setPreviewUrl(null)}
                                aria-label="Close"
                            >
                                <IconX />
                            </button>
                        </div>
                        <iframe
                            className="cert-pdf-frame"
                            src={previewUrl}
                            title="Certificate preview"
                        />
                        <div className="cert-modal-footer">
                            <button
                                type="button"
                                className="cert-btn cert-btn-secondary"
                                onClick={() => handleDownload(previewReference)}
                            >
                                <IconDownload />
                                Download PDF
                            </button>
                            <button
                                type="button"
                                className="cert-btn cert-btn-primary"
                                onClick={() => setPreviewUrl(null)}
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}

export default CertificateGenerator;
