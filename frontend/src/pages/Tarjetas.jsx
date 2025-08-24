// frontend/src/pages/Tarjetas.jsx
import React, { useEffect, useRef, useState } from "react";
import AppShell, { ui } from "../components/AppShell";
import api from "../api/api";
import { useToast, useConfirm } from "../ui/notifications";

const emptyCreate = { nombre:"", banco:"", tipo:"credito", limite:"", cierre_dia:"", vencimiento_dia:"", activa:true };
const emptyEdit   = { nombre:"", banco:"", tipo:"credito", limite:"", cierre_dia:"", vencimiento_dia:"", activa:true };
const emptyDetalle = { alias:"", pan_last4:"", expiracion_mes:"", expiracion_anio:"", fecha_entrega:"", red:"" };

export default function Tarjetas() {
  const { success, error, warning } = useToast();
  const confirm = useConfirm();

  // ── data principal
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // ── crear (arriba)
  const [createForm, setCreateForm] = useState(emptyCreate);
  const [busyCreate, setBusyCreate] = useState(false);

  // ── edición (abajo)
  const [editSel, setEditSel] = useState(null);
  const [editForm, setEditForm] = useState(emptyEdit);
  const [busyEdit, setBusyEdit] = useState(false);
  const editRef = useRef(null);

  // ── menú contextual
  const [menu, setMenu] = useState({ show:false, x:0, y:0, target:null });
  const menuRef = useRef(null);

  // ── modal de detalles
  const [detOpen, setDetOpen] = useState(false);
  const [detBusy, setDetBusy] = useState(false);
  const [detalle, setDetalle] = useState(emptyDetalle);
  const [detTarjetaId, setDetTarjetaId] = useState(null);

  useEffect(() => { load(); }, []);
  async function load() {
    try {
      setErr(""); setLoading(true);
      const { data } = await api.get("/tarjetas");
      setItems(Array.isArray(data) ? data : data.data || []);
    } catch (e) {
      setErr(e?.response?.data?.detail || "No pude cargar tarjetas");
    } finally { setLoading(false); }
  }

  // cerrar menú
  useEffect(() => {
    const onDown = (e) => e.key === "Escape" && setMenu(m => ({ ...m, show:false }));
    const onClick = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(m => ({ ...m, show:false })); };
    window.addEventListener("keydown", onDown);
    window.addEventListener("click", onClick);
    return () => { window.removeEventListener("keydown", onDown); window.removeEventListener("click", onClick); };
  }, []);

  // ── Crear
  const resetCreate = () => setCreateForm(emptyCreate);
  const submitCreate = async (e) => {
    e.preventDefault();
    if (!createForm.nombre.trim()) { warning("Nombre es obligatorio"); return; }
    setBusyCreate(true);
    try {
      const payload = {
        nombre: createForm.nombre.trim(),
        banco: createForm.banco.trim() || null,
        tipo: createForm.tipo,
        limite: createForm.limite !== "" ? Number(createForm.limite) : null,
        cierre_dia: createForm.cierre_dia !== "" ? Number(createForm.cierre_dia) : null,
        vencimiento_dia: createForm.vencimiento_dia !== "" ? Number(createForm.vencimiento_dia) : null,
        activa: !!createForm.activa,
      };
      await api.post("/tarjetas", payload);
      success("Tarjeta creada");
      resetCreate(); await load();
    } catch (e) {
      error({ title:"No pude guardar", description: e?.response?.data?.detail || String(e) });
    } finally { setBusyCreate(false); }
  };

  // ── Menú contextual en fila
  const openMenu = (e, t) => { e.stopPropagation(); setMenu({ show:true, x:e.clientX, y:e.clientY, target:t }); };

  // Abrir editor abajo
  const openEditor = (row) => {
    const r = row || menu.target;
    if (!r) return;
    setMenu(m => ({ ...m, show:false }));
    setEditSel(r);
    setEditForm({
      nombre: r.nombre || "", banco: r.banco || "", tipo: r.tipo || "credito",
      limite: r.limite ?? "", cierre_dia: r.cierre_dia ?? "", vencimiento_dia: r.vencimiento_dia ?? "",
      activa: r.activa !== false,
    });
    setTimeout(() => editRef.current?.scrollIntoView({ behavior:"smooth", block:"start" }), 0);
  };

  const deleteCard = async (id) => {
    const ok = await confirm({
      title: "¿Desactivar tarjeta?",
      message: "La tarjeta dejará de aparecer como activa. Podrás reactivarla editándola o creando otra.",
      confirmText: "Desactivar",
      tone: "danger",
    });
    if (!ok) return;

    try {
      await api.delete(`/tarjetas/${id}`);
      if (editSel?.id === id) { setEditSel(null); setEditForm(emptyEdit); }
      success("Tarjeta desactivada");
      await load();
    } catch (e) {
      error({ title:"No pude desactivar", description: e?.response?.data?.detail || String(e) });
    }
  };

  // ── Guardar edición (abajo)
  const saveEdit = async () => {
    if (!editSel) return;
    setBusyEdit(true);
    try {
      const payload = {
        nombre: editForm.nombre.trim(),
        banco: editForm.banco.trim() || null,
        tipo: editForm.tipo,
        limite: editForm.limite !== "" ? Number(editForm.limite) : null,
        cierre_dia: editForm.cierre_dia !== "" ? Number(editForm.cierre_dia) : null,
        vencimiento_dia: editForm.vencimiento_dia !== "" ? Number(editForm.vencimiento_dia) : null,
        activa: !!editForm.activa,
      };
      await api.put(`/tarjetas/${editSel.id}`, payload);
      success("Cambios guardados");
      await load();
    } catch (e) {
      error({ title:"No pude guardar cambios", description: e?.response?.data?.detail || String(e) });
    } finally { setBusyEdit(false); }
  };

  // ── Detalles (modal)
  const openDetalles = async () => {
    // id desde menú o tarjeta en edición
    const id = menu.target?.id ?? editSel?.id;
    if (!id) { warning("Primero selecciona una tarjeta"); return; }

    setDetTarjetaId(id);
    setDetalle(emptyDetalle);
    setMenu(m => ({ ...m, show:false }));
    setDetOpen(true);

    try {
      const { data } = await api.get(`/tarjetas/${id}/detalle`);
      const d = data?.data ?? data;
      if (d) setDetalle({
        alias: d.alias ?? "",
        pan_last4: d.pan_last4 ?? "",
        expiracion_mes: d.expiracion_mes ?? "",
        expiracion_anio: d.expiracion_anio ?? "",
        fecha_entrega: d.fecha_entrega ?? "",
        red: (d.red ?? "").toLowerCase(),
      });
    } catch {
      /* sin detalle */
    }
  };

  const saveDetalle = async () => {
    if (!detTarjetaId) { warning("No hay tarjeta seleccionada"); return; }

    // validaciones mínimas en cliente
    if (detalle.pan_last4 && String(detalle.pan_last4).replace(/\D/g,"").length !== 4) {
      warning("Los 'Últimos 4' deben tener exactamente 4 dígitos.");
      return;
    }
    if (detalle.expiracion_mes && !(Number(detalle.expiracion_mes) >= 1 && Number(detalle.expiracion_mes) <= 12)) {
      warning("Mes de expiración inválido.");
      return;
    }

    try {
      setDetBusy(true);
      const payload = {
        alias: (detalle.alias || "").trim() || null,
        // solo dígitos y recortado a 4
        pan_last4: ((detalle.pan_last4 || "").replace(/\D/g,"").slice(-4)) || null,
        expiracion_mes: detalle.expiracion_mes ? Number(detalle.expiracion_mes) : null,
        expiracion_anio: detalle.expiracion_anio ? Number(detalle.expiracion_anio) : null,
        fecha_entrega: detalle.fecha_entrega || null,
        // normalizo a minúsculas por el CHECK de la BD
        red: detalle.red ? String(detalle.red).toLowerCase() : null,
      };

      await api.put(`/tarjetas/${detTarjetaId}/detalle`, payload);
      success("Detalles guardados");
      setDetOpen(false);
    } catch (e) {
      error({ title:"No pude guardar el detalle", description: e?.response?.data?.detail || e?.response?.data?.error || String(e) });
    } finally {
      setDetBusy(false);
    }
  };

  const deleteDetalle = async () => {
    if (!detTarjetaId) return;

    const ok = await confirm({
      title: "¿Eliminar detalles?",
      message: "Se eliminará la información informativa (alias, últimos 4, expiración, etc.) de esta tarjeta.",
      confirmText: "Eliminar",
      tone: "danger",
    });
    if (!ok) return;

    try {
      setDetBusy(true);
      await api.delete(`/tarjetas/${detTarjetaId}/detalle`);
      success("Detalle eliminado");
      setDetOpen(false);
    } catch (e) {
      error({ title:"No pude eliminar el detalle", description: e?.response?.data?.detail || String(e) });
    } finally { setDetBusy(false); }
  };

  // ──────────────────────────────────────────────────────────────
  return (
    <AppShell title="Tarjetas" actions={<button style={ui.btn} onClick={load}>Actualizar</button>}>
      {/* Crear (arriba) */}
      <div style={ui.card}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>➕ Agregar tarjeta</div>
        <form
          onSubmit={submitCreate}
          style={{ display:"grid", gridTemplateColumns:"2fr 1.5fr 1fr 1fr 1fr 1fr auto auto", gap:10, alignItems:"center" }}
        >
          <input placeholder="Nombre" value={createForm.nombre} onChange={(e)=>setCreateForm({ ...createForm, nombre: e.target.value })} style={styles.input}/>
          <input placeholder="Banco"  value={createForm.banco}  onChange={(e)=>setCreateForm({ ...createForm, banco: e.target.value })} style={styles.input}/>
          <select value={createForm.tipo} onChange={(e)=>setCreateForm({ ...createForm, tipo: e.target.value })} style={styles.input}>
            <option value="credito">Crédito</option><option value="debito">Débito</option>
          </select>
          <input placeholder="Límite (opcional)" type="number" value={createForm.limite} onChange={(e)=>setCreateForm({ ...createForm, limite: e.target.value })} style={styles.input}/>
          <select value={createForm.cierre_dia === "" ? "" : Number(createForm.cierre_dia)} onChange={(e)=>setCreateForm({ ...createForm, cierre_dia: e.target.value ? Number(e.target.value) : "" })} style={styles.input}>
            <option value="">Día cierre</option>{Array.from({ length:31 }, (_,i)=><option key={i+1} value={i+1}>Día {i+1}</option>)}
          </select>
          <select value={createForm.vencimiento_dia === "" ? "" : Number(createForm.vencimiento_dia)} onChange={(e)=>setCreateForm({ ...createForm, vencimiento_dia: e.target.value ? Number(e.target.value) : "" })} style={styles.input}>
            <option value="">Día vencimiento</option>{Array.from({ length:31 }, (_,i)=><option key={i+1} value={i+1}>Día {i+1}</option>)}
          </select>
          <label style={{ display:"flex", gap:8, alignItems:"center" }}><input type="checkbox" checked={createForm.activa} onChange={(e)=>setCreateForm({ ...createForm, activa: e.target.checked })}/>Activa</label>
          <button type="submit" style={ui.btn} disabled={busyCreate}>{busyCreate ? "Guardando..." : "Crear"}</button>
          <button type="button" style={{ ...ui.btn, background:"#8899aa" }} onClick={resetCreate}>Limpiar</button>
        </form>
      </div>

      {/* Lista */}
      <div style={ui.card}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Tarjetas activas</div>
        {loading ? <div>Cargando…</div> : err ? <div style={styles.error}>{err}</div> : items.length === 0 ? <div style={{ opacity:.8 }}>No hay tarjetas.</div> : (
          <div style={{ overflowX:"auto", position:"relative" }}>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead><tr><th style={styles.th}>ID</th><th style={styles.th}>Nombre</th><th style={styles.th}>Banco</th><th style={styles.th}>Tipo</th><th style={styles.th}>Límite</th><th style={styles.th}>Cierre</th><th style={styles.th}>Venc.</th><th style={styles.th}>Activa</th></tr></thead>
              <tbody>
                {items.map(t=>(
                  <tr key={t.id} onClick={(e)=>openMenu(e,t)} style={{ ...styles.tr, cursor:"pointer" }} title="Click para acciones">
                    <td style={styles.td}>{t.id}</td><td style={styles.td}>{t.nombre}</td><td style={styles.td}>{t.banco ?? "-"}</td>
                    <td style={styles.td}>{t.tipo}</td><td style={styles.td}>{t.limite ?? "-"}</td>
                    <td style={styles.td}>{t.cierre_dia ?? "-"}</td><td style={styles.td}>{t.vencimiento_dia ?? "-"}</td><td style={styles.td}>{t.activa ? "Sí" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Menú contextual */}
            {menu.show && (
              <div ref={menuRef} style={{ position:"fixed", top:menu.y+8, left:menu.x+8, background:"#0e1626", border:"1px solid #24324a", borderRadius:10, boxShadow:"0 8px 30px rgba(0,0,0,.4)", zIndex:50, minWidth:220 }}>
                <div style={{ padding:10, borderBottom:"1px solid #1f2a44", fontSize:12, opacity:.8 }}>
                  ID {menu.target?.id} — {menu.target?.nombre}
                </div>
                <button onClick={openDetalles} style={styles.menuItem}>📄 Ver detalles</button>
                <button onClick={()=>openEditor()} style={{ ...styles.menuItem, borderTop:"1px solid #1f2a44" }}>✏️ Editar / Eliminar</button>
              </div>
            )}

            {!editSel && <div style={{ marginTop:10, opacity:.7, fontSize:13 }}>Tip: haz clic en una fila para abrir el menú de acciones.</div>}
          </div>
        )}
      </div>

      {/* Panel de edición (abajo) */}
      {editSel && (
        <div style={ui.card} ref={editRef}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
            <div style={{ fontWeight:700 }}>✏️ Editar</div>
            <span style={{ fontSize:12, background:"#0e1626", padding:"4px 8px", borderRadius:6 }}>ID {editSel.id} — {editSel.nombre}</span>
            <button onClick={()=>{ setEditSel(null); setEditForm(emptyEdit); }} style={{ marginLeft:"auto", textDecoration:"underline", opacity:.8 }}>Limpiar selección</button>
          </div>

          {/* fila de campos + guardar/eliminar a la derecha */}
          <div
            style={{
              display:"grid",
              gridTemplateColumns:"2fr 1.5fr 1fr 1fr 1fr 1fr auto",
              gap:10,
              alignItems:"end",
            }}
          >
            <input value={editForm.nombre} onChange={(e)=>setEditForm({ ...editForm, nombre: e.target.value })} style={styles.input} placeholder="Nombre"/>
            <input value={editForm.banco}  onChange={(e)=>setEditForm({ ...editForm, banco: e.target.value })}  style={styles.input} placeholder="Banco"/>
            <select value={editForm.tipo} onChange={(e)=>setEditForm({ ...editForm, tipo: e.target.value })} style={styles.input}>
              <option value="credito">Crédito</option><option value="debito">Débito</option>
            </select>
            <input type="number" value={editForm.limite} onChange={(e)=>setEditForm({ ...editForm, limite: e.target.value })} style={styles.input} placeholder="Límite"/>
            <select value={editForm.cierre_dia === "" ? "" : Number(editForm.cierre_dia)} onChange={(e)=>setEditForm({ ...editForm, cierre_dia: e.target.value ? Number(e.target.value) : "" })} style={styles.input}>
              <option value="">Día cierre</option>{Array.from({ length:31 }, (_,i)=><option key={i+1} value={i+1}>Día {i+1}</option>)}
            </select>
            <select value={editForm.vencimiento_dia === "" ? "" : Number(editForm.vencimiento_dia)} onChange={(e)=>setEditForm({ ...editForm, vencimiento_dia: e.target.value ? Number(e.target.value) : "" })} style={styles.input}>
              <option value="">Día vencimiento</option>{Array.from({ length:31 }, (_,i)=><option key={i+1} value={i+1}>Día {i+1}</option>)}
            </select>

            <div style={{ display:"flex", gap:8, justifyContent:"flex-end", alignItems:"center" }}>
              <label style={{ display:"flex", alignItems:"center", gap:8, marginRight:"auto" }}>
                <input type="checkbox" checked={editForm.activa} onChange={(e)=>setEditForm({ ...editForm, activa: e.target.checked })}/>
                Activa
              </label>
              <button onClick={saveEdit} style={ui.btn} disabled={busyEdit}>{busyEdit ? "Guardando..." : "Guardar cambios"}</button>
              <button onClick={()=>deleteCard(editSel.id)} style={{ ...ui.btn, background:"#ff3b30" }}>Eliminar</button>
            </div>
          </div>

          {/* fila inferior con Detalles (como en Gastos) */}
          <div style={{ marginTop:10, display:"flex", gap:10 }}>
            <button type="button" onClick={openDetalles} style={{ ...ui.btn, ...styles.btnInfo }}>
              📄 Detalles
            </button>
          </div>
        </div>
      )}

      {/* Modal de Detalles */}
      {detOpen && (
        <div style={styles.modalBackdrop} onClick={()=>setDetOpen(false)}>
          <div style={styles.modal} onClick={(e)=>e.stopPropagation()}>
            <div style={{ fontWeight:700, marginBottom:12 }}>
              🪪 Detalles de la tarjeta <span style={{ fontSize:12, opacity:.7, marginLeft:8 }}>(Solo informativo — guardamos últimos 4)</span>
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr 1fr", gap:10 }}>
              <div>
                <div style={styles.label}>Alias</div>
                <input
                  style={styles.input}
                  placeholder="Mi Visa, Tarjeta Chile, etc."
                  value={detalle.alias}
                  onChange={(e)=>setDetalle({ ...detalle, alias: e.target.value })}
                />
              </div>

              <div>
                <div style={styles.label}>Últimos 4</div>
                <input
                  style={styles.input}
                  placeholder="1234"
                  inputMode="numeric"
                  maxLength={4}
                  value={detalle.pan_last4}
                  onChange={(e)=>setDetalle({ ...detalle, pan_last4: e.target.value.replace(/\D/g,"") })}
                />
              </div>

              <div>
                <div style={styles.label}>Mes exp.</div>
                <select
                  style={styles.input}
                  value={detalle.expiracion_mes}
                  onChange={(e)=>setDetalle({ ...detalle, expiracion_mes: e.target.value })}
                >
                  <option value="">—</option>
                  {Array.from({ length:12 }, (_,i)=>i+1).map(m=>(
                    <option key={m} value={m}>{String(m).padStart(2,"0")}</option>
                  ))}
                </select>
              </div>

              <div>
                <div style={styles.label}>Año exp.</div>
                <input
                  style={styles.input}
                  placeholder="2028"
                  inputMode="numeric"
                  value={detalle.expiracion_anio}
                  onChange={(e)=>setDetalle({ ...detalle, expiracion_anio: e.target.value.replace(/\D/g,"") })}
                />
              </div>

              <div>
                <div style={styles.label}>Fecha entrega</div>
                <input
                  style={styles.input}
                  type="date"
                  value={detalle.fecha_entrega || ""}
                  onChange={(e)=>setDetalle({ ...detalle, fecha_entrega: e.target.value })}
                />
              </div>

              <div>
                <div style={styles.label}>Red</div>
                <select style={styles.input} value={detalle.red} onChange={(e)=>setDetalle({ ...detalle, red: e.target.value })}>
                  <option value="">—</option>
                  <option value="visa">Visa</option>
                  <option value="mastercard">Mastercard</option>
                  <option value="amex">Amex</option>
                  <option value="otra">Otra</option>
                </select>
              </div>
            </div>

            <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:14 }}>
              <button type="button" onClick={()=>setDetOpen(false)} style={{ ...ui.btn, background:"#6c757d" }}>Cerrar</button>
              <button type="button" onClick={deleteDetalle} style={{ ...ui.btn, background:"#ff3b30" }} disabled={detBusy}>Eliminar</button>
              <button type="button" onClick={saveDetalle} style={ui.btn} disabled={detBusy}>{detBusy ? "Guardando..." : "Guardar"}</button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

const styles = {
  input:{ padding:"8px 10px", borderRadius:8, border:"1px solid #23304a", background:"#0e1626", color:"#e6f0ff", width:"100%", boxSizing:"border-box" },
  th:{ textAlign:"left", padding:"10px 8px", borderBottom:"1px solid #1f2a44", whiteSpace:"nowrap" },
  td:{ padding:"8px", borderBottom:"1px solid #1f2a44" },
  tr:{ transition:"background .15s ease" },
  error:{ background:"#ff3b30", color:"#fff", padding:"8px 10px", borderRadius:8 },
  label:{ fontSize:12, color:"#9db7d3", opacity:.9, padding:"0 2px", marginBottom:4 },
  menuItem:{ display:"block", width:"100%", textAlign:"left", padding:"10px 12px", background:"transparent", color:"#e6f0ff", border:0, cursor:"pointer" },
  modalBackdrop:{ position:"fixed", inset:0, background:"rgba(0,0,0,.5)", zIndex:40, display:"flex", alignItems:"center", justifyContent:"center", padding:16 },
  modal:{ width:"min(1000px, 96vw)", background:"#0b1322", border:"1px solid #1f2a44", borderRadius:12, padding:16, boxShadow:"0 40px 120px rgba(0,0,0,.55)" },
  // mismo tono "info/teal" que en Gastos
  btnInfo:{ background:"#17a2b8" }
};



