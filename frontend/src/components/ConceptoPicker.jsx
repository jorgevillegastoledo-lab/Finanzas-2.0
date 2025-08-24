// frontend/src/components/ConceptoPicker.jsx
import React, { useEffect, useRef, useState } from "react";
import api from "../api/api";

/**
 * Autocompletado para seleccionar un Concepto (tabla public.conceptos).
 *
 * Props:
 *  - value: objeto concepto seleccionado o null
 *  - onChange(concept|null): callback cuando selecciona/borra
 *  - placeholder?: string
 *  - autoFocus?: boolean
 */
export default function ConceptoPicker({ value, onChange, placeholder = "Escribe para buscar…", autoFocus = false }) {
  const [q, setQ] = useState(value?.nombre || "");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [idx, setIdx] = useState(-1);
  const wrapRef = useRef(null);
  const listRef = useRef(null);
  const debounceRef = useRef();

  // util: normaliza para comparación sin acentos/mayúsculas
  const norm = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();

  // refleja cambio externo del valor
  useEffect(() => {
    setQ(value?.nombre || "");
  }, [value?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // cerrar dropdown al click fuera
  useEffect(() => {
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, []);

  // búsqueda con debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    // si el texto coincide exactamente con el seleccionado, no buscar
    if (value?.nombre && q.trim() === value.nombre) {
      setItems([]);
      return;
    }
    if (!q || q.trim().length < 1) {
      setItems([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        setLoading(true);
        const { data } = await api.get("/conceptos", {
          params: { q: q.trim(), activos: true, limit: 10 }
        });
        const server = Array.isArray(data) ? data : (data?.data ?? []);

        // FILTRO LOCAL de respaldo (case/acentos-insensitive)
        const nq = norm(q);
        const filtered = server.filter((c) => norm(c?.nombre).includes(nq));

        setItems(filtered);
        setIdx(filtered.length ? 0 : -1);
      } catch {
        setItems([]);
        setIdx(-1);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, value?.nombre]);

  function selectItem(it) {
    onChange?.(it || null);
    setQ(it?.nombre || "");
    setOpen(false);
  }

  function onKeyDown(e) {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setOpen(true);
      return;
    }
    if (!open) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIdx((i) => Math.min(i + 1, items.length - 1));
      scrollIntoView(idx + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIdx((i) => Math.max(i - 1, 0));
      scrollIntoView(Math.max(idx - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (idx >= 0 && idx < items.length) selectItem(items[idx]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  function scrollIntoView(index) {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector(`[data-idx="${index}"]`);
    if (!el) return;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    const viewTop = list.scrollTop;
    const viewBottom = viewTop + list.clientHeight;
    if (top < viewTop) list.scrollTop = top;
    else if (bottom > viewBottom) list.scrollTop = bottom - list.clientHeight;
  }

  const showClear = !!(q || value);

  return (
    <div ref={wrapRef} style={styles.wrapper}>
      <div style={styles.inputWrap}>
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); onChange?.(null); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          autoFocus={autoFocus}
          style={styles.input}
          aria-label="Buscar concepto"
        />
        {showClear && (
          <button
            type="button"
            onClick={() => { setQ(""); onChange?.(null); setOpen(true); }}
            title="Limpiar"
            style={styles.clearBtn}
          >
            ✕
          </button>
        )}
      </div>

      {open && (
        <div style={styles.popup} role="listbox" ref={listRef}>
          {loading && <div style={styles.itemMuted}>Buscando…</div>}

          {!loading && items.length === 0 && q.trim() !== (value?.nombre || "") && (
            <div style={styles.itemMuted}>
              Sin resultados. Crea/activa el concepto en <b>Maestros → Conceptos</b>.
            </div>
          )}

          {!loading && items.map((it, i) => (
            <button
              type="button"
              key={it.id}
              data-idx={i}
              onClick={() => selectItem(it)}
              style={{
                ...styles.item,
                background: i === idx ? "#1a253a" : "transparent",
              }}
            >
              <div style={{ fontWeight: 700 }}>{it.nombre}</div>
              <div style={{ fontSize: 12, opacity: .8 }}>
                {it.categoria || "—"} · {it.tipo_concepto || "normal"}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const styles = {
  // asegura que el componente ocupe exactamente la columna del grid
  wrapper: {
    position: "relative",
    width: "100%",
  },
  inputWrap: {
    position: "relative",
    width: "100%",
  },
  input: {
    width: "100%",
    padding: "8px 34px 8px 10px",
    borderRadius: 8,
    border: "1px solid #23304a",
    background: "#0e1626",
    color: "#e6f0ff",
    boxSizing: "border-box"   // <-- evita 'corrimientos'
  },
  clearBtn: {
    position: "absolute",
    right: 6,
    top: 6,
    border: 0,
    background: "transparent",
    color: "#b9c3d6",
    cursor: "pointer",
    fontSize: 16,
    lineHeight: 1
  },
  popup: {
    position: "absolute",
    zIndex: 30,               // <-- por encima sin empujar layout
    top: "100%",
    left: 0,
    right: 0,
    marginTop: 4,
    background: "#0e1626",
    border: "1px solid #24324a",
    borderRadius: 10,
    boxShadow: "0 12px 30px rgba(0,0,0,.45)",
    maxHeight: 260,
    overflowY: "auto"
  },
  item: {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "8px 10px",
    border: 0,
    background: "transparent",
    color: "#e6f0ff",
    cursor: "pointer"
  },
  itemMuted: {
    padding: "10px",
    fontSize: 13,
    opacity: .8
  }
};

