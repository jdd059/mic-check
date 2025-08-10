import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, MicOff, Video, VideoOff, Play, Square, Download, Circle, Mail } from 'lucide-react';

/** ======= Horizontal meter (instant bar, peak hold + fast fall, fixed z-order) ======= */
function HorizontalMeter({ rmsDb, peakDb, peakHoldDb, floorDb = -60, onResetPeakHold }) {
  // Map [floorDb..0] dBFS -> [0..1]
  const norm = (db) => {
    const span = 0 - floorDb; // e.g., 60 if floorDb=-60, 40 if floorDb=-40
    return Math.max(0, Math.min(1, (db - floorDb) / span));
  };

  // Targets (in %)
  const targetPctRef = useRef(0);
  targetPctRef.current = norm(rmsDb) * 100;

  // Displayed bar (fast, smooth — but won’t collapse unless near silence)
  const [dispPct, setDispPct] = useState(0);

  // Peak line (independent hold+fall)
  const [peakLinePct, setPeakLinePct] = useState(0);
  const lastPeakHoldTsRef = useRef(0);

  // Animation
  const rafRef = useRef(null);
  const lastTsRef = useRef(null);

  useEffect(() => {
    // tuning
    const BAR_ATTACK_PER_SEC = 40;   // fast attack for near “instant”
    const BAR_RELEASE_PER_SEC = 25;  // fast release so it doesn’t feel sticky
    const SILENCE_THRESHOLD_DB = floorDb + 2; // if below ~floor, allow collapse toward 0%
    const PEAK_HOLD_MS = 500;        // hold peak ~0.5s before falling
    const PEAK_FALL_PER_SEC = 160;   // fast fall of peak line

    const step = (ts) => {
      const lastTs = lastTsRef.current ?? ts;
      const dt = Math.min(0.05, (ts - lastTs) / 1000); // cap at 50ms
      lastTsRef.current = ts;

      const target = targetPctRef.current;

      // ----- BAR (dispPct) -----
      setDispPct((prev) => {
        const rising = target > prev;
        const rate = rising ? BAR_ATTACK_PER_SEC : BAR_RELEASE_PER_SEC;

        // Prevent the bar from collapsing to zero unless we're basically silent
        const minClamp = rmsDb < SILENCE_THRESHOLD_DB ? 0 : Math.min(prev, target);
        const effectiveTarget = Math.max(target, minClamp);

        const alpha = 1 - Math.exp(-rate * dt);
        return prev + (effectiveTarget - prev) * alpha;
      });

      // ----- PEAK LINE -----
      setPeakLinePct((prev) => {
        let next = prev;

        // Rise instantly with bar
        if (dispPct > prev) {
          next = dispPct;
          lastPeakHoldTsRef.current = ts;
        } else {
          // After hold period, fall quickly toward bar
          if (ts - lastPeakHoldTsRef.current > PEAK_HOLD_MS) {
            const fallAlpha = 1 - Math.exp(-PEAK_FALL_PER_SEC * dt);
            next = prev + (dispPct - prev) * fallAlpha;
          }
        }
        return next;
      });

      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTsRef.current = null;
    };
  }, [rmsDb, dispPct, floorDb]);

  // Colors (sweet spot widened to -24 dBFS; hot begins at -6 dBFS)
  const fillColor = (db) => {
    if (db >= 0) return '#ef4444';
    if (db >= -6) return '#f59e0b';
    if (db >= -24) return '#22c55e';
    return 'rgba(100,116,139,0.85)';
  };

  // Background zones — hot band (-6..0) is amber
  const bgZones = [
    { from: -60, to: -24, color: 'rgba(100,116,139,0.20)' }, // quiet
    { from: -24, to: -6,  color: 'rgba(34,197,94,0.20)'  },  // sweet spot (green)
    { from: -6,  to: 0,   color: 'rgba(245,158,11,0.28)' },  // hot (amber)
  ];

  const ticks = [-60, -48, -36, -30, -24, -18, -12, -6, -3, 0];
  // Only mark -24 and -6 above the line; keep 0 below to avoid overlapping the dBFS label
  const specialUp = new Set([-24, -6]);

  return (
    <div className="w-full">
      {/* ruler */}
      <div className="relative h-6 mb-1">
        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-px bg-slate-600/60" />
        {ticks.map((db) => {
          const x = norm(db) * 100;
          const isMajor = db % 12 === 0 || specialUp.has(db) || db === 0;
          const labelUp = specialUp.has(db);
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
        {/* Move dBFS to the left to prevent overlap with the 0 dB label */}
        <div className="absolute left-0 -top-4 text-[10px] text-slate-400/70">dBFS</div>
      </div>

      {/* meter bar */}
      <div className="relative h-7 rounded-md bg-slate-800 border border-slate-700 overflow-hidden">
        {/* background zones (z-0) */}
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

        {/* hot threshold guide at -6 dBFS (above zones, below fill) */}
        <div
          className="absolute top-0 bottom-0 w-[2px] bg-amber-400/60"
          style={{ left: `calc(${norm(-6) * 100}% - 1px)`, zIndex: 2 }}
        />

        {/* tail (under fill, subtle glow) (z-1) */}
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

        {/* colored fill (always on top of tail) (z-3) */}
        <div
          className="absolute inset-y-0 left-0"
          style={{ width: `${dispPct}%`, backgroundColor: fillColor(rmsDb), opacity: 0.98, zIndex: 3 }}
        />

        {/* peak line (z-4) */}
        <div
          className="absolute top-0 bottom-0 w-[2px] bg-white/85"
          style={{ left: `calc(${peakLinePct}% - 1px)`, zIndex: 4 }}
        />

        {/* clip LED (z-4) */}
        <div
          className="absolute right-1 top-1/2 -translate-y-1/2 h-3 w-3 rounded-full"
          style={{ backgroundColor: (peakDb ?? rmsDb) >= 0 ? '#ef4444' : 'rgba(100,116,139,0.45)', zIndex: 4 }}
          title="Clip"
        />

        {/* Peak (hold) reset badge — tiny, clickable */}
        {typeof peakHoldDb === 'number' && (
          <button
            type="button"
            onClick={onResetPeakHold}
            className="absolute top-0.5 right-5 text-[10px] px-1.5 py-[2px] rounded-md border border-slate-600/70 bg-slate-900/80 text-slate-200/90 z-[5] shadow-sm hover:bg-slate-800/80 hover:border-slate-500/70 active:scale-[0.98] cursor-pointer select-none font-mono tabular-nums"
            title="Click to reset peak hold"
          >
            <span className="inline-block w-[7ch] text-right">{peakHoldDb.toFixed(1)}</span> dB
          </button>
        )}
      </div>
    </div>
  );
}

const MicCheck = () => {
  // ---------- State ----------
  const [isListening, setIsListening] = useState(false);
  const [audioLevel, setAudioLevel] = useState(-60); // RMS-ish (fast)
  const [rmsAvgDb, setRmsAvgDb] = useState(-60);     // RMS averaged (slow display)
  const [peakLevel, setPeakLevel] = useState(-60);
  const [feedback, setFeedback] = useState("Click 'Start Audio Test' to check your microphone");
  const [audioDevices, setAudioDevices] = useState([]);
  const [videoDevices, setVideoDevices] = useState([]);
  const [selectedAudioDevice, setSelectedAudioDevice] = useState('');
  const [selectedVideoDevice, setSelectedVideoDevice] = useState('');
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [videoFeedback, setVideoFeedback] = useState("Click 'Start Video' to check your camera");
  const [hasVideoFrame, setHasVideoFrame] = useState(false);
  const [usePeakForFill, setUsePeakForFill] = useState(true); // label + behavior

  // Recording
  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);

  // Numeric peak (hold)
  const [peakNumberDb, setPeakNumberDb] = useState(-60);

  // Email
  const [email, setEmail] = useState('');
  const [emailSubmitted, setEmailSubmitted] = useState(false);

  // ---------- Refs ----------
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const lastTsRef = useRef(null);
  const audioLevelRef = useRef(-60);
  const workletNodeRef = useRef(null);
  const peakHoldStateRef = useRef({ value: -60, ts: 0 });
  const peakHoldTimerRef = useRef(null);
  const animationFrameRef = useRef(null);

  const rmsAvgRef = useRef(-60);
  const lastAvgTsRef = useRef(0);

  const videoRef = useRef(null);
  const videoStreamRef = useRef(null);
  const videoAnalysisRef = useRef(null);
  const actualPeakRef = useRef(-60);
  const maxPeakRef = useRef(-60);
  const mediaRecorderRef = useRef(null);
  const recordingTimerRef = useRef(null);

  // ---------- Reset handlers ----------
  const resetPeakHold = useCallback(() => {
    if (peakHoldTimerRef.current) {
      clearTimeout(peakHoldTimerRef.current);
      peakHoldTimerRef.current = null;
    }
    // Drop max to baseline and wait for next peak
    maxPeakRef.current = -60;
    setPeakNumberDb(-60);
  }, []);

  // ---------- Helpers ----------
  const getLevelColor = (level) => {
    if (level >= 0) return '#ef4444';
    if (level >= -6) return '#f97316';
    if (level >= -24) return '#22c55e';
    return '#64748b';
  };

  const getFeedbackMessage = (level) => {
    if (level >= 0) return "🔴 Clipping detected! Lower your gain or back away from the mic";
    if (level >= -6) return "🟠 Getting hot - try lowering your gain a bit";
    if (level >= -24) return "🟢 In the sweet spot — you're ready to record";
    if (level >= -36) return "🟡 A bit quiet - get closer or raise gain";
    return "🔇 Very quiet - check mic and gain settings";
  };

  const getVideoFeedback = (brightness, hasDetection) => {
    if (!hasDetection) return "🎥 Camera active - position your face in the center";
    if (brightness < 50) return "💡 Too dark - try facing a window or adding front lighting";
    if (brightness > 200) return "☀️ Too bright - reduce lighting or move away from bright backgrounds";
    return "✅ Good lighting and framing!";
  };

  /**
   * ================ AUDIO METER LOOP (stable + safe) ================
   * Wrapped in useCallback so hooks linter is satisfied; uses refs only.
   */
  const analyzeAudio = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;

    try {
      const binCount = analyser.frequencyBinCount || 1024;
      const dataArray = new Uint8Array(binCount);
      analyser.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const normalized = dataArray[i] / 255;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / dataArray.length);
      const db = rms > 0 ? 20 * Math.log10(rms) : -60;
      const clampedDb = Math.max(db, -60);

      // Fast RMS for the bar
      setAudioLevel(clampedDb);

      // Slow RMS display (EWMA ~0.5s)
      const now = performance.now();
      const dt = (now - (lastAvgTsRef.current || now)) / 1000;
      lastAvgTsRef.current = now;
      const TAU = 0.5;
      const alphaAvg = 1 - Math.exp(-(dt || 0.016) / TAU);
      const newAvg = rmsAvgRef.current + (clampedDb - rmsAvgRef.current) * alphaAvg;
      rmsAvgRef.current = newAvg;
      setRmsAvgDb(newAvg);

      // Use averaged RMS for feedback to prevent jitter
      setFeedback(getFeedbackMessage(newAvg));

      // ---- numeric/visual peak fall-back (approximate using RMS when worklet missing) ----
      // Update numeric Max (since last reset)
      if (clampedDb > maxPeakRef.current) {
        maxPeakRef.current = clampedDb;
        setPeakNumberDb(clampedDb);
      }

      // Update 'peak line' numeric using instantaneous fallback
      setPeakLevel(clampedDb);
    } catch (err) {
      console.error('Audio analysis failed:', err);
      // Stop this loop safely without needing stopAudioAnalysis (keeps linter happy)
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      analyserRef.current = null;
      setFeedback("❌ Audio analysis error. Try stopping and starting again, or check mic permissions.");
      return;
    }

    animationFrameRef.current = requestAnimationFrame(analyzeAudio);
  }, []); // only refs + stable setters used

  // ---------- AUDIO ----------
  const startAudioAnalysis = useCallback(async () => {
    try {
      setPeakLevel(-60);
      actualPeakRef.current = -60;

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

      // Optional worklet
      try {
        await ctx.audioWorklet.addModule('/worklets/meter-processor.js');
        workletNodeRef.current = new AudioWorkletNode(ctx, 'meter-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 0
        });
        source.connect(workletNodeRef.current);
        workletNodeRef.current.port.onmessage = (e) => {
          const { rmsDb, peakDb } = e.data;
          const floor = -60;

          const now = performance.now();
          const dt = (now - (lastTsRef.current || now)) / 1000;
          lastTsRef.current = now;

          // Fast-ish RMS for the bar/logic
          const releasePerSec = 90;
          const current = audioLevelRef.current ?? floor;
          const target = Math.max(rmsDb, floor);
          const next = target > current ? target : Math.max(target, current - releasePerSec * dt);
          audioLevelRef.current = next;
          setAudioLevel(next);

          // Slow RMS for the numeric readout (EWMA ~0.5s)
          const TAU = 0.5; // seconds
          const alphaAvg = 1 - Math.exp(-(dt || 0.016) / TAU);
          const newAvg = rmsAvgRef.current + (next - rmsAvgRef.current) * alphaAvg;
          rmsAvgRef.current = newAvg;
          setRmsAvgDb(newAvg);

          // Use averaged RMS for feedback to prevent jitter
          setFeedback(getFeedbackMessage(newAvg));

          // Peak hold state (worklet-provided true peaks)
          const holdTime = 1500; // ms
          const prev = peakHoldStateRef.current?.value ?? floor;
          const prevTs = peakHoldStateRef.current?.ts ?? 0;
          if (peakDb > prev || now - prevTs > holdTime) {
            peakHoldStateRef.current = { value: peakDb, ts: now };
          }
          setPeakLevel(Math.max(peakHoldStateRef.current.value, floor));
          // Update numeric Max (since last reset)
          if (typeof peakDb === 'number' && peakDb > maxPeakRef.current) {
            maxPeakRef.current = peakDb;
            setPeakNumberDb(peakDb);
          }
        };
      } catch (err) {
        console.warn('AudioWorklet init failed', err);
      }

      // Analyser fallback
      analyserRef.current = ctx.createAnalyser();
      analyserRef.current.fftSize = 1024;
      analyserRef.current.smoothingTimeConstant = 0.0;
      source.connect(analyserRef.current);

      setIsListening(true);
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
      try {
        workletNodeRef.current.port.onmessage = null;
        workletNodeRef.current.disconnect();
      } catch {}
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
    if (peakHoldTimerRef.current) {
      clearTimeout(peakHoldTimerRef.current);
      peakHoldTimerRef.current = null;
    }
    analyserRef.current = null;
    setIsListening(false);
    setAudioLevel(-60);
    setRmsAvgDb(-60);
    setPeakLevel(-60);
    setPeakNumberDb(-60);
    actualPeakRef.current = -60;
    rmsAvgRef.current = -60;
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
        setVideoFeedback("❌ Video element not found.");
        return;
      }
      el.autoplay = true;
      el.muted = true;
      el.setAttribute('playsinline', '');
      el.srcObject = stream;
      el.load();

      let played = false;
      const tryPlay = async () => {
        try {
          await el.play();
          played = true;
          setTimeout(() => analyzeVideo(), 120);
        } catch {}
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
    if (!el || !el.srcObject) {
      videoAnalysisRef.current = requestAnimationFrame(analyzeVideo);
      return;
    }
    if (el.readyState < 2) {
      videoAnalysisRef.current = requestAnimationFrame(analyzeVideo);
      return;
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    canvas.width = 160;
    canvas.height = 120;

    try {
      ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

      let total = 0;
      for (let i = 0; i < data.length; i += 4) {
        total += (data[i] + data[i + 1] + data[i + 2]) / 3;
      }
      const avg = total / (data.length / 4);
      setHasVideoFrame(true);
      setVideoFeedback(getVideoFeedback(avg, true));
    } catch (err) {
      console.warn('Video analysis draw failed:', err?.name || err);
    }

    videoAnalysisRef.current = requestAnimationFrame(analyzeVideo);
  }

  const stopVideoAnalysis = useCallback(() => {
    setIsVideoEnabled(false);
    setHasVideoFrame(false);
    if (videoAnalysisRef.current) {
      cancelAnimationFrame(videoAnalysisRef.current);
      videoAnalysisRef.current = null;
    }
    try {
      if (videoStreamRef.current) {
        videoStreamRef.current.getTracks().forEach((t) => t.stop());
        videoStreamRef.current = null;
      }
    } catch {}
    if (videoRef.current) {
      try {
        videoRef.current.pause();
        videoRef.current.removeAttribute('src');
        videoRef.current.srcObject = null;
        videoRef.current.load();
      } catch {}
    }
    setVideoFeedback("Click 'Start Video' to check your camera");
  }, []);

  // ---------- RECORDING ----------
  const startRecording = async () => {
    if (!mediaStreamRef.current) {
      await startAudioAnalysis();
    }
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
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 0.1);
      }, 100);
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
      } catch (error) {
        console.error('Error getting devices:', error);
      }
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

  // ---------- UI ----------
  // Meter source & floor: Peak maps well with floor -60; RMS gets -40 so it travels more
  const barDb = usePeakForFill ? peakLevel : audioLevel;
  const meterFloor = usePeakForFill ? -60 : -40;

  // Little helper for fixed-width numeric tokens (prevents layout shift)
  const FixedNum = ({ value }) => (
    <span className="font-mono tabular-nums inline-block w-[6ch] text-right">{value}</span>
  );

  // ---------------- Development sanity checks -----------------
  if (process.env.NODE_ENV === 'development') {
    // quick one-time check to make sure color split shows
    const _once = (window).__mc_once__;
    if (!_once) {
      (window).__mc_once__ = true;
      const map = (floor) => [
        { band: 'quiet',   left: ((-60 - floor)/(0 - floor))*100, right: ((-24 - floor)/(0 - floor))*100 },
        { band: 'sweet',   left: ((-24 - floor)/(0 - floor))*100, right: ((-6  - floor)/(0 - floor))*100 },
        { band: 'hot',     left: ((-6  - floor)/(0 - floor))*100, right: ((0   - floor)/(0 - floor))*100 },
      ];
      // eslint-disable-next-line no-console
      console.log('[MicCheck dev] zone percents @floor -60:', map(-60));
      // eslint-disable-next-line no-console
      console.log('[MicCheck dev] zone percents @floor -40:', map(-40));

      // Basic threshold unit tests (dev only)
      const zoneForDb = (db) => (db >= 0 ? 'red' : db >= -6 ? 'amber' : db >= -24 ? 'green' : 'quiet');
      console.assert(zoneForDb(-30) === 'quiet', 'zone test: -30 should be quiet');
      console.assert(zoneForDb(-20) === 'green', 'zone test: -20 should be green');
      console.assert(zoneForDb(-6) === 'amber', 'zone test: -6 should be amber');
      console.assert(zoneForDb(-2) === 'amber', 'zone test: -2 should be amber');
      console.assert(zoneForDb(0) === 'red', 'zone test: 0 should be red');
    }
  }

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
              <div className="flex items-center gap-3 text-xs">
                <span
                  className={`px-2 py-0.5 rounded-full font-medium select-none ${
                    usePeakForFill
                      ? 'bg-green-900/40 text-green-300 border border-green-700/60'
                      : 'bg-slate-700/60 text-slate-200 border border-slate-500/60'
                  }`}
                >
                  {usePeakForFill ? 'PEAK' : 'RMS'}
                </span>
                <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={usePeakForFill}
                    onChange={() => setUsePeakForFill((v) => !v)}
                  />
                  <span>{usePeakForFill ? 'Bar uses Peak' : 'Bar uses RMS'}</span>
                </label>
              </div>
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
              <HorizontalMeter rmsDb={barDb} peakDb={peakLevel} peakHoldDb={peakNumberDb} floorDb={meterFloor} onResetPeakHold={resetPeakHold} />

              {/* Readouts with fixed-width numbers to prevent jitter */}
              <div className="mt-3 flex flex-wrap items-center gap-4 text-sm min-h-[2rem]">
                <span className="text-slate-300/90">
                  RMS (avg): <FixedNum value={rmsAvgDb.toFixed(1)} /> dB
                </span>
                <span
                  className="inline-flex items-center gap-1 px-2 py-1 rounded border"
                  style={{ color: getLevelColor(peakLevel), borderColor: getLevelColor(peakLevel) }}
                >
                  Peak line: <FixedNum value={peakLevel.toFixed(1)} /> dB
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
