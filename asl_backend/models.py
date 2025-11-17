from sqlalchemy import Column, Integer, String, Float, Boolean
from .database import Base

# ในไฟล์ asl_backend/models.py
# (Model Attempt ของคุณอยู่ด้านล่าง User)
from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from .database import Base

class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String) # เก็บ Password ที่เข้ารหัสแล้ว
    
    # เพิ่มความสัมพันธ์กับตาราง Attempt (ถ้าต้องการ)
    attempts = relationship("Attempt", back_populates="owner")
    
# (***ตรวจสอบ:*** คุณอาจจะต้องเพิ่มคอลัมน์ owner_id ในตาราง Attempt ด้วย)
# (Class Attempt ของคุณอยู่ต่อด้านล่าง...)
    # เราสามารถเพิ่มคอลัมน์ progress_data เพื่อเก็บสถานะ A-Z ได้ในอนาคต

# (Model Attempt ของคุณยังอยู่เหมือนเดิม)

class Attempt(Base):
    __tablename__ = "attempts"

    id = Column(Integer, primary_key=True, index=True)
    unit_id = Column(String, index=True)          # ตัวอักษรที่ฝึก เช่น 'A'
    predicted_symbol = Column(String)             # ตัวที่โมเดลทำนายได้
    confidence = Column(Float)                    # ค่าความมั่นใจ
    accepted = Column(Boolean)                    # ถูกหรือไม่ (True/False)

    owner_id = Column(Integer, ForeignKey("users.id")) # <--- คีย์นอก (สะพานเชื่อม)
    owner = relationship("User", back_populates="attempts") # <--- ความสัมพันธ์ย้อนกลับ
