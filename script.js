/* script.js — HandBridge client (เสถียร, กันโหลดซ้ำ, ไม่ชนฟังก์ชันของ mediapipe) */

if (window.__HB_SCRIPT_LOADED) {
  console.warn('[HB] script reloaded – skipping duplicate init');
} else {
  window.__HB_SCRIPT_LOADED = true;

  /* ================= HandBridge runtime constants ================= */
  const API_URL = "http://localhost:8000/predict"; // แก้พอร์ตถ้ารัน uvicorn คนละพอร์ต

  // เกณฑ์ UI (เริ่มผ่อนให้เล่นได้ก่อน แล้วค่อยปรับเข้มขึ้นทีหลัง)
  const CONF_TH = 0.55;      // ความมั่นใจขั้นต่ำเพื่อเริ่มนับ PASS
  const PASS_FRAMES = 3;     // ต้องถูกติดกันกี่เฟรมถึงจะ PASS
  const VOTE_WINDOW = 7;     // ลงคะแนนเสียงข้างมากจากหลายเฟรม
  const NONE_LABEL = "None"; // คลาส "พักมือ" จากโมเดล

  let lastSent = 0;
  const SEND_EVERY_MS = 250; // ยิง API ทุก 250ms
  let votes = [];
  let passedFrames = 0;
  let gameTimer = null, gameTarget = null, gameRemain = 0;

  // ========== Example Pose Loader (ไม่ง้อกล้อง) ==========
  function getTargetLetterForImage() {
    const l = (new URLSearchParams(location.search).get("letter") || "A").toUpperCase();
    return /^[A-Z]$/.test(l) ? l : "A";
  }

  function loadExamplePose() {
    const img = document.getElementById("example-image");
    if (!img) return;

    const letter = getTargetLetterForImage();
    const src = `images/example-${letter}.jpg`;  // ปรับให้ตรงโฟลเดอร์นาย

    // ซ่อนจนกว่าจะโหลดสำเร็จ จะได้ไม่เห็นกรอบว่าง
    img.style.visibility = "hidden";
    img.onload = () => { img.style.visibility = "visible"; };
    img.onerror = () => {
      console.warn(`[HB] missing example image: ${src} -> fallback`);
      img.src = "images/example-default.jpg";     // ทำรูปสำรองไว้สักรูป
      img.style.visibility = "visible";
    };

    img.src = src;
    img.alt = `Example Pose for ${letter}`;

    // อัปเดตหัวข้อบนหน้าให้ตรงด้วย
    const title = document.getElementById("current-letter");
    if (title) title.textContent = letter;
  }

  // เรียกทันทีเมื่อหน้าโหลด อย่ารอกล้อง
  window.addEventListener("DOMContentLoaded", loadExamplePose);

  document.addEventListener('DOMContentLoaded', () => {
    const path = location.pathname;
    if (path.includes('practice')) initHands().then(initPractice);
    if (path.includes('game')) initHands().then(initGame);
  });

  async function initHands() {
    if (window.__hbHands) { console.warn('[HB] reuse Hands instance'); return; }

    const videoEl = document.getElementById('webcam-feed') || document.querySelector('video');
    if (!videoEl) { console.error('[HB] no <video id="webcam-feed">'); return; }

    // สร้าง canvas หากยังไม่มี
    let canvasEl = document.getElementById('overlay');
    if (!canvasEl) {
      canvasEl = document.createElement('canvas');
      canvasEl.id = 'overlay'; canvasEl.width = 640; canvasEl.height = 480;
      videoEl.insertAdjacentElement('afterend', canvasEl);
    }

    // เริ่มกล้องก่อน (ช่วย Safari/บางบราวเซอร์)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
      videoEl.srcObject = stream;
      await videoEl.play();
      const loading = document.getElementById('webcam-loading');
      if (loading) loading.style.display = 'none';
    } catch (e) {
      console.error('[HB] webcam error', e);
    }

    const hands = new Hands({
      locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`
    });
    hands.setOptions({
      selfieMode: true, maxNumHands: 1, modelComplexity: 1,
      minDetectionConfidence: 0.6, minTrackingConfidence: 0.6
    });

    function getTargetLetter() {
      const url = new URL(location.href);
      const l = (url.searchParams.get("letter") || "A").toUpperCase();
      return /^[A-Z]$/.test(l) ? l : "A";
    }

    hands.onResults(async (results) => {
      renderHands(results);

      if (!results?.multiHandLandmarks?.length) {
        updatePracticeUI(getTargetLetter(), NONE_LABEL, 0);
        return;
      }

      const lm = results.multiHandLandmarks[0];
      const handed = results?.multiHandedness?.[0]?.label || null; // "Left" / "Right"
      const pred = await callBackend(lm, handed);
      if (!pred) return;

      const target = getTargetLetter();
      const { label, confidence } = pred;

      // เก็บโหวตเฉพาะที่ดูมีน้ำหนักพอ
      if (label !== NONE_LABEL && confidence >= 0.35) {
        votes.push(label);
        if (votes.length > VOTE_WINDOW) votes.shift();
      }
      const maj = majority(votes) || label;

      updatePracticeUI(target, maj, confidence);
    });

    window.__hbHands = hands;

    // ส่งเฟรมให้ mediapipe ผ่าน Camera utils เส้นเดียว
    const cameraMP = new Camera(videoEl, {
      onFrame: async () => { await hands.send({ image: videoEl }); },
      width: 640, height: 480
    });
    await cameraMP.start();
  }

  function renderHands(results) {
    const canvasEl = document.getElementById('overlay');
    if (!canvasEl) return;
    const ctx = canvasEl.getContext('2d');

    ctx.save();
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    ctx.drawImage(results.image, 0, 0, canvasEl.width, canvasEl.height);

    if (results.multiHandLandmarks) {
      for (const lm of results.multiHandLandmarks) {
        drawConnectors(ctx, lm, HAND_CONNECTIONS, { lineWidth: 2 });
        drawLandmarks(ctx, lm, { lineWidth: 1, radius: 2 });
      }
    }
    ctx.restore();
  }

  async function callBackend(lm21, handedLabel) {
    // throttle
    const now = performance.now();
    if (now - lastSent < SEND_EVERY_MS) return null;
    lastSent = now;

    if (!lm21 || lm21.length !== 21) return null;

    // MediaPipe landmark: {x,y,z} → [x,y,z]
    const points = lm21.map(p => [Number(p.x || 0), Number(p.y || 0), Number(p.z || 0)]);
    const body = { points, handed: handedLabel || null };

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        console.warn("[HB]/predict status", res.status);
        return null;
      }
      return await res.json(); // {label, confidence}
    } catch (e) {
      console.warn("[HB] fetch error", e);
      return null;
    }
  }

  function majority(arr) {
    const cnt = new Map();
    for (const a of arr) {
      if (!a || a === NONE_LABEL) continue; // ตัด None ออกจากการโหวต
      cnt.set(a, (cnt.get(a) || 0) + 1);
    }
    let best = null, bestN = -1;
    for (const [k, v] of cnt) if (v > bestN) { best = k; bestN = v; }
    return best;
  }

  /* ---------- Practice ---------- */
  function initPractice() {
    const url = new URL(location.href);
    const currentLetter = (url.searchParams.get('letter') || 'A').toUpperCase();
    const idx = ALPHABET.indexOf(currentLetter);
    const prevLetter = ALPHABET[(idx - 1 + 26) % 26];
    const nextLetter = ALPHABET[(idx + 1) % 26];

    document.title = `Practice: Letter ${currentLetter}`;
    document.getElementById('current-letter').textContent = currentLetter;

    const exampleImage = document.getElementById('example-image');
    if (exampleImage) {
      exampleImage.src = `images/example-${currentLetter}.jpg`;
      exampleImage.alt = `Example of Sign '${currentLetter}'`;
    }

    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    prevBtn.textContent = `← Previous (${prevLetter})`;
    nextBtn.textContent = `Next (${nextLetter}) →`;
    prevBtn.onclick = () => location.href = `practice.html?letter=${prevLetter}`;
    nextBtn.onclick = () => location.href = `practice.html?letter=${nextLetter}`;

    ensurePracticeHud();
    window._practiceTarget = currentLetter;
  }

  function ensurePracticeHud() {
    if (document.getElementById("practice-hud")) return;
    const hud = document.createElement("div");
    hud.id = "practice-hud";
    hud.style.cssText = "margin-top:8px;font:600 14px/1.3 ui-sans-serif;color:#444";
    const msg = document.createElement("div");
    msg.id = "practice-msg";
    msg.style.cssText = "margin-top:4px;font:600 16px/1.3 ui-sans-serif;";
    (document.querySelector(".webcam-column") || document.body).append(hud, msg);
  }
  ensurePracticeHud();

  function updatePracticeUI(target, pred, conf) {
    const hud = document.getElementById("practice-hud");
    if (hud) hud.textContent = `Target: ${target} | Pred: ${pred ?? "-"} (${(conf || 0).toFixed(2)})`;

    const msg = document.getElementById("practice-msg");
    if (pred === target && (conf || 0) >= CONF_TH) {
      passedFrames++;
      if (msg) { msg.textContent = `Hold… ${passedFrames}/${PASS_FRAMES}`; msg.style.color = "#2563eb"; }
      if (passedFrames >= PASS_FRAMES) {
        if (msg) { msg.textContent = "PASS ✅"; msg.style.color = "#16a34a"; }
        setTimeout(() => {
          const az = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
          const cur = getTargetLetter();
          const next = az[(az.indexOf(cur) + 1) % az.length];
          location.href = `practice.html?letter=${next}`;
        }, 600);
        passedFrames = 0; votes = [];
      }
    } else {
      passedFrames = 0;
      if (msg) {
        if (pred === NONE_LABEL || (conf || 0) < 0.35) {
          msg.textContent = "Waiting…"; msg.style.color = "#92400e";
        } else {
          msg.textContent = `Not yet (${(conf || 0).toFixed(2)})`; msg.style.color = "#92400e";
        }
      }
    }
  }

  /* ---------- Game ---------- */
  function initGame() {
    ensureGameHud();
    startRound();
  }

  function ensureGameHud() {
    if (!document.getElementById("game-hud-a")) {
      const a = document.createElement("div");
      a.id = "game-hud-a";
      a.style.cssText = "margin-top:8px;font-weight:700;";
      document.getElementById('webcam-container')?.appendChild(a);
    }
    if (!document.getElementById("game-hud-b")) {
      const b = document.createElement("div");
      b.id = "game-hud-b";
      b.style.cssText = "margin-top:4px;";
      document.getElementById('webcam-container')?.appendChild(b);
    }
  }

  function startRound() {
    gameTarget = ALPHABET[Math.floor(Math.random() * 26)];
    gameRemain = 10;
    setGameHUD(`Show: ${gameTarget}`, `Time: ${gameRemain}s`);
    document.getElementById('game-letter').textContent = gameTarget;

    if (gameTimer) clearInterval(gameTimer);
    gameTimer = setInterval(() => {
      gameRemain--;
      setGameHUD(null, `Time: ${gameRemain}s`);
      const t = document.querySelector('#game-timer span');
      if (t) t.textContent = String(gameRemain);
      if (gameRemain <= 0) {
        clearInterval(gameTimer);
        setGameHUD(`Time's up ⌛`, null, "#ef4444");
        setTimeout(startRound, 800);
      }
    }, 1000);
  }

  function setGameHUD(textA, textB, color) {
    const a = document.getElementById("game-hud-a");
    const b = document.getElementById("game-hud-b");
    if (a && textA !== null) { a.textContent = textA; if (color) a.style.color = color; }
    if (b && textB !== null) { b.textContent = textB; }
  }

  window.updateGameRound = function (pred, conf) {
    if (!gameTarget) return;
    if (pred === gameTarget && conf >= CONF_TH) {
      setGameHUD("Correct! ⭐", null, "#16a34a");
      clearInterval(gameTimer);
      setTimeout(startRound, 600);
    } else {
      setGameHUD(`Show: ${gameTarget} | Pred: ${pred} (${(conf || 0).toFixed(2)})`, null);
    }
  };
}