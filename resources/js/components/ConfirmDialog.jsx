/**
 * Reusable confirmation step for destructive actions (delete / revoke).
 * Reuses the shared `.modal-*` classes so it matches every other dialog.
 */
function ConfirmDialog({
    open,
    title = "Are you sure?",
    message,
    confirmLabel = "Delete",
    cancelLabel = "Cancel",
    onConfirm,
    onCancel,
    isBusy = false,
    busyLabel = "Working...",
}) {
    if (!open) return null;

    return (
        <div className="modal-overlay" onClick={onCancel}>
            <div
                className="modal-card confirm-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="confirm-dialog-title"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="modal-header">
                    <h3 id="confirm-dialog-title">{title}</h3>
                    <button type="button" className="modal-close" onClick={onCancel} aria-label="Close">×</button>
                </div>
                <div className="modal-body">
                    <p className="confirm-dialog-message">{message}</p>
                </div>
                <div className="modal-footer">
                    <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={isBusy}>{cancelLabel}</button>
                    <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={isBusy}>{isBusy ? busyLabel : confirmLabel}</button>
                </div>
            </div>
        </div>
    );
}

export default ConfirmDialog;