// src/pages/Dashboard.jsx
import React, { useContext, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import api from "../api/api";

export default function Dashboard() {
  const { user, logout } = useContext(AuthContext);

  const [mes, setMes] = useState(new Date().getMonth() + 1); // 1..12
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  const fmt = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
  const meses = ["","Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

  const loadResumen = async () => {
    try {
      setErr("");
      const { data } = await api.get("/gastos/resumen", { params: { mes, anio } });
      setData(data);
    } catch (e) {
      setErr(e?.response?.data?.detail || "No pude cargar el resumen");
    }
  };

  useEffect(() => { loadResumen(); }, []); // primera carga
  // Si prefieres que cambie automáticamente al cambiar filtros:
  // useEffect(() => { loadResumen(); }, [mes, anio]);

  return (
    <div style={styles.wrapper}>
      <header style={styles.header}>
        <div>📊 Finanzas 2.0 — Dashboard</div>
        <div style={{display:"flex",gap:12,alignItems:"center"}}>
          <Link to="/gastos" style={{...styles.smallBtn, textDecoration:"none"}}>Ir a Gastos</Link>
          <span style={{opacity:.8}}>{user?.email}</span>
          <button onClick={logout} style={styles.btn}>Salir</button>
        </div>
      </header>

      <main style={styles.main}>
        <div style={styles.card}>
          <h2 style={{marginTop:0}}>Resumen del Mes</h2>

          {/* Filtros */}
          <div style={{display:"flex", gap:10, alignItems:"center", marginBottom:12}}>
            <select value={mes} onChange={(e)=>setMes(Number(e.target.value))} style={styles.input}>
              {[...Array(12)].map((_,i)=>(<option key={i+1} value={i+1}>{i+1} - {meses[i+1]}</option>))}
            </select>
            <input type="number" value={anio} onChange={(e)=>setAnio(Number(e.target.value))} style={styles.input} />
            <button onClick={loadResumen} style={styles.smallBtn}>Aplicar</button>
          </div>

          {err && <div style={styles.error}>{err}</div>}

          {!data ? (
            <div>Cargando…</div>
          ) : (
            <>
              <div style={styles.cardsRow}>
                <div style={styles.kpi}>
                  <div style={styles.kpiLabel}>Total del mes</div>
                  <div style={styles.kpiValue}>{fmt.format(data.total_mes)}</div>
                </div>
                <div style={styles.kpi}>
                  <div style={styles.kpiLabel}>Pagado</div>
                  <div style={styles.kpiValue}>{fmt.format(data.total_pagado)}</div>
                </div>
                <div style={styles.kpi}>
                  <div style={styles.kpiLabel}>Pendiente</div>
                  <div style={styles.kpiValue}>{fmt.format(data.total_pendiente)}</div>
                </div>
                <div style={styles.kpi}>
                  <div style={styles.kpiLabel}>Total año</div>
                  <div style={styles.kpiValue}>{fmt.format(data.total_anio)}</div>
                </div>
              </div>

              {/* Barra de progreso pagado */}
              <div style={{marginTop:16}}>
                <div style={{display:"flex", justifyContent:"space-between", marginBottom:6}}>
                  <div>Avance del mes</div>
                  <div>{data.pct_pagado}%</div>
                </div>
                <div style={styles.progressBg}>
                  <div style={{ ...styles.progressFg, width: `${data.pct_pagado}%` }} />
                </div>
              </div>
            </>
          )}
        </div>

        <div style={styles.card}>
          <h3 style={{marginTop:0}}>¿Qué sigue?</h3>
          <ul>
            <li>Gráfico de evolución mensual (12 meses)</li>
            <li>Resumen de tarjetas y préstamos</li>
            <li>Alertas (gastos cercanos a vencer, etc.)</li>
          </ul>
        </div>
      </main>
    </div>
  );
}

const styles = {
  wrapper:{ minHeight:"100vh", background:"#0b1220", color:"#e6f0ff" },
  header:{ display:"flex", justifyContent:"space-between", padding:"12px 18px", borderBottom:"1px solid #1f2a44", background:"#0f1a2a" },
  main:{ padding:24, display:"grid", gap:16 },
  card:{ background:"#121a2b", padding:20, borderRadius:12, boxShadow:"0 10px 30px rgba(0,0,0,.35)" },
  btn:{ padding:"8px 12px", border:0, borderRadius:8, background:"#71d07e", color:"#032312", fontWeight:700, cursor:"pointer" },
  smallBtn:{ padding:"6px 10px", border:0, borderRadius:8, background:"#ffd166", color:"#162", fontWeight:700, cursor:"pointer" },
  input:{ padding:"8px 10px", borderRadius:8, border:"1px solid #23304a", background:"#0e1626", color:"#e6f0ff" },
  error:{ background:"#ff3b30", color:"#fff", padding:"8px 10px", borderRadius:8 },
  cardsRow:{ display:"grid", gridTemplateColumns:"repeat(4, minmax(0,1fr))", gap:12 },
  kpi:{ background:"#0e1626", padding:12, borderRadius:10, border:"1px solid #1f2a44" },
  kpiLabel:{ opacity:.8, fontSize:13, marginBottom:4 },
  kpiValue:{ fontWeight:800, fontSize:20 },
  progressBg:{ width:"100%", height:12, borderRadius:999, background:"#1a2741" },
  progressFg:{ height:"100%", borderRadius:999, background:"#71d07e" },
};
