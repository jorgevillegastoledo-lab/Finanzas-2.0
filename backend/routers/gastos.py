# routers/gastos.py
from __future__ import annotations
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional
from calendar import monthrange

import psycopg2.extras
from psycopg2 import sql
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from core.dbutils import (
    get_conn, _fix_json, get_columns, ensure_gasto_detalle_table,
    ensure_pagos_gasto_table, ensure_recurrentes
)

router = APIRouter(prefix="/gastos", tags=["Gastos"])

# ---------------- Helpers de período/cierre ----------------
_CIERRE_OFFSET_DIAS = 5  # fijo, por ahora

def _is_period_closed(mes: int, anio: int, offset_dias: int = _CIERRE_OFFSET_DIAS) -> bool:
    """
    Determina si el período (mes/anio) está cerrado.
    Regla: hoy > fin_de_mes + offset_dias  => cerrado
    """
    try:
        if not (1 <= int(mes) <= 12) or not (2000 <= int(anio) <= 2100):
            return False
        last_day = date(int(anio), int(mes), monthrange(int(anio), int(mes))[1])
        hoy = date.today()
        return hoy > (last_day + timedelta(days=offset_dias))
    except Exception:
        return False

def _raise_if_deshacer_cerrado(mes: int, anio: int):
    """Cierre sólo aplica a DESHACER (y a editar/eliminar cuando ya está pagado)."""
    if _is_period_closed(mes, anio):
        m = f"El período {str(mes).zfill(2)}/{anio} está cerrado. No se puede deshacer el pago."
        raise HTTPException(status_code=409, detail=m)

def _msg_cierre(mes: int, anio: int) -> str:
    return f"El período {str(mes).zfill(2)}/{anio} está cerrado. No se permiten cambios en gastos pagados."

# ---------- Schemas ----------
class GastoIn(BaseModel):
    nombre: str
    monto: float
    mes: int
    anio: int
    pagado: Optional[bool] = None
    tarjeta_id: Optional[int] = None
    cuotas: Optional[int] = 1
    tipo: Optional[str] = None
    con_tarjeta: Optional[bool] = None
    es_recurrente: Optional[bool] = None
    fecha_vencimiento: Optional[str] = None

class GastoUpdate(BaseModel):
    nombre: Optional[str] = None
    monto: Optional[float] = None
    mes: Optional[int] = Field(default=None, ge=1, le=12)
    anio: Optional[int] = Field(default=None, ge=2000, le=2100)
    pagado: Optional[bool] = None
    tarjeta_id: Optional[int] = None
    cuotas: Optional[int] = None
    tipo: Optional[str] = None
    con_tarjeta: Optional[bool] = None
    es_recurrente: Optional[bool] = None
    fecha_vencimiento: Optional[str] = None

class GastoDetalleIn(BaseModel):
    compania: Optional[str] = None
    rut: Optional[str] = None
    tipo_doc: Optional[str] = None
    numero_doc: Optional[str] = None
    fecha_doc: Optional[date] = None
    categoria_id: Optional[int] = None
    metodo_pago: Optional[str] = None
    deducible: Optional[bool] = None
    moneda: Optional[str] = None
    tipo_cambio: Optional[float] = None
    neto: Optional[float] = None
    iva: Optional[float] = None
    exento: Optional[float] = None
    descuento: Optional[float] = None
    total_doc: Optional[float] = None
    garantia_meses: Optional[int] = None
    garantia_hasta: Optional[date] = None
    ubicacion: Optional[str] = None
    tags: Optional[Any] = None
    nota: Optional[str] = None

class GastoPagarIn(BaseModel):
    fecha: Optional[date] = None
    monto: Optional[float] = None
    metodo: Optional[str] = None
    tarjeta_id: Optional[int] = None
    nota: Optional[str] = None

# ---------- Endpoints ----------
@router.get("")
def listar_gastos(
    mes: int = Query(..., ge=1, le=12),
    anio: int = Query(..., ge=2000, le=2100),
):
    try:
        ensure_recurrentes(mes, anio)
        conn = get_conn()
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM gastos WHERE mes = %s AND anio = %s ORDER BY id DESC;",
                (mes, anio),
            )
            rows = cur.fetchall()
        conn.close()
        return {"ok": True, "data": _fix_json(rows)}
    except Exception as e:
        raise HTTPException(500, f"Error al cargar gastos: {e}")

@router.post("")
def crear_gasto(body: GastoIn):
    try:
        conn = get_conn()
        cols_exist = get_columns(conn, "gastos")
        data = {k: v for k, v in body.dict().items() if k in cols_exist and v is not None}
        if not data:
            raise HTTPException(400, "No hay columnas válidas que insertar.")
        columns = list(data.keys()); values = list(data.values())
        placeholders = [sql.Placeholder() for _ in columns]
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            q = sql.SQL("INSERT INTO {t} ({c}) VALUES ({p}) RETURNING *;").format(
                t=sql.Identifier("gastos"),
                c=sql.SQL(", ").join(map(sql.Identifier, columns)),
                p=sql.SQL(", ").join(placeholders),
            )
            cur.execute(q, values)
            row = cur.fetchone()
        conn.close()
        return {"ok": True, "data": _fix_json([row])[0]}
    except Exception as e:
        raise HTTPException(500, f"Error al crear gasto: {e}")

@router.put("/{id}")
def editar_gasto(id: int, body: GastoUpdate):
    try:
        conn = get_conn()
        # Traer gasto actual
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT id, mes, anio, pagado FROM gastos WHERE id = %s;", (id,))
            current = cur.fetchone()
        if not current:
            conn.close()
            raise HTTPException(404, "Gasto no encontrado")

        # 1) No permitir tocar 'pagado' desde PUT
        incoming = body.dict(exclude_unset=True)
        if "pagado" in incoming:
            conn.close()
            raise HTTPException(409, "No puedes cambiar el estado 'pagado' por esta ruta. Usa /gastos/{id}/pagar o /gastos/{id}/deshacer.")

        # 2) Si el gasto ya está pagado y el período cerrado => bloquear edición
        if bool(current.get("pagado")) and _is_period_closed(int(current["mes"]), int(current["anio"])):
            conn.close()
            raise HTTPException(409, _msg_cierre(int(current["mes"]), int(current["anio"])))

        # 3) Ejecutar UPDATE (cualquier campo válido excepto 'pagado')
        cols_exist = get_columns(conn, "gastos")
        data = {k: v for k, v in incoming.items() if k in cols_exist}
        if not data:
            conn.close()
            raise HTTPException(400, "No hay columnas válidas que actualizar.")

        sets = [sql.SQL("{} = {}").format(sql.Identifier(k), sql.Placeholder()) for k in data.keys()]
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            q = sql.SQL("UPDATE gastos SET {sets} WHERE id = %s RETURNING *;").format(
                sets=sql.SQL(", ").join(sets)
            )
            cur.execute(q, list(data.values()) + [id])
            row = cur.fetchone()
        conn.close()
        if not row:
            raise HTTPException(404, "Gasto no encontrado")
        return {"ok": True, "data": _fix_json([row])[0]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error al editar gasto: {e}")

@router.delete("/{id}")
def eliminar_gasto(id: int):
    try:
        conn = get_conn()
        # Chequear estado pagado
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT id, pagado FROM gastos WHERE id = %s;", (id,))
            g = cur.fetchone()
        if not g:
            conn.close()
            raise HTTPException(404, "Gasto no encontrado")
        if bool(g.get("pagado")):
            conn.close()
            raise HTTPException(409, "No se puede eliminar un gasto pagado. Deshaz el pago primero.")

        with conn.cursor() as cur:
            cur.execute("DELETE FROM gastos WHERE id = %s;", (id,))
        conn.close()
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error al eliminar gasto: {e}")

@router.post("/{id}/pagar")
def pagar_gasto(id: int, body: GastoPagarIn):
    try:
        conn = get_conn()
        ensure_pagos_gasto_table(conn)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, nombre, monto, mes, anio, pagado, con_tarjeta, tarjeta_id
                FROM gastos WHERE id = %s;
                """,
                (id,),
            )
            gasto = cur.fetchone()
        if not gasto:
            conn.close()
            raise HTTPException(404, "Gasto no encontrado")

        # IMPORTANTE: pagar SI está permitido aun si el período está cerrado

        # si ya está marcado pagado, no permitir otro registro
        if bool(gasto.get("pagado", False)):
            conn.close()
            raise HTTPException(409, "El gasto ya está marcado como pagado")

        fecha = body.fecha or date.today()
        monto = body.monto if body.monto is not None else float(gasto["monto"] or 0)
        metodo = (body.metodo or ("credito" if gasto.get("con_tarjeta") else "efectivo")).lower()
        tarjeta_id = body.tarjeta_id if body.tarjeta_id is not None else gasto.get("tarjeta_id")
        nota = body.nota

        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO pagos_gasto (gasto_id, fecha, monto, metodo, tarjeta_id, nota)
                VALUES (%s, %s, %s, %s, %s, %s) RETURNING *;
                """,
                (id, fecha, monto, metodo, tarjeta_id, nota),
            )
            pago_row = cur.fetchone()
            cur.execute("UPDATE gastos SET pagado = TRUE WHERE id = %s;", (id,))
        conn.close()
        return {"ok": True, "data": _fix_json([pago_row])[0]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error al pagar gasto: {e}")

# ----- Deshacer último pago -----
@router.post("/{id}/deshacer")
def deshacer_pago_gasto(id: int):
    """
    Elimina el **último** pago registrado del gasto (orden por fecha, created_at, id DESC).
    Si ya no quedan pagos, deja `pagado = FALSE` en la tabla `gastos`.
    Regla: NO se puede deshacer si el período está cerrado.
    """
    try:
        conn = get_conn()
        ensure_pagos_gasto_table(conn)

        # Traer mes/anio del gasto para validar cierre
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT id, mes, anio FROM gastos WHERE id = %s;", (id,))
            g = cur.fetchone()
        if not g:
            conn.close()
            raise HTTPException(404, "Gasto no encontrado")

        _raise_if_deshacer_cerrado(int(g["mes"]), int(g["anio"]))

        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            # localizar último pago
            cur.execute(
                """
                SELECT id
                FROM pagos_gasto
                WHERE gasto_id = %s
                ORDER BY fecha DESC, created_at DESC, id DESC
                LIMIT 1;
                """,
                (id,),
            )
            last = cur.fetchone()
            if not last:
                conn.close()
                raise HTTPException(status_code=409, detail="No hay pagos para deshacer.")

            # borrar último pago
            cur.execute("DELETE FROM pagos_gasto WHERE id = %s;", (last["id"],))

            # ¿quedan pagos?
            cur.execute("SELECT COUNT(*) AS cnt FROM pagos_gasto WHERE gasto_id = %s;", (id,))
            cnt_row = cur.fetchone()
            restantes = int(cnt_row["cnt"]) if isinstance(cnt_row, dict) else int(cnt_row[0])

            # setear flag pagado según correspondan pagos restantes
            cur.execute("UPDATE gastos SET pagado = %s WHERE id = %s;", (restantes > 0, id))
        conn.close()
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error al deshacer pago: {e}")

# ----- Listar pagos del gasto -----
@router.get("/{id}/pagos")
def listar_pagos_gasto(id: int):
    try:
        conn = get_conn()
        ensure_pagos_gasto_table(conn)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, gasto_id, fecha, monto, metodo, tarjeta_id, nota, created_at
                FROM pagos_gasto
                WHERE gasto_id = %s
                ORDER BY fecha DESC, created_at DESC, id DESC;
                """,
                (id,),
            )
            rows = cur.fetchall()
        conn.close()
        return {"ok": True, "data": _fix_json(rows)}
    except Exception as e:
        raise HTTPException(500, f"Error al listar pagos: {e}")

# ---------- Detalle (1:1 con gastos) ----------
@router.get("/{id}/detalle")
def get_gasto_detalle(id: int):
    try:
        conn = get_conn()
        ensure_gasto_detalle_table(conn)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT *
                FROM gasto_detalle
                WHERE gasto_id = %s;
                """,
                (id,),
            )
            row = cur.fetchone()
        conn.close()
        return {"ok": True, "data": _fix_json([row])[0] if row else {}}
    except Exception as e:
        raise HTTPException(500, f"Error al leer detalle de gasto: {e}")

@router.put("/{id}/detalle")
def upsert_gasto_detalle(id: int, body: GastoDetalleIn):
    try:
        conn = get_conn()
        ensure_gasto_detalle_table(conn)

        # tipos de columnas (para 'tags' json/jsonb)
        col_types: Dict[str, str] = {}
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_schema='public' AND table_name='gasto_detalle';
                """
            )
            for name, dtype in cur.fetchall():
                col_types[name] = (dtype or "").lower()

        data = body.dict(exclude_unset=True)

        # normalizar strings vacías
        for k in list(data.keys()):
            if isinstance(data[k], str) and data[k].strip() == "":
                data[k] = None

        # total_doc si corresponde
        if data.get("total_doc") is None:
            n = float(data.get("neto") or 0)
            v = float(data.get("iva") or 0)
            e = float(data.get("exento") or 0)
            d = float(data.get("descuento") or 0)
            if any([n, v, e, d]):
                data["total_doc"] = n + v + e - d

        keys = list(data.keys())
        vals = []
        for k in keys:
            v = data[k]
            if k == "tags" and v is not None and ("json" in col_types.get("tags", "")):
                v = psycopg2.extras.Json(v)
            vals.append(v)

        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cols_ins = ["gasto_id"] + keys + ["updated_at"]
            placeholders = ["%s"] * (len(keys) + 2)
            vals_ins = [id] + vals + [datetime.utcnow()]

            set_update = ", ".join([f"{k} = EXCLUDED.{k}" for k in keys] + ["updated_at = NOW()"])

            sql_q = f"""
                INSERT INTO gasto_detalle ({", ".join(cols_ins)})
                VALUES ({", ".join(placeholders)})
                ON CONFLICT (gasto_id) DO UPDATE SET
                  {set_update}
                RETURNING *;
            """
            cur.execute(sql_q, vals_ins)
            row = cur.fetchone()

        conn.close()
        return {"ok": True, "data": _fix_json([row])[0] if row else None}
    except Exception as e:
        raise HTTPException(500, f"Error al guardar detalle de gasto: {e}")

@router.delete("/{id}/detalle")
def delete_gasto_detalle(id: int):
    try:
        conn = get_conn()
        ensure_gasto_detalle_table(conn)
        with conn.cursor() as cur:
            cur.execute("DELETE FROM gasto_detalle WHERE gasto_id = %s;", (id,))
        conn.close()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, f"Error al eliminar detalle de gasto: {e}")

