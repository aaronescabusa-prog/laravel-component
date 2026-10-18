import { useId } from "react";

function SectionPanel({
  title,
  subtitle,
  actions,
  children,
  className = "",
  headerClassName = "",
  bodyClassName = "",
}) {
  const headingId = useId();
  const subtitleId = `${headingId}-description`;

  return (
    <section
      className={`panel ${className}`.trim()}
      aria-labelledby={title ? headingId : undefined}
      aria-describedby={subtitle ? subtitleId : undefined}
    >
      {(title || subtitle || actions) && (
        <div className={`panel-header ${headerClassName}`.trim()}>
          <div>
            {title && <h2 id={headingId}>{title}</h2>}
            {subtitle && <p id={subtitleId} className="panel-subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="panel-actions">{actions}</div>}
        </div>
      )}
      <div className={`panel-body ${bodyClassName}`.trim()}>{children}</div>
    </section>
  );
}

export default SectionPanel;
