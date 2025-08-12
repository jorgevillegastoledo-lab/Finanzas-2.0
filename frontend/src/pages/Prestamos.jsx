// frontend/src/pages/Prestamos.jsx
import React, { useEffect, useMemo, useState } from "react";
import AppShell, { ui } from "../components/AppShell";
import api from "../api/api";

const mesesNombres = [
  "", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

const fmt = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

export default function Prestamos() {
  const [prestamos, setPrestamos] = useState([]);
  const [pagos, setPagos] = useState([]); // pagos_prestamo
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // selección
  const [seleccionado, setSeleccionado] = useState(null); // objeto préstamo
  const seleccionadoId = seleccionado?.id ?? null;

  // formulario alta
  const [form, setForm] = useState({
    nombre: "",
    valor_cuota: "",
    cuotas_totales: "",
    primer_mes: "",
    primer_anio: "",
    dia_vencimiento: 10,
    banco: "",
  });

  // form edición/pago para el seleccionado
  const [edit, setEdit] = useState({
    valor_cuota: "",
    cuotas_totales: "",
    cuotas_pagadas: "",
    primer_mes: "",
    primer_anio: "",
    dia_vencimiento: "",
    banco: "",
  });
  const [pay, setPay] = useState({ mes: "", anio: "", monto: "" });

  const meses = Array.from({ length: 12 }, (_, i) => i + 1);

  // ----------------------------------
  // Cargar datos
  // ----------------------------------
  const loadAll = async () => {
    try {
      setLoading(true);
      setErr("");

      const [pRes, pgRes] = await Promise.all([
        api.get("/prestamos"),
        api.get("/pagos_prestamo").catch(() => ({ data: { ok: true, data: [] } })), // tolerante
      ]);

      const pItems = Array.isArray(pRes.data)
        ? pRes.data
        : pRes.data?.data || [];

      const pgItems = Array.isArray(pgRes.data)
        ? pgRes.data
        : pgRes.data?.data || [];

      setPrestamos(pItems);
      setPagos(pgItems);

      // si tengo un seleccionado, refresco su info editable
      if (seleccionadoId) {
        const found = pItems.find((x) => x.id === seleccionadoId);
        if (found) fillEditForm(found);
      }
    } catch (e) {
      setErr(e?.response?.data?.detail || "No pude cargar préstamos.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----------------------------------
  // Agregados calculados por préstamo
  // total_pagado, deuda_restante, último pago (mes/año)
  // ----------------------------------
  const pagosPorPrestamo = useMemo(() => {
    const map = new Map();
    for (const p of pagos) {
      const key = p.prestamo_id;
      if (!map.has(key)) {
        map.set(key, {
          total_pagado: 0,
          ultimo_mes: null,
          ultimo_anio: null,
        });
      }
      const item = map.get(key);
      item.total_pagado += Number(p.monto_pagado || 0);

      // último pago por (anio, mes)
      const ma = Number(p.anio_contable || 0);
      const mm = Number(p.mes_contable || 0);
      if (
        item.ultimo_anio == null ||
        ma > item.ultimo_anio ||
        (ma === item.ultimo_anio && mm > (item.ultimo_mes || 0))
      ) {
        item.ultimo_anio = ma;
        item.ultimo_mes = mm;
      }
    }
    return map;
  }, [pagos]);

  const prestamosConTotales = useMemo(() => {
    return prestamos.map((r) => {
      const ext = pagosPorPrestamo.get(r.id) || {
        total_pagado: 0,
        ultimo_mes: null,
        ultimo_anio: null,
      };
      const valor = Number(r.valor_cuota || 0);
      const tot = Number(r.cuotas_totales || 0);
      const totalTeorico = valor * tot;
      const deuda_restante = Math.max(totalTeorico - ext.total_pagado, 0);

      return {
        ...r,
        total_pagado: ext.total_pagado,
        deuda_restante,
        ultimo_mes: ext.ultimo_mes,
        ultimo_anio: ext.ultimo_anio,
      };
    });
  }, [prestamos, pagosPorPrestamo]);

  // ----------------------------------
  // UI helpers
  // ----------------------------------
  const cleanAlta = () => {
    setForm({
      nombre: "",
      valor_cuota: "",
      cuotas_totales: "",
      primer_mes: "",
      primer_anio: "",
      dia_vencimiento: 10,
      banco: "",
    });
  };

  const fillEditForm = (p) => {
    setEdit({
      valor_cuota: p.valor_cuota || "",
      cuotas_totales: p.cuotas_totales || "",
      cuotas_pagadas: p.cuotas_pagadas || 0,
      primer_mes: p.primer_mes || "",
      primer_anio: p.primer_anio || "",
      dia_vencimiento: p.dia_vencimiento || 10,
      banco: p.banco || "",
    });
    // sugerir pago por defecto (mes/año del día)
    const now = new Date();
    setPay({
      mes: now.getMonth() + 1,
      anio: now.getFullYear(),
      monto: p.valor_cuota || "",
    });
  };

  const onSelectRow = (r) => {
    setSeleccionado(r);
    fillEditForm(r);
  };

  // ----------------------------------
  // Acciones
  // ----------------------------------
  const guardarNuevo = async () => {
    try {
      if (!form.nombre || !form.valor_cuota || !form.cuotas_totales) {
        alert("Nombre, valor de la cuota y cuotas totales son obligatorios.");
        return;
      }
      const payload = {
        nombre: form.nombre,
        valor_cuota: Number(form.valor_cuota),
        cuotas_totales: Number(form.cuotas_totales),
        primer_mes: form.primer_mes ? Number(form.primer_mes) : null,
        primer_anio: form.primer_anio ? Number(form.primer_anio) : null,
        dia_vencimiento: form.dia_vencimiento
          ? Number(form.dia_vencimiento)
          : 10,
        banco: form.banco || null,
      };
      await api.post("/prestamos", payload);
      cleanAlta();
      await loadAll();
    } catch (e) {
      alert(e?.response?.data?.detail || "No pude guardar el préstamo.");
    }
  };

  const guardarEdicion = async () => {
    try {
      if (!seleccionadoId) return;
      const payload = {
        nombre: seleccionado.nombre, // si quieres permitir editar nombre, añade un input
        valor_cuota: Number(edit.valor_cuota || 0),
        cuotas_totales: Number(edit.cuotas_totales || 0),
        cuotas_pagadas: Number(edit.cuotas_pagadas || 0),
        primer_mes: edit.primer_mes ? Number(edit.primer_mes) : null,
        primer_anio: edit.primer_anio ? Number(edit.primer_anio) : null,
        dia_vencimiento: edit.dia_vencimiento
          ? Number(edit.dia_vencimiento)
          : 10,
        banco: edit.banco || null,
      };
      await api.put(`/prestamos/${seleccionadoId}`, payload);
      await loadAll();
    } catch (e) {
      alert(e?.response?.data?.detail || "No pude guardar los cambios.");
    }
  };

  const eliminarPrestamo = async () => {
    try {
      if (!seleccionadoId) return;
      if (!confirm("¿Eliminar este préstamo?")) return;
      await api.delete(`/prestamos/${seleccionadoId}`);
      setSeleccionado(null);
      await loadAll();
    } catch (e) {
      alert(e?.response?.data?.detail || "No pude eliminar el préstamo.");
    }
  };

  const marcarPago = async () => {
    try {
      if (!seleccionadoId) return;
      if (!pay.mes || !pay.anio || !pay.monto) {
        alert("Mes, año y monto son obligatorios.");
        return;
      }
      await api.post("/pagos_prestamo", {
        prestamo_id: seleccionadoId,
        mes_contable: Number(pay.mes),
        anio_contable: Number(pay.anio),
        monto_pagado: Number(pay.monto),
        fecha_pago: new Date().toISOString().slice(0, 10),
      });
      await loadAll();
    } catch (e) {
      alert(e?.response?.data?.detail || "No pude registrar el pago.");
    }
  };

  // ----------------------------------
  // Render
  // ----------------------------------
  return (
    <AppShell
      title="Préstamos"
      actions={
        <button style={ui.btn} onClick={loadAll}>
          Actualizar
        </button>
      }
    >
      {/* Alta */}
      <div style={ui.card}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>➕ Agregar préstamo</div>

        <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr 1fr 1fr 1fr", gap: 10 }}>
          <input
            placeholder="Nombre"
            value={form.nombre}
            onChange={(e) => setForm({ ...form, nombre: e.target.value })}
            style={styles.input}
          />
          <input
            placeholder="Valor de la cuota"
            type="number"
            value={form.valor_cuota}
            onChange={(e) => setForm({ ...form, valor_cuota: e.target.value })}
            style={styles.input}
          />
          <input
            placeholder="Cuotas totales"
            type="number"
            value={form.cuotas_totales}
            onChange={(e) => setForm({ ...form, cuotas_totales: e.target.value })}
            style={styles.input}
          />
          <select
            value={form.primer_mes || ""}
            onChange={(e) => setForm({ ...form, primer_mes: e.target.value })}
            style={styles.input}
          >
            <option value="">Selecciona...</option>
            {meses.map((m) => (
              <option key={m} value={m}>{mesesNombres[m]}</option>
            ))}
          </select>
          <input
            placeholder="Primer año (opcional)"
            type="number"
            value={form.primer_anio}
            onChange={(e) => setForm({ ...form, primer_anio: e.target.value })}
            style={styles.input}
          />
          <input
            placeholder="Banco (opcional)"
            value={form.banco}
            onChange={(e) => setForm({ ...form, banco: e.target.value })}
            style={styles.input}
          />
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
          <button style={ui.btn} onClick={guardarNuevo}>Guardar</button>
          <button style={{ ...ui.btn, background: "#8899aa" }} onClick={cleanAlta}>
            Limpiar
          </button>
        </div>
      </div>

      {/* Tabla de préstamos */}
      <div style={ui.card}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>📄 Préstamos</div>
        {loading ? (
          <div>Cargando...</div>
        ) : err ? (
          <div style={styles.error}>{err}</div>
        ) : prestamosConTotales.length === 0 ? (
          <div style={{ opacity: 0.8 }}>No hay préstamos.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>ID</th>
                  <th style={styles.th}>Nombre</th>
                  <th style={styles.th}>Valor cuota</th>
                  <th style={styles.th}>Cuotas totales</th>
                  <th style={styles.th}>Total pagado</th>
                  <th style={styles.th}>Deuda restante</th>
                  <th style={styles.th}>Último pago</th>
                </tr>
              </thead>
              <tbody>
                {prestamosConTotales.map((r) => {
                  const isSel = r.id === seleccionadoId;
                  return (
                    <tr
                      key={r.id}
                      onClick={() => onSelectRow(r)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelectRow(r)}
                      role="button"
                      tabIndex={0}
                      style={{
                        cursor: "pointer",
                        background: isSel ? "rgba(113,208,126,.15)" : "transparent",
                      }}
                    >
                      <td style={styles.td}>{r.id}</td>
                      <td style={styles.td}>{r.nombre}</td>
                      <td style={styles.td}>{fmt.format(r.valor_cuota || 0)}</td>
                      <td style={styles.td}>{r.cuotas_totales}</td>
                      <td style={styles.td}>{fmt.format(r.total_pagado || 0)}</td>
                      <td style={styles.td}>{fmt.format(r.deuda_restante || 0)}</td>
                      <td style={styles.td}>
                        {r.ultimo_mes ? `${mesesNombres[r.ultimo_mes]} ${r.ultimo_anio}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Panel de acciones del seleccionado */}
      {seleccionado && (
        <div style={ui.card}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>
            ✏️ Editar — <span style={ui.badge}>ID {seleccionado.id} · {seleccionado.nombre}</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr 1fr", gap: 10 }}>
            <input
              placeholder="Valor cuota"
              type="number"
              value={edit.valor_cuota}
              onChange={(e) => setEdit({ ...edit, valor_cuota: e.target.value })}
              style={styles.input}
            />
            <input
              placeholder="Cuotas totales"
              type="number"
              value={edit.cuotas_totales}
              onChange={(e) => setEdit({ ...edit, cuotas_totales: e.target.value })}
              style={styles.input}
            />
            <input
              placeholder="Cuotas pagadas"
              type="number"
              value={edit.cuotas_pagadas}
              onChange={(e) => setEdit({ ...edit, cuotas_pagadas: e.target.value })}
              style={styles.input}
            />
            <select
              value={edit.primer_mes || ""}
              onChange={(e) => setEdit({ ...edit, primer_mes: e.target.value })}
              style={styles.input}
            >
              <option value="">Selecciona...</option>
              {meses.map((m) => (
                <option key={m} value={m}>{mesesNombres[m]}</option>
              ))}
            </select>
            <input
              placeholder="Primer año"
              type="number"
              value={edit.primer_anio}
              onChange={(e) => setEdit({ ...edit, primer_anio: e.target.value })}
              style={styles.input}
            />
            <input
              placeholder="Banco (opcional)"
              value={edit.banco}
              onChange={(e) => setEdit({ ...edit, banco: e.target.value })}
              style={styles.input}
            />
          </div>

          <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
            <button style={ui.btn} onClick={guardarEdicion}>Guardar cambios</button>
            <button style={{ ...ui.btn, background: "#ff3b30", color: "#fff" }} onClick={eliminarPrestamo}>
              Eliminar
            </button>
          </div>

          <hr style={{ borderColor: "#1f2a44", margin: "18px 0" }} />

          <div style={{ fontWeight: 700, marginBottom: 10 }}>💳 Marcar pago</div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={pay.mes || ""}
              onChange={(e) => setPay({ ...pay, mes: Number(e.target.value) })}
              style={styles.input}
            >
              <option value="">Mes</option>
              {meses.map((m) => (
                <option key={m} value={m}>{mesesNombres[m]}</option>
              ))}
            </select>
            <input
              placeholder="Año"
              type="number"
              value={pay.anio}
              onChange={(e) => setPay({ ...pay, anio: Number(e.target.value) })}
              style={styles.input}
            />
            <input
              placeholder="Monto"
              type="number"
              value={pay.monto}
              onChange={(e) => setPay({ ...pay, monto: e.target.value })}
              style={styles.input}
            />
            <button style={ui.btn} onClick={marcarPago}>
              Marcar pago ({fmt.format(Number(pay.monto || 0))})
            </button>
          </div>
        </div>
      )}
    </AppShell>
  );
}

const styles = {
  input: {
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid #23304a",
    background: "#0e1626",
    color: "#e6f0ff",
  },
  table: { width: "100%", borderCollapse: "collapse" },
  th: {
    textAlign: "left",
    padding: "10px 8px",
    borderBottom: "1px solid #1f2a44",
    whiteSpace: "nowrap",
    fontWeight: 700,
  },
  td: {
    padding: "8px",
    borderBottom: "1px solid #1f2a44",
    whiteSpace: "nowrap",
  },
  error: {
    background: "#ff3b30",
    color: "#fff",
    padding: "8px 10px",
    borderRadius: 8,
  },
};
