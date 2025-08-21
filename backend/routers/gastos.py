# routers/gastos.py
from __future__ import annotations
from datetime import date, datetime
from typing import Any, Dict, List, Optional

import psycopg2.extras
from psycopg2 import sql
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from core.dbutils import (
    get_conn, _fix_json, get_columns, ensure_gasto_detalle_table,
    ensure_pagos_gasto_table, ensure_recurrentes
)

router = APIRouter(prefix="/gastos", tags=["Gastos"])

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
        cols_exist = get_columns(conn, "gastos")
        data = {k: v for k, v in body.dict(exclude_unset=True).items() if k in cols_exist}
        if not data:
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
    except Exception as e:
        raise HTTPException(500, f"Error al editar gasto: {e}")

@router.delete("/{id}")
def eliminar_gasto(id: int):
    try:
        conn = get_conn()
        with conn.cursor() as cur:
            cur.execute("DELETE FROM gastos WHERE id = %s;", (id,))
            if cur.rowcount == 0:
                raise HTTPException(404, "Gasto no encontrado")
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
            raise HTTPException(404, "Gasto no encontrado")

        # si ya está marcado pagado, no permitir otro registro
        pagado_val = gasto.get("pagado", False)
        try:
            ya_pagado = bool(pagado_val) if isinstance(pagado_val, bool) else int(pagado_val) == 1
        except Exception:
            ya_pagado = bool(pagado_val)
        if ya_pagado:
            raise HTTPException(409, "El gasto ya está marcado como pagado")

        fecha = body.fecha or date.today()
        monto = body.monto if body.monto is not None else float(gasto["monto"] or 0)
        metodo = body.metodo or ("Crédito" if gasto.get("con_tarjeta") else "Efectivo/Débito")
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

# ----- NUEVO: deshacer último pago -----
@router.post("/{id}/deshacer")
def deshacer_pago_gasto(id: int):
    """
    Elimina el **último** pago registrado del gasto (orden por fecha, created_at, id DESC).
    Si ya no quedan pagos, deja `pagado = FALSE` en la tabla `gastos`.
    """
    try:
        conn = get_conn()
        ensure_pagos_gasto_table(conn)
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
                raise HTTPException(400, "No hay pagos para deshacer.")

            # borrar último pago
            cur.execute("DELETE FROM pagos_gasto WHERE id = %s;", (last["id"],))

            # ¿quedan pagos?
            cur.execute("SELECT COUNT(*) FROM pagos_gasto WHERE gasto_id = %s;", (id,))
            cnt = cur.fetchone()[0] if isinstance(cur.fetchone, list) else cur.fetchone

            # setear flag pagado según correspondan pagos restantes
            cur.execute("UPDATE gastos SET pagado = %s WHERE id = %s;", (bool(cnt), id))
        conn.close()
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error al deshacer pago: {e}")

# ----- NUEVO: listar pagos del gasto -----
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

