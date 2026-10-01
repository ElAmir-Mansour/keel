// Chart colour roles. Values live in globals.css as CSS custom properties so
// light and dark swap in one place; charts reference roles, never hex.
// Validated with the dataviz palette checker (ordinal ramp and categorical
// slots pass CVD and contrast gates in both modes).

export const SERIES = [
  "var(--viz-series-1)",
  "var(--viz-series-2)",
  "var(--viz-series-3)",
  "var(--viz-series-4)",
  "var(--viz-series-5)",
  "var(--viz-series-6)",
  "var(--viz-series-7)",
  "var(--viz-series-8)",
];

/** Single-hue ordered ramp for ordered stages (backlog → done). */
export const ORDINAL = [
  "var(--viz-ordinal-1)",
  "var(--viz-ordinal-2)",
  "var(--viz-ordinal-3)",
  "var(--viz-ordinal-4)",
  "var(--viz-ordinal-5)",
];

export const STATUS_COLOR = {
  good: "var(--viz-good)",
  warning: "var(--viz-warning)",
  serious: "var(--viz-serious)",
  critical: "var(--viz-critical)",
};

export const CHROME = {
  ink: "var(--viz-ink)",
  grid: "var(--viz-grid)",
  axis: "var(--viz-axis)",
  muted: "var(--viz-muted)",
  deemphasis: "var(--viz-deemphasis)",
  surface: "var(--viz-surface)",
};

export const AXIS_TICK = { fill: CHROME.muted, fontSize: 11 } as const;
