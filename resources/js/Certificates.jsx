import { useMemo, useEffect, useState } from "react";
import "./Certificates.css";
import logo from "./assets/Tmc_Logo.png";
import AppShell from "./components/AppShell";
import Toast from "./components/Toast";
import ConfirmDialog from "./components/ConfirmDialog";
import QrCode from "./components/QrCode";
import { useToast } from "./lib/useToast";
import { useCollection, logActivity, nextId, dateKey } from "./lib/storage";
import { usePagination } from "./lib/usePagination";
import Pagination from "./components/Pagination";
import CertificateGenerator from "./components/CertificateGenerator";
import { api, certificatesApi, mapEventFromApi, getSessionUser } from "./lib/api";
import { ActionIcon, IconView, IconEdit, IconTrash, IconAward, IconDownload } from "./components/Icons";


function initialsOf(text) {
    return String(text ?? "")
        .split(" ")
        .filter(Boolean)
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
}

function Certificates() {
    const { toast, showToast, dismissToast } = useToast();
    const sessionUser = getSessionUser();
    const sessionRole = sessionUser?.role ?? "Admin";
    // The Student role reads certificates but never writes them: the API's
    // certificates write list is Admin/Staff/Organizer. A student lands here
    // to see their own issued rows, with every mutation affordance hidden.
    const isReadOnly = sessionRole === "Student";
    const [certificates, setCertificates, refreshCertificates] = useCollection("certificates", (msg) => showToast(msg, "danger"));
    const [editingCert, setEditingCert] = useState(null);
    const [isNewCert, setIsNewCert] = useState(false);
    const [pendingDelete, setPendingDelete] = useState(null);
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");
    const [viewingCert, setViewingCert] = useState(null);
    const [verifyId, setVerifyId] = useState("");
    const [verifyResult, setVerifyResult] = useState(null);

    const filteredRows = useMemo(() => {
        return certificates.filter((row) => {
            const term = search.trim().toLowerCase();
            const matchesSearch = !term || row.participant.toLowerCase().includes(term) || row.event.toLowerCase().includes(term) || row.id.toLowerCase().includes(term);
            const matchesStatus = statusFilter === "all" || row.status.toLowerCase().replace(" ", "-") === statusFilter;
            return matchesSearch && matchesStatus;
        });
    }, [certificates, search, statusFilter]);

    const pager = usePagination(filteredRows, {
        resetKey: [search, statusFilter].join("|"),
    });

    // Events back the template picker, so the generator always offers the
    // same list the Certificates screen is filtering against.
    const [events, setEvents] = useState([]);

    useEffect(() => {
        let active = true;

        api.list("events")
            .then((rows) => {
                if (active) setEvents(rows.map(mapEventFromApi));
            })
            .catch(() => {});

        return () => { active = false; };
    }, []);

    function openCreate() {
        setEditingCert({ id: nextId(certificates, "CERT", 9001), participant: "", email: "", event: "", status: "Pending", dateIssued: "", qrCode: "" });
        setIsNewCert(true);
    }

    function saveCertificate(e) {
        e.preventDefault();
        if (!editingCert.participant.trim() || !editingCert.event.trim()) {
            showToast("Participant and event are required.", "danger");
            return;
        }
        const saved = {
            ...editingCert,
            id: isNewCert ? nextId(certificates, "CERT", 9001) : editingCert.id,
            participant: editingCert.participant.trim(),
            email: editingCert.email.trim(),
            event: editingCert.event.trim(),
        };
        if (certificates.some((c) => c.id !== saved.id && c.email.toLowerCase() === saved.email.toLowerCase() && c.event.toLowerCase() === saved.event.toLowerCase())) {
            showToast("This participant already has a certificate for this event.", "danger");
            return;
        }
        saved.dateIssued = saved.status === "Issued" ? saved.dateIssued || dateKey() : "";
        saved.qrCode = saved.status === "Issued" ? saved.qrCode || `QR-${saved.id}` : "";
        setCertificates((prev) => isNewCert ? [saved, ...prev] : prev.map((c) => c.id === saved.id ? saved : c));
        logActivity({ category: "Certificate", action: `${isNewCert ? "Created" : "Updated"} certificate ${saved.id}`, details: `${saved.participant} · ${saved.event}` });
        showToast(`Certificate ${isNewCert ? "created" : "updated"}.`);
        setVerifyResult(null);
        setEditingCert(null);
    }

    function deleteCertificate() {
        if (!pendingDelete) return;
        setCertificates((prev) => prev.filter((c) => c.id !== pendingDelete.id));
        logActivity({ category: "Certificate", action: `Deleted certificate ${pendingDelete.id}`, details: pendingDelete.participant });
        setPendingDelete(null);
        setVerifyResult(null);
        showToast("Certificate deleted.");
    }

    function generateCertificate(row) {
        setCertificates((prev) => prev.map((c) =>
            c.id === row.id
                ? { ...c, status: "Issued", dateIssued: dateKey(), qrCode: `QR-${c.id}` }
                : c
        ));
        setVerifyResult(null);
        logActivity({ category: "Certificate", action: `Issued certificate ${row.id}`, details: row.participant });
        showToast("Certificate issued.");
    }

    function generateAllPending() {
        setCertificates((prev) => prev.map((c) =>
            c.status === "Pending"
                ? { ...c, status: "Issued", dateIssued: dateKey(), qrCode: `QR-${c.id}` }
                : c
        ));
        setVerifyResult(null);
        logActivity({ category: "Certificate", action: `Issued ${pending} pending certificates` });
        showToast(`${pending} certificates issued.`);
    }

    function handleDownload(row) {
        certificatesApi.download(row.id).catch((err) => showToast(err.message, "danger"));
    }

    function handleVerify(e) {
        e.preventDefault();
        const found = certificates.find((c) => c.qrCode.toLowerCase() === verifyId.trim().toLowerCase() || c.id.toLowerCase() === verifyId.trim().toLowerCase());
        if (found && found.status === "Issued") {
            setVerifyResult({ valid: true, cert: found });
        } else if (found) {
            setVerifyResult({ valid: false, reason: "This certificate has not been issued yet." });
        } else {
            setVerifyResult({ valid: false, reason: "No certificate found matching that ID or QR code." });
        }
    }

    const totalIssued = certificates.filter((c) => c.status === "Issued").length;
    const pending = certificates.filter((c) => c.status === "Pending").length;
    const notEligible = certificates.filter((c) => c.status === "Not Eligible").length;

    return (
        <AppShell title="Certificates" prefix="cert-">

            <div className="cert-kpi-strip">
                <div className="cert-kpi-item">
                    <span className="cert-kpi-label">Total Issued</span>
                    <span className="cert-kpi-value">{totalIssued}</span>
                </div>
                <div className="cert-kpi-item cert-kpi-alert">
                    <span className="cert-kpi-label">Pending Generation</span>
                    <span className="cert-kpi-value">{pending}</span>
                </div>
                <div className="cert-kpi-item">
                    <span className="cert-kpi-label">Not Eligible</span>
                    <span className="cert-kpi-value">{notEligible}</span>
                </div>
            </div>

            {!isReadOnly && (
            <CertificateGenerator
                events={events}
                onIssued={() => refreshCertificates()}
            />
            )}

            <section className="cert-panel cert-verify-panel">
                <div className="cert-panel-header">
                    <h2>Verify a Certificate</h2>
                    <p className="cert-panel-subtitle">Enter a certificate ID or QR code to check its authenticity.</p>
                </div>
                <form className="cert-verify-form" onSubmit={handleVerify}>
                    <input
                        type="text"
                        placeholder="e.g. CERT-9001 or QR-CERT-9001A"
                        value={verifyId}
                        onChange={(e) => setVerifyId(e.target.value)}
                        className="cert-verify-input"
                    />
                    <button type="submit" className="cert-btn cert-btn-primary">Verify</button>
                </form>

                {verifyResult && (
                    <div className={`cert-verify-result ${verifyResult.valid ? "cert-verify-valid" : "cert-verify-invalid"}`}>
                        {verifyResult.valid ? (
                            <>
                                <strong>✓ Valid certificate</strong>
                                <p>{verifyResult.cert.participant} — {verifyResult.cert.event} (issued {verifyResult.cert.dateIssued})</p>
                            </>
                        ) : (
                            <>
                                <strong>✗ Invalid</strong>
                                <p>{verifyResult.reason}</p>
                            </>
                        )}
                    </div>
                )}
            </section>

            <section className="cert-panel">
                <div className="cert-panel-header">
                    <h2>{isReadOnly ? "My Certificates" : "All Certificates"}</h2>
                    {!isReadOnly && (
                    <div className="cert-panel-actions">
                        <button className="cert-btn cert-btn-primary" onClick={openCreate}>Add Certificate</button>
                        <button className="cert-btn cert-btn-primary" onClick={generateAllPending} disabled={pending === 0}>
                            Generate All Pending ({pending})
                        </button>
                    </div>
                    )}
                </div>

                <div className="cert-toolbar">
                    <input
                        type="text"
                        className="cert-input-search"
                        placeholder="Search by participant, event, or ID"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                    <select
                        className="cert-input-select"
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                    >
                        <option value="all">All statuses</option>
                        <option value="issued">Issued</option>
                        <option value="pending">Pending</option>
                        <option value="not-eligible">Not Eligible</option>
                    </select>
                </div>

                <div className="cert-table-wrapper">
                    <table>
                        <thead>
                            <tr>
                                <th>Participant</th>
                                <th>Event</th>
                                <th>Date Issued</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {pager.pageRows.map((row) => (
                                <tr key={row.id}>
                                    <td>
                                        <div className="cert-cell">
                                            <span className="cert-row-avatar">{initialsOf(row.participant)}</span>
                                            <div className="cert-cell-text">
                                                <span className="cert-cell-name">{row.participant}</span>
                                                <span className="cert-cell-id">{row.id}</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="cert-cell-muted">{row.event}</td>
                                    <td className="cert-cell-muted">{row.dateIssued || "—"}</td>
                                    <td><span className={`cert-status cert-status-${row.status.toLowerCase().replace(" ", "")}`}>{row.status}</span></td>
                                    <td className="cert-cell-actions">
                                        {!isReadOnly && (
                                        <ActionIcon icon={IconEdit} label="Edit" onClick={() => { setEditingCert({ ...row }); setIsNewCert(false); }} />
                                        )}
                                        {!isReadOnly && (
                                        <ActionIcon icon={IconTrash} label="Delete" tone="danger" onClick={() => setPendingDelete(row)} />
                                        )}
                                        {row.status === "Issued" && (
                                            <ActionIcon icon={IconView} label="View" onClick={() => setViewingCert(row)} />
                                        )}
                                        {!isReadOnly && row.status === "Pending" && (
                                            <ActionIcon icon={IconAward} label="Generate" tone="approve" onClick={() => generateCertificate(row)} />
                                        )}
                                        {isReadOnly && row.status === "Issued" && (
                                            <ActionIcon icon={IconDownload} label="Download" onClick={() => handleDownload(row)} />
                                        )}
                                        {row.status === "Not Eligible" && (
                                            <span className="cert-cell-muted">Attendance incomplete</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            {filteredRows.length === 0 && (
                                <tr>
                                    <td colSpan="5" className="cert-empty-row">No certificates match your filters.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                <Pagination
                    {...pager}
                    classPrefix="cert"
                    unit="certificates"
                />
            </section>


            {editingCert && (
                <div className="cert-modal-overlay" onClick={() => setEditingCert(null)}>
                    <form className="cert-modal-card" role="dialog" aria-modal="true" aria-labelledby="cert-form-title" onClick={(e) => e.stopPropagation()} onSubmit={saveCertificate}>
                        <div className="cert-modal-header">
                            <h3 id="cert-form-title">{isNewCert ? "New Certificate" : `Edit ${editingCert.id}`}</h3>
                            <button type="button" className="cert-modal-close" onClick={() => setEditingCert(null)} aria-label="Close">×</button>
                        </div>
                        <div className="cert-modal-body">
                            <div className="form-group">
                                <label htmlFor="certParticipant">Participant</label>
                                <input id="certParticipant" required value={editingCert.participant} onChange={(e) => setEditingCert({ ...editingCert, participant: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label htmlFor="certEmail">Email</label>
                                <input id="certEmail" type="email" required value={editingCert.email} onChange={(e) => setEditingCert({ ...editingCert, email: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label htmlFor="certEvent">Event</label>
                                <input id="certEvent" required value={editingCert.event} onChange={(e) => setEditingCert({ ...editingCert, event: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label htmlFor="certStatus">Status</label>
                                <select id="certStatus" value={editingCert.status} onChange={(e) => setEditingCert({ ...editingCert, status: e.target.value })}>
                                    <option>Pending</option><option>Issued</option><option>Not Eligible</option>
                                </select>
                            </div>
                            {editingCert.status === "Issued" && (
                                <div className="form-group">
                                    <label htmlFor="certDate">Date issued</label>
                                    <input id="certDate" type="date" value={editingCert.dateIssued} onChange={(e) => setEditingCert({ ...editingCert, dateIssued: e.target.value })} />
                                </div>
                            )}
                        </div>
                        <div className="cert-modal-footer">
                            <button type="button" className="cert-btn cert-btn-secondary" onClick={() => setEditingCert(null)}>Cancel</button>
                            <button type="submit" className="cert-btn cert-btn-primary">{isNewCert ? "Create Certificate" : "Save Changes"}</button>
                        </div>
                    </form>
                </div>
            )}
            <ConfirmDialog open={Boolean(pendingDelete)} title="Delete certificate?" message={`Delete ${pendingDelete?.id}? This cannot be undone.`} onConfirm={deleteCertificate} onCancel={() => setPendingDelete(null)} />
            {toast && <Toast {...toast} onDismiss={dismissToast} />}

            {viewingCert && (
                <div className="cert-modal-overlay" onClick={() => setViewingCert(null)}>
                    <div className="cert-modal-card" onClick={(e) => e.stopPropagation()}>
                        <div className="cert-modal-header">
                            <h3>Certificate of Completion</h3>
                            <button className="cert-modal-close" onClick={() => setViewingCert(null)} aria-label="Close">×</button>
                        </div>
                        <div className="cert-modal-body">
                            <div className="cert-preview">
                                <img src={logo} alt="TMC Logo" className="cert-preview-logo" />
                                <p className="cert-preview-eyebrow">Trinidad Municipal College</p>
                                <h4 className="cert-preview-title">Certificate of Participation</h4>
                                <p className="cert-preview-text">This certifies that</p>
                                <p className="cert-preview-name">{viewingCert.participant}</p>
                                <p className="cert-preview-text">has successfully participated in</p>
                                <p className="cert-preview-event">{viewingCert.event}</p>
                                <p className="cert-preview-date">Issued on {viewingCert.dateIssued}</p>
                                <div className="cert-preview-qr">
                                    <QrCode value={viewingCert.qrCode} size={96} />
                                    <span className="cert-preview-qr-code">{viewingCert.qrCode}</span>
                                </div>
                            </div>
                        </div>
                        <div className="cert-modal-footer">
                            <button className="cert-btn cert-btn-secondary" onClick={() => setViewingCert(null)}>Close</button>
                            <button className="cert-btn cert-btn-primary" onClick={() => window.print()}>Download / Print</button>
                        </div>
                    </div>
                </div>
            )}

        </AppShell>
    );
}

export default Certificates;