from sqlalchemy.orm import Session
from models import Usuario

from schemas import UsuarioCreate

# --------- CRUD ejemplo (usuarios demo) ----------
def crear_usuario(db: Session, data: UsuarioCreate) -> Usuario:
    usuario = Usuario(**data.model_dump())
    db.add(usuario)
    db.commit()
    db.refresh(usuario)
    return usuario

def listar_usuarios(db: Session):
    return db.query(Usuario).all()
