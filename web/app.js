"use strict";

const elements = {
  ambient: document.querySelector("#ambient-canvas"),
  signal: document.querySelector("#signal-canvas"),
  core: document.querySelector("#core-stage"),
  microphone: document.querySelector("#microphone-button"),
  voiceAction: document.querySelector("#voice-action"),
  voiceHint: document.querySelector("#voice-hint"),
  signalLevel: document.querySelector("#signal-level"),
  state: document.querySelector("#system-state"),
  latency: document.querySelector("#latency-readout"),
  inputState: document.querySelector("#input-state"),
  transcript: document.querySelector("#transcript"),
  response: document.querySelector("#response"),
  routeAgent: document.querySelector("#route-agent"),
  voiceSelect: document.querySelector("#voice-select"),
  previewVoice: document.querySelector("#preview-voice"),
  form: document.querySelector("#command-form"),
  input: document.querySelector("#command-input"),
  cancel: document.querySelector("#cancel-button"),
  log: document.querySelector("#log-output"),
  count: document.querySelector("#event-count"),
  uptime: document.querySelector("#uptime"),
  autoscroll: document.querySelector("#autoscroll-button"),
  export: document.querySelector("#export-button"),
  clear: document.querySelector("#clear-button"),
  toast: document.querySelector("#toast"),
};

const token = document.querySelector('meta[name="tibo-token"]').content;
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const sessionStarted = performance.now();
const state = {
  busy: false,
  listening: false,
  autoscroll: true,
  controller: null,
  turn: 0,
  logs: [],
  speechController: null,
  playback: null,
  playbackUrl: null,
  responseText: "",
  analyser: null,
  audioContext: null,
  microphoneStream: null,
  toastTimer: null,
};

let recognition = null;
let signalFrame = 0;
let ambientFrame = 0;
const VOICE_STORAGE_KEY = "tibo.voice";

function setSystemState(name) {
  const normalized = name === "ready" ? "online" : name;
  document.body.dataset.state = normalized;
  elements.state.textContent = normalized.toUpperCase();
  elements.core.dataset.state = normalized;
  elements.microphone.classList.toggle("processing", ["processing", "thinking"].includes(name));
  elements.cancel.disabled = !state.busy;
}

function showToast(message) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  state.toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 3400);
}

function formatElapsed(milliseconds) {
  const totalSeconds = Math.max(0, milliseconds) / 1000;
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, "0");
  const millis = Math.floor(milliseconds % 1000).toString().padStart(3, "0");
  return `${minutes}:${seconds}.${millis}`;
}

function appendLog(event) {
  const record = {
    at_ms: Number(event.at_ms || performance.now() - sessionStarted),
    source: String(event.source || "web"),
    stream: String(event.stream || "event"),
    line: String(event.line || ""),
  };
  state.logs.push(record);
  elements.log.querySelector(".log-empty")?.remove();

  const row = document.createElement("div");
  row.className = `log-row ${record.source.toLowerCase()} ${record.stream.toLowerCase()}`;
  const time = document.createElement("span");
  const source = document.createElement("span");
  const message = document.createElement("span");
  time.className = "log-time";
  source.className = "log-source";
  message.className = "log-message";
  time.textContent = formatElapsed(record.at_ms);
  source.textContent = record.stream === "event" ? record.source : `${record.source}/${record.stream}`;
  message.textContent = record.line;
  row.append(time, source, message);
  elements.log.append(row);
  elements.count.textContent = String(state.logs.length).padStart(4, "0");
  if (state.autoscroll) elements.log.scrollTop = elements.log.scrollHeight;
}

function logLocal(line, source = "web", stream = "event") {
  appendLog({ at_ms: performance.now() - sessionStarted, source, stream, line });
}

function emptyLog() {
  state.logs = [];
  elements.log.replaceChildren();
  const empty = document.createElement("div");
  empty.className = "log-empty";
  const code = document.createElement("span");
  const description = document.createElement("p");
  code.className = "empty-code";
  code.textContent = "AWAITING SIGNAL";
  description.textContent = "Mọi sự kiện backend, Claude và hệ thống sẽ xuất hiện tại đây.";
  empty.append(code, description);
  elements.log.append(empty);
  elements.count.textContent = "0000";
}

function exportLogs() {
  if (!state.logs.length) {
    showToast("Chưa có dữ liệu log để xuất.");
    return;
  }
  const content = state.logs
    .map((entry) => `${formatElapsed(entry.at_ms)}\t${entry.source}\t${entry.stream}\t${entry.line}`)
    .join("\n");
  const blob = new Blob([content, "\n"], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `tibo-${new Date().toISOString().replaceAll(":", "-")}.log`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast(`Đã xuất ${state.logs.length} dòng log.`);
}

function updateAutoscroll(enabled) {
  state.autoscroll = enabled;
  elements.autoscroll.classList.toggle("active", enabled);
  elements.autoscroll.setAttribute("aria-pressed", String(enabled));
  elements.autoscroll.textContent = enabled ? "Theo luồng" : "Đã dừng";
  if (enabled) elements.log.scrollTop = elements.log.scrollHeight;
}

function stopVoicePlayback() {
  state.speechController?.abort();
  state.speechController = null;
  state.playback?.pause();
  state.playback = null;
  if (state.playbackUrl) URL.revokeObjectURL(state.playbackUrl);
  state.playbackUrl = null;
}

function initializeVoiceSelector() {
  const saved = localStorage.getItem(VOICE_STORAGE_KEY);
  if ([...elements.voiceSelect.options].some((option) => option.value === saved)) {
    elements.voiceSelect.value = saved;
  }
}

async function playVoice(text) {
  const clean = text.trim();
  if (!clean) return;
  stopVoicePlayback();
  const controller = new AbortController();
  state.speechController = controller;
  try {
    const response = await fetch("/api/v1/speech", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tibo-Token": token,
      },
      body: JSON.stringify({ text: clean, voice: elements.voiceSelect.value }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error?.message || `TTS HTTP ${response.status}`);
    }
    if (state.speechController !== controller) return;
    const url = URL.createObjectURL(await response.blob());
    const audio = new Audio(url);
    state.playbackUrl = url;
    state.playback = audio;
    audio.addEventListener(
      "ended",
      () => {
        if (state.playback === audio) {
          state.playback = null;
          URL.revokeObjectURL(url);
          state.playbackUrl = null;
        }
      },
      { once: true }
    );
    await audio.play();
  } catch (error) {
    if (error.name !== "AbortError") {
      logLocal(error.message, "speech", "stderr");
      showToast(`Không phát được giọng đọc: ${error.message}`);
    }
  } finally {
    if (state.speechController === controller) state.speechController = null;
  }
}

function previewVoice() {
  playVoice("Xin chào, tôi là Tibo. Bạn thấy giọng nói này thế nào?");
  logLocal(`voice preview: ${elements.voiceSelect.selectedOptions[0].textContent}`, "speech");
}

function resetResponse() {
  state.responseText = "";
  stopVoicePlayback();
  elements.response.textContent = "Đang xử lý yêu cầu...";
  elements.routeAgent.textContent = "ROUTING";
}

function handleEvent(event) {
  switch (event.type) {
    case "log":
      appendLog(event);
      break;
    case "state":
      setSystemState(event.state, event.detail);
      if (event.state === "thinking") elements.routeAgent.textContent = "CLAUDE";
      logLocal(`${event.state}: ${event.detail}`, "system");
      break;
    case "transcript":
      elements.transcript.textContent = event.text;
      elements.inputState.textContent = "CAPTURED";
      break;
    case "route": {
      const route = event.data || {};
      elements.routeAgent.textContent = String(route.agent || "LOCAL").toUpperCase();
      elements.inputState.textContent = String(route.status || "ROUTED").toUpperCase();
      logLocal(
        `${route.agent || "unknown"}.${route.command || "unknown"} ${route.status || "unknown"}: ${route.summary || ""}`,
        "route"
      );
      break;
    }
    case "response_delta":
      if (!state.responseText) elements.response.textContent = "";
      state.responseText += event.text;
      elements.response.textContent = state.responseText;
      break;
    case "response_done":
      playVoice(state.responseText);
      break;
    case "native_action":
      elements.routeAgent.textContent = "NATIVE";
      logLocal(`${event.action} ${event.target}: ${event.status} ${event.message}`, "native");
      if (event.status !== "succeeded") {
        setSystemState("error", event.message);
        showToast(event.message);
      }
      break;
    case "error":
      logLocal(`${event.code}: ${event.message}`, "error", "stderr");
      setSystemState("error", event.message);
      showToast(event.message);
      if (!state.responseText) elements.response.textContent = event.message;
      break;
    case "done":
      logLocal(`turn completed with exit code ${event.exit_code}`, "system");
      break;
    default:
      logLocal(`unknown event type: ${String(event.type)}`, "web", "stderr");
  }
}

async function parseEventStream(response, turn) {
  if (!response.body) throw new Error("Trình duyệt không hỗ trợ response streaming.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  while (true) {
    const { value, done } = await reader.read();
    pending += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = pending.split("\n");
    pending = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim() || turn !== state.turn) continue;
      try {
        handleEvent(JSON.parse(line));
      } catch {
        logLocal(`invalid NDJSON: ${line}`, "web", "stderr");
      }
    }
    if (done) break;
  }
  if (pending.trim() && turn === state.turn) handleEvent(JSON.parse(pending));
}

async function waitUntilIdle() {
  const deadline = performance.now() + 1800;
  while (performance.now() < deadline) {
    try {
      const response = await fetch("/api/v1/health", { cache: "no-store" });
      const body = await response.json();
      if (!body.data?.busy) return;
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 45));
  }
}

async function cancelCurrent(showStatus = true) {
  if (!state.busy) return;
  state.turn += 1;
  state.controller?.abort();
  state.controller = null;
  state.busy = false;
  stopVoicePlayback();
  try {
    await fetch("/api/v1/turns/current/cancel", {
      method: "POST",
      headers: { "X-Tibo-Token": token },
    });
  } catch {
    logLocal("cancel request disconnected", "web", "stderr");
  }
  await waitUntilIdle();
  elements.cancel.disabled = true;
  if (showStatus) {
    setSystemState("cancelled", "Foreground response cancelled");
    showToast("Đã ngắt phản hồi hiện tại.");
  }
}

async function submitTurn(rawTranscript) {
  const transcript = rawTranscript.trim();
  if (!transcript) return;
  const interrupted = state.busy;
  if (interrupted) await cancelCurrent(false);

  const turn = ++state.turn;
  const controller = new AbortController();
  const started = performance.now();
  state.controller = controller;
  state.busy = true;
  elements.cancel.disabled = false;
  elements.transcript.textContent = transcript;
  elements.inputState.textContent = interrupted ? "INTERRUPT" : "CAPTURED";
  resetResponse();
  setSystemState("processing", "Routing request");
  logLocal(`submitted transcript (${transcript.length} characters)`, "web");

  try {
    const response = await fetch("/api/v1/turns", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tibo-Token": token,
      },
      body: JSON.stringify({ transcript, interrupted }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error?.message || `HTTP ${response.status}`);
    }
    await parseEventStream(response, turn);
    if (turn === state.turn) {
      elements.latency.textContent = `${Math.round(performance.now() - started)} MS`;
    }
  } catch (error) {
    if (error.name !== "AbortError" && turn === state.turn) {
      logLocal(error.message, "web", "stderr");
      setSystemState("error", error.message);
      elements.response.textContent = error.message;
      showToast(error.message);
    }
  } finally {
    if (turn === state.turn) {
      state.busy = false;
      state.controller = null;
      elements.cancel.disabled = true;
      if (document.body.dataset.state !== "error") setSystemState("ready", "Ready");
    }
  }
}

async function startAudioMeter() {
  if (!navigator.mediaDevices?.getUserMedia) return;
  state.microphoneStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  state.audioContext = new AudioContext();
  const source = state.audioContext.createMediaStreamSource(state.microphoneStream);
  state.analyser = state.audioContext.createAnalyser();
  state.analyser.fftSize = 256;
  state.analyser.smoothingTimeConstant = 0.82;
  source.connect(state.analyser);
}

function stopAudioMeter() {
  state.microphoneStream?.getTracks().forEach((track) => track.stop());
  state.microphoneStream = null;
  state.analyser = null;
  state.audioContext?.close();
  state.audioContext = null;
}

async function toggleMicrophone() {
  if (!recognition) return;
  if (state.listening) {
    recognition.stop();
    return;
  }
  try {
    await startAudioMeter();
    recognition.start();
  } catch (error) {
    stopAudioMeter();
    showToast(`Không thể mở microphone: ${error.message}`);
    logLocal(error.message, "microphone", "stderr");
  }
}

function initializeRecognition() {
  if (!SpeechRecognition) {
    elements.microphone.disabled = true;
    elements.voiceAction.textContent = "TEXT ONLY";
    elements.voiceHint.textContent = "Trình duyệt chưa hỗ trợ nhận giọng nói";
    logLocal("SpeechRecognition unavailable; text input remains active", "system");
    return;
  }
  recognition = new SpeechRecognition();
  recognition.lang = "vi-VN";
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.onstart = () => {
    state.listening = true;
    elements.microphone.classList.add("listening");
    elements.microphone.setAttribute("aria-pressed", "true");
    elements.voiceAction.textContent = "ĐANG NGHE";
    elements.voiceHint.textContent = "Nói lệnh của bạn";
    elements.inputState.textContent = "LISTENING";
    elements.transcript.textContent = "...";
    logLocal("voice channel opened", "microphone");
  };
  recognition.onresult = (event) => {
    let interim = "";
    let final = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const text = event.results[index][0].transcript;
      if (event.results[index].isFinal) final += text;
      else interim += text;
    }
    elements.transcript.textContent = final || interim || "...";
    if (final.trim()) {
      recognition.stop();
      submitTurn(final);
    }
  };
  recognition.onerror = (event) => {
    if (event.error !== "aborted" && event.error !== "no-speech") {
      showToast(`Lỗi microphone: ${event.error}`);
      logLocal(event.error, "microphone", "stderr");
    }
  };
  recognition.onend = () => {
    state.listening = false;
    elements.microphone.classList.remove("listening");
    elements.microphone.setAttribute("aria-pressed", "false");
    elements.voiceAction.textContent = state.busy ? "ĐANG XỬ LÝ" : "KÍCH HOẠT";
    elements.voiceHint.textContent = state.busy ? "Nhấn để ngắt bằng giọng nói" : "Nhấn để nói";
    if (!state.busy) elements.inputState.textContent = "STANDBY";
    stopAudioMeter();
  };
}

function drawSignal() {
  const canvas = elements.signal;
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);
  const data = new Uint8Array(state.analyser?.frequencyBinCount || 64);
  if (state.analyser) state.analyser.getByteFrequencyData(data);
  const average = data.reduce((sum, value) => sum + value, 0) / data.length;
  const idle = 12 + Math.sin(performance.now() / 860) * 4;
  const energy = state.analyser ? average : idle;
  elements.signalLevel.textContent = `${Math.round(Math.max(-60, energy / 2 - 60))} DB`;

  context.save();
  context.translate(width / 2, height / 2);
  for (let ring = 0; ring < 3; ring += 1) {
    context.beginPath();
    const points = 96;
    for (let index = 0; index <= points; index += 1) {
      const angle = (index / points) * Math.PI * 2;
      const sample = data[index % data.length] / 255;
      const base = 132 + ring * 28;
      const pulse = (state.listening ? sample * 26 : Math.sin(angle * 6 + performance.now() / 900) * 2);
      const radius = base + pulse;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.closePath();
    context.strokeStyle = `rgba(99, 230, 255, ${0.34 - ring * 0.075})`;
    context.lineWidth = 1.2;
    context.stroke();
  }
  context.restore();
  signalFrame = requestAnimationFrame(drawSignal);
}

function drawAmbient() {
  const canvas = elements.ambient;
  const context = canvas.getContext("2d");
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  const time = performance.now() / 1000;
  context.strokeStyle = "rgba(99, 230, 255, 0.13)";
  context.lineWidth = 1;
  for (let index = 0; index < 9; index += 1) {
    const y = ((index * 137 + time * (7 + index * 0.4)) % (height + 200)) - 100;
    const x = width * (0.55 + Math.sin(index * 2.4) * 0.36);
    context.beginPath();
    context.moveTo(x - 22, y);
    context.lineTo(x + 22, y);
    context.stroke();
  }
  if (!reducedMotion) ambientFrame = requestAnimationFrame(drawAmbient);
}

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const transcript = elements.input.value;
  elements.input.value = "";
  submitTurn(transcript);
});
elements.microphone.addEventListener("click", toggleMicrophone);
elements.cancel.addEventListener("click", () => cancelCurrent(true));
elements.clear.addEventListener("click", emptyLog);
elements.export.addEventListener("click", exportLogs);
elements.autoscroll.addEventListener("click", () => updateAutoscroll(!state.autoscroll));
elements.voiceSelect.addEventListener("change", () => {
  localStorage.setItem(VOICE_STORAGE_KEY, elements.voiceSelect.value);
  showToast(`Đã chọn ${elements.voiceSelect.selectedOptions[0].textContent}.`);
  stopVoicePlayback();
});
elements.previewVoice.addEventListener("click", previewVoice);
elements.log.addEventListener("scroll", () => {
  const distance = elements.log.scrollHeight - elements.log.scrollTop - elements.log.clientHeight;
  if (distance > 36 && state.autoscroll) updateAutoscroll(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.busy) cancelCurrent(true);
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") elements.form.requestSubmit();
});
window.addEventListener("beforeunload", () => {
  cancelAnimationFrame(signalFrame);
  cancelAnimationFrame(ambientFrame);
  state.controller?.abort();
  stopAudioMeter();
  stopVoicePlayback();
});
setInterval(() => {
  const elapsed = Math.floor((performance.now() - sessionStarted) / 1000);
  const hours = Math.floor(elapsed / 3600).toString().padStart(2, "0");
  const minutes = Math.floor((elapsed % 3600) / 60).toString().padStart(2, "0");
  const seconds = (elapsed % 60).toString().padStart(2, "0");
  elements.uptime.textContent = `${hours}:${minutes}:${seconds}`;
}, 1000);

initializeVoiceSelector();
initializeRecognition();
setSystemState("ready", "Ready");
logLocal("web control surface initialized", "system");
drawSignal();
drawAmbient();
fetch("/api/v1/health", { cache: "no-store" })
  .then((response) => response.json())
  .then(() => logLocal("localhost bridge healthy", "system"))
  .catch(() => {
    setSystemState("error", "Local bridge unavailable");
    showToast("Không kết nối được với Tibo backend.");
  });
