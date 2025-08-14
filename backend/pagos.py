# backend/pagos.py
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session
from sqlalchemy import text

# usa tu get_db desde db.py
from db import get_db

router = APIRouter()

# ---------- Insert directo en pagos_gasto ----------
class PagoGastoIn(BaseModel):
    gasto_id: int
    fecha: str         # "YYYY-MM-DD"
    monto: float
    metodo: str        # "efectivo" | "debito" | "credito"
    tarjeta_id: int | None = None

    @field_validator("metodo")
    @classmethod
    def validar_metodo(cls, v):
        v2 = (v or "").lower()
        if v2 not in {"efectivo","debito","credito"}:
            raise ValueError("metodo debe ser efectivo|debito|credito")
        return v2

@router.post("/pagos_gasto", status_code=201)
def crear_pago_gasto(p: PagoGastoIn, db: Session = Depends(get_db)):
    try:
        db.execute(
            text("""
                INSERT INTO pagos_gasto (gasto_id, fecha, monto, metodo, tarjeta_id)
                VALUES (:gasto_id, :fecha, :monto, :metodo, :tarjeta_id)
            """),
            {
                "gasto_id": p.gasto_id,
                "fecha": p.fecha,
                "monto": p.monto,
                "metodo": p.metodo,
                "tarjeta_id": p.tarjeta_id
            }
        )
        db.commit()
        return {"ok": True}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

# ---------- (Opcional) Pagar y marcar como pagado en un paso ----------
class PagarIn(BaseModel):
    fecha: str
    monto: float
    metodo: str
    tarjeta_id: int | None = None

    @field_validator("metodo")
    @classmethod
    def validar_metodo(cls, v):
        v2 = (v or "").lower()
        if v2 not in {"efectivo","debito","credito"}:
            raise ValueError("metodo debe ser efectivo|debito|credito")
        return v2

@router.post("/gastos/{gasto_id}/pagar", status_code=200)
def pagar_gasto(gasto_id: int, body: PagarIn, db: Session = Depends(get_db)):
    try:
        # 1) registrar pago
        db.execute(
            text("""
                INSERT INTO pagos_gasto (gasto_id, fecha, monto, metodo, tarjeta_id)
                VALUES (:gasto_id, :fecha, :monto, :metodo, :tarjeta_id)
            """),
            {
                "gasto_id": gasto_id,
                "fecha": body.fecha,
                "monto": body.monto,
                "metodo": body.metodo,
                "tarjeta_id": body.tarjeta_id
            }
        )
        # 2) marcar gasto como pagado
        con_tarjeta = (body.metodo == "credito")
        db.execute(
            text("""
                UPDATE gastos
                   SET pagado = TRUE,
                       con_tarjeta = :con_tarjeta,
                       tarjeta_id = :tarjeta_id
                 WHERE id = :gasto_id
            """),
            {
                "gasto_id": gasto_id,
                "con_tarjeta": con_tarjeta,
                "tarjeta_id": body.tarjeta_id if con_tarjeta else None
            }
        )
        db.commit()
        return {"ok": True}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
