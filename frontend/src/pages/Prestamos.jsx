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

export default function Prestamos() {
  // Lista + resumen
  const [items, setItems] = useState([]);
  const [resumen, setResumen] = useState({ total_mes: 0, saldo_total: 0, pagado_total: 0 });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // Filtros
  const [fMes, setFMes] = useState("");
  const [fAnio, setFAnio] = useState("");

  // Form
  const [form, setForm] = useState({
    nombre: "",
    valor_cuota: "",
    cuotas_totales: "",
    cuotas_pagadas: "0", // inicial opcional
    primer_mes: "",
    primer_anio: "",
    dia_vencimiento: "10",
  });
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setErr("");
      setLoading(true);
      const { data } = await api.get("/prestamos", {
        params: {
          mes: fMes || undefined,
          anio: fAnio || undefined,
        },
      });
      setItems(data.items || []);
      setResumen(data.resumen || { total_mes: 0, saldo_total: 0, pagado_total: 0 });
    } catch (e) {
      setErr(e?.response?.data?.detail || "No pude cargar préstamos");
    } finally {
      setLoading(false);
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

      if (editingId) {
        await api.put(`/prestamos/${editingId}`, payload);
      } else {
        await api.post("/prestamos", payload);
      }
      resetForm();
      await load();
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
    } catch (e) {
      alert(e?.response?.data?.detail || "No pude eliminar");
    }
  };

  const pagarCuota = async (id) => {
    try {
      await api.post(`/prestamos/${id}/pagar`);
      await load();
    } catch (e) {
      alert(e?.response?.data?.detail || "No pude registrar el pago de la cuota");
    }
  };

  const actions =
    fMes || fAnio ? (
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={ui.badge}>A pagar este mes: <b>{fmtCLP.format(resumen.total_mes || 0)}</b></span>
        <span style={ui.badge}>Pagado total: <b>{fmtCLP.format(resumen.pagado_total || 0)}</b></span>
        <span style={ui.badge}>Saldo total: <b>{fmtCLP.format(resumen.saldo_total || 0)}</b></span>
      </div>
    ) : (
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={ui.badge}>Pagado total: <b>{fmtCLP.format(resumen.pagado_total || 0)}</b></span>
        <span style={ui.badge}>Saldo total: <b>{fmtCLP.format(resumen.saldo_total || 0)}</b></span>
      </div>
    );

  return (
    <AppShell title="Préstamos" actions={actions}>
      {/* Filtros */}
      <section style={ui.card}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Filtros</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <select value={fMes} onChange={(e) => setFMes(e.target.value)} style={styles.input}>
            <option value="">Mes (todos)</option>
            {Array.from({ length: 12 }).map((_, i) => (
              <option key={i + 1} value={i + 1}>{i + 1}</option>
            ))}
          </select>
          <input
            type="number"
            placeholder="Año (ej: 2025)"
            value={fAnio}
            onChange={(e) => setFAnio(e.target.value)}
            style={styles.input}
          />
          <button onClick={load} style={styles.smallBtn}>Aplicar</button>
          <button
            onClick={() => {
              setFMes("");
              setFAnio("");
              load();
            }}
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
          <input
            placeholder="Nombre"
            value={form.nombre}
            onChange={(e) => setForm({ ...form, nombre: e.target.value })}
            style={styles.input}
          />
          <input
            type="number"
            placeholder="Valor de la cuota"
            value={form.valor_cuota}
            onChange={(e) => setForm({ ...form, valor_cuota: e.target.value })}
            style={styles.input}
          />
          <input
            type="number"
            placeholder="Cuotas totales"
            value={form.cuotas_totales}
            onChange={(e) => setForm({ ...form, cuotas_totales: e.target.value })}
            style={styles.input}
          />
          <input
            type="number"
            placeholder="Cuotas pagadas (opcional)"
            value={form.cuotas_pagadas}
            onChange={(e) => setForm({ ...form, cuotas_pagadas: e.target.value })}
            style={styles.input}
          />
          <input
            type="number"
            placeholder="Primer mes (1-12)"
            value={form.primer_mes}
            onChange={(e) => setForm({ ...form, primer_mes: e.target.value })}
            style={styles.input}
          />
          <input
            type="number"
            placeholder="Primer año (ej: 2025)"
            value={form.primer_anio}
            onChange={(e) => setForm({ ...form, primer_anio: e.target.value })}
            style={styles.input}
          />
          <input
            type="number"
            placeholder="Día vencimiento (1-31)"
            value={form.dia_vencimiento}
            onChange={(e) => setForm({ ...form, dia_vencimiento: e.target.value })}
            style={styles.input}
          />

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

      {/* Tabla */}
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
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            onClick={() => pagarCuota(p.id)}
                            disabled={p.finalizado}
                            title={p.finalizado ? "Ya está pagado" : "Pagar 1 cuota"}
                            style={styles.smallBtn}
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
    </AppShell>
  );
}

const styles = {
  input: { padding: "8px 10px", borderRadius: 8, border: "1px solid #23304a", background: "#0e1626", color: "#e6f0ff" },
  grid: { display: "grid", gridTemplateColumns: "repeat(7, minmax(0,1fr))", gap: 10, alignItems: "center" },
  smallBtn: { padding: "6px 10px", border: 0, borderRadius: 8, background: "#ffd166", color: "#162", fontWeight: 700, cursor: "pointer" },
  error: { background: "#ff3b30", color: "#fff", padding: "8px 10px", borderRadius: 8 },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", padding: "10px 8px", borderBottom: "1px solid #1f2a44", whiteSpace: "nowrap" },
  td: { padding: "8px", borderBottom: "1px solid #1f2a44" },
};
