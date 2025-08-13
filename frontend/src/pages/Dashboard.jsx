// frontend/src/pages/Dashboard.jsx
import React, { useEffect, useMemo, useState } from "react";
import AppShell, { ui } from "../components/AppShell";
import api from "../api/api";

const MESES = [
  "",
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];

const hoy = new Date();
const MES_ACTUAL = hoy.getMonth() + 1; // 1..12
const ANIO_ACTUAL = hoy.getFullYear();

const fmtCLP = (n) =>
  new Intl.NumberFormat("es-CL", {
    style: "currency", currency: "CLP", maximumFractionDigits: 0,
  }).format(Number(n || 0));

// Helpers
function lastNMonths(mes, anio, n = 6) {
  const out = [];
  let m = mes, y = anio;
  for (let i = 0; i < n; i++) {
    out.unshift({ mes: m, anio: y }); // más antiguo a la izquierda
    m--;
    if (m <= 0) { m = 12; y--; }
  }
  return out;
}

export default function Dashboard() {
  // Filtros (por defecto mes/año actuales)
  const [mes, setMes]   = useState(String(MES_ACTUAL));
  const [anio, setAnio] = useState(String(ANIO_ACTUAL));

  // Datos
  const [gastos, setGastos] = useState([]);
  const [facturas, setFacturas] = useState([]);
  const [prestamos, setPrestamos] = useState([]);
  const [sueldo, setSueldo] = useState(0);

  const [serie6m, setSerie6m] = useState([]); // [{label, total}]
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // Totales de gastos
  const totalGastos = useMemo(() =>
    gastos.reduce((a, g) => a + Number(g.monto || 0), 0), [gastos]);

  const totalGastosPagados = useMemo(() =>
    gastos.filter(g => g.pagado).reduce((a, g) => a + Number(g.monto || 0), 0), [gastos]);

  const totalGastosPend = totalGastos - totalGastosPagados;

  // Totales de facturas (tarjetas)
  const totalFacturas = useMemo(() =>
    facturas.reduce((a, f) => a + Number(f.total || 0), 0), [facturas]);

  const totalFacturasPagadas = useMemo(() =>
    facturas.filter(f => f.pagada).reduce((a, f) => a + Number(f.total || 0), 0), [facturas]);

  const totalFacturasPend = totalFacturas - totalFacturasPagadas;

  // Préstamos: cuota mensual estimada (préstamos activos)
  const cuotaPrestamosMes = useMemo(() => {
    const activos = prestamos.filter(p =>
      Number(p.cuotas_pagadas ?? 0) < Number(p.cuotas_totales ?? 0)
    );
    return activos.reduce((a, p) => a + Number(p.valor_cuota || 0), 0);
  }, [prestamos]);

  // “Sueldo disponible” simplificado
  const sueldoDisponible = Math.max(0, Number(sueldo || 0) - (totalGastosPend + totalFacturasPend + cuotaPrestamosMes));

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAll() {
    setLoading(true);
    setErr("");

    const q = { mes: Number(mes), anio: Number(anio) };

    try {
      // 1) Cargas principales (en paralelo, tolerando fallos)
      const [rg, rf, rp, rs] = await Promise.allSettled([
        api.get("/gastos", { params: q }),
        api.get("/facturas", { params: q }),
        api.get("/prestamos"),            // prestamos general
        api.get("/sueldos", { params: q })// si no existe, se ignora
      ]);

      // Gastos
      const dG = rg.status === "fulfilled" ? rg.value.data : [];
      setGastos(Array.isArray(dG) ? dG : (dG?.data ?? []));

      // Facturas
      const dF = rf.status === "fulfilled" ? rf.value.data : [];
      setFacturas(Array.isArray(dF) ? dF : (dF?.data ?? []));

      // Préstamos
      const dP = rp.status === "fulfilled" ? rp.value.data : [];
      setPrestamos(Array.isArray(dP) ? dP : (dP?.data ?? []));

      // Sueldo (opcional)
      let sueldoMes = 0;
      if (rs.status === "fulfilled") {
        const dS = rs.value.data;
        if (Array.isArray(dS)) {
          const reg = dS.find(r => Number(r.mes) === q.mes && Number(r.anio) === q.anio) || dS[0];
          sueldoMes = Number(reg?.monto || 0);
        } else if (typeof dS === "object" && dS) {
          sueldoMes = Number(dS?.monto || dS?.data?.monto || 0);
        }
      }
      setSueldo(sueldoMes);

      // 2) Serie últimos 6 meses (gastos)
      const months = lastNMonths(q.mes, q.anio, 6);
      const serie = [];
      for (const item of months) {
        try {
          const r = await api.get("/gastos", { params: { mes: item.mes, anio: item.anio } });
          const arr = Array.isArray(r.data) ? r.data : (r.data?.data ?? []);
          const tot = arr.reduce((a, g) => a + Number(g.monto || 0), 0);
          serie.push({ label: `${MESES[item.mes].slice(0,3)} ${item.anio}`, total: tot });
        } catch {
          serie.push({ label: `${MESES[item.mes].slice(0,3)} ${item.anio}`, total: 0 });
        }
      }
      setSerie6m(serie);
    } catch (e) {
      setErr(e?.response?.data?.detail || "No pude cargar el dashboard");
    } finally {
      setLoading(false);
    }
  }

  function onAplicar() { loadAll(); }
  function onLimpiar() {
    setMes(String(MES_ACTUAL));
    setAnio(String(ANIO_ACTUAL));
    setTimeout(loadAll, 0);
  }

  // Para el minigráfico
  const maxBar = Math.max(...serie6m.map(s => s.total), 1);

  return (
    <AppShell
      title="Dashboard"
      actions={<button onClick={loadAll} style={ui.btn}>Actualizar</button>}
    >
      {/* Filtros */}
      <div style={ui.card}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Vista del dashboard</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <select value={mes} onChange={e => setMes(e.target.value)} style={styles.input}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
              <option key={m} value={m}>{MESES[m]}</option>
            ))}
          </select>
          <input
            type="number"
            value={anio}
            onChange={e => setAnio(e.target.value)}
            style={styles.input}
          />
          <button onClick={onAplicar} style={styles.smallBtn}>Aplicar</button>
          <button onClick={onLimpiar} style={{ ...styles.smallBtn, background: "#8899aa" }}>Limpiar</button>
          {err && <div style={styles.error}>&nbsp;{err}</div>}
        </div>
      </div>

      {/* Métricas */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <div style={ui.card}>
          <div style={styles.kpiTitle}>Total del mes</div>
          <div style={styles.kpiValue}>{fmtCLP(totalGastos)}</div>
          <div style={styles.kpiSub}>Gastos (todos)</div>
        </div>

        <div style={ui.card}>
          <div style={styles.kpiTitle}>Gastos pagados (mes)</div>
          <div style={styles.kpiValue}>{fmtCLP(totalGastosPagados)}</div>
          <div style={styles.kpiSub}>Marcados como pagados</div>
        </div>

        <div style={ui.card}>
          <div style={styles.kpiTitle}>Por pagar (mes)</div>
          <div style={styles.kpiValue}>{fmtCLP(totalGastosPend)}</div>
          <div style={styles.kpiSub}>Gastos no pagados</div>
        </div>

        <div style={ui.card}>
          <div style={styles.kpiTitle}>Sueldo disponible</div>
          <div style={styles.kpiValue}>{fmtCLP(sueldoDisponible)}</div>
          <div style={styles.kpiSub}>
            Sueldo − (pend. gastos + facturas + cuotas préstamos)
          </div>
        </div>
      </div>

      {/* Tarjetas / Préstamos */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginTop: 16 }}>
        <div style={ui.card}>
          <div style={styles.kpiTitle}>Facturado tarjetas (mes)</div>
          <div style={styles.kpiValue}>{fmtCLP(totalFacturas)}</div>
          <div style={styles.kpiSub}>
            Pagado: {fmtCLP(totalFacturasPagadas)} &nbsp;·&nbsp; Pendiente: {fmtCLP(totalFacturasPend)}
          </div>
        </div>

        <div style={ui.card}>
          <div style={styles.kpiTitle}>Cuota préstamos (estimada mes)</div>
          <div style={styles.kpiValue}>{fmtCLP(cuotaPrestamosMes)}</div>
          <div style={styles.kpiSub}>Suma de valor_cuota de préstamos activos</div>
        </div>

        <div style={ui.card}>
          <div style={styles.kpiTitle}>Sueldo del mes</div>
          <div style={styles.kpiValue}>{fmtCLP(sueldo)}</div>
          <div style={styles.kpiSub}>Desde “Ingresar sueldo”</div>
        </div>
      </div>

      {/* Evolución últimos 6 meses */}
      <div style={{ ...ui.card, marginTop: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Evolución últimos 6 meses (Gastos)</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 160 }}>
          {serie6m.map((pt, i) => (
            <div key={i} style={{ textAlign: "center", flex: 1 }}>
              <div
                title={fmtCLP(pt.total)}
                style={{
                  height: `${(pt.total / maxBar) * 120}px`,
                  background: "#47d16a",
                  borderRadius: 8,
                  transition: "height .2s ease",
                }}
              />
              <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>{pt.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Lista rápida — facturas pendientes */}
      <div style={{ ...ui.card, marginTop: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Pendientes de tarjetas (mes)</div>
        {facturas.filter(f => !f.pagada).length === 0 ? (
          <div style={{ opacity: 0.7 }}>No hay facturas pendientes.</div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {facturas.filter(f => !f.pagada).map((f) => (
              <li key={f.id} style={{ marginBottom: 4 }}>
                {(f.tarjeta_nombre || f.tarjeta || `Tarjeta ${f.tarjeta_id ?? ""}`)} — <b>{fmtCLP(f.total)}</b>
              </li>
            ))}
          </ul>
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
    padding: "6px 10px",
    borderRadius: 8,
    marginLeft: 8,
  },
  kpiTitle: { fontSize: 14, opacity: 0.8, marginBottom: 8 },
  kpiValue: { fontWeight: 800, fontSize: 22, lineHeight: 1 },
  kpiSub:   { fontSize: 12, opacity: 0.75, marginTop: 4 },
};

