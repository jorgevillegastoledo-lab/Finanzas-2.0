import React, { useEffect, useMemo, useRef, useState } from "react";
import api from "../api/api";

/**
 * Modal de búsqueda avanzada de Conceptos
 *
 * Props:
 * - open: boolean
 * - onClose: () => void
 * - onPick: (concepto) => void
 * - allowCreate: boolean (default true)
 */
export default function ConceptoFinderModal({ open, onClose, onPick, allowCreate = true }) {
  const [q, setQ] = useState("");
  const [categoria, setCategoria] = useState("");
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Crear concepto
  const [newOpen, setNewOpen] = useState(false);
  const [newNombre, setNewNombre] = useState("");
  const [newNota, setNewNota] = useState("");
  const firstLoadRef = useRef(true);

  useEffect(() => {
    if (!open) return;
    // reset estado cada vez que se abre
    setPage(1);
    if (firstLoadRef.current) {
      firstLoadRef.current = false;
    }
    fetchData(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function fetchData(p = page) {
    if (!open) return;
    try {
      setBusy(true);
      const params = {
        q: q || "",
        page: p,
        page_size: pageSize,
      };
      if (categoria) params.categoria = categoria;
      if (tag) params.tag = tag;

      const { data } = await api.get("/conceptos", { params: { q, page: p, page_size: pageSize } });

      // Soporta 2 formatos:
      // 1) { data:[...], total, page, page_size }
      // 2) [...array]
      let arr = [];
      let t = 0, pg = p, ps = pageSize;
      if (Array.isArray(data)) {
        arr = data;
        t = data.length;
      } else {
        arr = Array.isArray(data?.data) ? data.data : [];
        t = Number(data?.total || 0);
        pg = Number(data?.page || p);
        ps = Number(data?.page_size || pageSize);
      }
      setRows(arr);
      setTotal(t);
      setPage(pg);
      setPageSize(ps);
    } catch (e) {
      setRows([]);
      setTotal(0);
    } finally {
      setBusy(false);
    }
  }

  function totalPages() {
    if (!pageSize) return 1;
    return Math.max(1, Math.ceil((total || 0) / pageSize));
  }

  function pick(it) {
    onPick?.(it);
    onClose?.();
  }

  async function createConcept() {
    if (!newNombre.trim()) return;
    try {
      setBusy(true);
      const payload = { nombre: newNombre.trim() };
      if (newNota.trim()) payload.nota = newNota.trim();

      const { data } = await api.post("/conceptos", payload);
      // Normaliza respuesta
      const created = Array.isArray(data?.data) ? data.data[0] : (data?.data || data);
      // cerrar y devolver seleccionado
      onPick?.(created);
      setNewNombre(""); setNewNota(""); setNewOpen(false);
      onClose?.();
    } catch (e) {
      // en caso de error, simplemente recargar lista y dejar el formulario abierto
      await fetchData(1);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.modal} onClick={(e)=>e.stopPropagation()}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
          <div style={{ fontWeight:700, fontSize:16 }}>🔎 Buscar concepto</div>
          <div style={{ marginLeft:"auto", opacity:.75, fontSize:12 }}>
            {busy ? "Cargando…" : `Resultados: ${total}`}
          </div>
        </div>

        {/* Controles */}
        <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1fr auto", gap:8, marginBottom:10 }}>
          <input
            placeholder="Nombre o texto…"
            value={q}
            onChange={(e)=>setQ(e.target.value)}
            style={styles.input}
            onKeyDown={(e)=>{ if (e.key==="Enter") fetchData(1); }}
          />
          <input
            placeholder="Categoría (opcional)"
            value={categoria}
            onChange={(e)=>setCategoria(e.target.value)}
            style={styles.input}
          />
          <input
            placeholder="Etiqueta/Tag (opcional)"
            value={tag}
            onChange={(e)=>setTag(e.target.value)}
            style={styles.input}
          />
          <div style={{ display:"flex", gap:8 }}>
            <button style={styles.btn} onClick={()=>fetchData(1)}>Buscar</button>
            <button style={{ ...styles.btn, background:"#6c757d" }} onClick={()=>{
              setQ(""); setCategoria(""); setTag(""); fetchData(1);
            }}>Limpiar</button>
          </div>
        </div>

        {/* Lista */}
        <div style={{ border:"1px solid #1f2a44", borderRadius:10, overflow:"hidden" }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr style={{ background:"#0e1626" }}>
                <th style={styles.th}>ID</th>
                <th style={styles.th}>Nombre</th>
                <th style={styles.th}>Nota</th>
                <th style={styles.th} />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={4} style={{ padding:12, opacity:.7 }}>Sin resultados…</td></tr>
              ) : rows.map((it) => (
                <tr key={it.id} style={{ borderTop:"1px solid #1f2a44" }}>
                  <td style={styles.td}>{it.id}</td>
                  <td style={styles.td}>{it.nombre}</td>
                  <td style={styles.td} title={it.nota || ""}>{it.nota || "—"}</td>
                  <td style={styles.td}>
                    <button style={{ ...styles.btn, padding:"6px 10px" }} onClick={()=>pick(it)}>Seleccionar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Paginación */}
        <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:10 }}>
          <button
            style={{ ...styles.btn, background:"#24324a" }}
            disabled={page<=1}
            onClick={()=>{ const p=Math.max(1,page-1); setPage(p); fetchData(p); }}
          >‹ Anterior</button>
          <div style={{ opacity:.85 }}>Página {page} / {totalPages()}</div>
          <button
            style={{ ...styles.btn, background:"#24324a" }}
            disabled={page>=totalPages()}
            onClick={()=>{ const p=Math.min(totalPages(),page+1); setPage(p); fetchData(p); }}
          >Siguiente ›</button>

          <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:6 }}>
            <span style={{ opacity:.75, fontSize:12 }}>Por página</span>
            <select
              value={pageSize}
              onChange={(e)=>{ const ps=Number(e.target.value); setPageSize(ps); setPage(1); fetchData(1); }}
              style={styles.input}
            >
              {[10,20,30,50].map(n=><option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>

        {/* Crear nuevo */}
        {/* Nota cuando no se permite crear desde aquí */}
        {!allowCreate && (
        <div style={{ marginTop:14, borderTop:"1px solid #1f2a44", paddingTop:12, fontSize:13, opacity:.85 }}>
            Para crear conceptos nuevos, dirígete a <b>Maestros &gt; Conceptos</b>.
       </div>
        )}


        <div style={{ marginTop:12, display:"flex", justifyContent:"flex-end", gap:8 }}>
          <button style={{ ...styles.btn, background:"#6c757d" }} onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  backdrop: {
    position:"fixed", inset:0, background:"rgba(0,0,0,.55)",
    display:"flex", alignItems:"center", justifyContent:"center", zIndex:60, padding:16,
  },
  modal: {
    width:"min(1100px,96vw)", background:"#0b1322", color:"#e6f0ff",
    border:"1px solid #1f2a44", borderRadius:12, padding:14, boxShadow:"0 40px 120px rgba(0,0,0,.55)"
  },
  input: {
    padding:"8px 10px", borderRadius:8, border:"1px solid #23304a", background:"#0e1626", color:"#e6f0ff",
  },
  th: { textAlign:"left", padding:"10px 8px", whiteSpace:"nowrap" },
  td: { padding:"8px" },
  btn: {
    padding:"8px 12px", border:0, borderRadius:8, background:"#27ae60",
    color:"#fff", fontWeight:700, cursor:"pointer"
  },
};
