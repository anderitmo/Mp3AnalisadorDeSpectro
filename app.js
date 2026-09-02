/**
 * AuraSpectrum - Analisador de Espectro & Player SPA
 */

document.addEventListener('DOMContentLoaded', () => {
  // --- Elementos DOM ---
  const fileInput = document.getElementById('file-input');
  const dropZone = document.getElementById('drop-zone');
  const fileNameDisplay = document.getElementById('file-name');
  const uploadLabel = document.getElementById('upload-label');

  const canvas = document.getElementById('spectrum-canvas');
  const canvasCtx = canvas.getContext('2d');
  const visualizerOverlay = document.getElementById('visualizer-overlay');
  const modeBtns = document.querySelectorAll('.mode-btn');
  const sampleRateBadge = document.getElementById('sample-rate-badge');

  const btnPlay = document.getElementById('btn-play');
  const btnStop = document.getElementById('btn-stop');
  const iconPlay = btnPlay.querySelector('.icon-play');
  const iconPause = btnPlay.querySelector('.icon-pause');
  const seekBar = document.getElementById('seek-bar');
  const currentTimeDisplay = document.getElementById('current-time');
  const totalDurationDisplay = document.getElementById('total-duration');
  const volumeBar = document.getElementById('volume-bar');

  const presetBtns = document.querySelectorAll('.preset-btn');
  const freqSlider = document.getElementById('freq-slider');
  const targetFreqDisplay = document.getElementById('target-freq-display');

  const btnExport = document.getElementById('btn-export');
  const exportStatus = document.getElementById('export-status');
  const exportStatusText = document.getElementById('export-status-text');

  // --- Estado da Aplicação ---
  let audioCtx = null;
  let audioBuffer = null;
  let sourceNode = null;
  let analyserNode = null;
  let gainNode = null;

  let isPlaying = false;
  let startTime = 0;
  let pauseOffset = 0;
  let duration = 0;

  let targetFreq = 440; // Frequência base A4 em Hz
  let visualizerMode = 'frequency'; // 'frequency' ou 'waveform'
  let animationFrameId = null;
  let loadedFileName = 'audio';

  // --- Inicialização do Contexto de Áudio ---
  function initAudioContext() {
    if (!audioCtx) {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioCtxClass();
      sampleRateBadge.textContent = `${audioCtx.sampleRate} Hz`;
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  // --- Ajuste do Tamanho do Canvas ---
  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvasCtx.scale(dpr, dpr);
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  // --- Manipulação do Upload / Drag & Drop ---
  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('dragover');
    });
  });

  dropZone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFileSelect(files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileSelect(e.target.files[0]);
    }
  });

  function handleFileSelect(file) {
    if (!file.type.startsWith('audio/') && !file.name.match(/\.(mp3|wav|ogg|m4a|aac|flac)$/i)) {
      alert('Por favor, selecione um arquivo de áudio válido (ex: MP3, WAV, OGG).');
      return;
    }

    initAudioContext();
    stopAudio();

    loadedFileName = file.name.replace(/\.[^/.]+$/, "");
    fileNameDisplay.textContent = file.name;
    uploadLabel.textContent = "Arquivo Carregado:";
    visualizerOverlay.innerHTML = '<span>Decodificando áudio...</span>';
    visualizerOverlay.classList.remove('hidden');

    const reader = new FileReader();
    reader.onload = function (e) {
      const arrayBuffer = e.target.result;
      audioCtx.decodeAudioData(
        arrayBuffer,
        (buffer) => {
          audioBuffer = buffer;
          duration = buffer.duration;
          totalDurationDisplay.textContent = formatTime(duration);
          seekBar.max = duration;
          seekBar.value = 0;
          seekBar.disabled = false;
          btnPlay.disabled = false;
          btnStop.disabled = false;
          btnExport.disabled = false;
          visualizerOverlay.classList.add('hidden');
          drawStaticWaveform();
        },
        (err) => {
          console.error('Erro ao decodificar áudio:', err);
          visualizerOverlay.innerHTML = '<span style="color: #ef4444;">Falha ao carregar áudio</span>';
        }
      );
    };
    reader.readAsArrayBuffer(file);
  }

  // --- Cálculo de Detune em Cents ---
  // Relação de Frequências: detune (cents) = 1200 * log2(f_target / 440)
  function calculateDetuneCents(freq) {
    return 1200 * Math.log2(freq / 440);
  }

  // --- Reprodução de Áudio ---
  function playAudio() {
    if (!audioBuffer) return;
    initAudioContext();

    if (isPlaying) {
      pauseAudio();
      return;
    }

    sourceNode = audioCtx.createBufferSource();
    sourceNode.buffer = audioBuffer;

    // Aplicar detune de frequência
    const detuneCents = calculateDetuneCents(targetFreq);
    sourceNode.detune.value = detuneCents;

    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 512;
    analyserNode.smoothingTimeConstant = 0.8;

    gainNode = audioCtx.createGain();
    gainNode.gain.value = parseFloat(volumeBar.value);

    sourceNode.connect(analyserNode);
    analyserNode.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    if (pauseOffset >= duration) pauseOffset = 0;

    sourceNode.start(0, pauseOffset);
    startTime = audioCtx.currentTime - pauseOffset;
    isPlaying = true;

    updatePlayButtonUI();
    visualizerOverlay.classList.add('hidden');
    renderVisualizer();
    updateProgressBar();

    sourceNode.onended = () => {
      if (isPlaying && (audioCtx.currentTime - startTime) >= (duration - pauseOffset - 0.1)) {
        stopAudio();
      }
    };
  }

  function pauseAudio() {
    if (!isPlaying) return;
    pauseOffset = audioCtx.currentTime - startTime;
    if (sourceNode) {
      sourceNode.stop();
      sourceNode.disconnect();
    }
    isPlaying = false;
    updatePlayButtonUI();
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
  }

  function stopAudio() {
    if (sourceNode) {
      try { sourceNode.stop(); } catch (e) {}
      sourceNode.disconnect();
    }
    isPlaying = false;
    pauseOffset = 0;
    seekBar.value = 0;
    currentTimeDisplay.textContent = formatTime(0);
    updatePlayButtonUI();
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    if (audioBuffer) {
      drawStaticWaveform();
    }
  }

  function updatePlayButtonUI() {
    if (isPlaying) {
      iconPlay.classList.add('hidden');
      iconPause.classList.remove('hidden');
    } else {
      iconPlay.classList.remove('hidden');
      iconPause.classList.add('hidden');
    }
  }

  // Seek bar & Controle de tempo
  seekBar.addEventListener('input', () => {
    if (!audioBuffer) return;
    const seekTo = parseFloat(seekBar.value);
    pauseOffset = seekTo;
    currentTimeDisplay.textContent = formatTime(seekTo);

    if (isPlaying) {
      sourceNode.stop();
      sourceNode.disconnect();
      isPlaying = false;
      playAudio();
    }
  });

  volumeBar.addEventListener('input', () => {
    if (gainNode) {
      gainNode.gain.value = parseFloat(volumeBar.value);
    }
  });

  function updateProgressBar() {
    if (!isPlaying) return;
    const current = audioCtx.currentTime - startTime;
    if (current <= duration) {
      seekBar.value = current;
      currentTimeDisplay.textContent = formatTime(current);
      requestAnimationFrame(updateProgressBar);
    }
  }

  // --- Renderização do Espectro no Canvas ---
  function renderVisualizer() {
    if (!isPlaying || !analyserNode) return;

    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    canvasCtx.clearRect(0, 0, width, height);

    if (visualizerMode === 'frequency') {
      const bufferLength = analyserNode.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      analyserNode.getByteFrequencyData(dataArray);

      const barWidth = (width / bufferLength) * 1.8;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * height;

        // Gradiente vibrante
        const gradient = canvasCtx.createLinearGradient(0, height, 0, height - barHeight);
        gradient.addColorStop(0, '#6366f1');
        gradient.addColorStop(0.5, '#06b6d4');
        gradient.addColorStop(1, '#a5f3fc');

        canvasCtx.fillStyle = gradient;
        canvasCtx.fillRect(x, height - barHeight, barWidth - 1, barHeight);

        x += barWidth;
      }
    } else {
      const bufferLength = analyserNode.fftSize;
      const dataArray = new Uint8Array(bufferLength);
      analyserNode.getByteTimeDomainData(dataArray);

      canvasCtx.lineWidth = 2.5;
      canvasCtx.strokeStyle = '#06b6d4';
      canvasCtx.beginPath();

      const sliceWidth = width / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * height) / 2;

        if (i === 0) {
          canvasCtx.moveTo(x, y);
        } else {
          canvasCtx.lineTo(x, y);
        }

        x += sliceWidth;
      }

      canvasCtx.lineTo(width, height / 2);
      canvasCtx.stroke();
    }

    animationFrameId = requestAnimationFrame(renderVisualizer);
  }

  function drawStaticWaveform() {
    if (!audioBuffer) return;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    canvasCtx.clearRect(0, 0, width, height);

    const data = audioBuffer.getChannelData(0);
    const step = Math.ceil(data.length / width);
    const amp = height / 2;

    canvasCtx.fillStyle = '#334155';

    for (let i = 0; i < width; i++) {
      let min = 1.0;
      let max = -1.0;
      for (let j = 0; j < step; j++) {
        const datum = data[i * step + j];
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }
      canvasCtx.fillRect(i, (1 + min) * amp, 1, Math.max(1, (max - min) * amp));
    }
  }

  // Alternância de Modos do Visualizador
  modeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      modeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      visualizerMode = btn.dataset.mode;
      if (!isPlaying && audioBuffer) {
        drawStaticWaveform();
      }
    });
  });

  // --- Controles de Frequência de Terapia Alternativa ---
  function updateTargetFrequency(freq) {
    targetFreq = parseInt(freq, 10);
    targetFreqDisplay.textContent = `${targetFreq} Hz`;
    freqSlider.value = targetFreq;

    // Atualizar botões de preset
    presetBtns.forEach(btn => {
      if (parseInt(btn.dataset.freq, 10) === targetFreq) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Se estiver tocando, atualizar detune do nó em tempo real
    if (isPlaying && sourceNode) {
      const detuneCents = calculateDetuneCents(targetFreq);
      sourceNode.detune.setValueAtTime(detuneCents, audioCtx.currentTime);
    }
  }

  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      updateTargetFrequency(btn.dataset.freq);
    });
  });

  freqSlider.addEventListener('input', (e) => {
    updateTargetFrequency(e.target.value);
  });

  // --- Eventos dos Botões de Player ---
  btnPlay.addEventListener('click', playAudio);
  btnStop.addEventListener('click', stopAudio);

  // --- Exportação de Áudio com OfflineAudioContext ---
  btnExport.addEventListener('click', async () => {
    if (!audioBuffer) return;

    btnExport.disabled = true;
    exportStatus.classList.remove('hidden');
    exportStatusText.textContent = `Processando áudio para ${targetFreq} Hz...`;

    // Aguardar pequena pausa para a UI atualizar o status
    await new Promise(resolve => setTimeout(resolve, 50));

    try {
      const sampleRate = audioBuffer.sampleRate;
      const channels = audioBuffer.numberOfChannels;
      const durationSec = audioBuffer.duration;

      const offlineCtx = new OfflineAudioContext(channels, sampleRate * durationSec, sampleRate);

      const offlineSource = offlineCtx.createBufferSource();
      offlineSource.buffer = audioBuffer;
      offlineSource.detune.value = calculateDetuneCents(targetFreq);

      offlineSource.connect(offlineCtx.destination);
      offlineSource.start(0);

      const renderedBuffer = await offlineCtx.startRendering();

      exportStatusText.textContent = 'Gerando arquivo WAV...';

      // Converter renderedBuffer em arquivo WAV
      const wavBlob = audioBufferToWavBlob(renderedBuffer);
      const url = URL.createObjectURL(wavBlob);

      const downloadLink = document.createElement('a');
      downloadLink.href = url;
      downloadLink.download = `${loadedFileName}_${targetFreq}Hz.wav`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);

      exportStatusText.textContent = 'Download concluído com sucesso!';
      setTimeout(() => {
        exportStatus.classList.add('hidden');
        btnExport.disabled = false;
      }, 3000);

    } catch (err) {
      console.error('Erro ao exportar áudio:', err);
      exportStatusText.textContent = 'Erro ao processar e salvar áudio.';
      setTimeout(() => {
        exportStatus.classList.add('hidden');
        btnExport.disabled = false;
      }, 3000);
    }
  });

  // Função Utilitária para codificar AudioBuffer em WAV
  function audioBufferToWavBlob(buffer) {
    const numOfChan = buffer.numberOfChannels;
    const length = buffer.length * numOfChan * 2 + 44;
    const out = new DataView(new ArrayBuffer(length));
    let channels = [], sampleRate = buffer.sampleRate, offset = 0, pos = 0;

    function writeString(str) {
      for (let i = 0; i < str.length; i++) {
        out.setUint8(pos++, str.charCodeAt(i));
      }
    }

    function setUint16(data) {
      out.setUint16(pos, data, true);
      pos += 2;
    }

    function setUint32(data) {
      out.setUint32(pos, data, true);
      pos += 4;
    }

    // WAV Header
    writeString('RIFF');
    setUint32(length - 8);
    writeString('WAVE');
    writeString('fmt ');
    setUint32(16); // SubChunk1Size
    setUint16(1);  // PCM format
    setUint16(numOfChan);
    setUint32(sampleRate);
    setUint32(sampleRate * 2 * numOfChan); // ByteRate
    setUint16(numOfChan * 2); // BlockAlign
    setUint16(16); // BitsPerSample
    writeString('data');
    setUint32(length - pos - 4);

    for (let i = 0; i < buffer.numberOfChannels; i++) {
      channels.push(buffer.getChannelData(i));
    }

    while (offset < buffer.length) {
      for (let i = 0; i < numOfChan; i++) {
        let sample = Math.max(-1, Math.min(1, channels[i][offset]));
        sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
        out.setInt16(pos, sample, true);
        pos += 2;
      }
      offset++;
    }

    return new Blob([out], { type: 'audio/wav' });
  }

  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }
});
