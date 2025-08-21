# routers/tarjetas.py
from __future__ import annotations
from datetime import date
from typing import Optional

import psycopg2.extras
from psycopg2 import sql
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.dbutils import get_conn, _fix_json, ensure_tarjeta_detalle_table

router = APIRouter(prefix="/tarjetas", tags=["Tarjetas"])

class TarjetaIn(BaseModel):
    nombre: str
    banco: Optional[str] = None
    tipo: str = Field(default="credito", pattern="^(credito|debito)$")
    limite: Optional[float] = None
    cierre_dia: Optional[int] = Field(default=None, ge=1, le=31)
    vencimiento_dia: Optional[int] = Field(default=None, ge=1, le=31)
    activa: bool = True

class TarjetaDetalleIn(BaseModel):
    alias: Optional[str] = None
    pan_last4: Optional[str] = None
    expiracion_mes: Optional[int] = Field(default=None, ge=1, le=12)
    expiracion_anio: Optional[int] = Field(default=None, ge=2000, le=2100)
    fecha_entrega: Optional[date] = None
    red: Optional[str] = None

@router.get("")
def listar_tarjetas():
    try:
        conn = get_conn()
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT id, nombre, banco, tipo, limite, cierre_dia, vencimiento_dia, activa
                FROM tarjetas
                WHERE activa = TRUE
                ORDER BY id DESC;
            """)
            rows = cur.fetchall()
        conn.close()
        return {"ok": True, "data": _fix_json(rows)}
    except Exception as e:
        raise HTTPException(500, f"Error al listar tarjetas: {e}")

@router.post("")
def crear_tarjeta(body: TarjetaIn):
    try:
        conn = get_conn()
        cols = ["nombre","banco","tipo","limite","cierre_dia","vencimiento_dia","activa"]
        vals = [body.nombre, body.banco, body.tipo, body.limite, body.cierre_dia, body.vencimiento_dia, body.activa]
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            q = sql.SQL("INSERT INTO tarjetas ({f}) VALUES ({p}) RETURNING *;").format(
                f=sql.SQL(", ").join(map(sql.Identifier, cols)),
                p=sql.SQL(", ").join([sql.Placeholder()]*len(cols)),
            )
            cur.execute(q, vals)
            row = cur.fetchone()
        conn.close()
        return {"ok": True, "data": _fix_json([row])[0]}
    except Exception as e:
        raise HTTPException(500, f"Error al crear tarjeta: {e}")

@router.put("/{id}")
def editar_tarjeta(id: int, body: TarjetaIn):
    try:
        conn = get_conn()
        data = body.dict()
        sets = [sql.SQL("{} = {}").format(sql.Identifier(k), sql.Placeholder()) for k in data.keys()]
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            q = sql.SQL("UPDATE tarjetas SET {sets} WHERE id = %s RETURNING *;").format(
                sets=sql.SQL(", ").join(sets)
            )
            cur.execute(q, list(data.values()) + [id])
            row = cur.fetchone()
        conn.close()
        if not row: raise HTTPException(404, "Tarjeta no encontrada")
        return {"ok": True, "data": _fix_json([row])[0]}
    except Exception as e:
        raise HTTPException(500, f"Error al editar tarjeta: {e}")

@router.delete("/{id}")
def eliminar_tarjeta(id: int):
    try:
        conn = get_conn()
        with conn.cursor() as cur:
            cur.execute("UPDATE tarjetas SET activa = FALSE WHERE id = %s;", (id,))
        conn.close()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, f"Error al eliminar tarjeta: {e}")

# --------- Detalle tarjeta ---------
@router.get("/{id}/detalle")
def get_tarjeta_detalle(id: int):
    try:
        conn = get_conn()
        ensure_tarjeta_detalle_table(conn)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT id, tarjeta_id, alias, pan_last4, expiracion_mes, expiracion_anio,
                       fecha_entrega, red, created_at, updated_at
                FROM tarjeta_detalle
                WHERE tarjeta_id=%s;
            """, (id,))
            row = cur.fetchone()
        conn.close()
        return {"ok": True, "data": _fix_json([row])[0] if row else {}}
    except Exception as e:
        raise HTTPException(500, f"Error al leer detalle: {e}")

@router.put("/{id}/detalle")
def upsert_tarjeta_detalle(id: int, body: TarjetaDetalleIn):
    try:
        conn = get_conn()
        ensure_tarjeta_detalle_table(conn)

        data = body.dict(exclude_unset=True)
        # normalizaciones
        if "pan_last4" in data and data["pan_last4"]:
            s = "".join(ch for ch in str(data["pan_last4"]) if ch.isdigit())
            data["pan_last4"] = s[:4] if s else None
        if "red" in data and data["red"]:
            r = str(data["red"]).strip().lower()
            if r in {"master", "master-card", "master card", "mc"}: r = "mastercard"
            if r in {"american express", "american-express", "ax"}: r = "amex"
            if r in {"otro","other"}: r = "otra"
            if r not in {"visa","mastercard","amex","otra"}: r = None
            data["red"] = r

        cols = list(data.keys())
        placeholders = [sql.Placeholder() for _ in cols]
        updates = [sql.SQL("{} = EXCLUDED.{}").format(sql.Identifier(c), sql.Identifier(c)) for c in cols]
        updates.append(sql.SQL("updated_at = NOW()"))

        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            q = sql.SQL("""
                INSERT INTO tarjeta_detalle (tarjeta_id, {cols})
                VALUES (%s, {ph})
                ON CONFLICT (tarjeta_id) DO UPDATE SET
                {up}
                RETURNING *;
            """).format(
                cols=sql.SQL(", ").join(map(sql.Identifier, cols)),
                ph=sql.SQL(", ").join(placeholders),
                up=sql.SQL(", ").join(updates),
            )
            cur.execute(q, [id, *[data[c] for c in cols]])
            row = cur.fetchone()
        conn.close()
        return {"ok": True, "data": _fix_json([row])[0] if row else None}
    except Exception as e:
        raise HTTPException(500, f"Error al guardar detalle: {e}")

@router.delete("/{id}/detalle")
def delete_tarjeta_detalle(id: int):
    try:
        conn = get_conn()
        ensure_tarjeta_detalle_table(conn)
        with conn.cursor() as cur:
            cur.execute("DELETE FROM tarjeta_detalle WHERE tarjeta_id=%s;", (id,))
        conn.close()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, f"Error al eliminar detalle: {e}")
