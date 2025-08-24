# routers/conceptos.py
from __future__ import annotations
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
import psycopg2
import psycopg2.extras
from psycopg2 import sql

from core.dbutils import get_conn, _fix_json

router = APIRouter(prefix="/conceptos", tags=["Conceptos"])

# ---------- Schemas ----------
class ConceptoIn(BaseModel):
    nombre: str
    categoria: Optional[str] = None
    tipo_concepto: Optional[str] = "normal"  # 'normal' | 'esporadico' | 'suscripcion'
    # 'activo' lo maneja la BD por default

class ConceptoUpdate(BaseModel):
    nombre: Optional[str] = None
    categoria: Optional[str] = None
    tipo_concepto: Optional[str] = None

class ActivarIn(BaseModel):
    activo: bool

# ---------- Helpers ----------
def _parse_activos_param(v: Optional[str]) -> Optional[bool]:
    """
    Convierte el query param 'activos' a bool/None:
      - 'true'  -> True
      - 'false' -> False
      - 'all' / None -> None (no filtra)
    """
    if v is None or v.lower() == "all":
        return None
    if v.lower() in ("true", "1", "t", "yes", "si"):
        return True
    if v.lower() in ("false", "0", "f", "no"):
        return False
    return None

# ---------- Endpoints ----------
@router.get("")
def listar_conceptos(activos: Optional[str] = Query("true", description="true|false|all")):
    try:
        conn = get_conn()
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            flt = _parse_activos_param(activos)
            if flt is None:
                cur.execute("SELECT * FROM conceptos ORDER BY nombre ASC;")
            else:
                cur.execute("SELECT * FROM conceptos WHERE activo = %s ORDER BY nombre ASC;", (flt,))
            rows = cur.fetchall()
        conn.close()
        return {"ok": True, "data": _fix_json(rows)}
    except Exception as e:
        raise HTTPException(500, f"Error al listar conceptos: {e}")

@router.post("")
def crear_concepto(body: ConceptoIn):
    try:
        conn = get_conn()
        columns = ["nombre", "categoria", "tipo_concepto"]
        values = [body.nombre, body.categoria, body.tipo_concepto]
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            q = sql.SQL("INSERT INTO {t} ({c}) VALUES ({p}) RETURNING *;").format(
                t=sql.Identifier("conceptos"),
                c=sql.SQL(", ").join(map(sql.Identifier, columns)),
                p=sql.SQL(", ").join(sql.Placeholder() for _ in columns),
            )
            try:
                cur.execute(q, values)
            except psycopg2.errors.UniqueViolation:
                conn.rollback()
                conn.close()
                raise HTTPException(status_code=409, detail="Ya existe un concepto con ese nombre")
            row = cur.fetchone()
        conn.commit()
        conn.close()
        return {"ok": True, "data": _fix_json([row])[0]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error al crear concepto: {e}")

@router.patch("/{id}")
def editar_concepto(id: int, body: ConceptoUpdate):
    try:
        incoming = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
        if not incoming:
            raise HTTPException(400, "No hay campos para actualizar.")

        conn = get_conn()
        sets = [sql.SQL("{} = {}").format(sql.Identifier(k), sql.Placeholder()) for k in incoming.keys()]
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            q = sql.SQL("UPDATE conceptos SET {sets} WHERE id = %s RETURNING *;").format(
                sets=sql.SQL(", ").join(sets)
            )
            try:
                cur.execute(q, list(incoming.values()) + [id])
            except psycopg2.errors.UniqueViolation:
                conn.rollback()
                conn.close()
                raise HTTPException(status_code=409, detail="Ya existe un concepto con ese nombre")
            row = cur.fetchone()
        conn.commit()
        conn.close()
        if not row:
            raise HTTPException(404, "Concepto no encontrado")
        return {"ok": True, "data": _fix_json([row])[0]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error al editar concepto: {e}")

@router.patch("/{id}/activo")
def activar_concepto(id: int, body: ActivarIn):
    try:
        conn = get_conn()
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("UPDATE conceptos SET activo = %s WHERE id = %s RETURNING *;", (body.activo, id))
            row = cur.fetchone()
        conn.commit()
        conn.close()
        if not row:
            raise HTTPException(404, "Concepto no encontrado")
        return {"ok": True, "data": _fix_json([row])[0]}
    except Exception as e:
        raise HTTPException(500, f"Error al cambiar estado: {e}")
