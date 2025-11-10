from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# ใช้ SQLite local (จะสร้างไฟล์ asl.db ในโฟลเดอร์เดียวกัน)
DATABASE_URL = "sqlite:///./asl.db"

engine = create_engine(
    DATABASE_URL, connect_args={"check_same_thread": False}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()
