import { cloneElement, isValidElement, useId } from "react";

function FormField({
  id,
  label,
  children,
  help,
  error,
  required = false,
  className = "",
  labelClassName = "",
  controlClassName = "",
  as = "div",
}) {
  const Tag = as;
  const generatedId = useId();
  const fieldId = id || `ff-${generatedId}`;
  const hasError = Boolean(error);
  const helpId = help ? `${fieldId}-help` : undefined;
  const errorId = hasError ? `${fieldId}-error` : undefined;

  return (
    <Tag className={`form-group ${className}`.trim()}>
      {label ? (
        <label
          htmlFor={fieldId}
          className={`form-label ${labelClassName}`.trim()}
        >
          {label}
          {required && <span aria-hidden="true"> *</span>}
        </label>
      ) : null}
      <div className={`form-control-wrap ${controlClassName}`.trim()}>
        {typeof children === "function"
          ? children({ id: fieldId, ariaDescribedBy: [helpId, errorId].filter(Boolean).join(" ") || undefined, ariaInvalid: hasError || undefined })
          : isValidElement(children)
            ? cloneElement(children, {
                id: children.props.id || fieldId,
                "aria-describedby": [children.props["aria-describedby"], helpId, errorId].filter(Boolean).join(" ") || undefined,
                "aria-invalid": hasError || children.props["aria-invalid"] || undefined,
              })
            : children}
      </div>
      {help && !hasError ? (
        <span id={helpId} className="field-help">
          {help}
        </span>
      ) : null}
      {hasError ? (
        <span id={errorId} className="field-help field-error" role="alert">
          {error}
        </span>
      ) : null}
    </Tag>
  );
}

export default FormField;
