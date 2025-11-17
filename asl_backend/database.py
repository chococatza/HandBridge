# (นี่คือโค้ดสำหรับไฟล์ HandBridge/database.py)
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from pathlib import Path # (ใหม่!)

# --- (นี่คือ "วิธีแก้" ครับ) ---
# 1. หา "ที่อยู่" ของโฟลเดอร์แม่ (HandBridge/)
BASE_DIR = Path(__file__).resolve().parent 

# 2. "สร้าง" Path ของ DB (HandBridge/asl.db)
SQLALCHEMY_DATABASE_URL = f"sqlite:///{BASE_DIR / 'asl.db'}"
# --- (จบ "วิธีแก้") ---


engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# (สำคัญ!) นี่คือฟังก์ชันที่ Error ตามหา
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()