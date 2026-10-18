const STATUS_MAP = {
  pending: "status-pending",
  approved: "events-status-approved status-active",
  rejected: "status-suspended",
  cancelled: "events-status-cancelled status-suspended",
  draft: "status-draft",
  published: "ann-status-published status-active",
  completed: "events-status-completed status-active",
  closed: "status-suspended",
  active: "status-active",
  inactive: "status-suspended",
  paid: "regs-payment-paid status-active",
  unpaid: "regs-payment-pending status-pending",
  "n/a": "regs-payment-na status-draft",
  na: "regs-payment-na status-draft",
  refunded: "regs-payment-refunded status-suspended",
  "checked in": "regs-attendance-in status-active",
  checkedin: "regs-attendance-in status-active",
  "not checked in": "regs-attendance-out status-pending",
  notcheckedin: "regs-attendance-out status-pending",
  "not yet recorded": "regs-attendance-out status-pending",
  notyetrecorded: "regs-attendance-out status-pending",
  incomplete: "status-pending",
  underreview: "status-pending",
  complete: "status-active",
  absent: "regs-attendance-absent status-suspended",
  present: "regs-attendance-in status-active",
  late: "status-pending",
  excused: "status-approved",
  open: "status-active",
  issued: "cert-status-issued status-active",
  eligible: "status-active",
  noteligible: "cert-status-noteligible status-suspended",
  pendingreview: "status-pending",
  verified: "status-active",
};

function StatusBadge({ status, label, className = "", prefix = "" }) {
  const s = (status || "").toString().trim().toLowerCase().replaceAll(" ", "").replaceAll("_", "").replaceAll("-", "");
  const key = Object.keys(STATUS_MAP).find((k) => k.replaceAll(" ", "").toLowerCase() === s) || status;
  const cls = STATUS_MAP[key] || "status-draft";
  const text = label || status || "-";

  return (
    <span
      className={`${prefix ? `${prefix}status ` : ""}status ${cls} ${className}`.trim()}
      data-status={s || undefined}
    >
      {text}
    </span>
  );
}

export default StatusBadge;
