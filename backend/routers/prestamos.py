# routers/prestamos.py
from __future__ import annotations
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional
from psycopg2.errors import UniqueViolation

import psycopg2.extras
from psycopg2 import sql
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from core.dbutils import (
    get_conn, _fix_json, get_columns, get_column_type, NUMERIC_TYPES,
    ensure_pagos_prestamo_table, ensure_prestamo_detalle_support,
    recompute_prestamo_totales
)

router = APIRouter(prefix="/prestamos", tags=["Préstamos"])

# -------------------------- Parámetros de negocio --------------------------
Cierre_OFFSET_DIAS = 5  # fin de mes + 5 días

def _ultimo_dia_mes(anio: int, mes: int) -> date:
    """Devuelve el último día del mes (1..12) del año dado."""
    if mes == 12:
        first_next = date(anio + 1, 1, 1)
    else:
        first_next = date(anio, mes + 1, 1)
    return first_next - timedelta(days=1)

def _periodo_cerrado(mes: int, anio: int, hoy: Optional[date] = None) -> bool:
    """
    Cierre contable: un período (mes/año) queda cerrado al finalizar
    el último día del mes + Cierre_OFFSET_DIAS (inclusive).
    """
    hoy = hoy or date.today()
    cierre = _ultimo_dia_mes(anio, mes) + timedelta(days=Cierre_OFFSET_DIAS)
    return hoy > cierre

def _ensure_prestamos_soft_delete(conn) -> None:
    """Crea columnas de soft delete si no existen."""
    with conn.cursor() as cur:
        cur.execute("""
            ALTER TABLE prestamos
            ADD COLUMN IF NOT EXISTS anulado BOOLEAN NOT NULL DEFAULT FALSE;
        """)
        cur.execute("""
            ALTER TABLE prestamos
            ADD COLUMN IF NOT EXISTS fecha_anulacion TIMESTAMP WITHOUT TIME ZONE NULL;
        """)
        cur.execute("""
            ALTER TABLE prestamos
            ADD COLUMN IF NOT EXISTS motivo_anulacion TEXT NULL;
        """)

# -------------------------- Schemas --------------------------
class PrestamoIn(BaseModel):
    nombre: str
    valor_cuota: float = Field(gt=0)
    cuotas_totales: int = Field(gt=0)
    cuotas_pagadas: Optional[int] = 0
    primer_mes: Optional[int] = Field(default=None, ge=1, le=12)
    primer_anio: Optional[int] = Field(default=None, ge=2000, le=2100)
    dia_vencimiento: Optional[int] = Field(default=None, ge=1, le=31)
    banco: Optional[str] = None

class PagoPrestamoIn(BaseModel):
    mes_contable: int = Field(ge=1, le=12)
    anio_contable: int = Field(ge=2000, le=2100)
    monto_pagado: Optional[float] = None

class PrestamoDetalleIn(BaseModel):
    banco: Optional[str] = None
    numero_contrato: Optional[str] = None
    fecha_otorgamiento: Optional[date] = None
    monto_original: Optional[float] = None
    moneda: Optional[str] = None
    plazo_meses: Optional[int] = Field(default=None, ge=1, le=600)
    dia_vencimiento: Optional[int] = Field(default=None, ge=1, le=31)
    tasa_interes_anual: Optional[float] = None
    tipo_tasa: Optional[str] = None
    indice_reajuste: Optional[str] = None
    primera_cuota: Optional[date] = None
    ejecutivo_nombre: Optional[str] = None
    ejecutivo_email: Optional[str] = None
    ejecutivo_fono: Optional[str] = None
    seguro_desgravamen: Optional[bool] = None
    seguro_cesantia: Optional[bool] = None
    costo_seguro_mensual: Optional[float] = None
    comision_administracion: Optional[float] = None
    prepago_permitido: Optional[bool] = None
    prepago_costo: Optional[float] = None
    garantia_tipo: Optional[str] = None
    garantia_descripcion: Optional[str] = None
    garantia_hasta: Optional[date] = None
    tags: Optional[str] = None
    nota: Optional[str] = None
    liquido_recibido: Optional[float] = None
    gastos_iniciales_total: Optional[float] = None

class AnularPrestamoIn(BaseModel):
    motivo: Optional[str] = None

# -------------------------- Endpoints --------------------------
@router.get("")
def listar_prestamos():
    try:
        conn = get_conn()
        _ensure_prestamos_soft_delete(conn)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM prestamos WHERE COALESCE(anulado, FALSE) = FALSE ORDER BY id;")
            rows = cur.fetchall()
        conn.close()
        return {"ok": True, "data": _fix_json(rows)}
    except Exception as e:
        raise HTTPException(500, f"Error al cargar préstamos: {e}")

@router.post("")
def crear_prestamo(body: PrestamoIn):
    try:
        conn = get_conn()
        _ensure_prestamos_soft_delete(conn)
        cols = get_columns(conn, "prestamos")
        data = {
            "nombre": body.nombre,
            "valor_cuota": body.valor_cuota,
            "cuotas_totales": body.cuotas_totales,
            "cuotas_pagadas": body.cuotas_pagadas or 0,
            "primer_mes": body.primer_mes,
            "primer_anio": body.primer_anio,
            "dia_vencimiento": body.dia_vencimiento,
            "banco": body.banco,
        }
        data = {k: v for k, v in data.items() if k in cols and v is not None}
        if "monto_total" in cols:
            data["monto_total"] = body.valor_cuota * body.cuotas_totales
        if "pagado" in cols:
            t = get_column_type(conn, "prestamos", "pagado")
            if t and t.lower() in NUMERIC_TYPES:
                data["pagado"] = (body.valor_cuota * (body.cuotas_pagadas or 0))
            elif t and t.lower() == "boolean":
                data["pagado"] = (body.cuotas_pagadas or 0) >= body.cuotas_totales
        if "deuda_restante" in cols:
            cuotas_pag = int(body.cuotas_pagadas or 0)
            deuda = (body.valor_cuota * body.cuotas_totales) - (body.valor_cuota * cuotas_pag)
            data["deuda_restante"] = max(deuda, 0)
        columns = list(data.keys())
        values  = list(data.values())
        placeholders = [sql.Placeholder() for _ in columns]
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            q = sql.SQL("INSERT INTO {t} ({c}) VALUES ({p}) RETURNING *;").format(
                t=sql.Identifier("prestamos"),
                c=sql.SQL(", ").join(map(sql.Identifier, columns)),
                p=sql.SQL(", ").join(placeholders),
            )
            cur.execute(q, values)
            row = cur.fetchone()
        recompute_prestamo_totales(conn, row["id"])
        conn.close()
        return {"ok": True, "data": _fix_json([row])[0]}
    except Exception as e:
        raise HTTPException(500, f"Error al crear préstamo: {e}")

@router.put("/{id}")
def editar_prestamo(id: int, body: PrestamoIn):
    try:
        conn = get_conn()
        _ensure_prestamos_soft_delete(conn)
        # Bloqueo de cambios sensibles si ya hay pagos:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM pagos_prestamo WHERE prestamo_id=%s;", (id,))
            pagos = cur.fetchone()[0]
        cols = get_columns(conn, "prestamos")
        incoming = {k: v for k, v in body.dict().items() if k in cols}
        if not incoming:
            raise HTTPException(400, "No hay columnas válidas que actualizar.")
        if pagos > 0:
            for k in ("valor_cuota", "cuotas_totales", "primer_mes", "primer_anio"):
                if k in incoming and incoming[k] is not None:
                    raise HTTPException(409, "No puedes editar valor de cuota, cuotas totales ni fecha inicial en un préstamo con pagos.")
        sets = [sql.SQL("{} = {}").format(sql.Identifier(k), sql.Placeholder()) for k in incoming.keys()]
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            q = sql.SQL("UPDATE prestamos SET {sets} WHERE id = %s RETURNING *;").format(
                sets=sql.SQL(", ").join(sets)
            )
            cur.execute(q, list(incoming.values()) + [id])
            row = cur.fetchone()
        recompute_prestamo_totales(conn, id)
        conn.close()
        if not row: 
            raise HTTPException(404, "Préstamo no encontrado")
        return {"ok": True, "data": _fix_json([row])[0]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error al editar préstamo: {e}")
        
@router.post("/{id}/pagar")
def marcar_pago_prestamo(id: int, body: PagoPrestamoIn):
    try:
        conn = get_conn()
        _ensure_prestamos_soft_delete(conn)
        ensure_pagos_prestamo_table(conn)

        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT valor_cuota, COALESCE(anulado,FALSE) AS anulado FROM prestamos WHERE id = %s;", (id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(404, "Préstamo no encontrado")
            if row["anulado"]:
                raise HTTPException(409, "No puedes registrar pagos en un préstamo anulado.")
            default_cuota = float(row["valor_cuota"] or 0)

        monto = body.monto_pagado if body.monto_pagado is not None else default_cuota

        try:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO pagos_prestamo (prestamo_id, mes_contable, anio_contable, valor_cuota)
                    VALUES (%s, %s, %s, %s);
                """, (id, body.mes_contable, body.anio_contable, monto))
        except UniqueViolation:
            raise HTTPException(status_code=409, detail="Ya existe un pago para ese mes/año.")

        recompute_prestamo_totales(conn, id)
        conn.close()
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error al registrar pago: {e}")   

@router.put("/{id}/pagar")
def marcar_pago_prestamo_put(id: int, body: PagoPrestamoIn):
    return marcar_pago_prestamo(id, body)

@router.post("/{id}/deshacer")
def deshacer_pago_prestamo(id: int):
    """
    Elimina el **último** pago registrado del préstamo (orden por año, mes, id DESC).
    Respeta el cierre contable (fin de mes + 5 días) del período del último pago.
    """
    try:
        conn = get_conn()
        _ensure_prestamos_soft_delete(conn)
        ensure_pagos_prestamo_table(conn)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT id, mes_contable, anio_contable
                FROM pagos_prestamo
                WHERE prestamo_id=%s
                ORDER BY anio_contable DESC, mes_contable DESC, id DESC
                LIMIT 1;
            """, (id,))
            last = cur.fetchone()
            if not last:
                raise HTTPException(400, "No hay pagos para deshacer.")
            if _periodo_cerrado(int(last["mes_contable"]), int(last["anio_contable"])):
                mes = int(last["mes_contable"]); anio = int(last["anio_contable"])
                raise HTTPException(409, f"El período {mes:02d}/{anio} está cerrado (fin de mes + {Cierre_OFFSET_DIAS} días). No se puede deshacer.")

            cur.execute("DELETE FROM pagos_prestamo WHERE id = %s;", (last["id"],))
        recompute_prestamo_totales(conn, id)
        conn.close()
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error al deshacer pago: {e}")

@router.get("/{id}/pagos")
def listar_pagos_prestamo(
    id: int,
    mes: Optional[int] = Query(None, ge=1, le=12),
    anio: Optional[int] = Query(None, ge=2000, le=2100),
):
    try:
        conn = get_conn()
        _ensure_prestamos_soft_delete(conn)
        ensure_pagos_prestamo_table(conn)
        where = ["prestamo_id = %s"]
        params: List[Any] = [id]
        if mes is not None:
            where.append("mes_contable = %s"); params.append(mes)
        if anio is not None:
            where.append("anio_contable = %s"); params.append(anio)
        q = f"""
            SELECT id, prestamo_id, mes_contable, anio_contable, valor_cuota, fecha_pago
            FROM pagos_prestamo
            WHERE {' AND '.join(where)}
            ORDER BY anio_contable DESC, mes_contable DESC, id DESC;
        """
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(q, params)
            rows = cur.fetchall()
        conn.close()
        return {"ok": True, "data": _fix_json(rows)}
    except Exception as e:
        raise HTTPException(500, f"Error al listar pagos: {e}")

@router.get("/resumen")
def listar_prestamos_resumen():
    try:
        conn = get_conn()
        _ensure_prestamos_soft_delete(conn)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT
                  p.id, p.nombre, p.valor_cuota, p.cuotas_totales,
                  COALESCE(p.cuotas_pagadas, 0) AS cuotas_pagadas,
                  p.primer_mes, p.primer_anio, p.banco,
                  COALESCE(agg.total_pagado, 0) AS total_pagado,
                  (p.valor_cuota * p.cuotas_totales) - COALESCE(agg.total_pagado, 0) AS deuda_restante,
                  up.mes_contable  AS ultimo_mes,
                  up.anio_contable AS ultimo_anio
                FROM prestamos p
                LEFT JOIN LATERAL (
                    SELECT SUM(pp.valor_cuota) AS total_pagado
                    FROM pagos_prestamo pp
                    WHERE pp.prestamo_id = p.id
                ) agg ON TRUE
                LEFT JOIN LATERAL (
                    SELECT pp2.mes_contable, pp2.anio_contable
                    FROM pagos_prestamo pp2
                    WHERE pp2.prestamo_id = p.id
                    ORDER BY pp2.anio_contable DESC, pp2.mes_contable DESC, pp2.id DESC
                    LIMIT 1
                ) up ON TRUE
                WHERE COALESCE(p.anulado, FALSE) = FALSE
                ORDER BY p.id;
            """)
            rows = cur.fetchall()
        conn.close()
        return {"ok": True, "data": _fix_json(rows)}
    except Exception as e:
        raise HTTPException(500, f"Error al cargar resumen de préstamos: {e}")

@router.delete("/{id}")
def eliminar_prestamo(id: int, motivo: Optional[str] = Query(None, description="Motivo (opcional)")):
    """
    Soft delete: permite anular SOLO si no existen pagos.
    Si existen pagos -> 409 (sugerir 'cerrar anticipadamente').
    """
    try:
        conn = get_conn()
        _ensure_prestamos_soft_delete(conn)
        ensure_pagos_prestamo_table(conn)
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM pagos_prestamo WHERE prestamo_id = %s;", (id,))
            pagos = cur.fetchone()[0]
            if pagos and int(pagos) > 0:
                raise HTTPException(409, "No se puede eliminar un préstamo con pagos. Usa 'Cerrar anticipadamente'.")
            cur.execute("""
                UPDATE prestamos
                SET anulado = TRUE, fecha_anulacion = NOW(), motivo_anulacion = %s
                WHERE id = %s;
            """, (motivo, id))
            if cur.rowcount == 0:
                raise HTTPException(404, "Préstamo no encontrado")
        conn.close()
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error al anular préstamo: {e}")

# --------- Alias explícito para anular (mejor semántica desde el front) ----------
@router.post("/{id}/anular")
def anular_prestamo(id: int, body: AnularPrestamoIn):
    return eliminar_prestamo(id, motivo=body.motivo)

# --------- Cerrar anticipadamente (si hay pagos) ----------
@router.post("/{id}/cerrar-anticipado")
def cerrar_anticipado(id: int):
    """
    Ajusta el préstamo a lo efectivamente pagado:
      - cuotas_totales = cuotas_pagadas
      - deuda_restante = 0 (si existe)
      - pagado = TRUE (si columna es booleana)
    No borra pagos.
    """
    try:
        conn = get_conn()
        _ensure_prestamos_soft_delete(conn)
        ensure_pagos_prestamo_table(conn)
        with conn.cursor() as cur:
            cur.execute("""
                SELECT COALESCE(SUM(valor_cuota),0), COUNT(*)
                FROM pagos_prestamo WHERE prestamo_id=%s;
            """, (id,))
            total_pagado, cuotas_pag = cur.fetchone()
            if int(cuotas_pag) == 0:
                raise HTTPException(409, "No hay pagos registrados. Para eliminar usa 'Anular préstamo'.")
        # Actualizar estructura
        cols = get_columns(conn, "prestamos")
        sets = ["cuotas_totales = %s"]
        params: List[Any] = [int(cuotas_pag)]
        if "deuda_restante" in cols:
            sets.append("deuda_restante = %s"); params.append(0)
        if "pagado" in cols:
            t = get_column_type(conn, "prestamos", "pagado")
            if t and t.lower() == "boolean":
                sets.append("pagado = %s"); params.append(True)
        with conn.cursor() as cur:
            cur.execute(f"UPDATE prestamos SET {', '.join(sets)} WHERE id = %s;", params + [id])
        recompute_prestamo_totales(conn, id)
        conn.close()
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error al cerrar anticipadamente: {e}")

# ------------------- Detalle de préstamo (1:1) -------------------
@router.get("/{id}/detalle")
def get_prestamo_detalle(id: int):
    try:
        conn = get_conn()
        ensure_prestamo_detalle_support(conn)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM prestamo_detalle WHERE prestamo_id=%s;", (id,))
            row = cur.fetchone()
        conn.close()
        return {"ok": True, "data": _fix_json([row])[0] if row else {}}
    except Exception as e:
        raise HTTPException(500, f"Error al leer detalle del préstamo: {e}")

@router.put("/{id}/detalle")
def upsert_prestamo_detalle(id: int, body: PrestamoDetalleIn):
    try:
        conn = get_conn()
        ensure_prestamo_detalle_support(conn)

        cols_exist = get_columns(conn, "prestamo_detalle")
        if not cols_exist:
            raise HTTPException(500, "Tabla prestamo_detalle no existe.")

        data = {k: v for k, v in body.dict(exclude_unset=True).items() if k in cols_exist}
        for k in ("id", "prestamo_id", "created_at", "updated_at"):
            data.pop(k, None)

        if not data:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("""
                    INSERT INTO prestamo_detalle (prestamo_id)
                    VALUES (%s)
                    ON CONFLICT (prestamo_id) DO NOTHING
                    RETURNING *;
                """, (id,))
                row = cur.fetchone()
                if not row:
                    cur.execute("SELECT * FROM prestamo_detalle WHERE prestamo_id=%s;", (id,))
                    row = cur.fetchone()
            conn.close()
            return {"ok": True, "data": _fix_json([row])[0] if row else {}}

        columns = list(data.keys())
        placeholders = [sql.Placeholder() for _ in columns]
        update_pairs = [sql.SQL("{} = EXCLUDED.{}").format(sql.Identifier(c), sql.Identifier(c)) for c in columns]
        update_pairs.append(sql.SQL("updated_at = NOW()"))

        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            q = sql.SQL("""
                INSERT INTO prestamo_detalle (prestamo_id, {cols})
                VALUES (%s, {ph})
                ON CONFLICT (prestamo_id) DO UPDATE SET
                {up}
                RETURNING *;
            """).format(
                cols=sql.SQL(", ").join(map(sql.Identifier, columns)),
                ph=sql.SQL(", ").join(placeholders),
                up=sql.SQL(", ").join(update_pairs),
            )
            cur.execute(q, [id, *list(data.values())])
            row = cur.fetchone()
        conn.close()
        return {"ok": True, "data": _fix_json([row])[0]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error al guardar detalle del préstamo: {e}")

@router.delete("/{id}/detalle")
def delete_prestamo_detalle(id: int):
    try:
        conn = get_conn()
        ensure_prestamo_detalle_support(conn)
        with conn.cursor() as cur:
            cur.execute("DELETE FROM prestamo_detalle WHERE prestamo_id=%s;", (id,))
        conn.close()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, f"Error al eliminar detalle del préstamo: {e}")
