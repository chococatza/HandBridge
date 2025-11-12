// --- 0. (ลบ!) IMPORT MEDIAPIPE (เราไม่ใช้แล้ว!) ---
// import { HandLandmarker, FilesetResolver } from "/static/vision_bundle.js";

// --- 1. ตัวแปรส่วนกลาง ---
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
let gameTimerInterval;
let isGameRoundOver = false;

const BACKEND_URL = '/evaluate'; 

// (ลบ!) let handLandmarker;
let lastVideoTime = -1;
let isAnalysisRunning = false;

let webcamFeed;
let feedbackBox;

// (ใหม่!) สร้าง Canvas เสมือน (สำหรับจับภาพ)
const captureCanvas = document.createElement('canvas');
captureCanvas.width = 640;
captureCanvas.height = 480;
const canvasContext = captureCanvas.getContext('2d');


// --- 2. ตัวควบคุมหลัก (ทำงานเมื่อโหลดหน้า) ---
// (ลบ!) createHandLandmarker(); 

document.addEventListener('DOMContentLoaded', () => {
    if (document.body.id === 'page-practice') {
        setupPracticePage();
    } 
    if (document.body.id === 'page-game') {
        setupGamePage();
    }
});

// (ลบ!) ฟังก์ชัน createHandLandmarker (เราไม่ใช้แล้ว!)


// ----------------------------------------------
// 3. ฟังก์ชันสำหรับหน้า Practice (practice.html)
// ----------------------------------------------
async function setupPracticePage() {
    console.log("Practice Page Loaded");
    feedbackBox = document.getElementById('feedback-box');
    
    const urlParams = new URLSearchParams(window.location.search);
    const currentLetter = urlParams.get('letter') || 'A';
    // ... (โค้ดตั้งค่าปุ่ม Next/Prev ฯลฯ เหมือนเดิม) ...
    const currentIndex = ALPHABET.indexOf(currentLetter);
    const prevIndex = (currentIndex - 1 + ALPHABET.length) % ALPHABET.length;
    const nextIndex = (currentIndex + 1) % ALPHABET.length;
    const prevLetter = ALPHABET[prevIndex];
    const nextLetter = ALPHABET[nextIndex];
    document.title = `Practice: Letter ${currentLetter}`;
    document.getElementById('current-letter').innerText = currentLetter;
    document.getElementById('example-image').src = `images/example-${currentLetter}.jpg`;
    document.getElementById('prev-btn').onclick = () => { window.location.href = `practice.html?letter=${prevLetter}`; };
    document.getElementById('next-btn').onclick = () => { window.location.href = `practice.html?letter=${nextLetter}`; };

    try {
        await startWebcam(); 
        // (แก้ไข!) เปลี่ยนไปใช้ "ลูปส่งภาพ"
        setInterval(() => {
            runRealtimeAnalysis_Practice(currentLetter, nextLetter); 
        }, 500); // ส่งภาพทุก 0.5 วินาที (ปรับได้)
    } catch (err) {
        console.error("Failed to start webcam, analysis stopped.");
    }
}

// (แก้ไข!) ลูป AI (JS) ใหม่ (แค่ "ส่งภาพ")
function runRealtimeAnalysis_Practice(currentLetter, nextLetter) {
    if (isAnalysisRunning) return; // ถ้ากำลังส่งอยู่ ให้รอ
    if (webcamFeed.readyState < 3) return; // ถ้ารอ
    
    isAnalysisRunning = true; // ล็อค

    // (ใหม่!) ส่ง "ภาพดิบ" (Base64) ไปให้ Backend
    sendImageToBackend(currentLetter)
        .then(result => {
            console.log("✅ Backend responded:", result); 

            if (result.accepted) {
                feedbackBox.innerHTML = `<p>Correct! (${result.prediction.symbol}) ⭐</p>`;
                feedbackBox.className = 'feedback-area correct';
                
                setTimeout(() => {
                    window.location.href = `practice.html?letter=${nextLetter}`;
                }, 1500);
            } else {
                // (ถ้า Backend ตอบ error)
                if (result.error) {
                    feedbackBox.innerHTML = `<p>Error: ${result.error}</p>`;
                } else {
                    // (ถ้าตอบ "No Hand" หรือ "ผิด")
                    feedbackBox.innerHTML = `<p>Almost! (AI เห็นเป็น: ${result.prediction.symbol})</p>`;
                }
                feedbackBox.className = 'feedback-area hint';
                isAnalysisRunning = false; // ปลดล็อค
            }
        })
        .catch(err => {
            console.error("❌ Backend fetch error:", err); 
            feedbackBox.innerHTML = `<p>Error: Cannot connect to AI server.</p>`;
            feedbackBox.className = 'feedback-area hint';
            isAnalysisRunning = false; 
        });
}


// ----------------------------------------------
// 4. ฟังก์ชันสำหรับหน้า Game (game.html)
// ----------------------------------------------
async function setupGamePage() {
    console.log("Game Page Loaded");
    feedbackBox = document.getElementById('feedback-box');
    try {
        await startWebcam(); 
        startNewGameRound(); 
    } catch (err) {
        console.error("Failed to start webcam, game stopped.");
    }
}

function startNewGameRound() {
    isGameRoundOver = false;
    const randomLetter = ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    document.getElementById('game-letter').innerText = randomLetter;
    
    // ... (โค้ด Timer 10 วินาที เหมือนเดิม) ...
    const timerDisplay = document.querySelector('#game-timer span');
    let timeLeft = 10;
    timerDisplay.innerText = timeLeft;
    clearInterval(gameTimerInterval);
    gameTimerInterval = setInterval(() => {
        timeLeft--;
        timerDisplay.innerText = timeLeft;
        if (timeLeft <= 0) {
            clearInterval(gameTimerInterval);
            if (!isGameRoundOver) {
                isGameRoundOver = true;
                showGameFeedback('Time\'s Up! ⌛', 'hint', randomLetter);
                setTimeout(startNewGameRound, 2500);
            }
        }
    }, 1000);

    // (แก้ไข!) เปลี่ยนไปใช้ "ลูปส่งภาพ"
    setInterval(() => {
        runRealtimeAnalysis_Game(randomLetter);
    }, 500); // ส่งภาพทุก 0.5 วินาที
}

// (แก้ไข!) ลูป AI (JS) ใหม่ (แค่ "ส่งภาพ")
function runRealtimeAnalysis_Game(targetLetter) {
    if (isGameRoundOver || isAnalysisRunning) return;
    if (webcamFeed.readyState < 3) return;

    isAnalysisRunning = true; // ล็อค

    // (ใหม่!) ส่ง "ภาพดิบ" (Base64) ไปให้ Backend
    sendImageToBackend(targetLetter)
        .then(result => {
            console.log("✅ (Game) Backend responded:", result); 

            if (result.accepted && !isGameRoundOver) {
                isGameRoundOver = true;
                clearInterval(gameTimerInterval); 
                showGameFeedback(`Correct! (${result.prediction.symbol}) ⭐`, 'correct', targetLetter);
                setTimeout(startNewGameRound, 2000);
            } else if (!isGameRoundOver) {
                // (ยังไม่ถูก)
                if (result.error) {
                    feedbackBox.innerHTML = `<p>Error: ${result.error}</p>`;
                } else {
                    feedbackBox.innerHTML = `<p>Make the sign for "${targetLetter}"! (AI เห็นเป็น: ${result.prediction.symbol})</p>`;
                }
                isAnalysisRunning = false; // ปลดล็อค
            }
        })
        .catch(err => {
            console.error("❌ (Game) Backend fetch error:", err); 
            isAnalysisRunning = false;
        });
}


// ----------------------------------------------
// 5. (ใหม่!) ฟังก์ชันส่ง "ภาพดิบ" (Base64)
// ----------------------------------------------
async function sendImageToBackend(unitId) {
    
    // (A) จับภาพ (Screenshot) จาก <video>
    canvasContext.drawImage(webcamFeed, 0, 0, captureCanvas.width, captureCanvas.height);
    
    // (B) แปลงภาพเป็น Base64 string (คุณภาพ 0.8)
    const imageData = captureCanvas.toDataURL("image/jpeg", 0.8);

    const body = {
        unitId: unitId,
        image_data: imageData 
    };

    const response = await fetch(BACKEND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    
    if (!response.ok) {
        // (ถ้า 500 Server Error)
        const errorText = await response.text();
        console.error("Error from backend (raw):", errorText);
        throw new Error("Backend Error 500");
    }
    
    return await response.json();
}

// (Game) ฟังก์ชันแสดงผล Feedback (เหมือนเดิม)
function showGameFeedback(message, type, letter) { /* ... (โค้ดเดิม) ... */ }

// ฟังก์ชันเปิดกล้อง (เหมือนเดิม)
async function startWebcam() {
    webcamFeed = document.getElementById('webcam-feed');
    const webcamLoading = document.getElementById('webcam-loading');
    return new Promise(async (resolve, reject) => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { width: 640, height: 480 },
                audio: false 
            });
            webcamFeed.srcObject = stream;
            webcamFeed.addEventListener('loadeddata', async () => {
                try {
                    await webcamFeed.play(); 
                    console.log("✅ Webcam is now playing!");
                    webcamLoading.style.display = 'none';
                    resolve(); 
                } catch (playErr) {
                    console.error("❌ Error playing webcam:", playErr);
                    reject(playErr);
                }
            });
        } catch (err) {
            console.error("❌ Error starting webcam:", err);
            // ... (โค้ด Error handling เดิม) ...
            reject(err);
        }
    });
}