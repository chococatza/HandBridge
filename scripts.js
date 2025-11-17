/* ===========================
   HandBridge script.js (drop-in)
   - Game: จอเดียว, ข้าม J/Z, เลขรอบซิงค์, เอฟเฟ็กต์ถูก/ผิด
   - Practice: ไม่ auto ข้าม; PASS แล้วให้กด Next เอง + feedback เล็กๆ
   - Backend: /predict => { points: [[x,y,z],...], handed? }
   =========================== */

/* ===========================
   HandBridge script.js (v6 - FINAL w/ Auth + Webcam Fix)
   - (Friend's Code) AI (MediaPipe) + AI (Backend SVM)
   - (My Code) Login / Signup / Profile / Dashboard Logic
   - (Fixed) Merged correctly
   - (FIXED!) "texImage2D: no video" error
   =========================== */

if (window.__HB_SCRIPT_LOADED__) {
  console.warn('[HB] script already loaded, skipping re-init');
} else {
  window.__HB_SCRIPT_LOADED__ = true;

  /* ---------- 1. CONFIG ---------- */
  const API_PREDICT_URL = "/predict"; 
  const API_TOKEN_URL = "/token";
  const API_REGISTER_URL = "/register";
  const API_DASHBOARD_URL = "/dashboard/metrics"; 

  const NONE_LABEL = "None";
  const AUTH_KEY = 'hb_access_token'; 

  // Practice tuning
  const VOTE_WINDOW = 7;
  const CONF_FLOOR = 0.35;
  const PASS_CONF = 0.55;
  const PASS_FRAMES = 3;

  // Game tuning
  const GAME_TOTAL_ROUNDS = 10;
  let ROUND_TIME = 3.0;
  const GAME_CONF_TH = 0.60;
  const EXCLUDE_SIGNS = new Set(["J", "Z"]);

  // Globals
  let handsInstance = null;
  let videoEl = null, canvasEl = null, ctx = null;
  let userProfile = null; 
  const AZ = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

  /* ---------- 2. MODE HELPERS ---------- */
  const isGamePage = () => location.pathname.includes("game");
  const isLessonsPage = () => location.pathname.includes("lessons");
  const isPracticePage = () => location.pathname.includes("practice");
  const isLoginPage = () => location.pathname.includes("login");
  const isSignupPage = () => location.pathname.includes("signup");
  const isProfilePage = () => location.pathname.includes("profile");
  const isDashboardPage = () => location.pathname.includes("dashboard");

  
  /* ---------- 3. AUTH & NAVBAR LOGIC ---------- */

  function decodeJWT(token) {
      try {
          const base64Url = token.split('.')[1];
          const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
          const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
              return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
          }).join(''));
          return JSON.parse(jsonPayload);
      } catch (e) { return null; }
  }

  function setupAuthAndNavbar() {
      const token = localStorage.getItem(AUTH_KEY);
      const navBarEl = document.getElementById('main-navbar');
      
      if (token) {
          const payload = decodeJWT(token);
          if (payload && payload.exp * 1000 > Date.now()) {
              userProfile = { id: payload.user_id, username: payload.sub };
          } else {
              localStorage.removeItem(AUTH_KEY);
              userProfile = null;
          }
      }

      let navContent = '';
      if (userProfile) {
          navContent = `
              <div class="logo"><span>HandBridge</span></div>
              <nav>
                  <ul>
                      <li><a href="lessons.html">Lessons</a></li>
                      <li><a href="game.html">Game</a></li>
                      <li><a href="dashboard.html">Dashboard</a></li>
                  </ul>
              </nav>
              <a href="profile.html" class="btn btn-submit">${userProfile.username} (Profile)</a>
          `;
      } else {
          navContent = `
              <div class="logo"><span>HandBridge</span></div>
              <nav>
                  <ul>
                      <li><a href="lessons.html">Lessons</a></li>
                      <li><a href="signup.html">Sign Up</a></li>
                  </ul>
              </nav>
              <a href="login.html" class="btn btn-order">Log In</a>
          `;
      }
      if (navBarEl) navBarEl.innerHTML = navContent;

      const isProtectedPage = isDashboardPage() || isProfilePage() || isPracticePage() || isGamePage();
      if (isProtectedPage && !userProfile) {
          console.warn("User not logged in. Redirecting to login...");
          window.location.href = "login.html"; 
          return false; 
      }
      
      if (isProfilePage() && userProfile) {
          document.getElementById("profile-username").textContent = userProfile.username;
          document.getElementById("profile-user-id").textContent = userProfile.id;
          document.getElementById("logout-btn").addEventListener('click', handleLogout);
      }
      
      return true; 
  }

  function handleLogout() {
      localStorage.removeItem(AUTH_KEY);
      userProfile = null;
      window.location.href = "index.html";
  }

  /* ---------- 4. INIT (ตัวควบคุมหลัก) ---------- */
  document.addEventListener("DOMContentLoaded", async () => {
      
      const isAuthenticated = setupAuthAndNavbar();
      
      try {
        const url = new URL(location.href);
        const t = Number(url.searchParams.get("time"));
        if (Number.isFinite(t) && t > 0) ROUND_TIME = t;
      } catch { }

      if (isAuthenticated) {
          if (isPracticePage()) { await initHands(); initPractice(); }
          if (isGamePage()) { await initHands(); initGame(); }
          if (isDashboardPage()) { await loadDashboardData(); }
          if (isLessonsPage()) { await loadLessonProgress(); }
      }
      
      if (isSignupPage()) {
          document.getElementById('signup-form')?.addEventListener('submit', handleSignup);
      }
      if (isLoginPage()) {
          document.getElementById('login-form')?.addEventListener('submit', handleLogin);
      }
  });


  /* ---------- 5. MEDIAPIPE (AI หน้าบ้าน) ---------- */

  async function initHands() {
      videoEl = document.getElementById("webcam-feed");
      canvasEl = document.getElementById("overlay");
      if (!videoEl || !canvasEl) return;
      ctx = canvasEl.getContext("2d");

      // (แก้ไข!) เราจะ "รอ" ให้ startWebcam (ล่างสุด) ทำงานเสร็จก่อน
      try {
          await startWebcam(); // <-- (รอให้กล้อง "พร้อม" จริงๆ)
      } catch (e) {
          console.error("[HB] getUserMedia error:", e);
          const l = document.getElementById("webcam-loading");
          if (l) l.style.display = "none";
          // (ถ้ากล้องพัง ก็ไม่ต้องรัน AI)
          return; 
      }

      // (ตั้งค่า Canvas/Video)
      canvasEl.width = videoEl.videoWidth || 640;
      canvasEl.height = videoEl.videoHeight || 480;
      const wrap = document.getElementById("cam-wrap");
      if (wrap && videoEl.videoWidth && videoEl.videoHeight) {
          wrap.style.setProperty("--ar-w", String(videoEl.videoWidth));
          wrap.style.setProperty("--ar-h", String(videoEl.videoHeight));
      }
      if (document.body.id === "page-game") videoEl.style.display = "none";
      const l = document.getElementById("webcam-loading");
      if (l) l.style.display = "none";


      // (รัน MediaPipe)
      if (handsInstance) return handsInstance;
      if (!window.Hands) { console.error("[HB] Mediapipe Hands not loaded"); return; }

      handsInstance = new window.Hands({
          locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
      });
      handsInstance.setOptions({
          selfieMode: true, maxNumHands: 1, modelComplexity: 1,
          minDetectionConfidence: 0.7, minTrackingConfidence: 0.7,
      });
      handsInstance.onResults(onHandsResults);

      if (!window.Camera) { console.error("[HB] Mediapipe Camera utils not loaded"); return; }
      const cam = new window.Camera(videoEl, {
          onFrame: async () => { await handsInstance.send({ image: videoEl }); },
          width: canvasEl.width, height: canvasEl.height
      });
      await cam.start();
  }

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
      if (gameMode) {
          window.updateGameRound?.(pred.label, pred.confidence);
      } else {
          if ((pred.confidence ?? 0) >= CONF_FLOOR) _votesPush(pred.label);
          const maj = _majority(votes) || pred.label;
          updatePracticeUI(getPracticeTarget(), maj, pred.confidence);
      }
  }

  /* ---------- 6. BACKEND (AI + AUTH) ---------- */
  
  let __hb_lastSent = 0;
  const SEND_EVERY_MS = 250;
  
  async function callBackend(lm21, handedLabel) {
      const now = performance.now();
      if (now - __hb_lastSent < SEND_EVERY_MS) return null;
      __hb_lastSent = now;
      
      if (!lm21 || lm21.length !== 21) return null;

      const token = localStorage.getItem(AUTH_KEY);
      if (!token) {
          console.warn("Missing auth token. Redirecting to login.");
          window.location.href = "login.html"; 
          return null;
      }

      const points = lm21.map(p => [Number(p?.x ?? 0), Number(p?.y ?? 0), Number(p?.z ?? 0)]);
      const handed = (handedLabel === "Left" || handedLabel === "Right") ? handedLabel : undefined;
      const body = handed ? { points, handed } : { points };

      try {
          const res = await fetch(API_PREDICT_URL, { 
              method: "POST", 
              headers: { 
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${token}` 
              }, 
              body: JSON.stringify(body) 
          });
          
          if (res.status === 401) { 
              console.warn("Token expired or invalid. Redirecting to login.");
              localStorage.removeItem(AUTH_KEY); 
              window.location.href = "login.html"; 
              return null;
          }
          if (!res.ok) { console.warn("/predict", res.status, await res.text().catch(() => '')); return null; }
          return await res.json();
          
      } catch (e) {
          console.warn("[HB] fetch /predict error", e);
          return null;
      }
  }

  // (ฟังก์ชันสำหรับ Signup/Login/Dashboard)
  function displayMessage(msg, color = 'red') {
      const msgEl = document.getElementById('message');
      if (msgEl) {
          msgEl.textContent = msg;
          msgEl.style.color = color;
      }
  }

  async function handleSignup(e) {
      e.preventDefault();
      displayMessage("");
      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;
      const confirm = document.getElementById('confirm-password').value;
      if (password !== confirm) { displayMessage("Passwords do not match!"); return; }
      if (password.length < 6) { displayMessage("Password must be at least 6 characters."); return; }

      try {
          const response = await fetch(API_REGISTER_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username, password }),
          });
          if (response.ok) {
              displayMessage("Registration successful! Redirecting to login...", 'green');
              setTimeout(() => { window.location.href = "login.html"; }, 1500);
          } else {
              const error = await response.json();
              displayMessage(`Error: ${error.detail || 'Registration failed.'}`);
          }
      } catch (e) {
          displayMessage("Network error: Could not connect to server.");
      }
  }

  async function handleLogin(e) {
      e.preventDefault();
      displayMessage("");
      const username = document.getElementById('login-username').value;
      const password = document.getElementById('login-password').value;
      
      const formData = new FormData();
      formData.append('username', username);
      formData.append('password', password);

      try {
          const response = await fetch(API_TOKEN_URL, {
              method: 'POST',
              body: formData,
          });
          if (response.ok) {
              const data = await response.json();
              localStorage.setItem(AUTH_KEY, data.access_token);
              displayMessage("Login successful! Redirecting to Home...", 'green'); 
              setTimeout(() => { window.location.href = "index.html"; }, 1000); 
          } else {
              const error = await response.json();
              displayMessage(`Error: ${error.detail || 'Login failed.'}`);
          }
      } catch (e) {
          displayMessage("Network error: Could not connect to server.");
      }
  }

  async function loadDashboardData() {
    const usernameEl = document.getElementById("dashboard-username");
    const masteryEl = document.getElementById("letters-mastered");
    const accuracyEl = document.getElementById("overall-accuracy");

    if (userProfile && usernameEl) { 
        usernameEl.textContent = userProfile.username;
    }

    const token = localStorage.getItem(AUTH_KEY);
    if (!token) return;

    try {
        const res = await fetch(API_DASHBOARD_URL, {
            headers: { "Authorization": `Bearer ${token}` }
        });

        if (res.status === 401) {
            window.location.href = "login.html";
            return;
        }
        if (!res.ok) throw new Error("Failed to fetch dashboard metrics");

        const data = await res.json();

        // --------------------------
        // Update metrics
        // --------------------------
        const mastered = data.per_unit_performance.filter(
            unit => unit.accuracy >= 0.8
        ).length;

        if (masteryEl) masteryEl.textContent = `${mastered}`;
        if (accuracyEl) accuracyEl.textContent = data.accuracy_display;

        // --------------------------
        // Accuracy (Per-Unit) chart
        // --------------------------
        if (data.per_unit_performance && data.per_unit_performance.length > 0) {
            const unitLabels = data.per_unit_performance.map(u => u.unit_name || u.unit);
            const unitAccuracy = data.per_unit_performance.map(u => u.accuracy * 100); // convert to %

            const ctx1 = document.getElementById("accuracy-chart").getContext("2d");
            new Chart(ctx1, {
                type: "line",
                data: {
                    labels: unitLabels,
                    datasets: [{
                        label: "Accuracy (%)",
                        data: unitAccuracy,
                        fill: false,
                        borderColor: "#4CAF50",
                        backgroundColor: "#4CAF50",
                        tension: 0.2
                    }]
                },
                options: {
                    responsive: true,
                    scales: {
                        y: {
                            beginAtZero: true,
                            max: 100,
                            ticks: { callback: value => value + "%" }
                        }
                    }
                }
            });
        }

        // --------------------------
        // Correct vs Incorrect chart
        // --------------------------
        if (data.total_attempts && data.total_correct !== undefined) {
            const incorrect = data.total_attempts - data.total_correct;

            const ctx2 = document.getElementById("correct-chart").getContext("2d");
            new Chart(ctx2, {
                type: "bar",
                data: {
                    labels: ["Correct", "Incorrect"],
                    datasets: [{
                        label: "Count",
                        data: [data.total_correct, incorrect],
                        backgroundColor: ["#4CAF50", "#F44336"]
                    }]
                },
                options: {
                    responsive: true,
                    scales: {
                        y: { beginAtZero: true }
                    }
                }
            });
        }

    } catch (error) {
        console.error("Dashboard Load Error:", error);
        if (masteryEl) masteryEl.textContent = "Error";
    }


}

/* ---------- (ใหม่!) LESSONS PAGE LOGIC ---------- */
  function getCurrentLetter() {
    const params = new URLSearchParams(window.location.search);
    return params.get("letter") || "A";
}

const currentLetter = getCurrentLetter();
document.getElementById("current-letter").textContent = currentLetter;

// บันทึก lesson เสร็จ
function completeLetter(letter) {
    let completedLetters = JSON.parse(localStorage.getItem("completedLetters")) || [];
    if (!completedLetters.includes(letter)) {
        completedLetters.push(letter);
        localStorage.setItem("completedLetters", JSON.stringify(completedLetters));

        if ('BroadcastChannel' in window) {
            const channel = new BroadcastChannel('lesson_channel');
            channel.postMessage({completed: letter});
        }
    }
}

// ฟังก์ชันเรียกเมื่อกด Next หรือเล่นเสร็จ
function onLessonComplete() {
    completeLetter(currentLetter);
    
    // หา letter ถัดไป A-Z
    const nextLetter = String.fromCharCode(currentLetter.charCodeAt(0) + 1);
    if (nextLetter <= "Z") {
        window.location.href = `practice.html?letter=${nextLetter}`;
    } else {
        alert("You have completed all letters! 🎉");
        window.location.href = "lessons.html";
    }
}

// ปุ่ม Next
document.getElementById("next-btn").addEventListener("click", onLessonComplete);

// ปุ่ม Previous
document.getElementById("prev-btn").addEventListener("click", () => {
    const prevLetter = String.fromCharCode(currentLetter.charCodeAt(0) - 1);
    if (prevLetter >= "A") {
        window.location.href = `practice.html?letter=${prevLetter}`;
    }
});

  function updateLessonStatus() {
    const completedLetters = JSON.parse(localStorage.getItem("completedLetters")) || [];
    document.querySelectorAll(".lesson-card").forEach(card => {
        const letter = card.dataset.letter;
        const statusEl = card.querySelector(".status");
        if (!statusEl) return;

        if (completedLetters.includes(letter)) {
            statusEl.textContent = "⭐ Completed";
            statusEl.style.color = "#facc15";
        } else {
            statusEl.textContent = "Start";
            statusEl.style.color = "#0f172a";
        }
    });
}

document.addEventListener("DOMContentLoaded", updateLessonStatus);

// รับ broadcast จาก practice.html
if ('BroadcastChannel' in window) {
    const channel = new BroadcastChannel('lesson_channel');
    channel.onmessage = event => {
        if (event.data.completed) updateLessonStatus();
    };
}

  
  /* ---------- 7. (โค้ด Game/Practice/Render เดิมของเพื่อน) ---------- */
  
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
    const idx = AZ.indexOf(cur);
    const prev = AZ[(idx - 1 + 26) % 26], next = AZ[(idx + 1) % 26];
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    if (prevBtn) { prevBtn.textContent = `← Previous (${prev})`; prevBtn.onclick = () => location.href = `practice.html?letter=${prev}`; }
    if (nextBtn) { nextBtn.textContent = `Next (${next}) →`; nextBtn.onclick = () => location.href = `practice.html?letter=${next}`; }
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
      if (nextBtn) { nextBtn.classList.add("pulse"); }
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

  // (โค้ด Game Logic ที่เหลือ... เหมือนเดิม)
  let gameRunning = false, gameRound = 1, gameScore = 0, gameTarget = null, gameRemain = 0, gameTimer = null;
  let hbHitEdge = false;
  let hbSolveLockUntil = 0;
  const HB_SOLVE_COOLDOWN_MS = 700;
  function initGame() {
    bindGameControls();
    resetGameUI();
    setHUD("Ready", "Press Start to begin");
    updateTimerUI(0, ROUND_TIME);
  }
  function resetGameUI() {
    gameRunning = false; gameRound = 1; gameScore = 0; gameTarget = null; gameRemain = 0;
    setPanel("—", 0, 0, 0);
  }
  function bindGameControls() {
    const bStart = document.getElementById("btn-start");
    const bSkip = document.getElementById("btn-skip");
    const bStop = document.getElementById("btn-stop");
    bStart?.addEventListener("click", startGame);
    bSkip?.addEventListener("click", skipTarget);
    bStop?.addEventListener("click", stopGame);
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
        gameScore = Math.max(0, gameScore - 1);
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
    updateTimerUI(0, ROUND_TIME);
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
    if (now < hbSolveLockUntil) return;
    const isHit = (pred === gameTarget) && (c >= GAME_CONF_TH) && (gameRemain > 0);
    if (isHit && !hbHitEdge) {
      hbHitEdge = true;
      hbSolveLockUntil = now + HB_SOLVE_COOLDOWN_MS;
      clearInterval(gameTimer);
      gameScore += 1;
      const canvasWrap = document.getElementById("overlay");
      const letter = document.getElementById("game-letter");
      if (canvasWrap) { canvasWrap.classList.remove("hb-flash-red"); canvasWrap.classList.add("hb-flash-green"); }
      if (letter) { letter.classList.remove("hb-shake"); letter.style.color = "#16a34a"; }
      hbBeep?.("ok");
      setHUD?.(`✅ Correct: ${gameTarget}`, `Score: ${gameScore}`);
      setTimeout(() => {
        if (canvasWrap) canvasWrap.classList.remove("hb-flash-green");
        if (letter) letter.style.color = "";
        gameRound += 1;
        if (gameRound > GAME_TOTAL_ROUNDS) {
          endGame?.();
        } else {
          hbHitEdge = false;
          hbSolveLockUntil = 0;
          nextTarget?.();
        }
      }, 500);
      return;
    }
    if (!isHit) {
      hbHitEdge = false;
    }
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
    if (!el || !lb) return;
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

  // (แก้ไข!) นี่คือ "ฟังก์ชันเปิดกล้อง" ที่เราแก้ล่าสุด (ที่รอ .play())
  async function startWebcam() {
      videoEl = document.getElementById("webcam-feed");
      const webcamLoading = document.getElementById("webcam-loading");
      
      return new Promise(async (resolve, reject) => {
          try {
              const stream = await navigator.mediaDevices.getUserMedia({ 
                  video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
                  audio: false 
              });
              
              videoEl.srcObject = stream;
              
              videoEl.addEventListener('loadeddata', async () => {
                  try {
                      await videoEl.play(); 
                      console.log("✅ Webcam is now playing!");
                      if (webcamLoading) webcamLoading.style.display = 'none';
                      resolve(); 
                  } catch (playErr) {
                      console.error("❌ Error playing webcam:", playErr);
                      reject(playErr);
                  }
              });

          } catch (err) {
              console.error("❌ Error starting webcam:", err);
              if (webcamLoading) webcamLoading.innerText = "Failed to access webcam. Please allow camera access.";
              if (feedbackBox) {
                  feedbackBox.innerHTML = '<p class="hint">Cannot start without camera access.</p>';
                  feedbackBox.className = 'feedback-area hint';
              }
              reject(err);
          }
      });
  }
  
} // (จบ if (window.__HB_SCRIPT_LOADED__))
