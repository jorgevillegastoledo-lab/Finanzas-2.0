from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from db import Base, engine, get_db
import models
import crud
import schemas
from auth import router as auth_router, get_current_user, User

# Crea tablas (incluye users/usuarios)
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Finanzas 2.0 - Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Rutas de autenticación
app.include_router(auth_router)

@app.get("/")
def raiz():
    return {"mensaje": "API funcionando correctamente"}

@app.get("/me")
def me(current: User = Depends(get_current_user)):
    return {"id": current.id, "email": current.email}

# ---- Endpoints de ejemplo protegidos (usuarios demo) ----
@app.post("/usuarios", response_model=schemas.UsuarioOut)
def crear_usuario(usuario: schemas.UsuarioCreate, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    return crud.crear_usuario(db, usuario)

@app.get("/usuarios", response_model=list[schemas.UsuarioOut])
def listar_usuarios(db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    return crud.listar_usuarios(db)

