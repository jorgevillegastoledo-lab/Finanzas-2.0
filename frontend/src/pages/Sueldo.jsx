// frontend/src/pages/Sueldo.jsx
import React, { useEffect, useMemo, useState } from "react";
import AppShell, { ui } from "../components/AppShell";
import { useToast } from "../ui/notifications";

const MESES = [
  "", "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];

const hoy = new Date();
const MES_ACTUAL = hoy.getMonth() + 1; // 1..12
const ANIO_ACTUAL = hoy.getFullYear();

const fmtCLP = (n) =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 })
    .format(Number(n || 0));

/** Storage helpers (v1) **/
const LS_KEY = "sueldos_v1"; // { "2025-08": 1000000, ... }

function loadMap() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return (obj && typeof obj === "object") ? obj : {};
  } catch {
    return {};
  }
}
function saveMap(map) {
  localStorage.setItem(LS_KEY, JSON.stringify(map || {}));
}
function keyFrom(m, y) {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
}

export default function Sueldo() {
  const { success, error, warning } = useToast();

  const [mes, setMes] = useState(String(MES_ACTUAL));
  const [anio, setAnio] = useState(String(ANIO_ACTUAL));
  const [monto, setMonto] = useState("");

  // sueldo ya guardado para el mes/año seleccionado
  const actual = useMemo(() => {
    const map = loadMap();
    return Number(map[keyFrom(mes, anio)] || 0);
  }, [mes, anio]);

  useEffect(() => {
    // al entrar, si hay sueldo guardado, lo mostramos en el placeholder/ayuda
  }, []);

  const onGuardar = (e) => {
    e?.preventDefault?.();
    if (monto === "" || isNaN(Number(monto))) {
      warning("Ingresa un monto válido.");
      return;
    }
    try {
      const map = loadMap();
      map[keyFrom(mes, anio)] = Number(monto);
      saveMap(map);
      success("Sueldo guardado localmente.");
    } catch (e) {
      console.error(e);
      error("No pude guardar el sueldo.");
    }
  };

  const onBorrar = () => {
    try {
      const map = loadMap();
      const k = keyFrom(mes, anio);
      if (map[k] == null) {
        warning("No hay sueldo guardado para este mes.");
        return;
      }
      delete map[k];
      saveMap(map);
      success("Sueldo borrado para este mes.");
    } catch (e) {
      console.error(e);
      error("No pude borrar el sueldo.");
    }
  };

  return (
    <AppShell title="Ingresar sueldo">
      <section style={ui.card}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>💼 Sueldo mensual (solo para cálculos locales)</div>

        <form
          onSubmit={onGuardar}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 2fr auto auto",
            gap: 10,
            alignItems: "end",
          }}
        >
          {/* Mes */}
          <div>
            <div style={styles.label}>Mes</div>
            <select value={mes} onChange={(e) => setMes(e.target.value)} style={styles.input}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>{MESES[m]}</option>
              ))}
            </select>
          </div>

          {/* Año */}
          <div>
            <div style={styles.label}>Año</div>
            <input
              type="number"
              value={anio}
              onChange={(e) => setAnio(e.target.value)}
              style={styles.input}
            />
          </div>

          {/* Monto */}
          <div>
            <div style={styles.label}>Monto</div>
            <input
              type="number"
              placeholder="Ej: 1200000"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              style={styles.input}
            />
            <div style={{ fontSize: 12, marginTop: 4, opacity: 0.8 }}>
              {actual ? `Actual guardado: ${fmtCLP(actual)}` : "Sin monto definido para este mes"}
            </div>
          </div>

          <button type="submit" style={ui.btn}>Guardar</button>
          <button type="button" onClick={onBorrar} style={{ ...ui.btn, background: "#6c757d" }}>
            Borrar
          </button>
        </form>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>
          Tip: este dato <b>NO</b> se guarda en la base de datos; vive solo en este navegador (localStorage).
        </div>
      </section>
    </AppShell>
  );
}

const styles = {
  label: { fontSize: 12, opacity: 0.85, paddingLeft: 2, marginBottom: 4 },
  input: {
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #23304a",
    background: "#0e1626",
    color: "#e6f0ff",
    width: "100%",
    boxSizing: "border-box",
  },
};



