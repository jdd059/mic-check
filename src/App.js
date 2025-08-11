import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, MicOff, Video, VideoOff, Play, Square, Download, Circle, Mail } from 'lucide-react';

/** UI calibration: shift the meter display without touching audio or numbers */
const DISPLAY_TRIM_DB = 0; // try +2 if you want to match Logic visually

/** ======= Horizontal meter (VU-like smooth bar + responsive peak line) ======= */
function HorizontalMeter({ rmsDb, peakDb, floorDb = -40, onBarDbChange }) {
  // Map dB to percent width (stable fn so ESLint is happy)
  const dbToPct = useCallback((db) => {
    const span = 0 - floorDb;
    return Math.max(0, Math.min(100, ((db - floorDb) / span) * 100));
  }, [floorDb]);

  // latest input dB from parent, kept in a ref so RAF doesn't re-init
  const inputDbRef = React.useRef(floorDb);
  inputDbRef.current = rmsDb;

  // Displayed bar in dB (VU-like envelope)
  const [dispDb, setDispDb] = React.useState(floorDb);
  const dispDbRef = React.useRef(floorDb);

  // Peak line (visual)
  const [peakLinePct, setPeakLinePct] = React.useState(0);
  const lastPeakHoldTsRef = React.useRef(0);

  const rafRef = React.useRef(null);
  const lastTsRef = React.useRef(0);
  const lastSentDbRef = React.useRef(floorDb);
  const lastSentTsRef = React.useRef(0);

  useEffect(() => {
    // VU-like ballistics in dB (natural feel)
    const ATTACK_TAU = 0.25;    // rise ~250 ms
    const RELEASE_TAU = 0.80;   // fall ~800 ms (hangs like Logic)
    const TRANSIENT_TAU = 0.10; // faster on big jumps so bar “grabs” peaks
    const PEAK_HOLD_MS = 600;
    const PEAK_FALL_PER_SEC = 220; // fast fall of peak line toward bar
    const DEADBAND_DB = 0.3;    // ignore sub-dB flutter
    const CATCH_DB = 8;         // snap-to-target when rise >= 8 dB

    const step = (ts) => {
      const lastTs = lastTsRef.current || ts;
      const dt = Math.min(0.05, (ts - lastTs) / 1000);
      lastTsRef.current = ts;

      // Apply optional display trim here (UI-only)
      const targetDbRaw = inputDbRef.current;
      const targetDb = Math.max(targetDbRaw + DISPLAY_TRIM_DB, floorDb);

      // Envelope in dB
      const prevDb = dispDbRef.current;
      let deltaDb = targetDb - prevDb;
      if (Math.abs(deltaDb) < DEADBAND_DB) deltaDb = 0;

      const rising = deltaDb > 0;
      const bigTransient = rising && deltaDb >= CATCH_DB;

      let nextDb;
      if (bigTransient) {
        // hard catch so the bar meets the peak line
        nextDb = targetDb;
      } else {
        const tau = rising ? (deltaDb > 6 ? TRANSIENT_TAU : ATTACK_TAU) : RELEASE_TAU;
        const alpha = 1 - Math.exp(-((dt || 0.016) / tau));
        nextDb = prevDb + deltaDb * alpha;

        // if we’re within 0.5 dB of target, finish the catch
        if (rising && (targetDb - nextDb) < 0.5) nextDb = targetDb;
      }

      dispDbRef.current = nextDb;
      setDispDb(nextDb);

      // Peak line: instant rise on fast target; hold; then fall toward the bar
      const fastPct = dbToPct(targetDb);
      setPeakLinePct((prev) => {
        let p = prev;
        if (fastPct > prev) {
          p = fastPct;
          lastPeakHoldTsRef.current = ts;
        } else if (ts - lastPeakHoldTsRef.current > PEAK_HOLD_MS) {
          const barPct = dbToPct(dispDbRef.current);
          const fallAlpha = 1 - Math.exp(-PEAK_FALL_PER_SEC * dt);
          p = prev + (barPct - prev) * fallAlpha;
        }
        return p;
      });

      // Report displayed bar dB up to parent (so Tips match what users see)
      if (typeof onBarDbChange === 'function') {
        const since = ts - (lastSentTsRef.current || 0);
        if (since > 100 || Math.abs(nextDb - (lastSentDbRef.current ?? floorDb)) > 0.5) {
          lastSentTsRef.current = ts;
          lastSentDbRef.current = nextDb;
          onBarDbChange(nextDb);
        }
      }

      rafRef.current = requestAnimationFrame(step);
    };

    if (!rafRef.current) rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTsRef.current = 0;
    };
  }, [dbToPct, floorDb, onBarDbChange]);

  // Background zones keep the –24/–6 sweet spot guidance
  const bgZones = [
    { from: -60, to: -24, color: 'rgba(100,116,139,0.20)' }, // quiet
    { from: -24, to: -6,  color: 'rgba(34,197,94,0.20)'  },  // sweet spot
    { from: -6,  to: 0,   color: 'rgba(245,158,11,0.28)' },  // hot
  ];
  const ticks = [-60, -48, -36, -30, -24, -18, -12, -6, -3, 0]; // ruler only (no in-bar guides)

  const dispPct = dbToPct(dispDb);
  const yellowStartPct = dbToPct(-10);
  const amberStartPct = dbToPct(-6);

  return (
    <div className="w-full">
      {/* ruler */}
      <div className="relative h-6 mb-1">
        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-px bg-slate-600/60" />
        {ticks.map((db) => {
          const x = dbToPct(db);
          const isMajor = db % 12 === 0 || db === -24 || db === -6 || db === 0;
          const labelUp = db === -24 || db === -6;
          return (
            <div key={db} className="absolute" style={{ left: `calc(${x}% - 1px)`, top: 0 }}>
              <div
                className={`bg-slate-400/80 ${db === -6 ? 'bg-amber-400/80' : ''}`}
                style={{ width: isMajor ? 2 : 1, height: isMajor ? 12 : 8, marginLeft: -1 }}
              />
              <div
                className={`absolute ${labelUp ? '-top-4' : 'top-4'} -translate-x-1/2 text-[11px] leading-none ${
                  (db === -24 || db === -6 || db === 0) ? 'text-white font-medium' : 'text-slate-300/80'
                }`}
                style={{ whiteSpace: 'nowrap' }}
              >
                {db}
              </div>
            </div>
          );
        })}
        <div className="absolute left-0 -top-4 text-[10px] text-slate-400/70">dBFS</div>
      </div>

      {/* meter bar */}
      <div className="relative h-7 rounded-md bg-slate-800 border border-slate-700 overflow-hidden">
        {/* background zones */}
        {bgZones.map((z, i) => {
          const left  = Math.max(0, Math.min(100, ((z.from - floorDb) / (0 - floorDb)) * 100));
          const right = Math.max(0, Math.min(100, ((z.to   - floorDb) / (0 - floorDb)) * 100));
          const width = Math.max(0, right - left);
          return (
            <div
              key={i}
              className="absolute top-0 bottom-0"
              style={{ left: `${left}%`, width: `${width}%`, backgroundColor: z.color, zIndex: 0 }}
            />
          );
        })}

        {/* subtle tail under fill */}
        <div
          className="absolute inset-y-0 left-0"
          style={{
            width: `${Math.max(dispPct, peakLinePct)}%`,
            background: 'linear-gradient(90deg, rgba(255,255,255,0.06), rgba(255,255,255,0.14))',
            opacity: 0.5,
            mixBlendMode: 'screen',
            zIndex: 1
          }}
        />

        {/* base fill — ALWAYS green */}
        <div
          className="absolute inset-y-0 left-0"
          style={{ width: `${dispPct}%`, backgroundColor: '#22c55e', opacity: 0.98, zIndex: 3 }}
        />

        {/* yellow overlay for the portion between -10 and -6 dB */}
        {dispPct > yellowStartPct && (
          <div
            className="absolute inset-y-0"
            style={{
              left: `${yellowStartPct}%`,
              width: `${Math.max(0, Math.min(dispPct, amberStartPct) - yellowStartPct)}%`,
              backgroundColor: '#eab308', // yellow
              zIndex: 4
            }}
          />
        )}

        {/* orange overlay for the portion above -6 dB */}
        {dispPct > amberStartPct && (
          <div
            className="absolute inset-y-0"
            style={{
              left: `${amberStartPct}%`,
              width: `${dispPct - amberStartPct}%`,
              backgroundColor: '#f59e0b', // orange/amber
              zIndex: 5
            }}
          />
        )}

        {/* peak line */}
        <div
          className="absolute top-0 bottom-0 w-[2px] bg-white/85"
          style={{ left: `calc(${peakLinePct}% - 1px)`, zIndex: 6 }}
        />

        {/* clip LED */}
        <div
          className="absolute right-1 top-1/2 -translate-y-1/2 h-3 w-3 rounded-full"
          style={{ backgroundColor: (peakDb ?? rmsDb) >= 0 ? '#ef4444' : 'rgba(100,116,139,0.45)', zIndex: 7 }}
          title="Clip"
        />
      </div>
    </div>
  );
}

/** ======= App ======= */
const MicCheck = () => {
  // ---------- State ----------
  const [isListening, setIsListening] = useState(false);
  const [audioLevel, setAudioLevel] = useState(-60); // RMS (input to meter)
  const [rmsAvgDb, setRmsAvgDb] = useState(-60);     // 2 s average (display)
  const [peakLevel, setPeakLevel] = useState(-60);   // peak/held numeric
  const [feedback, setFeedback] = useState("Click 'Start Audio Test' to check your microphone");
  const [audioDevices, setAudioDevices] = useState([]);
  const [videoDevices, setVideoDevices] = useState([]);
  const [selectedAudioDevice, setSelectedAudioDevice] = useState('');
  const [selectedVideoDevice, setSelectedVideoDevice] = useState('');
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [videoFeedback, setVideoFeedback] = useState("Click 'Start Video' to check your camera");
  const [hasVideoFrame, setHasVideoFrame] = useState(false);

  // Recording
  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);

  // Max (since reset)
  const [peakNumberDb, setPeakNumberDb] = useState(-60);

  // Email
  const [email, setEmail] = useState('');
  const [emailSubmitted, setEmailSubmitted] = useState(false);

  // ---------- Refs ----------
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const workletNodeRef = useRef(null);
  const peakHoldStateRef = useRef({ value: -60, ts: 0 });
  const animationFrameRef = useRef(null);

  const rmsAvgRef = useRef(-60);
  const lastAvgTsRef = useRef(0);

  // Tips zone (driven by displayed bar via callback)
  const tipsZoneRef = useRef('quiet'); // 'quiet' | 'green' | 'amber' | 'red'

  const videoRef = useRef(null);
  const videoStreamRef = useRef(null);
  const videoAnalysisRef = useRef(null);
  const maxPeakRef = useRef(-60);
  const mediaRecorderRef = useRef(null);
  const recordingTimerRef = useRef(null);

  /** ================ AUDIO METER LOOP (fallback analyser) ================ */
  const analyzeAudio = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;

    try {
      const fftSize = analyser.fftSize || 2048;
      // Prefer float time-domain ([-1..1]) for accurate RMS
      let timeData;
      if (analyser.getFloatTimeDomainData) {
        timeData = new Float32Array(fftSize);
        analyser.getFloatTimeDomainData(timeData);
      } else {
        const byteData = new Uint8Array(fftSize);
        analyser.getByteTimeDomainData(byteData);
        timeData = new Float32Array(fftSize);
        for (let i = 0; i < fftSize; i++) timeData[i] = (byteData[i] - 128) / 128; // to [-1,1]
      }

      let sum = 0;
      for (let i = 0; i < timeData.length; i++) {
        const v = timeData[i];
        sum += v * v;
      }
      const rms = Math.sqrt(sum / timeData.length);
      const db = rms > 0 ? 20 * Math.log10(rms) : -60;
      const clampedDb = Math.max(db, -60);

      // Feed the meter (raw RMS; meter smooths in dB internally)
      setAudioLevel(clampedDb);

      // Display RMS average (slower — ~2.0s)
      const now = performance.now();
      const dt = (now - (lastAvgTsRef.current || now)) / 1000;
      lastAvgTsRef.current = now;
      const AVG_TAU = 2.0;
      const alphaAvg = 1 - Math.exp(-(dt || 0.016) / AVG_TAU);
      const newAvg = rmsAvgRef.current + (clampedDb - rmsAvgRef.current) * alphaAvg;
      rmsAvgRef.current = newAvg;
      setRmsAvgDb(newAvg);

      // Max since reset (fallback)
      if (clampedDb > maxPeakRef.current) {
        maxPeakRef.current = clampedDb;
        setPeakNumberDb(clampedDb);
      }

      // Peak (fallback: instantaneous)
      setPeakLevel(clampedDb);
    } catch (err) {
      console.error('Audio analysis failed:', err);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      analyserRef.current = null;
      setFeedback('❌ Audio analysis error. Try stopping and starting again, or check mic permissions.');
      return;
    }

    animationFrameRef.current = requestAnimationFrame(analyzeAudio);
  }, []);

  // ---------- AUDIO ----------
  const startAudioAnalysis = useCallback(async () => {
    try {
      const constraints = {
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          ...(selectedAudioDevice ? { deviceId: { exact: selectedAudioDevice } } : {})
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      mediaStreamRef.current = stream;

      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      audioContextRef.current = ctx;
      await ctx.resume();
      const source = ctx.createMediaStreamSource(stream);

      // Optional worklet (preferred when available)
      try {
        await ctx.audioWorklet.addModule('/worklets/meter-processor.js');
        workletNodeRef.current = new AudioWorkletNode(ctx, 'meter-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 0
        });
        source.connect(workletNodeRef.current);
        workletNodeRef.current.port.onmessage = (e) => {
          const { rmsDb, peakDb } = e.data;

          // Feed bar with worklet RMS directly; meter smooths it in dB
          setAudioLevel(rmsDb);

          // Display RMS average (slower — ~2.0s)
          const now = performance.now();
          const dt = (now - (lastAvgTsRef.current || now)) / 1000;
          lastAvgTsRef.current = now;
          const AVG_TAU = 2.0;
          const alphaAvg = 1 - Math.exp(-(dt || 0.016) / AVG_TAU);
          const newAvg = rmsAvgRef.current + (rmsDb - rmsAvgRef.current) * alphaAvg;
          rmsAvgRef.current = newAvg;
          setRmsAvgDb(newAvg);

          // Peak: held line from worklet
          const floor = -60;
          const holdTime = 1500; // ms (internal visual hold)
          const prev = peakHoldStateRef.current?.value ?? floor;
          const prevTs = peakHoldStateRef.current?.ts ?? 0;
          if (peakDb > prev || now - prevTs > holdTime) {
            peakHoldStateRef.current = { value: peakDb, ts: now };
          }
          setPeakLevel(Math.max(peakHoldStateRef.current.value, floor));

          // Max since reset
          if (typeof peakDb === 'number' && peakDb > maxPeakRef.current) {
            maxPeakRef.current = peakDb;
            setPeakNumberDb(peakDb);
          }
        };
      } catch (err) {
        console.warn('AudioWorklet init failed', err);
      }

      // Analyser fallback for RMS if worklet not available
      analyserRef.current = ctx.createAnalyser();
      analyserRef.current.fftSize = 2048;
      analyserRef.current.smoothingTimeConstant = 0.0; // we do our own smoothing
      source.connect(analyserRef.current);

      setIsListening(true);

      // Initial tips
      tipsZoneRef.current = 'quiet';
      setFeedback('🔇 Very quiet - check mic and gain settings');

      analyzeAudio();
    } catch (error) {
      console.error('Error accessing microphone:', error);
      setFeedback("❌ Couldn't access your microphone. Please check permissions.");
    }
  }, [selectedAudioDevice, analyzeAudio]);

  const stopAudioAnalysis = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (workletNodeRef.current) {
      try { workletNodeRef.current.port.onmessage = null; workletNodeRef.current.disconnect(); } catch {}
      workletNodeRef.current = null;
    }
    if (mediaStreamRef.current) {
      try { mediaStreamRef.current.getTracks().forEach(t => t.stop()); } catch {}
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try { audioContextRef.current.close(); } catch {}
      audioContextRef.current = null;
    }
    analyserRef.current = null;

    setIsListening(false);
    setAudioLevel(-60);
    setRmsAvgDb(-60);
    setPeakLevel(-60);
    setPeakNumberDb(-60);
    rmsAvgRef.current = -60;
    tipsZoneRef.current = 'quiet';
    setFeedback("Click 'Start Audio Test' to check your microphone");
  }, []);

  // ---------- VIDEO ----------
  const startVideoAnalysis = async () => {
    try {
      setHasVideoFrame(false);
      if (videoAnalysisRef.current) {
        cancelAnimationFrame(videoAnalysisRef.current);
        videoAnalysisRef.current = null;
      }
      if (videoStreamRef.current) {
        try { videoStreamRef.current.getTracks().forEach(t => t.stop()); } catch {}
        videoStreamRef.current = null;
      }

      const constraints = {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          ...(selectedVideoDevice ? { deviceId: { exact: selectedVideoDevice } } : { facingMode: 'user' })
        },
        audio: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setIsVideoEnabled(true);
      videoStreamRef.current = stream;

      const el = videoRef.current;
      if (!el) {
        setVideoFeedback('❌ Video element not found.');
        return;
      }
      el.autoplay = true;
      el.muted = true;
      el.setAttribute('playsinline', '');
      el.srcObject = stream;
      el.load();

      let played = false;
      const tryPlay = async () => {
        try { await el.play(); played = true; setTimeout(() => analyzeVideo(), 120); } catch {}
      };
      await tryPlay();
      setTimeout(() => { if (!played) tryPlay(); analyzeVideo(); }, 400);
    } catch (error) {
      console.error('Error accessing camera:', error);
      setVideoFeedback(`❌ Couldn't access your camera: ${error.message}`);
      setIsVideoEnabled(false);
    }
  };

  function analyzeVideo() {
    if (!isVideoEnabled) return;

    const el = videoRef.current;
    if (!el || !el.srcObject) { videoAnalysisRef.current = requestAnimationFrame(analyzeVideo); return; }
    if (el.readyState < 2) { videoAnalysisRef.current = requestAnimationFrame(analyzeVideo); return; }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    canvas.width = 160; canvas.height = 120;

    try {
      ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

      let total = 0;
      for (let i = 0; i < data.length; i += 4) total += (data[i] + data[i + 1] + data[i + 2]) / 3;
      const avg = total / (data.length / 4);
      setHasVideoFrame(true);
      setVideoFeedback(avg < 50 ? '💡 Too dark - try facing a window or adding front lighting'
        : avg > 200 ? '☀️ Too bright - reduce lighting or move away from bright backgrounds'
        : '✅ Good lighting and framing!');
    } catch (err) {
      console.warn('Video analysis draw failed:', err?.name || err);
    }

    videoAnalysisRef.current = requestAnimationFrame(analyzeVideo);
  }

  const stopVideoAnalysis = useCallback(() => {
    setIsVideoEnabled(false);
    setHasVideoFrame(false);
    if (videoAnalysisRef.current) { cancelAnimationFrame(videoAnalysisRef.current); videoAnalysisRef.current = null; }
    try {
      if (videoStreamRef.current) { videoStreamRef.current.getTracks().forEach((t) => t.stop()); videoStreamRef.current = null; }
    } catch {}
    if (videoRef.current) {
      try { videoRef.current.pause(); videoRef.current.removeAttribute('src'); videoRef.current.srcObject = null; videoRef.current.load(); } catch {}
    }
    setVideoFeedback('Click ‘Start Video’ to check your camera');
  }, []);

  // ---------- UI ----------

  // displayed-bar callback → tips
  const [barDispDb, setBarDispDb] = useState(-60);

  // Tips follow the displayed bar value with ±1 dB hysteresis at −24/−6/0
  useEffect(() => {
    const HYS = 1.0;
    const last = tipsZoneRef.current;
    let next = last;
    const v = barDispDb;

    const toGreen = v >= -24 + HYS;
    const toAmber = v >= -6  + HYS;
    const toRed   = v >= 0   + HYS;

    const backToAmber = v <= 0   - HYS;
    const backToGreen = v <= -6  - HYS;
    const backToQuiet = v <= -24 - HYS;

    if (last === 'quiet') { if (toGreen) next = 'green'; }
    else if (last === 'green') { if (toAmber) next = 'amber'; else if (backToQuiet) next = 'quiet'; }
    else if (last === 'amber') { if (toRed) next = 'red'; else if (backToGreen) next = 'green'; }
    else if (last === 'red') { if (backToAmber) next = 'amber'; }

    if (next !== last) {
      tipsZoneRef.current = next;
      setFeedback(
        next === 'red'   ? '🔴 Clipping detected! Lower your gain or back away from the mic' :
        next === 'amber' ? '🟠 Getting hot - try lowering your gain a bit' :
        next === 'green' ? "🟢 In the sweet spot — you're ready to record" :
                           '🔇 Very quiet - check mic and gain settings'
      );
    }
  }, [barDispDb]);

  // ---------- RECORDING ----------
  const startRecording = async () => {
    if (!mediaStreamRef.current) { await startAudioAnalysis(); }
    try {
      mediaRecorderRef.current = new MediaRecorder(mediaStreamRef.current, { mimeType: 'audio/webm' });
      const chunks = [];
      mediaRecorderRef.current.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        setRecordedBlob(blob);
        mediaRecorderRef.current = null;
      };
      mediaRecorderRef.current.start();
      setIsRecording(true);
      setRecordingTime(0);
      recordingTimerRef.current = setInterval(() => { setRecordingTime((prev) => prev + 0.1); }, 100);
    } catch (error) {
      console.error('Error starting recording:', error);
      setFeedback('❌ Recording failed. Please try again.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) mediaRecorderRef.current.stop();
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    setIsRecording(false);
  };

  const playRecording = () => {
    if (recordedBlob) {
      const audio = new Audio(URL.createObjectURL(recordedBlob));
      setIsPlaying(true);
      audio.play();
      audio.onended = () => setIsPlaying(false);
    }
  };

  const downloadRecording = () => {
    if (recordedBlob) {
      const url = URL.createObjectURL(recordedBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'mic-test.webm';
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  // ---------- EFFECTS (devices) ----------
  useEffect(() => {
    const getDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter((d) => d.kind === 'audioinput');
        const videoInputs = devices.filter((d) => d.kind === 'videoinput');
        setAudioDevices(audioInputs);
        setVideoDevices(videoInputs);
        if (audioInputs.length > 0 && !selectedAudioDevice) setSelectedAudioDevice(audioInputs[0].deviceId);
        if (videoInputs.length > 0 && !selectedVideoDevice) setSelectedVideoDevice(videoInputs[0].deviceId);
      } catch (error) { console.error('Error getting devices:', error); }
    };
    getDevices();
    navigator.mediaDevices.addEventListener('devicechange', getDevices);
    return () => navigator.mediaDevices.removeEventListener('devicechange', getDevices);
  }, [selectedAudioDevice, selectedVideoDevice]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAudioAnalysis();
      stopVideoAnalysis();
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };
  }, [stopAudioAnalysis, stopVideoAnalysis]);

  // ---------- Render ----------
  const FixedNum = ({ value }) => (
    <span className="font-mono tabular-nums inline-block w-[6ch] text-right">{value}</span>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-white">
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2">Mic Check</h1>
          <p className="text-slate-300 text-lg">Test your audio and video before you record!</p>
        </div>

        {/* Responsive: side-by-side on md+ */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* AUDIO CARD */}
          <div className="bg-slate-800/50 backdrop-blur rounded-2xl p-6 border border-slate-700">
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-xl font-semibold">Audio</h2>
            </div>

            {(audioDevices.length > 1) && (
              <div className="mt-4">
                <label className="block text-sm font-medium mb-2">Microphone</label>
                <select
                  value={selectedAudioDevice}
                  onChange={(e) => setSelectedAudioDevice(e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white"
                  disabled={isListening}
                >
                  {audioDevices.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Microphone ${device.deviceId.slice(0, 8)}`}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Meter */}
            <div className="mt-6">
              <HorizontalMeter
                rmsDb={audioLevel}
                peakDb={peakLevel}
                floorDb={-40}
                onBarDbChange={setBarDispDb}
              />

              {/* Max (reset) — below meter, right-aligned */}
              <div className="mt-1 flex justify-end">
                <button
                  type="button"
                  onClick={() => { maxPeakRef.current = -60; setPeakNumberDb(-60); }}
                  className="text-[10px] px-1.5 py-[2px] rounded-md border border-slate-600/70 bg-slate-900/80 text-slate-200/90 shadow-sm hover:bg-slate-800/80 hover:border-slate-500/70 active:scale-[0.98] cursor-pointer select-none font-mono tabular-nums"
                  title="Click to reset peak max"
                >
                  <span className="inline-block w-[7ch] text-right">{peakNumberDb.toFixed(1)}</span> dB
                </button>
              </div>

              {/* Readouts with fixed-width numbers to prevent jitter */}
              <div className="mt-3 flex flex-wrap items-center gap-4 text-sm min-h-[2rem]">
                <span className="text-slate-300/90">
                  RMS (avg): <FixedNum value={rmsAvgDb.toFixed(1)} /> dB
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-600 text-slate-200">
                  Peak: <FixedNum value={peakLevel.toFixed(1)} /> dB
                </span>
              </div>

              <div className="mt-3 p-3 bg-slate-700/50 rounded-lg">
                <p className="text-sm">{feedback}</p>
              </div>

              {/* Transport */}
              <div className="mt-4 flex flex-wrap gap-3">
                {!isListening ? (
                  <button
                    onClick={startAudioAnalysis}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg"
                  >
                    <Mic size={18} /> Start Audio Test
                  </button>
                ) : (
                  <button
                    onClick={stopAudioAnalysis}
                    className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg"
                  >
                    <MicOff size={18} /> Stop Audio Test
                  </button>
                )}

                {!isRecording ? (
                  <button
                    onClick={startRecording}
                    disabled={!isListening}
                    className="flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Circle size={16} /> Record
                  </button>
                ) : (
                  <button
                    onClick={stopRecording}
                    className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 rounded-lg"
                  >
                    <Square size={16} /> Stop
                  </button>
                )}

                <button
                  onClick={playRecording}
                  disabled={!recordedBlob || isPlaying}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Play size={16} /> Play
                </button>

                <button
                  onClick={downloadRecording}
                  disabled={!recordedBlob}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-600 hover:bg-slate-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Download size={16} /> Download
                </button>

                {isRecording && (
                  <span className="ml-2 text-sm text-slate-300 select-none">
                    ● {recordingTime.toFixed(1)}s
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* VIDEO CARD */}
          <div className="bg-slate-800/50 backdrop-blur rounded-2xl p-6 border border-slate-700">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Video</h2>
              <div className="flex gap-2">
                {!isVideoEnabled ? (
                  <button
                    onClick={startVideoAnalysis}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg"
                  >
                    <Video size={18} /> Start
                  </button>
                ) : (
                  <button
                    onClick={stopVideoAnalysis}
                    className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg"
                  >
                    <VideoOff size={18} /> Stop
                  </button>
                )}
              </div>
            </div>

            {(videoDevices.length > 1) && (
              <div className="mt-4">
                <label className="block text-sm font-medium mb-2">Camera</label>
                <select
                  value={selectedVideoDevice}
                  onChange={(e) => setSelectedVideoDevice(e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white"
                  disabled={isVideoEnabled}
                >
                  {videoDevices.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Camera ${device.deviceId.slice(0, 8)}`}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-400 mt-1">Change camera when video is stopped.</p>
              </div>
            )}

            <div className="mt-4 relative w-full rounded-lg overflow-hidden bg-slate-700" style={{ minHeight: '240px', aspectRatio: '16/9' }}>
              <video ref={videoRef} autoPlay muted playsInline className="absolute inset-0 w-full h-full object-cover transform -scale-x-100" />
              {!isVideoEnabled || !hasVideoFrame ? (
                <div className="absolute inset-0 flex items-center justify-center text-slate-300">
                  {isVideoEnabled ? 'Starting camera…' : 'Camera off'}
                </div>
              ) : null}
              <div className="absolute inset-4 border-2 border-white/30 rounded-lg pointer-events-none"></div>
            </div>

            <div className="mt-4 p-3 bg-slate-700/50 rounded-lg">
              <p className="text-sm">{videoFeedback}</p>
            </div>
          </div>
        </div>

        {/* Email / Links */}
        <div className="mt-8 space-y-4">
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="https://www.linkedin.com/in/jddeleon"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 px-6 py-3 bg-[#0077B5] hover:bg-[#005885] text-white rounded-lg font-medium transition-colors"
            >
              {/* LinkedIn glyph */}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
              </svg>
              Connect on LinkedIn
            </a>

            <a
              href="mailto:jon@jondeleonmedia.com?subject=Audio%20Production%20Quote"
              className="flex items-center justify-center gap-2 px-6 py-3 bg-[#3251D5] hover:bg-[#2940b8] text-white rounded-lg font-medium transition-colors"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m22 2-7 20-4-9-9-4z"/>
                <path d="M22 2 11 13"/>
              </svg>
              Get Quote
            </a>
          </div>

          <div className="max-w-md mx-auto">
            {!emailSubmitted ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  try {
                    const emails = JSON.parse(localStorage.getItem('micCheckEmails') || '[]');
                    emails.push({ email, date: new Date().toISOString() });
                    localStorage.setItem('micCheckEmails', JSON.stringify(emails));
                    setEmailSubmitted(true);
                    setEmail('');
                  } catch (error) { console.error('Error saving email:', error); }
                }}
                className="flex gap-2"
              >
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Get notified about Chrome extension"
                  className="flex-1 px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400"
                  required
                />
                <button
                  type="submit"
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
                >
                  <Mail size={16} />
                  Notify Me
                </button>
              </form>
            ) : (
              <p className="text-center text-green-400">✓ We'll notify you when the Chrome extension launches!</p>
            )}
          </div>
        </div>

        <div className="text-center mt-8 text-slate-400 text-sm leading-6">
          <div>Professional audio tools built for creators</div>
          <div>
            by{' '}
            <a
              href="https://jondeleonmedia.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#3251D5] hover:text-[#2940b8]"
            >
              Jon DeLeon Media
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MicCheck;
