// frontend/src/pages/FacturacionTarjetas.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import AppShell, { ui } from "../components/AppShell";
import api from "../api/api";
import { useToast, useConfirm } from "../ui/notifications";
import Button from "../ui/Button";

const MESES = ["","Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const hoy = new Date();
const MES_ACTUAL = hoy.getMonth() + 1;
const ANIO_ACTUAL = hoy.getFullYear();

const fmtCLP = (n) =>
  new Intl.NumberFormat("es-CL", { style:"currency", currency:"CLP", maximumFractionDigits:0 }).format(Number(n || 0));

const fmtError = (e) => e?.response?.data?.detail || e?.message || String(e);

// Etiqueta arriba del campo
const L = ({ label, children }) => (
  <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
    <span style={{ fontSize:12, color:"#9db7d3", opacity:.9, padding:"0 2px" }}>{label}</span>
    {children}
  </div>
);

export default function FacturacionTarjetas() {
  const { success, error, warning } = useToast();
  const confirm = useConfirm();

  // ───── datos base
  const [tarjetas, setTarjetas] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // ───── vista contable
  const [vMes, setVMes] = useState(MES_ACTUAL);
  const [vAnio, setVAnio] = useState(ANIO_ACTUAL);
  const [fTarjeta, setFTarjeta] = useState(""); // filtro de tarjeta (a la derecha)

  // ───── crear (inicializado con TODOS los campos usados)
  const emptyNuevo = {
    tarjeta_id: "",
    mes: String(MES_ACTUAL),
    anio: String(ANIO_ACTUAL),
    fecha_emision: "",
    fecha_vencimiento: "",
    total_pagar: "",
    pago_minimo: "",
    nro_estado: "",
  };
  const [nuevo, setNuevo] = useState(emptyNuevo);
  const [savingNew, setSavingNew] = useState(false);

  // ───── selección / edición
  const [sel, setSel] = useState(null);
  const [edit, setEdit] = useState({
    tarjeta_id:"", mes:"", anio:"",
    fecha_emision:"", fecha_vencimiento:"",
    total_pagar:"", pago_minimo:"",
    nro_estado:"", nota:"",
    pagado:false, monto_pagado:"", fecha_pago:""
  });
  const editRef = useRef(null);

  // ───── menú contextual
  const [menu, setMenu] = useState({ show:false, x:0, y:0, target:null, openedAt:0 });
  const menuRef = useRef(null);
  useEffect(() => {
    const onDown = (e) => e.key === "Escape" && setMenu(m => ({ ...m, show:false }));
    const onClick = (e) => {
      setMenu(m => {
        if (!m.show) return m;
        if (Date.now() - (m.openedAt || 0) < 150) return { ...m, openedAt:0 };
        if (menuRef.current && menuRef.current.contains(e.target)) return m;
        return { ...m, show:false };
      });
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("click", onClick);
    return () => { window.removeEventListener("keydown", onDown); window.removeEventListener("click", onClick); };
  }, []);
  const openMenu = (e, row) => { e.preventDefault?.(); e.stopPropagation?.(); setMenu({ show:true, x:e.clientX, y:e.clientY, target:row, openedAt:Date.now() }); };
  const openEditor = (row) => { const r = row || menu.target; if (!r) return; setMenu(m=>({ ...m, show:false })); setSel(r); setTimeout(()=>editRef.current?.scrollIntoView({ behavior:"smooth", block:"start" }),0); };

  // ───── detalles (modal mini: nro_estado + nota)
  const [detOpen, setDetOpen] = useState(false);
  const [detBusy, setDetBusy] = useState(false);
  const [detNro, setDetNro] = useState("");
  const [detNota, setDetNota] = useState("");

  const tarjetaLabel = (obj) =>
    (obj.banco ? `${obj.banco} — ` : "") + (obj.tarjeta || obj.nombre || `Tarjeta ${obj.tarjeta_id ?? obj.id ?? ""}`);

  // ───── cargas
  useEffect(() => { loadTarjetas(); }, []);
  useEffect(() => { loadEstados(); /* eslint-disable-next-line */ }, [vMes, vAnio, fTarjeta]);

  async function loadTarjetas() {
    try {
      const { data } = await api.get("/tarjetas");
      setTarjetas(Array.isArray(data) ? data : (data?.data ?? []));
    } catch {}
  }
  async function loadEstados() {
    try {
      setErr(""); setLoading(true);
      const { data } = await api.get("/facturas", {
        params:{ mes:Number(vMes), anio:Number(vAnio), tarjeta_id: fTarjeta || undefined }
      });
      const arr = Array.isArray(data) ? data : (data?.data ?? []);
      setItems(arr);
      if (sel) setSel(arr.find(x=>x.id === sel.id) || null);
    } catch (e) {
      const msg = fmtError(e) || "No pude cargar estados";
      setErr(msg); error({ title:"Error al cargar", description:msg });
    } finally { setLoading(false); }
  }

  // ───── totales de la vista
  const totales = useMemo(() => {
    const total = items.reduce((a,i)=>a + Number(i.total_pagar||0), 0);
    const pagado = items.reduce((a,i)=>a + Number(i.monto_pagado||0), 0);
    return { total, pagado, pend: total - pagado };
  }, [items]);

  // ───── crear
  async function crearEstado(e) {
    e?.preventDefault?.();
    if (!nuevo.tarjeta_id || !nuevo.total_pagar) {
      warning("Tarjeta y Total a pagar son obligatorios.");
      return;
    }
    try {
      setSavingNew(true);
      await api.post("/facturas", {
        tarjeta_id: Number(nuevo.tarjeta_id),
        mes: nuevo.mes ? Number(nuevo.mes) : null,
        anio: nuevo.anio ? Number(nuevo.anio) : null,
        fecha_emision: nuevo.fecha_emision || null,
        fecha_vencimiento: nuevo.fecha_vencimiento || null,
        total_pagar: Number(nuevo.total_pagar),
        pago_minimo: nuevo.pago_minimo !== "" ? Number(nuevo.pago_minimo) : null,
        nro_estado: (nuevo.nro_estado || "").trim() || null,
      });
      setNuevo(emptyNuevo);
      await loadEstados();
      success("Estado creado");
    } catch (e) {
      error({ title:"No pude crear el estado", description:fmtError(e) });
    } finally { setSavingNew(false); }
  }

  // ───── selección → editar
  useEffect(() => {
    if (!sel) return;
    setEdit({
      tarjeta_id: String(sel.tarjeta_id ?? ""),
      mes: String(sel.mes ?? ""),
      anio: String(sel.anio ?? ""),
      fecha_emision: sel.fecha_emision || "",
      fecha_vencimiento: sel.fecha_vencimiento || "",
      total_pagar: String(sel.total_pagar ?? ""),
      pago_minimo: String(sel.pago_minimo ?? ""),
      nro_estado: String(sel.nro_estado ?? ""),
      nota: String(sel.nota ?? ""),
      pagado: !!sel.pagado,
      monto_pagado: String(sel.monto_pagado ?? ""),
      fecha_pago: sel.fecha_pago || "",
    });
  }, [sel]);

  async function guardar() {
    if (!sel) return;
    try {
      await api.put(`/facturas/${sel.id}`, {
        tarjeta_id: edit.tarjeta_id ? Number(edit.tarjeta_id) : null,
        mes: edit.mes ? Number(edit.mes) : null,
        anio: edit.anio ? Number(edit.anio) : null,
        fecha_emision: edit.fecha_emision || null,
        fecha_vencimiento: edit.fecha_vencimiento || null,
        total_pagar: edit.total_pagar !== "" ? Number(edit.total_pagar) : null,
        pago_minimo: edit.pago_minimo !== "" ? Number(edit.pago_minimo) : null,
        nro_estado: (edit.nro_estado || "").trim() || null,
        nota: (edit.nota || "").trim() || null,
        pagado: !!edit.pagado,
        monto_pagado: edit.monto_pagado !== "" ? Number(edit.monto_pagado) : null,
        fecha_pago: edit.fecha_pago || null,
      });
      await loadEstados(); success("Cambios guardados");
    } catch (e) {
      error({ title:"No pude guardar cambios", description:fmtError(e) });
    }
  }

  async function eliminarEstado() {
    if (!sel) return;
    const ok = await confirm({ title:"¿Eliminar estado?", message:"Esta acción no se puede deshacer.", confirmText:"Eliminar", tone:"danger" });
    if (!ok) return;
    try {
      await api.delete(`/facturas/${sel.id}`);
      setSel(null); await loadEstados();
      success("Estado eliminado");
    } catch (e) {
      error({ title:"No pude eliminar", description:fmtError(e) });
    }
  }

  async function marcarPagado() {
    if (!sel) return;
    try {
      const monto = edit.monto_pagado ? Number(edit.monto_pagado) : Number(sel.total_pagar || 0);
      const fecha = edit.fecha_pago || new Date().toISOString().slice(0,10);
      await api.post(`/facturas/${sel.id}/pagar`, { monto_pagado:monto, fecha_pago:fecha });
      await loadEstados(); success("Pago registrado");
    } catch (e) {
      error({ title:"No pude registrar el pago", description:fmtError(e) });
    }
  }

  async function deshacerPago() {
    if (!sel) return;
    try {
      await api.put(`/facturas/${sel.id}`, { pagado:false, monto_pagado:null, fecha_pago:null });
      await loadEstados(); success("Pago deshecho");
    } catch (e) {
      error({ title:"No pude deshacer el pago", description:fmtError(e) });
    }
  }

  // ───── Detalles (nro_estado + nota) en modal
  function abrirDetallesDesde(selRow) {
    const r = selRow || sel || menu.target;
    if (!r) { warning("Primero selecciona un estado."); return; }
    setDetNro(String(r.nro_estado ?? ""));
    setDetNota(String(r.nota ?? ""));
    setMenu(m=>({ ...m, show:false }));
    setDetOpen(true);
  }
  async function guardarDetalles() {
    if (!sel && !menu.target) return;
    const id = sel?.id ?? menu.target?.id;
    if (!id) return;
    try {
      setDetBusy(true);
      await api.put(`/facturas/${id}`, {
        nro_estado: (detNro || "").trim() || null,
        nota: (detNota || "").trim() || null
      });
      setDetOpen(false); await loadEstados();
      success("Detalles guardados");
    } catch (e) {
      error({ title:"No pude guardar el detalle", description:fmtError(e) });
    } finally { setDetBusy(false); }
  }

  return (
    <AppShell title="Facturación tarjetas" actions={<button style={ui.btn} onClick={loadEstados}>Actualizar</button>}>

      {/* Vista contable (Mes, Año, Tarjeta) */}
      <div style={ui.card}>
        <div style={{ fontWeight:700, marginBottom:12 }}>📅 Vista contable</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 2fr", gap:10, alignItems:"end" }}>
          <div style={{ display:"flex", gap:10, alignItems:"end" }}>
            <L label="Mes">
              <select value={vMes} onChange={e=>setVMes(Number(e.target.value))} style={styles.input}>
                {Array.from({length:12},(_,i)=>i+1).map(m=>(<option key={m} value={m}>{MESES[m]}</option>))}
              </select>
            </L>
            <L label="Año">
              <input type="number" value={vAnio} onChange={e=>setVAnio(Number(e.target.value))} style={styles.input}/>
            </L>
          </div>

          {/* Totales al centro */}
          <div style={{ opacity:.9, alignSelf:"center" }}>
            Totales: pagado {fmtCLP(totales.pagado)} / total {fmtCLP(totales.total)} · pendiente <b>{fmtCLP(totales.pend)}</b>
          </div>

          {/* Filtro de Tarjeta a la derecha */}
          <div style={{ justifySelf:"end", width:"100%", maxWidth:380 }}>
            <L label="Tarjeta (filtro)">
              <select value={fTarjeta} onChange={(e)=>setFTarjeta(e.target.value)} style={styles.input}>
                <option value="">Todas</option>
                {tarjetas.map(t => <option key={t.id} value={t.id}>{tarjetaLabel(t)}</option>)}
              </select>
            </L>
          </div>
        </div>
        {err && <div style={{ marginTop:10, ...styles.error }}>{err}</div>}
      </div>

      {/* Agregar estado */}
      <div style={ui.card}>
        <div style={{ fontWeight:700, marginBottom:12 }}>➕ Agregar estado</div>
        <form onSubmit={crearEstado} style={{ display:"grid", gridTemplateColumns:"1.6fr .8fr .8fr 1fr 1fr auto", gap:10, alignItems:"end" }}>
          <L label="Tarjeta">
            <select value={nuevo.tarjeta_id} onChange={e=>setNuevo({ ...nuevo, tarjeta_id:e.target.value })} style={styles.input}>
              <option value="">Selecciona…</option>
              {tarjetas.map(t => <option key={t.id} value={t.id}>{tarjetaLabel(t)}</option>)}
            </select>
          </L>
          <L label="Mes">
            <select value={nuevo.mes} onChange={e=>setNuevo({ ...nuevo, mes:e.target.value })} style={styles.input}>
              {Array.from({ length:12 }, (_,i)=>i+1).map(m => <option key={m} value={m}>{MESES[m]}</option>)}
            </select>
          </L>
          <L label="Año"><input type="number" value={nuevo.anio} onChange={e=>setNuevo({ ...nuevo, anio:e.target.value })} style={styles.input}/></L>
          <L label="Emisión"><input type="date" value={nuevo.fecha_emision} onChange={e=>setNuevo({ ...nuevo, fecha_emision:e.target.value })} style={styles.input}/></L>
          <L label="Total Facturado"><input type="number" value={nuevo.total_pagar} onChange={e=>setNuevo({ ...nuevo, total_pagar:e.target.value })} style={styles.input}/></L>
          <button type="submit" style={ui.btn} disabled={savingNew}>{savingNew ? "Guardando..." : "Guardar"}</button>
        </form>
      </div>

      {/* Lista */}
      <div style={ui.card}>
        <div style={{ fontWeight:700, marginBottom:12 }}>🧾 Facturas</div>

        {loading ? (
          <div>Cargando…</div>
        ) : items.length === 0 ? (
          <div style={{ opacity:.8 }}>No hay Facturas para la vista seleccionada.</div>
        ) : (
          <>
            <div style={{ overflowX:"auto" }}>
              <div style={{ maxHeight:"50vh", overflowY:"auto", border:"1px solid #1f2a44", borderRadius:12 }}>
                <table style={{ width:"100%", borderCollapse:"collapse" }}>
                  <thead>
                    <tr style={{ position:"sticky", top:0, background:"#0e1626", zIndex:1 }}>
                      <th style={styles.th}>ID</th>
                      <th style={styles.th}>Tarjeta</th>
                      <th style={styles.th}>Mes</th>
                      <th style={styles.th}>Año</th>
                      <th style={styles.th}>Total</th>
                      <th style={styles.th}>Pagada</th>
                      <th style={styles.th}>Fecha pago</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(r => {
                      const total = Number(r.total_pagar ?? r.total ?? r.monto_total ?? 0);
                      const pagada =
                        typeof r.pagada !== "undefined"
                          ? (r.pagada === true || r.pagada === 1 || r.pagada === "1")
                          : (Number(r.monto_pagado ?? 0) >= total && total > 0);

                      const selected = sel?.id === r.id;

                      return (
                        <tr
                          key={r.id}
                          onClick={(e) => openMenu(e, r)}
                          onContextMenu={(e) => openMenu(e, r)}
                          style={{ ...styles.tr, background: selected ? "#1a253a" : "transparent", cursor: "pointer" }}
                          title="Click o clic derecho para acciones"
                        >
                          <td style={styles.td}>{r.id}</td>
                          <td style={styles.td}>{r.tarjeta_nombre || tarjetaLabel({ ...r, id: r.tarjeta_id })}</td>
                          <td style={styles.td}>{MESES[r.mes] || "—"}</td>
                          <td style={styles.td}>{r.anio ?? "—"}</td>
                          <td style={styles.td}>{fmtCLP(total)}</td>
                          <td style={styles.td}>{pagada ? "Sí" : "No"}</td>
                          <td style={styles.td}>{r.fecha_pago || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ fontSize:12, opacity:.7, marginTop:8 }}>
              Tip: clic en una fila para editar, eliminar o marcar/deshacer pago.
            </div>
          </>
        )}
      </div>

      {/* Menú contextual (flotante, fuera de la tarjeta) */}
      {menu.show && (
        <div
          ref={menuRef}
          style={{
            position:"fixed", top:menu.y+8, left:menu.x+8,
            background:"#0e1626", border:"1px solid #24324a",
            borderRadius:10, boxShadow:"0 8px 30px rgba(0,0,0,.4)", zIndex:50, minWidth:220
          }}
        >
          <div style={{ padding:10, borderBottom:"1px solid #1f2a44", fontSize:12, opacity:.8 }}>
            ID {menu.target?.id} — {menu.target?.tarjeta_nombre || tarjetaLabel({ ...menu.target, id:menu.target?.tarjeta_id })}
          </div>
          <button onClick={()=>abrirDetallesDesde(menu.target)} style={styles.menuItem}>📄 Ver detalles</button>
          <button onClick={()=>openEditor()} style={{ ...styles.menuItem, borderTop:"1px solid #1f2a44" }}>✏️ Editar / Eliminar</button>
        </div>
      )}

      {!sel && <div style={{ marginTop:10, opacity:.7, fontSize:13 }}>Tip: haz clic en una fila para abrir el menú de acciones.</div>}

      {/* Editor / Pago */}
      {sel && (
        <div style={ui.card} ref={editRef}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
            <div style={{ fontWeight:700 }}>✏️ Editar</div>
            <span style={{ fontSize:12, background:"#0e1626", padding:"4px 8px", borderRadius:6 }}>
              ID {sel.id} — {tarjetaLabel({ ...sel, id:sel.tarjeta_id })} — {MESES[sel.mes]} {sel.anio}
            </span>
            <button onClick={()=>setSel(null)} style={{ marginLeft:"auto", textDecoration:"underline", opacity:.8 }}>
              Limpiar selección
            </button>
          </div>

          {/* Grid de edición */}
          <div style={{ display:"grid", gridTemplateColumns:"1.2fr .7fr .7fr 1fr 1fr auto auto", gap:10, alignItems:"end" }}>
            <L label="Tarjeta">
              <select value={edit.tarjeta_id} onChange={e=>setEdit({ ...edit, tarjeta_id:e.target.value })} style={styles.input}>
                <option value="">—</option>
                {tarjetas.map(t => <option key={t.id} value={t.id}>{tarjetaLabel(t)}</option>)}
              </select>
            </L>
            <L label="Mes">
              <select value={edit.mes || ""} onChange={e=>setEdit({ ...edit, mes:e.target.value })} style={styles.input}>
                {Array.from({ length:12 }, (_,i)=>i+1).map(m => <option key={m} value={m}>{MESES[m]}</option>)}
              </select>
            </L>
            <L label="Año"><input type="number" value={edit.anio || ""} onChange={e=>setEdit({ ...edit, anio:e.target.value })} style={styles.input}/></L>
            <L label="Total a pagar"><input type="number" value={edit.total_pagar} onChange={e=>setEdit({ ...edit, total_pagar:e.target.value })} style={styles.input}/></L>

            <Button onClick={guardar} size="md">Guardar cambios</Button>
            <Button variant="danger" onClick={eliminarEstado} size="md">Eliminar</Button>
          </div>

          {/* Registrar pago */}
          <div style={{ marginTop:16 }}>
            <div style={{ fontWeight:700, marginBottom:8 }}>💳 Registrar pago del estado</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, alignItems:"end", marginBottom:10 }}>
              <L label="Monto pagado"><input type="number" value={edit.monto_pagado} onChange={e=>setEdit({ ...edit, monto_pagado:e.target.value })} style={styles.input}/></L>
              <L label="Fecha pago"><input type="date" value={edit.fecha_pago} onChange={e=>setEdit({ ...edit, fecha_pago:e.target.value })} style={styles.input}/></L>
            </div>

            <div style={{ display:"flex", gap:10 }}>
              <button type="button" onClick={marcarPagado} style={{ ...ui.btn, background:"#1e90ff" }}>
                Marcar estado pagado ({fmtCLP(edit.monto_pagado || sel.total_pagar)})
              </button>
              <button
                type="button"
                onClick={deshacerPago}
                style={{ ...ui.btn, background:"#6c757d", opacity: sel?.monto_pagado ? 1 : .7 }}
                disabled={!sel?.monto_pagado}
              >
                Deshacer pago
              </button>
              <button type="button" onClick={()=>abrirDetallesDesde(sel)} style={{ ...ui.btn, background:"#0ec3cc" }}>📄 Detalles</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Detalles */}
      {detOpen && (
        <div style={styles.modalBackdrop} onClick={()=>setDetOpen(false)}>
          <div style={styles.modal} onClick={(e)=>e.stopPropagation()}>
            <div style={{ fontWeight:700, marginBottom:12 }}>📄 Detalles del estado</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 2fr", gap:10 }}>
              <L label="Nº estado"><input style={styles.input} value={detNro} onChange={e=>setDetNro(e.target.value)}/></L>
              <L label="Nota"><input style={styles.input} value={detNota} onChange={e=>setDetNota(e.target.value)}/></L>
            </div>
            <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:14 }}>
              <button type="button" onClick={()=>setDetOpen(false)} style={{ ...ui.btn, background:"#6c757d" }}>Cerrar</button>
              <button type="button" onClick={guardarDetalles} style={ui.btn} disabled={detBusy}>{detBusy ? "Guardando..." : "Guardar"}</button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

const styles = {
  input:{ padding:"8px 10px", borderRadius:8, border:"1px solid #23304a", background:"#0e1626", color:"#e6f0ff" },
  th:{ textAlign:"left", padding:"10px 8px", borderBottom:"1px solid #1f2a44", whiteSpace:"nowrap" },
  td:{ padding:"8px", borderBottom:"1px solid #1f2a44", whiteSpace:"nowrap" },
  tr:{ transition:"background .15s ease" },
  smallBtn:{ padding:"6px 10px", border:0, borderRadius:8, background:"#ffd166", color:"#162", fontWeight:700, cursor:"pointer" },
  error:{ background:"#ff3b30", color:"#fff", padding:"6px 10px", borderRadius:8 },
  menuItem:{ display:"block", width:"100%", textAlign:"left", padding:"10px 12px", background:"transparent", color:"#e6f0ff", border:0, cursor:"pointer" },
  modalBackdrop:{ position:"fixed", inset:0, background:"rgba(0,0,0,.5)", zIndex:40, display:"flex", alignItems:"center", justifyContent:"center", padding:16 },
  modal:{ width:"min(800px, 96vw)", background:"#0b1322", border:"1px solid #1f2a44", borderRadius:12, padding:16, boxShadow:"0 40px 120px rgba(0,0,0,.55)" },
};



