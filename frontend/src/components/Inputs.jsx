import React from "react";

const baseInput = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #23304a",
  background: "#0e1626",
  color: "#e6f0ff",
  width: "100%",
};

const field = { display: "flex", flexDirection: "column", gap: 6, minWidth: 0 };
const label = { fontSize: 12, color: "#b8c6e3", opacity: 0.9 };

export function LabeledInput({ label: text, style, ...props }) {
  return (
    <div style={field}>
      <div style={label}>{text}</div>
      <input {...props} style={{ ...baseInput, ...(style || {}) }} />
    </div>
  );
}

export function LabeledSelect({ label: text, children, style, ...props }) {
  return (
    <div style={field}>
      <div style={label}>{text}</div>
      <select {...props} style={{ ...baseInput, ...(style || {}) }}>
        {children}
      </select>
    </div>
  );
}

export function LabeledCheckbox({ label: text, ...props }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#b8c6e3" }}>
      <input type="checkbox" {...props} />
      {text}
    </label>
  );
}
