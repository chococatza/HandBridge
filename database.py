# (นี่คือโค้ดสำหรับไฟล์ HandBridge/database.py)
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# (สำคัญ!) Path นี้จะ "ถอย" ออกไปสร้างไฟล์ asl.db
# ที่โฟลเดอร์แม่ (HandBridge/asl.db)
SQLALCHEMY_DATABASE_URL = "sqlite:///../asl.db" 

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