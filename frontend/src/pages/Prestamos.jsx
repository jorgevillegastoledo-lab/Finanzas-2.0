// frontend/src/pages/Prestamos.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import AppShell, { ui } from "../components/AppShell";
import api from "../api/api";
import { useToast, useConfirm } from "../ui/notifications";

const MESES = ["","Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const hoy = new Date();
const MES_ACTUAL = hoy.getMonth() + 1;
const ANIO_ACTUAL = hoy.getFullYear();

const fmtCLP = (n) => new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(Number(n || 0));
const fmtError = (e) => e?.response?.data?.detail || e?.message || String(e);

const L = ({ label, children }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    <span style={{ fontSize: 12, color: "#9db7d3", opacity: 0.9, padding: "0 2px" }}>{label}</span>
    {children}
  </div>
);

/* ---------- util ---------- */
function addMonths(y, m, add) {
  const total = (y * 12 + (m - 1)) + add;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return { anio: ny, mes: nm };
}

export default function Prestamos() {
  const { success, error, warning } = useToast();
  const confirm = useConfirm();

  // Vista contable
  const [vMes, setVMes] = useState(MES_ACTUAL);
  const [vAnio, setVAnio] = useState(ANIO_ACTUAL);

  // Listado/resumen
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // Crear préstamo
  const [nuevo, setNuevo] = useState({ nombre: "", valor_cuota: "", cuotas_totales: "", primer_mes: "", primer_anio: "", banco: "" });

  // Selección / edición
  const [sel, setSel] = useState(null);
  const [edit, setEdit] = useState({ valor_cuota: "", cuotas_totales: "", primer_mes: "", primer_anio: "", banco: "" });
  const editRef = useRef(null);

  // Registrar pago (cuota fija)
  const [pagoMes, setPagoMes] = useState(MES_ACTUAL);
  const [pagoAnio, setPagoAnio] = useState(ANIO_ACTUAL);

  /* -------- Menú contextual -------- */
  const [menu, setMenu] = useState({ show: false, x: 0, y: 0, target: null, openedAt: 0 });
  const menuRef = useRef(null);

  useEffect(() => {
    const onDown = (e) => e.key === "Escape" && setMenu(m => ({ ...m, show: false }));
    const onClick = (e) => {
      setMenu(m => {
        if (!m.show) return m;
        if (Date.now() - (m.openedAt || 0) < 150) return { ...m, openedAt: 0 };
        if (menuRef.current && menuRef.current.contains(e.target)) return m;
        return { ...m, show: false };
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
    setMenu({ show: true, x: e.clientX, y: e.clientY, target: row, openedAt: Date.now() });
  };

  const openEditor = (row) => {
    const r = row || menu.target; if (!r) return;
    setMenu(m => ({ ...m, show: false }));
    setSel(r);
    setTimeout(() => editRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };

  /* -------- Detalle (modal) ---------- */
  const emptyDetalle = {
    banco: "", numero_contrato: "", fecha_otorgamiento: "", monto_original: "", moneda: "",
    plazo_meses: "", dia_vencimiento: "", tasa_interes_anual: "", tipo_tasa: "", indice_reajuste: "",
    primera_cuota: "", ejecutivo_nombre: "", ejecutivo_email: "", ejecutivo_fono: "",
    seguro_desgravamen: false, seguro_cesantia: false, costo_seguro_mensual: "", comision_administracion: "",
    prepago_permitido: false, prepago_costo: "", garantia_tipo: "", garantia_descripcion: "", garantia_hasta: "",
    liquido_recibido: "", gastos_iniciales_total: "", tags: "", nota: ""
  };
  const [detOpen, setDetOpen] = useState(false);
  const [detBusy, setDetBusy] = useState(false);
  const [detalle, setDetalle] = useState(emptyDetalle);
  const [detPrestamoId, setDetPrestamoId] = useState(null);

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
      const { data } = await api.get("/prestamos/resumen");
      const raw = Array.isArray(data) ? data : (data?.data ?? []);
      const arr = raw.map(p => {
        const mapped = {
          ...p,
          total_pagado: p.total_pagado ?? p.monto_pagado ?? 0,
          deuda_restante: p.deuda_restante ?? p.saldo_restante ?? 0,
        };
        if ((mapped.ultimo_mes == null || mapped.ultimo_anio == null)
            && mapped.cuotas_pagadas > 0
            && mapped.primer_mes && mapped.primer_anio) {
          const { anio, mes } = addMonths(Number(mapped.primer_anio), Number(mapped.primer_mes), Number(mapped.cuotas_pagadas) - 1);
          mapped.ultimo_mes = mes; mapped.ultimo_anio = anio;
        }
        return mapped;
      });
      setItems(arr);
      if (sel) setSel(arr.find(x => x.id === sel.id) || null);
    } catch (e) {
      setErr(fmtError(e) || "No pude cargar préstamos");
    } finally {
      setLoading(false);
    }
  }

  const itemsFiltrados = useMemo(() => {
    return items.filter(p => {
      if (!p.primer_mes || !p.primer_anio) return true;
      return (vAnio > p.primer_anio) || (vAnio === p.primer_anio && vMes >= p.primer_mes);
    });
  }, [items, vMes, vAnio]);

  const totales = useMemo(() => ({
    monto: itemsFiltrados.reduce((a, p) => a + (Number(p.valor_cuota || 0) * Number(p.cuotas_totales || 0)), 0),
    pagado: itemsFiltrados.reduce((a, p) => a + Number(p.total_pagado || 0), 0),
    deuda: itemsFiltrados.reduce((a, p) => a + Number(p.deuda_restante || 0), 0),
  }), [itemsFiltrados]);

  // Bloqueo de edición sensible si ya tiene pagos
  const locked = useMemo(() => {
    if (!sel) return false;
    const qp = Number(sel.cuotas_pagadas ?? 0);
    const tp = Number(sel.total_pagado ?? 0);
    return qp > 0 || tp > 0;
  }, [sel]);

  function sensitiveChangesPresent() {
    if (!sel) return false;
    const orig = {
      valor_cuota: Number(sel.valor_cuota ?? 0),
      cuotas_totales: Number(sel.cuotas_totales ?? 0),
      primer_mes: Number(sel.primer_mes ?? 0),
      primer_anio: Number(sel.primer_anio ?? 0),
    };
    const incoming = {
      valor_cuota: edit.valor_cuota === "" ? orig.valor_cuota : Number(edit.valor_cuota),
      cuotas_totales: edit.cuotas_totales === "" ? orig.cuotas_totales : Number(edit.cuotas_totales),
      primer_mes: edit.primer_mes === "" ? orig.primer_mes : Number(edit.primer_mes),
      primer_anio: edit.primer_anio === "" ? orig.primer_anio : Number(edit.primer_anio),
    };
    return (
      incoming.valor_cuota !== orig.valor_cuota ||
      incoming.cuotas_totales !== orig.cuotas_totales ||
      incoming.primer_mes !== orig.primer_mes ||
      incoming.primer_anio !== orig.primer_anio
    );
  }

  async function crear() {
    if (!nuevo.nombre || !nuevo.valor_cuota || !nuevo.cuotas_totales) {
      warning("Nombre, valor cuota y cuotas totales son obligatorios.");
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
      setNuevo({ nombre: "", valor_cuota: "", cuotas_totales: "", primer_mes: "", primer_anio: "", banco: "" });
      await listar();
      success("Préstamo creado");
    } catch (e) {
      error({ title: "No pude crear el préstamo", description: fmtError(e) });
    }
  }

  async function guardarCambios() {
    if (!sel) return;
    if (locked && sensitiveChangesPresent()) {
      warning("Este préstamo ya tiene pagos registrados. No puedes editar valor de cuota, cuotas totales ni la fecha inicial (mes/año).");
      return;
    }
    const payload = { nombre: sel.nombre, banco: edit.banco || null };
    if (!locked) {
      if (edit.valor_cuota !== "") payload.valor_cuota = Number(edit.valor_cuota);
      if (edit.cuotas_totales !== "") payload.cuotas_totales = Number(edit.cuotas_totales);
      if (edit.primer_mes !== "") payload.primer_mes = Number(edit.primer_mes);
      if (edit.primer_anio !== "") payload.primer_anio = Number(edit.primer_anio);
    }
    try {
      await api.put(`/prestamos/${sel.id}`, payload);
      await listar();
      success("Cambios guardados");
    } catch (e) {
      if (e?.response?.status === 409) {
        warning(e?.response?.data?.detail || "No puedes editar campos sensibles en un préstamo con pagos.");
      } else {
        error({ title: "No pude guardar cambios", description: fmtError(e) });
      }
    }
  }

  // --- NUEVO: Anular (soft delete) ---
  async function anularPrestamo() {
    if (!sel) return;
    const ok = await confirm({
      title: "¿Anular préstamo?",
      message: "No se eliminarán pagos porque no hay. Podrás crearlo de nuevo si fue un error.",
      confirmText: "Anular",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.post(`/prestamos/${sel.id}/anular`, { motivo: "Anulado desde UI" });
      setSel(null);
      await listar();
      success("Préstamo anulado");
    } catch (e) {
      error({ title: "No pude anular el préstamo", description: fmtError(e) });
    }
  }

  // --- NUEVO: Cerrar anticipadamente ---
  async function cerrarAnticipado() {
    if (!sel) return;
    const ok = await confirm({
      title: "¿Cerrar anticipadamente?",
      message: "Ajustará cuotas totales a las ya pagadas y dejará la deuda en $0. No borra pagos.",
      confirmText: "Cerrar",
      tone: "primary",
    });
    if (!ok) return;
    try {
      await api.post(`/prestamos/${sel.id}/cerrar-anticipado`);
      await listar();
      success("Préstamo cerrado anticipadamente");
    } catch (e) {
      error({ title: "No pude cerrar anticipadamente", description: fmtError(e) });
    }
  }

  // Pago de cuota (con confirmación)
  async function marcarPago() {
    if (!sel) return;
    if (!pagoMes || !pagoAnio) { warning("Selecciona mes y año contable del pago."); return; }

    // 🔔 Confirmación al estilo Facturación Tarjetas
    const ok = await confirm({
      title: "Confirmar pago",
      message: `¿Marcar la cuota como pagada por ${fmtCLP(sel?.valor_cuota || 0)}?`,
      confirmText: "Sí, pagar",
    });
    if (!ok) return;

    try {
      await api.post(`/prestamos/${sel.id}/pagar`, {
        mes_contable: Number(pagoMes),
        anio_contable: Number(pagoAnio)
      });
      await listar();
      success(`Pago registrado por ${fmtCLP(sel.valor_cuota)}.`);
    } catch (e) {
      if (e?.response?.status === 409) {
        // Duplicado: ya existe pago para ese período
        warning(e?.response?.data?.detail || "Ya existe un pago para ese mes/año.");
      } else {
        error({ title: "No pude registrar el pago", description: fmtError(e) });
      }
    }
  }

  async function deshacerPago() {
    if (!sel) return;

    // *** Confirmación añadida (igual que Gastos, adaptando el texto) ***
    const ok = await confirm({
      title: "Deshacer pago",
      message: "Se eliminará el último registro de pago y el préstamo quedará como NO pagado si no hay pagos restantes.",
      confirmText: "Deshacer",
      tone: "warning",
    });
    if (!ok) return;

    try {
      await api.post(`/prestamos/${sel.id}/deshacer`);
      await listar();
      success("Se deshizo el último pago.");
    } catch (e) {
      if (e?.response?.status === 409) {
        warning(e?.response?.data?.detail || "El período contable está cerrado. No se puede deshacer.");
      } else {
        error({ title: "No pude deshacer el pago", description: fmtError(e) });
      }
    }
  }

  /* ---------------- Detalle: API + Modal ---------------- */
  async function abrirDetalle(idOverride) {
    const id = idOverride ?? sel?.id;
    if (!id) { warning("Primero selecciona un préstamo."); return; }
    setDetPrestamoId(id);
    setDetalle(emptyDetalle);
    setDetOpen(true);
    try {
      const { data } = await api.get(`/prestamos/${id}/detalle`);
      const d = data?.data ?? data;
      if (d) setDetalle({
        banco: d.banco ?? "", numero_contrato: d.numero_contrato ?? "",
        fecha_otorgamiento: d.fecha_otorgamiento ?? "", monto_original: d.monto_original ?? "", moneda: d.moneda ?? "",
        plazo_meses: d.plazo_meses ?? "", dia_vencimiento: d.dia_vencimiento ?? "",
        tasa_interes_anual: d.tasa_interes_anual ?? "", tipo_tasa: d.tipo_tasa ?? "", indice_reajuste: d.indice_reajuste ?? "",
        primera_cuota: d.primera_cuota ?? "",
        ejecutivo_nombre: d.ejecutivo_nombre ?? "", ejecutivo_email: d.ejecutivo_email ?? "", ejecutivo_fono: d.ejecutivo_fono ?? "",
        seguro_desgravamen: !!d.seguro_desgravamen, seguro_cesantia: !!d.seguro_cesantia,
        costo_seguro_mensual: d.costo_seguro_mensual ?? "", comision_administracion: d.comision_administracion ?? "",
        prepago_permitido: !!d.prepago_permitido, prepago_costo: d.prepago_costo ?? "",
        garantia_tipo: d.garantia_tipo ?? "", garantia_descripcion: d.garantia_descripcion ?? "", garantia_hasta: d.garantia_hasta ?? "",
        liquido_recibido: d.liquido_recibido ?? "", gastos_iniciales_total: d.gastos_iniciales_total ?? "",
        tags: d.tags ?? "", nota: d.nota ?? ""
      });
    } catch { /* sin detalle */ }
  }

  async function guardarDetalle() {
    if (!detPrestamoId) return;
    try {
      setDetBusy(true);
      const p = detalle;
      const payload = {
        banco: (p.banco || "").trim() || null,
        numero_contrato: (p.numero_contrato || "").trim() || null,
        fecha_otorgamiento: p.fecha_otorgamiento || null,
        monto_original: p.monto_original !== "" ? Number(p.monto_original) : null,
        moneda: (p.moneda || "").trim() || null,
        plazo_meses: p.plazo_meses !== "" ? Number(p.plazo_meses) : null,
        dia_vencimiento: p.dia_vencimiento !== "" ? Number(p.dia_vencimiento) : null,
        tasa_interes_anual: p.tasa_interes_anual !== "" ? Number(p.tasa_interes_anual) : null,
        tipo_tasa: (p.tipo_tasa || "").trim() || null,
        indice_reajuste: (p.indice_reajuste || "").trim() || null,
        primera_cuota: p.primera_cuota || null,
        ejecutivo_nombre: (p.ejecutivo_nombre || "").trim() || null,
        ejecutivo_email: (p.ejecutivo_email || "").trim() || null,
        ejecutivo_fono: (p.ejecutivo_fono || "").trim() || null,
        seguro_desgravamen: !!p.seguro_desgravamen,
        seguro_cesantia: !!p.seguro_cesantia,
        costo_seguro_mensual: p.costo_seguro_mensual !== "" ? Number(p.costo_seguro_mensual) : null,
        comision_administracion: p.comision_administracion !== "" ? Number(p.comision_administracion) : null,
        prepago_permitido: !!p.prepago_permitido,
        prepago_costo: p.prepago_costo !== "" ? Number(p.prepago_costo) : null,
        garantia_tipo: (p.garantia_tipo || "").trim() || null,
        garantia_descripcion: (p.garantia_descripcion || "").trim() || null,
        garantia_hasta: p.garantia_hasta || null,
        liquido_recibido: p.liquido_recibido !== "" ? Number(p.liquido_recibido) : null,
        gastos_iniciales_total: p.gastos_iniciales_total !== "" ? Number(p.gastos_iniciales_total) : null,
        tags: (p.tags || "").trim() || null,
        nota: (p.nota || "").trim() || null,
      };
      await api.put(`/prestamos/${detPrestamoId}/detalle`, payload);
      success("Detalles guardados");
      setDetOpen(false);
    } catch (e) {
      error({ title: "No pude guardar el detalle", description: fmtError(e) });
    } finally { setDetBusy(false); }
  }

  async function eliminarDetalle() {
    if (!detPrestamoId) return;
    const ok = await confirm({
      title: "¿Eliminar detalles?",
      message: "Se eliminará la ficha informativa del préstamo.",
      confirmText: "Eliminar",
      tone: "danger",
    });
    if (!ok) return;
    try {
      setDetBusy(true);
      await api.delete(`/prestamos/${detPrestamoId}/detalle`);
      success("Detalle eliminado");
      setDetOpen(false);
    } catch (e) {
      error({ title: "No pude eliminar el detalle", description: fmtError(e) });
    } finally { setDetBusy(false); }
  }

  return (
    <AppShell title="Préstamos" actions={<button style={ui.btn} onClick={listar}>Actualizar</button>}>

      {/* Vista contable */}
      <div style={ui.card}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>📅 Vista contable</div>
        <div style={{ display: "flex", gap: 10, alignItems: "end" }}>
          <L label="Mes">
            <select value={vMes} onChange={e => setVMes(Number(e.target.value))} style={styles.input}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (<option key={m} value={m}>{MESES[m]}</option>))}
            </select>
          </L>
          <L label="Año"><input type="number" value={vAnio} onChange={e => setVAnio(Number(e.target.value))} style={styles.input} /></L>
          <div style={{ opacity: .9, marginLeft: 8 }}>
            Totales: <b>{fmtCLP(totales.deuda)}</b> deuda · pagado {fmtCLP(totales.pagado)} / total {fmtCLP(totales.monto)}
          </div>
        </div>
      </div>

      {/* Crear */}
      <div style={ui.card}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>➕ Agregar préstamo</div>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 2fr auto auto", gap: 10, alignItems: "end" }}>
          <L label="Nombre"><input value={nuevo.nombre} onChange={e => setNuevo({ ...nuevo, nombre: e.target.value })} style={styles.input} /></L>
          <L label="Valor cuota"><input type="number" value={nuevo.valor_cuota} onChange={e => setNuevo({ ...nuevo, valor_cuota: e.target.value })} style={styles.input} /></L>
          <L label="Cuotas totales"><input type="number" value={nuevo.cuotas_totales} onChange={e => setNuevo({ ...nuevo, cuotas_totales: e.target.value })} style={styles.input} /></L>
          <L label="Mes inicial">
            <select value={nuevo.primer_mes} onChange={e => setNuevo({ ...nuevo, primer_mes: e.target.value })} style={styles.input}>
              <option value="">—</option>{Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{MESES[m]}</option>)}
            </select>
          </L>
          <L label="Primer año"><input type="number" value={nuevo.primer_anio} onChange={e => setNuevo({ ...nuevo, primer_anio: e.target.value })} style={styles.input} /></L>
          <L label="Banco (opcional)"><input value={nuevo.banco} onChange={e => setNuevo({ ...nuevo, banco: e.target.value })} style={styles.input} /></L>
          <button style={ui.btn} onClick={crear}>Guardar</button>
          <button style={{ ...ui.btn, background: "#6c757d" }} onClick={() => setNuevo({ nombre: "", valor_cuota: "", cuotas_totales: "", primer_mes: "", primer_anio: "", banco: "" })}>Limpiar</button>
        </div>
      </div>

      {/* Lista */}
      <div style={ui.card}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>📄 Préstamos</div>
        {loading ? <div>Cargando…</div> : err ? <div style={styles.error}>{err}</div> : itemsFiltrados.length === 0 ? (
          <div style={{ opacity: .8 }}>No hay préstamos para la vista {MESES[vMes]} {vAnio}.</div>
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <div style={{ maxHeight: "50vh", overflowY: "auto", border: "1px solid #1f2a44", borderRadius: 12 }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ position: "sticky", top: 0, background: "#0e1626", zIndex: 1 }}>
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
                    {itemsFiltrados.map(p => (
                      <tr
                        key={p.id}
                        onClick={(e) => openMenu(e, p)}
                        onContextMenu={(e) => openMenu(e, p)}
                        style={{ ...styles.tr, cursor: "pointer" }}
                        title="Click o clic derecho para acciones"
                      >
                        <td style={styles.td}>{p.id}</td>
                        <td style={styles.td}>{p.nombre}{p.banco ? ` — ${p.banco}` : ""}</td>
                        <td style={styles.td}>{fmtCLP(p.valor_cuota)}</td>
                        <td style={styles.td}>{p.cuotas_totales}</td>
                        <td style={styles.td}>{p.cuotas_pagadas ?? 0}</td>
                        <td style={styles.td}>{fmtCLP(p.total_pagado || 0)}</td>
                        <td style={styles.td}>{fmtCLP(p.deuda_restante || 0)}</td>
                        <td style={styles.td}>{p.ultimo_mes && p.ultimo_anio ? `${MESES[p.ultimo_mes]} ${p.ultimo_anio}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Menú contextual */}
            {menu.show && (
              <div
                ref={menuRef}
                style={{
                  position: "fixed", top: menu.y + 8, left: menu.x + 8,
                  background: "#0e1626", border: "1px solid #24324a",
                  borderRadius: 10, boxShadow: "0 8px 30px rgba(0,0,0,.4)", zIndex: 50, minWidth: 220
                }}
              >
                <div style={{ padding: 10, borderBottom: "1px solid #1f2a44", fontSize: 12, opacity: .8 }}>
                  ID {menu.target?.id} — {menu.target?.nombre}
                </div>
                <button onClick={() => abrirDetalle(menu.target?.id)} style={styles.menuItem}>📄 Ver detalles</button>
                <button onClick={() => openEditor()} style={{ ...styles.menuItem, borderTop: "1px solid #1f2a44" }}>✏️ Editar / Acciones</button>
              </div>
            )}

            {!sel && <div style={{ marginTop: 10, opacity: .7, fontSize: 13 }}>Tip: haz clic en una fila para abrir el menú de acciones.</div>}
          </>
        )}
      </div>

      {/* Panel de edición / pago */}
      {sel && (
        <div style={ui.card} ref={editRef}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <div style={{ fontWeight: 700 }}>✏️ Editar</div>
            <span style={{ fontSize: 12, background: "#0e1626", padding: "4px 8px", borderRadius: 6 }}>
              ID {sel.id} — {sel.nombre}
            </span>
            <button onClick={() => setSel(null)} style={{ marginLeft: "auto", textDecoration: "underline", opacity: .8 }}>
              Limpiar selección
            </button>
          </div>

          {/* Aviso de bloqueo */}
          {locked && (
            <div style={{ marginBottom: 12, padding: "8px 10px", background: "#3a2d00", color: "#ffd666", border: "1px solid #4d3b00", borderRadius: 8, fontSize: 13 }}>
              Este préstamo ya tiene pagos registrados (<b>{sel.cuotas_pagadas ?? 0}</b>).
              No puedes editar <i>valor de cuota</i>, <i>cuotas totales</i> ni la <i>fecha inicial (mes/año)</i>.
            </div>
          )}

          {/* Barra de acciones */}
          <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
            <button type="button" onClick={() => abrirDetalle(sel.id)} style={{ ...ui.btn, background: "#0ec3cc" }}>
              📄 Detalles
            </button>

            <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
              {(sel.cuotas_pagadas || 0) === 0 ? (
                <button onClick={anularPrestamo} style={{ ...ui.btn, background: "#ff3b30" }}>
                  Anular préstamo
                </button>
              ) : (
                <button onClick={cerrarAnticipado} style={{ ...ui.btn, background: "#7c4dff" }}>
                  Cerrar anticipadamente
                </button>
              )}
              <button onClick={guardarCambios} style={ui.btn}>Guardar cambios</button>
            </div>
          </div>

          {/* Grid de campos */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr 1fr 2fr",
              gap: 10,
              alignItems: "end"
            }}
          >
            <L label="Valor cuota">
              <input
                type="number"
                value={edit.valor_cuota}
                onChange={e => setEdit({ ...edit, valor_cuota: e.target.value })}
                style={styles.input}
                disabled={locked}
                title={locked ? "Bloqueado: el préstamo ya tiene pagos" : ""}
              />
            </L>
            <L label="Cuotas totales">
              <input
                type="number"
                value={edit.cuotas_totales}
                onChange={e => setEdit({ ...edit, cuotas_totales: e.target.value })}
                style={styles.input}
                disabled={locked}
                title={locked ? "Bloqueado: el préstamo ya tiene pagos" : ""}
              />
            </L>
            <L label="Mes inicial">
              <select
                value={edit.primer_mes || ""}
                onChange={e => setEdit({ ...edit, primer_mes: e.target.value })}
                style={styles.input}
                disabled={locked}
                title={locked ? "Bloqueado: el préstamo ya tiene pagos" : ""}
              >
                <option value="">—</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{MESES[m]}</option>)}
              </select>
            </L>
            <L label="Primer año">
              <input
                type="number"
                value={edit.primer_anio || ""}
                onChange={e => setEdit({ ...edit, primer_anio: e.target.value })}
                style={styles.input}
                disabled={locked}
                title={locked ? "Bloqueado: el préstamo ya tiene pagos" : ""}
              />
            </L>
            <L label="Banco (opcional)">
              <input
                value={edit.banco || ""}
                onChange={e => setEdit({ ...edit, banco: e.target.value })}
                style={styles.input}
              />
            </L>
          </div>

          <div style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>🧾 Registrar pago de cuota</div>

            {/* Campos de pago (monto fijo, sin input) */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 2fr",
                gap: 10,
                alignItems: "end"
              }}
            >
              <L label="Mes contable">
                <select value={pagoMes} onChange={e => setPagoMes(Number(e.target.value))} style={styles.input}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{MESES[m]}</option>)}
                </select>
              </L>
              <L label="Año contable"><input type="number" value={pagoAnio} onChange={e => setPagoAnio(Number(e.target.value))} style={styles.input} /></L>
              <div style={{ alignSelf: "center", fontSize: 13, opacity: .9 }}>
                La cuota es fija: <b>{fmtCLP(sel?.valor_cuota || 0)}</b>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <button type="button" onClick={marcarPago} style={{ ...ui.btn, background: "#1e90ff" }}>
                Marcar cuota como pagada ({fmtCLP(sel?.valor_cuota || 0)})
              </button>
              <button
                type="button"
                onClick={deshacerPago}
                style={{ ...ui.btn, background: "#6c757d" }}
                disabled={!sel || (sel.cuotas_pagadas || 0) === 0}
                title={(sel?.cuotas_pagadas || 0) === 0 ? "No hay pagos para deshacer" : ""}
              >
                Deshacer último pago
              </button>
            </div>

            <div style={{ marginTop: 8, fontSize: 12, opacity: .75 }}>
              Último pago: {sel.ultimo_mes && sel.ultimo_anio ? `${MESES[sel.ultimo_mes]} ${sel.ultimo_anio}` : "—"} ·
              Pagado {fmtCLP(sel.total_pagado || 0)} / Total {fmtCLP((sel.valor_cuota || 0) * (sel.cuotas_totales || 0))} · Deuda {fmtCLP(sel.deuda_restante || 0)}
            </div>
          </div>
        </div>
      )}

      {/* Modal de Detalles */}
      {detOpen && (
        <div style={styles.modalBackdrop} onClick={() => setDetOpen(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 700, marginBottom: 12 }}>🗂️ Detalles del préstamo</div>

            <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr 1fr", gap: 10 }}>
              <L label="Banco"><input style={styles.input} value={detalle.banco} onChange={e => setDetalle({ ...detalle, banco: e.target.value })} /></L>
              <L label="N° contrato"><input style={styles.input} value={detalle.numero_contrato} onChange={e => setDetalle({ ...detalle, numero_contrato: e.target.value })} /></L>
              <L label="Fecha otorgamiento"><input type="date" style={styles.input} value={detalle.fecha_otorgamiento || ""} onChange={e => setDetalle({ ...detalle, fecha_otorgamiento: e.target.value })} /></L>
              <L label="Monto original"><input type="number" style={styles.input} value={detalle.monto_original} onChange={e => setDetalle({ ...detalle, monto_original: e.target.value })} /></L>

              <L label="Moneda"><input style={styles.input} value={detalle.moneda} onChange={e => setDetalle({ ...detalle, moneda: e.target.value })} /></L>
              <L label="Plazo (meses)"><input type="number" style={styles.input} value={detalle.plazo_meses} onChange={e => setDetalle({ ...detalle, plazo_meses: e.target.value })} /></L>
              <L label="Día venc."><input type="number" style={styles.input} value={detalle.dia_vencimiento} onChange={e => setDetalle({ ...detalle, dia_vencimiento: e.target.value })} /></L>
              <L label="Tasa anual (%)"><input type="number" style={styles.input} value={detalle.tasa_interes_anual} onChange={e => setDetalle({ ...detalle, tasa_interes_anual: e.target.value })} /></L>

              <L label="Tipo tasa"><input style={styles.input} value={detalle.tipo_tasa} onChange={e => setDetalle({ ...detalle, tipo_tasa: e.target.value })} /></L>
              <L label="Índice reajuste"><input style={styles.input} value={detalle.indice_reajuste} onChange={e => setDetalle({ ...detalle, indice_reajuste: e.target.value })} /></L>
              <L label="Primera cuota"><input type="date" style={styles.input} value={detalle.primera_cuota || ""} onChange={e => setDetalle({ ...detalle, primera_cuota: e.target.value })} /></L>
              <div />

              <L label="Ejecutivo"><input style={styles.input} value={detalle.ejecutivo_nombre} onChange={e => setDetalle({ ...detalle, ejecutivo_nombre: e.target.value })} /></L>
              <L label="Email ejecutivo"><input style={styles.input} value={detalle.ejecutivo_email} onChange={e => setDetalle({ ...detalle, ejecutivo_email: e.target.value })} /></L>
              <L label="Fono ejecutivo"><input style={styles.input} value={detalle.ejecutivo_fono} onChange={e => setDetalle({ ...detalle, ejecutivo_fono: e.target.value })} /></L>
              <div />

              <L label="Seguro desgravamen">
                <label style={{ display: "flex", alignItems: "center", gap: 8, height: 38 }}>
                  <input type="checkbox" checked={!!detalle.seguro_desgravamen} onChange={e => setDetalle({ ...detalle, seguro_desgravamen: e.target.checked })} /> Sí
                </label>
              </L>
              <L label="Seguro cesantía">
                <label style={{ display: "flex", alignItems: "center", gap: 8, height: 38 }}>
                  <input type="checkbox" checked={!!detalle.seguro_cesantia} onChange={e => setDetalle({ ...detalle, seguro_cesantia: e.target.checked })} /> Sí
                </label>
              </L>
              <L label="Costo seguro mensual"><input type="number" style={styles.input} value={detalle.costo_seguro_mensual} onChange={e => setDetalle({ ...detalle, costo_seguro_mensual: e.target.value })} /></L>
              <L label="Comisión adm."><input type="number" style={styles.input} value={detalle.comision_administracion} onChange={e => setDetalle({ ...detalle, comision_administracion: e.target.value })} /></L>

              <L label="¿Permite prepago?">
                <label style={{ display: "flex", alignItems: "center", gap: 8, height: 38 }}>
                  <input type="checkbox" checked={!!detalle.prepago_permitido} onChange={e => setDetalle({ ...detalle, prepago_permitido: e.target.checked })} /> Sí
                </label>
              </L>
              <L label="Costo prepago"><input type="number" style={styles.input} value={detalle.prepago_costo} onChange={e => setDetalle({ ...detalle, prepago_costo: e.target.value })} /></L>
              <div />
              <div />

              <L label="Garantía (tipo)"><input style={styles.input} value={detalle.garantia_tipo} onChange={e => setDetalle({ ...detalle, garantia_tipo: e.target.value })} /></L>
              <L label="Garantía (desc.)"><input style={styles.input} value={detalle.garantia_descripcion} onChange={e => setDetalle({ ...detalle, garantia_descripcion: e.target.value })} /></L>
              <L label="Garantía hasta"><input type="date" style={styles.input} value={detalle.garantia_hasta || ""} onChange={e => setDetalle({ ...detalle, garantia_hasta: e.target.value })} /></L>
              <div />

              <L label="Líquido recibido"><input type="number" style={styles.input} value={detalle.liquido_recibido} onChange={e => setDetalle({ ...detalle, liquido_recibido: e.target.value })} /></L>
              <L label="Gastos iniciales total"><input type="number" style={styles.input} value={detalle.gastos_iniciales_total} onChange={e => setDetalle({ ...detalle, gastos_iniciales_total: e.target.value })} /></L>
              <L label="Tags"><input style={styles.input} value={detalle.tags} onChange={e => setDetalle({ ...detalle, tags: e.target.value })} /></L>
              <L label="Nota"><input style={styles.input} value={detalle.nota} onChange={e => setDetalle({ ...detalle, nota: e.target.value })} /></L>
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
              <button type="button" onClick={() => setDetOpen(false)} style={{ ...ui.btn, background: "#6c757d" }}>Cerrar</button>
              <button type="button" onClick={eliminarDetalle} style={{ ...ui.btn, background: "#ff3b30" }} disabled={detBusy}>Eliminar</button>
              <button type="button" onClick={guardarDetalle} style={ui.btn} disabled={detBusy}>{detBusy ? "Guardando..." : "Guardar"}</button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

const styles = {
  input: { padding: "8px 10px", borderRadius: 8, border: "1px solid #23304a", background: "#0e1626", color: "#e6f0ff" },
  th: { textAlign: "left", padding: "10px 8px", borderBottom: "1px solid #1f2a44", whiteSpace: "nowrap" },
  td: { padding: "8px", borderBottom: "1px solid #1f2a44", whiteSpace: "nowrap" },
  tr: { transition: "background .15s ease" },
  error: { background: "#ff3b30", color: "#fff", padding: "8px 10px", borderRadius: 8 },
  menuItem: { display: "block", width: "100%", textAlign: "left", padding: "10px 12px", background: "transparent", color: "#e6f0ff", border: 0, cursor: "pointer" },
  modalBackdrop: { position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 40, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 },
  modal: { width: "min(1100px, 96vw)", background: "#0b1322", border: "1px solid #1f2a44", borderRadius: 12, padding: 16, boxShadow: "0 40px 120px rgba(0,0,0,.55)" },
};
