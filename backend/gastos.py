# backend/gastos.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from decimal import Decimal
from sqlalchemy import func
from db import get_db
from auth import get_current_user
from models import Gasto
from schemas import GastoCreate, GastoUpdate

router = APIRouter(prefix="/gastos", tags=["Gastos"])

@router.get("", dependencies=[Depends(get_current_user)])
def listar_gastos(db: Session = Depends(get_db)):
    rows = (
        db.query(Gasto)
        .order_by(Gasto.anio.desc().nullslast(),
                  Gasto.mes.desc().nullslast(),
                  Gasto.id.desc())
        .all()
    )
    items = []
    for r in rows:
        monto = float(r.monto) if isinstance(r.monto, (int, float, Decimal)) else 0.0
        items.append({
            "id": r.id,
            "nombre": r.nombre,
            "monto": monto,
            "mes": r.mes,
            "anio": r.anio,
            "pagado": bool(r.pagado),
        })
    return {"items": items, "total": len(items)}

@router.post("", dependencies=[Depends(get_current_user)])
def crear_gasto(body: GastoCreate, db: Session = Depends(get_db)):
    g = Gasto(
        nombre=body.nombre,
        monto=body.monto,
        mes=body.mes,
        anio=body.anio,
        pagado=body.pagado,
    )
    db.add(g)
    db.commit()
    db.refresh(g)
    return {"ok": True, "id": g.id}

@router.put("/{gid}", dependencies=[Depends(get_current_user)])
def actualizar_gasto(gid: int, body: GastoUpdate, db: Session = Depends(get_db)):
    g = db.query(Gasto).filter(Gasto.id == gid).first()
    if not g:
        raise HTTPException(status_code=404, detail="Gasto no encontrado")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(g, field, value)
    db.commit()
    db.refresh(g)
    return {"ok": True}

@router.delete("/{gid}", dependencies=[Depends(get_current_user)])
def borrar_gasto(gid: int, db: Session = Depends(get_db)):
    g = db.query(Gasto).filter(Gasto.id == gid).first()
    if not g:
        raise HTTPException(status_code=404, detail="Gasto no encontrado")
    db.delete(g)
    db.commit()
    return {"ok": True}

def _to_float(x):
    try:
        return float(x or 0)
    except Exception:
        return 0.0

@router.get("/resumen", dependencies=[Depends(get_current_user)])
def resumen_gastos(mes: int, anio: int, db: Session = Depends(get_db)):
    # Total del mes
    total_mes = db.query(func.coalesce(func.sum(Gasto.monto), 0)) \
                  .filter(Gasto.anio == anio, Gasto.mes == mes).scalar()

    # Total pagado y pendiente del mes
    total_pagado = db.query(func.coalesce(func.sum(Gasto.monto), 0)) \
                     .filter(Gasto.anio == anio, Gasto.mes == mes, Gasto.pagado == True).scalar()
    total_pendiente = db.query(func.coalesce(func.sum(Gasto.monto), 0)) \
                        .filter(Gasto.anio == anio, Gasto.mes == mes, Gasto.pagado == False).scalar()

    # Total anual (para referencia rápida)
    total_anio = db.query(func.coalesce(func.sum(Gasto.monto), 0)) \
                   .filter(Gasto.anio == anio).scalar()

    total_mes = _to_float(total_mes)
    total_pagado = _to_float(total_pagado)
    total_pendiente = _to_float(total_pendiente)
    total_anio = _to_float(total_anio)

    pct_pagado = 0.0
    if total_mes > 0:
        pct_pagado = round((total_pagado / total_mes) * 100, 1)

    return {
        "mes": mes,
        "anio": anio,
        "total_mes": total_mes,
        "total_pagado": total_pagado,
        "total_pendiente": total_pendiente,
        "total_anio": total_anio,
        "pct_pagado": pct_pagado,
    }