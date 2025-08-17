// frontend/src/ui/Button.jsx
import React from "react";

const VARIANTS = {
  primary:  { bg:"#4CAF50", bgH:"#43A047", fg:"#0b1322" },   // verde
  secondary:{ bg:"#2b3a55", bgH:"#344766", fg:"#e6f0ff" },   // gris azulado
  info:     { bg:"#0ec3cc", bgH:"#0bb0b8", fg:"#0b1322" },   // cian
  danger:   { bg:"#ff3b30", bgH:"#e23328", fg:"#fff" },      // rojo
  ghost:    { bg:"transparent", bgH:"rgba(255,255,255,.08)", fg:"#e6f0ff", bd:"#2a3a56" },
};

const SIZES = {
  sm: { fontSize:13, padding:"6px 10px", minHeight:32, borderRadius:10 },
  md: { fontSize:14, padding:"8px 12px", minHeight:36, borderRadius:12 },
  lg: { fontSize:16, padding:"12px 16px", minHeight:44, borderRadius:14 },
};

export default function Button({
  variant="primary",
  size="md",
  fullWidth=false,
  disabled=false,
  style,
  children,
  ...props
}) {
  const v = VARIANTS[variant] || VARIANTS.primary;
  const s = SIZES[size] || SIZES.md;

  const base = {
    display:"inline-flex",
    alignItems:"center",
    justifyContent:"center",
    gap:8,
    fontWeight:700,
    lineHeight:1,
    cursor: disabled ? "not-allowed" : "pointer",
    border: v.bd ? `1px solid ${v.bd}` : "0",
    background: v.bg,
    color: v.fg,
    width: fullWidth ? "100%" : "auto",
    transition:"background .15s ease, transform .05s ease",
    ...s,
  };

  const hover = !disabled
    ? { filter:"none" }
    : { opacity:.6 };

  return (
    <button
      {...props}
      disabled={disabled}
      style={{ ...base, ...style }}
      onMouseEnter={e=>{ if(!disabled) e.currentTarget.style.background = v.bgH; }}
      onMouseLeave={e=>{ if(!disabled) e.currentTarget.style.background = v.bg; }}
      onMouseDown={e=>{ if(!disabled) e.currentTarget.style.transform = "translateY(1px)"; }}
      onMouseUp={e=>{ if(!disabled) e.currentTarget.style.transform = "translateY(0)"; }}
    >
      {children}
    </button>
  );
}
