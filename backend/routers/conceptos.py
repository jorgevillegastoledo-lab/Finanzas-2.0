# routers/conceptos.py
from __future__ import annotations
from typing import Optional, List

import psycopg2
import psycopg2.extras
from fastapi import APIRouter, HTTPException, Query

from core.dbutils import get_conn, _fix_json  # usa los mismos helpers que en gastos.py

router = APIRouter(prefix="/conceptos", tags=["Conceptos"])

def ensure_conceptos_table(conn):
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS conceptos (
              id SERIAL PRIMARY KEY,
              nombre VARCHAR(120) NOT NULL UNIQUE,
              categoria VARCHAR(80),
              tipo_concepto VARCHAR(30) DEFAULT 'normal',
              activo BOOLEAN NOT NULL DEFAULT TRUE
            );
            """
        )
    conn.commit()

@router.get("")
def listar_conceptos(
    q: str = Query("", description="Filtro por nombre"),
    estado: str = Query("activos", regex="^(activos|todos|inactivos)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
):
    """
    GET /conceptos?q=agua&estado=activos|todos|inactivos&page=1&page_size=50
    Respuesta: { data: [...], total, page, page_size }
    """
    try:
        conn = get_conn()
        ensure_conceptos_table(conn)
        where = []
        params: List = []

        # estado
        if estado == "activos":
            where.append("c.activo = TRUE")
        elif estado == "inactivos":
            where.append("c.activo = FALSE")

        # filtro por nombre
        if q:
            where.append("UPPER(c.nombre) LIKE UPPER(%s)")
            params.append(f"%{q}%")

        where_sql = ("WHERE " + " AND ".join(where)) if where else ""
        offset = (page - 1) * page_size

        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(f"SELECT COUNT(*) AS cnt FROM conceptos c {where_sql};", params)
            total = int(cur.fetchone()["cnt"])

            cur.execute(
                f"""
                SELECT c.id, c.nombre, c.categoria, c.tipo_concepto, c.activo
                FROM conceptos c
                {where_sql}
                ORDER BY c.nombre ASC
                LIMIT %s OFFSET %s;
                """,
                params + [page_size, offset],
            )
            rows = cur.fetchall()

        conn.close()
        return {"data": _fix_json(rows), "total": total, "page": page, "page_size": page_size}
    except Exception as e:
        raise HTTPException(500, f"Error al listar conceptos: {e}")

@router.post("")
def crear_concepto(nombre: str, categoria: Optional[str] = None, tipo: Optional[str] = "normal", nota: Optional[str] = None):
    try:
        if not nombre or not nombre.strip():
            raise HTTPException(400, "Nombre requerido.")

        conn = get_conn()
        ensure_conceptos_table(conn)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO conceptos (nombre, categoria, tipo_concepto, activo)
                VALUES (%s, %s, %s, %s, TRUE)
                RETURNING id, nombre, categoria, tipo, activo;
                """,
                (nombre.strip(), categoria, tipo or "normal", nota),
            )
            row = cur.fetchone()
        conn.commit()
        conn.close()
        return {"ok": True, "data": _fix_json([row])[0]}
    except psycopg2.errors.UniqueViolation:
        raise HTTPException(409, "Ya existe un concepto con ese nombre.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error al crear concepto: {e}")

@router.put("/{id}/estado")
def cambiar_estado_concepto(id: int, activo: bool):
    try:
        conn = get_conn()
        ensure_conceptos_table(conn)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("UPDATE conceptos SET activo = %s WHERE id = %s RETURNING id;", (activo, id))
            row = cur.fetchone()
        conn.commit()
        conn.close()
        if not row:
            raise HTTPException(404, "Concepto no encontrado")
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error al cambiar estado: {e}")

