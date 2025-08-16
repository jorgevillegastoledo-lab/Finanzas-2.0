// frontend/src/pages/FacturacionTarjetas.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import AppShell, { ui } from "../components/AppShell";
import api from "../api/api";
import { useToast, useConfirm } from "../ui/notifications";

const MESES = [
  "", "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];

const hoy = new Date();
const MES_ACTUAL = hoy.getMonth() + 1;
const ANIO_ACTUAL = hoy.getFullYear();

const fmtCLP = (n) =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(Number(n || 0));

const fmtError = (e) => e?.response?.data?.detail || e?.message || String(e);

// Etiqueta arriba del campo
const L = ({ label, children }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    <span style={{ fontSize: 12, color: "#9db7d3", opacity: 0.9, padding: "0 2px" }}>{label}</span>
    {children}
  </div>
);

export default function FacturacionTarjetas() {
  const { success, error, warning } = useToast();
  const confirm = useConfirm();

  const [tarjetas, setTarjetas] = useState([]);
  const [facturas, setFacturas] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // Filtros
  const [fTarjeta, setFTarjeta] = useState("");
  const [fMes, setFMes] = useState(String(MES_ACTUAL));
  const [fAnio, setFAnio] = useState(String(ANIO_ACTUAL));

  // Form nuevo
  const [nuevo, setNuevo] = useState({
    tarjeta_id: "",
    mes: String(MES_ACTUAL),
    anio: String(ANIO_ACTUAL),
    total: "",
  });
  const [savingNew, setSavingNew] = useState(false);

  // Edición
  const [sel, setSel] = useState(null);
  const [edit, setEdit] = useState({ tarjeta_id: "", mes: "", anio: "", total: "", pagada: false, fecha_pago: "" });
  const editRef = useRef(null);

  const totalMes = useMemo(() => facturas.reduce((a, f) => a + Number(f.total || 0), 0), [facturas]);

  useEffect(() => {
    loadTarjetas();
    loadFacturas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!sel) return;
    setEdit({
      tarjeta_id: String(sel.tarjeta_id ?? ""),
      mes: String(sel.mes ?? ""),
      anio: String(sel.anio ?? ""),
      total: String(sel.total ?? ""),
      pagada: Boolean(sel.pagada),
      fecha_pago: sel.fecha_pago ?? "",
    });
    setTimeout(() => editRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }, [sel]);

  const tarjetaLabel = (obj) =>
    (obj.banco ? `${obj.banco} — ` : "") + (obj.tarjeta || obj.nombre || `Tarjeta ${obj.tarjeta_id ?? obj.id ?? ""}`);

  async function loadTarjetas() {
    try {
      const { data } = await api.get("/tarjetas");
      const arr = Array.isArray(data) ? data : (data?.data ?? []);
      setTarjetas(arr);
    } catch {
      // ignorar
    }
  }

  async function loadFacturas() {
    setLoading(true);
    setErr("");
    try {
      const params = { mes: Number(fMes), anio: Number(fAnio) };
      const { data } = await api.get("/facturas", { params });
      let items = Array.isArray(data) ? data : (data?.data ?? []);
      if (fTarjeta) items = items.filter(x => String(x.tarjeta_id) === String(fTarjeta));
      setFacturas(items);
      if (sel) {
        const keep = items.find(x => x.id === sel.id);
        setSel(keep || null);
      }
    } catch (e) {
      const msg = fmtError(e) || "No pude cargar facturas";
      setErr(msg);
      error({ title: "Error al cargar", description: msg });
    } finally {
      setLoading(false);
    }
  }

  function limpiarFiltros() {
    setFTarjeta("");
    setFMes(String(MES_ACTUAL));
    setFAnio(String(ANIO_ACTUAL));
    setTimeout(loadFacturas, 0);
  }

  // --- Crear
  async function crearFactura(e) {
    e?.preventDefault?.();
    if (!nuevo.tarjeta_id || !nuevo.total) {
      warning("Tarjeta y total son obligatorios.");
      return;
    }
    try {
      setSavingNew(true);
      await api.post("/facturas", {
        tarjeta_id: Number(nuevo.tarjeta_id),
        mes: Number(nuevo.mes),
        anio: Number(nuevo.anio),
        total: Number(nuevo.total),
      });
      setNuevo({ tarjeta_id: "", mes: String(MES_ACTUAL), anio: String(ANIO_ACTUAL), total: "" });
      await loadFacturas();
      success("Factura creada/actualizada");
    } catch (e) {
      error({ title: "No pude guardar la factura", description: fmtError(e) });
    } finally {
      setSavingNew(false);
    }
  }

  // --- Guardar edición
  async function guardarEdicion() {
    if (!sel) return;
    try {
      const payload = {};
      if (edit.tarjeta_id) payload.tarjeta_id = Number(edit.tarjeta_id);
      if (edit.mes) payload.mes = Number(edit.mes);
      if (edit.anio) payload.anio = Number(edit.anio);
      if (edit.total !== "") payload.total = Number(edit.total);
      payload.pagada = Boolean(edit.pagada);
      if (edit.pagada) {
        if (edit.fecha_pago) payload.fecha_pago = edit.fecha_pago; // opcional
      } else {
        payload.fecha_pago = null;
      }
      await api.put(`/facturas/${sel.id}`, payload);
      await loadFacturas();
      success("Cambios guardados");
    } catch (e) {
      error({ title: "No pude guardar cambios", description: fmtError(e) });
    }
  }

  // --- Eliminar
  async function eliminarSeleccionada() {
    if (!sel) return;

    const ok = await confirm({
      title: "¿Eliminar factura?",
      message: "Esta acción no se puede deshacer.",
      confirmText: "Eliminar",
      tone: "danger",
    });
    if (!ok) return;

    try {
      await api.delete(`/facturas/${sel.id}`);
      setSel(null);
      await loadFacturas();
      success("Factura eliminada");
    } catch (e) {
      error({ title: "No pude eliminar", description: fmtError(e) });
    }
  }

  // --- Marcar pagada / deshacer
  async function marcarPagada(flag) {
    if (!sel) return;
    try {
      await api.put(`/facturas/${sel.id}`, {
        pagada: Boolean(flag),
        fecha_pago: flag ? (edit.fecha_pago || null) : null,
      });
      await loadFacturas();
      success(flag ? "Factura marcada como pagada" : "Pago deshecho");
    } catch (e) {
      error({ title: "No pude actualizar el estado de pago", description: fmtError(e) });
    }
  }

  return (
    <AppShell
      title="Facturación tarjetas"
      actions={<button onClick={loadFacturas} style={ui.btn}>Actualizar</button>}
    >
      {/* Crear */}
      <div style={ui.card}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>🧾 Facturación de tarjetas (mes/año)</div>
        <form
          onSubmit={crearFactura}
          style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr auto", gap: 10, alignItems: "end" }}
        >
          <L label="Tarjeta">
            <select
              value={nuevo.tarjeta_id}
              onChange={(e) => setNuevo({ ...nuevo, tarjeta_id: e.target.value })}
              style={styles.input}
            >
              <option value="">Todas las tarjetas (para listar)</option>
              {tarjetas.map(t => (
                <option key={t.id} value={t.id}>
                  {tarjetaLabel(t)}
                </option>
              ))}
            </select>
          </L>
          <L label="Mes">
            <select value={nuevo.mes} onChange={(e) => setNuevo({ ...nuevo, mes: e.target.value })} style={styles.input}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                <option key={m} value={m}>{MESES[m]}</option>
              ))}
            </select>
          </L>
          <L label="Año">
            <input type="number" value={nuevo.anio} onChange={(e) => setNuevo({ ...nuevo, anio: e.target.value })} style={styles.input} />
          </L>
          <L label="Total facturado">
            <input type="number" value={nuevo.total} onChange={(e) => setNuevo({ ...nuevo, total: e.target.value })} style={styles.input} />
          </L>
          <button type="submit" disabled={savingNew} style={ui.btn}>
            {savingNew ? "Guardando..." : "Guardar"}
          </button>
        </form>
      </div>

      {/* Filtros */}
      <div style={ui.card}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Filtros</div>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto auto", gap: 10, alignItems: "end", marginBottom: 12 }}>
          <L label="Tarjeta">
            <select value={fTarjeta} onChange={(e) => setFTarjeta(e.target.value)} style={styles.input}>
              <option value="">Todas las tarjetas</option>
              {tarjetas.map(t => (
                <option key={t.id} value={t.id}>
                  {tarjetaLabel(t)}
                </option>
              ))}
            </select>
          </L>
          <L label="Mes">
            <select value={fMes} onChange={(e) => setFMes(e.target.value)} style={styles.input}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                <option key={m} value={m}>{MESES[m]}</option>
              ))}
            </select>
          </L>
          <L label="Año">
            <input type="number" value={fAnio} onChange={(e) => setFAnio(e.target.value)} style={styles.input} />
          </L>
          <button onClick={loadFacturas} style={styles.smallBtn}>Aplicar</button>
          <button onClick={limpiarFiltros} style={{ ...styles.smallBtn, background: "#8899aa" }}>Limpiar</button>
        </div>

        <div style={{ opacity: 0.9 }}>
          Total del mes (filtrado): <b>{fmtCLP(totalMes)}</b>
        </div>
        {err && <div style={{ marginTop: 10, ...styles.error }}>{err}</div>}
      </div>

      {/* Tabla */}
      <div style={ui.card}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>📑 Facturas</div>
        {loading ? (
          <div>Cargando…</div>
        ) : facturas.length === 0 ? (
          <div style={{ opacity: 0.8 }}>No hay facturas.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <div style={{ maxHeight: "50vh", overflowY: "auto", border: "1px solid #1f2a44", borderRadius: 12 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ position: "sticky", top: 0, background: "#0e1626", zIndex: 1 }}>
                    <th style={styles.th}>ID</th>
                    <th style={styles.th}>Tarjeta</th>
                    <th style={styles.th}>Mes</th>
                    <th style={styles.th}>Año</th>
                    <th style={styles.th}>Total</th>
                    <th style={styles.th}>Pagada</th>
                    <th style={styles.th}>Fecha pago</th>
                  </tr>
                </thead>
                <tbody>
                  {facturas.map(f => {
                    const selected = sel?.id === f.id;
                    return (
                      <tr
                        key={f.id}
                        onClick={() => setSel(f)}
                        style={{ ...styles.tr, background: selected ? "#1a253a" : "transparent" }}
                      >
                        <td style={styles.td}>{f.id}</td>
                        <td style={styles.td}>{tarjetaLabel(f)}</td>
                        <td style={styles.td}>{MESES[f.mes]}</td>
                        <td style={styles.td}>{f.anio}</td>
                        <td style={styles.td}>{fmtCLP(f.total)}</td>
                        <td style={styles.td}>{f.pagada ? "Sí" : "No"}</td>
                        <td style={styles.td}>{f.fecha_pago || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!sel && <div style={{ marginTop: 10, opacity: 0.7, fontSize: 13 }}>Tip: clic en una fila para editar, eliminar o marcar/deshacer pago.</div>}
          </div>
        )}
      </div>

      {/* Editor */}
      {sel && (
        <div style={ui.card} ref={editRef}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <div style={{ fontWeight: 700 }}>✏️ Editar</div>
            <span style={{ fontSize: 12, background: "#0e1626", padding: "4px 8px", borderRadius: 6 }}>
              ID {sel.id} — {tarjetaLabel(sel)}
            </span>
            <button onClick={() => setSel(null)} style={{ marginLeft: "auto", textDecoration: "underline", opacity: 0.8 }}>
              Limpiar selección
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr auto auto", gap: 10, alignItems: "end" }}>
            <L label="Tarjeta">
              <select value={edit.tarjeta_id} onChange={(e) => setEdit({ ...edit, tarjeta_id: e.target.value })} style={styles.input}>
                <option value="">—</option>
                {tarjetas.map(t => (
                  <option key={t.id} value={t.id}>{tarjetaLabel(t)}</option>
                ))}
              </select>
            </L>
            <L label="Mes">
              <select value={edit.mes || ""} onChange={(e) => setEdit({ ...edit, mes: e.target.value })} style={styles.input}>
                <option value="">—</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                  <option key={m} value={m}>{MESES[m]}</option>
                ))}
              </select>
            </L>
            <L label="Año">
              <input type="number" value={edit.anio || ""} onChange={(e) => setEdit({ ...edit, anio: e.target.value })} style={styles.input} />
            </L>
            <L label="Total">
              <input type="number" value={edit.total} onChange={(e) => setEdit({ ...edit, total: e.target.value })} style={styles.input} />
            </L>
            <L label="Fecha de pago (opcional)">
              <input
                type="date"
                value={edit.fecha_pago || ""}
                onChange={(e) => setEdit({ ...edit, fecha_pago: e.target.value })}
                style={styles.input}
                disabled={!edit.pagada}
              />
            </L>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={edit.pagada} onChange={(e) => setEdit({ ...edit, pagada: e.target.checked })} />
              Pagada
            </label>
            <button onClick={guardarEdicion} style={ui.btn}>Guardar cambios</button>
            <button onClick={eliminarSeleccionada} style={{ ...ui.btn, background: "#ff3b30" }}>Eliminar</button>
          </div>

          <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
            <button
              onClick={() => marcarPagada(true)}
              disabled={sel?.pagada}
              style={{ ...ui.btn, background: "#1e90ff", opacity: sel?.pagada ? 0.6 : 1 }}
              title={sel?.pagada ? "Ya está pagada" : ""}
            >
              {sel?.pagada ? "Ya pagada" : "Marcar pagada"}
            </button>
            <button
              onClick={() => marcarPagada(false)}
              disabled={!sel?.pagada}
              style={{ ...ui.btn, background: "#6c757d", opacity: !sel?.pagada ? 0.6 : 1 }}
            >
              Deshacer pagada
            </button>
          </div>
        </div>
      )}
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
  td: { padding: "8px", borderBottom: "1px solid #1f2a44", whiteSpace: "nowrap" },
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
  error: { background: "#ff3b30", color: "#fff", padding: "6px 10px", borderRadius: 8 },
};
