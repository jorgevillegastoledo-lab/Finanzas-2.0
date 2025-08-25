// frontend/src/pages/FormasPago.jsx
import React, { useEffect, useState } from "react";
import AppShell, { ui } from "../components/AppShell";
import api from "../api/api";

export default function FormasPago() {
  // filtros
  const [filtro, setFiltro] = useState("activos");  // activos | inactivos | todos
  const [q, setQ] = useState("");

  // datos
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // crear
  const [nuevo, setNuevo] = useState({ nombre: "", codigo: "", con_tarjeta: false });

  // edición inline
  const [editId, setEditId] = useState(null);
  const [edit, setEdit] = useState({ nombre: "", codigo: "", con_tarjeta: false });

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const { data } = await api.get("/formas-pago", { params: { q, estado: filtro } });
      setRows(data?.data || data || []);
    } catch (e) {
      setErr(e?.response?.data?.detail || "No pude cargar formas de pago");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [q, filtro]);

  async function crear(e) {
    e.preventDefault();
    try {
      if (!nuevo.nombre.trim()) return alert("Nombre requerido");
      await api.post("/formas-pago", {
        nombre: nuevo.nombre.trim(),
        codigo: nuevo.codigo || null,
        con_tarjeta: !!nuevo.con_tarjeta,
      });
      setNuevo({ nombre: "", codigo: "", con_tarjeta: false });
      await load();
    } catch (e) {
      alert(e?.response?.data?.detail || "No pude crear");
    }
  }

  function startEdit(r) {
    setEditId(r.id);
    setEdit({
      nombre: r.nombre || "",
      codigo: r.codigo || "",
      con_tarjeta: !!r.con_tarjeta,
    });
  }
  function cancelEdit() {
    setEditId(null);
    setEdit({ nombre: "", codigo: "", con_tarjeta: false });
  }
  async function saveEdit(id) {
    try {
      await api.put(`/formas-pago/${id}`, edit);
      cancelEdit();
      await load();
    } catch (e) {
      alert(e?.response?.data?.detail || "No pude actualizar");
    }
  }

  async function onToggleActivo(row) {
    try {
      // endpoint dedicado /estado (como bancos)
      await api.put(`/formas-pago/${row.id}/estado`, null, { params: { activo: !row.activo } });
      await load();
    } catch (e) {
      alert(e?.response?.data?.detail || "No pude cambiar estado");
    }
  }

  return (
    <AppShell title="Maestros — Formas de pago">
      <div style={{ display: "grid", gap: 16 }}>
        {/* Filtros + actualizar */}
        <div style={{ ...ui.card, display: "grid", gap: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              style={styles.input}
              placeholder="Buscar…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select value={filtro} onChange={(e) => setFiltro(e.target.value)} style={styles.input}>
              <option value="activos">Activos</option>
              <option value="inactivos">Inactivos</option>
              <option value="todos">Todos</option>
            </select>
            {err && <div style={styles.error}>{err}</div>}
            <div style={{ marginLeft: "auto" }}>
              <button onClick={load} style={ui.btn}>Actualizar</button>
            </div>
          </div>

          {/* Crear */}
          <form onSubmit={crear} style={{ display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 700 }}>Crear nuevo</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 220px 160px auto", gap: 8 }}>
              <input
                style={styles.input}
                value={nuevo.nombre}
                onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
                placeholder="Nombre (ej: Crédito)"
              />
              <input
                style={styles.input}
                value={nuevo.codigo}
                onChange={(e) => setNuevo({ ...nuevo, codigo: e.target.value })}
                placeholder="Código (ej: credito)"
              />
              <label style={{ ...styles.input, display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={nuevo.con_tarjeta}
                  onChange={(e) => setNuevo({ ...nuevo, con_tarjeta: e.target.checked })}
                />
                Con tarjeta
              </label>
              <button style={ui.btn} type="submit">Crear</button>
            </div>
          </form>
        </div>

        {/* Lista */}
        <div style={ui.card}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Formas de pago ({rows.length})</div>
          {loading ? <div>Cargando…</div> : (
            <div style={{ display: "grid", gap: 6 }}>
              <div style={styles.headerRow}>
                <div>Nombre</div>
                <div>Código</div>
                <div>Con tarjeta</div>
                <div>Estado</div>
                <div style={{ textAlign: "right" }}>Acciones</div>
              </div>

              {rows.map((r) => (
                <div key={r.id} style={styles.row}>
                  {/* Nombre */}
                  <div>
                    {editId === r.id ? (
                      <input
                        style={styles.input}
                        value={edit.nombre}
                        onChange={(e) => setEdit({ ...edit, nombre: e.target.value })}
                      />
                    ) : r.nombre}
                  </div>

                  {/* Código */}
                  <div>
                    {editId === r.id ? (
                      <input
                        style={styles.input}
                        value={edit.codigo}
                        onChange={(e) => setEdit({ ...edit, codigo: e.target.value })}
                      />
                    ) : (r.codigo || "—")}
                  </div>

                  {/* Con tarjeta */}
                  <div>
                    {editId === r.id ? (
                      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={!!edit.con_tarjeta}
                          onChange={(e) => setEdit({ ...edit, con_tarjeta: e.target.checked })}
                        />
                        Con tarjeta
                      </label>
                    ) : (r.con_tarjeta ? "Sí" : "No")}
                  </div>

                  {/* Estado */}
                  <div>
                    <span style={{ ...ui.badge, background: r.activo ? "#173c2a" : "#3a1a1a" }}>
                      {r.activo ? "Activo" : "Inactivo"}
                    </span>
                  </div>

                  {/* Acciones */}
                  <div style={{ textAlign: "right", display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    {editId === r.id ? (
                      <>
                        <button style={ui.btn} onClick={() => saveEdit(r.id)}>Guardar</button>
                        <button style={{ ...ui.btn, background: "#8899aa" }} onClick={cancelEdit}>Cancelar</button>
                      </>
                    ) : (
                      <>
                        <button style={ui.btn} onClick={() => startEdit(r)}>Editar</button>
                        <button
                          style={{ ...ui.btn, background: r.activo ? "#e76f51" : "#2a9d8f" }}
                          onClick={() => onToggleActivo(r)}
                        >
                          {r.activo ? "Desactivar" : "Activar"}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

const styles = {
  input: { padding: "8px 10px", borderRadius: 8, border: "1px solid #23304a", background: "#0e1626", color: "#e6f0ff" },
  error: { background: "#ff3b30", color: "#fff", padding: "6px 10px", borderRadius: 8 },
  headerRow: { display: "grid", gridTemplateColumns: "1.2fr 220px 160px 140px 200px", gap: 8, opacity: .8, fontWeight: 700, paddingBottom: 6, borderBottom: "1px solid #23304a" },
  row: { display: "grid", gridTemplateColumns: "1.2fr 220px 160px 140px 200px", gap: 8, alignItems: "center", padding: "8px 0", borderBottom: "1px dashed #1f2a44" },
};



