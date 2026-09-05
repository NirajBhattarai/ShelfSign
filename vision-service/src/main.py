from fastapi import FastAPI

from src.api import cmos, vision

app = FastAPI(title="ShelfSign Vision Service")

app.include_router(cmos.router, prefix="/cmos", tags=["cmos"])
app.include_router(vision.router, prefix="/vision", tags=["vision"])


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
