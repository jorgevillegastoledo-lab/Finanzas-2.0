# routers/gastos.py
from __future__ import annotations
from datetime import date, datetime, timedelta
from typing import Any, Dict, Optional
from calendar import monthrange

import psycopg2
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
_CIERRE_OFFSET_DIAS = 5

def _is_period_closed(mes: int, anio: int, offset_dias: int = _CIERRE_OFFSET_DIAS) -> bool:
    try:
        if not (1 <= int(mes) <= 12) or not (2000 <= int(anio) <= 2100):
            return False
        last_day = date(int(anio), int(mes), monthrange(int(anio), int(mes))[1])
        hoy = date.today()
        return hoy > (last_day + timedelta(days=offset_dias))
    except Exception:
        return False

def _raise_if_deshacer_cerrado(mes: int, anio: int):
    if _is_period_closed(mes, anio):
        m = f"El período {str(mes).zfill(2)}/{anio} está cerrado. No se puede deshacer el pago."
        raise HTTPException(status_code=409, detail=m)

def _msg_cierre(mes: int, anio: int) -> str:
    return f"El período {str(mes).zfill(2)}/{anio} está cerrado. No se permiten cambios en gastos pagados."

# ---------- Schemas ----------
class GastoIn(BaseModel):
    concepto_id: int
    monto: float
    mes: int
    anio: int
    pagado: Optional[bool] = None
    con_tarjeta: Optional[bool] = None
    tarjeta_id: Optional[int] = None
    es_recurrente: Optional[bool] = None

class GastoUpdate(BaseModel):
    # NOTA: por diseño, estos tres NO se pueden editar por PUT
    # concepto_id: Optional[int] = None
    # mes: Optional[int] = Field(default=None, ge=1, le=12)
    # anio: Optional[int] = Field(default=None, ge=2000, le=2100)
    monto: Optional[float] = None
    es_recurrente: Optional[bool] = None
    con_tarjeta: Optional[bool] = None
    tarjeta_id: Optional[int] = None
    # pagado NO va por aquí
    # pagado: Optional[bool] = None

class GastoPagarIn(BaseModel):
    fecha: Optional[date] = None
    monto: Optional[float] = None
    metodo: Optional[str] = None   # "efectivo"|"debito"|"credito"
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
                """
                SELECT
                  g.*,
                  c.nombre AS concepto_nombre   -- <- no pisamos g.nombre
                FROM gastos g
                LEFT JOIN conceptos c ON c.id = g.concepto_id
                WHERE g.mes = %s AND g.anio = %s
                ORDER BY g.id DESC;
                """,
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

        # 1) Traer el concepto y su nombre (FK + nombre NOT NULL en gastos)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT id, nombre FROM conceptos WHERE id = %s;", (body.concepto_id,))
            c = cur.fetchone()
        if not c:
            conn.close()
            raise HTTPException(
                status_code=400,
                detail="Debes seleccionar un concepto válido (Maestros → Conceptos)."
            )

        # 2) Armar datos a insertar: tomamos el payload permitido + nombre del maestro
        cols_exist = get_columns(conn, "gastos")
        data = {k: v for k, v in body.dict().items() if k in cols_exist and v is not None}

        # nombre es NOT NULL en la tabla, así que lo completamos desde conceptos
        if "nombre" in cols_exist:
            data["nombre"] = c["nombre"]

        # pagado podría venir None -> default False
        if "pagado" in cols_exist and data.get("pagado") is None:
            data["pagado"] = False

        if not data:
            conn.close()
            raise HTTPException(400, "No hay columnas válidas que insertar.")

        columns = list(data.keys())
        values = list(data.values())
        placeholders = [sql.Placeholder() for _ in columns]

        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            q = sql.SQL("INSERT INTO {t} ({c}) VALUES ({p}) RETURNING *;").format(
                t=sql.Identifier("gastos"),
                c=sql.SQL(", ").join(map(sql.Identifier, columns)),
                p=sql.SQL(", ").join(placeholders),
            )
            cur.execute(q, values)
            row = cur.fetchone()
        conn.commit()
        conn.close()
        return {"ok": True, "data": _fix_json([row])[0]}

    except psycopg2.errors.UniqueViolation:
        # Violación de uq_gastos_concepto_mes_anio
        raise HTTPException(
            status_code=409,
            detail="Ya existe ese concepto para el mismo mes y año."
        )
    except psycopg2.errors.ForeignKeyViolation:
        raise HTTPException(
            status_code=400,
            detail="El concepto o la tarjeta no existen. Revisa los datos."
        )
    except Exception as e:
        # Otros errores (incluye not_null_violation si por alguna razón faltó 'nombre')
        raise HTTPException(500, f"Error al crear gasto: {e}")


@router.put("/{id}")
def editar_gasto(id: int, body: GastoUpdate):
    """
    Reglas:
      - NO permite tocar: concepto_id, mes, anio, pagado.
      - Si el gasto ya está pagado y el período está cerrado => bloquear.
      - Campos editables: monto, es_recurrente, con_tarjeta, tarjeta_id.
    """
    try:
        conn = get_conn()
        # Traer gasto actual (para validar pago/cierre)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT id, mes, anio, pagado FROM gastos WHERE id = %s;", (id,))
            current = cur.fetchone()
        if not current:
            conn.close()
            raise HTTPException(404, "Gasto no encontrado")

        # Si ya está pagado y el período está cerrado => bloquear
        if bool(current.get("pagado")) and _is_period_closed(int(current["mes"]), int(current["anio"])):
            conn.close()
            raise HTTPException(409, _msg_cierre(int(current["mes"]), int(current["anio"])))

        incoming = body.dict(exclude_unset=True)

        # Filtrar a los únicos campos permitidos
        allowed = {"monto", "es_recurrente", "con_tarjeta", "tarjeta_id"}
        data = {k: v for k, v in incoming.items() if k in allowed}

        if not data:
            conn.close()
            raise HTTPException(400, "No hay cambios válidos para actualizar.")

        sets = [sql.SQL("{} = {}").format(sql.Identifier(k), sql.Placeholder()) for k in data.keys()]
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            q = sql.SQL("UPDATE gastos SET {sets} WHERE id = %s RETURNING *;").format(
                sets=sql.SQL(", ").join(sets)
            )
            cur.execute(q, list(data.values()) + [id])
            row = cur.fetchone()
        conn.commit()
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
        conn.commit()
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
                SELECT id, monto, pagado, con_tarjeta, tarjeta_id
                FROM gastos WHERE id = %s;
                """,
                (id,),
            )
            gasto = cur.fetchone()
        if not gasto:
            conn.close()
            raise HTTPException(404, "Gasto no encontrado")
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
            _ = cur.fetchone()
            cur.execute("UPDATE gastos SET pagado = TRUE WHERE id = %s;", (id,))
        conn.commit()
        conn.close()
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error al pagar gasto: {e}")

@router.post("/{id}/deshacer")
def deshacer_pago_gasto(id: int):
    try:
        conn = get_conn()
        ensure_pagos_gasto_table(conn)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT id, mes, anio FROM gastos WHERE id = %s;", (id,))
            g = cur.fetchone()
        if not g:
            conn.close()
            raise HTTPException(404, "Gasto no encontrado")

        _raise_if_deshacer_cerrado(int(g["mes"]), int(g["anio"]))

        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
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

            cur.execute("DELETE FROM pagos_gasto WHERE id = %s;", (last["id"],))
            cur.execute("SELECT COUNT(*) AS cnt FROM pagos_gasto WHERE gasto_id = %s;", (id,))
            cnt_row = cur.fetchone()
            restantes = int(cnt_row["cnt"]) if isinstance(cnt_row, dict) else int(cnt_row[0])
            cur.execute("UPDATE gastos SET pagado = %s WHERE id = %s;", (restantes > 0, id))
        conn.commit()
        conn.close()
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error al deshacer pago: {e}")


