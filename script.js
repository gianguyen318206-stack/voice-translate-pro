/* =============================================
   VOICE TRANSLATE PRO — MAIN LOGIC v2
   ============================================= */
document.addEventListener('DOMContentLoaded', () => {

    // ─── LANGUAGE CONFIG ───
    const LANGS = [
        { code:'vi-VN',  name:'🇻🇳 Tiếng Việt',      tts:'vi',    tr:'vi'    },
        { code:'en-US',  name:'🇺🇸 English',          tts:'en',    tr:'en'    },
        { code:'zh-CN',  name:'🇨🇳 中文 (Trung)',      tts:'zh-CN', tr:'zh-CN' },
        { code:'ja-JP',  name:'🇯🇵 日本語 (Nhật)',     tts:'ja',    tr:'ja'    },
        { code:'ko-KR',  name:'🇰🇷 한국어 (Hàn)',      tts:'ko',    tr:'ko'    },
        { code:'fr-FR',  name:'🇫🇷 Français (Pháp)',  tts:'fr',    tr:'fr'    },
        { code:'es-ES',  name:'🇪🇸 Español (TBN)',    tts:'es',    tr:'es'    },
        { code:'de-DE',  name:'🇩🇪 Deutsch (Đức)',    tts:'de',    tr:'de'    },
        { code:'ru-RU',  name:'🇷🇺 Русский (Nga)',    tts:'ru',    tr:'ru'    },
        { code:'th-TH',  name:'🇹🇭 ไทย (Thái)',       tts:'th',    tr:'th'    },
        { code:'pt-BR',  name:'🇧🇷 Português',        tts:'pt',    tr:'pt'    },
        { code:'id-ID',  name:'🇮🇩 Indonesia',        tts:'id',    tr:'id'    },
        { code:'ar-SA',  name:'🇸🇦 العربية',           tts:'ar',    tr:'ar'    },
        { code:'hi-IN',  name:'🇮🇳 हिन्दी',             tts:'hi',    tr:'hi'    },
    ];

    // ─── DOM ───
    const $ = id => document.getElementById(id);
    const langPartnerEl = $('lang-partner'), langUserEl = $('lang-user');
    const textPartner = $('text-partner'), textUser = $('text-user');
    const micPartnerBtn = $('mic-partner'), micUserBtn = $('mic-user');
    const speakPartner = $('speak-partner'), speakUser = $('speak-user');
    const copyPartner = $('copy-partner'), copyUser = $('copy-user');
    const btnSwap = $('btn-swap'), btnTranslate = $('btn-translate');
    const btnCamera = $('btn-camera'), btnHistory = $('btn-history');
    const historyPanel = $('history-panel'), historyOverlay = $('history-overlay');
    const historyList = $('history-list'), closeHistory = $('close-history'), clearHistory = $('clear-history');
    const cameraOverlay = $('camera-overlay'), cameraVideo = $('camera-video');
    const cameraCanvas = $('camera-canvas'), captureBtn = $('capture-btn'), closeCamera = $('close-camera');
    const ocrStatus = $('ocr-status');
    const waveCanvas = $('waveform'), waveDivider = document.querySelector('.wave-divider');
    const toastEl = $('toast');

    // ─── POPULATE SELECTS ───
    LANGS.forEach(l => {
        langPartnerEl.add(new Option(l.name, l.code));
        langUserEl.add(new Option(l.name, l.code));
    });
    langPartnerEl.value = 'zh-CN';
    langUserEl.value = 'vi-VN';

    const getLang = code => LANGS.find(l => l.code === code) || LANGS[0];

    // ─── TOAST ───
    let toastT = null;
    function toast(msg, type = '') {
        clearTimeout(toastT);
        toastEl.textContent = msg;
        toastEl.className = 'toast show ' + type;
        toastT = setTimeout(() => toastEl.className = 'toast', 2500);
    }
    function haptic(ms = 25) { navigator.vibrate && navigator.vibrate(ms); }

    // ═══════════════════════════════════════
    //  TRANSLATION
    // ═══════════════════════════════════════
    async function translateText(text, fromCode, toCode) {
        if (!text.trim()) return '';
        const f = getLang(fromCode).tr, t = getLang(toCode).tr;
        try {
            const r = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=${f}&tl=${t}&dt=t&q=${encodeURIComponent(text)}`);
            if (!r.ok) throw 0;
            const d = await r.json();
            return d[0].map(s => s[0]).join('');
        } catch { toast('Lỗi dịch! Kiểm tra mạng.', 'error'); return ''; }
    }

    // ═══════════════════════════════════════
    //  TTS (Google)
    // ═══════════════════════════════════════
    let ttsAudio = null, ttsQueue = [], ttsPlaying = false;

    function splitTTS(text) {
        const chunks = [], sents = text.match(/[^.!?。！？\n]+[.!?。！？\n]?/g) || [text];
        let buf = '';
        sents.forEach(s => { if ((buf+s).length > 180 && buf) { chunks.push(buf.trim()); buf=''; } buf+=s; });
        if (buf.trim()) chunks.push(buf.trim());
        return chunks;
    }
    function speak(text, langCode) {
        if (!text.trim()) return;
        stopSpeak();
        const tts = getLang(langCode).tts;
        ttsQueue = splitTTS(text).map(c => `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(c)}&tl=${tts}&client=tw-ob`);
        ttsPlaying = true; playNext();
    }
    function playNext() {
        if (!ttsQueue.length) { ttsPlaying = false; return; }
        ttsAudio = new Audio(ttsQueue.shift());
        ttsAudio.volume = 1;
        ttsAudio.onended = playNext;
        ttsAudio.onerror = () => { console.warn('TTS error'); playNext(); };
        ttsAudio.play().catch(playNext);
    }
    function stopSpeak() {
        ttsQueue = []; ttsPlaying = false;
        if (ttsAudio) { ttsAudio.pause(); ttsAudio = null; }
    }

    // ═══════════════════════════════════════
    //  SPEECH RECOGNITION
    // ═══════════════════════════════════════
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition = null, isRec = false, recMode = null, accText = '', userStop = false;

    // Pre-request mic
    if (navigator.mediaDevices?.getUserMedia) {
        navigator.mediaDevices.getUserMedia({audio:true}).then(s => s.getTracks().forEach(t=>t.stop())).catch(()=>{});
    }

    function startRec(mode) {
        if (!SR) { toast('Trình duyệt không hỗ trợ!', 'error'); return; }
        if (isRec) { stopRec(); return; }
        stopSpeak(); haptic(50);

        // Tự động xoá text cũ khi bắt đầu thu câu mới
        textPartner.value = '';
        textUser.value = '';

        recMode = mode; accText = ''; userStop = false; isRec = true;

        const lang = mode === 'partner' ? langPartnerEl.value : langUserEl.value;
        const btn = mode === 'partner' ? micPartnerBtn : micUserBtn;
        const txt = mode === 'partner' ? textPartner : textUser;

        btn.classList.add('recording');
        toast(mode === 'partner' ? '🎤 Đang nghe đối tác...' : '🎤 Đang nghe bạn...');

        recognition = new SR();
        recognition.lang = lang;
        recognition.continuous = true;
        recognition.interimResults = true;

        recognition.onresult = e => {
            let interim = '', final = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
                const t = e.results[i][0].transcript;
                e.results[i].isFinal ? final += t : interim += t;
            }
            if (final) accText += final;
            txt.value = accText + interim;
        };
        recognition.onerror = e => {
            if (e.error === 'no-speech' || e.error === 'aborted') return;
            cleanup(); toast('Lỗi thu âm: ' + e.error, 'error');
        };
        recognition.onend = () => {
            if (!userStop && isRec) {
                try { recognition.start(); } catch { cleanup(); processRec(); }
                return;
            }
            cleanup(); processRec();
        };
        try { recognition.start(); startWave(); } catch { cleanup(); toast('Không thể mở mic!','error'); }
    }

    function stopRec() { if (!isRec) return; haptic(); userStop = true; try { recognition.stop(); } catch {} }
    function cleanup() {
        isRec = false;
        micPartnerBtn.classList.remove('recording');
        micUserBtn.classList.remove('recording');
        stopWave();
    }

    async function processRec() {
        const text = accText.trim();
        if (!text || !recMode) return;
        const fromL = recMode==='partner' ? langPartnerEl.value : langUserEl.value;
        const toL = recMode==='partner' ? langUserEl.value : langPartnerEl.value;
        const srcEl = recMode==='partner' ? textPartner : textUser;
        const dstEl = recMode==='partner' ? textUser : textPartner;
        srcEl.value = text;
        toast('⏳ Đang dịch...');
        const result = await translateText(text, fromL, toL);
        if (result) {
            dstEl.value = result;
            toast('✅ Dịch xong!', 'success');
            setTimeout(() => speak(result, toL), 350);
            saveHist(text, fromL, result, toL);
        }
    }

    // ═══════════════════════════════════════
    //  WAVEFORM
    // ═══════════════════════════════════════
    let audioCtx, analyser, micStream, animId;
    const wCtx = waveCanvas.getContext('2d');

    function startWave() {
        waveDivider.classList.add('active');
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 256;
            navigator.mediaDevices.getUserMedia({audio:true}).then(stream => {
                micStream = stream;
                audioCtx.createMediaStreamSource(stream).connect(analyser);
                drawWave();
            }).catch(()=>{});
        } catch {}
    }
    function drawWave() {
        const buf = analyser.frequencyBinCount;
        const data = new Uint8Array(buf);
        const w = waveCanvas.width = waveCanvas.parentElement.clientWidth * 2;
        const h = waveCanvas.height = waveCanvas.parentElement.clientHeight * 2;
        const color1 = recMode === 'partner' ? [239,68,68] : [59,130,246];
        const color2 = recMode === 'partner' ? [168,85,247] : [6,182,212];

        (function draw() {
            animId = requestAnimationFrame(draw);
            analyser.getByteFrequencyData(data);
            wCtx.clearRect(0, 0, w, h);
            const bars = 20, bw = w/bars*.55, gap = w/bars*.45;
            for (let i = 0; i < bars; i++) {
                const v = data[Math.floor(i*buf/bars)] / 255;
                const bh = Math.max(4, v * h * .8);
                const x = i*(bw+gap)+gap/2, y = (h-bh)/2;
                const t = i / bars;
                const r = Math.round(color1[0]*(1-t) + color2[0]*t);
                const g = Math.round(color1[1]*(1-t) + color2[1]*t);
                const b = Math.round(color1[2]*(1-t) + color2[2]*t);
                wCtx.fillStyle = `rgba(${r},${g},${b},${.35 + v*.65})`;
                wCtx.beginPath();
                wCtx.roundRect(x, y, bw, bh, bw/2);
                wCtx.fill();
            }
        })();
    }
    function stopWave() {
        waveDivider.classList.remove('active');
        cancelAnimationFrame(animId);
        if (micStream) micStream.getTracks().forEach(t=>t.stop());
        if (audioCtx?.state !== 'closed') audioCtx?.close().catch(()=>{});
        wCtx.clearRect(0, 0, waveCanvas.width, waveCanvas.height);
    }

    // ═══════════════════════════════════════
    //  CAMERA OCR
    // ═══════════════════════════════════════
    let camStream = null;
    function openCam() {
        haptic(); cameraOverlay.classList.add('active'); ocrStatus.textContent='';
        navigator.mediaDevices.getUserMedia({video:{facingMode:'environment',width:{ideal:1280}}})
            .then(s => { camStream=s; cameraVideo.srcObject=s; })
            .catch(() => { toast('Không mở được camera!','error'); closeCam(); });
    }
    function closeCam() {
        cameraOverlay.classList.remove('active');
        if (camStream) { camStream.getTracks().forEach(t=>t.stop()); camStream=null; }
        cameraVideo.srcObject=null;
    }
    async function doOCR() {
        haptic(50);
        const vw=cameraVideo.videoWidth, vh=cameraVideo.videoHeight;
        cameraCanvas.width=vw; cameraCanvas.height=vh;
        cameraCanvas.getContext('2d').drawImage(cameraVideo,0,0,vw,vh);
        const img = cameraCanvas.toDataURL('image/jpeg',.9);
        ocrStatus.textContent='🔍 Đang nhận diện...';
        const langMap = {vi:'vie',en:'eng','zh-CN':'chi_sim',ja:'jpn',ko:'kor',fr:'fra',es:'spa',de:'deu',ru:'rus',th:'tha',pt:'por',id:'ind',ar:'ara',hi:'hin'};
        const tl = langMap[getLang(langPartnerEl.value).tr] || 'eng';
        try {
            const r = await Tesseract.recognize(img, tl, {
                logger: m => { if (m.status==='recognizing text') ocrStatus.textContent=`🔍 Quét... ${Math.round(m.progress*100)}%`; }
            });
            const t = r.data.text.trim(); closeCam();
            if (t) {
                textPartner.value = t; toast('✅ Đang dịch...','success');
                const res = await translateText(t, langPartnerEl.value, langUserEl.value);
                if (res) { textUser.value=res; speak(res, langUserEl.value); saveHist(t, langPartnerEl.value, res, langUserEl.value); }
            } else toast('Không nhận diện được!','error');
        } catch { ocrStatus.textContent=''; toast('Lỗi OCR!','error'); }
    }

    // ═══════════════════════════════════════
    //  HISTORY
    // ═══════════════════════════════════════
    const HK = 'vt_hist';
    const getHist = () => { try { return JSON.parse(localStorage.getItem(HK))||[]; } catch { return []; }};
    function saveHist(s,sl,d,dl) {
        const h = getHist();
        h.unshift({s, sl:getLang(sl).name, d, dl:getLang(dl).name, t:new Date().toLocaleString('vi-VN')});
        if (h.length>50) h.pop();
        localStorage.setItem(HK, JSON.stringify(h));
    }
    function renderHist() {
        const h = getHist();
        if (!h.length) { historyList.innerHTML='<div class="history-empty"><i class="fa-solid fa-inbox" style="font-size:30px;display:block;margin-bottom:10px"></i>Chưa có lịch sử</div>'; return; }
        historyList.innerHTML = h.map(i => `<div class="history-item">
            <div class="h-lang"><i class="fa-solid fa-circle" style="font-size:5px;color:#f87171"></i> ${i.sl}</div>
            <div class="h-text">${i.s}</div>
            <div class="h-divider"></div>
            <div class="h-lang"><i class="fa-solid fa-circle" style="font-size:5px;color:#60a5fa"></i> ${i.dl}</div>
            <div class="h-text h-translated">${i.d}</div>
            <div style="font-size:10px;color:#3e4460;margin-top:6px">${i.t}</div>
        </div>`).join('');
    }

    // ═══════════════════════════════════════
    //  EVENTS
    // ═══════════════════════════════════════
    micPartnerBtn.onclick = () => startRec('partner');
    micUserBtn.onclick = () => startRec('user');
    speakPartner.onclick = () => { haptic(); speak(textPartner.value, langPartnerEl.value); };
    speakUser.onclick = () => { haptic(); speak(textUser.value, langUserEl.value); };
    copyPartner.onclick = () => { if (textPartner.value) { navigator.clipboard.writeText(textPartner.value); haptic(); toast('📋 Đã sao chép!','success'); }};
    copyUser.onclick = () => { if (textUser.value) { navigator.clipboard.writeText(textUser.value); haptic(); toast('📋 Đã sao chép!','success'); }};

    btnSwap.onclick = () => {
        haptic();
        [langPartnerEl.value, langUserEl.value] = [langUserEl.value, langPartnerEl.value];
        [textPartner.value, textUser.value] = [textUser.value, textPartner.value];
        toast('🔄 Đã hoán đổi!');
    };


    btnTranslate.onclick = async () => {
        haptic();
        const t = textUser.value.trim();
        if (!t) { toast('Nhập văn bản trước!','error'); return; }
        toast('⏳ Đang dịch...');
        const r = await translateText(t, langUserEl.value, langPartnerEl.value);
        if (r) { textPartner.value=r; toast('✅ Dịch xong!','success'); speak(r, langPartnerEl.value); saveHist(t, langUserEl.value, r, langPartnerEl.value); }
    };

    btnCamera.onclick = openCam;
    closeCamera.onclick = closeCam;
    captureBtn.onclick = doOCR;

    const openHist = () => { haptic(); renderHist(); historyPanel.classList.add('active'); historyOverlay.classList.add('active'); };
    const closeHist = () => { historyPanel.classList.remove('active'); historyOverlay.classList.remove('active'); };
    btnHistory.onclick = openHist;
    closeHistory.onclick = closeHist;
    historyOverlay.onclick = closeHist;
    clearHistory.onclick = () => { localStorage.removeItem(HK); renderHist(); toast('🗑️ Đã xoá lịch sử'); };

    // PWA
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});

    toast('✨ Sẵn sàng phiên dịch!', 'success');
});
