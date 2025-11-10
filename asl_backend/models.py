from sqlalchemy import Column, Integer, String, Float, Boolean
from database import Base

class Attempt(Base):
    __tablename__ = "attempts"

    id = Column(Integer, primary_key=True, index=True)
    unit_id = Column(String, index=True)          # ตัวอักษรที่ฝึก เช่น 'A'
    predicted_symbol = Column(String)             # ตัวที่โมเดลทำนายได้
    confidence = Column(Float)                    # ค่าความมั่นใจ
    accepted = Column(Boolean)                    # ถูกหรือไม่ (True/False)
