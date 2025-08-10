from datetime import date
from calendar import monthrange
from typing import Optional

import os
import psycopg2
import psycopg2.extras
from psycopg2 import errors
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ======== Config DB ========
# Puedes sobreescribir con env var: postgres://user:pass@host:port/dbname
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/finanzas",
)

def get_conn():
    return psycopg2.connect(DATABASE_URL)

# ======== App ========
app = FastAPI(title="Finanzas API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
    monto_pagado: Optional[float] = None  # si no viene, usa valor_cuota


# ======== Endpoints ========
@app.get("/prestamos")
def listar_prestamos(
    mes: Optional[int] = Query(None, ge=1, le=12),
    anio: Optional[int] = Query(None, ge=2000, le=2100),
):
    """
    Lista préstamos y resumen general.
    - monto_pagado: suma de pagos registrados en pagos_prestamo
    - cuotas_registradas: COUNT(*) de pagos
    - saldo_restante, finalizado y proxima_cuota calculados en Python
    """
    conn = get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # Suma y cuenta pagos por préstamo (GROUP BY completo)
        cur.execute(
            """
            SELECT
              p.id, p.nombre, p.valor_cuota, p.cuotas_totales, p.cuotas_pagadas,
              p.primer_mes, p.primer_anio, p.dia_vencimiento,
              COALESCE(SUM(pg.monto_pagado), 0)        AS monto_pagado,
              COALESCE(COUNT(pg.id), 0)                 AS cuotas_registradas
            FROM public.prestamos p
            LEFT JOIN public.pagos_prestamo pg
                   ON pg.prestamo_id = p.id
            GROUP BY
              p.id, p.nombre, p.valor_cuota, p.cuotas_totales, p.cuotas_pagadas,
              p.primer_mes, p.primer_anio, p.dia_vencimiento
            ORDER BY p.id DESC;
            """
        )
        rows = cur.fetchall()

        items = []
        saldo_total = 0.0
        pagado_total = 0.0

        for r in rows:
            valor_cuota = float(r["valor_cuota"])
            monto_pagado = float(r["monto_pagado"])
            monto_total = valor_cuota * int(r["cuotas_totales"])
            saldo_restante = max(monto_total - monto_pagado, 0.0)
            finalizado = monto_pagado >= (monto_total - 0.5)

            # Próxima cuota teórica a partir del primer mes/año y pagos registrados
            cuotas_reg = int(r["cuotas_registradas"])
            next_idx = min(cuotas_reg + 1, int(r["cuotas_totales"]))
            mes0 = int(r["primer_mes"])
            anio0 = int(r["primer_anio"])
            if next_idx <= int(r["cuotas_totales"]):
                n_mes = ((mes0 - 1 + (next_idx - 1)) % 12) + 1
                n_anio = anio0 + ((mes0 - 1 + (next_idx - 1)) // 12)
                # limitar el día a los días del mes
                _, dim = monthrange(n_anio, n_mes)
                dia = min(max(int(r["dia_vencimiento"]), 1), dim)
                proxima_cuota = date(n_anio, n_mes, dia).isoformat()
            else:
                proxima_cuota = None

            items.append(
                {
                    "id": r["id"],
                    "nombre": r["nombre"],
                    "valor_cuota": valor_cuota,
                    "cuotas_totales": int(r["cuotas_totales"]),
                    "cuotas_pagadas": int(r["cuotas_pagadas"]),
                    "primer_mes": int(r["primer_mes"]),
                    "primer_anio": int(r["primer_anio"]),
                    "dia_vencimiento": int(r["dia_vencimiento"]),
                    "monto_pagado": monto_pagado,
                    "saldo_restante": saldo_restante,
                    "finalizado": finalizado,
                    "proxima_cuota": proxima_cuota,
                }
            )

            saldo_total += saldo_restante
            pagado_total += monto_pagado

        # Total pagado de ese mes (si viene filtro)
        total_mes = 0.0
        if mes and anio:
            cur.execute(
                """
                SELECT COALESCE(SUM(monto_pagado),0)
                FROM public.pagos_prestamo
                WHERE mes_contable=%s AND anio_contable=%s
                """,
                (mes, anio),
            )
            total_mes = float(cur.fetchone()[0] or 0)

        return {
            "items": items,
            "resumen": {
                "total_mes": total_mes,
                "saldo_total": float(saldo_total),
                "pagado_total": float(pagado_total),
            },
        }
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
                    (
                        p.nombre,
                        p.valor_cuota,
                        p.cuotas_totales,
                        p.cuotas_pagadas,
                        p.primer_mes,
                        p.primer_anio,
                        p.dia_vencimiento,
                    ),
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
                    (
                        p.nombre,
                        p.valor_cuota,
                        p.cuotas_totales,
                        p.cuotas_pagadas,
                        p.primer_mes,
                        p.primer_anio,
                        p.dia_vencimiento,
                        prestamo_id,
                    ),
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
    """
    Inserta 1 pago en pagos_prestamo para (mes_contable, anio_contable).
    Si no viene monto_pagado, usa valor_cuota del préstamo.
    Además incrementa el cache 'cuotas_pagadas' sin exceder 'cuotas_totales'.
    """
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

                # cache cuotas_pagadas (no pasa del total)
                if int(row["cuotas_pagadas"]) < int(row["cuotas_totales"]):
                    cur.execute(
                        """
                        UPDATE public.prestamos
                        SET cuotas_pagadas = cuotas_pagadas + 1
                        WHERE id=%s
                        """,
                        (prestamo_id,),
                    )

        return {"ok": True, "prestamo_id": prestamo_id}
    finally:
        conn.close()


@app.get("/prestamos/detalle-mensual")
def detalle_mensual(
    mes: int = Query(..., ge=1, le=12),
    anio: int = Query(..., ge=2000, le=2100),
):
    """
    Devuelve para el periodo (mes/anio):
      - una fila por préstamo con #cuota que corresponde a ese mes,
        estado (pagado/pendiente), monto, fecha de pago (si existe) y fecha de vencimiento.
      - total_mes: suma de montos pagados ese mes.
    """
    conn = get_conn()
    try:
        with conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                # préstamos base
                cur.execute(
                    """
                    SELECT id, nombre, valor_cuota, cuotas_totales,
                           primer_mes, primer_anio, dia_vencimiento
                    FROM public.prestamos
                    ORDER BY id DESC
                    """
                )
                prs = cur.fetchall()

                # pagos de ese periodo
                cur.execute(
                    """
                    SELECT prestamo_id, monto_pagado, fecha_pago
                    FROM public.pagos_prestamo
                    WHERE mes_contable=%s AND anio_contable=%s
                    """,
                    (mes, anio),
                )
                pagos = {r["prestamo_id"]: r for r in cur.fetchall()}

                items = []
                total_mes = 0.0

                for p in prs:
                    # ¿Ese mes/anio cae dentro del plan de cuotas de este préstamo?
                    months_diff = (anio * 12 + mes) - (int(p["primer_anio"]) * 12 + int(p["primer_mes"]))
                    cuota_num = months_diff + 1  # 1..N

                    if cuota_num < 1 or cuota_num > int(p["cuotas_totales"]):
                        # no corresponde cuota ese mes
                        continue

                    # fecha de vencimiento del periodo
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

                    items.append(
                        {
                            "prestamo_id": int(p["id"]),
                            "nombre": p["nombre"],
                            "cuota_num": int(cuota_num),
                            "mes_contable": mes,
                            "anio_contable": anio,
                            "monto": monto,
                            "estado": estado,
                            "vence_el": vence_el,
                            "fecha_pago": fecha_pago,
                        }
                    )

                return {"items": items, "total_mes": float(total_mes)}
    finally:
        conn.close()
