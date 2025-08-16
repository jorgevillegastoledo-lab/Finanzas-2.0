// src/ui/notifications.jsx  (versión sin Tailwind)
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import { createPortal } from "react-dom";

// Paleta y base de estilos de tu app
const COLORS = {
  bgCard: "#0e1626",
  border: "#1f2a44",
  text: "#e6f0ff",
  success: "#16a34a",
  error: "#ff3b30",
  warn: "#f59e0b",
  info: "#0ea5e9",
};

const ToneBox = {
  success: { background: COLORS.success, color: "#f0fff4", border: "1px solid rgba(0,0,0,.15)" },
  error:   { background: COLORS.error,   color: "#fff",    border: "1px solid rgba(0,0,0,.15)" },
  warning: { background: COLORS.warn,    color: "#111",    border: "1px solid rgba(0,0,0,.15)" },
  info:    { background: COLORS.info,    color: "#042029", border: "1px solid rgba(0,0,0,.15)" },
};

const styles = {
  // contenedor de toasts
  toastStack: {
    position: "fixed", top: 16, right: 16, zIndex: 10000,
    display: "flex", flexDirection: "column", gap: 10, pointerEvents: "none",
  },
  toast: {
    pointerEvents: "auto",
    maxWidth: 420, borderRadius: 14, padding: "10px 12px",
    boxShadow: "0 10px 30px rgba(0,0,0,.35)",
    backdropFilter: "blur(6px)", transition: "all .18s ease",
  },
  toastClose: {
    marginLeft: 8, border: 0, background: "transparent", color: "inherit",
    opacity: .85, cursor: "pointer", fontSize: 16, lineHeight: 1,
  },

  // overlay + cuadro de confirmación
  overlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 10001,
  },
  center: {
    position: "fixed", inset: 0, display: "grid", placeItems: "center", zIndex: 10002, padding: 16,
  },
  dialog: {
    width: "100%", maxWidth: 520, borderRadius: 14,
    background: COLORS.bgCard, color: COLORS.text, border: `1px solid ${COLORS.border}`,
    boxShadow: "0 20px 60px rgba(0,0,0,.5)",
  },
  dialogBody: { padding: 18 },
  dialogTitle: { fontSize: 18, fontWeight: 700 },
  dialogMsg: { marginTop: 8, opacity: .9, fontSize: 14 },
  dialogActions: { marginTop: 16, display: "flex", justifyContent: "flex-end", gap: 8 },

  // botones
  btn: {
    padding: "8px 12px", border: 0, borderRadius: 10, cursor: "pointer",
    color: "#fff", background: "#2e7d32",
  },
  btnGhost: {
    padding: "8px 12px", border: `1px solid ${COLORS.border}`, borderRadius: 10,
    cursor: "pointer", background: "transparent", color: COLORS.text,
  },
  btnDanger: {
    padding: "8px 12px", border: 0, borderRadius: 10, cursor: "pointer",
    color: "#fff", background: COLORS.error,
  },
};

// ---------------------------- Contexto ----------------------------
const Ctx = createContext(null);
export function useNotifications() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useNotifications debe usarse dentro de NotificationsProvider");
  return ctx;
}
export function useToast()   { return useNotifications().toast; }
export function useConfirm() { return useNotifications().confirm; }

// ------------------------- Provider / UI --------------------------
export function NotificationsProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState({ open: false });

  const remove = useCallback((id) => setToasts((t) => t.filter(x => x.id !== id)), []);
  const push = useCallback((opts) => {
    const id = Math.random().toString(36).slice(2);
    const item = { id, tone: opts.tone || "info", duration: opts.duration ?? 3200, ...opts };
    setToasts(t => [item, ...t]);
    if (item.duration > 0) setTimeout(() => remove(id), item.duration);
  }, [remove]);

  const showMsg = useCallback((tone, msg) => {
    if (typeof msg === "string") push({ title: msg, tone });
    else push({ ...msg, tone });
  }, [push]);

  const confirm = useCallback((opts = {}) =>
    new Promise((resolve) => setConfirmState({ open: true, resolve, opts })), []);

  const ctxValue = useMemo(() => ({
    toast: {
      show: push,
      success: (m) => showMsg("success", m),
      error:   (m) => showMsg("error", m),
      info:    (m) => showMsg("info", m),
      warning: (m) => showMsg("warning", m),
    },
    confirm,
  }), [push, showMsg, confirm]);

  return (
    <Ctx.Provider value={ctxValue}>
      {children}
      {createPortal(
        <>
          {/* Toasts */}
          <div style={styles.toastStack}>
            {toasts.map(t => (<Toast key={t.id} item={t} onClose={() => remove(t.id)} />))}
          </div>
          {/* Confirm */}
          <ConfirmDialog
            open={!!confirmState.open}
            opts={confirmState.opts}
            onClose={(v) => {
              const r = confirmState.resolve; setConfirmState({ open: false }); r?.(!!v);
            }}
          />
        </>,
        document.body
      )}
    </Ctx.Provider>
  );
}

function Toast({ item, onClose }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const t = requestAnimationFrame(() => setMounted(true)); return () => cancelAnimationFrame(t); }, []);
  const toneStyle = ToneBox[item.tone] || ToneBox.info;
  return (
    <div
      role="status" aria-live="polite"
      style={{
        ...styles.toast, ...toneStyle,
        opacity: mounted ? 1 : 0, transform: `translateY(${mounted ? 0 : 6}px)`,
      }}
    >
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}>
          {item.title && <div style={{ fontWeight: 700, lineHeight: 1.1 }}>{item.title}</div>}
          {item.description && <div style={{ marginTop: 4, fontSize: 13, opacity: .95 }}>{item.description}</div>}
          {item.action && (
            <button onClick={item.action.onClick} style={{ marginTop: 6, fontSize: 13, textDecoration: "underline" }}>
              {item.action.label}
            </button>
          )}
        </div>
        <button onClick={onClose} aria-label="Cerrar" style={styles.toastClose}>✕</button>
      </div>
    </div>
  );
}

function ConfirmDialog({ open, opts = {}, onClose }) {
  const lastActiveRef = useRef(null);
  useEffect(() => {
    if (open) {
      lastActiveRef.current = document.activeElement ?? null;
      const onKey = (e) => e.key === "Escape" && onClose(false);
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }
  }, [open, onClose]);
  useEffect(() => {
    if (!open && lastActiveRef.current) lastActiveRef.current.focus?.();
  }, [open]);

  if (!open) return null;
  const tone = opts.tone || "neutral";
  const okBtnStyle = tone === "danger" ? styles.btnDanger : styles.btn;

  return (
    <>
      <div style={styles.overlay} onClick={() => onClose(false)} />
      <div style={styles.center}>
        <div style={styles.dialog}>
          <div style={styles.dialogBody}>
            <div style={styles.dialogTitle}>{opts.title || "Confirmar"}</div>
            {opts.message && <div style={styles.dialogMsg}>{opts.message}</div>}
            <div style={styles.dialogActions}>
              <button style={styles.btnGhost} onClick={() => onClose(false)}>
                {opts.cancelText || "Cancelar"}
              </button>
              <button style={okBtnStyle} onClick={() => onClose(true)}>
                {opts.confirmText || "Aceptar"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
