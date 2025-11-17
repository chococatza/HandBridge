from datetime import timedelta # ต้องมีตัวนี้
from typing import Optional
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy.orm import Session
from .database import Base, engine, SessionLocal
from . import models, auth # ตรวจสอบว่า auth.py และ models.py ถูกต้อง
from .models import Attempt
import random
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles # สำหรับเสิร์ฟ Frontend
from pathlib import Path 

# (เพิ่ม Imports ในส่วนบนสุดของ main.py)
import pandas as pd # <-- ต้องมี Pandas เพื่อรองรับ build_metrics
from .. import dashboard # <-- (ใหม่!) Import ไฟล์ dashboard.py
# ... (Imports เดิมของคุณ) ...

# --- 1. การประกาศ APP และ Configuration ---
BASE_DIR = Path(__file__).resolve().parent 
app = FastAPI()

# การตั้งค่า Token และ Security
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

# การตั้งค่า CORS 
origins = [
    "http://localhost",
    "http://127.0.0.1:8000",
    "http://127.0.0.1:5500",
    "*" # สำหรับการทดสอบ
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- 2. Pydantic Schemas ---
# (ใช้สำหรับ Input/Output Data Validation)

class Keypoint(BaseModel):
    x: float
    y: float
    z: float

class EvalReq(BaseModel):
    unitId: str
    inputType: str
    keypoints: list[Keypoint]
    handedness: str | None = None

class UserBase(BaseModel):
    username: str

class UserCreate(UserBase):
    password: str

class User(UserBase):
    id: int
    class Config:
        orm_mode = True # ใช้กับ SQLAlchemy

# --- 3. Database Setup และ Dependency ---
Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ฟังก์ชันสำหรับดึง User จาก Token (ใช้เป็น Dependency)
def get_current_user(db: Session = Depends(get_db), token: str = Depends(oauth2_scheme)):
    payload = auth.decode_access_token(token)
    if payload is None:
        raise HTTPException(status_code=401, detail="Invalid authentication credentials")
        
    username: str = payload.get("sub")
    if username is None:
        raise HTTPException(status_code=401, detail="Invalid authentication credentials")
        
    user = db.query(models.User).filter(models.User.username == username).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
        
    return user


# --- 4. API ROUTES (ต้องอยู่เหนือ Mounts) ---

@app.get("/health")
def health():
    return {"status": "ok"}

# --- ROUTE สำหรับดึงข้อมูล Dashboard (ต้องอยู่เหนือ app.mount) ---

@app.get("/dashboard/metrics")
def get_dashboard_metrics():
    # 1. โหลดข้อมูล (ใช้ Logic จาก dashboard.py)
    df = dashboard.load_attempts(dashboard.DB_PATH)
    
    # 2. คำนวณ Metrics
    total, correct, acc, by_unit = dashboard.build_metrics(df)

    # 3. เตรียมข้อมูลสำหรับส่งกลับ (แปลง DataFrame เป็น List/Dict)
    return {
        "total_attempts": total,
        "correct_attempts": correct,
        "overall_accuracy": round(acc, 4),
        "accuracy_display": dashboard.format_pct(acc),
        "per_unit_performance": by_unit.to_dict(orient="records") # ส่งตารางแยกรายตัวอักษร
    }

# --- (ตามด้วย @app.post("/evaluate"), @app.post("/token"), ฯลฯ) ---

# --- (ตามด้วย app.mounts ที่อยู่ล่างสุด) ---

@app.post("/register", response_model=User)
def register_user(user: UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(models.User).filter(models.User.username == user.username).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered")
    
    print(f"DEBUG: Password length received by Python: {len(user.password)}") 
    print(f"DEBUG: Password starts with: {user.password[:10]}")
    
    hashed_password = auth.get_password_hash(user.password)
    new_user = models.User(username=user.username, hashed_password=hashed_password)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user

@app.post("/token")
def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.username == form_data.username).first()
    
    if not user or not auth.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    access_token_expires = timedelta(minutes=auth.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = auth.create_access_token(
        data={"sub": user.username, "user_id": user.id}, expires_delta=access_token_expires
    )
    
    return {"access_token": access_token, "token_type": "bearer"}

@app.post("/evaluate")
def evaluate(req: EvalReq, db: Session = Depends(get_db)):
    # ... (โค้ด AI ของคุณ) ...
    return {
        "prediction": {"symbol": "B", "confidence": 0.95}, # (ตัวอย่างสมมติ)
        "accepted": True
    }


# --- 5. STATIC FILE SERVING (ต้องอยู่ล่างสุด!) ---

# 1. เสิร์ฟ "สมอง AI" จาก /static (ถ้าคุณใช้)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")

# 2. เสิร์ฟ "หน้าเว็บ" (HTML, CSS, JS, Images) จาก /
app.mount("/", StaticFiles(directory=BASE_DIR / "public", html=True), name="public")
