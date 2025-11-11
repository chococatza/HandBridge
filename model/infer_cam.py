import os
import time
import random
import cv2
import numpy as np
import mediapipe as mp
import joblib
from collections import deque

# -------------------------
# 1) โหลดโมเดล static
# -------------------------
MODEL_PATH = os.path.join("asl_svm.joblib")
bundle = joblib.load(MODEL_PATH)
scaler = bundle["scaler"]
clf = bundle["clf"]
all_classes = bundle["classes"]

# เอาเฉพาะตัวอักษรจริง
playable_classes = [c for c in all_classes if c not in [None, "NONE", "None", "null"]]

# -------------------------
# 2) ตั้งค่า Mediapipe
# -------------------------
mp_hands = mp.solutions.hands
mp_draw = mp.solutions.drawing_utils
pred_smooth = deque(maxlen=7)

# -------------------------
# 3) ตัวแปรเกม
# -------------------------
target_letter = None
target_deadline = 0
feedback_color = None
feedback_until = 0
EVAL_WINDOW = 2.0

game_active = False
round_size = 10
letters_done = 0
score = 0
final_msg_until = 0

waiting_correct = False  # state ใหม่: ยังทำตัวนี้ไม่ถูก

# -------------------------
# 4) ฟังก์ชันฟีเจอร์
# -------------------------
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

def pick_random_letter():
    return random.choice(playable_classes)

# -------------------------
# 5) main
# -------------------------
def main():
    global target_letter, target_deadline, feedback_color, feedback_until
    global game_active, letters_done, score, final_msg_until, waiting_correct

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("❌ No camera found")
        return

    with mp_hands.Hands(static_image_mode=False, max_num_hands=1,
                        min_detection_confidence=0.7, min_tracking_confidence=0.7) as hands:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            h, w, _ = frame.shape
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            res = hands.process(rgb)

            current_pred = "?"
            hand_center = (int(w*0.5), int(h*0.5))

            if res.multi_hand_landmarks:
                lm = res.multi_hand_landmarks[0]
                xs = [p.x for p in lm.landmark]
                ys = [p.y for p in lm.landmark]
                cx, cy = int(np.mean(xs)*w), int(np.mean(ys)*h)
                hand_center = (cx, cy)

                handed = "Right"
                if res.multi_handedness:
                    handed = res.multi_handedness[0].classification[0].label

                pts = np.array([[p.x, p.y, p.z] for p in lm.landmark], dtype=np.float32)
                pts = canonicalize_right_hand(pts, handed)
                ft = extract_static_features(pts)
                ft_s = scaler.transform(ft)
                probs = clf.predict_proba(ft_s)[0]
                idx = int(np.argmax(probs))
                conf = probs[idx]
                pred_label = all_classes[idx] if conf >= 0.6 else "?"
                pred_smooth.append(pred_label)
                current_pred = max(set(pred_smooth), key=list(pred_smooth).count)

                mp_draw.draw_landmarks(frame, lm, mp_hands.HAND_CONNECTIONS)

            now = time.time()

            # จบรอบแล้ว
            if not game_active and now < final_msg_until:
                cv2.putText(frame, f"Round finished! Score: {score}/{round_size}",
                            (40, 220), cv2.FONT_HERSHEY_SIMPLEX, 1, (0,255,0), 3)
                cv2.putText(frame, "Press R to play again",
                            (40, 260), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (200,200,200), 2)

            # ------------------------
            # โหมดเกม
            # ------------------------
            if game_active and target_letter is not None:
                cv2.putText(frame, f"TARGET: {target_letter}", (10, 120),
                            cv2.FONT_HERSHEY_SIMPLEX, 1.4, (0, 255, 255), 3)

                cv2.putText(frame, f"Score: {score}", (w - 200, 40),
                            cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
                cv2.putText(frame, f"{letters_done+1}/{round_size}", (w - 200, 80),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 200, 255), 2)

                # ถูกต้อง → ไปตัวใหม่
                if current_pred == target_letter and now <= target_deadline:
                    feedback_color = (0, 255, 0)
                    feedback_until = now + 0.5
                    score += 1
                    letters_done += 1
                    waiting_correct = False

                    if letters_done >= round_size:
                        game_active = False
                        target_letter = None
                        final_msg_until = time.time() + 5
                    else:
                        target_letter = pick_random_letter()
                        target_deadline = time.time() + EVAL_WINDOW

                # หมดเวลา แต่ยังไม่ถูก → หักคะแนนแต่ไม่ขยับ
                elif now > target_deadline and current_pred != target_letter:
                    feedback_color = (0, 0, 255)
                    feedback_until = now + 0.5
                    score = max(0, score - 1)
                    target_deadline = time.time() + EVAL_WINDOW
                    waiting_correct = True

                # แถบเวลานับถอยหลัง
                total = EVAL_WINDOW
                remain = max(0.0, target_deadline - now)
                ratio = remain / total
                cv2.rectangle(frame, (10, 150), (310, 170), (50,50,50), -1)
                cv2.rectangle(frame, (10, 150), (10+int(300*ratio),170), (0,255,255), -1)

            # feedback
            if feedback_color is not None and now <= feedback_until:
                cv2.circle(frame, hand_center, 80, feedback_color, 6)
            if feedback_color is not None and now > feedback_until:
                feedback_color = None

            cv2.putText(frame, f"Detected: {current_pred}", (10, 40),
                        cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
            cv2.putText(frame, "Press R = start 10-round challenge | S = skip | Q = quit",
                        (10, h-20), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (220,220,220), 1)

            cv2.imshow("ASL Challenge Mode", frame)

            key = cv2.waitKey(1) & 0xFF
            if key in [ord('q'), 27]:
                break
            elif key == ord('r'):
                game_active = True
                score = 0
                letters_done = 0
                target_letter = pick_random_letter()
                target_deadline = time.time() + EVAL_WINDOW
                final_msg_until = 0
                waiting_correct = False
                print("🎯 start new round:", target_letter)
            elif key == ord('s') and game_active:
                letters_done += 1
                waiting_correct = False
                if letters_done >= round_size:
                    game_active = False
                    target_letter = None
                    final_msg_until = time.time() + 5
                else:
                    target_letter = pick_random_letter()
                    target_deadline = time.time() + EVAL_WINDOW
                    print("➡️ skip to:", target_letter)

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    main()