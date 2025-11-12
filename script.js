/* ===========================
   HandBridge script.js (drop-in)
   - Game: จอเดียว, ข้าม J/Z, เลขรอบซิงค์, เอฟเฟ็กต์ถูก/ผิด
   - Practice: ไม่ auto ข้าม; PASS แล้วให้กด Next เอง + feedback เล็กๆ
   - Backend: /predict => { points: [[x,y,z],...], handed? }
   =========================== */

if (window.__HB_SCRIPT_LOADED__) {
  console.warn('[HB] script already loaded, skipping re-init');
} else {
  window.__HB_SCRIPT_LOADED__ = true;

  /* ---------- CONFIG ---------- */
  const API_URL = "http://127.0.0.1:8000/predict";
  const NONE_LABEL = "None";

  // Practice tuning
  const VOTE_WINDOW = 7;
  const CONF_FLOOR = 0.35;
  const PASS_CONF = 0.55;
  const PASS_FRAMES = 3;

  // Game tuning
  const GAME_TOTAL_ROUNDS = 10;
  let ROUND_TIME = 5.0;           // time per round (ปรับได้ด้วย ?time=)
  const GAME_CONF_TH = 0.60;
  const EXCLUDE_SIGNS = new Set(["J", "Z"]); // ข้าม motion ในเกม

  // globals
  let handsInstance = null;
  let videoEl = null, canvasEl = null, ctx = null;

  // A–Z
  const AZ = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

  /* ---------- MODE ---------- */
  const isGamePage = () => (window.HB_MODE === "game") || location.pathname.includes("game");
  const isPracticePage = () => location.pathname.includes("practice");

  /* ---------- INIT ---------- */
  document.addEventListener("DOMContentLoaded", async () => {
    // อ่าน ?time=3.5 ถ้ามี
    try {
      const url = new URL(location.href);
      const t = Number(url.searchParams.get("time"));
      if (Number.isFinite(t) && t > 0) ROUND_TIME = t;
    } catch { }

    if (isPracticePage()) { await initHands(); initPractice(); }
    if (isGamePage()) { await initHands(); initGame(); }
  });

  async function initHands() {
    videoEl = document.getElementById("webcam-feed");
    canvasEl = document.getElementById("overlay");

    if (!videoEl) throw new Error("missing #webcam-feed");
    if (!canvasEl) {
      canvasEl = document.createElement("canvas");
      canvasEl.id = "overlay";
      canvasEl.width = 640; canvasEl.height = 480;
      videoEl.insertAdjacentElement("afterend", canvasEl);
    }
    ctx = canvasEl.getContext("2d");

    // เปิดกล้อง: ขอความละเอียดสูง (ภาพคมขึ้น)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      videoEl.srcObject = stream;
      await videoEl.play();

      // ตั้งขนาดภายในของ canvas เท่ากับเฟรมจริง
      canvasEl.width = videoEl.videoWidth || 640;
      canvasEl.height = videoEl.videoHeight || 480;

      // ล็อกอัตราส่วนกล่อง
      const wrap = document.getElementById("cam-wrap");
      if (wrap && videoEl.videoWidth && videoEl.videoHeight) {
        wrap.style.setProperty("--ar-w", String(videoEl.videoWidth));
        wrap.style.setProperty("--ar-h", String(videoEl.videoHeight));
      }

      // ซ่อน video หน้าเกม (เหลือจอเดียว)
      if (document.body.id === "page-game") videoEl.style.display = "none";

      const l = document.getElementById("webcam-loading");
      if (l) l.style.display = "none";
    } catch (e) {
      console.error("[HB] getUserMedia error:", e);
    }

    // Mediapipe Hands
    if (handsInstance) return handsInstance;
    if (!window.Hands) { console.error("[HB] Mediapipe Hands not loaded"); return; }

    handsInstance = new window.Hands({
      locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
    });
    handsInstance.setOptions({
      selfieMode: true,
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.7,
    });
    handsInstance.onResults(onHandsResults);

    if (!window.Camera) { console.error("[HB] Mediapipe Camera utils not loaded"); return; }
    const cam = new window.Camera(videoEl, {
      onFrame: async () => { await handsInstance.send({ image: videoEl }); },
      width: canvasEl.width, height: canvasEl.height
    });
    await cam.start();

    return handsInstance;
  }

  /* ---------- HANDS CALLBACK ---------- */
  async function onHandsResults(results) {
    renderHands(results);

    const gameMode = isGamePage();
    const hasHand = !!results?.multiHandLandmarks?.length;

    if (!hasHand) {
      if (gameMode) window.updateGameRound?.(NONE_LABEL, 0);
      else updatePracticeUI(getPracticeTarget(), NONE_LABEL, 0);
      return;
    }

    const lm = results.multiHandLandmarks[0];
    const handed = results?.multiHandedness?.[0]?.label || undefined;

    const pred = await callBackend(lm, handed);
    if (!pred) return;

    const { label, confidence } = pred;

    if (gameMode) {
      window.updateGameRound?.(label, confidence);
    } else {
      // Practice: majority vote + ไม่ auto ข้าม
      if ((confidence ?? 0) >= CONF_FLOOR) _votesPush(label);
      const maj = _majority(votes) || label;
      updatePracticeUI(getPracticeTarget(), maj, confidence);
    }
  }

  /* ---------- /predict ---------- */
  let __hb_lastSent = 0;
  const SEND_EVERY_MS = 250;

  async function callBackend(lm21, handedLabel) {
    const now = performance.now();
    if (now - __hb_lastSent < SEND_EVERY_MS) return null;
    __hb_lastSent = now;

    if (!lm21 || lm21.length !== 21) return null;

    const points = lm21.map(p => [Number(p?.x ?? 0), Number(p?.y ?? 0), Number(p?.z ?? 0)]);
    const handed = (handedLabel === "Left" || handedLabel === "Right") ? handedLabel : undefined;

    const body = handed ? { points, handed } : { points };
    try {
      const res = await fetch(API_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { console.warn("/predict", res.status, await res.text().catch(() => '')); return null; }
      return await res.json();
    } catch (e) {
      console.warn("[HB] fetch /predict error", e);
      return null;
    }
  }

  /* ---------- RENDER ---------- */
  function renderHands(results) {
    if (!ctx || !canvasEl) return;
    const W = canvasEl.width, H = canvasEl.height;
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    if (results?.image) ctx.drawImage(results.image, 0, 0, W, H);
    if (results?.multiHandLandmarks?.length) {
      const lm = results.multiHandLandmarks[0];
      if (typeof drawConnectors === 'function' && typeof drawLandmarks === 'function') {
        drawConnectors(ctx, lm, HAND_CONNECTIONS, { lineWidth: 2 });
        drawLandmarks(ctx, lm, { lineWidth: 1, radius: 2 });
      }
    }
    ctx.restore();
  }

  /* ---------- PRACTICE ---------- */
  let votes = [];
  let passedFrames = 0;
  let practicePassed = false;

  function _votesPush(label) {
    if (!label || label === NONE_LABEL) return;
    votes.push(label);
    if (votes.length > VOTE_WINDOW) votes.shift();
  }
  function _majority(arr) {
    if (!arr.length) return null;
    const m = new Map();
    for (const a of arr) { if (!a || a === NONE_LABEL) continue; m.set(a, (m.get(a) || 0) + 1); }
    let best = null, cnt = -1; for (const [k, v] of m) { if (v > cnt) { best = k; cnt = v; } }
    return best;
  }

  function getPracticeTarget() {
    const url = new URL(location.href);
    const l = (url.searchParams.get('letter') || 'A').toUpperCase();
    return /^[A-Z]$/.test(l) ? l : 'A';
  }

  function initPractice() {
    const cur = getPracticeTarget();
    document.title = `Practice: ${cur}`;
    const titleEl = document.getElementById('current-letter'); if (titleEl) titleEl.textContent = cur;
    const img = document.getElementById('example-image'); if (img) { img.src = `images/example-${cur}.jpg`; img.alt = `Example of '${cur}'`; }

    // ปุ่ม Prev/Next
    const idx = AZ.indexOf(cur);
    const prev = AZ[(idx - 1 + 26) % 26], next = AZ[(idx + 1) % 26];
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    if (prevBtn) { prevBtn.textContent = `← Previous (${prev})`; prevBtn.onclick = () => location.href = `practice.html?letter=${prev}`; }
    if (nextBtn) { nextBtn.textContent = `Next (${next}) →`; nextBtn.onclick = () => location.href = `practice.html?letter=${next}`; }

    // เริ่มสถานะ
    votes = []; passedFrames = 0; practicePassed = false;
    const fb = document.getElementById("feedback-box");
    const hint = document.getElementById("practice-hint");
    if (fb) fb.classList.remove("correct"); if (hint) hint.textContent = "Show the letter pose to get PASS";
  }

  function updatePracticeUI(target, pred, conf) {
    const fb = document.getElementById("feedback-box");
    const hint = document.getElementById("practice-hint");
    const nextBtn = document.getElementById("next-btn");

    if (practicePassed) {
      if (hint) { hint.textContent = "PASS ✅ — Press Next to continue"; }
      if (fb) { fb.classList.add("correct"); }
      if (nextBtn) { nextBtn.classList.add("pulse"); } // ทำให้โดดเด่นด้วย CSS ของปุ่มเอง (ถ้ามี)
      return;
    }

    if (pred === target && (conf || 0) >= PASS_CONF) {
      passedFrames++;
      if (hint) { hint.textContent = `Hold… ${passedFrames}/${PASS_FRAMES}`; }
      if (passedFrames >= PASS_FRAMES) {
        practicePassed = true;
        if (hint) { hint.textContent = "PASS ✅ — Press Next to continue"; }
        if (fb) { fb.classList.add("correct"); }
      }
    } else {
      passedFrames = 0;
      if (hint) {
        if (pred === NONE_LABEL || (conf || 0) < CONF_FLOOR) hint.textContent = "Waiting…";
        else hint.textContent = `Not yet (${(conf || 0).toFixed(2)})`;
      }
      if (fb) { fb.classList.remove("correct"); }
    }
  }

  /* ---------- GAME ---------- */
  // state
  let gameRunning = false, gameRound = 1, gameScore = 0, gameTarget = null, gameRemain = 0, gameTimer = null;

  // ==== Anti-double-count flags (กันนับรอบรัว ๆ) ====
  let hbHitEdge = false;        // จำว่าช็อตก่อนหน้า "ถูก" หรือยัง (สำหรับ rising edge)
  let hbSolveLockUntil = 0;     // เวลาที่ล็อกจนถึง (ms) หลังตอบถูก (cooldown ป้องกันนับซ้ำ)
  const HB_SOLVE_COOLDOWN_MS = 700;  // ล็อก ~0.7s พอให้เราเล่นเอฟเฟ็กต์/เปลี่ยนโจทย์

  function initGame() {
    bindGameControls();
    resetGameUI();
    setHUD("Ready", "Press Start to begin");
    updateTimerUI(0, ROUND_TIME);  // รีเซ็ตหลอดเวลาเริ่มต้น
  }
  function resetGameUI() {
    gameRunning = false; gameRound = 1; gameScore = 0; gameTarget = null; gameRemain = 0;
    setPanel("—", 0, 0, 0);
  }
  function bindGameControls() {
    const bStart = document.getElementById("btn-start");
    const bSkip = document.getElementById("btn-skip");
    const bStop = document.getElementById("btn-stop");
    bStart && bStart.addEventListener("click", startGame);
    bSkip && bSkip.addEventListener("click", skipTarget);
    bStop && bStop.addEventListener("click", stopGame);
    document.addEventListener("keydown", e => {
      const k = e.key.toLowerCase();
      if (k === "s") skipTarget();
      if (k === "r" && !gameRunning) startGame();
    });
    document.getElementById("hb-restart")?.addEventListener("click", restartGame);
  }

  function pickRandomTarget() {
    const pool = AZ.filter(ch => !EXCLUDE_SIGNS.has(ch));
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function startGame() {
    if (gameRunning) return;
    gameRunning = true; gameScore = 0; gameRound = 1;
    nextTarget();
    updateTimerUI(gameRemain, ROUND_TIME);
  }
  function stopGame() {
    gameRunning = false; clearInterval(gameTimer);
    setHUD("Stopped", "Press Start to play");
  }
  function skipTarget() {
    if (!gameRunning) return;
    gameRound++;
    if (gameRound > GAME_TOTAL_ROUNDS) return endGame();
    nextTarget();
  }

  function nextTarget() {
    gameTarget = pickRandomTarget();
    gameRemain = ROUND_TIME;
    setHUD(`Round ${gameRound}/${GAME_TOTAL_ROUNDS} — Show: ${gameTarget}`, `Score: ${gameScore}  |  Time: ${gameRemain.toFixed(1)}s`);
    setPanel(gameTarget, gameRound, gameScore, gameRemain);
    updateTimerUI(gameRemain, ROUND_TIME);
    startCountdownStay();
  }

  function startCountdownStay() {
    clearInterval(gameTimer);
    gameTimer = setInterval(() => {
      if (!gameRunning) { clearInterval(gameTimer); return; }
      gameRemain = Math.max(0, gameRemain - 0.1);
      setPanel(gameTarget, gameRound, gameScore, gameRemain);
      updateTimerUI(gameRemain, ROUND_TIME);
      if (gameRemain <= 0) {
        clearInterval(gameTimer);
        gameScore = Math.max(0, gameScore - 1); // หมดเวลา -1 แต่ยังอยู่ข้อเดิม
        setHUD(`Time's up! Stay: ${gameTarget}`, `Score: ${gameScore}`, "#ef4444");
        setTimeout(() => {
          if (!gameRunning) return; gameRemain = ROUND_TIME; setHUD(`Round ${gameRound}/${GAME_TOTAL_ROUNDS} — Show: ${gameTarget}`, `Score: ${gameScore}  |  Time: ${gameRemain.toFixed(1)}s`); setPanel(gameTarget, gameRound, gameScore, gameRemain); updateTimerUI(gameRemain, ROUND_TIME);
          startCountdownStay();
        }, 600);
      }
    }, 100);
  }

  function endGame() {
    gameRunning = false; clearInterval(gameTimer);
    setHUD(`🏁 Finished`, `Final: ${gameScore}/${GAME_TOTAL_ROUNDS}`, "#22c55e");
    // หลัง setHUD(...)
    updateTimerUI(0, ROUND_TIME);  // reset bar to 0

    const finish = document.getElementById("hb-finish");
    if (finish) {
      document.getElementById("hb-final-score").textContent = String(gameScore);
      document.getElementById("hb-final-total").textContent = String(GAME_TOTAL_ROUNDS);
      finish.classList.remove("hidden");
    }
  }

  function setHUD(lineA, lineB, colorA) {
    const a = document.getElementById("hud-line-a"), b = document.getElementById("hud-line-b");
    if (a) { a.textContent = lineA ?? ""; if (colorA) a.style.color = colorA; else a.style.color = ""; }
    if (b) { b.textContent = lineB ?? ""; }
  }
  function setPanel(target, round, score, remain) {
    const elT = document.getElementById("game-letter");
    const elR = document.getElementById("stat-round");
    const elS = document.getElementById("stat-score");
    const elTm = document.getElementById("stat-time");
    if (elT) elT.textContent = target ?? "—";
    if (elR) elR.textContent = `${Math.max(0, Math.min(round, GAME_TOTAL_ROUNDS))}/${GAME_TOTAL_ROUNDS}`;
    if (elS) elS.textContent = `${score}`;
    if (elTm) elTm.textContent = `${(remain ?? 0).toFixed(1)}s`;
  }

  // เสียงปิ๊ง/ปื้ด
  function hbBeep(type = "ok") {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination); o.type = "sine";
      const t = ctx.currentTime; o.frequency.setValueAtTime(type === "ok" ? 880 : 220, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.2, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      o.start(t); o.stop(t + 0.16);
    } catch { }
  }

  window.updateGameRound = function (pred, conf) {
    if (!gameRunning || !gameTarget) return;

    const c = conf ?? 0;
    const now = Date.now();

    // ถ้าอยู่ในช่วง cooldown หลังเพิ่งตอบถูก — เพิกเฉยทุกผลลัพธ์ชั่วคราว
    if (now < hbSolveLockUntil) return;

    // เช็คว่า "โดนเป้า" หรือยัง (เงื่อนไขถูก)
    const isHit = (pred === gameTarget) && (c >= GAME_CONF_TH) && (gameRemain > 0);

    // ——— Edge detection ———
    // ถ้าช็อตก่อนหน้าไม่ถูก แต่ช็อตนี้ถูก → "rising edge" == นับคะแนนได้ 1 ครั้ง
    if (isHit && !hbHitEdge) {
      // mark ว่าตอนนี้เข้าภาวะ "ถูกแล้ว"
      hbHitEdge = true;

      // ล็อกผลลัพธ์ช่วงสั้น ๆ กันนับซ้ำระหว่างที่เรากำลังเปลี่ยนโจทย์
      hbSolveLockUntil = now + HB_SOLVE_COOLDOWN_MS;

      // หยุดนับเวลาข้อนี้
      clearInterval(gameTimer);

      // เพิ่มคะแนน
      gameScore += 1;

      // เอฟเฟ็กต์ถูก
      const canvasWrap = document.getElementById("overlay");
      const letter = document.getElementById("game-letter");
      if (canvasWrap) { canvasWrap.classList.remove("hb-flash-red"); canvasWrap.classList.add("hb-flash-green"); }
      if (letter) { letter.classList.remove("hb-shake"); letter.style.color = "#16a34a"; }
      hbBeep?.("ok");

      // HUD
      setHUD?.(`✅ Correct: ${gameTarget}`, `Score: ${gameScore}`);

      // เปลี่ยนไปโจทย์ถัดไปหลังหน่วงสั้น ๆ
      setTimeout(() => {
        // ปลดเอฟเฟ็กต์สีเขียว
        if (canvasWrap) canvasWrap.classList.remove("hb-flash-green");
        if (letter) letter.style.color = "";

        // เพิ่มเลขรอบ "ที่นี่เท่านั้น" (หนึ่งครั้งต่อข้อ)
        gameRound += 1;

        // จบเกมหรือไปต่อ
        if (gameRound > GAME_TOTAL_ROUNDS) {
          endGame?.();
        } else {
          // รีเซ็ตสถานะ edge/lock สำหรับข้อใหม่
          hbHitEdge = false;
          hbSolveLockUntil = 0;
          nextTarget?.();
        }
      }, 500);

      return; // จบเคสถูก
    }

    // ถ้าไม่โดนเป้าในเฟรมนี้ → ปล่อย edge ลง (เพื่อรอ rising edge จริง ๆ)
    if (!isHit) {
      hbHitEdge = false;
    }

    // ให้ feedback เบา ๆ เมื่อใกล้ลุ้นผ่าน (แต่ยังไม่ผ่าน)
    if (c >= (GAME_CONF_TH - 0.1) && !isHit) {
      const canvasWrap = document.getElementById("overlay");
      const letter = document.getElementById("game-letter");
      if (canvasWrap) { canvasWrap.classList.remove("hb-flash-green"); canvasWrap.classList.add("hb-flash-red"); }
      if (letter) { letter.classList.add("hb-shake"); letter.style.color = "#ef4444"; }
      hbBeep?.("ng");
      setTimeout(() => {
        if (canvasWrap) canvasWrap.classList.remove("hb-flash-red");
        if (letter) { letter.classList.remove("hb-shake"); letter.style.color = ""; }
      }, 250);
    }
  };
  function updateTimerUI(remain, total) {
    const el = document.querySelector("#hb-timer .bar");
    const lb = document.getElementById("hb-timer-label");
    if (!el || !lb) return;  // กัน error
    const ratio = Math.max(0, Math.min(1, total > 0 ? remain / total : 0));
    el.style.width = `${ratio * 100}%`;
    lb.textContent = `${(remain || 0).toFixed(1)}s`;
  }

  function restartGame() {
    document.getElementById("hb-finish")?.classList.add("hidden");
    gameRunning = false;
    clearInterval(gameTimer);
    gameRound = 1;
    gameScore = 0;
    nextTarget();
    gameRunning = true;
  }

}