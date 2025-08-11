from datetime import date
from calendar import monthrange
from typing import Optional
import os
# ⚙️ Forzar entorno limpio para libpq/psycopg2
os.environ.pop("DATABASE_URL", None)     # ignorar URL externa problemática
os.environ.pop("PGSERVICE", None)        # evitar uso de "service"
os.environ["PGSERVICEFILE"] = "NUL"      # en Windows, desactiva archivo de servicios
os.environ["PGPASSFILE"] = "NUL"         # desactiva pgpass (si tenía acentos)
os.environ["PGCLIENTENCODING"] = "utf8"  # cliente en UTF-8

import psycopg2
import psycopg2.extras
from psycopg2 import errors
from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from urllib.parse import urlparse, unquote

# ======== DEFAULTS (ajusta si usas otras credenciales) ========
DEFAULT_DBNAME = "finanzas"
DEFAULT_USER = "postgres"
DEFAULT_PASS = "postgres"  # <-- CAMBIA AQUÍ si no usas 'postgres'
DEFAULT_HOST = "localhost"
DEFAULT_PORT = 5432

# ======== App ========
app = FastAPI(title="Finanzas API")

# CORS
ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
)

@app.options("/{rest_of_path:path}")
def preflight_ok(rest_of_path: str):
    return Response(status_code=204)

# ======== Conn ========
def get_conn():
    # conexión directa y limpia (ajusta user/password si no son estos)
    return psycopg2.connect(
        dbname="finanzas",
        user="postgres",
        password="postgres",
        host="127.0.0.1",     # evita resoluciones raras
        port=5432,
        sslmode="disable",    # no buscará certificados en rutas con acentos
        options="-c client_encoding=UTF8",
    )


# ======== Schemas ========
class PrestamoIn(BaseModel):
    nombre: str
    valor_cuota: float
    cuotas_totales: int
    cuotas_pagadas: int = 0
    primer_mes: int = Field(ge=1, le=12)
    primer_anio: int = Field(ge=2000, le=2100)
    dia_vencimiento: int = Field(10, ge=1, le=31)

class PagarIn(BaseModel):
    mes_contable: int = Field(ge=1, le=12)
    anio_contable: int = Field(ge=2000, le=2100)
    monto_pagado: Optional[float] = None

class GastoIn(BaseModel):
    nombre: str
    monto: float
    mes: int = Field(ge=1, le=12)
    anio: int = Field(ge=2000, le=2100)
    pagado: bool = False

# ======== PRÉSTAMOS ========
@app.get("/prestamos")
def listar_prestamos(
    mes: Optional[int] = Query(None, ge=1, le=12),
    anio: Optional[int] = Query(None, ge=2000, le=2100),
):
    conn = get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            SELECT
              p.id, p.nombre, p.valor_cuota, p.cuotas_totales, p.cuotas_pagadas,
              p.primer_mes, p.primer_anio, p.dia_vencimiento,
              COALESCE(SUM(pg.monto_pagado), 0) AS monto_pagado,
              COALESCE(COUNT(pg.id), 0)         AS cuotas_registradas
            FROM public.prestamos p
            LEFT JOIN public.pagos_prestamo pg ON pg.prestamo_id = p.id
            GROUP BY
              p.id, p.nombre, p.valor_cuota, p.cuotas_totales, p.cuotas_pagadas,
              p.primer_mes, p.primer_anio, p.dia_vencimiento
            ORDER BY p.id DESC;
            """
        )
        rows = cur.fetchall()

        items, saldo_total, pagado_total = [], 0.0, 0.0
        for r in rows:
            valor_cuota = float(r["valor_cuota"])
            monto_pagado = float(r["monto_pagado"])
            monto_total = valor_cuota * int(r["cuotas_totales"])
            saldo_restante = max(monto_total - monto_pagado, 0.0)
            finalizado = monto_pagado >= (monto_total - 0.5)

            cuotas_reg = int(r["cuotas_registradas"])
            next_idx = min(cuotas_reg + 1, int(r["cuotas_totales"]))
            mes0, anio0 = int(r["primer_mes"]), int(r["primer_anio"])
            if next_idx <= int(r["cuotas_totales"]):
                n_mes = ((mes0 - 1 + (next_idx - 1)) % 12) + 1
                n_anio = anio0 + ((mes0 - 1 + (next_idx - 1)) // 12)
                _, dim = monthrange(n_anio, n_mes)
                dia = min(max(int(r["dia_vencimiento"]), 1), dim)
                proxima_cuota = date(n_anio, n_mes, dia).isoformat()
            else:
                proxima_cuota = None

            items.append({
                "id": r["id"], "nombre": r["nombre"],
                "valor_cuota": valor_cuota,
                "cuotas_totales": int(r["cuotas_totales"]),
                "cuotas_pagadas": int(r["cuotas_pagadas"]),
                "primer_mes": mes0, "primer_anio": anio0,
                "dia_vencimiento": int(r["dia_vencimiento"]),
                "monto_pagado": monto_pagado,
                "saldo_restante": saldo_restante,
                "finalizado": finalizado,
                "proxima_cuota": proxima_cuota,
            })
            saldo_total += saldo_restante
            pagado_total += monto_pagado

        total_mes = 0.0
        if mes and anio:
            cur.execute(
                "SELECT COALESCE(SUM(monto_pagado),0) FROM public.pagos_prestamo WHERE mes_contable=%s AND anio_contable=%s",
                (mes, anio),
            )
            total_mes = float(cur.fetchone()[0] or 0)

        return {"items": items, "resumen": {
            "total_mes": total_mes, "saldo_total": float(saldo_total), "pagado_total": float(pagado_total)
        }}
    finally:
        conn.close()

@app.post("/prestamos")
def crear_prestamo(p: PrestamoIn):
    conn = get_conn()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO public.prestamos
                      (nombre, valor_cuota, cuotas_totales, cuotas_pagadas,
                       primer_mes, primer_anio, dia_vencimiento)
                    VALUES (%s,%s,%s,%s,%s,%s,%s)
                    """,
                    (p.nombre, p.valor_cuota, p.cuotas_totales, p.cuotas_pagadas,
                     p.primer_mes, p.primer_anio, p.dia_vencimiento),
                )
        return {"ok": True}
    finally:
        conn.close()

@app.put("/prestamos/{prestamo_id}")
def editar_prestamo(prestamo_id: int, p: PrestamoIn):
    conn = get_conn()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE public.prestamos SET
                      nombre=%s, valor_cuota=%s, cuotas_totales=%s, cuotas_pagadas=%s,
                      primer_mes=%s, primer_anio=%s, dia_vencimiento=%s
                    WHERE id=%s
                    """,
                    (p.nombre, p.valor_cuota, p.cuotas_totales, p.cuotas_pagadas,
                     p.primer_mes, p.primer_anio, p.dia_vencimiento, prestamo_id),
                )
                if cur.rowcount == 0:
                    raise HTTPException(status_code=404, detail="Préstamo no encontrado")
        return {"ok": True}
    finally:
        conn.close()

@app.delete("/prestamos/{prestamo_id}")
def borrar_prestamo(prestamo_id: int):
    conn = get_conn()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM public.prestamos WHERE id=%s", (prestamo_id,))
                if cur.rowcount == 0:
                    raise HTTPException(status_code=404, detail="Préstamo no encontrado")
        return {"ok": True}
    finally:
        conn.close()

@app.post("/prestamos/{prestamo_id}/pagar")
def pagar_cuota(prestamo_id: int, body: PagarIn):
    conn = get_conn()
    try:
        with conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT valor_cuota, cuotas_totales, cuotas_pagadas FROM public.prestamos WHERE id=%s",
                    (prestamo_id,),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Préstamo no encontrado")

                monto = body.monto_pagado if body.monto_pagado is not None else float(row["valor_cuota"])

                try:
                    cur.execute(
                        """
                        INSERT INTO public.pagos_prestamo
                          (prestamo_id, mes_contable, anio_contable, monto_pagado)
                        VALUES (%s, %s, %s, %s)
                        """,
                        (prestamo_id, body.mes_contable, body.anio_contable, monto),
                    )
                except errors.UniqueViolation:
                    raise HTTPException(status_code=409, detail="Ya existe un pago para ese mes y año")

                if int(row["cuotas_pagadas"]) < int(row["cuotas_totales"]):
                    cur.execute(
                        "UPDATE public.prestamos SET cuotas_pagadas = cuotas_pagadas + 1 WHERE id=%s",
                        (prestamo_id,),
                    )
        return {"ok": True, "prestamo_id": prestamo_id}
    finally:
        conn.close()

@app.get("/prestamos/detalle-mensual")
def detalle_mensual(mes: int = Query(..., ge=1, le=12), anio: int = Query(..., ge=2000, le=2100)):
    conn = get_conn()
    try:
        with conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT id, nombre, valor_cuota, cuotas_totales, primer_mes, primer_anio, dia_vencimiento FROM public.prestamos ORDER BY id DESC"
                )
                prs = cur.fetchall()

                cur.execute(
                    "SELECT prestamo_id, monto_pagado, fecha_pago FROM public.pagos_prestamo WHERE mes_contable=%s AND anio_contable=%s",
                    (mes, anio),
                )
                pagos = {r["prestamo_id"]: r for r in cur.fetchall()}

                items, total_mes = [], 0.0
                for p in prs:
                    months_diff = (anio * 12 + mes) - (int(p["primer_anio"]) * 12 + int(p["primer_mes"]))
                    cuota_num = months_diff + 1
                    if cuota_num < 1 or cuota_num > int(p["cuotas_totales"]):
                        continue

                    _, dim = monthrange(anio, mes)
                    dia = min(max(int(p["dia_vencimiento"]), 1), dim)
                    vence_el = date(anio, mes, dia).isoformat()

                    pago = pagos.get(p["id"])
                    if pago:
                        estado = "pagado"
                        fecha_pago = pago["fecha_pago"].isoformat()
                        monto = float(pago["monto_pagado"])
                        total_mes += monto
                    else:
                        estado = "pendiente"
                        fecha_pago = None
                        monto = float(p["valor_cuota"])

                    items.append({
                        "prestamo_id": int(p["id"]),
                        "nombre": p["nombre"],
                        "cuota_num": int(cuota_num),
                        "mes_contable": mes,
                        "anio_contable": anio,
                        "monto": monto,
                        "estado": estado,
                        "vence_el": vence_el,
                        "fecha_pago": fecha_pago,
                    })
                return {"items": items, "total_mes": float(total_mes)}
    finally:
        conn.close()

# ======== HEALTH ========
@app.get("/healthz")
def healthz():
    return {"ok": True}

# ======== GASTOS ========
@app.get("/gastos")
def listar_gastos(
    mes: Optional[int] = Query(None, ge=1, le=12),
    anio: Optional[int] = Query(None, ge=2000, le=2100),
    pagado: Optional[bool] = None,
):
    conn = get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            SELECT
                id,
                nombre,
                monto::float8 AS monto,
                mes::int      AS mes,
                anio::int     AS anio,
                pagado::bool  AS pagado
            FROM public.gastos
            WHERE (%s IS NULL OR mes=%s)
              AND (%s IS NULL OR anio=%s)
              AND (%s IS NULL OR pagado=%s)
            ORDER BY id DESC
            """,
            (mes, mes, anio, anio, pagado, pagado),
        )
        rows = cur.fetchall()
        total = sum((r["monto"] or 0) for r in rows)
        total_pagado = sum((r["monto"] or 0) for r in rows if r["pagado"])
        return {"items": rows, "resumen": {"total": total, "pagado": total_pagado, "pendiente": total - total_pagado}}
    finally:
        conn.close()

