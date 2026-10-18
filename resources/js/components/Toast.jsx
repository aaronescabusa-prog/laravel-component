/**
 * Confirmation message shown after a create / update / delete.
 * Announced to screen readers via role="status".
 */
function Toast({ message, tone = "success", onDismiss }) {
    if (!message) return null;

    return (
        <div
            className={`ui-toast${tone === "danger" ? " ui-toast-danger" : ""}`}
            role={tone === "danger" ? "alert" : "status"}
            aria-live={tone === "danger" ? "assertive" : "polite"}
        >
            <span className="ui-toast-icon" aria-hidden="true">{tone === "danger" ? "!" : "✓"}</span>
            <span className="ui-toast-message">{message}</span>
            {onDismiss && (
                <button
                    type="button"
                    className="ui-toast-close"
                    onClick={onDismiss}
                    aria-label="Dismiss notification"
                >
                    ×
                </button>
            )}
        </div>
    );
}

export default Toast;
