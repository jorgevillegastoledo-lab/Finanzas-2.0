// frontend/src/pages/Dashboard.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell, { ui } from "../components/AppShell";
import api from "../api/api";

const MESES = [
  "", "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];

const ROUTE_GASTOS = "/gastos";
const ROUTE_PRESTAMOS = "/prestamos";
const ROUTE_FACTURACION = "/facturacion";
const ROUTE_SUELDO = "/sueldo";

const hoy = new Date();
const MES_ACTUAL = hoy.getMonth() + 1;
const ANIO_ACTUAL = hoy.getFullYear();

const fmtCLP = (n) =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 })
    .format(Number(n || 0));

/* Helpers */
const ymIndex = (m, y) => (y * 12 + m - 1);
const activoEnMes = (p, mes, anio) => {
  const m0 = Number(p?.primer_mes || 0);
  const y0 = Number(p?.primer_anio || 0);
  const nCuotas = Number(p?.cuotas_totales || 0);
  if (!m0 || !y0 || !nCuotas) return false;
  const start = ymIndex(m0, y0);
  const now = ymIndex(Number(mes), Number(anio));
  const diff = now - start;
  return diff >= 0 && diff < nCuotas;
};
const esCreditoGasto = (g) => {
  if (typeof g?.con_tarjeta === "boolean") return g.con_tarjeta;
  const s = String(g?.forma_pago || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase();
  return s === "CREDITO";
};
function addMonths(y, m, add) {
  const total = (y * 12 + (m - 1)) + add;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return { anio: ny, mes: nm };
}

export default function Dashboard() {
  const navigate = useNavigate();

  // filtros
  const [mes, setMes] = useState(String(MES_ACTUAL));
  const [anio, setAnio] = useState(String(ANIO_ACTUAL));

  // datos crudos
  const [gastos, setGastos] = useState([]);
  const [facturas, setFacturas] = useState([]);
  const [prestamos, setPrestamos] = useState([]);
  const [resumenPrestamos, setResumenPrestamos] = useState([]); // para ¨²ltimos pagos

  // kpis
  const [sueldo, setSueldo] = useState(0);

  // desglose ED / CR¨¦DITO
  const [edPagado, setEdPagado] = useState(0);
  const [edPendiente, setEdPendiente] = useState(0);
  const [creditoMes, setCreditoMes] = useState(0);

  // facturaci¨®n tarjetas
  const [factPagado, setFactPagado] = useState(0);
  const [factPendiente, setFactPendiente] = useState(0);

  // pr¨¦stamos
  const [cuotasEsperadas, setCuotasEsperadas] = useState(0);
  const [cuotasPagadasMes, setCuotasPagadasMes] = useState(0);
  const [totalDeudaPrestamos, setTotalDeudaPrestamos] = useState(0);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => { loadAll(); /* eslint-disable-next-line */ }, []);

  async function loadAll() {
    setLoading(true);
    setErr("");
    const q = { mes: Number(mes), anio: Number(anio) };

    try {
      const [rg, rf, rp, rr, rs] = await Promise.allSettled([
        api.get("/gastos", { params: q }),
        api.get("/facturas", { params: q }),
        api.get("/prestamos"),
        api.get("/prestamos/resumen"),
        api.get("/sueldos", { params: q }), // opcional
      ]);

      // gastos
      const g = rg.status === "fulfilled" ? (Array.isArray(rg.value.data) ? rg.value.data : (rg.value.data?.data ?? [])) : [];
      setGastos(g);

      // facturas del mes
      const f = rf.status === "fulfilled" ? (Array.isArray(rf.value.data) ? rf.value.data : (rf.value.data?.data ?? [])) : [];
      setFacturas(f);

      // pr¨¦stamos (todos)
      const p = rp.status === "fulfilled" ? (Array.isArray(rp.value.data) ? rp.value.data : (rp.value.data?.data ?? [])) : [];
      setPrestamos(p);

      // resumen pr¨¦stamos (deuda + ¨²ltimo pago)
      let resumen = [];
      if (rr.status === "fulfilled") {
        resumen = Array.isArray(rr.value.data) ? rr.value.data : (rr.value.data?.data ?? []);
      }
      setResumenPrestamos(resumen);

      // deuda total (preferir resumen)
      let deudaTotal = 0;
      if (resumen.length > 0) {
        deudaTotal = resumen.reduce((acc, it) => acc + Number(it.deuda_restante || 0), 0);
      } else {
        deudaTotal = p.reduce((acc, it) => {
          const vc = Number(it.valor_cuota || 0);
          const tot = Number(it.cuotas_totales || 0);
          const pag = Number(it.cuotas_pagadas || 0);
          const rest = Math.max(tot - pag, 0);
          return acc + vc * rest;
        }, 0);
      }
      setTotalDeudaPrestamos(deudaTotal);

      // sueldo (si hay API; si no, queda 0)
      let montoSueldo = 0;
      if (rs.status === "fulfilled") {
        const dS = rs.value.data;
        if (Array.isArray(dS)) {
          const reg = dS.find(r => Number(r.mes) === q.mes && Number(r.anio) === q.anio) || dS[0];
          montoSueldo = Number(reg?.monto || 0);
        } else if (typeof dS === "object" && dS) {
          montoSueldo = Number(dS?.monto || dS?.data?.monto || 0);
        }
      }
      setSueldo(montoSueldo);

      // desglose gastos (E/D vs cr¨¦dito)
      let _edPagado = 0, _edPend = 0, _credito = 0;
      for (const x of g) {
        const m = Number(x.monto || 0);
        const credit = esCreditoGasto(x);
        if (credit) _credito += m;
        else (x.pagado ? _edPagado += m : _edPend += m);
      }
      setEdPagado(_edPagado);
      setEdPendiente(_edPend);
      setCreditoMes(_credito);

      // facturaci¨®n tarjetas: pagada / pendiente
      const sumFact = (arr) => arr.reduce((acc, it) => acc + Number(it.total ?? it.monto ?? it.total_facturado ?? 0), 0);
      setFactPagado(sumFact(f.filter(x => !!x.pagada)));
      setFactPendiente(sumFact(f.filter(x => !x.pagada)));

      // pr¨¦stamos: cuotas esperadas del mes y pagos del mes
      const esperadas = p
        .filter(pr => activoEnMes(pr, q.mes, q.anio))
        .reduce((acc, pr) => acc + Number(pr.valor_cuota || 0), 0);
      setCuotasEsperadas(esperadas);

      let pagadasMes = 0;
      try {
        const rGlobal = await api.get("/pagos-prestamo", { params: { mes_contable: q.mes, anio_contable: q.anio } });
        const arr = Array.isArray(rGlobal.data) ? rGlobal.data : (rGlobal.data?.data ?? []);
        pagadasMes = arr.reduce((acc, it) => acc + Number(it.monto ?? it.valor_cuota ?? 0), 0);
      } catch {
        const reqs = await Promise.allSettled(
          p.map(pr => api.get(`/prestamos/${pr.id}/pagos`, { params: { mes: q.mes, anio: q.anio } }))
        );
        pagadasMes = reqs.reduce((sum, r) => {
          if (r.status === "fulfilled") {
            const arr = Array.isArray(r.value.data) ? r.value.data : (r.value.data?.data ?? []);
            return sum + arr.reduce((a, it) => a + Number(it.monto ?? it.valor_cuota ?? 0), 0);
          }
          return sum;
        }, 0);
      }
      setCuotasPagadasMes(pagadasMes);

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

  // totales
  const totalED = useMemo(() => edPagado + edPendiente, [edPagado, edPendiente]);
  const totalFacturacion = useMemo(() => factPagado + factPendiente, [factPagado, factPendiente]);
  const totalMensualSinCredito = useMemo(
    () => totalED + cuotasEsperadas + totalFacturacion,
    [totalED, cuotasEsperadas, totalFacturacion]
  );

  // ¨²ltimos pagos pr¨¦stamos (ordenar por m¨¢s reciente)
  const ultimosPagos = useMemo(() => {
    const src = resumenPrestamos?.map(r => {
      let um = Number(r.ultimo_mes || 0);
      let ua = Number(r.ultimo_anio || 0);

      // fallback si no viene en el resumen pero tiene cuotas_pagadas y fecha inicial
      if ((!um || !ua) && (r.cuotas_pagadas > 0) && r.primer_mes && r.primer_anio) {
        const { anio, mes } = addMonths(Number(r.primer_anio), Number(r.primer_mes), Number(r.cuotas_pagadas) - 1);
        um = mes; ua = anio;
      }
      return {
        id: r.id, nombre: r.nombre || `Pr¨¦stamo ${r.id}`,
        ultimo_mes: um || null, ultimo_anio: ua || null
      };
    }) || [];

    return src
      .sort((a, b) => (ymIndex(b.ultimo_mes || 0, b.ultimo_anio || 0) - ymIndex(a.ultimo_mes || 0, a.ultimo_anio || 0)))
      .slice(0, 6); // muestra hasta 6 en el dashboard
  }, [resumenPrestamos]);

  const clickable = (onClick) => ({
    ...ui.card,
    cursor: "pointer",
    transition: "transform .08s ease",
    border: "1px solid #23304a",
  });

  return (
    <AppShell title="Dashboard" actions={<button onClick={loadAll} style={ui.btn}>Actualizar</button>}>
      {/* filtros */}
      <div style={ui.card}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Vista del dashboard</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <select value={mes} onChange={e => setMes(e.target.value)} style={styles.input}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{MESES[m]}</option>)}
          </select>
          <input type="number" value={anio} onChange={e => setAnio(e.target.value)} style={styles.input} />
          <button onClick={onAplicar} style={styles.smallBtn}>Aplicar</button>
          <button onClick={onLimpiar} style={{ ...styles.smallBtn, background: "#8899aa" }}>Limpiar</button>
          {err && <div style={styles.error}>&nbsp;{err}</div>}
        </div>
      </div>

      {/* fila 1 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        <div style={clickable()} onClick={() => navigate(ROUTE_GASTOS)}>
          <div style={styles.kpiTitle}>Gastos Efectivo/D¨¦bito (mes)</div>
          <div style={styles.kpiValue}>{fmtCLP(totalED)}</div>
          <div style={styles.kpiSub}>Pagado: {fmtCLP(edPagado)} ¡¤ Pendiente: {fmtCLP(edPendiente)}</div>
        </div>

        <div style={clickable()} onClick={() => navigate(ROUTE_GASTOS)}>
          <div style={styles.kpiTitle}>Gastos a CR¨¦DITO (mes)</div>
          <div style={{ ...styles.kpiValue, color: "#7c3aed" }}>{fmtCLP(creditoMes)}</div>
          <div style={styles.kpiSub}>No se suman a los totales; indicador de control</div>
        </div>

        <div style={clickable()} onClick={() => navigate(ROUTE_FACTURACION)}>
          <div style={styles.kpiTitle}>Facturaci¨®n tarjetas (mes)</div>
          <div style={styles.kpiValue}>{fmtCLP(totalFacturacion)}</div>
          <div style={styles.kpiSub}>Pagada: {fmtCLP(factPagado)} ¡¤ Pendiente: {fmtCLP(factPendiente)}</div>
        </div>
      </div>

      {/* fila 2 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginTop: 16 }}>
        <div style={clickable()} onClick={() => navigate(ROUTE_PRESTAMOS)}>
          <div style={styles.kpiTitle}>Cuotas pr¨¦stamos (vigentes mes)</div>
          <div style={styles.kpiValue}>{fmtCLP(cuotasEsperadas)}</div>
          <div style={styles.kpiSub}>
            Pagado: {fmtCLP(cuotasPagadasMes)} ¡¤ Pendiente: {fmtCLP(Math.max(cuotasEsperadas - cuotasPagadasMes, 0))}
          </div>
        </div>

        <div style={clickable()} onClick={() => navigate(ROUTE_SUELDO)}>
          <div style={styles.kpiTitle}>Sueldo del mes</div>
          <div style={styles.kpiValue}>{fmtCLP(sueldo)}</div>
          <div style={styles.kpiSub}>Guardado localmente (no en BD) ¡¤ Editar sueldo</div>
        </div>

        <div style={ui.card}>
          <div style={styles.kpiTitle}>Total mensual (sin compras a CR¨¦DITO)</div>
          <div style={{ ...styles.kpiValue, color: "#d90429" }}>{fmtCLP(totalMensualSinCredito)}</div>
          <div style={styles.kpiSub}>E/D + Cuotas esperadas + Facturaci¨®n</div>
        </div>
      </div>

      {/* ¨²ltimos pagos de pr¨¦stamos */}
      <div style={{ ...ui.card, marginTop: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>¨²ltimos pagos de pr¨¦stamos</div>
        {ultimosPagos.length === 0 ? (
          <div style={{ opacity: 0.8 }}>No hay pagos registrados.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, maxHeight: 180, overflowY: "auto" }}>
            {ultimosPagos.map((r) => (
              <div key={r.id} style={{ padding: "8px 10px", border: "1px solid #23304a", borderRadius: 8, background: "#0e1626" }}>
                <div style={{ fontWeight: 600 }}>{r.nombre}</div>
                <div style={{ fontSize: 13, opacity: 0.9 }}>
                  ¨²ltimo pago: {r.ultimo_mes && r.ultimo_anio ? `${MESES[r.ultimo_mes]} ${r.ultimo_anio}` : "¡ª"}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* info adicional */}
      <div style={{ ...ui.card, marginTop: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Informaci¨®n</div>
        <div style={{ opacity: 0.9 }}>
          Total de <b>deuda vigente en pr¨¦stamos</b>: {fmtCLP(totalDeudaPrestamos)}
        </div>
      </div>
    </AppShell>
  );
}

const styles = {
  input: { padding: "8px 10px", borderRadius: 8, border: "1px solid #23304a", background: "#0e1626", color: "#e6f0ff" },
  smallBtn: { padding: "6px 10px", border: 0, borderRadius: 8, background: "#ffd166", color: "#162", fontWeight: 700, cursor: "pointer" },
  error: { background: "#ff3b30", color: "#fff", padding: "6px 10px", borderRadius: 8, marginLeft: 8 },
  kpiTitle: { fontSize: 14, opacity: 0.8, marginBottom: 8 },
  kpiValue: { fontWeight: 800, fontSize: 22, lineHeight: 1 },
  kpiSub: { fontSize: 12, opacity: 0.75, marginTop: 4 },
};
