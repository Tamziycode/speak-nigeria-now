// Encode an AudioBuffer (mono, 16kHz) to a 16-bit PCM WAV Blob.
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = 1;
  const sampleRate = buffer.sampleRate;
  const samples = buffer.getChannelData(0);
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const bufferSize = 44 + dataSize;
  const ab = new ArrayBuffer(bufferSize);
  const view = new DataView(ab);

  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([ab], { type: "audio/wav" });
}

// Decode an input blob (any format the browser supports) and resample to 16kHz mono WAV.
export async function blobTo16kWav(input: Blob): Promise<Blob> {
  const arrayBuffer = await input.arrayBuffer();
  const AudioCtx: typeof AudioContext =
    (window.AudioContext || (window as any).webkitAudioContext);
  const decodeCtx = new AudioCtx();
  const decoded = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
  await decodeCtx.close();

  const targetRate = 16000;
  const duration = decoded.duration;
  const offline = new OfflineAudioContext(
    1,
    Math.ceil(duration * targetRate),
    targetRate,
  );

  // Downmix to mono by averaging channels.
  const mono = offline.createBuffer(1, decoded.length, decoded.sampleRate);
  const monoData = mono.getChannelData(0);
  const chCount = decoded.numberOfChannels;
  for (let c = 0; c < chCount; c++) {
    const ch = decoded.getChannelData(c);
    for (let i = 0; i < ch.length; i++) monoData[i] += ch[i] / chCount;
  }

  const src = offline.createBufferSource();
  src.buffer = mono;
  src.connect(offline.destination);
  src.start(0);

  const rendered = await offline.startRendering();
  return audioBufferToWav(rendered);
}
