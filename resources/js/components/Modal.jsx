import { useId } from "react";
import useDialogA11y from "./useDialogA11y";

function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
  ariaLabel,
  className = "",
}) {
  const titleId = useId();
  const dialogRef = useDialogA11y(open, onClose);

  if (!open) return null;

  const sizeClass = {
    sm: "modal-card--sm",
    md: "modal-card--md",
    lg: "modal-card--lg",
    xl: "modal-card--xl",
    wide: "modal-card--wide",
  }[size] || "";

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        ref={dialogRef}
        className={`modal-card${sizeClass ? ` ${sizeClass}` : ""}${className ? ` ${className}` : ""}`}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : ariaLabel}
      >
        <div className="modal-header">
          {title ? <h3 id={titleId}>{title}</h3> : null}
          <button
            type="button"
            className="modal-close"
            aria-label="Close"
            onClick={() => onClose?.()}
          >
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}

export default Modal;
