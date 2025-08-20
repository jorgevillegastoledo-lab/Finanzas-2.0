# backend/prestamos.py
from datetime import date
from calendar import monthrange
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field, ConfigDict

from sqlalchemy import text
from db import get_db  # si usas el get_db del proyecto; abajo hay un fallback equivalente
from db import SessionLocal, Base, engine
from sqlalchemy import Column, Integer, String, DateTime, func

from auth import get_current_user  # si ya lo tienes

router = APIRouter(prefix="/prestamos", tags=["Prestamos"])

# --------- Utils ---------
def add_months(y: int, m: int, add: int) -> (int, int):
    """Suma 'add' meses a (y,m) y devuelve (nuevo_anio, nuevo_mes)."""
    total = (y * 12 + (m - 1)) + add
    ny = total // 12
    nm = (total % 12) + 1
    return ny, nm

def clamp_day(y: int, m: int, d: int) -> int:
    """Ajusta el día al máximo del mes (28/30/31)."""
    last = monthrange(y, m)[1]
    return min(d, last)

# --------- SQLAlchemy model ---------
class Prestamo(Base):
    __tablename__ = "prestamos"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, nullable=False)
    valor_cuota = Column(Integer, nullable=False)
    cuotas_totales = Column(Integer, nullable=False)
    cuotas_pagadas = Column(Integer, nullable=False, default=0)
    primer_anio = Column(Integer, nullable=False)
    primer_mes = Column(Integer, nullable=False)  # 1-12
    dia_vencimiento = Column(Integer, nullable=False)  # 1-31
    created_at = Column(DateTime, server_default=func.now())

Base.metadata.create_all(bind=engine)

# --------- Schemas ---------
class PrestamoBase(BaseModel):
    nombre: str
    valor_cuota: int = Field(gt=0)
    cuotas_totales: int = Field(gt=0)
    cuotas_pagadas: int = Field(default=0, ge=0)
    primer_anio: int = Field(ge=1900, le=2100)
    primer_mes: int = Field(ge=1, le=12)
    dia_vencimiento: int = Field(ge=1, le=31)

class PrestamoCreate(PrestamoBase):
    pass

class PrestamoUpdate(BaseModel):
    nombre: Optional[str] = None
    valor_cuota: Optional[int] = Field(None, gt=0)
    cuotas_totales: Optional[int] = Field(None, gt=0)
    cuotas_pagadas: Optional[int] = Field(None, ge=0)
    primer_anio: Optional[int] = Field(None, ge=1900, le=2100)
    primer_mes: Optional[int] = Field(None, ge=1, le=12)
    dia_vencimiento: Optional[int] = Field(None, ge=1, le=31)

class PrestamoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nombre: str
    valor_cuota: int
    cuotas_totales: int
    cuotas_pagadas: int
    primer_anio: int
    primer_mes: int
    dia_vencimiento: int

    # Derivados
    monto_pagado: int
    saldo_restante: int
    proxima_cuota: Optional[date] = None
    finalizado: bool
    vence_en_mes: bool = False  # se marca si cae en el mes/anio filtrado

# Fallback local por si no usas el import de get_db anterior
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --------- Helpers internos ---------
SENSITIVE_FIELDS = {"valor_cuota", "cuotas_totales", "primer_anio", "primer_mes"}

def _has_pagos_registrados(db: Session, prestamo_id: int) -> bool:
    """
    Verifica si existen pagos asociados al préstamo, ya sea por contador
    'cuotas_pagadas' o por filas reales en 'pagos_prestamo'.
    """
    p = db.get(Prestamo, prestamo_id)
    if not p:
        return False
    if (p.cuotas_pagadas if hasattr(p, "cuotas_pagadas") else 0) > 0:
        return True
    try:
        cnt = db.execute(
            text("SELECT COUNT(*) FROM pagos_prestamo WHERE prestamo_id = :pid"),
            {"pid": prestamo_id},
        ).scalar()
        return bool(cnt and cnt > 0)
    except Exception:
        # Si la tabla no existe en algún entorno, no rompemos.
        return False

def build_out(p: Prestamo, mes_filtro: Optional[int] = None, anio_filtro: Optional[int] = None) -> PrestamoOut:
    cuotas_rest = max(p.cuotas_totales - p.cuotas_pagadas, 0)
    monto_pagado = p.valor_cuota * p.cuotas_pagadas
    saldo_restante = p.valor_cuota * cuotas_rest
    finalizado = p.cuotas_pagadas >= p.cuotas_totales

    proxima: Optional[date] = None
    vence_en_mes = False
    if not finalizado:
        ny, nm = add_months(p.primer_anio, p.primer_mes, p.cuotas_pagadas)
        day = clamp_day(ny, nm, p.dia_vencimiento)
        proxima = date(ny, nm, day)
        if mes_filtro and anio_filtro:
            vence_en_mes = (nm == mes_filtro and ny == anio_filtro)

    return PrestamoOut(
        id=p.id,
        nombre=p.nombre,
        valor_cuota=p.valor_cuota,
        cuotas_totales=p.cuotas_totales,
        cuotas_pagadas=p.cuotas_pagadas,
        primer_anio=p.primer_anio,
        primer_mes=p.primer_mes,
        dia_vencimiento=p.dia_vencimiento,
        monto_pagado=monto_pagado,
        saldo_restante=saldo_restante,
        proxima_cuota=proxima,
        finalizado=finalizado,
        vence_en_mes=vence_en_mes
    )

# --------- Rutas ---------
@router.get("", response_model=dict)
def listar_prestamos(
    mes: Optional[int] = Query(None, ge=1, le=12),
    anio: Optional[int] = Query(None, ge=1900, le=2100),
    db: Session = Depends(get_db),
    _user=Depends(get_current_user)
):
    prestamos = db.query(Prestamo).order_by(Prestamo.created_at.desc()).all()
    items: List[PrestamoOut] = [build_out(p, mes, anio) for p in prestamos]

    total_mes = sum(x.valor_cuota for x in items if x.vence_en_mes and not x.finalizado)
    saldo_total = sum(x.saldo_restante for x in items)
    pagado_total = sum(x.monto_pagado for x in items)

    return {
        "items": items,
        "resumen": {
            "total_mes": total_mes,
            "saldo_total": saldo_total,
            "pagado_total": pagado_total
        }
    }

@router.post("", response_model=PrestamoOut)
def crear_prestamo(
    data: PrestamoCreate,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user)
):
    if data.cuotas_pagadas > data.cuotas_totales:
        raise HTTPException(400, "Las cuotas pagadas no pueden superar las totales.")
    p = Prestamo(**data.model_dump())
    db.add(p)
    db.commit()
    db.refresh(p)
    return build_out(p)

@router.put("/{pid}", response_model=PrestamoOut)
def actualizar_prestamo(
    pid: int,
    data: PrestamoUpdate,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user)
):
    p = db.get(Prestamo, pid)
    if not p:
        raise HTTPException(404, "Préstamo no encontrado")

    changes = data.model_dump(exclude_unset=True)
    if not changes:
        return build_out(p)

    # --- BLOQUEO ESTRICTO (Opción A) ---
    if any(field in changes for field in SENSITIVE_FIELDS):
        if _has_pagos_registrados(db, pid):
            raise HTTPException(
                status_code=409,
                detail=(
                    "No puedes editar 'valor de cuota', 'cuotas totales' ni la 'fecha inicial' "
                    "(mes/año) porque este préstamo ya tiene pagos registrados. "
                    "Si el alta tuvo un error, elimina el préstamo y créalo de nuevo con los valores correctos."
                )
            )

    # Aplicar cambios permitidos
    for k, v in changes.items():
        setattr(p, k, v)

    # Validaciones básicas
    if p.cuotas_pagadas > p.cuotas_totales:
        raise HTTPException(400, "Las cuotas pagadas no pueden superar las totales.")

    db.commit()
    db.refresh(p)
    return build_out(p)

@router.post("/{pid}/pagar", response_model=PrestamoOut)
def pagar_cuota(
    pid: int,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user)
):
    p = db.get(Prestamo, pid)
    if not p:
        raise HTTPException(404, "Préstamo no encontrado")
    if p.cuotas_pagadas >= p.cuotas_totales:
        raise HTTPException(400, "El préstamo ya está completamente pagado.")
    p.cuotas_pagadas += 1
    db.commit()
    db.refresh(p)
    return build_out(p)

@router.post("/{pid}/deshacer", response_model=PrestamoOut)
def deshacer_pago(
    pid: int,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user)
):
    """
    Deshace el último pago:
      - Decrementa en 1 'cuotas_pagadas' si es > 0.
      - Si existe la tabla 'pagos_prestamo', intenta borrar el último registro (mayor año/mes/ID).
    """
    p = db.get(Prestamo, pid)
    if not p:
        raise HTTPException(404, "Préstamo no encontrado")
    if p.cuotas_pagadas <= 0:
        raise HTTPException(400, "No hay pagos para deshacer.")

    # Decrementamos el contador
    p.cuotas_pagadas -= 1

    # Intentamos limpiar el último registro de pagos_prestamo (si existe la tabla)
    try:
        db.execute(text("""
            DELETE FROM pagos_prestamo
            WHERE id IN (
              SELECT id
              FROM pagos_prestamo
              WHERE prestamo_id = :pid
              ORDER BY anio_contable DESC, mes_contable DESC, id DESC
              LIMIT 1
            )
        """), {"pid": pid})
    except Exception:
        # Si la tabla no existe, no rompemos la operación de deshacer.
        pass

    db.commit()
    db.refresh(p)
    return build_out(p)

@router.delete("/{pid}")
def eliminar_prestamo(
    pid: int,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user)
):
    p = db.get(Prestamo, pid)
    if not p:
        raise HTTPException(404, "Préstamo no encontrado")
    db.delete(p)
    db.commit()
    return {"ok": True}

# Registro directo de pagos (con SQL crudo) — ruta mantenida
@router.post("/pagos_prestamo")
def registrar_pago(
    body: dict,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user)
):
    """
    Inserta un pago en pagos_prestamo. Se recomienda tener un índice único
    por (prestamo_id, mes_contable, anio_contable) para evitar duplicados.
    """
    q = text("""
      INSERT INTO pagos_prestamo (prestamo_id, mes_contable, anio_contable, valor_cuota)
      VALUES (:prestamo_id, :mes, :anio, :valor)
      RETURNING *;
    """)
    try:
        row = db.execute(q, {
            "prestamo_id": body["prestamo_id"],
            "mes": body["mes_contable"],
            "anio": body["anio_contable"],
            # si viene null, el trigger BEFORE INSERT lo completa
            "valor": body.get("valor_cuota"),
        }).mappings().first()
        db.commit()
        return row
    except Exception as e:
        # índice único o cualquier otra restricción
        raise HTTPException(400, f"No se pudo registrar el pago: {e}")
