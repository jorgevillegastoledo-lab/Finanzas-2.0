// frontend/src/pages/AdminConceptos.jsx
import React, { useEffect, useState } from "react";
import AppShell, { ui } from "../components/AppShell";
import { ConceptosAPI } from "../api/api";

const TIPOS = ["normal", "esporadico", "suscripcion"];

export default function AdminConceptos() {
  const [filtro, setFiltro] = useState("true"); // true|false|all
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // form crear
  const [nombre, setNombre] = useState("");
  const [categoria, setCategoria] = useState("");
  const [tipo, setTipo] = useState("normal");

  // edición en fila
  const [editId, setEditId] = useState(null);
  const [edit, setEdit] = useState({ nombre: "", categoria: "", tipo_concepto: "normal" });

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const { data } = await ConceptosAPI.list(filtro);
      setRows(data?.data || []);
    } catch (e) {
      setErr(e?.response?.data?.detail || "No se pudo cargar conceptos");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [filtro]);

  async function onCreate(e) {
    e.preventDefault();
    try {
      if (!nombre.trim()) return alert("Ingresa un nombre");
      await ConceptosAPI.create({ nombre: nombre.trim(), categoria: categoria || null, tipo_concepto: tipo });
      setNombre(""); setCategoria(""); setTipo("normal");
      await load();
    } catch (e) {
      if (e?.response?.status === 409) alert("Nombre duplicado.");
      else alert(e?.response?.data?.detail || "Error al crear");
    }
  }

  async function onSave(rowId) {
    try {
      const payload = {};
      if (edit.nombre !== undefined) payload.nombre = edit.nombre;
      if (edit.categoria !== undefined) payload.categoria = edit.categoria;
      if (edit.tipo_concepto !== undefined) payload.tipo_concepto = edit.tipo_concepto;
      await ConceptosAPI.update(rowId, payload);
      setEditId(null);
      await load();
    } catch (e) {
      if (e?.response?.status === 409) alert("Nombre duplicado.");
      else alert(e?.response?.data?.detail || "Error al editar");
    }
  }

  async function onToggleActivo(row) {
    try {
      await ConceptosAPI.setActivo(row.id, !row.activo);
      await load();
    } catch (e) {
      alert(e?.response?.data?.detail || "Error al cambiar estado");
    }
  }

  return (
    <AppShell title="Maestros — Conceptos">
      <div style={{ display: "grid", gap: 16 }}>
        <div style={{ ...ui.card, display: "grid", gap: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ fontWeight: 700 }}>Filtro:</div>
            <select value={filtro} onChange={(e) => setFiltro(e.target.value)} style={styles.input}>
              <option value="true">Activos</option>
              <option value="false">Inactivos</option>
              <option value="all">Todos</option>
            </select>
            {err && <div style={styles.error}>{err}</div>}
            <div style={{ marginLeft: "auto" }}>
              <button onClick={load} style={ui.btn}>Actualizar</button>
            </div>
          </div>

          <form onSubmit={onCreate} style={{ display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 700 }}>Crear nuevo</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 200px auto", gap: 8 }}>
              <input style={styles.input} value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre (ej: LUZ)" />
              <input style={styles.input} value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="Categoría (opcional)" />
              <select style={styles.input} value={tipo} onChange={(e) => setTipo(e.target.value)}>
                {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <button style={ui.btn} type="submit">Crear</button>
            </div>
          </form>
        </div>

        <div style={ui.card}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Conceptos ({rows.length})</div>
          {loading ? <div>Cargando…</div> : (
            <div style={{ display: "grid", gap: 6 }}>
              <div style={styles.headerRow}>
                <div>Nombre</div>
                <div>Categoría</div>
                <div>Tipo</div>
                <div>Estado</div>
                <div style={{ textAlign: "right" }}>Acciones</div>
              </div>

              {rows.map((r) => (
                <div key={r.id} style={styles.row}>
                  <div>
                    {editId === r.id ? (
                      <input style={styles.input} value={edit.nombre} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} />
                    ) : r.nombre}
                  </div>
                  <div>
                    {editId === r.id ? (
                      <input style={styles.input} value={edit.categoria ?? ""} onChange={(e) => setEdit({ ...edit, categoria: e.target.value })} />
                    ) : (r.categoria || "—")}
                  </div>
                  <div>
                    {editId === r.id ? (
                      <select style={styles.input} value={edit.tipo_concepto} onChange={(e) => setEdit({ ...edit, tipo_concepto: e.target.value })}>
                        {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    ) : r.tipo_concepto}
                  </div>
                  <div>
                    <span style={{ ...ui.badge, background: r.activo ? "#173c2a" : "#3a1a1a" }}>
                      {r.activo ? "Activo" : "Inactivo"}
                    </span>
                  </div>
                  <div style={{ textAlign: "right", display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    {editId === r.id ? (
                      <>
                        <button style={ui.btn} onClick={() => onSave(r.id)}>Guardar</button>
                        <button style={{ ...ui.btn, background: "#8899aa" }} onClick={() => setEditId(null)}>Cancelar</button>
                      </>
                    ) : (
                      <>
                        <button
                          style={ui.btn}
                          onClick={() => { setEditId(r.id); setEdit({ nombre: r.nombre, categoria: r.categoria ?? "", tipo_concepto: r.tipo_concepto }); }}
                        >
                          Editar
                        </button>
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
  headerRow: { display: "grid", gridTemplateColumns: "1.2fr 1fr 200px 140px 200px", gap: 8, opacity: .8, fontWeight: 700, paddingBottom: 6, borderBottom: "1px solid #23304a" },
  row: { display: "grid", gridTemplateColumns: "1.2fr 1fr 200px 140px 200px", gap: 8, alignItems: "center", padding: "8px 0", borderBottom: "1px dashed #1f2a44" },
};
