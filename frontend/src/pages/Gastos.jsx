// frontend/src/pages/Gastos.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import AppShell, { ui } from "../components/AppShell";
import api from "../api/api";
import { useToast, useConfirm } from "../ui/notifications";
import ConceptoPicker from "../components/ConceptoPicker";
import ConceptoFinderModal from "../components/ConceptoFinderModal";


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
   HELPERS DE PAGOS / FECHAS
   =========================== */
function metodoDesdeUI(fp_ui) {
  if (fp_ui === FP.CREDITO) return "credito";
  if (fp_ui === FP.DEBITO)  return "debito";
  return "efectivo";
}

async function crearPagoGastoAPI(payload) {
  try {
    const { gasto_id, ...body } = payload;
    await api.post(`/gastos/${gasto_id}/pagar`, body);
    return { ok: true };
  } catch (e) {
    console.error("crearPagoGastoAPI /gastos/:id/pagar falló:", e?.response?.status, e?.response?.data);
    return { ok: false, err: e?.response?.data?.detail || "No pude registrar el pago." };
  }
}

// Último día del mes (mes 1..12)
function endOfMonth(anio, mes) {
  return new Date(anio, mes, 0);
}
// Fin de mes + 5 días
function endOfMonthPlus5(anio, mes) {
  const d = endOfMonth(anio, mes);
  const r = new Date(d.getTime());
  r.setDate(d.getDate() + 5);
  r.setHours(23,59,59,999);
  return r;
}
// ¿Se puede deshacer dentro de la ventana?
function canUndoWindow(g) {
  if (!g?.anio || !g?.mes) return false;
  const limite = endOfMonthPlus5(Number(g.anio), Number(g.mes));
  return new Date() <= limite;
}

// ---------------- Detalle Gasto (modal) ----------------
const emptyGastoDetalle = {
  compania: "",
  rut: "",
  tipo_doc: "",
  numero_doc: "",
  fecha_doc: "",
  metodo_pago: "",
  neto: "",
  iva: "",
  exento: "",
  descuento: "",
  total_doc: "",
  garantia_meses: "",
  garantia_hasta: "",
  ubicacion: "",
  tags: "",
  nota: "",
};

export default function Gastos() {
  const { success, error, warning } = useToast();
  const confirm = useConfirm();
  const [finderOpen, setFinderOpen] = useState(false);

  // --- Estado de lista / filtros ---
  const [gastos, setGastos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [pickerKey, setPickerKey] = useState(0);

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
    nombre: "",
    monto: "",
    mes: String(MES_ACTUAL), anio: String(ANIO_ACTUAL),
    pagado: false,
    es_recurrente: false,
    fp_ui: FP.EFECTIVO,
    tarjeta_id: "",
  });
  const [nuevoConcepto, setNuevoConcepto] = useState(null);
  const [savingNew, setSavingNew] = useState(false);
  
  // --- Selección y edición (panel inferior) ---
  const [sel, setSel] = useState(null);
  const selRef = useRef(null);                 // 👈 para evitar closures obsoletos
  useEffect(()=>{ selRef.current = sel; }, [sel]);

  const [edit, setEdit] = useState({
    nombre: "", monto: "", mes: "", anio: "", pagado: false,
    es_recurrente: false,
    fp_ui: FP.EFECTIVO,
    tarjeta_id: "",
  });
  const editRef = useRef(null);

  // Tarjetas
  const [tarjetas, setTarjetas] = useState([]);
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

  // ------- Menú contextual -------
  const [menu, setMenu] = useState({ show:false, x:0, y:0, target:null });
  const menuRef = useRef(null);

  const openMenu = (e, g) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ show:true, x:e.clientX, y:e.clientY, target:g });
  };

  useEffect(() => {
    const onDown = (e) => e.key === "Escape" && setMenu((m)=>({ ...m, show:false }));
    const onClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenu((m)=>({ ...m, show:false }));
      }
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("click", onClick);
    };
  }, []);

  const openEditor = (row) => {
    const r = row || menu.target;
    if (!r) return;
    setMenu(m => ({ ...m, show:false }));
    setSel(r);
    setEdit({
      nombre: r.nombre ?? "",
      monto: String(r.monto ?? ""),
      mes: String(r.mes ?? ""),
      anio: String(r.anio ?? ""),
      pagado: Boolean(r.pagado),
      es_recurrente: Boolean(r.es_recurrente ?? r.recurrente),
      fp_ui: isCredito(r) ? FP.CREDITO : FP.EFECTIVO,
      tarjeta_id: r.tarjeta_id ? String(r.tarjeta_id) : "",
    });
    setTimeout(()=>editRef.current?.scrollIntoView({ behavior:"smooth", block:"start" }),0);
  };

  // ------- Modal Detalles de gasto -------
  const [detOpen, setDetOpen] = useState(false);
  const [detBusy, setDetBusy] = useState(false);
  const [det, setDet] = useState(emptyGastoDetalle);
  const [detGastoId, setDetGastoId] = useState(null);

  const openDetalles = async () => {
    const id = menu.target?.id ?? sel?.id;
    if (!id) { warning("Primero selecciona un gasto"); return; }
    setDetGastoId(id);
    setDet(emptyGastoDetalle);
    setMenu(m => ({ ...m, show:false }));
    setDetOpen(true);
    try {
      const { data } = await api.get(`/gastos/${id}/detalle`);
      const d = data?.data ?? data;
      if (d) {
        setDet({
          compania: d.compania ?? "",
          rut: d.rut ?? "",
          tipo_doc: d.tipo_doc ?? "",
          numero_doc: d.numero_doc ?? "",
          fecha_doc: d.fecha_doc ?? "",
          metodo_pago: d.metodo_pago ?? "",
          neto: d.neto ?? "",
          iva: d.iva ?? "",
          exento: d.exento ?? "",
          descuento: d.descuento ?? "",
          total_doc: d.total_doc ?? "",
          garantia_meses: d.garantia_meses ?? "",
          garantia_hasta: d.garantia_hasta ?? "",
          ubicacion: d.ubicacion ?? "",
          tags: Array.isArray(d.tags) ? d.tags.join(", ") : (d.tags || ""),
          nota: d.nota ?? "",
        });
      }
    } catch (e) {
      console.warn("GET detalle gasto falló:", e?.response?.data || e);
    }
  };

  const saveDetalle = async () => {
    if (!detGastoId) { warning("No hay gasto seleccionado"); return; }
    try {
      setDetBusy(true);
      const payload = {
        compania: det.compania || null,
        rut: det.rut || null,
        tipo_doc: det.tipo_doc || null,
        numero_doc: det.numero_doc || null,
        fecha_doc: det.fecha_doc || null,
        metodo_pago: det.metodo_pago || null,
        neto: det.neto !== "" ? Number(det.neto) : null,
        iva: det.iva !== "" ? Number(det.iva) : null,
        exento: det.exento !== "" ? Number(det.exento) : null,
        descuento: det.descuento !== "" ? Number(det.descuento) : null,
        total_doc: det.total_doc !== "" ? Number(det.total_doc) : null,
        garantia_meses: det.garantia_meses !== "" ? Number(det.garantia_meses) : null,
        garantia_hasta: det.garantia_hasta || null,
        ubicacion: det.ubicacion || null,
        tags: det.tags
          ? det.tags.split(",").map(s=>s.trim()).filter(Boolean)
          : null,
        nota: det.nota || null,
      };
      await api.put(`/gastos/${detGastoId}/detalle`, payload);
      success("Detalles guardados");
      setDetOpen(false);
    } catch (e) {
      const msg =
        e?.response?.data?.detail || e?.message || "No pude guardar el detalle";
      console.error("saveDetalle error:", e?.response?.data || e);
      error(msg);
    } finally {
      setDetBusy(false);
    }
  };

  const deleteDetalle = async () => {
    if (!detGastoId) return;
    const ok = await confirm({
      title: "¿Eliminar detalles?",
      message: "Se eliminará la información adicional de este gasto.",
      confirmText: "Eliminar",
      tone: "danger",
    });
    if (!ok) return;
    try {
      setDetBusy(true);
      await api.delete(`/gastos/${detGastoId}/detalle`);
      success("Detalle eliminado");
      setDetOpen(false);
    } catch (e) {
      error(e?.response?.data?.detail || "No pude eliminar el detalle");
    } finally {
      setDetBusy(false);
    }
  };

  // Carga inicial
  useEffect(() => {
    loadTarjetas();
    loadGastos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // refresca edición cuando cambia selección
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

  // 👇 ahora acepta opciones; por defecto preserva selección
  async function loadGastos(opts = { keepSelection: true }) {
    const keepSelection = opts?.keepSelection ?? true;
    try {
      setErr(""); setLoading(true);
      if (!fMes || !fAnio) { setGastos([]); return; }

      const { data } = await api.get("/gastos", { params: { mes: Number(fMes), anio: Number(fAnio) } });
      let items = Array.isArray(data) ? data : (data?.data ?? []);
      if (fPagado) items = items.filter((g) => !!g.pagado);

      // Orden por ID asc
      items = [...items].sort((a,b)=> (Number(a.id)||0) - (Number(b.id)||0));
      setGastos(items);

      // 👇 solo re-seleccionar si se pidió explícitamente
      if (keepSelection && selRef.current) {
        const keep = items.find((x) => x.id === selRef.current.id);
        setSel(keep || null);
      }
    } catch (e) {
      setErr(e?.response?.data?.detail || "No pude cargar gastos");
    } finally { setLoading(false); }
  }

  // --- Crear ---
   async function crearGasto(e) {
  e?.preventDefault?.();

  if (!nuevoConcepto || !nuevoConcepto.id) {
    warning("Selecciona un concepto válido.");
    return;
  }
  if (!nuevo.monto) {
    warning("El monto es obligatorio.");
    return;
  }
  if (nuevo.fp_ui === FP.CREDITO && !nuevo.tarjeta_id) {
    warning("Selecciona una tarjeta para los gastos a crédito.");
    return;
  }

  try {
    setSavingNew(true);
    await api.post("/gastos", {
      concepto_id: Number(nuevoConcepto.id),
      nombre: nuevoConcepto.nombre,        // ok, no molesta

      monto: Number(nuevo.monto),
      mes: nuevo.mes ? Number(nuevo.mes) : null,
      anio: nuevo.anio ? Number(nuevo.anio) : null,
      pagado: Boolean(nuevo.pagado),
      es_recurrente: Boolean(nuevo.es_recurrente),
      con_tarjeta: nuevo.fp_ui === FP.CREDITO,
      tarjeta_id: nuevo.fp_ui === FP.CREDITO ? Number(nuevo.tarjeta_id) : null,
    });

    setNuevo({
      nombre: "",
      monto: "",
      mes: String(MES_ACTUAL),
      anio: String(ANIO_ACTUAL),
      pagado: false,
      es_recurrente: false,
      fp_ui: FP.EFECTIVO,
      tarjeta_id: "",
    });
    setNuevoConcepto(null);
	setPickerKey(k => k + 1);  // 👈 fuerza limpiar el ConceptoPicker
    await loadGastos();
    success("Gasto creado");
  } catch (e) {
    let detail = e?.response?.data?.detail || String(e);
    if (detail.includes("No se permiten gastos en períodos futuros")) {
      detail = "No se pueden crear gastos en períodos futuros. Revisa el año/mes seleccionado.";
    }
    error({
      title: "No pude guardar el gasto",
      description: detail,
    });
	// 👇 limpiar campos también cuando falla
    setNuevo(n => ({ ...n, monto: "" }));  // deja mes/año y demás igual
    setNuevoConcepto(null);                 // limpia el ConceptoPicker
    setPickerKey(k => k + 1);               // fuerza el remount del picker
	
  } finally {
    setSavingNew(false);
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

  // 👇 Helper centralizado: limpiar selección y colapsar panel tras acciones
  async function resetAfterAction() {
    setSel(null);
    setMenu(m => ({ ...m, show:false, target:null }));
    await loadGastos({ keepSelection: false }); // 👈 NO re-seleccionar
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // --- Editar / eliminar / marcar pagado ---
  async function guardarEdicion() {
  if (!sel) return;

  if (edit.fp_ui === FP.CREDITO && !edit.tarjeta_id) {
    warning("Selecciona una tarjeta para los gastos a crédito.");
    return;
  }

  // Construir diferencias entre original (sel) y editado
  const cambios = [];
  if (Number(edit.monto || 0) !== Number(sel.monto || 0)) {
    cambios.push(`Monto: ${fmtCLP(sel.monto)} → ${fmtCLP(edit.monto)}`);
  }
  if (Boolean(edit.es_recurrente) !== Boolean(sel.es_recurrente ?? sel.recurrente)) {
    cambios.push(`Recurrente: ${sel.es_recurrente ? "Sí" : "No"} → ${edit.es_recurrente ? "Sí" : "No"}`);
  }
  const fpOrig = isCredito(sel) ? "Crédito" : "Efectivo/Débito";
  const fpEdit = edit.fp_ui === FP.CREDITO ? "Crédito" : "Efectivo/Débito";
  if (fpOrig !== fpEdit) {
    cambios.push(`Forma de pago: ${fpOrig} → ${fpEdit}`);
  }
  const tOrig = sel.tarjeta_id ? labelTarjeta(sel) : "—";
  const tEdit = edit.fp_ui === FP.CREDITO
    ? (tarjetaNombreMap[String(edit.tarjeta_id)] || `Tarjeta ${edit.tarjeta_id}`)
    : "—";
  if (tOrig !== tEdit) {
    cambios.push(`Tarjeta: ${tOrig} → ${tEdit}`);
  }

  const msgCambios = cambios.length > 0
    ? "Cambios:\n" + cambios.join("\n")
    : "No se detectan cambios significativos.";

  const ok = await confirm({
    title: "Confirmar cambios",
    message: `¿Guardar cambios en el gasto ID ${sel.id} — ${sel.nombre}?\n\n${msgCambios}`,
    confirmText: "Guardar",
  });
  if (!ok) return;

  try {
    await api.put(`/gastos/${sel.id}`, {
      monto: Number(edit.monto || 0),
      es_recurrente: Boolean(edit.es_recurrente),
      con_tarjeta: edit.fp_ui === FP.CREDITO,
      tarjeta_id: edit.fp_ui === FP.CREDITO ? Number(edit.tarjeta_id) : null,
    });
    success("Cambios guardados");
    await resetAfterAction(); // colapsa panel y refresca
  } catch (e) {
    const detail = e?.response?.data?.detail;
    if (e?.response?.status === 409) {
      error({ title: "Operación no permitida", description: detail || "Conflicto con el estado actual." });
    } else {
      error({ title: "No pude guardar cambios", description: detail || String(e) });
    }
  }
}



  async function eliminarSeleccionado() {
    if (!sel) return;

    if (sel.pagado) {
      error({ title: "No se puede eliminar", description: "Para eliminar, primero deshaz el pago (si el período no está cerrado)." });
      return;
    }

    const ok = await confirm({
      title: "¿Eliminar gasto?",
      message: "Esta acción no se puede deshacer.",
      confirmText: "Eliminar",
      tone: "danger",
    });
    if (!ok) return;

    try {
      await api.delete(`/gastos/${sel.id}`);
      success("Gasto eliminado");
      await resetAfterAction(); // 👈 colapsa panel
    } catch (e) {
      const detail = e?.response?.data?.detail;
      error({ title: "No pude eliminar", description: detail || String(e) });
    }
  }

  async function marcarPagado(flag) {
    if (!sel) return;
    try {
      if (flag) {
        const fp_ui_sel = edit?.fp_ui || (isCredito(sel) ? FP.CREDITO : FP.EFECTIVO);
        const metodo = metodoDesdeUI(fp_ui_sel);
        const tarjetaId =
          metodo === "credito"
            ? Number(edit?.tarjeta_id || sel?.tarjeta_id || 0) || null
            : null;

        if (metodo === "credito" && !tarjetaId) {
          warning("Selecciona una tarjeta para registrar el pago con crédito.");
          return;
        }

        const ok = await confirm({
          title: "Confirmar pago",
          message: `¿Marcar el gasto como pagado por ${fmtCLP(Number(sel.monto || 0))}?`,
          confirmText: "Sí, pagar",
        });
        if (!ok) return;

        const payloadPay = {
          gasto_id: sel.id,
          fecha: new Date().toISOString().slice(0,10),
          monto: Number(sel.monto || 0),
          metodo,               // "efectivo" | "debito" | "credito"
          tarjeta_id: tarjetaId
        };

        const res = await crearPagoGastoAPI(payloadPay);
        if (!res.ok) {
          error({ title: "No pude registrar el pago", description: res.err });
          return;
        }
        success("Pago registrado");
      } else {
        const ok = await confirm({
          title: "Deshacer pago",
          message: "Se eliminará el último registro de pago y el gasto quedará como NO pagado si no hay pagos restantes.",
          confirmText: "Deshacer",
          tone: "warning",
        });
        if (!ok) return;

        await api.post(`/gastos/${sel.id}/deshacer`);
        success("Se deshizo el pago");
      }

      await resetAfterAction(); // 👈 colapsa panel tras pagar/deshacer
    } catch (e) {
      const detail = e?.response?.data?.detail;
      if (e?.response?.status === 409) {
        error({ title: "Operación no permitida", description: detail || "Conflicto con el estado actual." });
      } else {
        error({ title: "No pude actualizar el estado de pago", description: detail || String(e) });
      }
    }
  }

  // ------ Derivados de UI ------
  const sortedGastos = useMemo(() => {
    return [...gastos].sort((a,b)=> (Number(a.id)||0) - (Number(b.id)||0));
  }, [gastos]);

  const isPaid = Boolean(sel?.pagado);
  const undoAllowed = isPaid && canUndoWindow(sel);

  return (
    <AppShell title="Gastos" actions={<button onClick={()=>loadGastos()} style={ui.btn}>Actualizar</button>}>

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
          <Field label="Concepto">
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
              <ConceptoPicker
                key={pickerKey}
                value={nuevoConcepto}
                onChange={setNuevoConcepto}
                placeholder="Escribe para buscar…"
            />
            <button
                type="button"
                onClick={() => setFinderOpen(true)}
                style={ui.btn}
                title="Buscar concepto"
            >
                🔎 Buscar
               </button>
            </div>
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
            <button onClick={()=>loadGastos()} style={styles.smallBtn}>Aplicar</button>
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
        ) : sortedGastos.length === 0 ? (
          <div style={{ opacity: 0.8 }}>
            {(!fMes || !fAnio) ? "Selecciona Mes y Año y presiona Aplicar." : "No hay gastos."}
          </div>
        ) : (
          <>
            <div style={{ overflowX: "auto", position:"relative" }}>
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
                    {sortedGastos.map((g) => {
                      const credito = isCredito(g);
                      const selected = sel?.id === g.id;
                      const esRec = Boolean(g.es_recurrente ?? g.recurrente);
                      return (
                        <tr
                          key={g.id}
                          onClick={(e)=>openMenu(e,g)}
                          onContextMenu={(e)=>openMenu(e,g)}
                          style={{ ...styles.tr, background: selected ? "#1a253a" : "transparent", cursor:"pointer" }}
                          title="Click para acciones (detalles / editar)"
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

              {/* Menú contextual */}
              {menu.show && (
                <div
                  ref={menuRef}
                  style={{
                    position:"fixed", top:menu.y+8, left:menu.x+8,
                    background:"#0e1626", border:"1px solid #24324a", borderRadius:10,
                    boxShadow:"0 8px 30px rgba(0,0,0,.4)", zIndex:50, minWidth:220
                  }}
                >
                  <div style={{ padding:10, borderBottom:"1px solid #1f2a44", fontSize:12, opacity:.8 }}>
                    ID {menu.target?.id} — {menu.target?.nombre}
                  </div>
                  <button onClick={openDetalles} style={styles.menuItem}>📄 Ver detalles</button>
                  <button onClick={()=>openEditor()} style={{ ...styles.menuItem, borderTop:"1px solid #1f2a44" }}>
                    ✏️ Editar / Eliminar
                  </button>
                </div>
              )}
            </div>

            {!sel && (
              <div style={{ marginTop: 10, opacity: 0.7, fontSize: 13 }}>
                Tip: haz clic en una fila para abrir el menú de acciones.
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
            {/* Concepto (solo lectura) */}
            <Field label="Concepto">
              <input
                style={styles.input}
                value={sel?.nombre || (sel?.concepto_id ? `Concepto #${sel.concepto_id}` : "")}
                disabled
                title="El concepto no se puede cambiar en edición. Si te equivocaste, elimina el gasto (si no está pagado) y créalo de nuevo."
              />
            </Field>

            {/* Monto (editable bloqueado si pagado) */}
            <Field label="Monto">
              <input
                type="number"
                value={edit.monto}
                onChange={(e) => setEdit({ ...edit, monto: e.target.value })}
                style={styles.input}
                disabled={Boolean(sel?.pagado)}
                title={sel?.pagado ? "Bloqueado: el gasto está pagado. Deshaz el pago para editar." : ""}
              />
            </Field>

            {/* Mes (solo lectura) */}
            <Field label="Mes">
              <select value={edit.mes || ""} style={styles.input} disabled
                title="El mes no se puede cambiar en edición. Elimina y vuelve a crear el gasto si fue un error.">
                <option value="">{edit.mes ? MESES[Number(edit.mes)] : "—"}</option>
              </select>
            </Field>

            {/* Año (solo lectura) */}
            <Field label="Año">
              <input
                type="number"
                value={edit.anio || ""}
                style={styles.input}
                disabled
                title="El año no se puede cambiar en edición. Elimina y vuelve a crear el gasto si fue un error."
              />
            </Field>

            {/* Recurrente */}
            <Field label="Recurrente">
              <label style={{ display: "flex", alignItems: "center", gap: 8, height: 38 }}>
                <input
                  type="checkbox"
                  checked={edit.es_recurrente}
                  onChange={(e) => setEdit({ ...edit, es_recurrente: e.target.checked })}
                  disabled={Boolean(sel?.pagado)}
                  title={sel?.pagado ? "Bloqueado: el gasto está pagado. Deshaz el pago para editar." : ""}
                />
                Sí
              </label>
            </Field>

            {/* Forma de pago */}
            <Field label="Forma de pago">
              <select
                value={edit.fp_ui}
                onChange={(e) => setEdit({ ...edit, fp_ui: e.target.value })}
                style={styles.input}
                disabled={Boolean(sel?.pagado)}
                title={sel?.pagado ? "Bloqueado: el gasto está pagado. Deshaz el pago para editar." : ""}
              >
                <option value={FP.EFECTIVO}>Efectivo</option>
                <option value={FP.DEBITO}>Débito</option>
                <option value={FP.CREDITO}>Crédito</option>
              </select>
            </Field>

            {/* Tarjeta si crédito */}
            <Field label="Tarjeta (si crédito)">
              <select
                value={edit.tarjeta_id}
                onChange={(e) => setEdit({ ...edit, tarjeta_id: e.target.value })}
                style={{ ...styles.input, opacity: edit.fp_ui === FP.CREDITO ? 1 : 0.5 }}
                disabled={edit.fp_ui !== FP.CREDITO || Boolean(sel?.pagado)}
                title={sel?.pagado ? "Bloqueado: el gasto está pagado. Deshaz el pago para editar." : ""}
              >
                <option value="">Selecciona…</option>
                {tarjetas.map((t) => (
                  <option key={t.id} value={String(t.id)}>
                    {t.nombre || t.banco || `Tarjeta ${t.id}`}
                  </option>
                ))}
              </select>
            </Field>

            <button
              onClick={guardarEdicion}
              style={{ ...ui.btn, opacity: sel?.pagado ? 0.6 : 1, cursor: sel?.pagado ? "not-allowed" : "pointer" }}
              disabled={Boolean(sel?.pagado)}
              title={sel?.pagado ? "Para editar, primero deshaz el pago (si el período no está cerrado)." : ""}
            >
              Guardar cambios
            </button>

            <button
              onClick={eliminarSeleccionado}
              style={{ ...ui.btn, background: sel?.pagado ? "#8a8f98" : "#ff3b30", cursor: sel?.pagado ? "not-allowed" : "pointer" }}
              disabled={!!sel?.pagado}
              title={sel?.pagado ? "Para eliminar, primero deshaz el pago (si el período no está cerrado)." : ""}
            >
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
              {sel?.pagado ? "Ya pagado" 
			  : `Marcar pagado (${fmtCLP(sel?.monto)})`}
            </button>
            <button
              onClick={() => marcarPagado(false)}
              disabled={!(sel && sel.pagado && canUndoWindow(sel))}
              style={{ ...ui.btn, background: "#6c757d", opacity: !(sel && sel.pagado && canUndoWindow(sel)) ? 0.6 : 1, cursor: !(sel && sel.pagado && canUndoWindow(sel)) ? "not-allowed" : "pointer" }}
              title={
                sel?.pagado
                  ? (canUndoWindow(sel) ? "Deshacer pago" : "Ventana cerrada: solo era posible hasta fin de mes + 5 días.")
                  : "Aún no está pagado"
              }
            >
              Deshacer pagado
            </button>
            <button onClick={openDetalles} style={{ ...ui.btn, background:"#17a2b8" }}>
              📄 Detalles
            </button>
          </div>
        </div>
      )}

      {/* Modal Detalles */}
      {detOpen && (
        <div style={styles.modalBackdrop} onClick={()=>setDetOpen(false)}>
          <div style={styles.modal} onClick={(e)=>e.stopPropagation()}>
            <div style={{ fontWeight:700, marginBottom:12 }}>
              🧾 Detalles del gasto
              <span style={{ fontSize:12, opacity:.7, marginLeft:8 }}>(informativo)</span>
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"1.2fr 1fr 1fr 1fr", gap:10 }}>
              <Field label="Compañía">
                <input style={styles.input} value={det.compania} onChange={(e)=>setDet({ ...det, compania:e.target.value })}/>
              </Field>
              <Field label="RUT">
                <input style={styles.input} value={det.rut} onChange={(e)=>setDet({ ...det, rut:e.target.value })}/>
              </Field>
              <Field label="Tipo doc.">
                <select style={styles.input} value={det.tipo_doc} onChange={(e)=>setDet({ ...det, tipo_doc:e.target.value })}>
                  <option value="">—</option>
                  <option value="boleta">Boleta</option>
                  <option value="factura">Factura</option>
                  <option value="ticket">Ticket</option>
                  <option value="otro">Otro</option>
                </select>
              </Field>
              <Field label="N° doc.">
                <input style={styles.input} value={det.numero_doc} onChange={(e)=>setDet({ ...det, numero_doc:e.target.value })}/>
              </Field>

              <Field label="Fecha doc.">
                <input type="date" style={styles.input} value={det.fecha_doc || ""} onChange={(e)=>setDet({ ...det, fecha_doc:e.target.value })}/>
              </Field>
              <Field label="Método pago">
                <input style={styles.input} value={det.metodo_pago} onChange={(e)=>setDet({ ...det, metodo_pago:e.target.value })} placeholder="efectivo/debito/credito/transferencia"/>
              </Field>
              <Field label="Neto">
                <input type="number" style={styles.input} value={det.neto} onChange={(e)=>setDet({ ...det, neto:e.target.value })}/>
              </Field>
              <Field label="IVA">
                <input type="number" style={styles.input} value={det.iva} onChange={(e)=>setDet({ ...det, iva:e.target.value })}/>
              </Field>

              <Field label="Exento">
                <input type="number" style={styles.input} value={det.exento} onChange={(e)=>setDet({ ...det, exento:e.target.value })}/>
              </Field>
              <Field label="Descuento">
                <input type="number" style={styles.input} value={det.descuento} onChange={(e)=>setDet({ ...det, descuento:e.target.value })}/>
              </Field>
              <Field label="Total doc.">
                <input type="number" style={styles.input} value={det.total_doc} onChange={(e)=>setDet({ ...det, total_doc:e.target.value })}/>
              </Field>
              <Field label="Ubicación">
                <input style={styles.input} value={det.ubicacion} onChange={(e)=>setDet({ ...det, ubicacion:e.target.value })}/>
              </Field>

              <Field label="Garantía (meses)">
                <input type="number" style={styles.input} value={det.garantia_meses} onChange={(e)=>setDet({ ...det, garantia_meses:e.target.value })}/>
              </Field>
              <Field label="Garantía hasta">
                <input type="date" style={styles.input} value={det.garantia_hasta || ""} onChange={(e)=>setDet({ ...det, garantia_hasta:e.target.value })}/>
              </Field>
              <Field label="Tags (coma)">
                <input style={styles.input} value={det.tags} onChange={(e)=>setDet({ ...det, tags:e.target.value })} placeholder="hogar, supermercado"/>
              </Field>
              <Field label="Nota" style={{ gridColumn:"span 4" }}>
                <textarea style={{ ...styles.input, minHeight:80 }} value={det.nota} onChange={(e)=>setDet({ ...det, nota:e.target.value })}/>
              </Field>
            </div>

            <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:14 }}>
              <button type="button" onClick={()=>setDetOpen(false)} style={{ ...ui.btn, background:"#6c757d" }}>Cerrar</button>
              <button type="button" onClick={deleteDetalle} style={{ ...ui.btn, background:"#ff3b30" }} disabled={detBusy}>Eliminar</button>
              <button type="button" onClick={saveDetalle} style={ui.btn} disabled={detBusy}>{detBusy ? "Guardando..." : "Guardar"}</button>
            </div>
          </div>
        </div>
      )}
	        <ConceptoFinderModal
              open={finderOpen}
              onClose={() => setFinderOpen(false)}
              onPick={(c) => { setNuevoConcepto(c); setFinderOpen(false); }}
              allowCreate={false}   // 👈 sin creación desde la lupa
            />
	  
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
  tr: { transition:"background .15s ease" },
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
  menuItem:{ display:"block", width:"100%", textAlign:"left", padding:"10px 12px", background:"transparent", color:"#e6f0ff", border:0, cursor:"pointer" },
  modalBackdrop:{ position:"fixed", inset:0, background:"rgba(0,0,0,.5)", zIndex:40, display:"flex", alignItems:"center", justifyContent:"center", padding:16 },
  modal:{ width:"min(1100px, 96vw)", background:"#0b1322", border:"1px solid #1f2a44", borderRadius:12, padding:16, boxShadow:"0 40px 120px rgba(0,0,0,.55)" },
};







