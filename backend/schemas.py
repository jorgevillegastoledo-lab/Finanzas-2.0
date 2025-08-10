from pydantic import BaseModel, EmailStr
from typing import Optional

# -------- Auth / User --------
class UserCreate(BaseModel):
    email: EmailStr
    password: str

class UserOut(BaseModel):
    id: int
    email: EmailStr
    model_config = {"from_attributes": True}  # Pydantic v2

class Token(BaseModel):
    access_token: str            # <-- así, con doble 's'
    token_type: str = "bearer"

class LoginInput(BaseModel):
    email: EmailStr
    password: str

# -------- Gastos --------
class GastoCreate(BaseModel):
    nombre: str
    monto: float
    mes: Optional[int] = None
    anio: Optional[int] = None
    pagado: bool = False

class GastoOut(BaseModel):
    id: int
    nombre: str
    monto: float
    mes: Optional[int] = None
    anio: Optional[int] = None
    pagado: bool
    model_config = {"from_attributes": True}

class GastoUpdate(BaseModel):
    nombre: Optional[str] = None
    monto: Optional[float] = None
    mes: Optional[int] = None
    anio: Optional[int] = None
    pagado: Optional[bool] = None
