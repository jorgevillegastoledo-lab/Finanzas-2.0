# routers/formas_pago.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from core.dbutils import get_conn

router = APIRouter(prefix="/formas-pago", tags=["Formas de pago"])

# --- Schemas ---
class FormaPagoIn(BaseModel):
    nombre: str
    activo: Optional[bool] = True

class FormaPagoOut(FormaPagoIn):
    id: int

# --- Endpoints ---
@router.get("/", response_model=List[FormaPagoOut])
def listar_formas_pago(activos: Optional[bool] = None):
    """Listar todas las formas de pago. Filtra por activos si se pasa el flag."""
    with get_conn() as conn, conn.cursor() as cur:
        if activos is None:
            cur.execute("SELECT id, nombre, activo FROM formas_pago ORDER BY id")
        else:
            cur.execute("SELECT id, nombre, activo FROM formas_pago WHERE activo=%s ORDER BY id", (activos,))
        rows = cur.fetchall()
        return [{"id": r[0], "nombre": r[1], "activo": r[2]} for r in rows]

@router.post("/", response_model=FormaPagoOut)
def crear_forma_pago(data: FormaPagoIn):
    """Crear una nueva forma de pago"""
    with get_conn() as conn, conn.cursor() as cur:
        try:
            cur.execute(
                "INSERT INTO formas_pago (nombre, activo) VALUES (%s, %s) RETURNING id",
                (data.nombre, data.activo),
            )
            new_id = cur.fetchone()[0]
            conn.commit()
        except Exception as e:
            raise HTTPException(status_code=409, detail=f"No se pudo crear: {e}")
    return {"id": new_id, **data.dict()}

@router.put("/{forma_id}", response_model=FormaPagoOut)
def editar_forma_pago(forma_id: int, data: FormaPagoIn):
    """Editar una forma de pago existente"""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE formas_pago SET nombre=%s, activo=%s WHERE id=%s RETURNING id",
            (data.nombre, data.activo, forma_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Forma de pago no encontrada")
        conn.commit()
    return {"id": forma_id, **data.dict()}
