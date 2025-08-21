# backend/gastos.py
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from db import get_db
from models import Gasto  # id, nombre, monto (num), mes (int), anio (int), pagado (bool)
from schemas import GastoOut, GastoCreate  # ajusta si usas otros

router = APIRouter(prefix="/gastos", tags=["Gastos"])

@router.get("", response_model=list[GastoOut])
def listar_gastos(
    mes: int | None = Query(None),
    anio: int | None = Query(None),
    pagado: bool | None = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(Gasto)

    if mes is not None:
        q = q.filter(Gasto.mes == mes)
    if anio is not None:
        q = q.filter(Gasto.anio == anio)
    if pagado is not None:
        q = q.filter(Gasto.pagado == pagado)

    q = q.order_by(Gasto.id.desc())
    return q.all()


@router.post("", response_model=GastoOut, status_code=201)
def crear_gasto(payload: GastoCreate, db: Session = Depends(get_db)):
    g = Gasto(
        nombre=payload.nombre,
        monto=payload.monto,
        mes=payload.mes,
        anio=payload.anio,
        pagado=payload.pagado,
    )
    db.add(g)
    db.commit()
    db.refresh(g)
    return g


@router.put("/{gasto_id}", response_model=GastoOut)
def actualizar_gasto(gasto_id: int, payload: GastoCreate, db: Session = Depends(get_db)):
    g = db.query(Gasto).get(gasto_id)
    if not g:
        from fastapi import HTTPException
        raise HTTPException(404, "No encontrado")
    g.nombre = payload.nombre
    g.monto = payload.monto
    g.mes = payload.mes
    g.anio = payload.anio
    g.pagado = payload.pagado
    db.commit()
    db.refresh(g)
    return g


@router.delete("/{gasto_id}", status_code=204)
def eliminar_gasto(gasto_id: int, db: Session = Depends(get_db)):
    g = db.query(Gasto).get(gasto_id)
    if g:
        db.delete(g)
        db.commit()
    return


@router.get("/resumen")
def resumen_gastos(
    mes: int | None = Query(None),
    anio: int | None = Query(None),
    pagado: bool | None = Query(None),
    db: Session = Depends(get_db),
):
    # Total del mes (si hay mes)
    q_mes = db.query(func.coalesce(func.sum(Gasto.monto), 0.0))
    if mes is not None:
        q_mes = q_mes.filter(Gasto.mes == mes)
    if anio is not None:
        q_mes = q_mes.filter(Gasto.anio == anio)
    if pagado is not None:
        q_mes = q_mes.filter(Gasto.pagado == pagado)
    total_mes = float(q_mes.scalar() or 0.0)

    # Total del año (si hay año)
    q_anio = db.query(func.coalesce(func.sum(Gasto.monto), 0.0))
    if anio is not None:
        q_anio = q_anio.filter(Gasto.anio == anio)
    if pagado is not None:
        q_anio = q_anio.filter(Gasto.pagado == pagado)
    total_anio = float(q_anio.scalar() or 0.0)

    return {"mes": total_mes, "anio": total_anio}
