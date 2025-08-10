// frontend/src/pages/Prestamos.jsx
import React, { useState } from "react";
import AppShell, { ui } from "../components/AppShell";

export default function Prestamos() {
  // Formulario local (UI)
  const [form, setForm] = useState({
    nombre: "",
    monto: "",
    cuotas: "",
    tasa: "",
  });

  // Lista local (UI)
  const [items, setItems] = useState([]);

  const add = (e) => {
    e.preventDefault();
    if (!form.nombre || !form.monto) return;

    setItems((prev) => [
      ...prev,
      {
        id: Date.now(),
        nombre: form.nombre,
        monto: Number(form.monto),
        cuotas: form.cuotas ? Number(form.cuotas) : null,
        tasa: form.tasa ? Number(form.tasa) : null,
      },
    ]);

    setForm({ nombre: "", monto: "", cuotas: "", tasa: "" });
  };

  const del = (id) =>
    setItems((prev) => prev.filter((x) => x.id !== id));

  const fmt = new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  });

  return (
    <AppShell title="Préstamos">
      {/* Formulario */}
      <div style={ui.card}>
        <div style={styles.cardTitle}>➕ Agregar préstamo</div>
        <form onSubmit={add} style={styles.grid}>
          <input
            placeholder="Nombre"
            value={form.nombre}
            onChange={(e) => setForm({ ...form, nombre: e.target.value })}
            style={styles.input}
          />
          <input
            type="number"
            placeholder="Monto"
            value={form.monto}
            onChange={(e) => setForm({ ...form, monto: e.target.value })}
            style={styles.input}
          />
          <input
            type="number"
            placeholder="Cuotas (opcional)"
            value={form.cuotas}
            onChange={(e) => setForm({ ...form, cuotas: e.target.value })}
            style={styles.input}
          />
          <input
            type="number"
            placeholder="Tasa % mensual (opcional)"
            value={form.tasa}
            onChange={(e) => setForm({ ...form, tasa: e.target.value })}
            style={styles.input}
          />

          <div style={{ display: "flex", gap: 10 }}>
            <button type="submit" style={ui.btn}>Guardar</button>
          </div>
        </form>
      </div>

      {/* Tabla */}
      <div style={ui.card}>
        <div style={styles.cardTitle}>🧾 Lista de préstamos</div>
        {items.length === 0 ? (
          <div style={{ opacity: 0.8 }}>Aún no hay préstamos.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>ID</th>
                  <th style={styles.th}>Nombre</th>
                  <th style={styles.th}>Monto</th>
                  <th style={styles.th}>Cuotas</th>
                  <th style={styles.th}>Tasa %</th>
                  <th style={styles.th}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id}>
                    <td style={styles.td}>{p.id}</td>
                    <td style={styles.td}>{p.nombre}</td>
                    <td style={styles.td}>{fmt.format(p.monto || 0)}</td>
                    <td style={styles.td}>{p.cuotas ?? "-"}</td>
                    <td style={styles.td}>{p.tasa ?? "-"}</td>
                    <td style={styles.td}>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          onClick={() => del(p.id)}
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
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
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
};
