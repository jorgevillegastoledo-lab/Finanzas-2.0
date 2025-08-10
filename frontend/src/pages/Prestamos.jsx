// frontend/src/pages/Prestamos.jsx
import React, { useEffect, useState } from "react";
import AppShell, { ui } from "../components/AppShell";
import api from "../api/api";

const fmtCLP = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});
const fmtFecha = (iso) =>
  iso ? new Date(iso).toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" }) : "-";

// Meses (muestra nombre, guarda número)
const MESES = [
  { value: 1, label: "Enero" },
  { value: 2, label: "Febrero" },
  { value: 3, label: "Marzo" },
  { value: 4, label: "Abril" },
  { value: 5, label: "Mayo" },
  { value: 6, label: "Junio" },
  { value: 7, label: "Julio" },
  { value: 8, label: "Agosto" },
  { value: 9, label: "Septiembre" },
  { value: 10, label: "Octubre" },
  { value: 11, label: "Noviembre" },
  { value: 12, label: "Diciembre" },
];

// Etiqueta arriba del input
function Labeled({ label, children }) {
  return (
    <label style={styles.labeled}>
      <div style={styles.labelText}>{label}</div>
      {children}
    </label>
  );
}

// CSS extra
const extraCSS = `
  .btn-pagar { padding:6px 10px; border:0; border-radius:8px; background:#1565c0; color:#fff; font-weight:700; cursor:pointer; }
  .btn-pagar:hover { background:#1e88e5; }
  .btn-pagar:disabled { opacity:.6; cursor:not-allowed; }
  .modal-mask { position:fixed; inset:0; background:rgba(0,0,0,.6); display:flex; align-items:center; justify-content:center; z-index:50; }
  .modal-card { width:100%; max-width:420px; background:#0e1626; border:1px solid #23304a; border-radius:14px; padding:16px; color:#e6f0ff; }
  .modal-actions { display:flex; gap:10px; justify-content:flex-end; margin-top:12px; }
`;

export default function Prestamos() {
  // Lista + resumen
  const [items, setItems] = useState([]);
  const [resumen, setResumen] = useState({ total_mes: 0, saldo_total: 0, pagado_total: 0 });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // Filtros
  const [fMes, setFMes] = useState(""); // "" = todos
  const [fAnio, setFAnio] = useState("");

  // Form
  const [form, setForm] = useState({
    nombre: "",
    valor_cuota: "",
    cuotas_totales: "",
    cuotas_pagadas: "0",
    primer_mes: "",
    primer_anio: "",
    dia_vencimiento: "10",
  });
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);

  // ---- Modal de pago ----
  const [payOpen, setPayOpen] = useState(false);
  const [payTarget, setPayTarget] = useState(null); // { id, valor_cuota, nombre }
  const [payMes, setPayMes] = useState("");
  const [payAnio, setPayAnio] = useState(String(new Date().getFullYear()));
  const [payBusy, setPayBusy] = useState(false);

  // ---- Detalle del mes (nuevo panel) ----
  const [detLoading, setDetLoading] = useState(false);
  const [detErr, setDetErr] = useState("");
  const [detalleMes, setDetalleMes] = useState([]); // [{...estado, cuota_num, vence_el, fecha_pago}]
  const [detalleTotalMes, setDetalleTotalMes] = useState(0);

  const abrirModalPago = (p) => {
    setPayTarget({ id: p.id, valor_cuota: p.valor_cuota, nombre: p.nombre });
    setPayMes("");
    setPayAnio(String(new Date().getFullYear()));
    setPayOpen(true);
  };
  const cerrarModalPago = () => {
    setPayOpen(false);
    setPayTarget(null);
  };
  const confirmarPago = async () => {
    if (!payTarget || !payMes || !payAnio) return;
    setPayBusy(true);
    try {
      await api.post(`/prestamos/${payTarget.id}/pagar`, {
        mes_contable: Number(payMes),
        anio_contable: Number(payAnio),
      });
      cerrarModalPago();
      await load();       // refresca lista/resumen
      await loadDetalle(); // refresca detalle del mes si hay filtro
    } catch (e) {
      alert(e?.response?.data?.detail || "No pude registrar el pago");
    } finally {
      setPayBusy(false);
    }
  };

  const load = async () => {
    try {
      setErr("");
      setLoading(true);
      const { data } = await api.get("/prestamos", {
        params: { mes: fMes || undefined, anio: fAnio || undefined },
      });
      setItems(data.items || []);
      setResumen(data.resumen || { total_mes: 0, saldo_total: 0, pagado_total: 0 });
    } catch (e) {
      setErr(e?.response?.data?.detail || "No pude cargar préstamos");
    } finally {
      setLoading(false);
    }
  };

  const loadDetalle = async () => {
    if (!fMes || !fAnio) {
      setDetalleMes([]);
      setDetalleTotalMes(0);
      setDetErr("");
      return;
    }
    try {
      setDetErr("");
      setDetLoading(true);
      const { data } = await api.get("/prestamos/detalle-mensual", {
        params: { mes: fMes, anio: fAnio },
      });
      setDetalleMes(data.items || []);
      setDetalleTotalMes(data.total_mes || 0);
    } catch (e) {
      setDetErr(e?.response?.data?.detail || "No pude cargar el detalle del mes");
    } finally {
      setDetLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetForm = () => {
    setForm({
      nombre: "",
      valor_cuota: "",
      cuotas_totales: "",
      cuotas_pagadas: "0",
      primer_mes: "",
      primer_anio: "",
      dia_vencimiento: "10",
    });
    setEditingId(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.nombre || !form.valor_cuota || !form.cuotas_totales || !form.primer_mes || !form.primer_anio) return;

    setBusy(true);
    try {
      const payload = {
        nombre: form.nombre,
        valor_cuota: Number(form.valor_cuota),
        cuotas_totales: Number(form.cuotas_totales),
        cuotas_pagadas: Number(form.cuotas_pagadas || 0),
        primer_mes: Number(form.primer_mes),
        primer_anio: Number(form.primer_anio),
        dia_vencimiento: Number(form.dia_vencimiento || 10),
      };

      if (editingId) await api.put(`/prestamos/${editingId}`, payload);
      else await api.post("/prestamos", payload);

      resetForm();
      await load();
      await loadDetalle();
    } catch (e) {
      alert(e?.response?.data?.detail || "No pude guardar el préstamo");
    } finally {
      setBusy(false);
    }
  };

  const handleEdit = (p) => {
    setEditingId(p.id);
    setForm({
      nombre: p.nombre,
      valor_cuota: String(p.valor_cuota),
      cuotas_totales: String(p.cuotas_totales),
      cuotas_pagadas: String(p.cuotas_pagadas ?? 0),
      primer_mes: String(p.primer_mes),
      primer_anio: String(p.primer_anio),
      dia_vencimiento: String(p.dia_vencimiento ?? 10),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (id) => {
    if (!confirm("¿Eliminar este préstamo?")) return;
    try {
      await api.delete(`/prestamos/${id}`);
      await load();
      await loadDetalle();
    } catch (e) {
      alert(e?.response?.data?.detail || "No pude eliminar");
    }
  };

  const actions =
    fMes && fAnio ? (
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={ui.badge}>Pagado en {MESES[fMes - 1]?.label} {fAnio}: <b>{fmtCLP.format(detalleTotalMes || 0)}</b></span>
        <span style={ui.badge}>Pagado total: <b>{fmtCLP.format(resumen.pagado_total || 0)}</b></span>
        <span style={ui.badge}>Saldo total: <b>{fmtCLP.format(resumen.saldo_total || 0)}</b></span>
      </div>
    ) : (
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={ui.badge}>Pagado total: <b>{fmtCLP.format(resumen.pagado_total || 0)}</b></span>
        <span style={ui.badge}>Saldo total: <b>{fmtCLP.format(resumen.saldo_total || 0)}</b></span>
      </div>
    );

  const aplicarFiltros = async () => {
    await load();
    await loadDetalle();
  };

  return (
    <>
      <style>{extraCSS}</style>

      <AppShell title="Préstamos" actions={actions}>
        {/* Filtros */}
        <section style={ui.card}>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>Filtros</div>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            <Labeled label="Mes (todos)">
              <select
                value={fMes}
                onChange={(e) => setFMes(e.target.value)}
                style={styles.input}
                title="Filtrar por mes contable"
              >
                <option value="">Todos</option>
                {MESES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </Labeled>

            <Labeled label="Año (ej: 2025)">
              <input
                type="number"
                value={fAnio}
                onChange={(e) => setFAnio(e.target.value)}
                style={styles.input}
              />
            </Labeled>

            <button onClick={aplicarFiltros} style={styles.smallBtn}>Aplicar</button>
            <button
              onClick={async () => { setFMes(""); setFAnio(""); await aplicarFiltros(); }}
              style={{ ...styles.smallBtn, background: "#8899aa" }}
            >
              Limpiar
            </button>
          </div>
        </section>

        {/* Formulario */}
        <section style={ui.card}>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>
            {editingId ? "✏️ Editar préstamo" : "➕ Agregar préstamo"}
          </div>

          <form onSubmit={handleSubmit} style={styles.grid}>
            <Labeled label="Nombre">
              <input
                value={form.nombre}
                onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                style={styles.input}
              />
            </Labeled>

            <Labeled label="Valor de la cuota">
              <input
                type="number"
                value={form.valor_cuota}
                onChange={(e) => setForm({ ...form, valor_cuota: e.target.value })}
                style={styles.input}
              />
            </Labeled>

            <Labeled label="Cuotas totales">
              <input
                type="number"
                value={form.cuotas_totales}
                onChange={(e) => setForm({ ...form, cuotas_totales: e.target.value })}
                style={styles.input}
              />
            </Labeled>

            <Labeled label="Cuotas pagadas (opcional)">
              <input
                type="number"
                value={form.cuotas_pagadas}
                onChange={(e) => setForm({ ...form, cuotas_pagadas: e.target.value })}
                style={styles.input}
              />
            </Labeled>

            <Labeled label="Primer mes">
              <select
                value={form.primer_mes}
                onChange={(e) => setForm({ ...form, primer_mes: e.target.value })}
                style={styles.input}
                title="Primer mes de pago"
              >
                <option value="">Selecciona…</option>
                {MESES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </Labeled>

            <Labeled label="Primer año">
              <input
                type="number"
                value={form.primer_anio}
                onChange={(e) => setForm({ ...form, primer_anio: e.target.value })}
                style={styles.input}
              />
            </Labeled>

            <Labeled label="Día de vencimiento (1–31)">
              <input
                type="number"
                value={form.dia_vencimiento}
                onChange={(e) => setForm({ ...form, dia_vencimiento: e.target.value })}
                style={styles.input}
                title="Día del mes en que vence cada cuota"
                min={1}
                max={31}
              />
            </Labeled>

            <div style={{ display: "flex", gap: 10 }}>
              <button type="submit" disabled={busy} style={ui.btn}>
                {busy ? "Guardando..." : editingId ? "Guardar cambios" : "Guardar"}
              </button>
              {editingId && (
                <button type="button" onClick={resetForm} style={{ ...ui.btn, background: "#8899aa" }}>
                  Cancelar
                </button>
              )}
            </div>
          </form>
        </section>

        {/* Tabla de préstamos */}
        <section style={ui.card}>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>📄 Préstamos</div>
          {loading && <div>Cargando…</div>}
          {err && <div style={styles.error}>{err}</div>}
          {!loading && !err && (
            items.length === 0 ? (
              <div style={{ opacity: .8 }}>No hay préstamos.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Nombre</th>
                      <th style={styles.th}>Cuota</th>
                      <th style={styles.th}>Pagadas / Totales</th>
                      <th style={styles.th}>Pagado</th>
                      <th style={styles.th}>Saldo</th>
                      <th style={styles.th}>Próxima</th>
                      <th style={styles.th}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((p) => (
                      <tr key={p.id}>
                        <td style={styles.td}>{p.nombre}</td>
                        <td style={styles.td}>{fmtCLP.format(p.valor_cuota)}</td>
                        <td style={styles.td}>
                          {p.cuotas_pagadas} / {p.cuotas_totales}
                          {p.finalizado ? " ✅" : ""}
                        </td>
                        <td style={styles.td}>{fmtCLP.format(p.monto_pagado)}</td>
                        <td style={styles.td}>{fmtCLP.format(p.saldo_restante)}</td>
                        <td style={styles.td}>{fmtFecha(p.proxima_cuota)}</td>
                        <td style={styles.td}>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button
                              onClick={() => abrirModalPago(p)}
                              disabled={p.finalizado}
                              title={p.finalizado ? "Ya está pagado" : "Registrar pago de cuota"}
                              className="btn-pagar"
                            >
                              Pagar cuota
                            </button>
                            <button onClick={() => handleEdit(p)} style={styles.smallBtn}>
                              Editar
                            </button>
                            <button
                              onClick={() => handleDelete(p.id)}
                              style={{ ...styles.smallBtn, background: "#ff3b30", color: "#fff" }}
                            >
                              Eliminar
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </section>

        {/* NUEVO: Panel de Detalle del mes */}
        <section style={ui.card}>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>
            📅 Detalle del mes {fMes && fAnio ? `— ${MESES[fMes - 1]?.label} ${fAnio}` : ""}
          </div>

          {!fMes || !fAnio ? (
            <div style={{ opacity: .8 }}>Selecciona <b>Mes</b> y <b>Año</b> arriba y presiona <b>Aplicar</b> para ver el detalle.</div>
          ) : detLoading ? (
            <div>Cargando detalle…</div>
          ) : detErr ? (
            <div style={styles.error}>{detErr}</div>
          ) : detalleMes.length === 0 ? (
            <div style={{ opacity: .8 }}>No hay cuotas programadas para ese mes.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Préstamo</th>
                    <th style={styles.th}># Cuota</th>
                    <th style={styles.th}>Mes contable</th>
                    <th style={styles.th}>Estado</th>
                    <th style={styles.th}>Monto</th>
                    <th style={styles.th}>Vence el</th>
                    <th style={styles.th}>Fecha de pago</th>
                  </tr>
                </thead>
                <tbody>
                  {detalleMes.map((d, i) => (
                    <tr key={i}>
                      <td style={styles.td}>{d.nombre}</td>
                      <td style={styles.td}>{d.cuota_num}</td>
                      <td style={styles.td}>
                        {MESES[d.mes_contable - 1]?.label} {d.anio_contable}
                      </td>
                      <td style={styles.td}>
                        {d.estado === "pagado" ? "Pagado ✅" : "Pendiente ⏳"}
                      </td>
                      <td style={styles.td}>{fmtCLP.format(d.monto)}</td>
                      <td style={styles.td}>{fmtFecha(d.vence_el)}</td>
                      <td style={styles.td}>{fmtFecha(d.fecha_pago)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </AppShell>

      {/* Modal de pago */}
      {payOpen && (
        <div className="modal-mask" onClick={cerrarModalPago}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>
              Registrar pago {payTarget?.nombre ? `– ${payTarget.nombre}` : ""}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Labeled label="Mes">
                <select value={payMes} onChange={(e) => setPayMes(e.target.value)} style={styles.input}>
                  <option value="">Selecciona…</option>
                  {MESES.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </Labeled>
              <Labeled label="Año">
                <input type="number" value={payAnio} onChange={(e) => setPayAnio(e.target.value)} style={styles.input} />
              </Labeled>
            </div>
            <div className="modal-actions">
              <button onClick={cerrarModalPago} style={{ ...ui.btn, background: "#8899aa" }}>Cancelar</button>
              <button onClick={confirmarPago} disabled={payBusy || !payMes || !payAnio} className="btn-pagar">
                {payBusy ? "Guardando..." : "Confirmar pago"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const styles = {
  labeled: { display: "flex", flexDirection: "column", gap: 6 },
  labelText: { fontSize: 12, color: "#8ea3c0", paddingLeft: 2 },
  input: {
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid #23304a",
    background: "#0e1626",
    color: "#e6f0ff",
    width: "100%",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 16,
    alignItems: "end",
  },
  smallBtn: {
    padding: "6px 10px",
    border: 0,
    borderRadius: 8,
    background: "#ffd166",
    color: "#162",
    fontWeight: 700,
    cursor: "pointer",
  },
  error: { background: "#ff3b30", color: "#fff", padding: "8px 10px", borderRadius: 8 },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", padding: "10px 8px", borderBottom: "1px solid #1f2a44", whiteSpace: "nowrap" },
  td: { padding: "8px", borderBottom: "1px solid #1f2a44" },
};