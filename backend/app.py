# app.py — Finanzas API (FastAPI + PostgreSQL) — Windows safe + CORS
from datetime import date, datetime
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

os.environ["PGSYSCONFDIR"] = str(SAFE_DIR)
os.environ["PGSERVICEFILE"] = str(SAFE_DIR / "pg_service.conf")
os.environ["PGPASSFILE"] = str(SAFE_DIR / "pgpass.conf")
os.environ["PGSERVICE"] = ""
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
    def f(v):
        if isinstance(v, Decimal): return float(v)
        if isinstance(v, (date, datetime)): return v.isoformat()
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
    allow_credentials=False,
)

# -------------------------------------------------------------------
#  Utils de esquema
# -------------------------------------------------------------------
NUMERIC_TYPES = {
    "numeric", "decimal", "double precision", "real",
    "integer", "bigint", "smallint"
}

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
    tarjeta_id: Optional[int] = None
    cuotas: Optional[int] = 1
    tipo: Optional[str] = None
    con_tarjeta: Optional[bool] = None
    es_recurrente: Optional[bool] = None
    fecha_vencimiento: Optional[str] = None

class GastoUpdate(BaseModel):
    nombre: Optional[str] = None
    monto: Optional[float] = None
    mes: Optional[int] = Field(default=None, ge=1, le=12)
    anio: Optional[int] = Field(default=None, ge=2000, le=2100)
    pagado: Optional[bool] = None
    tarjeta_id: Optional[int] = None
    cuotas: Optional[int] = None
    tipo: Optional[str] = None
    con_tarjeta: Optional[bool] = None
    es_recurrente: Optional[bool] = None
    fecha_vencimiento: Optional[str] = None

class FacturaIn(BaseModel):
    tarjeta_id: int
    mes: int = Field(ge=1, le=12)
    anio: int = Field(ge=2000, le=2100)
    total: float = Field(ge=0)

class FacturaUpdate(BaseModel):
    tarjeta_id: Optional[int] = None
    mes: Optional[int] = Field(default=None, ge=1, le=12)
    anio: Optional[int] = Field(default=None, ge=2000, le=2100)
    total: Optional[float] = Field(default=None, ge=0)
    pagada: Optional[bool] = None
    fecha_pago: Optional[date] = None

class PagoPrestamoIn(BaseModel):
    mes_contable: int = Field(ge=1, le=12)
    anio_contable: int = Field(ge=2000, le=2100)
    monto_pagado: Optional[float] = None

class GastoPagarIn(BaseModel):
    fecha: Optional[date] = None
    monto: Optional[float] = None
    metodo: Optional[str] = None
    tarjeta_id: Optional[int] = None
    nota: Optional[str] = None

# -----------------------------------------------------------
#  Helpers ensure_* para tablas opcionales
# -----------------------------------------------------------
def ensure_recurrentes(mes: int, anio: int):
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

# --- NUEVO: tarjeta_detalle --------------------------------------------
def ensure_tarjeta_detalle_table(conn):
    """
    Crea la tabla tarjeta_detalle si no existe.
    No asume índice único para permitir compatibilidad con tablas existentes.
    """
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

# -------------------------------------------------------------------
#  Recompute de totales de préstamo
# -------------------------------------------------------------------
def recompute_prestamo_totales(conn, prestamo_id: int):
    cols = get_columns(conn, "prestamos")
    if not {"valor_cuota", "cuotas_totales"}.issubset(cols):
        return

    # Datos del préstamo
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT valor_cuota, cuotas_totales
            FROM prestamos
            WHERE id = %s
        """, (prestamo_id,))
        p = cur.fetchone()
        if not p:
            return
        valor_cuota = float(p["valor_cuota"])
        cuotas_tot  = int(p["cuotas_totales"])

    # Pagos reales
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

    sets = []
    params = []

    if "monto_total" in cols:
        sets.append("monto_total = %s"); params.append(monto_total)
    if "deuda_restante" in cols:
        sets.append("deuda_restante = %s"); params.append(deuda)
    if "cuotas_pagadas" in cols:
        sets.append("cuotas_pagadas = %s"); params.append(int(pagos))
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

        # Montos derivados
        if "monto_total" in cols:
            data["monto_total"] = body.valor_cuota * body.cuotas_totales

        # Manejar 'pagado' según tipo real
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

        # Recalcula por seguridad (si cambia algo del esquema)
        recompute_prestamo_totales(conn, row["id"])
        conn.close()
        return {"ok": True, "data": _fix_json([row])[0]}
    except Exception as e:
        logging.getLogger("uvicorn.error").exception("Error al crear préstamo")
        raise HTTPException(status_code=500, detail=f"Error al crear préstamo: {e}")

@app.put("/prestamos/{id}")
def editar_prestamo(id: int, body: PrestamoIn):
    try:
        conn = get_conn()
        cols = get_columns(conn, "prestamos")
        data = {k: v for k, v in body.dict().items() if k in cols}
        if not data:
            raise HTTPException(status_code=400, detail="No hay columnas válidas que actualizar.")
        sets = [sql.SQL("{} = {}").format(sql.Identifier(k), sql.Placeholder()) for k in data.keys()]
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            q = sql.SQL("UPDATE prestamos SET {sets} WHERE id = %s RETURNING *;").format(
                sets=sql.SQL(", ").join(sets)
            )
            cur.execute(q, list(data.values()) + [id])
            row = cur.fetchone()

        # Recalcular totales si cambiaron cuotas o valor_cuota
        recompute_prestamo_totales(conn, id)
        conn.close()
        if not row:
            raise HTTPException(status_code=404, detail="Préstamo no encontrado")
        return {"ok": True, "data": _fix_json([row])[0]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al editar préstamo: {e}")

@app.post("/prestamos/{id}/pagar")
def marcar_pago_prestamo(id: int, body: PagoPrestamoIn):
    try:
        conn = get_conn()
        ensure_pagos_prestamo_table(conn)

        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT valor_cuota FROM prestamos WHERE id = %s;", (id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Préstamo no encontrado")
            default_cuota = float(row["valor_cuota"] or 0)

        monto = body.monto_pagado if body.monto_pagado is not None else default_cuota

        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO pagos_prestamo (prestamo_id, mes_contable, anio_contable, valor_cuota)
                VALUES (%s, %s, %s, %s);
            """, (id, body.mes_contable, body.anio_contable, monto))

        # 👉 ahora todo se recalcula a partir de pagos_prestamo
        recompute_prestamo_totales(conn, id)
        conn.close()
        return {"ok": True}
    except Exception as e:
        logging.getLogger("uvicorn.error").exception("Error al registrar pago")
        raise HTTPException(status_code=500, detail=f"Error al registrar pago: {e}")

@app.put("/prestamos/{id}/pagar")
def marcar_pago_prestamo_put(id: int, body: PagoPrestamoIn):
    return marcar_pago_prestamo(id, body)

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
        raise HTTPException(status_code=500, detail=f"Error al listar pagos: {e}")

# ───────────────────────────────────────────────────────────────────
# GET /prestamos/resumen  → resumen por préstamo (totales/último pago)
# ───────────────────────────────────────────────────────────────────
@app.get("/prestamos/resumen")
def listar_prestamos_resumen():
    """
    Devuelve cada préstamo con:
      - total_pagado (suma de pagos en pagos_prestamo)
      - deuda_restante = valor_cuota * cuotas_totales - total_pagado
      - ultimo_mes / ultimo_anio del último pago registrado
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
                  COALESCE(p.cuotas_pagadas, 0) AS cuotas_pagadas,
                  p.primer_mes,
                  p.primer_anio,
                  p.banco,
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
                ORDER BY p.id;
            """)
            rows = cur.fetchall()
        conn.close()
        return {"ok": True, "data": _fix_json(rows)}
    except psycopg2.errors.UndefinedTable:
        # si aún no existen tablas, devolvemos vacío
        return {"ok": True, "data": []}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al cargar resumen de préstamos: {e}")

@app.delete("/prestamos/{id}")
def eliminar_prestamo(id: int):
    try:
        conn = get_conn()
        ensure_pagos_prestamo_table(conn)
        with conn.cursor() as cur:
            cur.execute("DELETE FROM pagos_prestamo WHERE prestamo_id = %s;", (id,))
            cur.execute("DELETE FROM prestamos WHERE id = %s;", (id,))
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Préstamo no encontrado")
        conn.close()
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al eliminar préstamo: {e}")

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

# --- NUEVOS ENDPOINTS: detalle de tarjeta -----------------------------
@app.get("/tarjetas/{id}/detalle")
def get_tarjeta_detalle(id: int):
    try:
        conn = get_conn()
        ensure_tarjeta_detalle_table(conn)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM tarjeta_detalle WHERE tarjeta_id=%s;", (id,))
            row = cur.fetchone()
        conn.close()
        return {"ok": True, "data": _fix_json([row])[0] if row else None}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al leer detalle: {e}")

@app.put("/tarjetas/{id}/detalle")
def upsert_tarjeta_detalle(
    id: int,
    alias: Optional[str] = None,
    pan_last4: Optional[str] = None,
    expiracion_mes: Optional[int] = Query(default=None, ge=1, le=12),
    expiracion_anio: Optional[int] = Query(default=None, ge=2000, le=2100),
    fecha_entrega: Optional[date] = None,
    red: Optional[str] = None,
):
    """
    Upsert sin requerir índice único: si existe UPDATE, si no INSERT.
    Se aceptan parámetros por query (compatible con api.put(url, null, { params }))
    """
    try:
        conn = get_conn()
        ensure_tarjeta_detalle_table(conn)
        data = {
            "alias": alias,
            "pan_last4": pan_last4,
            "expiracion_mes": expiracion_mes,
            "expiracion_anio": expiracion_anio,
            "fecha_entrega": fecha_entrega,
            "red": red,
        }
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT id FROM tarjeta_detalle WHERE tarjeta_id=%s;", (id,))
            row = cur.fetchone()
            if row:
                sets = ", ".join([f"{k} = %s" for k in data.keys()]) + ", updated_at = NOW()"
                cur.execute(
                    f"UPDATE tarjeta_detalle SET {sets} WHERE tarjeta_id=%s RETURNING *;",
                    list(data.values()) + [id],
                )
                _ = cur.fetchone()
            else:
                cols = ["tarjeta_id"] + list(data.keys())
                vals = [id] + list(data.values())
                placeholders = ", ".join(["%s"] * len(cols))
                cur.execute(
                    f"INSERT INTO tarjeta_detalle ({', '.join(cols)}) VALUES ({placeholders}) RETURNING *;",
                    vals,
                )
                _ = cur.fetchone()
        conn.close()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al guardar detalle: {e}")

@app.delete("/tarjetas/{id}/detalle")
def delete_tarjeta_detalle(id: int):
    try:
        conn = get_conn()
        ensure_tarjeta_detalle_table(conn)
        with conn.cursor() as cur:
            cur.execute("DELETE FROM tarjeta_detalle WHERE tarjeta_id=%s;", (id,))
        conn.close()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al eliminar detalle: {e}")

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
                "SELECT * FROM gastos WHERE mes = %s AND anio = %s ORDER BY id DESC;",
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
        cols_exist = get_columns(conn, "gastos")
        data = {k: v for k, v in body.dict().items() if k in cols_exist and v is not None}
        if not data:
            raise HTTPException(status_code=400, detail="No hay columnas válidas que insertar.")
        columns = list(data.keys()); values  = list(data.values())
        placeholders = [sql.Placeholder() for _ in columns]
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            q = sql.SQL("INSERT INTO {t} ({c}) VALUES ({p}) RETURNING *;").format(
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

@app.put("/gastos/{id}")
def editar_gasto(id: int, body: GastoUpdate):
    try:
        conn = get_conn()
        cols_exist = get_columns(conn, "gastos")
        data = {k: v for k, v in body.dict(exclude_unset=True).items() if k in cols_exist}
        if not data:
            raise HTTPException(status_code=400, detail="No hay columnas válidas que actualizar.")
        sets = [sql.SQL("{} = {}").format(sql.Identifier(k), sql.Placeholder()) for k in data.keys()]
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            q = sql.SQL("UPDATE gastos SET {sets} WHERE id = %s RETURNING *;").format(
                sets=sql.SQL(", ").join(sets)
            )
            cur.execute(q, list(data.values()) + [id])
            row = cur.fetchone()
        conn.close()
        if not row:
            raise HTTPException(status_code=404, detail="Gasto no encontrado")
        return {"ok": True, "data": _fix_json([row])[0]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al editar gasto: {e}")

@app.delete("/gastos/{id}")
def eliminar_gasto(id: int):
    try:
        conn = get_conn()
        with conn.cursor() as cur:
            cur.execute("DELETE FROM gastos WHERE id = %s;", (id,))
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Gasto no encontrado")
        conn.close()
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al eliminar gasto: {e}")

@app.post("/gastos/{id}/pagar")
def pagar_gasto(id: int, body: GastoPagarIn):
    try:
        conn = get_conn()
        ensure_pagos_gasto_table(conn)

        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT id, nombre, monto, mes, anio, pagado, con_tarjeta, tarjeta_id
                FROM gastos WHERE id = %s;
            """, (id,))
            gasto = cur.fetchone()

        if not gasto:
            raise HTTPException(status_code=404, detail="Gasto no encontrado")

        pagado_val = gasto.get("pagado", False)
        try:
            ya_pagado = bool(pagado_val) if isinstance(pagado_val, bool) else int(pagado_val) == 1
        except Exception:
            ya_pagado = bool(pagado_val)
        if ya_pagado:
            raise HTTPException(status_code=409, detail="El gasto ya está marcado como pagado")

        fecha = body.fecha or date.today()
        monto = body.monto if body.monto is not None else float(gasto["monto"] or 0)
        metodo = body.metodo or ("Crédito" if gasto.get("con_tarjeta") else "Efectivo/Débito")
        tarjeta_id = body.tarjeta_id if body.tarjeta_id is not None else gasto.get("tarjeta_id")
        nota = body.nota

        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO pagos_gasto (gasto_id, fecha, monto, metodo, tarjeta_id, nota)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING *;
            """, (id, fecha, monto, metodo, tarjeta_id, nota))
            pago_row = cur.fetchone()
            cur.execute("UPDATE gastos SET pagado = TRUE WHERE id = %s;", (id,))

        conn.close()
        return {"ok": True, "data": _fix_json([pago_row])[0]}
    except HTTPException:
        raise
    except Exception as e:
        logging.getLogger("uvicorn.error").exception("Error al pagar gasto")
        raise HTTPException(status_code=500, detail=f"Error al pagar gasto: {e}")

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
                   f.mes, f.anio, f.total, f.pagada, f.fecha_pago, f.created_at
            FROM facturas f
            LEFT JOIN tarjetas t ON t.id = f.tarjeta_id
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

@app.put("/facturas/{id}")
def editar_factura(id: int, body: FacturaUpdate):
    try:
        conn = get_conn()
        ensure_facturas_table(conn)

        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM facturas WHERE id=%s;", (id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Factura no encontrada")

        data = body.dict(exclude_unset=True)
        if "pagada" in data:
            if data["pagada"] and not data.get("fecha_pago"):
                data["fecha_pago"] = date.today()
            if data["pagada"] is False:
                data["fecha_pago"] = None

        if not data:
            return {"ok": True}

        sets = [sql.SQL("{} = {}").format(sql.Identifier(k), sql.Placeholder()) for k in data.keys()]
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            q = sql.SQL("UPDATE facturas SET {sets} WHERE id = %s RETURNING *;").format(
                sets=sql.SQL(", ").join(sets)
            )
            cur.execute(q, list(data.values()) + [id])
            row2 = cur.fetchone()
        conn.close()
        return {"ok": True, "data": _fix_json([row2])[0]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al editar factura: {e}")

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
            "/prestamos", "/prestamos/{id}/pagar", "/prestamos/{id}/pagos", "/prestamos/resumen",
            "/gastos", "/gastos/{id}/pagar",
            "/tarjetas", "/tarjetas/{id}/detalle",
            "/facturas",
        ],
    }

@app.options("/{full_path:path}")
def preflight(full_path: str):
    return Response(status_code=200)

