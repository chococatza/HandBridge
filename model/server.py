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

import os
import sys
import joblib
import numpy as np
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# -------------------- Config --------------------
# ตามลำดับ: ENV > ./model/asl_svm.joblib > ./asl_svm.joblib
MODEL_PATH = os.environ.get("ASL_MODEL_PATH")
if not MODEL_PATH:
    for p in ("model/asl_svm.joblib", "asl_svm.joblib"):
        if os.path.exists(p):
            MODEL_PATH = p
            break
if not MODEL_PATH:
    MODEL_PATH = "model/asl_svm.joblib"  # ให้ error ชัดถ้าไม่มีจริง

DEFAULT_LABELS = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")

# -------------------- FastAPI --------------------
app = FastAPI(title="HandBridge ASL Inference API", version="3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)

# payload จาก frontend
class Landmarks(BaseModel):
    # 21 จุด landmark แบบ normalized [x,y,z] จาก MediaPipe
    points: List[List[float]]
    # "Left" / "Right" ถ้าไม่ได้ส่งมาก็อนุมานไม่ได้ แต่ยังรันต่อได้
    handed: Optional[str] = None

# -------------------- Model loader --------------------
def load_model_bundle(path: str):
    """รองรับทั้งไฟล์ dict และโมเดลเดี่ยว; คืน (scaler, clf, labels)"""
    if not os.path.exists(path):
        raise FileNotFoundError(f"Model file not found: {path} (cwd={os.getcwd()})")

    obj = joblib.load(path)

    if isinstance(obj, dict):
        scaler = obj.get("scaler")
        clf = obj.get("clf", obj.get("model", obj))
        labels = obj.get("labels") or obj.get("classes")
    else:
        scaler, clf, labels = None, obj, None

    # ถ้ายังไม่มี labels ให้ดึงจากโมเดล
    if labels is None and hasattr(clf, "classes_"):
        labels = clf.classes_
    if labels is None:
        labels = DEFAULT_LABELS

    labels = [str(x) for x in labels]
    return scaler, clf, labels

SCALER, CLF, LABELS = load_model_bundle(MODEL_PATH)

# -------------------- Feature builder (73 dims) --------------------
# ดัชนีที่ใช้ตรงกับตอนเทรน
FINGERTIP_IDX = [4, 8, 12, 16, 20]  # ปลายนิ้ว (thumb, index, middle, ring, pinky)
MCP_AVG_IDX   = [1, 5, 9, 13, 17]   # ใช้หารค่า scale (ระยะ wrist->MCP เฉลี่ย)

def _pairwise_dists(points: np.ndarray) -> np.ndarray:
    """คำนวณระยะทุกคู่ของปลายนิ้ว 5 จุด => 10 ค่า"""
    d = []
    for i in range(len(points)):
        for j in range(i + 1, len(points)):
            d.append(np.linalg.norm(points[i] - points[j]))
    return np.asarray(d, dtype=np.float32)  # C(5,2) = 10

def featurize(points: List[List[float]], handed: Optional[str] = None) -> np.ndarray:
    """
    สร้างฟีเจอร์เหมือนตอนเทรน:
    1) ย้ายจุดให้มีต้นกำเนิดที่ข้อมือ (wrist = landmark[0])
    2) ถ้าเป็นมือซ้าย ให้กลับแกน x (canonicalize -> ขวา)
    3) scale ด้วยค่าเฉลี่ยระยะ wrist->MCP (จุด 1,5,9,13,17)
    4) flatten ได้ 63 มิติ แล้วต่อด้วย pairwise distance ของปลายนิ้ว 10 ค่า = 73
    """
    pts = np.asarray(points, dtype=np.float32)  # (21,3)
    if pts.shape != (21, 3):
        raise ValueError(f"Expected (21,3), got {pts.shape}")

    wrist = pts[0]
    rel = pts - wrist  # ย้าย origin

    # canonicalize: มือซ้ายกลับแกน x ให้เหมือนมือขวา
    if handed and handed.lower().startswith("l"):
        rel[:, 0] *= -1.0

    # scale ด้วยระยะเฉลี่ย wrist->MCP
    palm = np.mean([np.linalg.norm(pts[i] - wrist) for i in MCP_AVG_IDX]) + 1e-6
    rel /= float(palm)

    base63 = rel.reshape(-1)         # 21*3 = 63
    tip10  = _pairwise_dists(rel[FINGERTIP_IDX])  # 10
    feat   = np.concatenate([base63, tip10]).reshape(1, -1)  # (1,73)
    return feat

# -------------------- Inference --------------------
def _label_space():
    """ลำดับคลาสที่ใช้ตอบกลับ: ใช้จาก clf.classes_ ถ้ามี เพื่อกันสลับดัชนี"""
    model_classes = getattr(CLF, "classes_", None)
    return [str(c) for c in (model_classes if model_classes is not None else LABELS)]

def infer_vector(x: np.ndarray) -> (str, float):
    """คืน (label, confidence) โดยพยายามใช้ proba ถ้ามี"""
    if SCALER is not None:
        x = SCALER.transform(x)

    space = _label_space()

    if hasattr(CLF, "predict_proba"):
        proba = CLF.predict_proba(x)[0]
        idx = int(np.argmax(proba))
        conf = float(proba[idx])
    elif hasattr(CLF, "decision_function"):
        scores = CLF.decision_function(x)
        scores = scores[0] if getattr(scores, "ndim", 1) > 1 else scores
        e = np.exp(scores - np.max(scores))
        sm = e / (np.sum(e) + 1e-12)
        idx = int(np.argmax(sm))
        conf = float(sm[idx])
    else:
        pred = CLF.predict(x)[0]
        conf = 1.0
        try:
            idx = space.index(str(pred))
        except ValueError:
            idx = int(pred) if isinstance(pred, (int, np.integer)) else 0

    label = space[idx] if 0 <= idx < len(space) else str(idx)
    return label, conf

# -------------------- Routes --------------------
@app.get("/health")
def health():
    return {"status": "ok", "model_path": MODEL_PATH, "labels": LABELS, "python": sys.version.split()[0]}

@app.get("/modelinfo")
def modelinfo():
    return {
        "model_path": MODEL_PATH,
        "labels_from_server": LABELS,
        "clf_classes_": [str(x) for x in getattr(CLF, "classes_", [])],
        "n_features_in_scaler": getattr(SCALER, "n_features_in_", None),
        "n_features_in_clf": getattr(CLF, "n_features_in_", None),
    }

@app.post("/predict")
def predict(payload: Landmarks):
    try:
        feat = featurize(payload.points, payload.handed)
        label, conf = infer_vector(feat)
        return {"label": label, "confidence": conf}
    except Exception as e:
        # โยน 400 พร้อมข้อความชัดเจนให้ frontend รู้ว่า payload ผิดตรงไหน
        raise HTTPException(status_code=400, detail=f"Inference error: {repr(e)}")

if __name__ == "__main__":
    import uvicorn
    print(f"[INFO] Model: {MODEL_PATH}")
    print(f"[INFO] Labels: {_label_space()}")
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))