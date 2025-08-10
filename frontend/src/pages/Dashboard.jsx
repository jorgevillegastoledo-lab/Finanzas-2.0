import React, { useContext, useEffect, useState } from "react";
import { AuthContext } from "../context/AuthContext";
import api from "../api/api";

export default function Dashboard() {
  const { user, logout } = useContext(AuthContext);

  const [gastos, setGastos] = useState([]);
  const [loadingG, setLoadingG] = useState(true);
  const [errorG, setErrorG] = useState("");

  const [form, setForm] = useState({ nombre: "", monto: "", mes: "", anio: "", pagado: false });
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msgErr, setMsgErr] = useState("");

  const fmt = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
  const meses = ["","Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

  const loadGastos = async () => {
    try {
      setErrorG("");
      const { data } = await api.get("/gastos");
      const items = Array.isArray(data) ? data : data.items ?? [];
      setGastos(items);
    } catch (err) {
      setErrorG(err?.response?.data?.detail || "No pude cargar gastos");
    } finally {
      setLoadingG(false);
    }
  };
  useEffect(() => { loadGastos(); }, []);

  const resetForm = () => {
    setForm({ nombre: "", monto: "", mes: "", anio: "", pagado: false });
    setEditingId(null);
    setMsgErr("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMsgErr("");
    if (!form.nombre || !form.monto) { setMsgErr("Nombre y monto son obligatorios."); return; }
    setBusy(true);
    try {
      if (editingId) {
        await api.put(`/gastos/${editingId}`, {
          nombre: form.nombre,
          monto: Number(form.monto),
          mes: form.mes ? Number(form.mes) : null,
          anio: form.anio ? Number(form.anio) : null,
          pagado: Boolean(form.pagado),
        });
      } else {
        await api.post("/gastos", {
          nombre: form.nombre,
          monto: Number(form.monto),
          mes: form.mes ? Number(form.mes) : null,
          anio: form.anio ? Number(form.anio) : null,
          pagado: Boolean(form.pagado),
        });
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
    <div style={styles.wrapper}>
      <header style={styles.header}>
        <div>📊 Finanzas 2.0 — Dashboard</div>
        <div>
          <span style={{ marginRight: 12, opacity: 0.8 }}>{user?.email}</span>
          <button onClick={logout} style={styles.btn}>Salir</button>
        </div>
      </header>

      <main style={styles.main}>
        <div style={styles.card}>
          <h2>¡Bienvenido!</h2>
          <p>Ruta protegida. Ya estás autenticado con tu token JWT.</p>
        </div>

        <div style={styles.card}>
          <div style={styles.cardTitle}>{editingId ? "✏️ Editar gasto" : "➕ Agregar gasto"}</div>
          <form onSubmit={handleSubmit} style={styles.grid}>
            <input placeholder="Nombre" value={form.nombre}
                   onChange={(e)=>setForm({...form, nombre:e.target.value})} style={styles.input}/>
            <input placeholder="Monto" type="number" value={form.monto}
                   onChange={(e)=>setForm({...form, monto:e.target.value})} style={styles.input}/>
            <input placeholder="Mes (1-12)" type="number" min="1" max="12" value={form.mes}
                   onChange={(e)=>setForm({...form, mes:e.target.value})} style={styles.input}/>
            <input placeholder="Año (ej: 2025)" type="number" value={form.anio}
                   onChange={(e)=>setForm({...form, anio:e.target.value})} style={styles.input}/>
            <label style={{display:"flex",alignItems:"center",gap:8}}>
              <input type="checkbox" checked={form.pagado}
                     onChange={(e)=>setForm({...form, pagado:e.target.checked})}/>
              Pagado
            </label>
            <div style={{display:"flex", gap:10}}>
              <button type="submit" disabled={busy} style={styles.btn}>
                {busy ? "Guardando..." : (editingId ? "Guardar cambios" : "Guardar")}
              </button>
              {editingId && (
                <button type="button" onClick={resetForm} style={{...styles.btn, background:"#8899aa"}}>
                  Cancelar
                </button>
              )}
            </div>
          </form>
          {msgErr && <div style={styles.error}>{msgErr}</div>}
        </div>

        <div style={styles.card}>
          <div style={styles.cardTitle}>🧾 Gastos</div>
          {loadingG && <div>Cargando gastos…</div>}
          {errorG && <div style={styles.error}>{errorG}</div>}
          {!loadingG && !errorG && (
            gastos.length === 0 ? (
              <div style={{ opacity: .8 }}>No hay gastos aún.</div>
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
                          <div style={{display:"flex", gap:8}}>
                            <button onClick={()=>handleEdit(g)} style={styles.smallBtn}>Editar</button>
                            <button onClick={()=>handleDelete(g.id)} style={{...styles.smallBtn, background:"#ff3b30", color:"#fff"}}>Eliminar</button>
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
      </main>
    </div>
  );
}

const styles = {
  wrapper: { minHeight: "100vh", background: "#0b1220", color: "#e6f0ff" },
  header: { display: "flex", justifyContent: "space-between", padding: "12px 18px", borderBottom: "1px solid #1f2a44", background:"#0f1a2a" },
  main: { padding: 24, display: "grid", gap: 16 },
  card: { background: "#121a2b", padding: 20, borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,.35)" },
  btn: { padding: "8px 12px", border: 0, borderRadius: 8, background: "#71d07e", color: "#032312", fontWeight: 700, cursor: "pointer" },
  smallBtn: { padding: "6px 10px", border: 0, borderRadius: 8, background: "#ffd166", color:"#162", fontWeight: 700, cursor: "pointer" },
  cardTitle: { fontWeight: 700, marginBottom: 12 },
  error: { background: "#ff3b30", color: "#fff", padding: "8px 10px", borderRadius: 8 },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", padding: "10px 8px", borderBottom: "1px solid #1f2a44", whiteSpace: "nowrap" },
  td: { padding: "8px", borderBottom: "1px solid #1f2a44" },
  grid: { display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 10, alignItems: "center" },
  input: { padding: "8px 10px", borderRadius: 8, border: "1px solid #23304a", background: "#0e1626", color: "#e6f0ff" },
};
