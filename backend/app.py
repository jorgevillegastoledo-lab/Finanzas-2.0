# backend/app.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import prestamos, gastos, tarjetas, facturas, health

app = FastAPI(title="Finanzas API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# monta routers
app.include_router(health.router)
app.include_router(prestamos.router)
app.include_router(gastos.router)
app.include_router(tarjetas.router)
app.include_router(facturas.router)

@app.get("/")
def root():
    return {"name": "Finanzas API", "ok": True}
