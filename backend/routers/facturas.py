# routers/facturas.py
from __future__ import annotations
from datetime import date
from typing import Any, List, Optional, Dict

import psycopg2.extras
from psycopg2 import sql
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from core.dbutils import (
    get_conn, _fix_json, ensure_facturas_table, ensure_factura_detalle_table
)

router = APIRouter(prefix="/facturas", tags=["Facturas"])

# --------- Schemas ---------
class FacturaIn(BaseModel):
    tarjeta_id: int
    mes: int = Field(ge=1, le=12)
    anio: int = Field(ge=2000, le=2100)
    total: float = Field(ge=0)

class FacturaUpdate(BaseModel):
    tarjeta_id: Optional[int] = None
    mes: Optional[int] = Field(default=None, ge=1, le=12)
    anio: Optional[int] = Field(default=None, ge=2000, le=2100)
    total: Optional[float] = Field(default=None, ge=0)
    pagada: Optional[bool] = None
    fecha_pago: Optional[date] = None

class FacturaPagoIn(BaseModel):
    monto_pagado: Optional[float] = None
    fecha_pago: Optional[date] = None

class FacturaDetalleIn(BaseModel):
    fecha_emision: Optional[date] = None
    fecha_vencimiento: Optional[date] = None
    pago_minimo: Optional[float] = None
    monto_pagado: Optional[float] = None
    nro_estado: Optional[str] = None
    nota: Optional[str] = None

# --------- Listar / crear / editar / eliminar ---------
@router.get("")
def listar_facturas(
    tarjeta_id: Optional[int] = None,
    mes: Optional[int] = Query(None, ge=1, le=12),
    anio: Optional[int] = Query(None, ge=2000, le=2100),
):
    try:
        conn = get_conn()
        ensure_facturas_table(conn)
        where = ["1=1"]; params: List[Any] = []
        if tarjeta_id is not None:
            where.append("f.tarjeta_id = %s"); params.append(tarjeta_id)
        if mes is not None:
            where.append("f.mes = %s"); params.append(mes)
        if anio is not None:
            where.append("f.anio = %s"); params.append(anio)
        q = f"""
            SELECT f.id, f.tarjeta_id, t.nombre AS tarjeta, t.banco,
                   f.mes, f.anio, f.total, f.pagada, f.fecha_pago, f.created_at
            FROM facturas f
            LEFT JOIN tarjetas t ON t.id = f.tarjeta_id
            WHERE {' AND '.join(where)}
            ORDER BY f.anio DESC, f.mes DESC, f.id DESC;
        """
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(q, params)
            rows = cur.fetchall()
        conn.close()
        return {"ok": True, "data": _fix_json(rows)}
    except Exception as e:
        raise HTTPException(500, f"Error al listar facturas: {e}")

@router.post("")
def crear_factura(body: FacturaIn):
    try:
        conn = get_conn()
        ensure_facturas_table(conn)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO facturas (tarjeta_id, mes, anio, total)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (tarjeta_id, mes, anio)
                DO UPDATE SET total = EXCLUDED.total, created_at = NOW()
                RETURNING *;
            """, (body.tarjeta_id, body.mes, body.anio, body.total))
            row = cur.fetchone()
        conn.close()
        return {"ok": True, "data": _fix_json([row])[0]}
    except Exception as e:
        raise HTTPException(500, f"Error al crear/actualizar factura: {e}")

@router.put("/{id}")
def editar_factura(id: int, body: FacturaUpdate):
    try:
        conn = get_conn()
        ensure_facturas_table(conn)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM facturas WHERE id=%s;", (id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(404, "Factura no encontrada")

        data = body.dict(exclude_unset=True)
        if "pagada" in data:
            if data["pagada"] and not data.get("fecha_pago"):
                data["fecha_pago"] = date.today()
            if data["pagada"] is False:
                data["fecha_pago"] = None
        if not data:
            return {"ok": True}

        sets = [sql.SQL("{} = {}").format(sql.Identifier(k), sql.Placeholder()) for k in data.keys()]
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            q = sql.SQL("UPDATE facturas SET {sets} WHERE id = %s RETURNING *;").format(
                sets=sql.SQL(", ").join(sets)
            )
            cur.execute(q, list(data.values()) + [id])
            row2 = cur.fetchone()
        conn.close()
        return {"ok": True, "data": _fix_json([row2])[0]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error al editar factura: {e}")

@router.delete("/{id}")
def eliminar_factura(id: int):
    try:
        conn = get_conn()
        ensure_facturas_table(conn)
        with conn.cursor() as cur:
            cur.execute("DELETE FROM facturas WHERE id = %s;", (id,))
        conn.close()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, f"Error al eliminar factura: {e}")

# --------- Pagar / Deshacer (idempotentes) ---------
@router.post("/{id}/pagar")
def marcar_pagada(id: int, body: FacturaPagoIn):
    """Marca la factura como pagada (si ya lo está -> 409)."""
    try:
        conn = get_conn()
        ensure_facturas_table(conn)
        ensure_factura_detalle_table(conn)

        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT pagada FROM facturas WHERE id=%s;", (id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(404, "Factura no encontrada")
            if row["pagada"]:
                raise HTTPException(409, "La factura ya está pagada.")

        pago_fecha = body.fecha_pago or date.today()
        with conn.cursor() as cur:
            cur.execute("UPDATE facturas SET pagada=TRUE, fecha_pago=%s WHERE id=%s;", (pago_fecha, id))
            cur.execute("""
                INSERT INTO factura_detalle (factura_id, monto_pagado, updated_at)
                VALUES (%s, %s, NOW())
                ON CONFLICT (factura_id) DO UPDATE SET
                  monto_pagado = EXCLUDED.monto_pagado,
                  updated_at = NOW();
            """, (id, body.monto_pagado))
        conn.close()
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error al registrar pago: {e}")

@router.post("/{id}/deshacer")
def deshacer_pago(id: int):
    """Quita el pago si hoy está pagada (si no -> 409)."""
    try:
        conn = get_conn()
        ensure_facturas_table(conn)
        ensure_factura_detalle_table(conn)

        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT pagada FROM facturas WHERE id=%s;", (id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(404, "Factura no encontrada")
            if not row["pagada"]:
                raise HTTPException(409, "La factura no está pagada.")

        with conn.cursor() as cur:
            cur.execute("UPDATE facturas SET pagada=FALSE, fecha_pago=NULL WHERE id=%s;", (id,))
            cur.execute("UPDATE factura_detalle SET monto_pagado=NULL, updated_at=NOW() WHERE factura_id=%s;", (id,))
        conn.close()
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error al deshacer pago: {e}")

# --------- Detalle ---------
@router.get("/{id}/detalle")
def get_factura_detalle(id: int):
    try:
        conn = get_conn()
        ensure_factura_detalle_table(conn)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM factura_detalle WHERE factura_id=%s;", (id,))
            row = cur.fetchone()
        conn.close()
        return {"ok": True, "data": _fix_json([row])[0] if row else {}}
    except Exception as e:
        raise HTTPException(500, f"Error al leer detalle: {e}")

@router.put("/{id}/detalle")
def upsert_factura_detalle(id: int, body: FacturaDetalleIn):
    try:
        conn = get_conn()
        ensure_factura_detalle_table(conn)
        data: Dict[str, Any] = {k: v for k, v in body.dict(exclude_unset=True).items()}
        for k in list(data.keys()):
            if isinstance(data[k], str) and data[k].strip() == "":
                data[k] = None
        cols = list(data.keys())
        placeholders = [sql.Placeholder() for _ in cols]
        update_pairs = [sql.SQL("{} = EXCLUDED.{}").format(sql.Identifier(c), sql.Identifier(c)) for c in cols]
        update_pairs.append(sql.SQL("updated_at = NOW()"))

        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            q = sql.SQL("""
                INSERT INTO factura_detalle (factura_id, {cols})
                VALUES (%s, {ph})
                ON CONFLICT (factura_id) DO UPDATE SET
                {up}
                RETURNING *;
            """).format(
                cols=sql.SQL(", ").join(map(sql.Identifier, cols)) if cols else sql.SQL("factura_id"),
                ph=sql.SQL(", ").join(placeholders) if cols else sql.SQL("%s"),
                up=sql.SQL(", ").join(update_pairs) if cols else sql.SQL("updated_at = NOW()")
            )
            cur.execute(q, [id, *[data[c] for c in cols]] if cols else [id, id])
            row = cur.fetchone()
        conn.close()
        return {"ok": True, "data": _fix_json([row])[0] if row else {}}
    except Exception as e:
        raise HTTPException(500, f"Error al guardar detalle: {e}")

@router.delete("/{id}/detalle")
def delete_factura_detalle(id: int):
    try:
        conn = get_conn()
        ensure_factura_detalle_table(conn)
        with conn.cursor() as cur:
          cur.execute("DELETE FROM factura_detalle WHERE factura_id=%s;", (id,))
        conn.close()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, f"Error al eliminar detalle: {e}")


