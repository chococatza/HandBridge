# server.py — HandBridge ASL Inference API (ready-to-run)
# Python 3.9+ | FastAPI + Uvicorn
# จุดเด่น:
# 1) โหลดโมเดลแบบ dict {scaler, clf, labels/classes} หรือโมเดลเดี่ยวก็ได้
# 2) featurize ให้ "เหมือนตอนเทรน" = 63 landmark + 10 pairwise distance = 73 มิติ
# 3) canonicalize มือซ้ายให้เป็นมือขวาก่อนคำนวณฟีเจอร์
# 4) มี /modelinfo ไว้เช็คคลาสและมิติฟีเจอร์

"""
HandBridge — ASL Sign Recognition Inference API
-----------------------------------------------
FastAPI server สำหรับรันโมเดล SVM (A–Z) แบบ real-time

👩‍💻 ใช้ได้ทั้งบน Mac / Windows / Linux
🧩 โมเดลรองรับแบบ dict {scaler, clf, labels}
🖐️ Feature 73 มิติ = 63 landmark + 10 pairwise distance
✋ Canonicalize มือซ้ายให้เป็นมือขวาก่อนทำนาย

# วิธีติดตั้งและรัน (ครั้งแรก)
python3 -m venv .venv
source .venv/bin/activate            # บน macOS/Linux
# หรือ .venv\Scripts\activate       # บน Windows

pip install -r requirements.txt

cd model
python server.py

เปิดเบราว์เซอร์: http://localhost:8000/docs  (Swagger UI)
หรือดูผลลัพธ์ JSON: http://localhost:8000/modelinfo
"""

# server.py (v4 - อัปเกรด)
# รวม AI (73 features) + ระบบ Login/Token

# server.py (v5 - Re-ordered)
# แก้ปัญหา 404 (images) และ 405 (predict)

# server.py (v5 - Re-ordered)
# แก้ปัญหา 404 (images) และ 405 (predict)

# server.py (v6 - FINAL w/ Dashboard Metrics API)
# รวม AI (73 features) + Login/Token + Dashboard Metrics

import os
import sys
import joblib
import numpy as np
from typing import List, Optional
from pathlib import Path 
import pandas as pd

# --- (2) "แฮก" Path (เพื่อให้ Python หาไฟล์ .py อื่นเจอ) ---
current_dir = Path(__file__).parent # -> /model
root_dir = current_dir.parent # -> /HandBridge
sys.path.append(str(root_dir)) 

# --- (1) Imports (ย้าย Imports ที่ขาดไปมาไว้บนสุด) ---
from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.orm import Session
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from datetime import timedelta
from starlette.staticfiles import StaticFiles 
from starlette.responses import FileResponse 
from dashboard import load_attempts, build_metrics, format_pct



try:
    from database import Base, engine, SessionLocal, get_db
    import models
    import auth
    # (ใหม่!) Import "Logic" ของเพื่อนคุณ
    from dashboard import load_attempts, build_metrics, format_pct
except ImportError as e:
    print(f"❌ CRITICAL ERROR: ไม่พบไฟล์ database.py, models.py, auth.py, dashboard.py ที่โฟลเดอร์หลัก!")
    print(f"   (Error: {e})")
    sys.exit(1)

# -------------------- Config --------------------
MODEL_PATH = "asl_svm.joblib" 
DEFAULT_LABELS = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")

# -------------------- FastAPI App --------------------
app = FastAPI(title="HandBridge ASL Inference API", version="5.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token") 

# -------------------- Pydantic Schemas --------------------
class UserBase(BaseModel):
    username: str
class UserCreate(UserBase):
    password: str
class User(UserBase):
    id: int
    class Config:
        orm_mode = True 
class Landmarks(BaseModel):
    points: List[List[float]]
    handed: Optional[str] = None

# -------------------- Database Setup --------------------
try:
    models.Base.metadata.create_all(bind=engine)
    print("✅ Database tables checked/created.")
except Exception as e:
    print(f"❌ DB ERROR: ไม่สามารถสร้างตารางได้: {e}")

# -------------------- Model Loader --------------------
# (โค้ด load_model_bundle เหมือนเดิม)
def load_model_bundle(path: str):
    if not os.path.exists(path):
        raise FileNotFoundError(f"Model file not found: {path} (cwd={os.getcwd()})")
    obj = joblib.load(path)
    if isinstance(obj, dict):
        scaler = obj.get("scaler")
        clf = obj.get("clf", obj.get("model", obj))
        labels = obj.get("labels") or obj.get("classes")
    else:
        scaler, clf, labels = None, obj, None
    if labels is None and hasattr(clf, "classes_"):
        labels = clf.classes_
    if labels is None:
        labels = DEFAULT_LABELS
    labels = [str(x) for x in labels]
    return scaler, clf, labels
SCALER, CLF, LABELS = load_model_bundle(MODEL_PATH)
print(f"✅ AI (SVM) Model loaded from {MODEL_PATH}")

# -------------------- Feature/Inference Functions --------------------
# (โค้ด featurize, infer_vector เหมือนเดิม)
FINGERTIP_IDX = [4, 8, 12, 16, 20]
MCP_AVG_IDX   = [1, 5, 9, 13, 17]
def _pairwise_dists(points: np.ndarray) -> np.ndarray:
    d = []
    for i in range(len(points)):
        for j in range(i + 1, len(points)):
            d.append(np.linalg.norm(points[i] - points[j]))
    return np.asarray(d, dtype=np.float32)
def featurize(points: List[List[float]], handed: Optional[str] = None) -> np.ndarray:
    pts = np.asarray(points, dtype=np.float32)
    if pts.shape != (21, 3):
        raise ValueError(f"Expected (21,3), got {pts.shape}")
    wrist = pts[0]
    rel = pts - wrist
    if handed and handed.lower().startswith("l"):
        rel[:, 0] *= -1.0
    palm = np.mean([np.linalg.norm(pts[i] - wrist) for i in MCP_AVG_IDX]) + 1e-6
    rel /= float(palm)
    base63 = rel.reshape(-1)
    tip10  = _pairwise_dists(rel[FINGERTIP_IDX])
    feat   = np.concatenate([base63, tip10]).reshape(1, -1)
    return feat
def _label_space():
    model_classes = getattr(CLF, "classes_", None)
    return [str(c) for c in (model_classes if model_classes is not None else LABELS)]
def infer_vector(x: np.ndarray) -> (str, float):
    if SCALER is not None:
        x = SCALER.transform(x)
    space = _label_space()
    if hasattr(CLF, "predict_proba"):
        proba = CLF.predict_proba(x)[0]
        idx = int(np.argmax(proba))
        conf = float(proba[idx])
    else:
        pred = CLF.predict(x)[0]
        conf = 1.0
        try:
            idx = space.index(str(pred))
        except ValueError:
            idx = int(pred) if isinstance(pred, (int, np.integer)) else 0
    label = space[idx] if 0 <= idx < len(space) else str(idx)
    return label, conf

# -------------------- (ใหม่!) Auth Functions --------------------
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

# ----------------------------------------------------
# ⭐️ "ประตู" API ทั้งหมด (ต้องอยู่ "ก่อน" Mount)
# ----------------------------------------------------
@app.get("/health")
def health():
    return {"status": "ok", "model_path": MODEL_PATH}
@app.get("/modelinfo")
def modelinfo():
    return { "n_features_in_clf": getattr(CLF, "n_features_in_", None), }

# (วางทับฟังก์ชัน /dashboard/metrics เก่า)

@app.get("/dashboard/metrics")
def get_dashboard_metrics(
    user: models.User = Depends(get_current_user), 
    db: Session = Depends(get_db)
):
    try:
        # (ใหม่!) โหลดข้อมูลโดยตรงจาก SQLAlchemy (ปลอดภัยกว่า)
        # (เราจะ "ไม่" ใช้ load_attempts(db_path) อีกต่อไป)
        
        # 1. ดึง (Query) "ทุก" attempts ของ User ที่ล็อกอิน
        # (SQLAlchemy "รู้" ว่า 'Attempt' มี 'owner_id' ครับ)
        user_attempts_query = db.query(models.Attempt).filter(models.Attempt.owner_id == user.id)
        
        # 2. แปลง (Query) เป็น Pandas DataFrame
        df = pd.read_sql(user_attempts_query.statement, db.bind)
        
        if df.empty:
            # (ถ้า User นี้ยังไม่เคยเล่น)
            return {
                "total_attempts": 0, "correct_attempts": 0,
                "overall_accuracy": 0.0, "accuracy_display": "0.0%",
                "per_unit_performance": []
            }

        # 3. คำนวณ Metrics (ด้วย Logic เดิมของเพื่อน)
        # (เรา "ยัง" ใช้ build_metrics และ format_pct จาก dashboard.py)
        total, correct, acc, by_unit = build_metrics(df)
    
        return {
            "total_attempts": total,
            "correct_attempts": correct,
            "overall_accuracy": round(acc, 4),
            "accuracy_display": format_pct(acc),
            "per_unit_performance": by_unit.to_dict(orient="records")
        }
    except Exception as e:
        print(f"Dashboard Error: {e}")
        raise HTTPException(status_code=500, detail="Error loading dashboard data")

@app.post("/register", response_model=User)
def register_user(user: UserCreate, db: Session = Depends(get_db)):
    # ... (โค้ด Register เหมือนเดิม) ...
    db_user = db.query(models.User).filter(models.User.username == user.username).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered")
    hashed_password = auth.get_password_hash(user.password)
    new_user = models.User(username=user.username, hashed_password=hashed_password)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user

@app.post("/token")
def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    # ... (โค้ด Token เหมือนเดิม) ...
    user = db.query(models.User).filter(models.User.username == form_data.username).first()
    if not user or not auth.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect username or password")
    access_token = auth.create_access_token(data={"sub": user.username, "user_id": user.id})
    return {"access_token": access_token, "token_type": "bearer"}

@app.post("/predict")
def predict(
    payload: Landmarks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user) 
):
    try:
        feat = featurize(payload.points, payload.handed)
        label, conf = infer_vector(feat)
        
        try:
            attempt = models.Attempt(
                unit_id=label, 
                predicted_symbol=label,
                confidence=conf,
                accepted=(conf > 0.8), 
                owner_id=current_user.id 
            )
            db.add(attempt)
            db.commit()
        except Exception as db_err:
            print(f"DB Save Error: {db_err}")
            db.rollback()

        return {"label": label, "confidence": conf}
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Inference error: {repr(e)}")


# ----------------------------------------------------
# ⭐️ "ประตู" หน้าบ้าน (ต้องอยู่ "ล่างสุด")
# ----------------------------------------------------
app.mount("/", StaticFiles(directory="..", html=True), name="frontend_root")


# -------------------- Main --------------------
if __name__ == "__main__":
    import uvicorn
    print(f"[INFO] Model: {MODEL_PATH}")
    print(f"[INFO] Labels: {_label_space()}")
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
