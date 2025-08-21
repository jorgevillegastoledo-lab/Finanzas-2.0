# routes/tarjetas_detalle.py
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, conint, constr
from typing import Optional
from datetime import date
import psycopg
from psycopg.rows import dict_row

# ajusta este import a tu proyecto
from db import get_conn  # debe devolver una conexión psycopg

router = APIRouter(prefix="/tarjetas", tags=["tarjetas"])

class DetalleIn(BaseModel):
    alias: Optional[str] = None
    pan_last4: Optional[constr(min_length=4, max_length=4)] = None
    expiracion_mes: Optional[conint(ge=1, le=12)] = None
    expiracion_anio: Optional[conint(ge=2000, le=2100)] = None
    fecha_entrega: Optional[date] = None
    red: Optional[str] = None

@router.get("/{tarjeta_id}/detalle")
def get_detalle(tarjeta_id: int, conn: psycopg.Connection = Depends(get_conn)):
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT id, tarjeta_id, alias, pan_last4, expiracion_mes, expiracion_anio, fecha_entrega, red, created_at, updated_at FROM public.tarjeta_detalle WHERE tarjeta_id = %s", (tarjeta_id,))
        row = cur.fetchone()
        return row or {}

@router.put("/{tarjeta_id}/detalle")
def upsert_detalle(tarjeta_id: int, body: DetalleIn, conn: psycopg.Connection = Depends(get_conn)):
    data = body.model_dump()
    data["tarjeta_id"] = tarjeta_id

    q = """
    INSERT INTO public.tarjeta_detalle
        (tarjeta_id, alias, pan_last4, expiracion_mes, expiracion_anio, fecha_entrega, red, created_at, updated_at)
    VALUES
        (%(tarjeta_id)s, %(alias)s, %(pan_last4)s, %(expiracion_mes)s, %(expiracion_anio)s, %(fecha_entrega)s, %(red)s, now(), now())
    ON CONFLICT (tarjeta_id) DO UPDATE SET
        alias = EXCLUDED.alias,
        pan_last4 = EXCLUDED.pan_last4,
        expiracion_mes = EXCLUDED.expiracion_mes,
        expiracion_anio = EXCLUDED.expiracion_anio,
        fecha_entrega = EXCLUDED.fecha_entrega,
        red = EXCLUDED.red,
        updated_at = now()
    RETURNING id, tarjeta_id, alias, pan_last4, expiracion_mes, expiracion_anio, fecha_entrega, red, created_at, updated_at;
    """

    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(q, data)
        row = cur.fetchone()
        conn.commit()
        return row
