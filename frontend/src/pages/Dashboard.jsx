// frontend/src/pages/Dashboard.jsx
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import AppShell, { ui } from "../components/AppShell";
import api from "../api/api";

export default function Dashboard() {
  // Totales calculados del mes actual
  const [totalMes, setTotalMes] = useState(0);
  const [pagadoMes, setPagadoMes] = useState(0);
  const [porPagarMes, setPorPagarMes] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const fmt = new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  });

  useEffect(() => {
    const cargarResumen = async () => {
      setCargando(true);
      setError("");
      try {
        const now = new Date();
        const mes = now.getMonth() + 1;
        const anio = now.getFullYear();

        // Traemos los gastos del mes actual y calculamos totales aquí
        const { data } = await api.get("/gastos", {
          params: { mes, anio },
        });

        const items = Array.isArray(data) ? data : data.items ?? [];

        const total = items.reduce(
          (acc, g) => acc + (Number(g.monto) || 0),
          0
        );
        const pagado = items
          .filter((g) => Boolean(g.pagado))
          .reduce((acc, g) => acc + (Number(g.monto) || 0), 0);

        setTotalMes(total);
        setPagadoMes(pagado);
        setPorPagarMes(total - pagado);
      } catch (err) {
        setError(err?.response?.data?.detail || "No pude cargar el resumen.");
      } finally {
        setCargando(false);
      }
    };

    cargarResumen();
  }, []);

  return (
    <AppShell title="Dashboard">
      {/* Tarjetas de resumen */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0,1fr))",
          gap: 12,
        }}
      >
        <div style={ui.card}>
          <div style={{ opacity: 0.7, fontSize: 12 }}>Total del mes</div>
          <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }}>
            {cargando ? "…" : fmt.format(totalMes)}
          </div>
          <div style={{ marginTop: 8 }}>
            <span style={ui.badge}>
              {/* Etiqueta de ejemplo; puedes quitarla o reemplazar por algún KPI real */}
              Resumen automático
            </span>
          </div>
        </div>

        <div style={ui.card}>
          <div style={{ opacity: 0.7, fontSize: 12 }}>Gastos pagados (mes)</div>
          <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }}>
            {cargando ? "…" : fmt.format(pagadoMes)}
          </div>
        </div>

        <div style={ui.card}>
          <div style={{ opacity: 0.7, fontSize: 12 }}>Por pagar (mes)</div>
          <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }}>
            {cargando ? "…" : fmt.format(porPagarMes)}
          </div>
        </div>

        <div style={ui.card}>
          <div style={{ opacity: 0.7, fontSize: 12 }}>Sueldo disponible</div>
          <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }}>
            {/* Si aún no tienes sueldo disponible desde API, puedes dejarlo fijo o en blanco */}
            {fmt.format(1250000)}
          </div>
        </div>
      </section>

      {/* Bloques grandes */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr",
          gap: 12,
          marginTop: 12,
        }}
      >
        <div style={ui.card}>
          <h3 style={{ marginTop: 0 }}>Evolución últimos 6 meses</h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(6,1fr)",
              gap: 10,
              alignItems: "end",
              height: 180,
            }}
          >
            {[40, 60, 80, 50, 100, 75].map((h, i) => (
              <div
                key={i}
                style={{
                  background: "#1f2a44",
                  height: "100%",
                  borderRadius: 6,
                  display: "flex",
                  alignItems: "flex-end",
                }}
              >
                <div
                  style={{
                    background: "#71d07e",
                    height: `${h}%`,
                    width: "100%",
                    borderRadius: "6px 6px 0 0",
                  }}
                />
              </div>
            ))}
          </div>
        </div>

        <div style={ui.card}>
          <h3 style={{ marginTop: 0 }}>Próximos vencimientos</h3>
          {/* Puedes enlazar a las secciones correspondientes si deseas */}
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            <li>
              Tarjeta Banco X — 12/Ago — <b>$201.000</b>{" "}
              <Link to="/tarjetas" style={{ marginLeft: 6 }}>
                ver
              </Link>
            </li>
            <li>
              Préstamo Auto — 15/Ago — <b>$95.000</b>{" "}
              <Link to="/prestamos" style={{ marginLeft: 6 }}>
                ver
              </Link>
            </li>
            <li>
              Internet — 20/Ago — <b>$23.990</b>{" "}
              <Link to="/gastos" style={{ marginLeft: 6 }}>
                ver
              </Link>
            </li>
          </ul>
          {error && (
            <div style={{ marginTop: 12, color: "#ff8080" }}>{error}</div>
          )}
        </div>
      </section>
    </AppShell>
  );
}

