// frontend/src/pages/Gastos.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import AppShell, { ui } from "../components/AppShell";
import api from "../api/api";

const MESES = ["","Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

const hoy = new Date();
const MES_ACTUAL = hoy.getMonth() + 1; // 1..12
const ANIO_ACTUAL = hoy.getFullYear();

const fmtCLP = (n) =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(Number(n || 0));

// --- Forma de pago UI interna ---
const FP = { EFECTIVO: "EFECTIVO", DEBITO: "DEBITO", CREDITO: "CREDITO" };

// Normaliza string de API vieja
function parseFPString(v){
  const s = String(v || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase();
  if (s === "CREDITO") return FP.CREDITO;
  if (s === "DEBITO")  return FP.DEBITO;
  return FP.EFECTIVO;
}

// ¿Es crédito?
function isCredito(g){
  if (typeof g?.con_tarjeta === "boolean") return g.con_tarjeta;
  return parseFPString(g?.forma_pago) === FP.CREDITO;
}

// UI helper con etiqueta
function Field({ label, children, style }) {
  return (
    <div style={{ ...styles.field, ...(style || {}) }}>
      <div style={styles.label}>{label}</div>
      {children}
    </div>
  );
}

/* ===========================
   HELPERS DE PAGOS
   =========================== */
// Deriva "metodo" para pagos_gasto
function metodoDesdeUI(fp_ui) {
  if (fp_ui === FP.CREDITO) return "credito";
  if (fp_ui === FP.DEBITO)  return "debito";
  return "efectivo";
}

// Usa el endpoint nuevo del backend: POST /gastos/:id/pagar
// payload esperado: { gasto_id, fecha, monto, metodo, tarjeta_id }
async function crearPagoGastoAPI(payload) {
  try {
    const { gasto_id, ...body } = payload; // el body NO lleva gasto_id
    await api.post(`/gastos/${gasto_id}/pagar`, body);
    return true;
  } catch (e) {
    console.error("crearPagoGastoAPI /gastos/:id/pagar falló:", e?.response?.status, e?.response?.data);
    return false;
  }
}

export default function Gastos() {
  // --- Estado de lista / filtros ---
  const [gastos, setGastos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // Mes/Año por defecto = actuales
  const [fMes, setFMes] = useState(String(MES_ACTUAL));
  const [fAnio, setFAnio] = useState(String(ANIO_ACTUAL));
  const [fPagado, setFPagado] = useState(false);

  // Totales mostrados en la tarjeta de filtros
  const totalFiltrado = useMemo(() => gastos.reduce((a, g) => a + Number(g.monto || 0), 0), [gastos]);
  const totalEfecDeb = useMemo(() =>
    gastos.filter((g) => !isCredito(g)).reduce((a, g) => a + Number(g.monto || 0), 0), [gastos]);
  const totalCredito = useMemo(() =>
    gastos.filter((g) =>  isCredito(g)).reduce((a, g) => a + Number(g.monto || 0), 0), [gastos]);

  // --- Crear gasto ---
  const [nuevo, setNuevo] = useState({
    nombre: "", monto: "",
    mes: String(MES_ACTUAL), anio: String(ANIO_ACTUAL),
    pagado: false,
    es_recurrente: false,         // DB
    fp_ui: FP.EFECTIVO,           // UI interno
    tarjeta_id: "",               // si crédito
  });
  const [savingNew, setSavingNew] = useState(false);
  
  // --- Selección y edición (panel inferior) ---
  const [sel, setSel] = useState(null);
  const [edit, setEdit] = useState({
    nombre: "", monto: "", mes: "", anio: "", pagado: false,
    es_recurrente: false,
    fp_ui: FP.EFECTIVO,
    tarjeta_id: "",
  });
  const editRef = useRef(null);

  // Tarjetas
  const [tarjetas, setTarjetas] = useState([]);

  // Mapa id -> nombre para mostrar tarjeta en la tabla
  const tarjetaNombreMap = useMemo(() => {
    const m = {};
    (tarjetas || []).forEach((t) => {
      m[String(t.id)] = t.nombre || t.banco || `Tarjeta ${t.id}`;
    });
    return m;
  }, [tarjetas]);

  function labelTarjeta(g) {
    const id = g?.tarjeta_id;
    if (!id) return "—";
    if (g.tarjeta_nombre || g.banco || g.tarjeta) {
      return g.tarjeta_nombre || g.banco || g.tarjeta;
    }
    return tarjetaNombreMap[String(id)] || `Tarjeta ${id}`;
  }

  // Carga inicial
  useEffect(() => {
    loadTarjetas();
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
      es_recurrente: Boolean(sel.es_recurrente ?? sel.recurrente),
      fp_ui: isCredito(sel) ? FP.CREDITO : FP.EFECTIVO,
      tarjeta_id: sel.tarjeta_id ? String(sel.tarjeta_id) : "",
    });
    setTimeout(() => editRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }, [sel]);

  async function loadTarjetas() {
    try {
      const { data } = await api.get("/tarjetas");
      setTarjetas(Array.isArray(data) ? data : (data?.data ?? []));
    } catch (e) { console.error(e); }
  }

  async function loadGastos() {
    try {
      setErr(""); setLoading(true);
      if (!fMes || !fAnio) { setGastos([]); return; }

      const { data } = await api.get("/gastos", { params: { mes: Number(fMes), anio: Number(fAnio) } });
      let items = Array.isArray(data) ? data : (data?.data ?? []);
      if (fPagado) items = items.filter((g) => !!g.pagado);
      setGastos(items);

      if (sel) {
        const keep = items.find((x) => x.id === sel.id);
        setSel(keep || null);
      }
    } catch (e) {
      setErr(e?.response?.data?.detail || "No pude cargar gastos");
    } finally { setLoading(false); }
  }

  // --- Crear ---
  async function crearGasto(e) {
    e?.preventDefault?.();
    if (!nuevo.nombre || !nuevo.monto) return alert("Nombre y monto son obligatorios.");
    if (nuevo.fp_ui === FP.CREDITO && !nuevo.tarjeta_id) return alert("Selecciona una tarjeta para los gastos a crédito.");

    try {
      setSavingNew(true);
      await api.post("/gastos", {
        nombre: nuevo.nombre,
        monto: Number(nuevo.monto),
        mes: nuevo.mes ? Number(nuevo.mes) : null,
        anio: nuevo.anio ? Number(nuevo.anio) : null,
        pagado: Boolean(nuevo.pagado),
        es_recurrente: Boolean(nuevo.es_recurrente),           // ← DB
        con_tarjeta: nuevo.fp_ui === FP.CREDITO,               // ← DB
        tarjeta_id: nuevo.fp_ui === FP.CREDITO ? Number(nuevo.tarjeta_id) : null, // ← DB
      });
      setNuevo({
        nombre: "", monto: "", mes: String(MES_ACTUAL), anio: String(ANIO_ACTUAL), pagado: false,
        es_recurrente: false, fp_ui: FP.EFECTIVO, tarjeta_id: "",
      });
      await loadGastos();
    } catch (e) {
      alert(e?.response?.data?.detail || "No pude guardar el gasto");
    } finally { setSavingNew(false); }
  }

  // --- Editar / eliminar / marcar pagado ---
  async function guardarEdicion() {
    if (!sel) return;
    if (edit.fp_ui === FP.CREDITO && !edit.tarjeta_id) return alert("Selecciona una tarjeta para los gastos a crédito.");
    try {
      await api.put(`/gastos/${sel.id}`, {
        nombre: edit.nombre,
        monto: Number(edit.monto || 0),
        mes: edit.mes ? Number(edit.mes) : null,
        anio: edit.anio ? Number(edit.anio) : null,
        pagado: Boolean(edit.pagado),
        es_recurrente: Boolean(edit.es_recurrente),            // ← DB
        con_tarjeta: edit.fp_ui === FP.CREDITO,                // ← DB
        tarjeta_id: edit.fp_ui === FP.CREDITO ? Number(edit.tarjeta_id) : null, // ← DB
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
      if (flag) {
        // Usa lo que está en el panel de edición para forma de pago/tarjeta
        const fp_ui_sel = edit?.fp_ui || (isCredito(sel) ? FP.CREDITO : FP.EFECTIVO);
        const metodo = metodoDesdeUI(fp_ui_sel);
        const tarjetaId =
          metodo === "credito"
            ? Number(edit?.tarjeta_id || sel?.tarjeta_id || 0) || null
            : null;

        if (metodo === "credito" && !tarjetaId) {
          alert("Selecciona una tarjeta para registrar el pago con crédito.");
          return;
        }

        const payloadPay = {
          gasto_id: sel.id,
          fecha: new Date().toISOString().slice(0,10),
          monto: Number(sel.monto || 0),
          metodo,               // "efectivo" | "debito" | "credito"
          tarjeta_id: tarjetaId // null salvo crédito
        };

        const ok = await crearPagoGastoAPI(payloadPay);
        if (!ok) {
          alert("No pude registrar el pago. Revisa que esté activo POST /gastos/:id/pagar.");
          return;
        }

        // Ya no hacemos PUT /gastos/:id porque /gastos/:id/pagar lo dejó pagado.
      } else {
        // Deshacer pagado: solo bajamos el flag (conserva datos de tarjeta si tenía)
        await api.put(`/gastos/${sel.id}`, {
          nombre: sel.nombre,
          monto: Number(sel.monto || 0),
          mes: sel.mes,
          anio: sel.anio,
          pagado: false,
          es_recurrente: Boolean(sel.es_recurrente ?? sel.recurrente),
          con_tarjeta: isCredito(sel),
          tarjeta_id: isCredito(sel) ? Number(sel.tarjeta_id) : null,
        });
      }

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
            gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr 1fr auto",
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

          <Field label="Recurrente">
            <label style={{ display: "flex", alignItems: "center", gap: 8, height: 38 }}>
              <input
                type="checkbox"
                checked={nuevo.es_recurrente}
                onChange={(e) => setNuevo({ ...nuevo, es_recurrente: e.target.checked })}
              />
              Sí
            </label>
          </Field>

          <Field label="Forma de pago">
            <select
              value={nuevo.fp_ui}
              onChange={(e) => setNuevo({ ...nuevo, fp_ui: e.target.value })}
              style={styles.input}
              title="Forma de pago"
            >
              <option value={FP.EFECTIVO}>Efectivo</option>
              <option value={FP.DEBITO}>Débito</option>
              <option value={FP.CREDITO}>Crédito</option>
            </select>
          </Field>

          <Field label="Tarjeta (si crédito)">
            <select
              value={nuevo.tarjeta_id}
              onChange={(e) => setNuevo({ ...nuevo, tarjeta_id: e.target.value })}
              style={{ ...styles.input, opacity: nuevo.fp_ui === FP.CREDITO ? 1 : 0.5 }}
              disabled={nuevo.fp_ui !== FP.CREDITO}
            >
              <option value="">Selecciona…</option>
              {tarjetas.map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {t.nombre || t.banco || `Tarjeta ${t.id}`}
                </option>
              ))}
            </select>
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

        <div style={{ display: "flex", gap: 16, opacity: 0.9, flexWrap: "wrap" }}>
          {fMes && fAnio && (
            <>
              <div>Total (vista filtrada): <b>{fmtCLP(totalFiltrado)}</b></div>
              <div>Efectivo/Débito: <b>{fmtCLP(totalEfecDeb)}</b></div>
              <div>Crédito: <b style={{ color: "#b197fc" }}>{fmtCLP(totalCredito)}</b></div>
            </>
          )}
        </div>
      </div>

      {/* Tabla */}
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
                      <th style={styles.th}>Recurrente</th>
                      <th style={styles.th}>Forma de pago</th>
                      <th style={styles.th}>Tarjeta</th>
                      <th style={styles.th}>Pagado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gastos.map((g) => {
                      const credito = isCredito(g);
                      const selected = sel?.id === g.id;
                      const esRec = Boolean(g.es_recurrente ?? g.recurrente);
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
                          <td style={styles.td}>{esRec ? "Sí" : "No"}</td>
                          <td style={styles.td}>{credito ? "Crédito" : "Efectivo/Débito"}</td>
                          <td style={styles.td}>{credito ? labelTarjeta(g) : "—"}</td>
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

      {/* Panel de edición / acciones */}
      {sel && (
        <div style={ui.card} ref={editRef}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <div style={{ fontWeight: 700 }}>✏️ Editar</div>
            <span style={{ fontSize: 12, background: "#0e1626", padding: "4px 8px", borderRadius: 6 }}>
              ID {sel.id} — {sel.nombre}
            </span>
            <button onClick={() => setSel(null)} style={{ marginLeft: "auto", textDecoration: "underline", opacity: 0.8 }}>
              Limpiar selección
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr 1fr auto auto",
              gap: 10,
              alignItems: "end",
            }}
          >
            <Field label="Nombre">
              <input value={edit.nombre} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} style={styles.input}/>
            </Field>

            <Field label="Monto">
              <input type="number" value={edit.monto} onChange={(e) => setEdit({ ...edit, monto: e.target.value })} style={styles.input}/>
            </Field>

            <Field label="Mes">
              <select value={edit.mes || ""} onChange={(e) => setEdit({ ...edit, mes: e.target.value })} style={styles.input}>
                <option value="">Mes</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>{MESES[m]}</option>
                ))}
              </select>
            </Field>

            <Field label="Año">
              <input type="number" value={edit.anio || ""} onChange={(e) => setEdit({ ...edit, anio: e.target.value })} style={styles.input}/>
            </Field>

            <Field label="Recurrente">
              <label style={{ display: "flex", alignItems: "center", gap: 8, height: 38 }}>
                <input type="checkbox" checked={edit.es_recurrente} onChange={(e) => setEdit({ ...edit, es_recurrente: e.target.checked })}/>
                Sí
              </label>
            </Field>

            <Field label="Forma de pago">
              <select value={edit.fp_ui} onChange={(e) => setEdit({ ...edit, fp_ui: e.target.value })} style={styles.input}>
                <option value={FP.EFECTIVO}>Efectivo</option>
                <option value={FP.DEBITO}>Débito</option>
                <option value={FP.CREDITO}>Crédito</option>
              </select>
            </Field>

            <Field label="Tarjeta (si crédito)">
              <select
                value={edit.tarjeta_id}
                onChange={(e) => setEdit({ ...edit, tarjeta_id: e.target.value })}
                style={{ ...styles.input, opacity: edit.fp_ui === FP.CREDITO ? 1 : 0.5 }}
                disabled={edit.fp_ui !== FP.CREDITO}
              >
                <option value="">Selecciona…</option>
                {tarjetas.map((t) => (
                  <option key={t.id} value={String(t.id)}>
                    {t.nombre || t.banco || `Tarjeta ${t.id}`}
                  </option>
                ))}
              </select>
            </Field>

            <button onClick={guardarEdicion} style={ui.btn}>Guardar cambios</button>
            <button onClick={eliminarSeleccionado} style={{ ...ui.btn, background: "#ff3b30" }}>Eliminar</button>
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
  field: { display: "flex", flexDirection: "column", gap: 6 },
  label: { fontSize: 12, opacity: 0.75, paddingLeft: 2 },
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
