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

os.environ["PGSYSCONFDIR"] = str(SAFE_DIR)                 # buscar aquí pg_service.conf
os.environ["PGSERVICEFILE"] = str(SAFE_DIR / "pg_service.conf")
os.environ["PGPASSFILE"] = str(SAFE_DIR / "pgpass.conf")
os.environ["PGSERVICE"] = ""                               # no usar 'service'
os.environ["PGCLIENTENCODING"] = "utf8"
os.environ.pop("DATABASE_URL", None)                       # ignorar si existe

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
    allow_credentials=False,  # usamos Bearer/headers, no cookies
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
    banco: Optional[str] = None  # deja None si tu tabla no tiene esta columna

# -------------------------------------------------------------------
#  Endpoints
# -------------------------------------------------------------------
@app.get("/health")
def health():
    return {"ok": True}

@app.get("/prestamos")
def listar_prestamos():
    try:
        conn = get_conn()
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM prestamos;")  # sin ORDER BY id para no asumir columna
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
            "banco": body.banco,
        }
        # Insertar solo columnas que realmente existan y no sean None
        data = {k: v for k, v in data.items() if k in cols_exist and v is not None}
        if not data:
            raise HTTPException(status_code=400, detail="No hay columnas válidas que insertar.")

        columns = list(data.keys())
        values = list(data.values())
        placeholders = [sql.Placeholder() for _ in columns]

        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            query = sql.SQL("INSERT INTO {t} ({cols}) VALUES ({vals}) RETURNING *;").format(
                t=sql.Identifier("prestamos"),
                cols=sql.SQL(", ").join(map(sql.Identifier, columns)),
                vals=sql.SQL(", ").join(placeholders),
            )
            cur.execute(query, values)
            row = cur.fetchone()
        conn.close()
        return {"ok": True, "data": _fix_json([row])[0] if row else None}
    except Exception as e:
        logging.getLogger("uvicorn.error").exception("Error al crear préstamo")
        raise HTTPException(status_code=500, detail=f"Error al crear préstamo: {e}")

@app.get("/gastos")
def listar_gastos(
    mes: int = Query(..., ge=1, le=12),
    anio: int = Query(..., ge=2000, le=2100),
):
    try:
        conn = get_conn()
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM gastos WHERE mes = %s AND anio = %s;", (mes, anio))
            rows = cur.fetchall()
        conn.close()
        return {"ok": True, "data": _fix_json(rows)}
    except psycopg2.errors.UndefinedTable:
        return {"ok": True, "data": []}
    except Exception as e:
        logging.getLogger("uvicorn.error").exception("Error al cargar gastos")
        raise HTTPException(status_code=500, detail=f"Error al cargar gastos: {e}")

@app.get("/")
def root():
    return {"name": "Finanzas API", "endpoints": ["/health", "/prestamos", "/gastos"]}

# Manejo amable de preflight (CORS)
@app.options("/{full_path:path}")
def preflight(full_path: str):
    return Response(status_code=200)
