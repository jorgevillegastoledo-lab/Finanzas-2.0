# backend/app.py
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from db import Base, engine, SessionLocal
from auth import router as auth_router, get_current_user
from gastos import router as gastos_router  # <-- nuevo

app = FastAPI(title="Finanzas 2.0 - Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# crea tablas (users, gastos, etc.)
Base.metadata.create_all(bind=engine)

# Routers
app.include_router(auth_router)
app.include_router(gastos_router)

@app.get("/")
def raiz():
    return {"ok": True, "api": "Finanzas 2.0"}

@app.get("/me")
def me(user = Depends(get_current_user)):
    return {"id": user.id, "email": user.email}

# Diagnóstico opcional
@app.get("/diag/db")
def diag_db():
    db = SessionLocal()
    try:
        ver = db.execute(text("SELECT version()")).scalar()
        tablas = db.execute(text("""
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema='public'
            ORDER BY table_name
        """)).fetchall()
        return {"ok": True, "version": ver, "tablas": [t[0] for t in tablas]}
    finally:
        db.close()

