# (นี่คือโค้ดสำหรับไฟล์ HandBridge/models.py)
from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, Float
from sqlalchemy.orm import relationship
from database import Base # (มันจะ import 'Base' จากไฟล์ด้านบน)

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    
    # ความสัมพันธ์: 1 User มีได้หลาย Attempts
    attempts = relationship("Attempt", back_populates="owner")

class Attempt(Base):
    __tablename__ = "attempts"

    id = Column(Integer, primary_key=True, index=True)
    unit_id = Column(String)
    predicted_symbol = Column(String)
    confidence = Column(Float)
    accepted = Column(Boolean)
    
    # (สำคัญ!) นี่คือ "สะพาน" เชื่อมกลับไปหา User
    owner_id = Column(Integer, ForeignKey("users.id"))
    owner = relationship("User", back_populates="attempts")