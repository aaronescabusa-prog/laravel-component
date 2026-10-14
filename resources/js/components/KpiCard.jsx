import React from "react";
import "./KpiCard.css";

/**
 * Reusable KPI metric card.
 * Renders a labelled number with an optional trend badge.
 * Styles are provided by ui.css (.kpi-item / .kpi-alert / .kpi-label / etc.)
 */
export default function KpiCard({ label, value, trend, trendLabel, alert }) {
  return (
    <div className={`kpi-item${alert ? " kpi-alert" : ""}`}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {trendLabel && (
        <span className={`kpi-trend${trend ? ` ${trend}` : ""}`}>{trendLabel}</span>
      )}
    </div>
  );
}
