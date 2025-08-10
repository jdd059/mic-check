import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, MicOff, Video, VideoOff, Play, Square, Download, Circle, Mail } from 'lucide-react';

/** ======= Vertical segmented meter (Logic-ish) with labels & ruler ======= */
function VerticalMeter({ rmsDb, peakDb }) {
  // Map -60..0 dB to 0..1
  const norm = (db) => Math.max(0, Math.min(1, (db + 60) / 60));
  const litFrac = norm(rmsDb);
  const peakFrac = norm(peakDb);

  // Segments: 30 rows => 2 dB per segment from -60 .. 0
  const segments = 30;
  const dbPerSeg = 60 / segments; // 2
  // For each segment i (0 bottom .. 29 top)
  const segs = Array.from({ length: segments }, (_, i) => {
    const fracFromBottom = (i + 1) / segments;        // 0..1
    const dbTop = -60 + fracFromBottom * 60;          // top edge dB for this segment
    const isLit = fracFromBottom <= litFrac + 1e-6;

    // Colors similar to Logic bands
    let color = '#4ade80'; // green
    if (dbTop < -18) color = '#64748b'; // low range
    if (dbTop >= -3) color = '#f59e0b'; // amber near top

    return { isLit, color, dbTop: Math.round(dbTop) };
  });

  // Peak marker position
  const peakY = (1 - peakFrac) * 100;

  // Right-side ruler ticks
  const majorTicks = [-60, -48, -36, -24, -18, -12, -6, -3, 0];

  return (
    <div className="inline-flex items-stretch select-none">
      {/* Meter body */}
      <div className="relative h-64 w-10 rounded-md bg-slate-800 border border-slate-700 overflow-hidden">
        {/* segments */}
        <div className="absolute inset-1 grid" style={{ gridTemplateRows: `repeat(${segments}, 1fr)` }}>
          {segs.map((s, i) => (
            <div key={i} className="relative mx-0.5 my-[1px] rounded-sm"
                 style={{
                   backgroundColor: s.isLit ? s.color : 'rgba(100,116,139,0.25)',
                   boxShadow: s.isLit ? 'inset 0 0 0 1px rgba(255,255,255,0.08)' : 'none'
                 }}>
              {/* per-segment dB label (tiny, faint) */}
              <div className="absolute left-0.5 top-1/2 -translate-y-1/2 text-[9px] leading-none text-slate-300/40">
                {s.dbTop}
              </div>
            </div>
          ))}
        </div>

        {/* peak-hold marker */}
        <div className="absolute left-0 right-0 h-[2px] bg-white/70"
             style={{ top: `calc(${peakY}% - 1px)` }} />

        {/* clip LED at top */}
        <div className="absolute left-1 right-1 top-1 h-1.5 rounded-sm"
             style={{ backgroundColor: peakDb >= 0 ? '#ef4444' : 'rgba(100,116,139,0.35)' }} />
      </div>

      {/* Right ruler */}
      <div className="relative h-64 w-10 ml-2">
        {/* vertical spine */}
        <div className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-px bg-slate-600/60" />
        {majorTicks.map((db) => {
          const y = (1 - norm(db)) * 100;
          const isSpecial = db === -3 || db === 0;
          return (
            <div key={db} className="absolute left-0 right-0"
                 style={{ top: `calc(${y}% - 8px)` }}>
              {/* tick line */}
              <div className="absolute left-1/2 -translate-x-1/2 h-[1px] w-5 bg-slate-400/70" />
              {/* label */}
              <div className={`absolute left-[60%] -translate-x-0 text-[11px] leading-none
                               ${isSpecial ? 'text-white' : 'text-slate-300/80'}`}>
                {db}
              </div>
            </div>
          );
        })}
        {/* axis labels */}
        <div className="absolute bottom-0 left-0 right-0 text-center text-[10px] text-slate-400/70">dBFS</div>
      </div>
    </div>
  );
}
ç

const MicCheck = () => {
  // ---------- State ----------
  const [isListening, setIsListening] = useState(false);
  const [audioLevel, setAudioLevel] = useState(-60); // RMS-ish
  const [peakLevel, setPeakLevel] = useState(-60);
  const [feedback, setFeedback] = useState("Click 'Start Audio Test' to check your microphone");
  const [audioDevices, setAudioDevices] = useState([]);
  const [videoDevices, setVideoDevices] = useState([]);
  const [selectedAudioDevice, setSelectedAudioDevice] = useState('');
  const [selectedVideoDevice, setSelectedVideoDevice] = useState('');
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [videoFeedback, setVideoFeedback] = useState("Click 'Start Video' to check your camera");
  const [hasVideoFrame, setHasVideoFrame] = useState(false);
  const [usePeakForFill, setUsePeakForFill] = useState(true);

  // Recording
  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);

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

  const videoRef = useRef(null);
  const videoStreamRef = useRef(null);
  const videoAnalysisRef = useRef(null);
  const actualPeakRef = useRef(-60);
  const mediaRecorderRef = useRef(null);
  const recordingTimerRef = useRef(null);

  // ---------- Helpers ----------
  const getLevelColor = (level) => {
    if (level >= 0) return '#ef4444';
    if (level >= -3) return '#f97316';
    if (level >= -18) return '#22c55e';
    return '#64748b';
  };

  const getFeedbackMessage = (level) => {
    if (level >= 0) return "🔴 Clipping detected! Lower your gain or back away from the mic";
    if (level >= -3) return "🟠 Getting hot - try lowering your gain a bit";
    if (level >= -18) return "🟢 Perfect! You're ready to record";
    if (level >= -30) return "🟡 A bit quiet - try getting closer to the mic or raising your gain";
    return "🔇 Very quiet - check your mic connection and gain settings";
  };

  const getVideoFeedback = (brightness, hasDetection) => {
    if (!hasDetection) return "🎥 Camera active - position your face in the center";
    if (brightness < 50) return "💡 Too dark - try facing a window or adding front lighting";
    if (brightness > 200) return "☀️ Too bright - reduce lighting or move away from bright backgrounds";
    return "✅ Good lighting and framing!";
  };

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

      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      await audioContextRef.current.resume();
      const source = audioContextRef.current.createMediaStreamSource(stream);

      // Try AudioWorklet (optional)
      try {
        await audioContextRef.current.audioWorklet.addModule('/worklets/meter-processor.js');
        workletNodeRef.current = new AudioWorkletNode(audioContextRef.current, 'meter-processor', {
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

          const releasePerSec = 90;
          const current = audioLevelRef.current ?? floor;
          const target = Math.max(rmsDb, floor);
          const next = target > current ? target : Math.max(target, current - releasePerSec * dt);
          audioLevelRef.current = next;
          setAudioLevel(next);

          const holdTime = 1500;
          const prev = peakHoldStateRef.current?.value ?? floor;
          const prevTs = peakHoldStateRef.current?.ts ?? 0;
          if (peakDb > prev || now - prevTs > holdTime) {
            peakHoldStateRef.current = { value: peakDb, ts: now };
          }
          setPeakLevel(Math.max(peakHoldStateRef.current.value, floor));
        };
      } catch (err) {
        // fallback to analyser below
        console.warn('AudioWorklet init failed', err);
      }

      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 1024;
      analyserRef.current.smoothingTimeConstant = 0.0;
      source.connect(analyserRef.current);

      setIsListening(true);
      analyzeAudio();
    } catch (error) {
      console.error('Error accessing microphone:', error);
      setFeedback("❌ Couldn't access your microphone. Please check permissions.");
    }
  }, [selectedAudioDevice]);

  const analyzeAudio = () => {
    if (!analyserRef.current) return;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const normalized = dataArray[i] / 255;
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / dataArray.length);
    const db = rms > 0 ? 20 * Math.log10(rms) : -60;
    const clampedDb = Math.max(db, -60);

    setAudioLevel(clampedDb);
    setFeedback(getFeedbackMessage(clampedDb));

    if (clampedDb > actualPeakRef.current) {
      actualPeakRef.current = clampedDb;
      setPeakLevel(clampedDb);

      if (peakHoldTimerRef.current) clearTimeout(peakHoldTimerRef.current);
      peakHoldTimerRef.current = setTimeout(() => {
        actualPeakRef.current = -60;
        setPeakLevel(-60);
        peakHoldTimerRef.current = null;
      }, 2800);
    }

    animationFrameRef.current = requestAnimationFrame(analyzeAudio);
  };

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
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
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
    setIsListening(false);
    setAudioLevel(-60);
    setPeakLevel(-60);
    actualPeakRef.current = -60;
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

  // Horizontal bar (for quick glance), kept from previous build
  const displayLevel = usePeakForFill ? peakLevel : audioLevel;
  const levelWidth = Math.max(0, Math.min(100, (displayLevel + 60) * (100 / 60)));

  // ---------- UI ----------
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
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={usePeakForFill}
                    onChange={() => setUsePeakForFill((v) => !v)}
                  />
                  <span className="select-none">{usePeakForFill ? 'Peak fill' : 'RMS fill'}</span>
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

            {/* Logic-style meter + numbers */}
            <div className="mt-6 flex items-center gap-4">
              <VerticalMeter rmsDb={audioLevel} peakDb={peakLevel} />
              <div className="flex-1">
                <div className="flex gap-4 text-sm items-center mb-3">
                  <span className="text-slate-400">RMS: {audioLevel.toFixed(1)} dB</span>
                  <span
                    className="px-2 py-1 rounded border"
                    style={{ color: getLevelColor(peakLevel), borderColor: getLevelColor(peakLevel) }}
                  >
                    Peak: {peakLevel.toFixed(1)} dB
                  </span>
                </div>

                {/* quick horizontal bar as secondary readout */}
                <div className="relative h-6 bg-slate-700 rounded-md overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 transition-all duration-100 ease-out"
                    style={{ width: `${levelWidth}%`, backgroundColor: getLevelColor(displayLevel) }}
                  />
                </div>

                <div className="mt-4 p-3 bg-slate-700/50 rounded-lg">
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
              <video ref={videoRef} autoPlay muted playsInline className="absolute inset-0 w-full h-full object-cover" />
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
              <form onSubmit={(e) => {
                e.preventDefault();
                try {
                  const emails = JSON.parse(localStorage.getItem('micCheckEmails') || '[]');
                  emails.push({ email, date: new Date().toISOString() });
                  localStorage.setItem('micCheckEmails', JSON.stringify(emails));
                  setEmailSubmitted(true);
                  setEmail('');
                } catch (error) { console.error('Error saving email:', error); }
              }} className="flex gap-2">
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
