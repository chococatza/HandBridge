from fastapi import FastAPI, Depends
from fastapi.staticfiles import StaticFiles
from starlette.responses import FileResponse 
from pydantic import BaseModel
from sqlalchemy.orm import Session
from .database import Base, engine, SessionLocal
from .models import Attempt
from fastapi.middleware.cors import CORSMiddleware
import joblib
import numpy as np 
from pathlib import Path 

# --- (ใหม่!) Import สิ่งที่เรา "ขโมย" มา ---
import mediapipe as mp
import cv2
import base64
import io

# ----------------------------------------------

BASE_DIR = Path(__file__).resolve().parent 
app = FastAPI()

# --- (1) ส่วน CORS (เหมือนเดิม) ---
origins = [
    "http://localhost", "http://localhost:8000", "http://127.0.0.1:8000",
    "http://localhost:5500", "http://127.0.0.1:5500",
]
app.add_middleware(
    CORSMiddleware, allow_origins=origins, allow_credentials=True, 
    allow_methods=["*"], allow_headers=["*"],
)

# --- (2) โหลดโมเดล AI (SVM) (เหมือนเดิม) ---
MODEL_PATH = BASE_DIR.parent / "model" / "asl_svm.joblib"
try:
    model_container = joblib.load(MODEL_PATH)
    model_clf = model_container['clf']
    model_scaler = model_container['scaler']
    model_classes = model_container['classes']
    print(f"✅ AI (SVM) Model ('clf'), Scaler, and Classes loaded.")
except Exception as e:
    print(f"❌ ERROR: Failed to load SVM model. {e}")
    model_clf, model_scaler, model_classes = None, None, None

# --- (ใหม่!) (3) โหลด MediaPipe-Python (เหมือน infer_cam.py) ---
mp_hands = mp.solutions.hands
hands = mp_hands.Hands(
    static_image_mode=False, # (False = โหมดวิดีโอ)
    max_num_hands=1,
    min_detection_confidence=0.7,
    min_tracking_confidence=0.7
)
print("✅ MediaPipe (Python) Hand Detector loaded.")


# --- (4) ฟังก์ชัน Helper (คัดลอกมาจาก infer_cam.py) ---
def canonicalize_right_hand(pts, handed_label):
    if handed_label == "Left":
        pts = pts.copy()
        pts[:, 0] = 1.0 - pts[:, 0]
    return pts

def extract_static_features(pts):
    pts = pts.copy()
    wrist = pts[0].copy()
    pts -= wrist 
    mcp_idx = [1,5,9,13,17]
    scale = np.mean(np.linalg.norm(pts[mcp_idx], axis=1)) + 1e-6
    pts /= scale
    ft = pts.flatten().tolist()
    tips = [4,8,12,16,20]
    for i in range(len(tips)):
        for j in range(i+1, len(tips)):
            ft.append(float(np.linalg.norm(pts[tips[i]] - pts[tips[j]])))
    return np.array(ft, dtype=np.float32).reshape(1, -1)

# --- (5) ส่วน DB (เหมือนเดิม) ---
Base.metadata.create_all(bind=engine)
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- (6) Pydantic Models (แก้ไข!) ---
# (เราไม่รับ Keypoints แล้ว, เรารับ "ภาพ" (Base64 string))
class EvalReq(BaseModel):
    unitId: str
    image_data: str # <-- (ใหม่!) รับ "ภาพดิบ" (Base64)
    # (เราไม่ต้องการ handedness แล้ว เพราะ Python จะหาเอง)

# --- (7) "ประตู" API (แก้ไขใหม่ทั้งหมด!) ---
@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/evaluate")
def evaluate(req: EvalReq, db: Session = Depends(get_db)):

    if model_clf is None: 
        return {"error": "SVM Model is not loaded on server"}

    # (A) "แปล" ภาพดิบ (Base64) กลับเป็น "ภาพ" (CV2)
    try:
        # 1. แยกส่วนหัว (data:image/jpeg;base64,) ออก
        img_data = req.image_data.split(',')[1]
        # 2. แปลง Base64 เป็น Bytes
        img_bytes = base64.b64decode(img_data)
        # 3. แปลง Bytes เป็น NumPy array
        img_np = np.frombuffer(img_bytes, dtype=np.uint8)
        # 4. แปลง NumPy array เป็น "ภาพ" (CV2)
        frame = cv2.imdecode(img_np, cv2.IMREAD_COLOR)
        if frame is None:
            raise ValueError("Failed to decode image")
            
    except Exception as e:
        return {"error": f"Failed to process image: {e}"}

    
    # --- (B) รัน "โค้ดของเพื่อน" (infer_cam.py) ---
    try:
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        res = hands.process(rgb) # <-- (รัน MediaPipe-Python)

        # (B.1) ถ้า "ไม่เจอมือ"
        if not res.multi_hand_landmarks:
            return {
                "prediction": {"symbol": "No Hand", "confidence": 0.0},
                "accepted": False
            }

        # (B.2) ถ้า "เจอมือ"
        lm = res.multi_hand_landmarks[0]
        handed = "Right" # (Default)
        if res.multi_handedness:
            handed = res.multi_handedness[0].classification[0].label

        # (B.3) รันฟังก์ชัน Helper
        pts = np.array([[p.x, p.y, p.z] for p in lm.landmark], dtype=np.float32)
        pts_canonical = canonicalize_right_hand(pts, handed)
        input_data = extract_static_features(pts_canonical) # <-- (ได้ 73 features)
        
        # (B.4) รัน AI (SVM)
        scaled_data = model_scaler.transform(input_data)
        probabilities = model_clf.predict_proba(scaled_data)[0]
        confidence = round(float(np.max(probabilities)), 2)
        prediction_index = np.argmax(probabilities)
        prediction = model_classes[prediction_index]
    
    except Exception as e:
        return {"error": f"Model prediction failed: {e}"}

    # --- (C) บันทึกและส่งผล (เหมือนเดิม) ---
    accepted = (prediction == req.unitId) and (confidence >= 0.8)
    try:
        attempt = Attempt(unit_id=req.unitId, predicted_symbol=prediction, confidence=confidence, accepted=accepted)
        db.add(attempt)
        db.commit()
    except Exception as e:
        print(f"DB Save Error: {e}")
        db.rollback()

    return {
        "prediction": {"symbol": prediction, "confidence": confidence},
        "accepted": accepted
    }


# --- (8) เสิร์ฟไฟล์ (ต้องอยู่ล่างสุด!) ---
# (เรายังต้องเสิร์ฟไฟล์ .html, .css, .js... แต่เราไม่ต้องการ /static อีกแล้ว!)
app.mount("/", StaticFiles(directory=BASE_DIR / "public", html=True), name="public")