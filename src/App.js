import React, { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Play, Square, Download, Video, VideoOff } from 'lucide-react';

const MicCheck = () => {
  const [isListening, setIsListening] = useState(false);
  const [audioLevel, setAudioLevel] = useState(-60);
  const [peakLevel, setPeakLevel] = useState(-60);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [feedback, setFeedback] = useState("Click 'Start Audio Test' to check your microphone");
  const [audioDevices, setAudioDevices] = useState([]);
  const [selectedAudioDevice, setSelectedAudioDevice] = useState('');
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [videoFeedback, setVideoFeedback] = useState("Click 'Start Video' to check your camera");

  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const animationFrameRef = useRef(null);
  const recordingTimerRef = useRef(null);
  const videoRef = useRef(null);
  const videoStreamRef = useRef(null);
  const videoAnalysisRef = useRef(null);
  const peakHoldRef = useRef(null);

  const getLevelColor = (level) => {
    if (level >= 0) return '#ef4444';
    if (level >= -3) return '#f97316';
    if (level >= -12) return '#22c55e';
    return '#64748b';
  };

  const getFeedbackMessage = (level) => {
    if (level >= 0) return "🔴 Clipping detected! Lower your gain or back away from the mic";
    if (level >= -3) return "🟠 Getting hot - try lowering your gain a bit";
    if (level >= -12) return "🟢 Perfect! You're ready to record";
    if (level >= -24) return "🟡 A bit quiet - try getting closer to the mic or raising your gain";
    return "🔇 Very quiet - check your mic connection and gain settings";
  };

  const getVideoFeedback = (brightness, hasDetection) => {
    if (!hasDetection) return "🎥 Camera active - position your face in the center";
    if (brightness < 50) return "💡 Too dark - try facing a window or adding front lighting";
    if (brightness > 200) return "☀️ Too bright - reduce lighting or move away from bright backgrounds";
    return "✅ Good lighting and framing!";
  };

  const startAudioAnalysis = async () => {
    try {
      const constraints = { 
        audio: { 
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false 
        } 
      };
      
      if (selectedAudioDevice) {
        constraints.audio.deviceId = { exact: selectedAudioDevice };
      }
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      mediaStreamRef.current = stream;
      audioContextRef.current = new AudioContext();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 512;
      analyserRef.current.smoothingTimeConstant = 0.3;
      
      source.connect(analyserRef.current);
      
      setIsListening(true);
      analyzeAudio();
    } catch (error) {
      console.error('Error accessing microphone:', error);
      setFeedback("❌ Couldn't access your microphone. Please check permissions.");
    }
  };

  const analyzeAudio = () => {
    if (!analyserRef.current) return;
    
    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);
    
    const sum = dataArray.reduce((acc, val) => acc + (val * val), 0);
    const rms = Math.sqrt(sum / dataArray.length);
    const db = rms > 0 ? 20 * Math.log10(rms / 255) : -60;
    const clampedDb = Math.max(db, -60);
    
    setAudioLevel(clampedDb);
    setFeedback(getFeedbackMessage(clampedDb));
    
    // Peak detection with hold
    if (clampedDb > peakLevel) {
      setPeakLevel(clampedDb);
      
      // Clear previous peak hold timer
      if (peakHoldRef.current) {
        clearTimeout(peakHoldRef.current);
      }
      
      // Set new peak hold timer (500ms)
      peakHoldRef.current = setTimeout(() => {
        setPeakLevel(-60);
      }, 500);
    }
    
    animationFrameRef.current = requestAnimationFrame(analyzeAudio);
  };

  const stopAudioAnalysis = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
    }
    setIsListening(false);
    setAudioLevel(-60);
    setPeakLevel(-60);
    if (peakHoldRef.current) {
      clearTimeout(peakHoldRef.current);
    }
    setFeedback("Click 'Start Audio Test' to check your microphone");
  };

  const startVideoAnalysis = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          width: { ideal: 640 },
          height: { ideal: 480 }
        } 
      });
      
      videoStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      
      setIsVideoEnabled(true);
      analyzeVideo();
    } catch (error) {
      console.error('Error accessing camera:', error);
      setVideoFeedback("❌ Couldn't access your camera. Please check permissions.");
    }
  };

  const analyzeVideo = () => {
    if (!videoRef.current || videoRef.current.readyState < 2) return;
    
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 160;
    canvas.height = 120;
    
    try {
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      
      let totalBrightness = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        totalBrightness += (r + g + b) / 3;
      }
      
      const avgBrightness = totalBrightness / (data.length / 4);
      setVideoFeedback(getVideoFeedback(avgBrightness, true));
    } catch (error) {
      console.error('Video analysis error:', error);
    }
    
    videoAnalysisRef.current = requestAnimationFrame(analyzeVideo);
  };

  const stopVideoAnalysis = () => {
    if (videoAnalysisRef.current) {
      cancelAnimationFrame(videoAnalysisRef.current);
    }
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach(track => track.stop());
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsVideoEnabled(false);
    setVideoFeedback("Click 'Start Video' to check your camera");
  };

  const startRecording = async () => {
    if (!mediaStreamRef.current) {
      await startAudioAnalysis();
    }
    
    try {
      mediaRecorderRef.current = new MediaRecorder(mediaStreamRef.current, {
        mimeType: 'audio/webm'
      });
      
      const chunks = [];
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      
      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        setRecordedBlob(blob);
      };
      
      mediaRecorderRef.current.start();
      setIsRecording(true);
      setRecordingTime(0);
      
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(prev => {
          if (prev >= 4.9) {
            stopRecording();
            return 5;
          }
          return prev + 0.1;
        });
      }, 100);
      
    } catch (error) {
      console.error('Error starting recording:', error);
      setFeedback("❌ Recording failed. Please try again.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
    }
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
    }
    setIsRecording(false);
    setRecordingTime(0);
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

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
  const getAudioDevices = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(device => device.kind === 'audioinput');
      setAudioDevices(audioInputs);
      if (audioInputs.length > 0 && !selectedAudioDevice) {
        setSelectedAudioDevice(audioInputs[0].deviceId);
      }
    } catch (error) {
      console.error('Error getting audio devices:', error);
    }
  };

  getAudioDevices();
  navigator.mediaDevices.addEventListener('devicechange', getAudioDevices);
  
  return () => {
    stopAudioAnalysis();
    stopVideoAnalysis();
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
    }
    navigator.mediaDevices.removeEventListener('devicechange', getAudioDevices);
  };
}, [selectedAudioDevice]);

  const levelHeight = Math.max(0, Math.min(100, (audioLevel + 60) * (100 / 60)));
  const peakColor = getLevelColor(peakLevel);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-white">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2">Mic Check</h1>
          <p className="text-slate-300 text-lg">Test your audio and video before you record!</p>
        </div>

        <div className="bg-slate-800/50 backdrop-blur rounded-2xl p-8 border border-slate-700">
          
          {audioDevices.length > 1 && (
            <div className="mb-6">
              <label className="block text-sm font-medium mb-2">Select Microphone</label>
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
          
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Audio Level</h2>
              <div className="flex gap-4 text-sm items-center">
                <span className="text-slate-400">
                  Current: {audioLevel.toFixed(1)} dB
                </span>
                <span 
                  className="px-2 py-1 rounded border border-slate-500 text-slate-300" 
                  style={{ color: peakColor }}
                >
                  Peak: {peakLevel.toFixed(1)} dB
                </span>
              </div>
            </div>
            
            <div className="relative h-24 bg-slate-700 rounded-lg overflow-hidden">
              <div className="absolute inset-0 flex">
                <div className="flex-1 bg-slate-600"></div>
                <div className="w-1/3 bg-green-900/30"></div>
                <div className="w-8 bg-orange-900/30"></div>
                <div className="w-4 bg-red-900/30"></div>
              </div>
              
              <div 
                className="absolute bottom-0 left-0 transition-all duration-150 ease-out rounded-r"
                style={{
                  width: `${levelHeight}%`,
                  backgroundColor: getLevelColor(audioLevel),
                  height: '100%'
                }}
              />
              
              <div className="absolute inset-0 flex items-center">
                <div className="absolute left-[67%] h-full w-px bg-green-400/50"></div>
                <div className="absolute left-[92%] h-full w-px bg-orange-400/50"></div>
                <div className="absolute right-0 h-full w-px bg-red-400/50"></div>
              </div>
            </div>
            
            <div className="flex justify-between mt-2 text-xs text-slate-400">
              <span>Too Quiet</span>
              <span className="text-green-400">Perfect</span>
              <span className="text-orange-400">Hot</span>
              <span className="text-red-400">Clip</span>
            </div>
          </div>

          <div className="mb-8 p-4 bg-slate-700/50 rounded-lg">
            <p className="text-center text-lg">{feedback}</p>
          </div>

          <div className="space-y-4">
            <div className="flex gap-4 justify-center">
              {!isListening ? (
                <button
                  onClick={startAudioAnalysis}
                  className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors min-w-[160px]"
                >
                  <Mic size={20} />
                  Start Audio Test
                </button>
              ) : (
                <button
                  onClick={stopAudioAnalysis}
                  className="flex items-center gap-2 px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors min-w-[160px]"
                >
                  <MicOff size={20} />
                  Stop Audio Test
                </button>
              )}

              {!isVideoEnabled ? (
                <button
                  onClick={startVideoAnalysis}
                  className="flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors min-w-[160px]"
                >
                  <Video size={20} />
                  Start Video Test
                </button>
              ) : (
                <button
                  onClick={stopVideoAnalysis}
                  className="flex items-center gap-2 px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors min-w-[160px]"
                >
                  <VideoOff size={20} />
                  Stop Video Test
                </button>
              )}
            </div>

            {isListening && (
              <div className="border-t border-slate-600 pt-6">
                <h3 className="text-lg font-semibold mb-4 text-center">5-Second Sound Check</h3>
                
                <div className="flex gap-4 justify-center items-center">
                  {!isRecording ? (
                    <button
                      onClick={startRecording}
                      className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
                    >
                      <div className="w-3 h-3 bg-white rounded-full"></div>
                      Record Test
                    </button>
                  ) : (
                    <button
                      onClick={stopRecording}
                      className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
                    >
                      <Square size={16} fill="white" />
                      Stop ({(5 - recordingTime).toFixed(1)}s)
                    </button>
                  )}

                  {recordedBlob && (
                    <>
                      <button
                        onClick={playRecording}
                        disabled={isPlaying}
                        className="flex items-center gap-2 px-4 py-2 bg-slate-600 hover:bg-slate-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
                      >
                        <Play size={16} />
                        {isPlaying ? 'Playing...' : 'Play Test'}
                      </button>
                      
                      <button
                        onClick={downloadRecording}
                        className="flex items-center gap-2 px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded-lg font-medium transition-colors"
                      >
                        <Download size={16} />
                        Download
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {isVideoEnabled && (
          <div className="mt-8 bg-slate-800/50 backdrop-blur rounded-2xl p-8 border border-slate-700">
            <h2 className="text-xl font-semibold mb-4">Video Check</h2>
            
            <div className="grid md:grid-cols-2 gap-6">
              <div className="relative">
                <video 
                  ref={videoRef}
                  autoPlay 
                  muted 
                  playsInline
                  className="w-full rounded-lg bg-slate-700"
                />
                
                <div className="absolute inset-4 border-2 border-white/30 rounded-lg pointer-events-none"></div>
              </div>
              
              <div className="space-y-4">
                <div className="p-4 bg-slate-700/50 rounded-lg">
                  <p className="text-lg">{videoFeedback}</p>
                </div>
                
                <div className="text-sm text-slate-300 space-y-2">
                  <div><strong className="text-white">Good framing:</strong> Eyes in upper third of frame</div>
                  <div><strong className="text-white">Lighting tips:</strong> Face a window or add soft front light</div>
                  <div><strong className="text-white">Distance:</strong> Arm's length from camera works best</div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="mt-8 space-y-4">
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="#chrome-extension"
              className="flex items-center justify-center gap-2 px-6 py-3 bg-[#4285F4] hover:bg-[#3367D6] text-white rounded-lg font-medium transition-colors"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.568 7.178l-2.07 3.586A3.973 3.973 0 0012 9.5a3.973 3.973 0 00-3.498 1.264L6.432 7.178A7.916 7.916 0 0112 4.083a7.916 7.916 0 015.568 3.095zM4.083 12A7.916 7.916 0 017.178 6.432l2.07 3.586A3.973 3.973 0 008.5 12a3.973 3.973 0 00.748 2.018L7.178 17.568A7.916 7.916 0 014.083 12zm7.917 7.917a7.916 7.916 0 01-5.568-3.095l2.07-3.586A3.973 3.973 0 0012 14.5a3.973 3.973 0 003.498-1.264l2.07 3.586A7.916 7.916 0 0112 19.917z"/>
              </svg>
              Get Chrome Extension
            </a>

            <a
              href="https://www.linkedin.com/in/jddeleon"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 px-6 py-3 bg-[#0077B5] hover:bg-[#005885] text-white rounded-lg font-medium transition-colors"
            >
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
          <div className="text-center">
            <p className="text-xs text-slate-400">Chrome extension coming soon • Safari support planned</p>
          </div>
        </div>

        <div className="mt-8 bg-slate-800/30 rounded-lg p-6 border border-slate-700">
          <h3 className="text-lg font-semibold mb-4">Quick Tips</h3>
          <div className="grid md:grid-cols-2 gap-4 text-sm text-slate-300">
            <div>
              <strong className="text-white">Too quiet?</strong>
              <p>Move closer to your mic or increase gain</p>
            </div>
            <div>
              <strong className="text-white">Too loud?</strong>
              <p>Back away from the mic or lower gain</p>
            </div>
            <div>
              <strong className="text-white">No pop filter?</strong>
              <p>Angle your mic off-axis - raise or lower mic, then angle toward mouth to avoid pops</p>
            </div>
            <div>
              <strong className="text-white">Best distance:</strong>
              <p>6-8 inches from your mouth for most mics</p>
            </div>
          </div>
        </div>

        <div className="text-center mt-8 text-slate-400 text-sm leading-6">
          <div>Professional audio tools built for creators</div>
          <div>
            by <a href="https://jondeleonmedia.com" target="_blank" rel="noopener noreferrer" className="text-[#3251D5] hover:text-[#2940b8]">
              Jon DeLeon Media
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MicCheck;