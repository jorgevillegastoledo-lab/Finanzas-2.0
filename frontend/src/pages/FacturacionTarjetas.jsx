import React, { useEffect, useState } from "react";
import AppShell, { ui } from "../components/AppShell";
import api from "../api/api";

const MESES = ["","Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const hoy = new Date();

export default function FacturacionTarjetas() {
  const [tarjetas, setTarjetas] = useState([]);
  const [loadingT, setLoadingT] = useState(true);
  const [errT, setErrT] = useState("");

  const [facturas, setFacturas] = useState([]);
  const [loadingF, setLoadingF] = useState(false);
  const [errF, setErrF] = useState("");

  const [form, setForm] = useState({
    tarjeta_id: "",       // vacío = ver TODAS
    mes: hoy.getMonth()+1,
    anio: hoy.getFullYear(),
    total: "",
  });

  const fmt = new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0});

  const loadTarjetas = async () => {
    try {
      setLoadingT(true); setErrT("");
      const { data } = await api.get("/tarjetas");
      const items = Array.isArray(data) ? data : data.data || [];
      setTarjetas(items);
    } catch (e) {
      setErrT(e?.response?.data?.detail || "No pude cargar tarjetas");
    } finally {
      setLoadingT(false);
    }
  };

  const loadFacturas = async () => {
    try {
      setLoadingF(true); setErrF("");
      const params = { mes: form.mes, anio: form.anio };
      if (form.tarjeta_id) params.tarjeta_id = form.tarjeta_id;
      const { data } = await api.get("/facturas", { params });
      setFacturas(Array.isArray(data) ? data : data.data || []);
    } catch (e) {
      setErrF(e?.response?.data?.detail || "No pude cargar facturas");
    } finally {
      setLoadingF(false);
    }
  };

  useEffect(()=>{ loadTarjetas(); },[]);
  useEffect(()=>{ loadFacturas(); },[form.tarjeta_id, form.mes, form.anio]);

  const guardar = async () => {
    if (!form.tarjeta_id || !form.total) {
      alert("Selecciona una tarjeta y escribe el total.");
      return;
    }
    try {
      await api.post("/facturas", {
        tarjeta_id: Number(form.tarjeta_id),
        mes: Number(form.mes),
        anio: Number(form.anio),
        total: Number(form.total),
      });
      setForm({ ...form, total: "" });
      await loadFacturas();
    } catch (e) {
      alert(e?.response?.data?.detail || "No pude guardar la factura");
    }
  };

  const marcarPagada = async (id) => {
    try {
      await api.put(`/facturas/${id}/pagar`);
      await loadFacturas();
    } catch (e) {
      alert(e?.response?.data?.detail || "No pude marcar como pagada");
    }
  };

  const deshacerPagada = async (id) => {
    try {
      await api.put(`/facturas/${id}/pendiente`);
      await loadFacturas();
    } catch (e) {
      alert(e?.response?.data?.detail || "No pude deshacer");
    }
  };

  const eliminar = async (id) => {
    if (!confirm("¿Eliminar factura?")) return;
    try {
      await api.delete(`/facturas/${id}`);
      await loadFacturas();
    } catch (e) {
      alert(e?.response?.data?.detail || "No pude eliminar");
    }
  };

  const totalMes = facturas.reduce((acc,f)=>acc+Number(f.total||0),0);

  return (
    <AppShell
      title="Facturación tarjetas"
      actions={<button style={ui.btn} onClick={()=>{loadTarjetas(); loadFacturas();}}>Actualizar</button>}
    >
      {/* Filtros + alta */}
      <div style={ui.card}>
        <div style={{ fontWeight:700, marginBottom:12 }}>🧾 Facturación de tarjetas (mes/año)</div>

        <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1fr 1fr auto", gap:10 }}>
          {/* Dejar vacía para ver TODAS en la lista */}
          <select
            value={form.tarjeta_id}
            onChange={(e)=>setForm({ ...form, tarjeta_id: e.target.value })}
            style={styles.input}
            disabled={loadingT}
          >
            <option value="">{loadingT? "Cargando tarjetas…" : "Todas las tarjetas (para listar)"}</option>
            {tarjetas.map(t=>(
              <option key={t.id} value={t.id}>
                {(t.banco? t.banco+" — " : "") + (t.nombre || `Tarjeta #${t.id}`)}
              </option>
            ))}
          </select>

          <select
            value={form.mes}
            onChange={(e)=>setForm({ ...form, mes: Number(e.target.value) })}
            style={styles.input}
          >
            {MESES.slice(1).map((m,i)=>(
              <option key={i+1} value={i+1}>{m}</option>
            ))}
          </select>

          <input
            type="number"
            value={form.anio}
            onChange={(e)=>setForm({ ...form, anio: Number(e.target.value || hoy.getFullYear()) })}
            style={styles.input}
          />

          <input
            type="number"
            placeholder="Total facturado"
            value={form.total}
            onChange={(e)=>setForm({ ...form, total: e.target.value })}
            style={styles.input}
          />

          <button style={ui.btn} onClick={guardar} disabled={!form.tarjeta_id || !form.total}>Guardar</button>
        </div>
      </div>

      {/* Lista */}
      <div style={ui.card}>
        <div style={{ fontWeight:700, marginBottom:12 }}>📑 Facturas</div>

        {loadingF ? (
          <div>Cargando…</div>
        ) : errF ? (
          <div style={styles.error}>{errF}</div>
        ) : facturas.length === 0 ? (
          <div style={{ opacity:.8 }}>No hay facturas.</div>
        ) : (
          <>
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead>
                  <tr>
                    <th style={styles.th}>ID</th>
                    <th style={styles.th}>Tarjeta</th>
                    <th style={styles.th}>Mes</th>
                    <th style={styles.th}>Año</th>
                    <th style={styles.th}>Total</th>
                    <th style={styles.th}>Pagada</th>
                    <th style={styles.th}>Fecha pago</th>
                    <th style={styles.th}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {facturas.map(f=>(
                    <tr key={f.id}>
                      <td style={styles.td}>{f.id}</td>
                      <td style={styles.td}>{(f.banco? f.banco+" — " : "") + (f.tarjeta || "")}</td>
                      <td style={styles.td}>{MESES[f.mes]}</td>
                      <td style={styles.td}>{f.anio}</td>
                      <td style={styles.td}>{fmt.format(Number(f.total||0))}</td>
                      <td style={styles.td}>{f.pagado ? "Sí" : "No"}</td>
                      <td style={styles.td}>{f.pagado_at ? String(f.pagado_at).replace("T"," ").slice(0,19) : "-"}</td>
                      <td style={styles.td}>
                        <div style={{ display:"flex", gap:8 }}>
                          {f.pagado ? (
                            <button onClick={()=>deshacerPagada(f.id)} style={{ ...styles.smallBtn, background:"#1e90ff", color:"#fff" }}>
                              Deshacer
                            </button>
                          ) : (
                            <button onClick={()=>marcarPagada(f.id)} style={{ ...styles.smallBtn, background:"#1e90ff", color:"#fff" }}>
                              Marcar pagada
                            </button>
                          )}
                          <button onClick={()=>eliminar(f.id)} style={{ ...styles.smallBtn, background:"#ff3b30", color:"#fff" }}>
                            Eliminar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop:10, opacity:.9 }}>
              Total del mes (filtrado): <b>{fmt.format(totalMes)}</b>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

const styles = {
  input: {
    padding:"8px 10px",
    borderRadius:8,
    border:"1px solid #23304a",
    background:"#0e1626",
    color:"#e6f0ff",
  },
  th: {
    textAlign:"left",
    padding:"10px 8px",
    borderBottom:"1px solid #1f2a44",
    whiteSpace:"nowrap",
  },
  td: { padding:"8px", borderBottom:"1px solid #1f2a44" },
  smallBtn: {
    padding:"6px 10px",
    border:0,
    borderRadius:8,
    background:"#ffd166",
    color:"#162",
    fontWeight:700,
    cursor:"pointer",
  },
  error:{ background:"#ff3b30", color:"#fff", padding:"8px 10px", borderRadius:8 }
};
