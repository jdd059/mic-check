class MeterProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    let peak = 0, sumSquares = 0;
    for (let i = 0; i < channel.length; i++) { const s = channel[i]; const a = Math.abs(s); if (a > peak) peak = a; sumSquares += s*s; }
    const rms = Math.sqrt(sumSquares / channel.length);
    const floor = -90;
    const rmsDb = rms > 0 ? 20 * Math.log10(rms) : floor;
    const peakDb = peak > 0 ? 20 * Math.log10(peak) : floor;
    this.port.postMessage({ rmsDb, peakDb, t: currentTime });
    return true;
  }
}
registerProcessor('meter-processor', MeterProcessor);