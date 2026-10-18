import Modal from "./Modal";

/** Reusable destructive-action confirmation using the shared accessible dialog. */
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
        <Modal
            open={open}
            onClose={onCancel}
            title={title}
            size="sm"
            className="confirm-dialog"
            footer={(
                <>
                    <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={isBusy}>{cancelLabel}</button>
                    <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={isBusy}>{isBusy ? busyLabel : confirmLabel}</button>
                </>
            )}
        >
            <p className="confirm-dialog-message">{message}</p>
        </Modal>
    );
}

export default ConfirmDialog;
