// frontend/src/pages/Tarjetas.jsx
import React, { useState } from "react";
import AppShell, { ui } from "../components/AppShell";

export default function Tarjetas() {
  const [form, setForm] = useState({ banco: "", mes: "", anio: "", total: "" });
  const [items, setItems] = useState([]);

  const fmt = new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  });

  const add = (e) => {
    e.preventDefault();
    if (!form.banco || !form.total) return;
    setItems((prev) => [...prev, { id: Date.now(), ...form }]);
    setForm({ banco: "", mes: "", anio: "", total: "" });
  };

  const del = (id) => setItems((prev) => prev.filter((x) => x.id !== id));

  return (
    <AppShell
      title="Facturación tarjetas"
      actions={
        items.length > 0 ? (
          <button
            onClick={() => setItems([])}
            style={{ ...ui.btn, background: "#8899aa" }}
            title="Limpiar listado (UI)"
          >
            Limpiar
          </button>
        ) : null
      }
    >
      {/* Formulario (UI) */}
      <div style={ui.card}>
        <div style={styles.cardTitle}>🧾 Facturación de tarjetas (UI)</div>
        <form onSubmit={add} style={styles.grid}>
          <input
            placeholder="Banco / Tarjeta"
            value={form.banco}
            onChange={(e) => setForm({ ...form, banco: e.target.value })}
            style={styles.input}
          />
          <input
            type="number"
            placeholder="Mes (1-12)"
            value={form.mes}
            onChange={(e) => setForm({ ...form, mes: e.target.value })}
            style={styles.input}
          />
          <input
            type="number"
            placeholder="Año"
            value={form.anio}
            onChange={(e) => setForm({ ...form, anio: e.target.value })}
            style={styles.input}
          />
          <input
            type="number"
            placeholder="Total facturado"
            value={form.total}
            onChange={(e) => setForm({ ...form, total: e.target.value })}
            style={styles.input}
          />
          <button type="submit" style={ui.btn}>Guardar</button>
        </form>
      </div>

      {/* Tabla (UI) */}
      <div style={ui.card}>
        <div style={styles.cardTitle}>📄 Facturas</div>
        {items.length === 0 ? (
          <div style={{ opacity: 0.8 }}>No hay facturas todavía.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>ID</th>
                  <th style={styles.th}>Tarjeta</th>
                  <th style={styles.th}>Mes</th>
                  <th style={styles.th}>Año</th>
                  <th style={styles.th}>Total</th>
                  <th style={styles.th}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td style={styles.td}>{it.id}</td>
                    <td style={styles.td}>{it.banco}</td>
                    <td style={styles.td}>{it.mes || "-"}</td>
                    <td style={styles.td}>{it.anio || "-"}</td>
                    <td style={styles.td}>{fmt.format(Number(it.total || 0))}</td>
                    <td style={styles.td}>
                      <button
                        onClick={() => del(it.id)}
                        style={{ ...styles.smallBtn, background: "#ff3b30", color: "#fff" }}
                      >
                        Eliminar
                      </button>
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
    gridTemplateColumns: "repeat(5, minmax(0,1fr))",
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
