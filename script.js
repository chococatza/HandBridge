// (เหมือนเดิม) สร้าง Array ของตัวอักษรไว้เป็น Master
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// (ใหม่) ตัวแปรสำหรับจัดการสถานะเกม
let gameTimerInterval;
let isGameRoundOver = false;


// (อัปเดต) ใช้ 'DOMContentLoaded' เพื่อเลือกว่าจะรันฟังก์ชันไหน
document.addEventListener('DOMContentLoaded', () => {
    
    if (document.body.id === 'page-practice') {
        // ถ้าเราอยู่ที่หน้า Practice (ฝึกฝน)
        setupPracticePage();
    } 
    
    if (document.body.id === 'page-game') {
        // ถ้าเราอยู่ที่หน้า Game (เกม)
        setupGamePage();
    }
});


// ----------------------------------------------
// 1. ฟังก์ชันสำหรับหน้า Practice (เหมือนเดิม)
// ----------------------------------------------
async function setupPracticePage() {
    // ... (โค้ดทั้งหมดของ setupPracticePage จากครั้งก่อน อยู่ตรงนี้) ...
    // ... (ที่อ่าน URL, ตั้งค่าปุ่ม Next/Prev, เปิดกล้อง) ...
    // ... (และเรียก startMockAIAnalysis_Practice) ...

    // (คัดลอกโค้ด setupPracticePage เดิมมาวางที่นี่ได้เลย)
    // ผมจะย่อไว้เพื่อไม่ให้ยาวเกินไปนะครับ
    console.log("Practice Page Loaded");
    
    // (นี่คือโค้ดเดิมแบบย่อ)
    const urlParams = new URLSearchParams(window.location.search);
    const currentLetter = urlParams.get('letter') || 'A';
    const currentIndex = ALPHABET.indexOf(currentLetter);
    const prevIndex = (currentIndex - 1 + ALPHABET.length) % ALPHABET.length;
    const nextIndex = (currentIndex + 1) % ALPHABET.length;
    const prevLetter = ALPHABET[prevIndex];
    const nextLetter = ALPHABET[nextIndex];
    
    document.title = `Practice: Letter ${currentLetter}`;
    document.getElementById('current-letter').innerText = currentLetter;
    const exampleImage = document.getElementById('example-image');
    exampleImage.src = `images/example-${currentLetter}.jpg`; // (อย่าลืม path 'images/')
    exampleImage.alt = `Example of Sign '${currentLetter}'`;

    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    prevBtn.innerHTML = `&larr; Previous (${prevLetter})`;
    nextBtn.innerHTML = `Next (${nextLetter}) &rarr;`;
    prevBtn.onclick = () => { window.location.href = `practice.html?letter=${prevLetter}`; };
    nextBtn.onclick = () => { window.location.href = `practice.html?letter=${nextLetter}`; };
    
    await startWebcam(); // (แยกฟังก์ชันเปิดกล้อง)
    
    // (เปลี่ยนชื่อ) เรียก AI จำลองสำหรับหน้า Practice
    startMockAIAnalysis_Practice(currentLetter, nextLetter);
}

// (เปลี่ยนชื่อ) ฟังก์ชันจำลอง AI สำหรับหน้า Practice
function startMockAIAnalysis_Practice(currentLetter, nextLetter) {
    const feedbackBox = document.getElementById('feedback-box');
    
    // (จำลองว่าทำถูก)
    setTimeout(() => {
        feedbackBox.innerHTML = '<p>Correct! Well done! ⭐</p>';
        feedbackBox.className = 'feedback-area correct';

        // (รันอัตโนมัติ)
        setTimeout(() => {
            feedbackBox.innerHTML = `<p>Loading next letter: ${nextLetter}...</p>`;
            feedbackBox.className = 'feedback-area';
            window.location.href = `practice.html?letter=${nextLetter}`;
        }, 1500); 

    }, 8000); // จำลองว่าทำถูกใน 8 วินาที
}


// ----------------------------------------------
// 2. (ใหม่!) ฟังก์ชันสำหรับหน้า Game
// ----------------------------------------------
async function setupGamePage() {
    console.log("Game Page Loaded");
    await startWebcam(); // ใช้ฟังก์ชันเปิดกล้องร่วมกัน
    
    // เริ่มรอบเกมใหม่
    startNewGameRound();
}

function startNewGameRound() {
    isGameRoundOver = false; // รีเซ็ตสถานะ
    
    // 1. สุ่มตัวอักษร
    const randomLetter = ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    document.getElementById('game-letter').innerText = randomLetter;
    
    // 2. รีเซ็ตและเริ่มจับเวลา (จำลอง 10 วินาที)
    const timerDisplay = document.querySelector('#game-timer span');
    let timeLeft = 10;
    timerDisplay.innerText = timeLeft;
    
    // เคลียร์ Timer เก่า (ถ้ามี)
    clearInterval(gameTimerInterval);
    
    gameTimerInterval = setInterval(() => {
        timeLeft--;
        timerDisplay.innerText = timeLeft;
        
        // 3. (แพ้) ถ้าหมดเวลา
        if (timeLeft <= 0) {
            clearInterval(gameTimerInterval);
            if (!isGameRoundOver) { // ถ้ายังไม่ถูก
                isGameRoundOver = true;
                showGameFeedback('Time\'s Up! ⌛', 'hint', randomLetter);
                // โหลดรอบใหม่
                setTimeout(startNewGameRound, 2000);
            }
        }
    }, 1000); // นับถอยหลังทุก 1 วินาที
    
    // 4. เริ่ม AI จำลองสำหรับเกม
    startMockAIAnalysis_Game(timeLeft, randomLetter);
}

// (ใหม่) ฟังก์ชันจำลอง AI สำหรับหน้า Game
function startMockAIAnalysis_Game(timeLeft, letter) {
    const feedbackBox = document.getElementById('feedback-box');
    feedbackBox.innerHTML = `<p>Make the sign for "${letter}"!</p>`;
    feedbackBox.className = 'feedback-area';

    // (จำลอง) สุ่มเวลาที่ AI จะตรวจเจอ (เช่น 2-7 วินาที)
    const mockCorrectTime = (Math.random() * 5000) + 2000; // 2-7 วินาที
    
    setTimeout(() => {
        // 5. (ชนะ) ถ้า AI ตรวจเจอ
        if (!isGameRoundOver) { // ถ้าเวลายังไม่หมด
            isGameRoundOver = true;
            clearInterval(gameTimerInterval); // หยุดนับเวลา
            showGameFeedback('Correct! ⭐', 'correct', letter);
            // โหลดรอบใหม่
            setTimeout(startNewGameRound, 2000);
        }
    }, mockCorrectTime);
}

// (ใหม่) ฟังก์ชันแสดงผล Feedback (ใช้ร่วมกัน)
function showGameFeedback(message, type, letter) {
    const feedbackBox = document.getElementById('feedback-box');
    feedbackBox.innerHTML = `<p>${message}</p>`;
    feedbackBox.className = `feedback-area ${type}`;
    console.log(`Round Over: ${letter} - Result: ${message}`);
}


// ----------------------------------------------
// 3. (ใหม่!) ฟังก์ชันเปิดกล้อง (ใช้ร่วมกัน)
// ----------------------------------------------
async function startWebcam() {
    const webcamFeed = document.getElementById('webcam-feed');
    const webcamLoading = document.getElementById('webcam-loading');
    const feedbackBox = document.getElementById('feedback-box');

    if (!webcamFeed) return; // ถ้าหน้านั้นไม่มีกล้อง

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: 640, height: 480 },
            audio: false 
        });
        
        webcamFeed.srcObject = stream;
        webcamLoading.style.display = 'none';

    } catch (err) {
        console.error("Error accessing webcam:", err);
        if (webcamLoading) webcamLoading.innerText = "Failed to access webcam. Please allow camera access.";
        if (feedbackBox) {
            feedbackBox.innerHTML = '<p class="hint">Cannot start without camera access.</p>';
            feedbackBox.className = 'feedback-area hint';
        }
    }
}