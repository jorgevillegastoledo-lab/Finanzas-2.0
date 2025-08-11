// frontend/src/pages/Gastos.jsx
import React, { useEffect, useState } from "react";
import AppShell, { ui } from "../components/AppShell";
import api from "../api/api";

export default function Gastos() {
  const [gastos, setGastos] = useState([]);
  const [loadingG, setLoadingG] = useState(true);
  const [errorG, setErrorG] = useState("");
  const [totales, setTotales] = useState({ mes: null, anio: null });

  const [form, setForm] = useState({
    nombre: "",
    monto: "",
    mes: "",
    anio: "",
    pagado: false,
  });
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msgErr, setMsgErr] = useState("");

  // Filtros
  const [fMes, setFMes] = useState("");
  const [fAnio, setFAnio] = useState("");
  const [fPagado, setFPagado] = useState(false);

  const fmt = new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  });
  const meses = [
    "",
    "Enero","Febrero","Marzo","Abril","Mayo","Junio",
    "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
  ];

  const calcularTotales = (items) => {
    const base = fPagado ? items.filter((g) => !!g.pagado) : items;
    const totalMes  = fMes  !== "" ? base.reduce((a, g) => a + (Number(g.monto) || 0), 0) : null;
    const totalAnio = fAnio !== "" ? base.reduce((a, g) => a + (Number(g.monto) || 0), 0) : null;
    setTotales({ mes: totalMes, anio: totalAnio });
  };

  const loadGastos = async () => {
    try {
      setErrorG("");
      setLoadingG(true);

      // ⚠️ Con el backend nuevo, si no hay MES y AÑO juntos, NO llamamos a la API
      if (!fMes || !fAnio) {
        setGastos([]);
        setTotales({ mes: null, anio: null });
        return;
      }

      const { data } = await api.get("/gastos", {
        params: {
          mes: Number(fMes),
          anio: Number(fAnio),
          // el backend actual no usa 'pagado' como query;
          // si quieres filtrar, lo hacemos client-side:
          // pagado: fPagado ? true : undefined,
        },
      });

      // El backend ahora responde { ok: true, data: [...] }
      const itemsRaw = Array.isArray(data) ? data : (data?.data ?? data?.items ?? []);
      const items = fPagado ? itemsRaw.filter((g) => !!g.pagado) : itemsRaw;

      setGastos(items);
      if (data?.totales && (data.totales.mes !== undefined || data.totales.anio !== undefined)) {
        setTotales({ mes: data.totales.mes ?? null, anio: data.totales.anio ?? null });
      } else {
        calcularTotales(items);
      }
    } catch (err) {
      // Si por error se llamó sin params, el backend devuelve 422; mostramos mensaje simple
      const msg = err?.response?.data?.detail || "No pude cargar gastos";
      setErrorG(msg);
    } finally {
      setLoadingG(false);
    }
  };

  useEffect(() => {
    // Al montar ya no llamamos si no hay filtros; dejamos la página vacía
    setLoadingG(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetForm = () => {
    setForm({ nombre: "", monto: "", mes: "", anio: "", pagado: false });
    setEditingId(null);
    setMsgErr("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMsgErr("");

    if (!form.nombre || !form.monto) {
      setMsgErr("Nombre y monto son obligatorios.");
      return;
    }

    setBusy(true);
    try {
      const payload = {
        nombre: form.nombre,
        monto: Number(form.monto),
        mes: form.mes ? Number(form.mes) : null,
        anio: form.anio ? Number(form.anio) : null,
        pagado: Boolean(form.pagado),
      };

      if (editingId) {
        await api.put(`/gastos/${editingId}`, payload);
      } else {
        await api.post("/gastos", payload);
      }
      resetForm();
      await loadGastos();
    } catch (err) {
      setMsgErr(err?.response?.data?.detail || "No pude guardar el gasto");
    } finally {
      setBusy(false);
    }
  };

  const handleEdit = (g) => {
    setEditingId(g.id);
    setForm({
      nombre: g.nombre ?? "",
      monto: g.monto ?? "",
      mes: g.mes ?? "",
      anio: g.anio ?? "",
      pagado: Boolean(g.pagado),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (id) => {
    if (!confirm("¿Eliminar gasto?")) return;
    try {
      await api.delete(`/gastos/${id}`);
      await loadGastos();
    } catch (err) {
      alert(err?.response?.data?.detail || "No pude eliminar");
    }
  };

  return (
    <AppShell
      title="Gastos"
      actions={
        <button onClick={loadGastos} style={ui.btn}>
          Actualizar
        </button>
      }
    >
      {/* Formulario */}
      <div style={ui.card}>
        <div style={styles.cardTitle}>
          {editingId ? "✏️ Editar gasto" : "➕ Agregar gasto"}
        </div>
        <form onSubmit={handleSubmit} style={styles.grid}>
          <input
            placeholder="Nombre"
            value={form.nombre}
            onChange={(e) => setForm({ ...form, nombre: e.target.value })}
            style={styles.input}
          />
          <input
            placeholder="Monto"
            type="number"
            value={form.monto}
            onChange={(e) => setForm({ ...form, monto: e.target.value })}
            style={styles.input}
          />
          <input
            placeholder="Mes (1-12)"
            type="number"
            min="1"
            max="12"
            value={form.mes}
            onChange={(e) => setForm({ ...form, mes: e.target.value })}
            style={styles.input}
          />
          <input
            placeholder="Año (ej: 2025)"
            type="number"
            value={form.anio}
            onChange={(e) => setForm({ ...form, anio: e.target.value })}
            style={styles.input}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={form.pagado}
              onChange={(e) => setForm({ ...form, pagado: e.target.checked })}
            />
            Pagado
          </label>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="submit" disabled={busy} style={ui.btn}>
              {busy ? "Guardando..." : editingId ? "Guardar cambios" : "Guardar"}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                style={{ ...ui.btn, background: "#8899aa" }}
              >
                Cancelar
              </button>
            )}
          </div>
        </form>
        {msgErr && <div style={styles.error}>{msgErr}</div>}
      </div>

      {/* Filtros + totales */}
      <div style={ui.card}>
        <div style={styles.cardTitle}>Filtros</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
          <select value={fMes} onChange={(e) => setFMes(e.target.value)} style={styles.input}>
            <option value="">Mes (todos)</option>
            {[...Array(12)].map((_, i) => (
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

          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={fPagado}
              onChange={(e) => setFPagado(e.target.checked)}
            />
            Pagado
          </label>

          <button onClick={loadGastos} style={styles.smallBtn}>Aplicar</button>
          <button
            onClick={() => {
              setFMes("");
              setFAnio("");
              setFPagado(false);
              setTotales({ mes: null, anio: null });
              setGastos([]);
              setErrorG("");
            }}
            style={{ ...styles.smallBtn, background: "#8899aa" }}
          >
            Limpiar
          </button>
        </div>

        <div style={{ display: "flex", gap: 16, opacity: 0.9 }}>
          {totales?.mes !== null  && <div> Total mes:  <b>{fmt.format(totales.mes)}</b>  </div>}
          {totales?.anio !== null && <div> Total año: <b>{fmt.format(totales.anio)}</b> </div>}
        </div>
      </div>

      {/* Tabla */}
      <div style={ui.card}>
        <div style={styles.cardTitle}>🧾 Lista de gastos</div>
        {loadingG && <div>Cargando gastos…</div>}
        {errorG && <div style={styles.error}>{errorG}</div>}
        {!loadingG && !errorG && (
          gastos.length === 0 ? (
            <div style={{ opacity: 0.8 }}>
              {(!fMes || !fAnio) ? "Selecciona Mes y Año y presiona Aplicar." : "No hay gastos."}
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>ID</th>
                    <th style={styles.th}>Nombre</th>
                    <th style={styles.th}>Monto</th>
                    <th style={styles.th}>Mes</th>
                    <th style={styles.th}>Año</th>
                    <th style={styles.th}>Pagado</th>
                    <th style={styles.th}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {gastos.map((g) => (
                    <tr key={g.id}>
                      <td style={styles.td}>{g.id}</td>
                      <td style={styles.td}>{g.nombre}</td>
                      <td style={styles.td}>{fmt.format(Number(g.monto || 0))}</td>
                      <td style={styles.td}>{g.mes ? meses[g.mes] : "-"}</td>
                      <td style={styles.td}>{g.anio ?? "-"}</td>
                      <td style={styles.td}>{g.pagado ? "Sí" : "No"}</td>
                      <td style={styles.td}>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={() => handleEdit(g)} style={styles.smallBtn}>Editar</button>
                          <button
                            onClick={() => handleDelete(g.id)}
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
      </div>
    </AppShell>
  );
}

const styles = {
  cardTitle: { fontWeight: 700, marginBottom: 12 },
  input: {
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid #23304a",
    background: "#0e1626",
    color: "#e6f0ff",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
    gap: 10,
    alignItems: "center",
  },
  table: { width: "100%", borderCollapse: "collapse" },
  th: {
    textAlign: "left",
    padding: "10px 8px",
    borderBottom: "1px solid #1f2a44",
    whiteSpace: "nowrap",
  },
  td: { padding: "8px", borderBottom: "1px solid #1f2a44" },
  smallBtn: {
    padding: "6px 10px",
    border: 0,
    borderRadius: 8,
    background: "#ffd166",
    color: "#162",
    fontWeight: 700,
    cursor: "pointer",
  },
  error: {
    background: "#ff3b30",
    color: "#fff",
    padding: "8px 10px",
    borderRadius: 8,
  },
};
