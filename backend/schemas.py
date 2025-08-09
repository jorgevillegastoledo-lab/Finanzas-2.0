from pydantic import BaseModel, EmailStr

# ------ Schemas demo (Usuario) ------
class UsuarioBase(BaseModel):
    nombre: str
    email: EmailStr

class UsuarioCreate(UsuarioBase):
    pass

class UsuarioOut(UsuarioBase):
    id: int
    class Config:
        from_attributes = True

# ------ Auth / User ------
class UserCreate(BaseModel):
    email: EmailStr
    password: str

class UserOut(BaseModel):
    id: int
    email: EmailStr
    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"

class LoginInput(BaseModel):
    email: EmailStr
    password: str
