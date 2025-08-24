# routers/bancos.py
from __future__ import annotations
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
import psycopg2
import psycopg2.extras
from psycopg2 import sql

from core.dbutils import get_conn, _fix_json

router = APIRouter(prefix="/bancos", tags=["Bancos"])

# ---------- Schemas ----------
class BancoIn(BaseModel):
    nombre: str  # 'activo' lo maneja la BD por defecto

class BancoUpdate(BaseModel):
    nombre: Optional[str] = None

class ActivarIn(BaseModel):
    activo: bool

# ---------- Helpers ----------
def _parse_activos_param(v: Optional[str]) -> Optional[bool]:
    if v is None or v.lower() == "all":
        return None
    if v.lower() in ("true", "1", "t", "yes", "si"):
        return True
    if v.lower() in ("false", "0", "f", "no"):
        return False
    return None

# ---------- Endpoints ----------
@router.get("")
def listar_bancos(activos: Optional[str] = Query("true", description="true|false|all")):
    try:
        conn = get_conn()
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            flt = _parse_activos_param(activos)
            if flt is None:
                cur.execute("SELECT * FROM bancos ORDER BY nombre ASC;")
            else:
                cur.execute("SELECT * FROM bancos WHERE activo = %s ORDER BY nombre ASC;", (flt,))
            rows = cur.fetchall()
        conn.close()
        return {"ok": True, "data": _fix_json(rows)}
    except Exception as e:
        raise HTTPException(500, f"Error al listar bancos: {e}")

@router.post("")
def crear_banco(body: BancoIn):
    try:
        conn = get_conn()
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            q = sql.SQL("INSERT INTO {t} (nombre) VALUES (%s) RETURNING *;").format(
                t=sql.Identifier("bancos")
            )
            try:
                cur.execute(q, (body.nombre,))
            except psycopg2.errors.UniqueViolation:
                conn.rollback()
                conn.close()
                raise HTTPException(status_code=409, detail="Ya existe un banco con ese nombre")
            row = cur.fetchone()
        conn.commit()
        conn.close()
        return {"ok": True, "data": _fix_json([row])[0]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error al crear banco: {e}")

@router.patch("/{id}")
def editar_banco(id: int, body: BancoUpdate):
    try:
        incoming = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
        if not incoming:
            raise HTTPException(400, "No hay campos para actualizar.")

        conn = get_conn()
        sets = [sql.SQL("{} = {}").format(sql.Identifier(k), sql.Placeholder()) for k in incoming.keys()]
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            q = sql.SQL("UPDATE bancos SET {sets} WHERE id = %s RETURNING *;").format(
                sets=sql.SQL(", ").join(sets)
            )
            try:
                cur.execute(q, list(incoming.values()) + [id])
            except psycopg2.errors.UniqueViolation:
                conn.rollback()
                conn.close()
                raise HTTPException(status_code=409, detail="Ya existe un banco con ese nombre")
            row = cur.fetchone()
        conn.commit()
        conn.close()
        if not row:
            raise HTTPException(404, "Banco no encontrado")
        return {"ok": True, "data": _fix_json([row])[0]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error al editar banco: {e}")

@router.patch("/{id}/activo")
def activar_banco(id: int, body: ActivarIn):
    try:
        conn = get_conn()
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("UPDATE bancos SET activo = %s WHERE id = %s RETURNING *;", (body.activo, id))
            row = cur.fetchone()
        conn.commit()
        conn.close()
        if not row:
            raise HTTPException(404, "Banco no encontrado")
        return {"ok": True, "data": _fix_json([row])[0]}
    except Exception as e:
        raise HTTPException(500, f"Error al cambiar estado: {e}")
