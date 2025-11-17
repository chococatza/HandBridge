from datetime import datetime, timedelta
from typing import Optional
from passlib.context import CryptContext
from jose import JWTError, jwt

# --- 1. การตั้งค่า Token และ Password Hashing (แก้ไขตรงนี้!) ---
# เปลี่ยนไปใช้ pbkdf2_sha256 ซึ่งเสถียรกว่า (ไม่ขึ้นกับ C-library)
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto") 
SECRET_KEY = "YOUR_SUPER_SECRET_KEY_REPLACE_ME_NOW" 
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30 

# --- 2. ฟังก์ชันเข้ารหัสและตรวจสอบ Password (โค้ดส่วนอื่นเหมือนเดิม) ---
def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    # (เราไม่ต้องตัด String 72 ตัวอักษรอีกต่อไป เพราะ pbkdf2 ไม่จำกัดแบบ bcrypt)
    return pwd_context.hash(password) 

# ... (โค้ดส่วนสร้าง Token ที่เหลือเหมือนเดิม) ...

# --- 3. ฟังก์ชันสร้าง JWT Token ---
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

# --- 4. ฟังก์ชันตรวจสอบ Token ---
def decode_access_token(token: str):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None