from fastapi import FastAPI, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from database import Base, engine, SessionLocal
from models import Attempt
import random

app = FastAPI()

# สร้างตารางใน DB (ถ้ายังไม่มี)
Base.metadata.create_all(bind=engine)

# ฟังก์ชันเปิด/ปิดการเชื่อมต่อ DB (FastAPI จะเรียกให้อัตโนมัติ)
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.get("/health")
def health():
    return {"status": "ok"}

class Keypoint(BaseModel):
    x: float
    y: float
    z: float

class EvalReq(BaseModel):
    unitId: str
    inputType: str
    keypoints: list[Keypoint]
    handedness: str | None = None

@app.post("/evaluate")
def evaluate(req: EvalReq, db: Session = Depends(get_db)):
    # จำลองผลลัพธ์ (ยังไม่ต่อโมเดลจริง)
    confidence = round(random.uniform(0.7, 0.99), 2)
    prediction = req.unitId if confidence > 0.8 else "E"
    accepted = prediction == req.unitId and confidence >= 0.8

    # บันทึกลงฐานข้อมูล
    attempt = Attempt(
        unit_id=req.unitId,
        predicted_symbol=prediction,
        confidence=confidence,
        accepted=accepted
    )
    db.add(attempt)
    db.commit()

    return {
        "prediction": {"symbol": prediction, "confidence": confidence},
        "accepted": accepted
    }
