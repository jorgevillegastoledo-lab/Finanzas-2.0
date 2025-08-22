// frontend/src/pages/FacturacionTarjetas.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import AppShell, { ui } from "../components/AppShell";
import api from "../api/api";
import { useToast, useConfirm } from "../ui/notifications";
import Button from "../ui/Button";

const MESES = [
  "",
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"
];
const hoy = new Date();
const MES_ACTUAL = hoy.getMonth() + 1;
const ANIO_ACTUAL = hoy.getFullYear();

const fmtCLP = (n) =>
  new Intl.NumberFormat("es-CL", { style:"currency", currency:"CLP", maximumFractionDigits:0 })
    .format(Number(n || 0));

const fmtError = (e) => e?.response?.data?.detail || e?.message || String(e);

const L = ({ label, children }) => (
  <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
    <span style={{ fontSize:12, color:"#9db7d3", opacity:.9, padding:"0 2px" }}>{label}</span>
    {children}
  </div>
);

export default function FacturacionTarjetas() {
  const { success, error, warning } = useToast();
  const confirm = useConfirm();

  const [tarjetas, setTarjetas] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [vMes, setVMes] = useState(MES_ACTUAL);
  const [vAnio, setVAnio] = useState(ANIO_ACTUAL);
  const [fTarjeta, setFTarjeta] = useState("");

  const emptyNuevo = {
    tarjeta_id:"", mes:String(MES_ACTUAL), anio:String(ANIO_ACTUAL),
    fecha_emision:"", fecha_vencimiento:"", total_pagar:"", pago_minimo:"", nro_estado:""
  };
  const [nuevo, setNuevo] = useState(emptyNuevo);
  const [savingNew, setSavingNew] = useState(false);

  const [sel, setSel] = useState(null);
  const [edit, setEdit] = useState({
    tarjeta_id:"", mes:"", anio:"", total_pagar:"", pagada:false, fecha_pago:"", monto_pagado:""
  });
  const editRef = useRef(null);

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
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("click", onClick);
    };
  }, []);

  const openMenu = (e, row) => {
    e.preventDefault?.(); e.stopPropagation?.();
    setMenu({ show:true, x:e.clientX, y:e.clientY, target:row, openedAt:Date.now() });
  };
  const openEditor = (row) => {
    const r = row || menu.target; if (!r) return;
    setMenu(m=>({ ...m, show:false })); setSel(r);
    setTimeout(()=>editRef.current?.scrollIntoView({ behavior:"smooth", block:"start" }),0);
  };

  const [detOpen, setDetOpen] = useState(false);
  const [detBusy, setDetBusy] = useState(false);
  const [det, setDet] = useState({
    fecha_emision:"", fecha_vencimiento:"", pago_minimo:"", monto_pagado:"", nro_estado:"", nota:""
  });

  const tarjetaLabel = (obj) =>
    (obj.banco ? `${obj.banco} — ` : "") +
    (obj.tarjeta || obj.nombre || `Tarjeta ${obj.tarjeta_id ?? obj.id ?? ""}`);

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

  const totales = useMemo(() => {
    const total = items.reduce((a,i)=>a + Number(i.total ?? i.total_pagar ?? 0), 0);
    const pagado = items.reduce((a,i)=>a + (i.pagada ? Number(i.total ?? 0) : 0), 0);
    return { total, pagado, pend: total - pagado };
  }, [items]);

  async function crearEstado(e) {
    e?.preventDefault?.();
    if (!nuevo.tarjeta_id || !nuevo.total_pagar) {
      warning("Tarjeta y Total a pagar son obligatorios."); return;
    }
    try {
      setSavingNew(true);
      await api.post("/facturas", {
        tarjeta_id: Number(nuevo.tarjeta_id),
        mes: nuevo.mes ? Number(nuevo.mes) : null,
        anio: nuevo.anio ? Number(nuevo.anio) : null,
        total: Number(nuevo.total_pagar),
      });
      setNuevo(emptyNuevo);
      await loadEstados();
      success("Estado creado");
    } catch (e) {
      error({ title:"No pude crear el estado", description:fmtError(e) });
    } finally { setSavingNew(false); }
  }

  useEffect(() => {
    if (!sel) return;
    setEdit({
      tarjeta_id: String(sel.tarjeta_id ?? ""),
      mes: String(sel.mes ?? ""),
      anio: String(sel.anio ?? ""),
      total_pagar: String(sel.total ?? sel.total_pagar ?? ""),
      pagada: !!sel.pagada,
      fecha_pago: sel.fecha_pago || "",
      monto_pagado: ""
    });
  }, [sel]);

  async function guardar() {
    if (!sel) return;
    try {
      await api.put(`/facturas/${sel.id}`, {
        tarjeta_id: edit.tarjeta_id ? Number(edit.tarjeta_id) : null,
        mes: edit.mes ? Number(edit.mes) : null,
        anio: edit.anio ? Number(edit.anio) : null,
        total: edit.total_pagar !== "" ? Number(edit.total_pagar) : null,
      });
      await loadEstados();
      success("Cambios guardados");
    } catch (e) {
      error({ title:"No pude guardar cambios", description:fmtError(e) });
    }
  }

  async function eliminarEstado() {
    if (!sel) return;
    const ok = await confirm({
      title:"¿Eliminar estado?",
      message:"Esta acción no se puede deshacer.",
      confirmText:"Eliminar",
      tone:"danger"
    });
    if (!ok) return;
    try {
      await api.delete(`/facturas/${sel.id}`);
      setSel(null);
      await loadEstados();
      success("Estado eliminado");
    } catch (e) {
      error({ title:"No pude eliminar", description:fmtError(e) });
    }
  }

  // Pago/deshacer con confirm e idempotencia
  async function marcarPagado() {
    if (!sel) return;
    if (sel.pagada) return;

    // Evitar mezclar ?? y || sin paréntesis.
    const totalAConfirmar = Number((sel.total ?? sel.total_pagar) ?? 0);

    const ok = await confirm({
      title: "Confirmar pago",
      message: `¿Marcar la factura como pagada por ${fmtCLP(totalAConfirmar)}?`,
      confirmText: "Sí, pagar",
    });
    if (!ok) return;

    try {
      // Enviar fecha sólo si el usuario la eligió; si no, backend usará hoy.
      const fecha = edit.fecha_pago ? edit.fecha_pago : undefined;
      await api.post(`/facturas/${sel.id}/pagar`, { fecha_pago: fecha });
      await loadEstados();
      success("Pago registrado");
    } catch (e) {
      if (e?.response?.status === 409) {
        warning(e?.response?.data?.detail ?? "La factura ya está pagada.");
        await loadEstados();
        return;
      }
      error({ title: "No pude registrar el pago", description: fmtError(e) });
    }
  }

  async function deshacerPago() {
    if (!sel) return;
    const ok = await confirm({
      title: "Deshacer pago",
      message: "¿Quitar el estado de pago de esta factura?",
      confirmText: "Sí, deshacer",
      tone: "danger"
    });
    if (!ok) return;

    try {
      await api.post(`/facturas/${sel.id}/deshacer`);
      await loadEstados();
      success("Se deshizo el pago");
    } catch (e) {
      error({ title:"No pude deshacer el pago", description:fmtError(e) });
    }
  }

  function abrirDetallesDesde(rowSel) {
    const r = rowSel || sel || menu.target;
    if (!r) { warning("Primero selecciona un estado."); return; }
    setMenu(m=>({ ...m, show:false }));
    cargarDetalle(r.id);
  }

  async function cargarDetalle(id) {
    try {
      const { data } = await api.get(`/facturas/${id}/detalle`);
      const detData = data?.data ?? data ?? {};
      setDet({
        fecha_emision: detData.fecha_emision || "",
        fecha_vencimiento: detData.fecha_vencimiento || "",
        pago_minimo: detData.pago_minimo ?? "",
        monto_pagado: detData.monto_pagado ?? "",
        nro_estado: detData.nro_estado || "",
        nota: detData.nota || "",
      });
      setDetOpen(true);
    } catch (e) {
      error({ title:"No pude cargar detalle", description:fmtError(e) });
    }
  }

  async function guardarDetalles() {
    const id = sel?.id ?? menu.target?.id; if (!id) return;
    try {
      setDetBusy(true);
      await api.put(`/facturas/${id}/detalle`, {
        fecha_emision: det.fecha_emision || null,
        fecha_vencimiento: det.fecha_vencimiento || null,
        pago_minimo: det.pago_minimo !== "" ? Number(det.pago_minimo) : null,
        monto_pagado: det.monto_pagado !== "" ? Number(det.monto_pagado) : null,
        nro_estado: (det.nro_estado || "").trim() || null,
        nota: (det.nota || "").trim() || null,
      });
      setDetOpen(false);
      success("Detalles guardados");
    } catch (e) {
      error({ title:"No pude guardar el detalle", description:fmtError(e) });
    } finally { setDetBusy(false); }
  }

  return (
    <AppShell title="Facturación tarjetas" actions={<button style={ui.btn} onClick={loadEstados}>Actualizar</button>}>

      {/* Vista contable */}
      <div style={ui.card}>
        <div style={{ fontWeight:700, marginBottom:12 }}>📅 Vista contable</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 2fr", gap:10, alignItems:"end" }}>
          <div style={{ display:"flex", gap:10, alignItems:"end" }}>
            <L label="Mes">
              <select value={vMes} onChange={e=>setVMes(Number(e.target.value))} style={styles.input}>
                {Array.from({length:12},(_,i)=>i+1).map(m => (<option key={m} value={m}>{MESES[m]}</option>))}
              </select>
            </L>
            <L label="Año">
              <input type="number" value={vAnio} onChange={e=>setVAnio(Number(e.target.value))} style={styles.input}/>
            </L>
          </div>
          <div style={{ opacity:.9, alignSelf:"center" }}>
            Totales: pagado {fmtCLP(totales.pagado)} / total {fmtCLP(totales.total)} · pendiente <b>{fmtCLP(totales.pend)}</b>
          </div>
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

      {/* Agregar */}
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
          <L label="Emisión (opcional)"><input type="date" value={nuevo.fecha_emision} onChange={e=>setNuevo({ ...nuevo, fecha_emision:e.target.value })} style={styles.input}/></L>
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
                      const total = Number(r.total ?? r.total_pagar ?? 0);
                      const pagada = !!r.pagada;
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
                          <td style={styles.td}>{r.tarjeta || r.tarjeta_nombre || tarjetaLabel({ ...r, id:r.tarjeta_id })}</td>
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
              Tip: clic en una fila para **ver detalles**, editar o eliminar.
            </div>
          </>
        )}
      </div>

      {/* Menú contextual */}
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
            ID {menu.target?.id} — {menu.target?.tarjeta || tarjetaLabel({ ...menu.target, id:menu.target?.tarjeta_id })}
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

          <div style={{ display:"grid", gridTemplateColumns:"1.2fr .7fr .7fr 1fr auto auto", gap:10, alignItems:"end" }}>
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
            <Button
              variant="danger"
              onClick={eliminarEstado}
              size="md"
              disabled={!!sel?.pagada}
              title={sel?.pagada ? "No puedes eliminar una factura ya pagada" : ""}
            >
              Eliminar
            </Button>
          </div>

          <div style={{ marginTop:16 }}>
            <div style={{ fontWeight:700, marginBottom:8 }}>💳 Pago del estado</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, alignItems:"end", marginBottom:10 }}>
              <L label="Fecha pago"><input type="date" value={edit.fecha_pago} onChange={e=>setEdit({ ...edit, fecha_pago:e.target.value })} style={styles.input}/></L>
            </div>
            <div style={{ display:"flex", gap:10 }}>
              <button
                type="button"
                onClick={marcarPagado}
                style={{ ...ui.btn, background: sel?.pagada ? "#2d6a4f" : "#1e90ff", opacity: sel?.pagada ? .85 : 1 }}
                disabled={!!sel?.pagada}
                title={sel?.pagada ? "Ya pagada" : ""}
              >
                {sel?.pagada ? "Ya pagada" : "Marcar estado pagado"}
              </button>
              <button
                type="button"
                onClick={deshacerPago}
                style={{ ...ui.btn, background:"#6c757d", opacity: sel?.pagada ? 1 : .7 }}
                disabled={!sel?.pagada}
                title={!sel?.pagada ? "No hay pago para deshacer" : ""}
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
            <div style={{ fontWeight:700, marginBottom:12 }}>📄 Detalles de la factura</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
              <L label="Fecha emisión"><input type="date" style={styles.input} value={det.fecha_emision} onChange={e=>setDet(d=>({ ...d, fecha_emision:e.target.value }))}/></L>
              <L label="Fecha vencimiento"><input type="date" style={styles.input} value={det.fecha_vencimiento} onChange={e=>setDet(d=>({ ...d, fecha_vencimiento:e.target.value }))}/></L>
              <L label="Pago mínimo"><input type="number" style={styles.input} value={det.pago_minimo} onChange={e=>setDet(d=>({ ...d, pago_minimo:e.target.value }))}/></L>
              <L label="Monto pagado (opcional)"><input type="number" style={styles.input} value={det.monto_pagado} onChange={e=>setDet(d=>({ ...d, monto_pagado:e.target.value }))}/></L>
              <L label="Nº estado"><input style={styles.input} value={det.nro_estado} onChange={e=>setDet(d=>({ ...d, nro_estado:e.target.value }))}/></L>
              <L label="Nota"><input style={styles.input} value={det.nota} onChange={e=>setDet(d=>({ ...d, nota:e.target.value }))}/></L>
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
  error:{ background:"#ff3b30", color:"#fff", padding:"6px 10px", borderRadius:8 },
  menuItem:{ display:"block", width:"100%", textAlign:"left", padding:"10px 12px", background:"transparent", color:"#e6f0ff", border:0, cursor:"pointer" },
  modalBackdrop:{ position:"fixed", inset:0, background:"rgba(0,0,0,.5)", zIndex:40, display:"flex", alignItems:"center", justifyContent:"center", padding:16 },
  modal:{ width:"min(860px, 96vw)", background:"#0b1322", border:"1px solid #1f2a44", borderRadius:12, padding:16, boxShadow:"0 40px 120px rgba(0,0,0,.55)" },
};

