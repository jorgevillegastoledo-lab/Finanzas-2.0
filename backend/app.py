# app.py — Finanzas API (FastAPI + PostgreSQL) — Windows safe + CORS
from datetime import date
from decimal import Decimal
from typing import List, Dict, Any, Optional

import os
import pathlib
import logging

import psycopg2
import psycopg2.extras
from psycopg2 import sql

from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# -------------------------------------------------------------------
#  Ajustes para Windows: evitar archivos ANSI (pgpass/pg_service)
# -------------------------------------------------------------------
BASE_DIR = pathlib.Path(__file__).parent.resolve()
SAFE_DIR = BASE_DIR / "pgsafe"
SAFE_DIR.mkdir(exist_ok=True)
for fname in ("pg_service.conf", "pgpass.conf"):
    p = SAFE_DIR / fname
    if not p.exists():
        p.write_text("", encoding="utf-8")

os.environ["PGSYSCONFDIR"] = str(SAFE_DIR)                  # buscar aquí pg_service.conf
os.environ["PGSERVICEFILE"] = str(SAFE_DIR / "pg_service.conf")
os.environ["PGPASSFILE"] = str(SAFE_DIR / "pgpass.conf")
os.environ["PGSERVICE"] = ""                                # no usar 'service'
os.environ["PGCLIENTENCODING"] = "utf8"
os.environ.pop("DATABASE_URL", None)

# -------------------------------------------------------------------
#  Conexión a PostgreSQL (ajusta PASS si corresponde)
# -------------------------------------------------------------------
DEFAULT_DBNAME = "finanzas"
DEFAULT_USER   = "postgres"
DEFAULT_PASS   = "Kokeman29"   # <-- CAMBIA AQUÍ SI TU CLAVE ES OTRA
DEFAULT_HOST   = "localhost"
DEFAULT_PORT   = 5432

def get_conn():
    """Crea una conexión nueva a PostgreSQL."""
    try:
        conn = psycopg2.connect(
            dbname=os.getenv("PGDATABASE", DEFAULT_DBNAME),
            user=os.getenv("PGUSER", DEFAULT_USER),
            password=os.getenv("PGPASSWORD", DEFAULT_PASS),
            host=os.getenv("PGHOST", DEFAULT_HOST),
            port=int(os.getenv("PGPORT", DEFAULT_PORT)),
            options="-c client_encoding=UTF8",
        )
        conn.autocommit = True
        return conn
    except Exception as e:
        logging.getLogger("uvicorn.error").exception("Fallo de conexión a PostgreSQL")
        raise HTTPException(status_code=500, detail=f"No pude conectar a la base de datos: {e}")

def _fix_json(rows: List[Dict[str, Any]]):
    """Convierte Decimal/fecha a tipos serializables."""
    def f(v):
        if isinstance(v, Decimal): return float(v)
        if isinstance(v, date):    return v.isoformat()
        return v
    return [{k: f(v) for k, v in r.items()} for r in rows]

# -------------------------------------------------------------------
#  FastAPI + CORS
# -------------------------------------------------------------------
app = FastAPI(title="Finanzas API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=False,  # usamos headers/bearer, no cookies
)

# -------------------------------------------------------------------
#  Utils
# -------------------------------------------------------------------
def get_columns(conn, table: str) -> set:
    """Obtiene columnas reales de una tabla (para inserts tolerantes)."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = %s
        """, (table,))
        return {r[0] for r in cur.fetchall()}

# -------------------------------------------------------------------
#  Modelos
# -------------------------------------------------------------------
class PrestamoIn(BaseModel):
    nombre: str
    valor_cuota: float = Field(gt=0)
    cuotas_totales: int = Field(gt=0)
    cuotas_pagadas: Optional[int] = 0
    primer_mes: Optional[int] = Field(default=None, ge=1, le=12)
    primer_anio: Optional[int] = Field(default=None, ge=2000, le=2100)
    dia_vencimiento: Optional[int] = Field(default=None, ge=1, le=31)
    # banco es opcional y puede no existir en la tabla
    banco: Optional[str] = None

class TarjetaIn(BaseModel):
    nombre: str
    banco: Optional[str] = None
    tipo: str = Field(default="credito", pattern="^(credito|debito)$")
    limite: Optional[float] = None
    cierre_dia: Optional[int] = Field(default=None, ge=1, le=31)
    vencimiento_dia: Optional[int] = Field(default=None, ge=1, le=31)
    activa: bool = True

class GastoIn(BaseModel):
    nombre: str
    monto: float
    mes: int
    anio: int
    pagado: Optional[bool] = None
    # compras con tarjeta (opcionales)
    tarjeta_id: Optional[int] = None
    cuotas: Optional[int] = 1
    # si ya usas estos en tu tabla, déjalos
    tipo: Optional[str] = None
    con_tarjeta: Optional[bool] = None
    es_recurrente: Optional[bool] = None
    fecha_vencimiento: Optional[str] = None

class FacturaIn(BaseModel):
    tarjeta_id: int
    mes: int = Field(ge=1, le=12)
    anio: int = Field(ge=2000, le=2100)
    total: float = Field(ge=0)

class PagoPrestamoIn(BaseModel):
    mes_contable: int = Field(ge=1, le=12)
    anio_contable: int = Field(ge=2000, le=2100)
    monto_pagado: Optional[float] = None   # si no se envía, se usará valor_cuota

# -----------------------------------------------------------
#  Helpers ensure_* para tablas opcionales
# -----------------------------------------------------------
def ensure_recurrentes(mes: int, anio: int):
    """
    Clona al mes/año objetivo todos los gastos marcados como es_recurrente
    del mes anterior, sólo si aún no existen en el mes/año destino.
    """
    try:
        prev_mes  = 12 if mes == 1 else mes - 1
        prev_anio = anio - 1 if mes == 1 else anio

        conn = get_conn()
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO gastos (
                    nombre, monto, tipo, con_tarjeta, tarjeta_id, cuotas,
                    es_recurrente, mes, anio, pagado, fecha_vencimiento
                )
                SELECT
                    g.nombre,
                    g.monto,
                    g.tipo,
                    g.con_tarjeta,
                    g.tarjeta_id,
                    COALESCE(g.cuotas, 1),
                    TRUE,
                    %s, %s,
                    FALSE,
                    g.fecha_vencimiento
                FROM gastos g
                WHERE g.es_recurrente = TRUE
                  AND g.mes  = %s
                  AND g.anio = %s
                  AND NOT EXISTS (
                        SELECT 1
                        FROM gastos t
                        WHERE t.mes = %s
                          AND t.anio = %s
                          AND t.nombre = g.nombre
                  );
                """,
                (mes, anio, prev_mes, prev_anio, mes, anio)
            )
        conn.close()
    except Exception:
        logging.getLogger("uvicorn.error").exception("ensure_recurrentes falló")

def ensure_facturas_table(conn):
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS facturas (
                id SERIAL PRIMARY KEY,
                tarjeta_id INTEGER NOT NULL REFERENCES tarjetas(id),
                mes SMALLINT NOT NULL CHECK (mes BETWEEN 1 AND 12),
                anio INTEGER NOT NULL CHECK (anio BETWEEN 2000 AND 2100),
                total NUMERIC(14,2) NOT NULL DEFAULT 0,
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
                UNIQUE (tarjeta_id, mes, anio)
            );
        """)

def ensure_pagos_prestamo_table(conn):
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS pagos_prestamo (
                id SERIAL PRIMARY KEY,
                prestamo_id INTEGER NOT NULL REFERENCES prestamos(id),
                mes_contable SMALLINT NOT NULL CHECK (mes_contable BETWEEN 1 AND 12),
                anio_contable INTEGER NOT NULL CHECK (anio_contable BETWEEN 2000 AND 2100),
                monto_pagado NUMERIC(14,2) NOT NULL,
                fecha_pago DATE NOT NULL DEFAULT CURRENT_DATE
            );
        """)

# -------------------------------------------------------------------
#  Endpoints base
# -------------------------------------------------------------------
@app.get("/health")
def health():
    return {"ok": True}

# -------------------------------------------------------------------
#  PRÉSTAMOS
# -------------------------------------------------------------------
@app.get("/prestamos")
def listar_prestamos():
    try:
        conn = get_conn()
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM prestamos ORDER BY id;")
            rows = cur.fetchall()
        conn.close()
        return {"ok": True, "data": _fix_json(rows)}
    except psycopg2.errors.UndefinedTable:
        return {"ok": True, "data": []}
    except Exception as e:
        logging.getLogger("uvicorn.error").exception("Error al cargar préstamos")
        raise HTTPException(status_code=500, detail=f"Error al cargar préstamos: {e}")

@app.post("/prestamos")
def crear_prestamo(body: PrestamoIn):
    try:
        conn = get_conn()
        cols_exist = get_columns(conn, "prestamos")
        data = {
            "nombre": body.nombre,
            "valor_cuota": body.valor_cuota,
            "cuotas_totales": body.cuotas_totales,
            "cuotas_pagadas": body.cuotas_pagadas,
            "primer_mes": body.primer_mes,
            "primer_anio": body.primer_anio,
            "dia_vencimiento": body.dia_vencimiento,
            "banco": body.banco,   # si no existe en tabla, luego se filtra
        }
        # Solo columnas reales y no None
        data = {k: v for k, v in data.items() if k in cols_exist and v is not None}
        if not data:
            raise HTTPException(status_code=400, detail="No hay columnas válidas que insertar.")

        columns = list(data.keys())
        values = list(data.values())
        placeholders = [sql.Placeholder() for _ in columns]

        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            q = sql.SQL("INSERT INTO {t} ({c}) VALUES ({p}) RETURNING *;").format(
                t=sql.Identifier("prestamos"),
                c=sql.SQL(", ").join(map(sql.Identifier, columns)),
                p=sql.SQL(", ").join(placeholders),
            )
            cur.execute(q, values)
            row = cur.fetchone()
        conn.close()
        return {"ok": True, "data": _fix_json([row])[0] if row else None}
    except Exception as e:
        logging.getLogger("uvicorn.error").exception("Error al crear préstamo")
        raise HTTPException(status_code=500, detail=f"Error al crear préstamo: {e}")

@app.put("/prestamos/{id}")
def editar_prestamo(id: int, body: PrestamoIn):
    try:
        conn = get_conn()
        cols_exist = get_columns(conn, "prestamos")
        # Mismo filtro que en crear
        data = {k: v for k, v in body.dict().items() if k in cols_exist}
        if not data:
            raise HTTPException(status_code=400, detail="No hay columnas válidas que actualizar.")
        sets = [sql.SQL("{} = {}").format(sql.Identifier(k), sql.Placeholder()) for k in data.keys()]
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            q = sql.SQL("UPDATE prestamos SET {sets} WHERE id = %s RETURNING *;").format(
                sets=sql.SQL(", ").join(sets)
            )
            cur.execute(q, list(data.values()) + [id])
            row = cur.fetchone()
        conn.close()
        if not row:
            raise HTTPException(status_code=404, detail="Préstamo no encontrado")
        return {"ok": True, "data": _fix_json([row])[0]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al editar préstamo: {e}")

# --- Pagos de préstamo ---
@app.post("/prestamos/{id}/pagar")
def marcar_pago_prestamo(id: int, body: PagoPrestamoIn):
    """
    Inserta un pago en pagos_prestamo con mes/anio contable.
    Si no se especifica 'monto_pagado', se usa valor_cuota actual del préstamo.
    """
    try:
        conn = get_conn()
        ensure_pagos_prestamo_table(conn)

        # Obtener valor_cuota si no se envía
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT valor_cuota FROM prestamos WHERE id = %s;", (id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Préstamo no encontrado")
            default_monto = float(row["valor_cuota"] or 0)

        monto = body.monto_pagado if body.monto_pagado is not None else default_monto

        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO pagos_prestamo (prestamo_id, mes_contable, anio_contable, monto_pagado)
                VALUES (%s, %s, %s, %s);
            """, (id, body.mes_contable, body.anio_contable, monto))
        conn.close()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al registrar pago: {e}")

@app.get("/prestamos/{id}/pagos")
def listar_pagos_prestamo(
    id: int,
    mes: Optional[int] = Query(None, ge=1, le=12),
    anio: Optional[int] = Query(None, ge=2000, le=2100),
):
    try:
        conn = get_conn()
        ensure_pagos_prestamo_table(conn)
        where = ["prestamo_id = %s"]
        params: List[Any] = [id]
        if mes is not None:
            where.append("mes_contable = %s"); params.append(mes)
        if anio is not None:
            where.append("anio_contable = %s"); params.append(anio)
        q = f"""
            SELECT id, prestamo_id, mes_contable, anio_contable, monto_pagado, fecha_pago
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
        raise HTTPException(status_code=500, detail=f"Error al listar pagos: {e}")

# --- Resumen de préstamos ---
@app.get("/prestamos/resumen")
def listar_prestamos_resumen():
    """
    Devuelve cada préstamo con:
    - total_pagado
    - deuda_restante
    - ultimo_mes / ultimo_anio (del último pago registrado)
    Se mantienen campos de edición por si la UI los usa.
    """
    try:
        conn = get_conn()
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT
                  p.id,
                  p.nombre,
                  p.valor_cuota,
                  p.cuotas_totales,
                  p.cuotas_pagadas,
                  p.primer_mes,
                  p.primer_anio,
                  p.dia_vencimiento,
                  p.banco,
                  COALESCE(agg.total_pagado, 0) AS total_pagado,
                  (p.valor_cuota * p.cuotas_totales) - COALESCE(agg.total_pagado, 0) AS deuda_restante,
                  up.mes_contable  AS ultimo_mes,
                  up.anio_contable AS ultimo_anio
                FROM prestamos p
                -- suma total pagado
                LEFT JOIN LATERAL (
                    SELECT SUM(pp.monto_pagado) AS total_pagado
                    FROM pagos_prestamo pp
                    WHERE pp.prestamo_id = p.id
                ) agg ON TRUE
                -- último periodo pagado
                LEFT JOIN LATERAL (
                    SELECT pp2.mes_contable, pp2.anio_contable
                    FROM pagos_prestamo pp2
                    WHERE pp2.prestamo_id = p.id
                    ORDER BY pp2.anio_contable DESC, pp2.mes_contable DESC
                    LIMIT 1
                ) up ON TRUE
                ORDER BY p.id;
            """)
            rows = cur.fetchall()
        conn.close()
        return {"ok": True, "data": _fix_json(rows)}
    except psycopg2.errors.UndefinedTable:
        return {"ok": True, "data": []}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al cargar resumen de préstamos: {e}")

# -------------------------------------------------------------------
#  TARJETAS
# -------------------------------------------------------------------
@app.get("/tarjetas")
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
    except psycopg2.errors.UndefinedTable:
        return {"ok": True, "data": []}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al listar tarjetas: {e}")

@app.post("/tarjetas")
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
        raise HTTPException(status_code=500, detail=f"Error al crear tarjeta: {e}")

@app.put("/tarjetas/{id}")
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
        if not row: raise HTTPException(status_code=404, detail="Tarjeta no encontrada")
        return {"ok": True, "data": _fix_json([row])[0]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al editar tarjeta: {e}")

@app.delete("/tarjetas/{id}")
def eliminar_tarjeta(id: int):
    try:
        conn = get_conn()
        with conn.cursor() as cur:
            cur.execute("UPDATE tarjetas SET activa = FALSE WHERE id = %s;", (id,))
        conn.close()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al eliminar tarjeta: {e}")

# -------------------------------------------------------------------
#  GASTOS
# -------------------------------------------------------------------
@app.get("/gastos")
def listar_gastos(
    mes: int  = Query(..., ge=1, le=12),
    anio: int = Query(..., ge=2000, le=2100),
):
    try:
        ensure_recurrentes(mes, anio)
        conn = get_conn()
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM gastos WHERE mes = %s AND anio = %s;",
                (mes, anio),
            )
            rows = cur.fetchall()
        conn.close()
        return {"ok": True, "data": _fix_json(rows)}
    except psycopg2.errors.UndefinedTable:
        return {"ok": True, "data": []}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al cargar gastos: {e}")

@app.post("/gastos")
def crear_gasto(body: GastoIn):
    try:
        conn = get_conn()
        cols_exist = get_columns(conn, "gastos")  # usa infor_schema
        # Inserta solo columnas que EXISTEN y no son None
        data = {k: v for k, v in body.dict().items() if k in cols_exist and v is not None}
        if not data:
            raise HTTPException(status_code=400, detail="No hay columnas válidas que insertar.")
        columns = list(data.keys()); values  = list(data.values())
        placeholders = [sql.Placeholder() for _ in columns]
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            q = sql.SQL(
                "INSERT INTO {t} ({c}) VALUES ({p}) RETURNING *;"
            ).format(
                t=sql.Identifier("gastos"),
                c=sql.SQL(", ").join(map(sql.Identifier, columns)),
                p=sql.SQL(", ").join(placeholders),
            )
            cur.execute(q, values)
            row = cur.fetchone()
        conn.close()
        return {"ok": True, "data": _fix_json([row])[0]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al crear gasto: {e}")

# -------------------------------------------------------------------
#  FACTURAS (para tarjetas)
# -------------------------------------------------------------------
@app.get("/facturas")
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
                   f.mes, f.anio, f.total, f.created_at
            FROM facturas f
            JOIN tarjetas t ON t.id = f.tarjeta_id
            WHERE {' AND '.join(where)}
            ORDER BY f.anio DESC, f.mes DESC, f.id DESC;
        """
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(q, params)
            rows = cur.fetchall()
        conn.close()
        return {"ok": True, "data": _fix_json(rows)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al listar facturas: {e}")

@app.post("/facturas")
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
        raise HTTPException(status_code=500, detail=f"Error al crear/actualizar factura: {e}")

@app.delete("/facturas/{id}")
def eliminar_factura(id: int):
    try:
        conn = get_conn()
        ensure_facturas_table(conn)
        with conn.cursor() as cur:
            cur.execute("DELETE FROM facturas WHERE id = %s;", (id,))
        conn.close()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al eliminar factura: {e}")

# -------------------------------------------------------------------
#  Raíz y preflight
# -------------------------------------------------------------------
@app.get("/")
def root():
    return {
        "name": "Finanzas API",
        "endpoints": [
            "/health",
            "/prestamos", "/prestamos/resumen", "/prestamos/{id}/pagar", "/prestamos/{id}/pagos",
            "/gastos",
            "/tarjetas",
            "/facturas",
        ],
    }

# Manejo amable de preflight (CORS)
@app.options("/{full_path:path}")
def preflight(full_path: str):
    return Response(status_code=200)
