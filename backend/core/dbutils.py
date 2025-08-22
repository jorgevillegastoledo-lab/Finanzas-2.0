# core/dbutils.py
from __future__ import annotations
import os, pathlib, logging
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional

import psycopg2
import psycopg2.extras
from psycopg2 import sql

# -------------------------- Windows-safe PG env --------------------------
BASE_DIR = pathlib.Path(__file__).resolve().parent.parent
SAFE_DIR = BASE_DIR / "pgsafe"
SAFE_DIR.mkdir(exist_ok=True)
for fname in ("pg_service.conf", "pgpass.conf"):
    p = SAFE_DIR / fname
    if not p.exists():
        p.write_text("", encoding="utf-8")

os.environ.setdefault("PGSYSCONFDIR", str(SAFE_DIR))
os.environ.setdefault("PGSERVICEFILE", str(SAFE_DIR / "pg_service.conf"))
os.environ.setdefault("PGPASSFILE", str(SAFE_DIR / "pgpass.conf"))
os.environ.setdefault("PGCLIENTENCODING", "utf8")
os.environ.pop("DATABASE_URL", None)

# ------------------------------- Conexión --------------------------------
DEFAULT_DBNAME = os.getenv("PGDATABASE", "finanzas")
DEFAULT_USER   = os.getenv("PGUSER", "postgres")
DEFAULT_PASS   = os.getenv("PGPASSWORD", "Kokeman29")  # ajusta si aplica
DEFAULT_HOST   = os.getenv("PGHOST", "localhost")
DEFAULT_PORT   = int(os.getenv("PGPORT", "5432"))

def get_conn():
    try:
        conn = psycopg2.connect(
            dbname=DEFAULT_DBNAME, user=DEFAULT_USER, password=DEFAULT_PASS,
            host=DEFAULT_HOST, port=DEFAULT_PORT, options="-c client_encoding=UTF8",
        )
        conn.autocommit = True
        return conn
    except Exception:
        logging.getLogger("uvicorn.error").exception("Fallo de conexión a PostgreSQL")
        raise

# --------------------------- Utilidades varias ---------------------------
def _fix_json(rows: List[Dict[str, Any]]):
    def f(v):
        if isinstance(v, Decimal): return float(v)
        if isinstance(v, (date, datetime)): return v.isoformat()
        return v
    return [{k: f(v) for k, v in r.items()} for r in rows]

NUMERIC_TYPES = {"numeric","decimal","double precision","real","integer","bigint","smallint"}

def get_columns(conn, table: str) -> set:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema='public' AND table_name=%s
        """, (table,))
        return {r[0] for r in cur.fetchall()}

def get_column_type(conn, table: str, column: str) -> Optional[str]:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT data_type
            FROM information_schema.columns
            WHERE table_schema='public' AND table_name=%s AND column_name=%s
        """, (table, column))
        row = cur.fetchone()
        return row[0] if row else None

# ---------------------------- ensure_* helpers ---------------------------
def ensure_facturas_table(conn):
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS facturas (
                id SERIAL PRIMARY KEY,
                tarjeta_id INTEGER NOT NULL REFERENCES tarjetas(id),
                mes SMALLINT NOT NULL CHECK (mes BETWEEN 1 AND 12),
                anio INTEGER NOT NULL CHECK (anio BETWEEN 2000 AND 2100),
                total NUMERIC(14,2) NOT NULL DEFAULT 0,
                pagada BOOLEAN NOT NULL DEFAULT FALSE,
                fecha_pago DATE NULL,
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
                UNIQUE (tarjeta_id, mes, anio)
            );
        """)
        cur.execute("ALTER TABLE facturas ADD COLUMN IF NOT EXISTS pagada BOOLEAN NOT NULL DEFAULT FALSE;")
        cur.execute("ALTER TABLE facturas ADD COLUMN IF NOT EXISTS fecha_pago DATE NULL;")
        cur.execute("ALTER TABLE facturas ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW();")

def ensure_factura_detalle_table(conn):
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS factura_detalle (
                id SERIAL PRIMARY KEY,
                factura_id INTEGER NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
                fecha_emision DATE,
                fecha_vencimiento DATE,
                pago_minimo NUMERIC(14,2),
                monto_pagado NUMERIC(14,2),
                nro_estado TEXT,
                nota TEXT,
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
            );
        """)
        cur.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_factura_detalle_factura_id
            ON factura_detalle (factura_id);
        """)

def ensure_factura_pagos_table(conn):
    """Un (1) pago por factura."""
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS factura_pagos (
                id SERIAL PRIMARY KEY,
                factura_id INTEGER NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
                fecha_pago DATE NOT NULL DEFAULT CURRENT_DATE,
                monto NUMERIC(14,2) NOT NULL,
                nota TEXT,
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
                UNIQUE (factura_id)
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
                valor_cuota NUMERIC(14,2) NOT NULL,
                fecha_pago DATE NOT NULL DEFAULT CURRENT_DATE
            );
        """)

def ensure_pagos_gasto_table(conn):
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS pagos_gasto (
                id SERIAL PRIMARY KEY,
                gasto_id INTEGER NOT NULL REFERENCES gastos(id),
                fecha DATE NOT NULL DEFAULT CURRENT_DATE,
                monto NUMERIC(14,2) NOT NULL,
                metodo TEXT,
                tarjeta_id INTEGER,
                nota TEXT,
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
            );
        """)

def ensure_gasto_detalle_table(conn):
    with conn.cursor() as cur:
        cur.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_gasto_detalle_gasto_id
            ON gasto_detalle (gasto_id);
        """)

def ensure_tarjeta_detalle_table(conn):
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS tarjeta_detalle (
                id SERIAL PRIMARY KEY,
                tarjeta_id INTEGER NOT NULL REFERENCES tarjetas(id) ON DELETE CASCADE,
                alias VARCHAR(100),
                pan_last4 VARCHAR(4),
                expiracion_mes SMALLINT,
                expiracion_anio INTEGER,
                fecha_entrega DATE,
                red VARCHAR(20),
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
            );
        """)
        cur.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_tarjeta_detalle_tarjeta_id
            ON public.tarjeta_detalle (tarjeta_id);
        """)

def ensure_recurrentes(mes: int, anio: int):
    """Clona gastos recurrentes del mes anterior si no existen en el mes actual."""
    try:
        prev_mes  = 12 if mes == 1 else mes - 1
        prev_anio = anio - 1 if mes == 1 else anio
        conn = get_conn()
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO gastos (
                    nombre, monto, con_tarjeta, tarjeta_id,
                    es_recurrente, mes, anio, pagado
                )
                SELECT
                    g.nombre,
                    g.monto,
                    COALESCE(g.con_tarjeta, FALSE),
                    g.tarjeta_id,
                    TRUE,
                    %s, %s,
                    FALSE
                FROM gastos g
                WHERE g.es_recurrente = TRUE
                  AND g.mes  = %s
                  AND g.anio = %s
                  AND NOT EXISTS (
                      SELECT 1 FROM gastos t
                      WHERE t.es_recurrente = TRUE
                        AND t.nombre = g.nombre
                        AND t.mes = %s AND t.anio = %s
                  );
            """, (mes, anio, prev_mes, prev_anio, mes, anio))
        conn.commit()
    except Exception:
        if 'conn' in locals(): conn.rollback()
        logging.getLogger("uvicorn.error").exception("ensure_recurrentes falló")
        raise
    finally:
        if 'conn' in locals(): conn.close()

# --------------------------- Recompute préstamo ---------------------------
def recompute_prestamo_totales(conn, prestamo_id: int):
    cols = get_columns(conn, "prestamos")
    if not {"valor_cuota", "cuotas_totales"}.issubset(cols):
        return
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT valor_cuota, cuotas_totales
            FROM prestamos WHERE id = %s
        """, (prestamo_id,))
        p = cur.fetchone()
        if not p:
            return
        valor_cuota = float(p["valor_cuota"])
        cuotas_tot  = int(p["cuotas_totales"])
    with conn.cursor() as cur:
        cur.execute("""
            SELECT COALESCE(SUM(valor_cuota),0) AS total_pagado,
                   COUNT(*) AS pagos
            FROM pagos_prestamo
            WHERE prestamo_id = %s
        """, (prestamo_id,))
        total_pagado, pagos = cur.fetchone()
    monto_total = valor_cuota * cuotas_tot
    deuda = max(monto_total - float(total_pagado), 0)

    sets, params = [], []
    if "monto_total" in cols:     sets.append("monto_total = %s");     params.append(monto_total)
    if "deuda_restante" in cols:  sets.append("deuda_restante = %s");  params.append(deuda)
    if "cuotas_pagadas" in cols:  sets.append("cuotas_pagadas = %s");  params.append(int(pagos))
    if "pagado" in cols:
        t = get_column_type(conn, "prestamos", "pagado")
        if t and t.lower() == "boolean":
            sets.append("pagado = %s"); params.append(int(pagos) >= cuotas_tot)
        elif t and t.lower() in NUMERIC_TYPES:
            sets.append("pagado = %s"); params.append(total_pagado)

    if sets:
        with conn.cursor() as cur:
            cur.execute(f"UPDATE prestamos SET {', '.join(sets)} WHERE id = %s",
                        params + [prestamo_id])

def ensure_prestamo_detalle_support(conn):
    """
    Asegura la tabla prestamo_detalle (1:1 con prestamos) y su índice único.
    Es segura para ejecutar múltiples veces.
    """
    with conn.cursor() as cur:
        # Crea la tabla si no existe (campos "amplios" para que no te falte nada)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS prestamo_detalle (
                id SERIAL PRIMARY KEY,
                prestamo_id INTEGER NOT NULL REFERENCES prestamos(id) ON DELETE CASCADE,

                banco TEXT,
                numero_contrato TEXT,
                fecha_otorgamiento DATE,
                monto_original NUMERIC(14,2),
                moneda TEXT,
                plazo_meses INTEGER,
                dia_vencimiento INTEGER,
                tasa_interes_anual NUMERIC(8,4),
                tipo_tasa TEXT,
                indice_reajuste TEXT,
                primera_cuota DATE,

                ejecutivo_nombre TEXT,
                ejecutivo_email TEXT,
                ejecutivo_fono TEXT,

                seguro_desgravamen BOOLEAN,
                seguro_cesantia BOOLEAN,
                costo_seguro_mensual NUMERIC(14,2),
                comision_administracion NUMERIC(14,2),

                prepago_permitido BOOLEAN,
                prepago_costo NUMERIC(14,2),

                garantia_tipo TEXT,
                garantia_descripcion TEXT,
                garantia_hasta DATE,

                liquido_recibido NUMERIC(14,2),
                gastos_iniciales_total NUMERIC(14,2),

                tags TEXT,
                nota TEXT,

                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
            );
        """)

        # Índice único 1:1 con prestamos
        cur.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_prestamo_detalle_prestamo_id
            ON public.prestamo_detalle (prestamo_id);
        """)




# ----------------------- Factura Detalle (1:1) -----------------------
def ensure_factura_detalle_table(conn):
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS factura_detalle (
                id SERIAL PRIMARY KEY,
                factura_id INTEGER NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
                fecha_emision DATE,
                fecha_vencimiento DATE,
                pago_minimo NUMERIC(14,2),
                monto_pagado NUMERIC(14,2),
                nro_estado TEXT,
                nota TEXT,
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
            );
        """)
        cur.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_factura_detalle_factura_id
            ON factura_detalle (factura_id);
        """)

