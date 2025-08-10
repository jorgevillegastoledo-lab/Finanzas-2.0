# backend/models.py
from sqlalchemy import Column, Integer, String, Boolean, Numeric
from db import Base

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)

class Gasto(Base):
    __tablename__ = "gastos"
    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, nullable=False)
    monto = Column(Numeric(14, 2), nullable=False)
    mes = Column(Integer, nullable=True)
    anio = Column(Integer, nullable=True)
    pagado = Column(Boolean, default=False, nullable=False)
