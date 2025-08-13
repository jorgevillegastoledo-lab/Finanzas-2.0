# backend/main.py
from fastapi import FastAPI
from api_prestamos import r as prestamos_router

app = FastAPI()
app.include_router(prestamos_router)
