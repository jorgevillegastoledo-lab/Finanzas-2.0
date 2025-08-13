// frontend/src/pages/Prestamos.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import AppShell, { ui } from "../components/AppShell";
import api from "../api/api";

const MESES = ["", "Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const hoy = new Date();
const MES_ACTUAL = hoy.getMonth() + 1;
const ANIO_ACTUAL = hoy.getFullYear();

const fmtCLP = (n) =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(Number(n || 0));

// Etiqueta arriba del campo
const L = ({ label, children }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    <span style={{ fontSize: 12, color: "#9db7d3", opacity: 0.9, padding: "0 2px" }}>{label}</span>
    {children}
  </div>
);

export default function Prestamos() {
  // Vista contable (para ocultar préstamos “no iniciados”)
  const [vMes, setVMes] = useState(MES_ACTUAL);
  const [vAnio, setVAnio] = useState(ANIO_ACTUAL);

  // Listado (usaremos /prestamos/resumen para traer totales calculados)
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // Crear préstamo
  const [nuevo, setNuevo] = useState({
    nombre: "", valor_cuota: "", cuotas_totales: "", primer_mes: "", primer_anio: "", banco: ""
  });

  // Selección / edición
  const [sel, setSel] = useState(null);
  const [edit, setEdit] = useState({
    valor_cuota: "", cuotas_totales: "", primer_mes: "", primer_anio: "", banco: ""
  });

  // Registrar pago
  const [pagoMes, setPagoMes] = useState(MES_ACTUAL);
  const [pagoAnio, setPagoAnio] = useState(ANIO_ACTUAL);
  const [pagoValor, setPagoValor] = useState("");

  const editRef = useRef(null);

  useEffect(() => { listar(); }, []);
  useEffect(() => {
    if (!sel) return;
    setEdit({
      valor_cuota: String(sel.valor_cuota ?? ""),
      cuotas_totales: String(sel.cuotas_totales ?? ""),
      primer_mes: String(sel.primer_mes ?? ""),
      primer_anio: String(sel.primer_anio ?? ""),
      banco: String(sel.banco ?? "")
    });
    setPagoValor(String(sel.valor_cuota ?? ""));
    // sugerir próximo mes contable
    const { mes, anio } = sugerirProximoPeriodo(sel, vMes, vAnio);
    setPagoMes(mes); setPagoAnio(anio);
    setTimeout(() => editRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }, [sel]);

  function sugerirProximoPeriodo(p, fallbackMes, fallbackAnio) {
    if (p?.ultimo_mes && p?.ultimo_anio) {
      const m = Number(p.ultimo_mes), a = Number(p.ultimo_anio);
      const nm = m === 12 ? 1 : m + 1;
      const na = m === 12 ? a + 1 : a;
      return { mes: nm, anio: na };
    }
    if (p?.primer_mes && p?.primer_anio) return { mes: Number(p.primer_mes), anio: Number(p.primer_anio) };
    return { mes: fallbackMes, anio: fallbackAnio };
  }

  async function listar() {
    try {
      setLoading(true); setErr("");
      // Trae resumen (incluye total_pagado, deuda_restante, ultimo_mes/ultimo_anio)
      const { data } = await api.get("/prestamos/resumen");
      const arr = Array.isArray(data) ? data : (data?.data ?? []);
      setItems(arr);
      if (sel) setSel(arr.find(x => x.id === sel.id) || null);
    } catch (e) {
      setErr(e?.response?.data?.detail || "No pude cargar préstamos");
    } finally {
      setLoading(false);
    }
  }

  // Oculta préstamos cuya vista (vMes/vAnio) esté antes del primer_mes/año
  const itemsFiltrados = useMemo(() => {
    return items.filter(p => {
      if (!p.primer_mes || !p.primer_anio) return true;
      return (vAnio > p.primer_anio) || (vAnio === p.primer_anio && vMes >= p.primer_mes);
    });
  }, [items, vMes, vAnio]);

  // Totales de la vista (usamos total_pagado/deuda_restante del resumen)
  const totales = useMemo(() => ({
    monto: itemsFiltrados.reduce((a,p)=>a + (Number(p.valor_cuota||0)*Number(p.cuotas_totales||0)), 0),
    pagado: itemsFiltrados.reduce((a,p)=>a + Number(p.total_pagado||0), 0),
    deuda: itemsFiltrados.reduce((a,p)=>a + Number(p.deuda_restante||0), 0),
  }), [itemsFiltrados]);

  async function crear() {
    if (!nuevo.nombre || !nuevo.valor_cuota || !nuevo.cuotas_totales) {
      alert("Nombre, valor cuota y cuotas totales son obligatorios.");
      return;
    }
    try {
      await api.post("/prestamos", {
        nombre: nuevo.nombre,
        valor_cuota: Number(nuevo.valor_cuota),
        cuotas_totales: Number(nuevo.cuotas_totales),
        banco: nuevo.banco || null,
        primer_mes: nuevo.primer_mes ? Number(nuevo.primer_mes) : null,
        primer_anio: nuevo.primer_anio ? Number(nuevo.primer_anio) : null,
      });
      setNuevo({ nombre:"", valor_cuota:"", cuotas_totales:"", primer_mes:"", primer_anio:"", banco:"" });
      await listar();
    } catch (e) {
      alert(e?.response?.data?.detail || "No pude crear el préstamo");
    }
  }

  async function guardarCambios() {
    if (!sel) return;
    try {
      await api.put(`/prestamos/${sel.id}`, {
        nombre: sel.nombre, // mantenemos nombre
        valor_cuota: edit.valor_cuota ? Number(edit.valor_cuota) : null,
        cuotas_totales: edit.cuotas_totales ? Number(edit.cuotas_totales) : null,
        primer_mes: edit.primer_mes ? Number(edit.primer_mes) : null,
        primer_anio: edit.primer_anio ? Number(edit.primer_anio) : null,
        banco: edit.banco || null
      });
      await listar();
    } catch (e) {
      alert(e?.response?.data?.detail || "No pude guardar cambios");
    }
  }

  // eliminar préstamo (y sus pagos)
  async function eliminarPrestamo() {
    if (!sel) return;
    if (!confirm("¿Eliminar este préstamo y todos sus pagos?")) return;
    try {
      await api.delete(`/prestamos/${sel.id}`);
      setSel(null);
      await listar();
    } catch (e) {
      alert(e?.response?.data?.detail || "No pude eliminar el préstamo");
    }
  }

  // Pago de cuota
  async function marcarPago() {
    if (!sel) return;
    try {
      await api.post(`/prestamos/${sel.id}/pagar`, {
        mes_contable: Number(pagoMes),
        anio_contable: Number(pagoAnio),
        monto_pagado: pagoValor ? Number(pagoValor) : undefined, // si no envías, backend usa valor_cuota
      });
      await listar();
    } catch (e) {
      alert(e?.response?.data?.detail || "No pude registrar el pago");
    }
  }

  return (
    <AppShell
      title="Préstamos"
      actions={<button style={ui.btn} onClick={listar}>Actualizar</button>}
    >
      {/* Vista contable */}
      <div style={ui.card}>
        <div style={{ fontWeight:700, marginBottom:12 }}>📅 Vista contable</div>
        <div style={{ display:"flex", gap:10, alignItems:"end" }}>
          <L label="Mes">
            <select value={vMes} onChange={e=>setVMes(Number(e.target.value))} style={styles.input}>
              {Array.from({length:12},(_,i)=>i+1).map(m=>(
                <option key={m} value={m}>{MESES[m]}</option>
              ))}
            </select>
          </L>
          <L label="Año">
            <input type="number" value={vAnio} onChange={e=>setVAnio(Number(e.target.value))} style={styles.input}/>
          </L>
          <div style={{ opacity:.9, marginLeft: 8 }}>
            Totales: <b>{fmtCLP(totales.deuda)}</b> deuda · pagado {fmtCLP(totales.pagado)} / total {fmtCLP(totales.monto)}
          </div>
        </div>
      </div>

      {/* Crear préstamo */}
      <div style={ui.card}>
        <div style={{ fontWeight:700, marginBottom:12 }}>➕ Agregar préstamo</div>
        <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr 2fr auto auto", gap:10, alignItems:"end" }}>
          <L label="Nombre">
            <input value={nuevo.nombre} onChange={e=>setNuevo({...nuevo, nombre:e.target.value})} style={styles.input}/>
          </L>
          <L label="Valor cuota">
            <input type="number" value={nuevo.valor_cuota} onChange={e=>setNuevo({...nuevo, valor_cuota:e.target.value})} style={styles.input}/>
          </L>
          <L label="Cuotas totales">
            <input type="number" value={nuevo.cuotas_totales} onChange={e=>setNuevo({...nuevo, cuotas_totales:e.target.value})} style={styles.input}/>
          </L>
          <L label="Mes inicial">
            <select value={nuevo.primer_mes} onChange={e=>setNuevo({...nuevo, primer_mes:e.target.value})} style={styles.input}>
              <option value="">—</option>
              {Array.from({length:12},(_,i)=>i+1).map(m=> <option key={m} value={m}>{MESES[m]}</option>)}
            </select>
          </L>
          <L label="Primer año">
            <input type="number" value={nuevo.primer_anio} onChange={e=>setNuevo({...nuevo, primer_anio:e.target.value})} style={styles.input}/>
          </L>
          <L label="Banco (opcional)">
            <input value={nuevo.banco} onChange={e=>setNuevo({...nuevo, banco:e.target.value})} style={styles.input}/>
          </L>
          <button style={ui.btn} onClick={crear}>Guardar</button>
          <button style={{ ...ui.btn, background:"#6c757d" }} onClick={()=>setNuevo({ nombre:"", valor_cuota:"", cuotas_totales:"", primer_mes:"", primer_anio:"", banco:"" })}>Limpiar</button>
        </div>
      </div>

      {/* Lista */}
      <div style={ui.card}>
        <div style={{ fontWeight:700, marginBottom:12 }}>📄 Préstamos</div>
        {loading ? (
          <div>Cargando…</div>
        ) : err ? (
          <div style={styles.error}>{err}</div>
        ) : itemsFiltrados.length === 0 ? (
          <div style={{ opacity:.8 }}>No hay préstamos para la vista {MESES[vMes]} {vAnio}.</div>
        ) : (
          <>
            <div style={{ overflowX:"auto" }}>
              <div style={{ maxHeight:"50vh", overflowY:"auto", border:"1px solid #1f2a44", borderRadius:12 }}>
                <table style={{ width:"100%", borderCollapse:"collapse" }}>
                  <thead>
                    <tr style={{ position:"sticky", top:0, background:"#0e1626", zIndex:1 }}>
                      <th style={styles.th}>ID</th>
                      <th style={styles.th}>Nombre</th>
                      <th style={styles.th}>Valor cuota</th>
                      <th style={styles.th}>Cuotas totales</th>
                      <th style={styles.th}>Cuotas pagadas</th>
                      <th style={styles.th}>Total pagado</th>
                      <th style={styles.th}>Deuda restante</th>
                      <th style={styles.th}>Último pago</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemsFiltrados.map(p => {
                      const selected = sel?.id === p.id;
                      return (
                        <tr key={p.id} onClick={()=>setSel(p)} style={{ ...styles.tr, background: selected ? "#1a253a" : "transparent" }}>
                          <td style={styles.td}>{p.id}</td>
                          <td style={styles.td}>{p.nombre}{p.banco ? ` — ${p.banco}` : ""}</td>
                          <td style={styles.td}>{fmtCLP(p.valor_cuota)}</td>
                          <td style={styles.td}>{p.cuotas_totales}</td>
                          <td style={styles.td}>{p.cuotas_pagadas ?? 0}</td>
                          <td style={styles.td}>{fmtCLP(p.total_pagado || 0)}</td>
                          <td style={styles.td}>{fmtCLP(p.deuda_restante || 0)}</td>
                          <td style={styles.td}>
                            {p.ultimo_mes && p.ultimo_anio ? `${MESES[p.ultimo_mes]} ${p.ultimo_anio}` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {!sel && <div style={{ marginTop:10, opacity:.7, fontSize:13 }}>
              Tip: clic en una fila para editar términos o registrar pago.
            </div>}
          </>
        )}
      </div>

      {/* Panel de edición / pago — solo con selección */}
      {sel && (
        <div style={ui.card} ref={editRef}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
            <div style={{ fontWeight:700 }}>✏️ Editar</div>
            <span style={{ fontSize:12, background:"#0e1626", padding:"4px 8px", borderRadius:6 }}>
              ID {sel.id} — {sel.nombre}
            </span>
            <button onClick={()=>setSel(null)} style={{ marginLeft:"auto", textDecoration:"underline", opacity:.8 }}>
              Limpiar selección
            </button>
          </div>

          {/* Añadimos etiquetas: */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr 2fr auto auto", gap:10, alignItems:"end" }}>
            <L label="Valor cuota">
              <input
                type="number"
                value={edit.valor_cuota}
                onChange={e=>setEdit({...edit, valor_cuota:e.target.value})}
                style={styles.input}
              />
            </L>
            <L label="Cuotas totales">
              <input
                type="number"
                value={edit.cuotas_totales}
                onChange={e=>setEdit({...edit, cuotas_totales:e.target.value})}
                style={styles.input}
              />
            </L>
            <L label="Mes inicial">
              <select
                value={edit.primer_mes || ""}
                onChange={e=>setEdit({...edit, primer_mes:e.target.value})}
                style={styles.input}
              >
                <option value="">—</option>
                {Array.from({length:12},(_,i)=>i+1).map(m=> <option key={m} value={m}>{MESES[m]}</option>)}
              </select>
            </L>
            <L label="Primer año">
              <input
                type="number"
                value={edit.primer_anio || ""}
                onChange={e=>setEdit({...edit, primer_anio:e.target.value})}
                style={styles.input}
              />
            </L>
            <L label="Banco (opcional)">
              <input
                value={edit.banco || ""}
                onChange={e=>setEdit({...edit, banco:e.target.value})}
                style={styles.input}
              />
            </L>
            <button onClick={guardarCambios} style={ui.btn}>Guardar cambios</button>
            <button onClick={eliminarPrestamo} style={{ ...ui.btn, background:"#ff3b30" }}>Eliminar</button>
          </div>

          <div style={{ marginTop:16 }}>
            <div style={{ fontWeight:700, marginBottom:8 }}>🧾 Registrar pago de cuota</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr auto", gap:10, alignItems:"end" }}>
              <L label="Mes contable">
                <select value={pagoMes} onChange={e=>setPagoMes(Number(e.target.value))} style={styles.input}>
                  {Array.from({length:12},(_,i)=>i+1).map(m=> <option key={m} value={m}>{MESES[m]}</option>)}
                </select>
              </L>
              <L label="Año contable">
                <input type="number" value={pagoAnio} onChange={e=>setPagoAnio(Number(e.target.value))} style={styles.input}/>
              </L>
              <L label="Monto pagado (opcional)">
                <input type="number" value={pagoValor} onChange={e=>setPagoValor(e.target.value)} style={styles.input}/>
              </L>
              <button type="button" onClick={marcarPago} style={{ ...ui.btn, background:"#1e90ff" }}>
                Marcar cuota como pagada ({fmtCLP(pagoValor || sel.valor_cuota)})
              </button>
            </div>
            <div style={{ marginTop:8, fontSize:12, opacity:.75 }}>
              Último pago: {sel.ultimo_mes && sel.ultimo_anio ? `${MESES[sel.ultimo_mes]} ${sel.ultimo_anio}` : "—"} ·
              Pagado {fmtCLP(sel.total_pagado || 0)} / Total {fmtCLP((sel.valor_cuota||0) * (sel.cuotas_totales||0))} · Deuda {fmtCLP(sel.deuda_restante || 0)}
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

const styles = {
  input: { padding:"8px 10px", borderRadius:8, border:"1px solid #23304a", background:"#0e1626", color:"#e6f0ff" },
  th: { textAlign:"left", padding:"10px 8px", borderBottom:"1px solid #1f2a44", whiteSpace:"nowrap" },
  td: { padding:"8px", borderBottom:"1px solid #1f2a44", whiteSpace:"nowrap" },
  tr: { cursor:"pointer" },
  error: { background:"#ff3b30", color:"#fff", padding:"8px 10px", borderRadius:8 },
};