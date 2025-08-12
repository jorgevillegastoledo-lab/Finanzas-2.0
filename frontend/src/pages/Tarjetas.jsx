// frontend/src/pages/Tarjetas.jsx
import React, { useEffect, useState } from "react";
import AppShell, { ui } from "../components/AppShell";
import api from "../api/api";

const emptyForm = {
  nombre: "",
  banco: "",
  tipo: "credito",
  limite: "",
  cierre_dia: "",
  vencimiento_dia: "",
  activa: true,
};

export default function Tarjetas() {
  const [form, setForm] = useState(emptyForm);
  const [items, setItems] = useState([]);
  const [editId, setEditId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = async () => {
    try {
      setErr(""); setLoading(true);
      const { data } = await api.get("/tarjetas");
      setItems(Array.isArray(data) ? data : data.data || []);
    } catch (e) {
      setErr(e?.response?.data?.detail || "No pude cargar tarjetas");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const reset = () => { setForm(emptyForm); setEditId(null); };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.nombre.trim()) return alert("Nombre es obligatorio");

    setBusy(true);
    try {
      const payload = {
        nombre: form.nombre.trim(),
        banco: form.banco.trim() || null,
        tipo: form.tipo, // 'credito' | 'debito'
        limite: form.limite !== "" ? Number(form.limite) : null,
        cierre_dia: form.cierre_dia !== "" ? Number(form.cierre_dia) : null,
        vencimiento_dia: form.vencimiento_dia !== "" ? Number(form.vencimiento_dia) : null,
        activa: !!form.activa,
      };

      if (editId) {
        await api.put(`/tarjetas/${editId}`, payload);
      } else {
        await api.post("/tarjetas", payload);
      }
      reset();
      await load();
    } catch (e) {
      alert(e?.response?.data?.detail || "No pude guardar");
    } finally {
      setBusy(false);
    }
  };

  const onEdit = (t) => {
    setEditId(t.id);
    setForm({
      nombre: t.nombre || "",
      banco: t.banco || "",
      tipo: t.tipo || "credito",
      limite: t.limite ?? "",
      cierre_dia: t.cierre_dia ?? "",
      vencimiento_dia: t.vencimiento_dia ?? "",
      activa: t.activa !== false,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const onDelete = async (id) => {
    if (!confirm("¿Desactivar tarjeta?")) return;
    try {
      await api.delete(`/tarjetas/${id}`);
      await load();
    } catch (e) {
      alert(e?.response?.data?.detail || "No pude eliminar");
    }
  };

  return (
    <AppShell
      title="Tarjetas"
      actions={<button style={ui.btn} onClick={load}>Actualizar</button>}
    >
      {/* Formulario */}
      <div style={ui.card}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>
          {editId ? "✏️ Editar tarjeta" : "➕ Agregar tarjeta"}
        </div>

        <form
          onSubmit={submit}
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1.5fr 1fr 1fr 1fr 1fr auto",
            gap: 10,
            alignItems: "center",
          }}
        >
          <input
            placeholder="Nombre"
            value={form.nombre}
            onChange={(e)=>setForm({...form, nombre: e.target.value})}
            style={styles.input}
          />
          <input
            placeholder="Banco"
            value={form.banco}
            onChange={(e)=>setForm({...form, banco: e.target.value})}
            style={styles.input}
          />
          <select
            value={form.tipo}
            onChange={(e)=>setForm({...form, tipo: e.target.value})}
            style={styles.input}
          >
            <option value="credito">Crédito</option>
            <option value="debito">Débito</option>
          </select>

          <input
            placeholder="Límite (opcional)"
            type="number"
            value={form.limite}
            onChange={(e)=>setForm({...form, limite: e.target.value})}
            style={styles.input}
          />

          {/* Día cierre */}
          <select
            value={form.cierre_dia === "" ? "" : Number(form.cierre_dia)}
            onChange={(e)=>
              setForm({...form, cierre_dia: e.target.value ? Number(e.target.value) : ""})
            }
            style={styles.input}
          >
            <option value="">Día cierre</option>
            {[...Array(31)].map((_, i) => (
              <option key={i+1} value={i+1}>Día {i+1}</option>
            ))}
          </select>

          {/* Día vencimiento */}
          <select
            value={form.vencimiento_dia === "" ? "" : Number(form.vencimiento_dia)}
            onChange={(e)=>
              setForm({...form, vencimiento_dia: e.target.value ? Number(e.target.value) : ""})
            }
            style={styles.input}
          >
            <option value="">Día vencimiento</option>
            {[...Array(31)].map((_, i) => (
              <option key={i+1} value={i+1}>Día {i+1}</option>
            ))}
          </select>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={form.activa}
              onChange={(e)=>setForm({...form, activa: e.target.checked})}
            />
            Activa
          </label>

          <div style={{ display: "flex", gap: 10 }}>
            <button type="submit" style={ui.btn} disabled={busy}>
              {busy ? "Guardando..." : editId ? "Guardar" : "Crear"}
            </button>
            {editId && (
              <button type="button" onClick={reset} style={{ ...ui.btn, background:"#8899aa" }}>
                Cancelar
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Lista */}
      <div style={ui.card}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Tarjetas activas</div>
        {loading ? (
          <div>Cargando…</div>
        ) : err ? (
          <div style={styles.error}>{err}</div>
        ) : items.length === 0 ? (
          <div style={{ opacity:.8 }}>No hay tarjetas.</div>
        ) : (
          <div style={{ overflowX:"auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={styles.th}>ID</th>
                  <th style={styles.th}>Nombre</th>
                  <th style={styles.th}>Banco</th>
                  <th style={styles.th}>Tipo</th>
                  <th style={styles.th}>Límite</th>
                  <th style={styles.th}>Cierre</th>
                  <th style={styles.th}>Venc.</th>
                  <th style={styles.th}>Activa</th>
                  <th style={styles.th}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {items.map((t) => (
                  <tr key={t.id}>
                    <td style={styles.td}>{t.id}</td>
                    <td style={styles.td}>{t.nombre}</td>
                    <td style={styles.td}>{t.banco ?? "-"}</td>
                    <td style={styles.td}>{t.tipo}</td>
                    <td style={styles.td}>{t.limite ?? "-"}</td>
                    <td style={styles.td}>{t.cierre_dia ?? "-"}</td>
                    <td style={styles.td}>{t.vencimiento_dia ?? "-"}</td>
                    <td style={styles.td}>{t.activa ? "Sí" : "No"}</td>
                    <td style={styles.td}>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button style={styles.smallBtn} onClick={()=>onEdit(t)}>Editar</button>
                        <button
                          style={{ ...styles.smallBtn, background:"#ff3b30", color:"#fff" }}
                          onClick={()=>onDelete(t.id)}
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
  input: {
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid #23304a",
    background: "#0e1626",
    color: "#e6f0ff",
  },
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
  error: { background:"#ff3b30", color:"#fff", padding:"8px 10px", borderRadius:8 },
};
