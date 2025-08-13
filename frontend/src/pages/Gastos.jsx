// frontend/src/pages/Gastos.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
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
  new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(Number(n || 0));

// Pequeño helper: Etiqueta + control
function Field({ label, children, style }) {
  return (
    <div style={{ ...styles.field, ...(style || {}) }}>
      <div style={styles.label}>{label}</div>
      {children}
    </div>
  );
}

export default function Gastos() {
  // --- Estado de lista / filtros ---
  const [gastos, setGastos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // Mes/Año por defecto = actuales
  const [fMes, setFMes] = useState(String(MES_ACTUAL));   // como string, luego convertimos
  const [fAnio, setFAnio] = useState(String(ANIO_ACTUAL));
  const [fPagado, setFPagado] = useState(false);

  // Totales mostrados en la tarjeta de filtros
  const totalFiltrado = useMemo(
    () => gastos.reduce((a, g) => a + Number(g.monto || 0), 0),
    [gastos]
  );

  // --- Crear gasto ---
  const [nuevo, setNuevo] = useState({
    nombre: "",
    monto: "",
    mes: String(MES_ACTUAL),
    anio: String(ANIO_ACTUAL),
    pagado: false,
  });
  const [savingNew, setSavingNew] = useState(false);

  // --- Selección y edición (panel inferior) ---
  const [sel, setSel] = useState(null); // gasto seleccionado (objeto)
  const [edit, setEdit] = useState({ nombre: "", monto: "", mes: "", anio: "", pagado: false });
  const editRef = useRef(null);

  // Carga inicial automática con el mes/año actuales
  useEffect(() => {
    loadGastos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!sel) return;
    setEdit({
      nombre: sel.nombre ?? "",
      monto: String(sel.monto ?? ""),
      mes: String(sel.mes ?? ""),
      anio: String(sel.anio ?? ""),
      pagado: Boolean(sel.pagado),
    });
    // scroll suave al panel
    setTimeout(() => editRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }, [sel]);

  async function loadGastos() {
    try {
      setErr("");
      setLoading(true);

      // Requerimos MES y AÑO a la vez
      if (!fMes || !fAnio) {
        setGastos([]);
        return;
      }

      const { data } = await api.get("/gastos", {
        params: { mes: Number(fMes), anio: Number(fAnio) },
      });

      let items = Array.isArray(data) ? data : (data?.data ?? []);
      if (fPagado) items = items.filter((g) => !!g.pagado);

      setGastos(items);

      // Mantener selección si coincide
      if (sel) {
        const keep = items.find((x) => x.id === sel.id);
        setSel(keep || null);
      }
    } catch (e) {
      setErr(e?.response?.data?.detail || "No pude cargar gastos");
    } finally {
      setLoading(false);
    }
  }

  // --- Crear ---
  async function crearGasto(e) {
    e?.preventDefault?.();
    if (!nuevo.nombre || !nuevo.monto) {
      alert("Nombre y monto son obligatorios.");
      return;
    }
    try {
      setSavingNew(true);
      await api.post("/gastos", {
        nombre: nuevo.nombre,
        monto: Number(nuevo.monto),
        mes: nuevo.mes ? Number(nuevo.mes) : null,
        anio: nuevo.anio ? Number(nuevo.anio) : null,
        pagado: Boolean(nuevo.pagado),
      });
      setNuevo({ nombre: "", monto: "", mes: String(MES_ACTUAL), anio: String(ANIO_ACTUAL), pagado: false });
      await loadGastos();
    } catch (e) {
      alert(e?.response?.data?.detail || "No pude guardar el gasto");
    } finally {
      setSavingNew(false);
    }
  }

  // --- Editar / eliminar / marcar pagado ---
  async function guardarEdicion() {
    if (!sel) return;
    try {
      await api.put(`/gastos/${sel.id}`, {
        nombre: edit.nombre,
        monto: Number(edit.monto || 0),
        mes: edit.mes ? Number(edit.mes) : null,
        anio: edit.anio ? Number(edit.anio) : null,
        pagado: Boolean(edit.pagado),
      });
      await loadGastos();
    } catch (e) {
      alert(e?.response?.data?.detail || "No pude guardar cambios");
    }
  }

  async function eliminarSeleccionado() {
    if (!sel) return;
    if (!confirm("¿Eliminar gasto?")) return;
    try {
      await api.delete(`/gastos/${sel.id}`);
      setSel(null);
      await loadGastos();
    } catch (e) {
      alert(e?.response?.data?.detail || "No pude eliminar");
    }
  }

  async function marcarPagado(flag) {
    if (!sel) return;
    try {
      await api.put(`/gastos/${sel.id}`, {
        nombre: sel.nombre,
        monto: Number(sel.monto || 0),
        mes: sel.mes,
        anio: sel.anio,
        pagado: Boolean(flag),
      });
      await loadGastos();
    } catch (e) {
      alert(e?.response?.data?.detail || "No pude actualizar el estado de pago");
    }
  }

  // Helper: restablecer filtros a mes/año actuales
  function resetFiltros() {
    setFMes(String(MES_ACTUAL));
    setFAnio(String(ANIO_ACTUAL));
    setFPagado(false);
    setErr("");
    setTimeout(loadGastos, 0);
  }

  return (
    <AppShell title="Gastos" actions={<button onClick={loadGastos} style={ui.btn}>Actualizar</button>}>

      {/* Agregar gasto */}
      <div style={ui.card}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>➕ Agregar gasto</div>

        <form
          onSubmit={crearGasto}
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr auto",
            gap: 10,
            alignItems: "end",
          }}
        >
          <Field label="Nombre">
            <input
              value={nuevo.nombre}
              onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
              style={styles.input}
              placeholder="Ej: Internet"
            />
          </Field>

          <Field label="Monto">
            <input
              type="number"
              value={nuevo.monto}
              onChange={(e) => setNuevo({ ...nuevo, monto: e.target.value })}
              style={styles.input}
            />
          </Field>

          <Field label="Mes">
            <select
              value={nuevo.mes}
              onChange={(e) => setNuevo({ ...nuevo, mes: e.target.value })}
              style={styles.input}
            >
              <option value="">Mes</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>{MESES[m]}</option>
              ))}
            </select>
          </Field>

          <Field label="Año">
            <input
              type="number"
              value={nuevo.anio}
              onChange={(e) => setNuevo({ ...nuevo, anio: e.target.value })}
              style={styles.input}
            />
          </Field>

          <Field label="Pagado">
            <label style={{ display: "flex", alignItems: "center", gap: 8, height: 38 }}>
              <input
                type="checkbox"
                checked={nuevo.pagado}
                onChange={(e) => setNuevo({ ...nuevo, pagado: e.target.checked })}
              />
              Sí
            </label>
          </Field>

          <button type="submit" disabled={savingNew} style={ui.btn}>
            {savingNew ? "Guardando..." : "Guardar"}
          </button>
        </form>
      </div>

      {/* Filtros + totales */}
      <div style={ui.card}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Filtros</div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr auto auto",
            gap: 10,
            alignItems: "end",
            marginBottom: 12,
            maxWidth: 680,
          }}
        >
          <Field label="Mes">
            <select value={fMes} onChange={(e) => setFMes(e.target.value)} style={styles.input}>
              <option value="">Mes</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>{MESES[m]}</option>
              ))}
            </select>
          </Field>

          <Field label="Año">
            <input
              type="number"
              value={fAnio}
              onChange={(e) => setFAnio(e.target.value)}
              style={styles.input}
              placeholder="Ej: 2025"
            />
          </Field>

          <div style={{ display: "flex", alignItems: "end" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <input type="checkbox" checked={fPagado} onChange={(e) => setFPagado(e.target.checked)} />
              Pagado
            </label>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={loadGastos} style={styles.smallBtn}>Aplicar</button>
            <button onClick={resetFiltros} style={{ ...styles.smallBtn, background: "#8899aa" }}>Limpiar</button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 16, opacity: 0.9 }}>
          {fMes && fAnio && (
            <div>
              Total (vista filtrada): <b>{fmtCLP(totalFiltrado)}</b>
            </div>
          )}
        </div>
      </div>

      {/* Tabla (selección por fila) */}
      <div style={ui.card}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>🧾 Lista de gastos</div>

        {loading ? (
          <div>Cargando gastos…</div>
        ) : err ? (
          <div style={styles.error}>{err}</div>
        ) : gastos.length === 0 ? (
          <div style={{ opacity: 0.8 }}>
            {(!fMes || !fAnio) ? "Selecciona Mes y Año y presiona Aplicar." : "No hay gastos."}
          </div>
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <div style={{ maxHeight: "50vh", overflowY: "auto", border: "1px solid #1f2a44", borderRadius: 12 }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ position: "sticky", top: 0, background: "#0e1626", zIndex: 1 }}>
                      <th style={styles.th}>ID</th>
                      <th style={styles.th}>Nombre</th>
                      <th style={styles.th}>Monto</th>
                      <th style={styles.th}>Mes</th>
                      <th style={styles.th}>Año</th>
                      <th style={styles.th}>Pagado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gastos.map((g) => {
                      const selected = sel?.id === g.id;
                      return (
                        <tr
                          key={g.id}
                          onClick={() => setSel(g)}
                          style={{ ...styles.tr, background: selected ? "#1a253a" : "transparent" }}
                        >
                          <td style={styles.td}>{g.id}</td>
                          <td style={styles.td}>{g.nombre}</td>
                          <td style={styles.td}>{fmtCLP(g.monto)}</td>
                          <td style={styles.td}>{g.mes ? MESES[g.mes] : "—"}</td>
                          <td style={styles.td}>{g.anio ?? "—"}</td>
                          <td style={styles.td}>{g.pagado ? "Sí" : "No"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {!sel && (
              <div style={{ marginTop: 10, opacity: 0.7, fontSize: 13 }}>
                Tip: haz clic en una fila para editar, eliminar o marcar/deshacer pago.
              </div>
            )}
          </>
        )}
      </div>

      {/* Panel de edición / acciones — SOLO si hay selección */}
      {sel && (
        <div style={ui.card} ref={editRef}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <div style={{ fontWeight: 700 }}>✏️ Editar</div>
            <span style={{ fontSize: 12, background: "#0e1626", padding: "4px 8px", borderRadius: 6 }}>
              ID {sel.id} — {sel.nombre}
            </span>
            <button
              onClick={() => setSel(null)}
              style={{ marginLeft: "auto", textDecoration: "underline", opacity: 0.8 }}
            >
              Limpiar selección
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr auto auto",
              gap: 10,
              alignItems: "end",
            }}
          >
            <Field label="Nombre">
              <input
                value={edit.nombre}
                onChange={(e) => setEdit({ ...edit, nombre: e.target.value })}
                style={styles.input}
              />
            </Field>

            <Field label="Monto">
              <input
                type="number"
                value={edit.monto}
                onChange={(e) => setEdit({ ...edit, monto: e.target.value })}
                style={styles.input}
              />
            </Field>

            <Field label="Mes">
              <select
                value={edit.mes || ""}
                onChange={(e) => setEdit({ ...edit, mes: e.target.value })}
                style={styles.input}
              >
                <option value="">Mes</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>{MESES[m]}</option>
                ))}
              </select>
            </Field>

            <Field label="Año">
              <input
                type="number"
                value={edit.anio || ""}
                onChange={(e) => setEdit({ ...edit, anio: e.target.value })}
                style={styles.input}
              />
            </Field>

            <Field label="Pagado">
              <label style={{ display: "flex", alignItems: "center", gap: 8, height: 38 }}>
                <input
                  type="checkbox"
                  checked={edit.pagado}
                  onChange={(e) => setEdit({ ...edit, pagado: e.target.checked })}
                />
                Sí
              </label>
            </Field>

            <button onClick={guardarEdicion} style={ui.btn}>Guardar cambios</button>
            <button onClick={eliminarSeleccionado} style={{ ...ui.btn, background: "#ff3b30" }}>
              Eliminar
            </button>
          </div>

          <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
            <button
              onClick={() => marcarPagado(true)}
              disabled={sel?.pagado}
              style={{ ...ui.btn, background: "#1e90ff", opacity: sel?.pagado ? 0.6 : 1 }}
              title={sel?.pagado ? "Ya está pagado" : ""}
            >
              {sel?.pagado ? "Ya pagado" : "Marcar pagado"}
            </button>
            <button
              onClick={() => marcarPagado(false)}
              disabled={!sel?.pagado}
              style={{ ...ui.btn, background: "#6c757d", opacity: !sel?.pagado ? 0.6 : 1 }}
            >
              Deshacer pagado
            </button>
          </div>
        </div>
      )}
    </AppShell>
  );
}

const styles = {
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  label: {
    fontSize: 12,
    opacity: 0.75,
    paddingLeft: 2,
  },
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
  td: {
    padding: "8px",
    borderBottom: "1px solid #1f2a44",
    whiteSpace: "nowrap",
  },
  tr: { cursor: "pointer" },
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
    padding: "8px 10px",
    borderRadius: 8,
  },
};
