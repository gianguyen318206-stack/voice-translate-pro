/* =============================================
   VOICE TRANSLATE PRO — MAIN LOGIC v3
   Fixed: Audio autoplay + mic reliability
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
    const waveDivider = document.querySelector('.wave-divider');
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
    function haptic(ms = 25) { try { navigator.vibrate && navigator.vibrate(ms); } catch {} }

    // ═══════════════════════════════════════
    //  PERSISTENT AUDIO PLAYER (critical for mobile)
    //  Mobile only allows audio on elements that
    //  were .play()-ed during a user gesture.
    //  We create ONE element, unlock it on first
    //  click, then reuse it for ALL TTS playback.
    // ═══════════════════════════════════════
    const ttsPlayer = document.createElement('audio');
    ttsPlayer.setAttribute('playsinline', '');
    ttsPlayer.volume = 1.0;
    // Set a tiny silent audio track to initialize it
    ttsPlayer.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
    document.body.appendChild(ttsPlayer);

    let audioUnlocked = false;
    function unlockAudio() {
        if (audioUnlocked) return;
        // Directly bless the ttsPlayer under the active user gesture
        ttsPlayer.play()
            .then(() => {
                ttsPlayer.pause();
                audioUnlocked = true;
                console.log('[VT] ttsPlayer successfully unlocked');
            })
            .catch(e => console.warn('[VT] ttsPlayer unlock deferred:', e.message));
    }
    ['click', 'touchstart'].forEach(evt => {
        document.addEventListener(evt, unlockAudio, { once: false, passive: true });
    });

    // ═══════════════════════════════════════
    //  TRANSLATION
    // ═══════════════════════════════════════
    async function translateText(text, fromCode, toCode) {
        if (!text.trim()) return '';
        const f = getLang(fromCode).tr, t = getLang(toCode).tr;
        try {
            const r = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=${f}&tl=${t}&dt=t&q=${encodeURIComponent(text)}`);
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const d = await r.json();
            return d[0].map(s => s[0]).join('');
        } catch (e) {
            console.error('[VT] Translate error:', e);
            toast('Lỗi dịch! Kiểm tra mạng.', 'error');
            return '';
        }
    }

    // ═══════════════════════════════════════
    //  TTS - Google TTS (reuse ttsPlayer)
    //  + SpeechSynthesis fallback
    // ═══════════════════════════════════════
    let ttsQueue = [], ttsPlaying = false, currentTTSLang = null;

    function splitTTS(text, maxLen = 180) {
        const chunks = [];
        const sents = text.match(/[^.!?。！？\n]+[.!?。！？\n]?/g) || [text];
        let buf = '';
        sents.forEach(s => {
            if ((buf + s).length > maxLen && buf) { chunks.push(buf.trim()); buf = ''; }
            buf += s;
        });
        if (buf.trim()) chunks.push(buf.trim());
        return chunks;
    }

    function speak(text, langCode) {
        if (!text.trim()) return;
        stopSpeak();
        const ttsCode = getLang(langCode).tts;
        const chunks = splitTTS(text);
        currentTTSLang = langCode;

        ttsQueue = chunks.map(c =>
            `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(c)}&tl=${ttsCode}&client=tw-ob`
        );
        ttsPlaying = true;
        console.log('[VT] TTS start:', ttsCode, chunks.length, 'chunks');
        playNextChunk();
    }

    function playNextChunk() {
        if (!ttsQueue.length) {
            ttsPlaying = false;
            console.log('[VT] TTS done');
            return;
        }

        const url = ttsQueue.shift();

        // REUSE the same blessed audio element
        ttsPlayer.src = url;
        ttsPlayer.onended = () => playNextChunk();
        ttsPlayer.onerror = () => {
            console.warn('[VT] Google TTS failed, fallback to SpeechSynthesis');
            const text = decodeURIComponent(url.match(/q=([^&]+)/)?.[1] || '');
            speakFallback(text);
        };

        ttsPlayer.play().catch((e) => {
            console.warn('[VT] TTS play error:', e.message);
            const text = decodeURIComponent(url.match(/q=([^&]+)/)?.[1] || '');
            speakFallback(text);
        });
    }

    // SpeechSynthesis fallback
    function speakFallback(text) {
        if (!text || !window.speechSynthesis) {
            playNextChunk();
            return;
        }
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        const ttsCode = getLang(currentTTSLang).tts;
        utter.lang = currentTTSLang || ttsCode;
        utter.rate = 0.9;
        utter.volume = 1.0;
        const voices = window.speechSynthesis.getVoices();
        const match = voices.find(v => v.lang.startsWith(ttsCode)) || voices.find(v => v.lang.startsWith(ttsCode.split('-')[0]));
        if (match) utter.voice = match;
        utter.onend = () => playNextChunk();
        utter.onerror = () => playNextChunk();
        window.speechSynthesis.speak(utter);
    }

    function stopSpeak() {
        ttsQueue = [];
        ttsPlaying = false;
        ttsPlayer.pause();
        ttsPlayer.src = '';
        ttsPlayer.onended = null;
        ttsPlayer.onerror = null;
        if (window.speechSynthesis) window.speechSynthesis.cancel();
    }

    // Pre-load voices for fallback
    if (window.speechSynthesis) {
        window.speechSynthesis.getVoices();
        window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }

    // ═══════════════════════════════════════
    //  SPEECH RECOGNITION
    // ═══════════════════════════════════════
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition = null, isRec = false, recMode = null, accText = '', userStop = false;

    // Pre-request mic permission
    function requestMicPermission() {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            navigator.mediaDevices.getUserMedia({ audio: true })
                .then(stream => {
                    stream.getTracks().forEach(t => t.stop());
                    console.log('[VT] Mic permission granted');
                })
                .catch(err => console.warn('[VT] Mic permission denied:', err.message));
        }
    }
    requestMicPermission();

    function startRec(mode) {
        // Unlock audio on user gesture (important!)
        unlockAudio();

        if (!SR) {
            toast('Trình duyệt không hỗ trợ thu âm!', 'error');
            return;
        }

        // If already recording, stop
        if (isRec) {
            stopRec();
            return;
        }

        stopSpeak();
        haptic(50);

        // Auto-clear previous text
        textPartner.value = '';
        textUser.value = '';

        recMode = mode;
        accText = '';
        userStop = false;
        isRec = true;

        const langCode = mode === 'partner' ? langPartnerEl.value : langUserEl.value;
        const btn = mode === 'partner' ? micPartnerBtn : micUserBtn;
        const textEl = mode === 'partner' ? textPartner : textUser;

        btn.classList.add('recording');
        toast(mode === 'partner' ? '🎤 Đang nghe đối tác...' : '🎤 Đang nghe bạn nói...');

        // Create fresh recognition instance
        recognition = new SR();
        recognition.lang = langCode;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
            console.log('[VT] Recognition started, lang:', langCode);
        };

        recognition.onresult = (e) => {
            let interim = '';
            let finalText = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
                const transcript = e.results[i][0].transcript;
                if (e.results[i].isFinal) {
                    finalText += transcript;
                } else {
                    interim += transcript;
                }
            }
            if (finalText) accText += finalText;
            textEl.value = accText + (interim ? interim : '');
            console.log('[VT] Result:', { final: finalText, interim, accumulated: accText });
        };

        recognition.onerror = (e) => {
            console.error('[VT] Recognition error:', e.error);
            if (e.error === 'no-speech') {
                // No speech detected, keep listening
                toast('🎤 Không nghe thấy... Hãy nói to hơn');
                return;
            }
            if (e.error === 'aborted') return;
            if (e.error === 'not-allowed') {
                cleanup();
                toast('⚠️ Vui lòng cho phép sử dụng Microphone!', 'error');
                return;
            }
            if (e.error === 'network') {
                cleanup();
                toast('⚠️ Lỗi mạng! Kiểm tra kết nối internet.', 'error');
                return;
            }
            cleanup();
            toast('Lỗi thu âm: ' + e.error, 'error');
        };

        recognition.onend = () => {
            console.log('[VT] Recognition ended, userStop:', userStop, 'isRec:', isRec);
            if (!userStop && isRec) {
                // Auto-restart (mobile browsers stop after each sentence)
                try {
                    setTimeout(() => {
                        if (isRec && !userStop) {
                            recognition.start();
                            console.log('[VT] Auto-restarted recognition');
                        }
                    }, 100);
                } catch (err) {
                    console.error('[VT] Auto-restart failed:', err);
                    cleanup();
                    processResult();
                }
                return;
            }
            cleanup();
            processResult();
        };

        // Start recognition
        try {
            recognition.start();
            startWave();
            console.log('[VT] Recognition.start() called');
        } catch (err) {
            console.error('[VT] Failed to start recognition:', err);
            cleanup();
            toast('Không thể bật microphone!', 'error');
        }
    }

    function stopRec() {
        if (!isRec) return;
        haptic(30);
        userStop = true;
        console.log('[VT] User requested stop');
        try {
            recognition.stop();
        } catch (err) {
            console.warn('[VT] Stop error:', err);
            cleanup();
            processResult();
        }
    }

    function cleanup() {
        isRec = false;
        micPartnerBtn.classList.remove('recording');
        micUserBtn.classList.remove('recording');
        stopWave();
    }

    async function processResult() {
        const text = accText.trim();
        if (!text || !recMode) {
            console.log('[VT] No text to process');
            return;
        }

        const fromLang = recMode === 'partner' ? langPartnerEl.value : langUserEl.value;
        const toLang   = recMode === 'partner' ? langUserEl.value : langPartnerEl.value;
        const sourceEl = recMode === 'partner' ? textPartner : textUser;
        const targetEl = recMode === 'partner' ? textUser : textPartner;

        sourceEl.value = text;
        toast('⏳ Đang dịch...');

        const translated = await translateText(text, fromLang, toLang);
        if (translated) {
            targetEl.value = translated;
            toast('✅ Dịch xong!', 'success');

            // Auto-play TTS (short delay for stability)
            setTimeout(() => {
                speak(translated, toLang);
            }, 300);

            saveHist(text, fromLang, translated, toLang);
        }
    }

    // ═══════════════════════════════════════
    //  WAVEFORM (CSS-only, no getUserMedia)
    //  Không dùng getUserMedia để tránh xung
    //  đột mic với SpeechRecognition trên mobile
    // ═══════════════════════════════════════
    function startWave() {
        waveDivider.classList.add('active');
        if (recMode === 'partner') {
            waveDivider.classList.add('partner-wave');
            waveDivider.classList.remove('user-wave');
        } else {
            waveDivider.classList.add('user-wave');
            waveDivider.classList.remove('partner-wave');
        }
    }
    function stopWave() {
        waveDivider.classList.remove('active', 'partner-wave', 'user-wave');
    }

    // ═══════════════════════════════════════
    //  CAMERA OCR
    // ═══════════════════════════════════════
    let camStream = null;
    function openCam() {
        haptic();
        unlockAudio();
        cameraOverlay.classList.add('active');
        ocrStatus.textContent = '';
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } } })
            .then(s => { camStream = s; cameraVideo.srcObject = s; })
            .catch(() => { toast('Không mở được camera!', 'error'); closeCam(); });
    }
    function closeCam() {
        cameraOverlay.classList.remove('active');
        if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
        cameraVideo.srcObject = null;
    }
    async function doOCR() {
        haptic(50);
        const vw = cameraVideo.videoWidth, vh = cameraVideo.videoHeight;
        if (!vw || !vh) { toast('Camera chưa sẵn sàng!', 'error'); return; }
        cameraCanvas.width = vw;
        cameraCanvas.height = vh;
        cameraCanvas.getContext('2d').drawImage(cameraVideo, 0, 0, vw, vh);
        const img = cameraCanvas.toDataURL('image/jpeg', 0.9);

        ocrStatus.textContent = '🔍 Đang nhận diện...';
        const langMap = { vi:'vie', en:'eng', 'zh-CN':'chi_sim', ja:'jpn', ko:'kor', fr:'fra', es:'spa', de:'deu', ru:'rus', th:'tha', pt:'por', id:'ind', ar:'ara', hi:'hin' };
        const tl = langMap[getLang(langPartnerEl.value).tr] || 'eng';

        try {
            const r = await Tesseract.recognize(img, tl, {
                logger: m => { if (m.status === 'recognizing text') ocrStatus.textContent = `🔍 Quét... ${Math.round(m.progress * 100)}%`; }
            });
            const t = r.data.text.trim();
            closeCam();
            if (t) {
                textPartner.value = t;
                toast('✅ Đang dịch...', 'success');
                const res = await translateText(t, langPartnerEl.value, langUserEl.value);
                if (res) {
                    textUser.value = res;
                    speak(res, langUserEl.value);
                    saveHist(t, langPartnerEl.value, res, langUserEl.value);
                }
            } else {
                toast('Không nhận diện được văn bản!', 'error');
            }
        } catch (err) {
            console.error('[VT] OCR error:', err);
            ocrStatus.textContent = '';
            toast('Lỗi nhận diện!', 'error');
        }
    }

    // ═══════════════════════════════════════
    //  HISTORY
    // ═══════════════════════════════════════
    const HK = 'vt_hist';
    const getHist = () => { try { return JSON.parse(localStorage.getItem(HK)) || []; } catch { return []; } };
    function saveHist(s, sl, d, dl) {
        const h = getHist();
        h.unshift({ s, sl: getLang(sl).name, d, dl: getLang(dl).name, t: new Date().toLocaleString('vi-VN') });
        if (h.length > 50) h.pop();
        localStorage.setItem(HK, JSON.stringify(h));
    }
    function renderHist() {
        const h = getHist();
        if (!h.length) {
            historyList.innerHTML = '<div class="history-empty"><i class="fa-solid fa-inbox" style="font-size:30px;display:block;margin-bottom:10px"></i>Chưa có lịch sử</div>';
            return;
        }
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
    micPartnerBtn.addEventListener('click', () => startRec('partner'));
    micUserBtn.addEventListener('click', () => startRec('user'));

    speakPartner.addEventListener('click', () => { haptic(); unlockAudio(); speak(textPartner.value, langPartnerEl.value); });
    speakUser.addEventListener('click', () => { haptic(); unlockAudio(); speak(textUser.value, langUserEl.value); });

    copyPartner.addEventListener('click', () => {
        if (textPartner.value) { navigator.clipboard.writeText(textPartner.value); haptic(); toast('📋 Đã sao chép!', 'success'); }
    });
    copyUser.addEventListener('click', () => {
        if (textUser.value) { navigator.clipboard.writeText(textUser.value); haptic(); toast('📋 Đã sao chép!', 'success'); }
    });

    btnSwap.addEventListener('click', () => {
        haptic();
        const tmpL = langPartnerEl.value;
        langPartnerEl.value = langUserEl.value;
        langUserEl.value = tmpL;
        const tmpT = textPartner.value;
        textPartner.value = textUser.value;
        textUser.value = tmpT;
        toast('🔄 Đã hoán đổi!');
    });

    btnTranslate.addEventListener('click', async () => {
        haptic();
        unlockAudio();
        const t = textUser.value.trim();
        if (!t) { toast('Nhập văn bản trước!', 'error'); return; }
        toast('⏳ Đang dịch...');
        const r = await translateText(t, langUserEl.value, langPartnerEl.value);
        if (r) {
            textPartner.value = r;
            toast('✅ Dịch xong!', 'success');
            speak(r, langPartnerEl.value);
            saveHist(t, langUserEl.value, r, langPartnerEl.value);
        }
    });

    btnCamera.addEventListener('click', openCam);
    closeCamera.addEventListener('click', closeCam);
    captureBtn.addEventListener('click', doOCR);

    btnHistory.addEventListener('click', () => { haptic(); renderHist(); historyPanel.classList.add('active'); historyOverlay.classList.add('active'); });
    const closeHistFn = () => { historyPanel.classList.remove('active'); historyOverlay.classList.remove('active'); };
    closeHistory.addEventListener('click', closeHistFn);
    historyOverlay.addEventListener('click', closeHistFn);
    clearHistory.addEventListener('click', () => { localStorage.removeItem(HK); renderHist(); toast('🗑️ Đã xoá lịch sử'); });

    // PWA
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(err => console.warn('[VT] SW error:', err));
    }

    console.log('[VT] Voice Translate Pro v3 loaded');
    toast('✨ Sẵn sàng phiên dịch!', 'success');
});
