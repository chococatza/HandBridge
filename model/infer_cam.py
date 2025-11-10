import os, joblib, numpy as np, cv2, mediapipe as mp
from collections import deque

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MODEL = os.path.join(os.path.dirname(__file__), "asl_svm.joblib")

bundle = joblib.load(MODEL)
scaler, clf, classes = bundle["scaler"], bundle["clf"], bundle["classes"]

mp_hands = mp.solutions.hands
smooth = deque(maxlen=7)

def canonicalize_right_pts(pts, handed_label):
    if handed_label == 'Left':
        pts = pts.copy()
        pts[:,0] = 1.0 - pts[:,0]
    return pts

def to_features(pts):
    wrist = pts[0].copy()
    pts = pts - wrist
    scale = np.mean(np.linalg.norm(pts[[1,5,9,13,17]], axis=1)) + 1e-6
    pts = pts / scale
    ft = pts.flatten().tolist()
    tips = [4,8,12,16,20]
    for i in range(len(tips)):
        for j in range(i+1,len(tips)):
            ft.append(float(np.linalg.norm(pts[tips[i]] - pts[tips[j]])))
    return np.array(ft, dtype=np.float32).reshape(1,-1)

def main():
    cap = cv2.VideoCapture(0)
    with mp_hands.Hands(static_image_mode=False, max_num_hands=1,
                        min_detection_confidence=0.7, min_tracking_confidence=0.7) as hands:
        while True:
            ok, frame = cap.read()
            if not ok: break

            # แสดงแบบ mirror เพื่อ UX ที่คุ้นเคย
            # frame = cv2.flip(frame, 1)

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            res = hands.process(rgb)

            pred_txt = "None"
            if res.multi_hand_landmarks:
                lm = res.multi_hand_landmarks[0]
                handed = 'Right'
                try:
                    handed = res.multi_handedness[0].classification[0].label
                except Exception:
                    pass

                pts = np.array([[p.x,p.y,p.z] for p in lm.landmark], dtype=np.float32)
                pts = canonicalize_right_pts(pts, handed)
                x = to_features(pts)
                x = scaler.transform(x)

                prob = clf.predict_proba(x)[0]
                idx = int(np.argmax(prob))
                if prob[idx] >= 0.7:
                    smooth.append(classes[idx])
                else:
                    smooth.append("None")
                pred_txt = max(set(smooth), key=list(smooth).count)

                mp.solutions.drawing_utils.draw_landmarks(frame, lm, mp_hands.HAND_CONNECTIONS)

            # ย่อภาพไม่ให้ล้นจอ
            frame_resized = cv2.resize(frame, (800, 600))
            cv2.putText(frame_resized, f"Letter: {pred_txt}", (10,30),
                        cv2.FONT_HERSHEY_SIMPLEX, 1, (0,255,0), 2)
            cv2.imshow("ASL Inference (Mirror)", frame_resized)

            # กด ESC หรือ Q เพื่อปิด
            if cv2.waitKey(1) & 0xFF in [27, ord('q')]:
                break

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    main()
