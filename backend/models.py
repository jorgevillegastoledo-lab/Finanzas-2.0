from sqlalchemy import Column, Integer, String, UniqueConstraint
from db import Base

# Modelo simple de prueba que ya tenías (lo dejo por compatibilidad)
class Usuario(Base):
    __tablename__ = "usuarios"
    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)

# Usuario real para autenticación
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)

    __table_args__ = (UniqueConstraint('email', name='uq_users_email'),)
