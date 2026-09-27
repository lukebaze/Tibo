@preconcurrency import AVFoundation
import AppKit
import Carbon
import SoundAnalysis
import Speech
import SwiftUI
import Combine
import Vision

private enum VoiceState: String {
    case listening = "Đang nghe"
    case processing = "Đang xử lý"
    case transcribing = "Đang chuyển thành chữ…"
    case speaking = "Đang nói"
    case approval = "Chờ xác nhận"
    case stopped = "Đã tắt mic"
}

private struct RouteResult: Decodable {
    let agent: String
    let command: String
    let status: String
    let summary: String
}

private struct NativeAction: Decodable {
    let action: String
    let target: String
}

private struct ScreenRequest: Decodable {
    let question: String
    let vision: Bool
    /// Tibo's memory block (facts, recent days, live conversation) for the end of the system prompt.
    let context: String
}

/// Chat turn from the backend: `context` as in `ScreenRequest`. `workflow` is set when the text hit
/// a workflow trigger: its instructions join the system prompt and the agent gets a bash tool.
private struct LlmRequest: Decodable {
    struct Workflow: Decodable {
        let id: String
        let instructions: String
    }
    let prompt: String
    let context: String
    let workflow: Workflow?
}

private struct TtsWavEvent: Decodable {
    let turnID: Int
    let sequence: Int
    let path: String

    enum CodingKeys: String, CodingKey {
        case turnID = "turn_id"
        case sequence
        case path
    }
}

private struct TtsErrorEvent: Decodable {
    let turnID: Int
    let message: String

    enum CodingKeys: String, CodingKey {
        case turnID = "turn_id"
        case message
    }
}

private final class LineReader {
    private var buffer = Data()
    private let handler: (String) -> Void

    init(handler: @escaping (String) -> Void) {
        self.handler = handler
    }

    func feed(_ data: Data) {
        if data.isEmpty {
            if !buffer.isEmpty { handler(String(decoding: buffer, as: UTF8.self)) }
            buffer.removeAll()
            return
        }
        buffer.append(data)
        while let newline = buffer.firstIndex(of: 0x0A) {
            handler(String(decoding: buffer[..<newline], as: UTF8.self))
            buffer.removeSubrange(...newline)
        }
    }
}

/// One long-lived `pi --mode rpc` per conversation: follow-ups keep their context and skip pi's
/// start-up. The system prompt and tools are fixed when it starts; `stop()` ends the conversation.
/// Events of the running prompt go to `onEvent` tagged with the turn that sent it; a prompt sent
/// while another runs aborts that one and waits for its `agent_end`.
@MainActor
private final class PiSession {
    var onEvent: ((String, Int) -> Void)?
    /// pi died while `turn` was running.
    var onExit: ((Int) -> Void)?
    private var process: Process?
    private var input: FileHandle?
    private var reader: LineReader?
    private var running: Int?
    private var queued: (message: String, turn: Int)?
    private var abortID = 0

    var isAlive: Bool { process?.isRunning == true }
    var busy: Bool { running != nil || queued != nil }

    func start(executable: URL, arguments: [String]) throws {
        let process = Process()
        let stdin = Pipe(), stdout = Pipe(), stderr = Pipe()
        process.executableURL = executable
        process.arguments = ["--mode", "rpc", "--no-session"] + arguments
        process.environment = AgentCLI.environment()
        process.standardInput = stdin
        process.standardOutput = stdout
        process.standardError = stderr
        let reader = LineReader { [weak self] line in
            DispatchQueue.main.async { self?.handle(line) }
        }
        stdout.fileHandleForReading.readabilityHandler = { reader.feed($0.availableData) }
        stderr.fileHandleForReading.readabilityHandler = { _ = $0.availableData }
        process.terminationHandler = { [weak self] ended in
            stdout.fileHandleForReading.readabilityHandler = nil
            stderr.fileHandleForReading.readabilityHandler = nil
            DispatchQueue.main.async { self?.exited(ended) }
        }
        try process.run()
        self.process = process
        self.reader = reader
        input = stdin.fileHandleForWriting
        print("TIBO_PI session_start pid=\(process.processIdentifier)")
    }

    func prompt(_ message: String, turn: Int) {
        guard running == nil else {
            queued = (message, turn)
            abortRunning()
            return
        }
        running = turn
        write(["type": "prompt", "message": message])
    }

    /// Stops the answer in progress; the conversation stays.
    func abort() {
        queued = nil
        if running != nil { abortRunning() }
    }

    func stop() {
        guard let process else { return }
        print("TIBO_PI session_end pid=\(process.processIdentifier)")
        self.process = nil
        running = nil
        queued = nil
        try? input?.close()
        input = nil
        process.terminate()
    }

    /// An abort that lands before pi starts the run may never produce `agent_end`; don't let the
    /// queued prompt wait on it forever.
    private func abortRunning() {
        write(["type": "abort"])
        abortID += 1
        let id = abortID
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
            guard let self, self.abortID == id, self.running != nil else { return }
            print("TIBO_PI abort_timeout")
            self.runEnded()
        }
    }

    private func handle(_ line: String) {
        guard let turn = running else { return }
        onEvent?(line, turn)
        guard let object = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
              let type = object["type"] as? String else { return }
        let rejected = type == "response" && object["command"] as? String == "prompt" && object["success"] as? Bool == false
        if type == "agent_end" || rejected { runEnded() }
    }

    private func runEnded() {
        running = nil
        abortID += 1
        if let next = queued {
            queued = nil
            prompt(next.message, turn: next.turn)
        }
    }

    private func exited(_ ended: Process) {
        guard ended === process else { return }
        print("TIBO_PI exit status=\(ended.terminationStatus)")
        let turn = running ?? queued?.turn
        process = nil
        input = nil
        running = nil
        queued = nil
        if let turn { onExit?(turn) }
    }

    private func write(_ command: [String: Any]) {
        guard var data = try? JSONSerialization.data(withJSONObject: command) else { return }
        data.append(0x0A)
        try? input?.write(contentsOf: data)
    }
}

private final class WavWriter {
    let url: URL
    private let file: AVAudioFile

    init() throws {
        url = FileManager.default.temporaryDirectory.appendingPathComponent("tibo-mic-\(Int(Date().timeIntervalSince1970 * 1000)).wav")
        let format = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16_000, channels: 1, interleaved: false)!
        file = try AVAudioFile(forWriting: url, settings: format.settings, commonFormat: .pcmFormatInt16, interleaved: false)
    }

    func write(_ buffer: AVAudioPCMBuffer) throws { try file.write(from: buffer) }
}

/// On-device speech/non-speech classifier (Apple SoundAnalysis). Energy VAD alone fires on
/// keyboard clicks and desk thumps; those turns reach Whisper as silence and come back as
/// hallucinated text ("Hãy subscribe cho kênh…").
private final class SpeechGate: NSObject, SNResultsObserving, @unchecked Sendable {
    private let analyzer: SNAudioStreamAnalyzer
    private var position: AVAudioFramePosition = 0
    private let onSpeech: @Sendable () -> Void

    init(format: AVAudioFormat, onSpeech: @escaping @Sendable () -> Void) throws {
        analyzer = SNAudioStreamAnalyzer(format: format)
        self.onSpeech = onSpeech
        super.init()
        let request = try SNClassifySoundRequest(classifierIdentifier: .version1)
        request.windowDuration = CMTime(seconds: 0.5, preferredTimescale: 48_000) // classifier minimum
        request.overlapFactor = 0.5
        try analyzer.add(request, withObserver: self)
    }

    /// Call only from the serial audio queue.
    func analyze(_ buffer: AVAudioPCMBuffer) {
        analyzer.analyze(buffer, atAudioFramePosition: position)
        position += AVAudioFramePosition(buffer.frameLength)
    }

    func request(_ request: SNRequest, didProduce result: SNResult) {
        guard let result = result as? SNClassificationResult,
              (result.classification(forIdentifier: "speech")?.confidence ?? 0) >= 0.5 else { return }
        onSpeech()
    }
}

@MainActor
private final class VoiceController: NSObject, ObservableObject, AVAudioPlayerDelegate {
    @Published var state: VoiceState = .listening
    @Published var transcript = "Nói “Tibo” để bắt đầu"
    @Published var summary = "Sẵn sàng"
    @Published var task = ""
    @Published var power: Float = -60
    @Published var micEnabled = true
    /// A mic-button turn (smart / start-stop mode) is waiting for speech.
    @Published private(set) var armed = false
    /// Recording an utterance right now.
    @Published private(set) var capturing = false
    /// The current turn was addressed explicitly (typed or mic button), so no wake word is needed.
    @Published private(set) var addressedTurn = false
    /// Shown in the input placeholder instead of a spoken/caption error.
    @Published private(set) var inputError: String?
    /// Replies that were not spoken stay on screen for a while.
    @Published private(set) var showAnswer = false
    private var typedTurn = false
    private var endRequested = false
    private var observers: Set<AnyCancellable> = []

    private let store: ProfileStore
    private var currentProfile: Profile
    private var profileSubscription: AnyCancellable?
    private let engine = AVAudioEngine()
    private let audioQueue = DispatchQueue(label: "local.tibo.audio")
    private var converter: AVAudioConverter?
    private var targetFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16_000, channels: 1, interleaved: false)!
    private var writer: WavWriter?
    private var preRoll: [AVAudioPCMBuffer] = []
    private var preRollFrames: AVAudioFrameCount = 0
    private var noiseFloor: Float = -50
    private var onsetDuration = 0.0
    private var silenceDuration = 0.0
    private var recordingDuration = 0.0
    private var awaitingMore = false
    private var prefixTranscript: String?
    private var interrupted = false
    private var lastMeterLog = Date.distantPast
    private var lastOnset = Date()
    private var lastSustainedOnset = Date.distantPast
    private var speechGate: SpeechGate?
    private var lastSpeechAt = Date.distantPast
    private var player: AVAudioPlayer?
    private var playbackEnded = Date.distantPast
    private var backendRunning = false
    private let vadMargin = Float(ProcessInfo.processInfo.environment["TIBO_VAD_MARGIN_DB"] ?? "8") ?? 8
    private let speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "vi-VN"))
    private var speechAuthorized = false
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var latestPartial = ""
    private var finalTranscript = ""
    private var recognitionFailed = false
    private var utteranceEnded = false
    private var turnID = 0
    private var submittedTurnID: Int?
    private var recognitionStartedAt = Date.distantPast
    private var loggedFirstPartial = false
    private var activeFallbackURL: URL?
    private var backendProcess: Process?
    private var backendReaders: [LineReader] = []
    private var ttsProcess: Process?
    private var ttsInput: FileHandle?
    private var ttsReaders: [LineReader] = []
    private var queuedAudio: [Int: URL] = [:]
    private var nextAudioSequence = 0
    private var playingURL: URL?
    private var agentProcess: Process?
    private var agentReaders: [LineReader] = []
    /// pi turns (chat and workflows) run in one rpc process per conversation.
    private let pi = PiSession()
    /// A conversation lasts until `conversationLimit` passes without a handled turn; while it
    /// lasts follow-ups need no wake word (the backend still checks they are addressed) and the
    /// face is awake instead of asleep.
    @Published private(set) var awake = false
    private static let conversationLimit = TimeInterval(ProcessInfo.processInfo.environment["TIBO_CONVERSATION_SECONDS"] ?? "") ?? 15 * 60
    private var conversationEnd: DispatchWorkItem?
    private var llmReceivedText = false
    private var llmFinalSent = false
    /// User text and route of the running agent turn, logged to memory once the answer is complete.
    private var agentMemoryTurn: (user: String, route: String)?
    private var llmStartedAt = Date.distantPast
    private var turnStartedAt = Date.distantPast
    private var loggedFirstAudio = false
    private var ttsResponsePending = false
    private var stateAfterPlayback: VoiceState = .listening
    private var nativeActionTurn: Int?
    private var nativeActionFailedTurn: Int?
    private var pendingNativeSay: String?
    private var whisperServer: Process?
    private var whisperInput: FileHandle?
    private let whisperPort = 8177

    init(store: ProfileStore) {
        self.store = store
        self.currentProfile = store.profile
        super.init()
        transcript = "Nói “\(currentProfile.assistantName)” để bắt đầu"
        loadTask()
        startTtsServer()
        if effectiveSttEngine == .whisper { startWhisperServer() }
        profileSubscription = store.$profile.sink { [weak self] profile in
            self?.profileChanged(profile)
        }
        requestPermissions()
        NotificationCenter.default.publisher(for: .tiboSubmit).sink { [weak self] note in
            if let text = note.object as? String { self?.submitTyped(text) }
        }.store(in: &observers)
        NotificationCenter.default.publisher(for: .tiboModelReady).sink { [weak self] _ in
            guard let self, self.effectiveSttEngine == .whisper else { return }
            self.stopWhisperServer()
            self.startWhisperServer()
        }.store(in: &observers)
        pi.onEvent = { [weak self] line, turn in self?.handlePiEvent(line, turn: turn) }
        pi.onExit = { [weak self] turn in self?.finishAgent(turn: turn, failed: true) }
    }

    var voiceMode: Profile.VoiceMode { currentProfile.voiceMode }

    /// Mic button for smart / start-stop modes: first tap arms one turn, a tap while recording sends it.
    func tapMic() {
        if !micEnabled { toggleMicrophone() }
        if writer != nil { endRequested = true; return }
        if isResponding { stopPlayback() }
        armed.toggle()
        inputError = nil
    }

    /// Keeps the notch open for turns the user started on purpose.
    var engaged: Bool {
        armed || showAnswer || (addressedTurn && (capturing || state == .transcribing))
    }

    func toggleMicrophone() {
        micEnabled.toggle()
        if micEnabled {
            state = .listening
            summary = "Mic đã bật"
            if !engine.isRunning { requestPermissions() }
        } else {
            engine.stop()
            recognitionTask?.cancel()
            recognitionTask = nil
            recognitionRequest = nil
            state = .stopped
            summary = "Mic đã tắt"
        }
    }

    func stopPlayback() {
        cancelForeground(turn: turnID, markInterrupted: false)
        state = .listening
        summary = "Đã ngắt giọng nói"
    }

    private func fail(_ message: String) {
        summary = message
        inputError = message
        let id = turnID
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
            if self?.turnID == id, self?.inputError == message { self?.inputError = nil }
        }
    }

    private var speaksThisTurn: Bool {
        currentProfile.speakReplies && (!typedTurn || currentProfile.readEveryAnswer)
    }

    private func revealAnswer() {
        showAnswer = true
        let id = turnID
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in
            if self?.turnID == id { self?.showAnswer = false }
        }
    }

    func submitTyped(_ raw: String) {
        // Typed/pasted Vietnamese can arrive decomposed (NFD); the backend's keyword fallback expects NFC.
        let text = raw.precomposedStringWithCanonicalMapping.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        let wasResponding = isResponding
        cancelForeground(turn: turnID, markInterrupted: wasResponding)
        interrupted = wasResponding
        if let writer { try? FileManager.default.removeItem(at: writer.url) }
        writer = nil
        onsetDuration = 0
        silenceDuration = 0
        awaitingMore = false
        prefixTranscript = nil
        addressedTurn = true
        typedTurn = true
        armed = false
        inputError = nil
        turnID += 1
        turnStartedAt = Date()
        loggedFirstAudio = false
        stateAfterPlayback = micEnabled ? .listening : .stopped
        submit(transcript: text, turn: turnID, capturedURL: nil)
    }

    private var isResponding: Bool {
        backendProcess?.isRunning == true
            || agentProcess?.isRunning == true
            || pi.busy
            || player?.isPlaying == true
            || !queuedAudio.isEmpty
            || ttsResponsePending
    }

    private func requestPermissions() {
        AVCaptureDevice.requestAccess(for: .audio) { [weak self] granted in
            Task { @MainActor in
                guard let self else { return }
                guard granted else {
                    self.micEnabled = false
                    self.state = .stopped
                    self.fail("Microphone không được cấp quyền")
                    return
                }
                SFSpeechRecognizer.requestAuthorization { status in
                    Task { @MainActor in
                        guard self.micEnabled else { return }
                        self.speechAuthorized = status == .authorized
                        if !self.speechAuthorized || self.speechRecognizer?.isAvailable != true {
                            self.summary = "Speech không khả dụng; dùng Whisper dự phòng"
                        }
                        if !self.engine.isRunning { self.startMicrophone() }
                    }
                }
            }
        }
    }

    private func startMicrophone() {
        let input = engine.inputNode
        let format = input.inputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            fail("Không tìm thấy microphone")
            return
        }
        converter = AVAudioConverter(from: format, to: targetFormat)
        input.removeTap(onBus: 0)
        let gate = try? SpeechGate(format: format) { [weak self] in
            Task { @MainActor in self?.lastSpeechAt = Date() }
        }
        speechGate = gate
        if gate == nil { print("TIBO_MIC speech_gate unavailable; energy VAD only") }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            guard let self else { return }
            let copied = self.copy(buffer)
            self.audioQueue.async { [weak self] in
                gate?.analyze(copied)
                self?.process(copied)
            }
        }
        do {
            try engine.start()
            print("TIBO_MIC recorder_started sample_rate=16000 channels=1 metering=true")
            print("TIBO_MIC metering_started interval_ms=50")
        } catch {
            fail("Không thể mở microphone: \(error.localizedDescription)")
        }
    }

    nonisolated private func copy(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer {
        let copy = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: buffer.frameCapacity)!
        copy.frameLength = buffer.frameLength
        let source = buffer.audioBufferList.pointee
        let destination = copy.mutableAudioBufferList.pointee
        for index in 0..<Int(source.mNumberBuffers) {
            if let src = source.mBuffers.mData, let dst = destination.mBuffers.mData {
                memcpy(dst, src, Int(source.mBuffers.mDataByteSize))
            }
            if source.mNumberBuffers > 1 {
                let src = buffer.audioBufferList[index].mBuffers.mData
                let dst = copy.mutableAudioBufferList[index].mBuffers.mData
                if let src, let dst { memcpy(dst, src, Int(buffer.audioBufferList[index].mBuffers.mDataByteSize)) }
            }
        }
        return copy
    }

    nonisolated private func process(_ buffer: AVAudioPCMBuffer) {
        Task { @MainActor [weak self] in
            guard let self, self.micEnabled else { return }
            self.consume(buffer)
        }
    }

    private func consume(_ buffer: AVAudioPCMBuffer) {
        let db = rms(buffer)
        power = db
        guard !store.trainingActive else { return }
        let now = Date()
        // ponytail: half-duplex. Built-in speakers reach the mic at -13…-18 dB, as loud as a real voice, so any
        // loudness threshold lets Tibo cut itself off with its own echo. Upgrade path: voice-processing AEC
        // (inputNode.setVoiceProcessingEnabled) with TTS played through `engine` to bring back voice barge-in.
        if player?.isPlaying == true || now.timeIntervalSince(playbackEnded) < 0.4 {
            if writer == nil {
                preRoll.removeAll(keepingCapacity: true)
                preRollFrames = 0
            }
            onsetDuration = 0
            return
        }
        let threshold: Float = min(-25, max(-48, noiseFloor + vadMargin))
        if now.timeIntervalSince(lastMeterLog) >= 0.05 {
            print(String(format: "TIBO_MIC meter power=%.1f threshold=%.1f noise=%.1f", db, threshold, noiseFloor))
            lastMeterLog = now
        }
        let duration = Double(buffer.frameLength) / buffer.format.sampleRate
        guard let converted = convert(buffer) else { return }
        if writer == nil {
            preRoll.append(converted)
            preRollFrames += converted.frameLength
            // Covers SpeechGate latency (0.5 s window) so the confirmed turn keeps its first syllable.
            let limit = AVAudioFrameCount(targetFormat.sampleRate * 1.0)
            while preRollFrames > limit, preRoll.count > 1 {
                preRollFrames -= preRoll.removeFirst().frameLength
            }
            if db < threshold {
                noiseFloor = (noiseFloor * 0.98) + (db * 0.02)
            }
        }
        if db > threshold {
            onsetDuration += duration
            silenceDuration = 0
            lastOnset = now
            if onsetDuration >= 0.10 { lastSustainedOnset = now }
        } else {
            onsetDuration = 0
            if writer != nil { silenceDuration += duration }
        }
        var startedNow = false
        let speechConfirmed = speechGate == nil || now.timeIntervalSince(lastSpeechAt) < 0.4
        let mode = currentProfile.voiceMode
        let tapStart = armed && mode == .startStop
        if writer == nil && (mode == .wake || armed) && (tapStart || (speechConfirmed && now.timeIntervalSince(lastSustainedOnset) < 0.6)) {
            let prerollMs = Int(Double(preRollFrames) / targetFormat.sampleRate * 1000)
            let oldTurn = turnID
            let wasResponding = isResponding
            cancelForeground(turn: oldTurn, markInterrupted: wasResponding)
            interrupted = wasResponding
            turnID += 1
            turnStartedAt = now
            loggedFirstAudio = false
            stateAfterPlayback = .listening
            addressedTurn = mode != .wake
            typedTurn = false
            armed = false
            inputError = nil
            do {
                let newWriter = try WavWriter()
                for buffered in preRoll { try newWriter.write(buffered) }
                writer = newWriter
                recordingDuration = Double(preRollFrames) / targetFormat.sampleRate
                submittedTurnID = nil
                startRecognition(turnID, preRoll: preRoll)
                preRoll.removeAll(keepingCapacity: true)
                preRollFrames = 0
                state = .listening
                capturing = true
                startedNow = true
                print(String(format: "TIBO_MIC speech_started turn_id=%d threshold=%.1f noise=%.1f preroll_ms=%d", turnID, threshold, noiseFloor, prerollMs))
            } catch {
                fail("Không thể ghi âm: \(error.localizedDescription)")
                return
            }
        }
        var endedURL: URL?
        if let writer {
            if !startedNow {
                try? writer.write(converted)
                recognitionRequest?.append(converted)
                recordingDuration += duration
            }
            let silenceLimit = awaitingMore ? 1.2 : 0.65
            let silenceEnds = currentProfile.voiceMode != .startStop && silenceDuration >= silenceLimit
            if endRequested || silenceEnds || recordingDuration >= (currentProfile.voiceMode == .startStop ? 60 : 15) {
                self.writer = nil
                capturing = false
                endRequested = false
                endedURL = writer.url
            }
        }
        // Outside the `if let writer` scope: the last reference is gone, so AVAudioFile has
        // written the WAV header before any reader opens the file.
        if let url = endedURL {
            activeFallbackURL = url
            let id = turnID
            onsetDuration = 0
            silenceDuration = 0
            utteranceEnded = true
            recognitionRequest?.endAudio()
            switch effectiveSttEngine {
            case .apple:
                finishRecognition(turn: id, fallbackURL: url)
            case .vietasr:
                submitFallback(url, turn: id)
            case .whisper:
                if whisperServer?.isRunning == true {
                    submitFallback(url, turn: id)
                } else {
                    finishRecognition(turn: id, fallbackURL: url)
                }
            }
        }
        if writer == nil && now.timeIntervalSince(lastOnset) >= 20 {
            print("TIBO_MIC vad_restart reason=no_onset")
            lastOnset = now
        }
    }

    private func startRecognition(_ id: Int, preRoll: [AVAudioPCMBuffer]) {
        latestPartial = ""
        finalTranscript = ""
        recognitionFailed = false
        utteranceEnded = false
        loggedFirstPartial = false
        recognitionStartedAt = Date()
        recognitionTask?.cancel()
        recognitionTask = nil
        recognitionRequest = nil
        guard speechAuthorized, let speechRecognizer, speechRecognizer.isAvailable else {
            recognitionFailed = true
            return
        }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.requiresOnDeviceRecognition = false
        var contextualStrings = [currentProfile.assistantName]
        contextualStrings += currentProfile.wakeWords
        contextualStrings += currentProfile.vocabulary.map(\.word)
        contextualStrings += ["OMP", "Claude Code", "Codex", "Eva", "agent", "review", "benchmark", "commit", "diff", "Safari", "GitHub"]
        request.contextualStrings = contextualStrings.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        recognitionRequest = request
        recognitionTask = speechRecognizer.recognitionTask(with: request) { [weak self] result, error in
            Task { @MainActor in
                guard let self, id == self.turnID, self.submittedTurnID != id else { return }
                if let result {
                    let text = result.bestTranscription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !text.isEmpty {
                        self.latestPartial = text
                        self.transcript = text
                        if !self.loggedFirstPartial {
                            self.loggedFirstPartial = true
                            let ms = Int(Date().timeIntervalSince(self.recognitionStartedAt) * 1000)
                            print("TIBO_LATENCY turn_id=\(id) stt_first_partial_ms=\(ms)")
                        }
                    }
                    if result.isFinal {
                        self.finalTranscript = text
                        if self.utteranceEnded {
                            self.finishRecognition(turn: id, fallbackURL: self.activeFallbackURL)
                        }
                    }
                }
                if error != nil {
                    self.recognitionFailed = self.latestPartial.isEmpty
                }
            }
        }
        for buffer in preRoll { request.append(buffer) }
    }



    private func finishRecognition(turn id: Int, fallbackURL: URL?) {
        guard id == turnID, submittedTurnID != id else { return }
        if !finalTranscript.isEmpty {
            submit(transcript: finalTranscript, turn: id, capturedURL: fallbackURL)
            return
        }
        if recognitionFailed || recognitionRequest == nil {
            guard let fallbackURL else { return }
            submitFallback(fallbackURL, turn: id)
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            guard let self, id == self.turnID, self.submittedTurnID != id else { return }
            let text = self.finalTranscript.isEmpty ? self.latestPartial : self.finalTranscript
            if !text.isEmpty {
                self.submit(transcript: text, turn: id, capturedURL: fallbackURL)
            } else if let fallbackURL {
                self.submitFallback(fallbackURL, turn: id)
            }
        }
    }

    private func convert(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        guard let converter else { return nil }
        let ratio = targetFormat.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 1
        guard let output = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: capacity) else { return nil }
        var supplied = false
        var error: NSError?
        converter.convert(to: output, error: &error) { _, status in
            if supplied { status.pointee = .noDataNow; return nil }
            supplied = true
            status.pointee = .haveData
            return buffer
        }
        return error == nil ? output : nil
    }

    private func rms(_ buffer: AVAudioPCMBuffer) -> Float {
        guard let channels = buffer.floatChannelData else { return -60 }
        let count = Int(buffer.frameLength)
        guard count > 0 else { return -60 }
        var sum: Float = 0
        for index in 0..<count { let value = channels[0][index]; sum += value * value }
        return max(-60, 20 * log10(sqrt(sum / Float(count)) + 0.000_001))
    }

    private func submit(transcript: String, turn id: Int, capturedURL: URL?) {
        submittedTurnID = id
        self.transcript = transcript
        recognitionTask?.cancel()
        recognitionTask = nil
        recognitionRequest = nil
        submit(arguments: ["--text", transcript, "--emit-text"], mode: "text", turn: id, capturedURL: capturedURL)
    }

    private func submitFallback(_ url: URL, turn id: Int) {
        submittedTurnID = id
        recognitionTask?.cancel()
        recognitionTask = nil
        recognitionRequest = nil
        summary = "Đang nhận dạng giọng nói…"
        submit(arguments: ["--voice", "--audio", url.path, "--emit-text"], mode: "voice", turn: id, capturedURL: url)
        state = .transcribing
    }

    private func submit(arguments baseArguments: [String], mode: String, turn id: Int, capturedURL: URL?) {
        backendRunning = true
        state = .processing
        summary = mode == "text" ? "Đang hiểu yêu cầu…" : summary
        nextAudioSequence = 0
        let process = Process()
        let output = Pipe()
        let error = Pipe()
        process.executableURL = Bundle.main.resourceURL?.appendingPathComponent("tibo")
        var arguments = baseArguments
        if interrupted { arguments.append("--interrupted") }
        if addressedTurn { arguments.append("--addressed") }
        if awake { arguments.append("--conversation") }
        if let prefixTranscript { arguments += ["--prefix-transcript", prefixTranscript] }
        process.arguments = arguments
        var environment = backendEnvironment()
        let defaults = UserDefaults.standard
        environment["TIBO_PROJECT_ROOT"] = defaults.string(forKey: "projectRoot")?.nilIfEmpty ?? FileManager.default.homeDirectoryForCurrentUser.path
        if environment["TYPESAFE_API_KEY"] == nil, let key = defaults.string(forKey: "typesafeApiKey")?.nilIfEmpty { environment["TYPESAFE_API_KEY"] = key }
        if environment["TIBO_WHISPER_URL"] == nil, whisperServer?.isRunning == true {
            environment["TIBO_WHISPER_URL"] = "http://127.0.0.1:\(whisperPort)/inference"
        }
        process.environment = environment
        process.standardOutput = output
        process.standardError = error
        let stdoutReader = LineReader { [weak self] line in
            DispatchQueue.main.async {
                guard let self, id == self.turnID else { return }
                self.parseBackendLine(line, turn: id)
            }
        }
        let stderrReader = LineReader { line in
            // STT stage timings go to stderr so `tibo --transcribe` stdout stays transcript-only.
            if line.hasPrefix("STAGE ") || line.hasPrefix("TIBO_STT ") || line.hasPrefix("TIBO_JEV ") {
                print("TIBO_BACKEND turn_id=\(id) \(line)")
            } else {
                print("TIBO_BACKEND stderr_received turn_id=\(id)")
            }
        }
        backendReaders = [stdoutReader, stderrReader]
        output.fileHandleForReading.readabilityHandler = { stdoutReader.feed($0.availableData) }
        error.fileHandleForReading.readabilityHandler = { stderrReader.feed($0.availableData) }
        process.terminationHandler = { [weak self] process in
            DispatchQueue.main.async {
                output.fileHandleForReading.readabilityHandler = nil
                error.fileHandleForReading.readabilityHandler = nil
                guard let self else { return }
                if id == self.turnID {
                    self.backendRunning = false
                    self.backendProcess = nil
                    self.backendReaders.removeAll()
                    self.interrupted = false
                    print("TIBO_BACKEND exit turn_id=\(id) status=\(process.terminationStatus)")
                    if self.state == .processing && self.agentProcess == nil { self.state = .listening }
                }
                if let capturedURL { try? FileManager.default.removeItem(at: capturedURL) }
            }
        }
        print("TIBO_BACKEND launch turn_id=\(id) mode=\(mode)")
        do {
            try process.run()
            backendProcess = process
        } catch {
            backendRunning = false
            state = .listening
            fail("Không mở được backend: \(error.localizedDescription)")
        }
    }

    private func parseBackendLine(_ line: String, turn id: Int) {
        // Any of these means Tibo took the turn (an ignored one prints none of them).
        if ["TIBO_TURN incomplete", "TIBO_NATIVE_ACTION ", "TIBO_ROUTE_RESULT ", "TIBO_SAY ", "TIBO_LLM_REQUEST ", "TIBO_SCREEN_REQUEST "].contains(where: line.hasPrefix) {
            keepAwake()
        }
        if line.hasPrefix("TRANSCRIPT: ") {
            transcript = String(line.dropFirst("TRANSCRIPT: ".count))
            print("TIBO_STT turn_id=\(id) text=\(transcript)")
            if state == .transcribing { state = .processing }
            if addressedTurn && transcript.isEmpty { fail("\(currentProfile.assistantName) chưa nghe rõ, thử lại nhé") }
        } else if line == "WAKE" {
            print("TIBO_BACKEND WAKE turn_id=\(id)")
            NotificationCenter.default.post(name: .tiboWakeHeard, object: nil)
        } else if line.hasPrefix("STAGE ") {
            print("TIBO_BACKEND turn_id=\(id) \(line)")
            if line.hasPrefix("STAGE intent_done_ms=") {
                print("TIBO_LATENCY turn_id=\(id) \(line.dropFirst("STAGE ".count))")
            }
        } else if line == "TIBO_TURN incomplete" {
            awaitingMore = true
            prefixTranscript = transcript
            summary = "Tôi đang nghe tiếp…"
            state = .listening
            if currentProfile.voiceMode != .wake { armed = true }
        } else if line.hasPrefix("TIBO_NATIVE_ACTION ") {
            let payload = line.dropFirst("TIBO_NATIVE_ACTION ".count)
            guard let action = try? JSONDecoder().decode(NativeAction.self, from: Data(payload.utf8)) else {
                print("TIBO_NATIVE_ACTION malformed JSON ignored")
                return
            }
            executeNativeAction(action, turn: id)
        } else if line.hasPrefix("TIBO_ROUTE_RESULT ") {
            let payload = line.dropFirst("TIBO_ROUTE_RESULT ".count)
            do {
                let result = try JSONDecoder().decode(RouteResult.self, from: Data(payload.utf8))
                summary = result.summary
                if result.command == "coding_task" { task = transcript }
                if result.command == "computer_use" { Self.ensureControlPermissions() }
                if result.status == "approval_required" {
                    state = .approval
                    awaitingMore = false
                    prefixTranscript = nil
                    stateAfterPlayback = .approval
                }
            } catch {
                print("TIBO_ROUTE_RESULT malformed JSON ignored")
            }
        } else if line.hasPrefix("TIBO_SAY ") {
            let payload = line.dropFirst("TIBO_SAY ".count)
            guard let text = try? JSONDecoder().decode(String.self, from: Data(payload.utf8)) else {
                print("TIBO_SAY malformed JSON ignored")
                return
            }
            if nativeActionFailedTurn == id { return }
            if nativeActionTurn == id {
                pendingNativeSay = text
                return
            }
            summary = text
            awaitingMore = false
            prefixTranscript = nil
            sendTts(text: text, final: true, turn: id)
        } else if line.hasPrefix("TIBO_LLM_REQUEST ") {
            let payload = line.dropFirst("TIBO_LLM_REQUEST ".count)
            guard let request = try? JSONDecoder().decode(LlmRequest.self, from: Data(payload.utf8)) else {
                print("TIBO_LLM_REQUEST malformed JSON ignored")
                return
            }
            startAgent(prompt: request.prompt, context: request.context, memoryTurn: (request.prompt, request.workflow.map { "workflow:\($0.id)" } ?? "conversation"), turn: id, workflow: request.workflow, conversational: true)
        } else if line.hasPrefix("TIBO_SCREEN_REQUEST ") {
            let payload = line.dropFirst("TIBO_SCREEN_REQUEST ".count)
            guard let request = try? JSONDecoder().decode(ScreenRequest.self, from: Data(payload.utf8)) else {
                print("TIBO_SCREEN_REQUEST malformed JSON ignored")
                return
            }
            readScreen(request, turn: id)
        }
    }

    /// The omp computer tool runs as Tibo's child, so macOS checks Tibo's own Screen Recording and
    /// Accessibility grants. Ask when a control task is proposed, before the user confirms it.
    private static func ensureControlPermissions() {
        if !CGPreflightScreenCaptureAccess() { CGRequestScreenCaptureAccess() }
        if !AXIsProcessTrusted() {
            AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue(): true] as CFDictionary)
        }
    }

    /// Read-only screen question: capture the main display, OCR it on device, then ask the current brain.
    /// Vision turns also attach the screenshot; nothing on screen is clicked or typed.
    private func readScreen(_ request: ScreenRequest, turn id: Int) {
        guard CGPreflightScreenCaptureAccess() else {
            CGRequestScreenCaptureAccess()
            fail("Cần quyền Ghi màn hình: bật Tibo trong Cài đặt hệ thống › Quyền riêng tư, rồi mở lại Tibo.")
            sendTts(text: "Tôi cần quyền ghi màn hình trước đã.", final: true, turn: id)
            state = .listening
            return
        }
        state = .processing
        summary = "Đang xem màn hình…"
        let app = NSWorkspace.shared.frontmostApplication
        let windowTitle = (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]])?
            .first { ($0[kCGWindowOwnerPID as String] as? pid_t) == app?.processIdentifier && ($0[kCGWindowLayer as String] as? Int) == 0 }?[kCGWindowName as String] as? String
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("tibo-screen-\(id).jpg")
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let lines = Self.captureAndRecognize(to: url)
            DispatchQueue.main.async {
                guard let self, id == self.turnID else { try? FileManager.default.removeItem(at: url); return }
                guard let lines else {
                    self.fail("Không chụp được màn hình.")
                    self.sendTts(text: self.summary, final: true, turn: id)
                    return
                }
                // ponytail: 6000-char OCR cap keeps the prompt small; long pages lose their tail.
                let text = String(lines.joined(separator: "\n").prefix(6000))
                var prompt = "Người dùng hỏi về màn hình hiện tại: \(request.question)\n"
                if let name = app?.localizedName { prompt += "Ứng dụng đang dùng: \(name)\(windowTitle.map { " — cửa sổ \"\($0)\"" } ?? "").\n" }
                prompt += "Chữ đọc được trên màn hình (OCR, có thể sai, từ trên xuống):\n\(text.isEmpty ? "(không có chữ)" : text)"
                if request.vision { prompt += "\nẢnh chụp màn hình được đính kèm." }
                print("TIBO_SCREEN turn_id=\(id) vision=\(request.vision) ocr_lines=\(lines.count)")
                self.startAgent(prompt: prompt, context: request.context, memoryTurn: (request.question, "read_screen"), turn: id, image: request.vision ? url : nil)
                if !request.vision { try? FileManager.default.removeItem(at: url) }
            }
        }
    }

    /// Main-display screenshot downscaled to 1600 px (JPEG at `url`) plus Vision OCR lines; nil if capture failed.
    nonisolated private static func captureAndRecognize(to url: URL) -> [String]? {
        let capture = Process()
        capture.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        capture.arguments = ["-x", "-m", "-t", "jpg", url.path]
        guard (try? capture.run()) != nil else { return nil }
        capture.waitUntilExit()
        guard capture.terminationStatus == 0,
              let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                  kCGImageSourceCreateThumbnailFromImageAlways: true,
                  kCGImageSourceThumbnailMaxPixelSize: 1600,
              ] as CFDictionary),
              let destination = CGImageDestinationCreateWithURL(url as CFURL, "public.jpeg" as CFString, 1, nil)
        else { return nil }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.8] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { return nil }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["vi-VT", "en-US"]
        try? VNImageRequestHandler(cgImage: image).perform([request])
        return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
    }

    private func executeNativeAction(_ action: NativeAction, turn id: Int) {
        let length = action.target.count
        guard action.action == "open_app",
              (1...80).contains(length),
              !action.target.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) })
        else {
            finishNativeAction(turn: id, target: action.target, error: "Tên ứng dụng không hợp lệ")
            return
        }
        nativeActionTurn = id
        nativeActionFailedTurn = nil
        pendingNativeSay = nil
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        process.arguments = ["-a", action.target]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        process.terminationHandler = { [weak self] process in
            DispatchQueue.main.async {
                self?.finishNativeAction(
                    turn: id,
                    target: action.target,
                    error: process.terminationStatus == 0 ? nil : "Không mở được \(action.target)."
                )
            }
        }
        do {
            try process.run()
        } catch {
            finishNativeAction(turn: id, target: action.target, error: "Không mở được \(action.target).")
        }
    }

    private func finishNativeAction(turn id: Int, target: String, error: String?) {
        guard id == turnID else { return }
        if let error {
            nativeActionTurn = nil
            nativeActionFailedTurn = id
            pendingNativeSay = nil
            summary = error
            sendTts(text: error, final: true, turn: id)
            return
        }
        nativeActionTurn = nil
        if let text = pendingNativeSay {
            pendingNativeSay = nil
            summary = text
            sendTts(text: text, final: true, turn: id)
        }
    }

    /// `image` is attached for vision turns (pi/omp `@file`, codex `-i`) and deleted when the agent exits.
    /// Claude Code runs with no tools here, so it only gets the OCR text already in `prompt`.
    /// A `workflow` turn is the one place the conversational agent may run commands (bash only).
    private func startAgent(prompt: String, context: String, memoryTurn: (user: String, route: String), turn id: Int, image: URL? = nil, workflow: LlmRequest.Workflow? = nil, conversational: Bool = false) {
        let agent = currentProfile.agent
        guard let executable = AgentCLI.resolve(agent) else {
            let text = "Chưa cài \(agent.title)."
            summary = text
            sendTts(text: text, final: true, turn: id)
            state = .listening
            return
        }
        // Screen turns carry untrusted screen text or images, so they stay one-shot without tools.
        if agent == .pi && conversational {
            runInConversation(prompt: prompt, context: context, memoryTurn: memoryTurn, turn: id, workflow: workflow, executable: executable)
            return
        }
        let process = Process()
        let output = Pipe()
        let error = Pipe()
        let base = workflow.map { "\(llmSystemPrompt(canAct: true))\n\n\($0.instructions)" } ?? llmSystemPrompt(canAct: false)
        let systemPrompt = context.isEmpty ? base : "\(base)\n\n\(context)"
        let tools = workflow != nil
        let attachment: [String] = image.map { ["@\($0.path)"] } ?? []
        process.executableURL = executable
        switch agent {
        case .claude:
            process.arguments = [
                "-p", prompt,
                "--output-format", "stream-json",
                "--verbose",
                "--include-partial-messages",
                "--setting-sources", "local",
                "--permission-mode", tools ? "default" : "plan",
                "--no-session-persistence",
                "--tools", tools ? "Bash" : "",
                "--system-prompt", systemPrompt
            ] + (tools ? ["--allowedTools", "Bash"] : [])
        case .omp:
            let toolArgs: [String] = tools ? ["--tools=bash", "--auto-approve"] : ["--no-tools"]
            process.arguments = ["-p", "--mode=json"] + toolArgs + ["--system-prompt=\(systemPrompt)"] + attachment + [prompt]
        case .pi:
            let model = currentProfile.agentModel.trimmingCharacters(in: .whitespacesAndNewlines)
            let toolArgs: [String] = tools ? ["--tools", "bash"] : ["--no-tools"]
            let modelArgs: [String] = model.isEmpty ? [] : ["--model", model]
            process.arguments = ["-p", "--mode", "json"] + toolArgs + ["--system-prompt", systemPrompt] + modelArgs + attachment + [prompt]
        case .codex:
            // Workflows drive Reminders/Calendar over Apple Events and reach the network, which the
            // read-only sandbox blocks; the workflow instructions are the guardrail on those turns.
            let sandbox: [String] = tools ? ["--dangerously-bypass-approvals-and-sandbox"] : ["--sandbox", "read-only"]
            let imageArgs: [String] = image.map { ["-i", $0.path] } ?? []
            process.arguments = ["exec", "--json", "--skip-git-repo-check", "--ephemeral"] + sandbox + imageArgs + ["\(systemPrompt)\n\n\(prompt)"]
        }
        process.environment = AgentCLI.environment()
        process.standardOutput = output
        process.standardError = error
        llmReceivedText = false
        llmFinalSent = false
        agentMemoryTurn = memoryTurn
        llmStartedAt = Date()
        summary = ""
        state = .processing
        let stdoutReader = LineReader { [weak self] line in
            DispatchQueue.main.async {
                guard let self, id == self.turnID else { return }
                switch agent {
                case .claude:
                    self.parseClaudeLine(line, turn: id)
                case .omp, .pi:
                    self.parseOmpLine(line, turn: id)
                case .codex:
                    self.parseCodexLine(line, turn: id)
                }
            }
        }
        var stderrReported = false
        let stderrReader = LineReader { line in
            guard !line.isEmpty, !stderrReported else { return }
            stderrReported = true
            print("TIBO_AGENT stderr turn_id=\(id) \(line)")
        }
        agentReaders = [stdoutReader, stderrReader]
        output.fileHandleForReading.readabilityHandler = { stdoutReader.feed($0.availableData) }
        error.fileHandleForReading.readabilityHandler = { stderrReader.feed($0.availableData) }
        process.terminationHandler = { [weak self] process in
            DispatchQueue.main.async {
                output.fileHandleForReading.readabilityHandler = nil
                error.fileHandleForReading.readabilityHandler = nil
                guard let self else { return }
                if let image { try? FileManager.default.removeItem(at: image) }
                if id == self.turnID {
                    self.finishAgent(turn: id, failed: process.terminationStatus != 0)
                    self.agentProcess = nil
                    self.agentReaders.removeAll()
                }
                print("TIBO_AGENT exit agent=\(agent.rawValue) turn_id=\(id) status=\(process.terminationStatus)")
            }
        }
        do {
            try process.run()
            agentProcess = process
            print("TIBO_AGENT launch agent=\(agent.rawValue) turn_id=\(id)")
        } catch {
            fail("Tôi chưa thể trả lời lúc này.")
            sendTts(text: summary, final: true, turn: id)
            state = .listening
        }
    }

    /// Chat and workflow turns for pi: one rpc session per conversation, started with bash and a
    /// system prompt that allows it only for workflow turns. The memory block goes in once, at the
    /// start; afterwards pi carries the conversation itself.
    private func runInConversation(prompt: String, context: String, memoryTurn: (user: String, route: String), turn id: Int, workflow: LlmRequest.Workflow?, executable: URL) {
        if !pi.isAlive {
            var system = llmSystemPrompt(canAct: true)
                + " Công cụ bash chỉ dùng cho các khối Quy trình: khi tin nhắn mở đầu bằng một khối Quy trình, hoặc khi người dùng hỏi tiếp việc của một quy trình đã có trong cuộc trò chuyện này (ví dụ hỏi thời tiết nơi khác, đổi giờ nhắc việc), thì chỉ dùng đúng các lệnh quy trình đó đã cho. Ngoài ra chỉ trò chuyện, không chạy lệnh và không tuyên bố đã thao tác trên máy."
            if !context.isEmpty { system += "\n\n\(context)" }
            let model = currentProfile.agentModel.trimmingCharacters(in: .whitespacesAndNewlines)
            do {
                try pi.start(executable: executable, arguments: ["--tools", "bash", "--system-prompt", system] + (model.isEmpty ? [] : ["--model", model]))
            } catch {
                fail("Tôi chưa thể trả lời lúc này.")
                sendTts(text: summary, final: true, turn: id)
                state = .listening
                return
            }
        }
        llmReceivedText = false
        llmFinalSent = false
        agentMemoryTurn = memoryTurn
        llmStartedAt = Date()
        summary = ""
        state = .processing
        pi.prompt(workflow.map { "\($0.instructions)\n\nNgười dùng nói: \(prompt)" } ?? prompt, turn: id)
    }

    private func handlePiEvent(_ line: String, turn id: Int) {
        guard id == turnID else { return }
        if line.contains("\"success\":false"),
           let object = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
           object["type"] as? String == "response", object["command"] as? String == "prompt" {
            print("TIBO_PI prompt_rejected \(object["error"] as? String ?? "")")
            finishAgent(turn: id, failed: true)
            return
        }
        parseOmpLine(line, turn: id)
    }

    /// Each handled turn restarts the 15-minute clock; when it runs out the conversation (and pi) ends.
    private func keepAwake() {
        awake = true
        conversationEnd?.cancel()
        let end = DispatchWorkItem { [weak self] in self?.endConversation() }
        conversationEnd = end
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.conversationLimit, execute: end)
    }

    private func endConversation() {
        guard !isResponding else { keepAwake(); return }
        print("TIBO_CONVERSATION end")
        awake = false
        conversationEnd = nil
        pi.stop()
    }

    /// `canAct` drops the "never claim you acted" rule for workflow turns, where the agent really runs commands.
    private func llmSystemPrompt(canAct: Bool) -> String {
        let assistant = currentProfile.assistantName.trimmingCharacters(in: .whitespacesAndNewlines)
        var prompt = "Bạn là \(assistant.isEmpty ? "Tibo" : assistant), trợ lý giọng nói trên macOS. Câu trả lời sẽ được đọc thành tiếng, nên hãy nói như đang trò chuyện: thật ngắn gọn, thường một câu, tối đa hai câu, đi thẳng vào ý chính. Dùng tiếng Việt tự nhiên, thân thiện; không Markdown, không gạch đầu dòng, không emoji, không rào đón, không nhắc lại câu hỏi. Kể cả khi được hỏi \"giải thích\" hay \"là gì\", chỉ nêu ý cốt lõi trong một hai câu; chỉ nói dài khi người dùng nói rõ muốn nghe chi tiết."
        if !canAct { prompt += " Không tuyên bố đã thao tác trên máy; thao tác được xử lý bởi nhánh computer-use riêng." }
        let user = currentProfile.userName.trimmingCharacters(in: .whitespacesAndNewlines)
        if !user.isEmpty { prompt += " Người dùng tên là \(user)." }
        return prompt
    }

    private func parseClaudeLine(_ line: String, turn id: Int) {
        guard
            let data = line.data(using: .utf8),
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let type = object["type"] as? String
        else { return }
        if type == "stream_event",
           let event = object["event"] as? [String: Any],
           event["type"] as? String == "content_block_delta",
           let delta = event["delta"] as? [String: Any],
           delta["type"] as? String == "text_delta",
           let text = delta["text"] as? String {
            emitAgentDelta(text, turn: id)
        } else if type == "result" {
            finishAgent(turn: id, failed: false)
        }
    }

    private func parseOmpLine(_ line: String, turn id: Int) {
        guard
            let data = line.data(using: .utf8),
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let type = object["type"] as? String
        else { return }
        if type == "message_update",
           let event = object["assistantMessageEvent"] as? [String: Any],
           event["type"] as? String == "text_delta",
           let text = event["delta"] as? String {
            emitAgentDelta(text, turn: id)
        } else if type == "agent_end" {
            finishAgent(turn: id, failed: false)
        }
    }

    private func parseCodexLine(_ line: String, turn id: Int) {
        guard
            let data = line.data(using: .utf8),
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            object["type"] as? String == "item.completed",
            let item = object["item"] as? [String: Any],
            item["type"] as? String == "agent_message",
            let text = item["text"] as? String
        else { return }
        emitAgentDelta(text, turn: id)
    }

    private func emitAgentDelta(_ text: String, turn id: Int) {
        guard id == turnID, !text.isEmpty else { return }
        if !llmReceivedText {
            llmReceivedText = true
            let ms = Int(Date().timeIntervalSince(llmStartedAt) * 1000)
            print("TIBO_LATENCY turn_id=\(id) llm_first_delta_ms=\(ms)")
        }
        summary += text
        sendTts(text: text, final: false, turn: id)
    }

    private func finishAgent(turn id: Int, failed: Bool) {
        guard id == turnID, !llmFinalSent else { return }
        llmFinalSent = true
        if llmReceivedText, let memoryTurn = agentMemoryTurn {
            logMemoryTurn(user: memoryTurn.user, tibo: summary, route: memoryTurn.route)
        }
        agentMemoryTurn = nil
        keepAwake()
        if !llmReceivedText && failed {
            fail("Tôi chưa thể trả lời lúc này.")
            sendTts(text: summary, final: true, turn: id)
        } else {
            sendTts(text: "", final: true, turn: id)
            if !llmReceivedText { state = .listening }
        }
    }

    /// The backend owns the memory files (format, redaction, the memory switch), so the app hands it
    /// the finished turn instead of writing the log itself.
    private func logMemoryTurn(user: String, tibo: String, route: String) {
        guard let executable = Bundle.main.resourceURL?.appendingPathComponent("tibo"),
              let data = try? JSONSerialization.data(withJSONObject: ["user": user, "tibo": tibo, "route": route]),
              let json = String(data: data, encoding: .utf8)
        else { return }
        let process = Process()
        process.executableURL = executable
        process.arguments = ["--log-turn", json]
        process.environment = backendEnvironment()
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do { try process.run() } catch { print("TIBO_MEMORY log_turn_failed \(error.localizedDescription)") }
    }

    private var effectiveSttEngine: Profile.SttEngine {
        guard let raw = ProcessInfo.processInfo.environment["TIBO_ASR_BACKEND"],
              let engine = Profile.SttEngine(rawValue: raw) else {
            return currentProfile.sttEngine
        }
        return engine
    }

    private func startTtsServer() {
        let process = Process()
        let input = Pipe()
        let output = Pipe()
        let error = Pipe()
        process.executableURL = Bundle.main.resourceURL?.appendingPathComponent("tibo")
        process.arguments = ["--tts-server"]
        process.standardInput = input
        process.standardOutput = output
        process.standardError = error
        process.environment = backendEnvironment()
        let stdoutReader = LineReader { [weak self] line in
            DispatchQueue.main.async { self?.parseTtsLine(line) }
        }
        let stderrReader = LineReader { line in print("TIBO_TTS stderr \(line)") }
        ttsReaders = [stdoutReader, stderrReader]
        output.fileHandleForReading.readabilityHandler = { stdoutReader.feed($0.availableData) }
        error.fileHandleForReading.readabilityHandler = { stderrReader.feed($0.availableData) }
        process.terminationHandler = { [weak self] process in
            DispatchQueue.main.async {
                guard let self, self.ttsProcess === process else { return }
                self.ttsProcess = nil
                self.ttsInput = nil
                self.fail("Kokoro không khả dụng")
            }
        }
        do {
            try process.run()
            ttsProcess = process
            ttsInput = input.fileHandleForWriting
            print("TIBO_TTS server_started")
        } catch {
            fail("Không mở được Kokoro: \(error.localizedDescription)")
        }
    }

    private func profileChanged(_ next: Profile) {
        let previous = currentProfile
        currentProfile = next
        transcript = "Nói “\(next.assistantName)” để bắt đầu"
        if next.voiceMode == .wake { armed = false }
        // The session's system prompt and model were fixed at start; the next turn starts a fresh one.
        if previous.agent != next.agent || previous.agentModel != next.agentModel
            || previous.assistantName != next.assistantName || previous.userName != next.userName {
            pi.stop()
        }
        if previous.ttsEngine != next.ttsEngine || previous.ttsVoice != next.ttsVoice {
            stopTtsServer()
            startTtsServer()
        }
        if previous.sttEngine != next.sttEngine || previous.whisperModel != next.whisperModel {
            stopWhisperServer()
            if effectiveSttEngine == .whisper { startWhisperServer() }
        }
    }

    private func backendEnvironment() -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        if environment["TIBO_TTS_ENGINE"] == nil { environment["TIBO_TTS_ENGINE"] = currentProfile.ttsEngine.rawValue }
        if environment["TIBO_TTS_VOICE"] == nil { environment["TIBO_TTS_VOICE"] = currentProfile.ttsVoice }
        if environment["TIBO_ASR_BACKEND"] == nil, effectiveSttEngine != .apple {
            environment["TIBO_ASR_BACKEND"] = effectiveSttEngine.rawValue
        }
        if environment["TIBO_WHISPER_MODEL"] == nil {
            environment["TIBO_WHISPER_MODEL"] = ProfileStore.modelsDir.appendingPathComponent(currentProfile.whisperModel).path
        }
        return environment
    }

    private func stopTtsServer() {
        ttsInput?.closeFile()
        ttsInput = nil
        ttsProcess?.terminate()
        ttsProcess = nil
        ttsReaders.removeAll()
    }

    private func stopWhisperServer() {
        whisperInput?.closeFile()
        whisperInput = nil
        whisperServer?.terminate()
        whisperServer = nil
    }

    /// Resident whisper-server keeps the model loaded: ~1.4 s per utterance vs ~3 s for a
    /// cold whisper-cli run. The backend posts to it via TIBO_WHISPER_URL.
    private func startWhisperServer() {
        guard effectiveSttEngine == .whisper else { return }
        let environment = ProcessInfo.processInfo.environment
        let server = environment["TIBO_WHISPER_SERVER"] ?? "/opt/homebrew/bin/whisper-server"
        let model = environment["TIBO_WHISPER_MODEL"]
            ?? ProfileStore.modelsDir.appendingPathComponent(currentProfile.whisperModel).path
        let process = Process()
        let input = Pipe()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        // Stdin EOF (Tibo quit or crashed) kills the server so the model never outlives the app;
        // `wait` makes this process exit when the server itself dies (bad model, port taken).
        // fd 3: sh gives background jobs /dev/null as stdin, so hand the pipe over explicitly.
        process.arguments = ["-c", "exec 3<&0; \"$0\" -m \"$1\" -l vi --host 127.0.0.1 --port \"$2\" >/dev/null 2>&1 & pid=$!; (cat <&3 >/dev/null; kill $pid 2>/dev/null) & wait $pid",
                             server, model, String(whisperPort)]
        process.standardInput = input
        process.terminationHandler = { [weak self] process in
            DispatchQueue.main.async {
                guard let self, self.whisperServer === process else { return }
                self.whisperServer = nil
                self.whisperInput = nil
                print("TIBO_STT whisper_server exited status=\(process.terminationStatus); Apple Speech only")
            }
        }
        do {
            try process.run()
            whisperServer = process
            whisperInput = input.fileHandleForWriting
            print("TIBO_STT whisper_server started port=\(whisperPort)")
        } catch {
            print("TIBO_STT whisper_server failed: \(error.localizedDescription)")
        }
    }

    private func cancelForeground(turn oldID: Int, markInterrupted: Bool) {
        backendProcess?.terminate()
        backendProcess = nil
        backendRunning = false
        agentProcess?.terminate()
        agentProcess = nil
        pi.abort()
        sendTtsCancel(turn: oldID)
        queuedAudio.values.forEach { try? FileManager.default.removeItem(at: $0) }
        queuedAudio.removeAll()
        if let playingURL { try? FileManager.default.removeItem(at: playingURL) }
        playingURL = nil
        if player?.isPlaying == true { playbackEnded = Date() }
        player?.stop()
        player = nil
        nextAudioSequence = 0
        ttsResponsePending = false
        showAnswer = false
        nativeActionTurn = nil
        nativeActionFailedTurn = nil
        pendingNativeSay = nil
        if markInterrupted {
            let ms = Int(Date().timeIntervalSince(turnStartedAt) * 1000)
            print("TIBO_LATENCY turn_id=\(oldID) barge_in_cancel_ms=\(ms)")
        }
    }

    private func sendTtsCancel(turn id: Int) {
        guard let ttsInput else { return }
        let message: [String: Any] = ["type": "cancel", "turn_id": id]
        guard var data = try? JSONSerialization.data(withJSONObject: message) else { return }
        data.append(0x0A)
        try? ttsInput.write(contentsOf: data)
    }

    private func sendTts(text: String, final: Bool, turn id: Int) {
        guard speaksThisTurn else {
            if final {
                revealAnswer()
                if state != .approval { state = stateAfterPlayback }
            }
            return
        }
        guard let ttsInput else {
            fail("Kokoro không khả dụng")
            return
        }
        let message: [String: Any] = ["type": "delta", "turn_id": id, "text": text, "final": final]
        ttsResponsePending = true
        guard var data = try? JSONSerialization.data(withJSONObject: message) else { return }
        data.append(0x0A)
        do {
            try ttsInput.write(contentsOf: data)
        } catch {
            fail("Kokoro không khả dụng")
        }
    }

    private func parseTtsLine(_ line: String) {
        if line.hasPrefix("TIBO_TTS_WAV ") {
            let payload = line.dropFirst("TIBO_TTS_WAV ".count)
            guard let event = try? JSONDecoder().decode(TtsWavEvent.self, from: Data(payload.utf8)) else {
                print("TIBO_TTS_WAV malformed JSON ignored")
                return
            }
            let url = URL(fileURLWithPath: event.path)
            guard event.turnID == turnID else {
                try? FileManager.default.removeItem(at: url)
                return
            }
            if !loggedFirstAudio {
                loggedFirstAudio = true
                let ms = Int(Date().timeIntervalSince(turnStartedAt) * 1000)
                print("TIBO_LATENCY turn_id=\(event.turnID) tts_first_audio_ms=\(ms)")
            }
            queuedAudio[event.sequence] = url
            playNext()
        } else if line.hasPrefix("TIBO_TTS_ERROR ") {
            let payload = line.dropFirst("TIBO_TTS_ERROR ".count)
            guard let event = try? JSONDecoder().decode(TtsErrorEvent.self, from: Data(payload.utf8)), event.turnID == turnID else { return }
            fail("Không tổng hợp được giọng nói: \(event.message)")
            state = .listening
            ttsResponsePending = false
        }
    }

    private func playNext() {
        guard player == nil, let url = queuedAudio.removeValue(forKey: nextAudioSequence) else { return }
        do {
            player = try AVAudioPlayer(contentsOf: url)
            playingURL = url
            player?.delegate = self
            state = .speaking
            player?.play()
        } catch {
            try? FileManager.default.removeItem(at: url)
            nextAudioSequence += 1
            fail("Không phát được phản hồi")
            playNext()
        }
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor [weak self] in
            guard let self, self.player === player else { return }
            if let playingURL = self.playingURL { try? FileManager.default.removeItem(at: playingURL) }
            self.playingURL = nil
            self.player = nil
            self.playbackEnded = Date()
            self.nextAudioSequence += 1
            if self.queuedAudio[self.nextAudioSequence] != nil {
                self.playNext()
            } else {
                let id = self.turnID
                self.state = self.stateAfterPlayback
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
                    guard let self, self.turnID == id, self.player == nil, self.queuedAudio.isEmpty else { return }
                    self.ttsResponsePending = false
                }
            }
        }
    }

    private func loadTask() {
        let url = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".local/share/tibo/session.json")
        guard let data = try? Data(contentsOf: url), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any], object["active"] as? Bool == true else { return }
        task = object["task"] as? String ?? ""
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}

/// Taby-style drop-down: a pill hugging the notch/menu bar that expands on hover, on ⌃⌥Space,
/// or while Tibo is busy, and tucks away when the pointer leaves and the panel is not key.
private final class NotchPanel: NSPanel {
    override var canBecomeKey: Bool { true }
}

@MainActor
private final class NotchController: ObservableObject {
    /// Window size: room for the tallest expanded state plus the settings window. The visible notch is drawn inside it.
    static let panelSize = NSSize(width: 440, height: 440)
    static let expandedWidth: CGFloat = 300
    @Published private(set) var expanded = false
    @Published private(set) var typing = false
    @Published private(set) var barHeight: CGFloat = 32
    @Published private(set) var pillWidth: CGFloat = 280
    @Published private(set) var position: Profile.NotchPosition = .center
    let store: ProfileStore
    let voice: VoiceController
    private let panel = NotchPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    private var lastActive = Date.distantPast
    private var hoverSince: Date?
    private var hotRect = NSRect.zero
    private var zoneWindow: NSWindow?
    private var observers: Set<AnyCancellable> = []
    private static let browsers: Set<String> = [
        "com.apple.Safari", "com.google.Chrome", "org.mozilla.firefox", "com.microsoft.edgemac",
        "company.thebrowser.Browser", "com.brave.Browser", "com.operasoftware.Opera", "com.vivaldi.Vivaldi", "app.zen-browser.zen",
    ]
    private var timer: Timer?
    private var hotKey: EventHotKeyRef?

    init(store: ProfileStore) {
        self.store = store
        voice = VoiceController(store: store)
        panel.level = .statusBar
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.ignoresMouseEvents = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.contentView = NSHostingView(rootView: ContentView(voice: voice, notch: self))
        tick()
        panel.orderFrontRegardless()
        // ponytail: 10 Hz pointer poll instead of global mouse monitors; no Accessibility permission needed.
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        registerHotKey()
        NotificationCenter.default.publisher(for: .tiboShowHoverZone).sink { [weak self] _ in self?.flashHoverZone() }.store(in: &observers)
    }

    func toggle() {
        if expanded && panel.isKeyWindow { collapse(); return }
        setExpanded(true)
        panel.makeKeyAndOrderFront(nil)
    }

    func collapse() {
        panel.orderOut(nil) // drops key status so the auto-hide rule applies again
        panel.orderFrontRegardless()
        lastActive = .distantPast
        setExpanded(false)
    }

    private func setExpanded(_ value: Bool) {
        guard expanded != value else { return }
        lastActive = Date()
        expanded = value
        panel.ignoresMouseEvents = !value
        print("TIBO_UI expanded=\(value) state=\(voice.state) key=\(panel.isKeyWindow)")
    }

    private func tick() {
        let screen = NSScreen.main ?? NSScreen.screens[0]
        let profile = store.profile
        let bar = max(24, screen.safeAreaInsets.top, screen.frame.maxY - screen.visibleFrame.maxY)
        var notch: CGFloat = 170
        if let left = screen.auxiliaryTopLeftArea, let right = screen.auxiliaryTopRightArea {
            notch = screen.frame.width - left.width - right.width
        }
        // Off-centre there is no hardware notch to hug, so the pill only needs room for the face.
        let pill = profile.notchPosition == .center ? notch + 80 : 100
        if barHeight != bar { barHeight = bar }
        if pillWidth != pill { pillWidth = pill }
        if position != profile.notchPosition { position = profile.notchPosition }
        if typing != panel.isKeyWindow { typing = panel.isKeyWindow }
        let top = screen.frame
        let size = Self.panelSize
        let frame = NSRect(x: x(width: size.width, in: top), y: top.maxY - size.height, width: size.width, height: size.height)
        if panel.frame != frame { panel.setFrame(frame, display: true) }

        let inputRow = typing || voice.inputError != nil || voice.voiceMode != .wake
        let visible = expanded ? NSSize(width: Self.expandedWidth, height: barHeight + (typing ? 296 : inputRow ? 206 : 156)) : NSSize(width: pillWidth, height: barHeight)
        let margin = CGFloat(profile.hoverMargin)
        hotRect = NSRect(x: x(width: visible.width, in: top), y: top.maxY - visible.height, width: visible.width, height: visible.height).insetBy(dx: -margin, dy: -margin)
        let hovering = hotRect.contains(NSEvent.mouseLocation)
        if hovering { hoverSince = hoverSince ?? Date() } else { hoverSince = nil }
        let busy = voice.state == .processing || voice.state == .speaking || voice.state == .approval || voice.engaged
        if hovering || busy || panel.isKeyWindow { lastActive = Date() }
        if !expanded && (busy || (hoverSince.map { Date().timeIntervalSince($0) >= openDelay(screen) } ?? false)) {
            setExpanded(true)
            if hovering && !busy { NotificationCenter.default.post(name: .tiboNotchOpened, object: nil) }
        } else if expanded && Date().timeIntervalSince(lastActive) > profile.collapseDelay {
            setExpanded(false)
        }
    }

    /// Panel/pill origin for the chosen position; side positions keep a small gap from the screen edge.
    private func x(width: CGFloat, in top: NSRect) -> CGFloat {
        switch position {
        case .left: top.minX + 8
        case .center: top.midX - width / 2
        case .right: top.maxX - width - 8
        }
    }

    /// Hover delay so passing the pointer through the menu bar does not pop the notch in apps where the top edge is busy.
    private func openDelay(_ screen: NSScreen) -> TimeInterval {
        guard store.profile.notchOpen == .everyday, let app = NSWorkspace.shared.frontmostApplication else { return 0 }
        // ponytail: hidden menu bar ≈ full-screen app; also true with "auto-hide menu bar" on, which then always waits 0.8 s.
        if screen.visibleFrame.maxY >= screen.frame.maxY - 1 { return 0.8 }
        if let url = app.bundleURL, (Bundle(url: url)?.infoDictionary?["LSApplicationCategoryType"] as? String)?.hasSuffix("games") == true { return 0.8 }
        if let id = app.bundleIdentifier, Self.browsers.contains(id) { return 0.5 }
        return 0
    }

    private func flashHoverZone() {
        zoneWindow?.orderOut(nil)
        let window = NSWindow(contentRect: hotRect, styleMask: .borderless, backing: .buffered, defer: false)
        window.level = .screenSaver
        window.isOpaque = false
        window.backgroundColor = NSColor.systemPink.withAlphaComponent(0.4)
        window.ignoresMouseEvents = true
        window.isReleasedWhenClosed = false
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        window.orderFrontRegardless()
        zoneWindow = window
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
            if self?.zoneWindow === window { window.orderOut(nil); self?.zoneWindow = nil }
        }
    }

    private func registerHotKey() {
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, _, context in
            guard let context else { return noErr }
            let notch = Unmanaged<NotchController>.fromOpaque(context).takeUnretainedValue()
            MainActor.assumeIsolated { notch.toggle() }
            return noErr
        }, 1, &spec, Unmanaged.passUnretained(self).toOpaque(), nil)
        let id = EventHotKeyID(signature: 0x4752_5A56, id: 1) // "GRZV"
        let status = RegisterEventHotKey(UInt32(kVK_Space), UInt32(controlKey | optionKey), id, GetApplicationEventTarget(), 0, &hotKey)
        if status != noErr { print("TIBO_UI hotkey_register_failed status=\(status)") }
    }
}

/// Rounded bottom corners only; the top edge sits flush against the screen edge like the notch.
private struct NotchShape: Shape {
    var radius: CGFloat
    var animatableData: CGFloat {
        get { radius }
        set { radius = newValue }
    }

    func path(in rect: CGRect) -> Path {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
            .path(in: rect.insetBy(dx: 0, dy: -radius).offsetBy(dx: 0, dy: -radius))
    }
}

private struct ContentView: View {
    @ObservedObject var voice: VoiceController
    @ObservedObject var notch: NotchController
    @State private var draft = ""
    @FocusState private var inputFocused: Bool
    @State private var reaction: BuddyFace.Mood?
    @State private var reactionID = 0

    var body: some View {
        let shape = NotchShape(radius: notch.expanded ? 24 : 10)
        ZStack(alignment: .top) {
            if notch.expanded { expandedView.transition(.opacity) } else { collapsedView.transition(.opacity) }
        }
        .frame(width: notch.expanded ? NotchController.expandedWidth : notch.pillWidth, alignment: .top)
        .background(.black, in: shape)
        .clipShape(shape)
        .contextMenu {
            Button(voice.micEnabled ? "Tắt microphone" : "Bật microphone", action: voice.toggleMicrophone)
            Button("Ngắt giọng nói", action: voice.stopPlayback)
            Button("Cài đặt…") {
                notch.collapse()
                TiboWindows.showSettings(store: notch.store)
            }
            Divider()
            Button("Thoát Tibo") { NSApp.terminate(nil) }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: notch.position == .left ? .topLeading : notch.position == .right ? .topTrailing : .top)
        .environment(\.colorScheme, .dark)
        .animation(.spring(response: 0.38, dampingFraction: 0.8), value: notch.expanded)
        .animation(.spring(response: 0.3, dampingFraction: 0.85), value: notch.typing)
        .animation(.easeInOut(duration: 0.2), value: caption)
        .onChange(of: notch.typing) { _, typing in inputFocused = typing }
        .onChange(of: voice.state) { old, new in
            if old == .speaking && new != .speaking { react(.happy, for: 2.2) }
        }
        .onChange(of: notch.expanded) { _, expanded in
            if expanded && voice.state == .listening { react(.surprised, for: 2.6) }
        }
    }

    private var collapsedView: some View {
        HStack(spacing: 0) {
            BuddyFace(mood: mood, level: level).frame(width: notch.barHeight * 0.9, height: notch.barHeight * 0.56)
            Spacer(minLength: 0)
        }
        .padding(.leading, 4)
        .frame(height: notch.barHeight)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Tibo: \(voice.state.rawValue)")
    }

    private var expandedView: some View {
        VStack(spacing: 6) {
            BuddyFace(mood: mood, level: level)
                .frame(width: 190, height: 100)
                .accessibilityElement()
                .accessibilityLabel("Tibo: \(voice.state.rawValue)")
            if let caption {
                Text(caption)
                    .font(.system(size: 13, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.72))
                    .multilineTextAlignment(.center)
                    .lineLimit(voice.showAnswer ? 4 : 2)
                    .padding(.horizontal, 20)
                    .transition(.opacity)
            }
            if showsInput {
                inputRow
                    .padding(.horizontal, 16)
                    .transition(.move(edge: .top).combined(with: .opacity))
                ForEach(matches, id: \.name) { command in
                    Button { run(command) } label: {
                        HStack {
                            Text(command.name).font(.system(size: 12, design: .monospaced)).foregroundStyle(.white.opacity(0.5))
                            Text(command.label).foregroundStyle(.white)
                            Spacer()
                        }.contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .padding(.horizontal, 26)
                }
            }
        }
        .padding(.top, notch.barHeight)
        .padding(.bottom, 12)
        .onExitCommand { notch.collapse() }
    }

    private var showsInput: Bool { notch.typing || voice.inputError != nil || voice.voiceMode != .wake }

    /// Status line under the face: live listening hints first, then spoken/unspoken answers.
    private var caption: String? {
        if voice.capturing && voice.addressedTurn {
            return voice.voiceMode == .startStop ? "Đang nghe… bấm mic để gửi" : "Đang nghe… ngừng nói để gửi"
        }
        if voice.armed { return "Mời bạn nói…" }
        if voice.state == .transcribing && voice.addressedTurn { return voice.state.rawValue }
        if (voice.state == .speaking || voice.state == .approval || voice.showAnswer) && !voice.summary.isEmpty { return voice.summary }
        return nil
    }

    private var inputRow: some View {
        HStack(spacing: 8) {
            TextField("", text: $draft, prompt: Text(voice.inputError ?? "Hỏi \(notch.store.profile.assistantName) hoặc gõ /")
                .foregroundStyle(voice.inputError == nil ? Color.white.opacity(0.4) : Color.red.opacity(0.85)))
                .textFieldStyle(.plain)
                .font(.system(size: 14, design: .rounded))
                .foregroundStyle(.white)
                .focused($inputFocused)
                .onSubmit {
                    if let command = matches.first { run(command); return }
                    voice.submitTyped(draft)
                    draft = ""
                }
                .accessibilityLabel(voice.inputError.map { "Lỗi: \($0). Nhập yêu cầu" } ?? "Nhập yêu cầu")
            Button { draft = "/" ; inputFocused = true } label: { Image(systemName: "square.grid.2x2") }
                .buttonStyle(.plain).foregroundStyle(.white.opacity(0.6))
                .accessibilityLabel("Lệnh nhanh")
            if voice.voiceMode != .wake {
                Button(action: voice.tapMic) {
                    Image(systemName: voice.capturing ? "stop.circle.fill" : "mic.circle.fill")
                        .font(.system(size: 20))
                        .foregroundStyle(voice.capturing || voice.armed ? Color.red : Color.white.opacity(0.8))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(voice.capturing ? "Gửi" : voice.armed ? "Huỷ nghe" : "Nói")
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(.white.opacity(0.1), in: Capsule())
    }

    private struct SlashCommand {
        let name: String
        let label: String
        let run: @MainActor () -> Void
    }

    private var commands: [SlashCommand] {
        let store = notch.store
        return [
            SlashCommand(name: "/caidat", label: "Mở Cài đặt") { notch.collapse(); TiboWindows.showSettings(store: store) },
            SlashCommand(name: "/mic", label: voice.micEnabled ? "Tắt microphone" : "Bật microphone") { voice.toggleMicrophone() },
            SlashCommand(name: "/dung", label: "Ngắt câu đang nói") { voice.stopPlayback() },
            SlashCommand(name: "/giong", label: store.profile.speakReplies ? "Tắt giọng trả lời" : "Bật giọng trả lời") {
                var profile = store.profile
                profile.speakReplies.toggle()
                store.save(profile)
            },
            SlashCommand(name: "/thoat", label: "Thoát") { NSApp.terminate(nil) },
        ]
    }

    private var matches: [SlashCommand] {
        let typed = draft.trimmingCharacters(in: .whitespaces).lowercased()
        guard typed.hasPrefix("/") else { return [] }
        return commands.filter { $0.name.hasPrefix(typed) }
    }

    private func run(_ command: SlashCommand) {
        draft = ""
        command.run()
    }

    private var level: CGFloat { max(0, min(1, CGFloat((voice.power + 60) / 60))) }

    private var mood: BuddyFace.Mood {
        if let reaction { return reaction }
        switch voice.state {
        case .listening: return voice.awake ? .idle : .sleeping
        case .processing, .transcribing: return .thinking
        case .speaking: return .talking
        case .approval: return .asking
        case .stopped: return .sleeping
        }
    }

    private func react(_ mood: BuddyFace.Mood, for seconds: TimeInterval) {
        reactionID += 1
        let id = reactionID
        reaction = mood
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) {
            if reactionID == id { reaction = nil }
        }
    }
}

/// Taby's face from the firmware-taby 1.64 pack (TRIIIS-LABS/firmware-taby@3681c7f, bundled in
/// Resources/taby). The artwork stays Taby's under the Taby Artwork Terms in Resources/taby/LICENSE.
struct BuddyFace: View {
    enum Mood: Equatable { case idle, thinking, talking, asking, sleeping, happy, surprised }
    let mood: Mood
    let level: CGFloat
    @State private var player = FacePlayer()

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 20)) { context in
            Canvas { ctx, size in
                guard let frame = player.frame(mood: mood, level: level, at: context.date.timeIntervalSinceReferenceDate) else { return }
                // Frames are 280×456 with the face turned clockwise for the portrait panel: turn it back, aspect-fit.
                let scale = min(size.width / CGFloat(frame.height), size.height / CGFloat(frame.width))
                let w = CGFloat(frame.width) * scale, h = CGFloat(frame.height) * scale
                ctx.translateBy(x: size.width / 2, y: size.height / 2)
                ctx.rotate(by: .degrees(-90))
                ctx.draw(Image(decorative: frame, scale: 1), in: CGRect(x: -w / 2, y: -h / 2, width: w, height: h))
            }
        }
    }
}

/// Picks the clip sequence for a mood and plays it: intros once, a trailing `_loop` clip loops,
/// any other trailing clip holds its last frame. Idle turns attentive while the mic hears a voice
/// and now and then plays an ambient antic.
private final class FacePlayer {
    private static let tracks: [BuddyFace.Mood: [String]] = [
        .idle: ["idle_01_loop"],
        .thinking: ["claude_in", "claude_loop"],
        .talking: ["talking_default_loop"],
        .asking: ["taby_response_ready_in", "taby_response_ready_loop"],
        .sleeping: ["sleeping_loop"],
        .happy: ["confirmation"],
        .surprised: ["wow"],
    ]
    private static let antics = [
        "idle_02_loop", "idle_variation_loop", "blush", "stretching", "drink_water", "posture_check",
        "flower_grow", "fishing_short", "fishing_long", "basketball_throw", "basketball_dunk", "boxing",
        "love_01", "relaxing_01_loop", "listening_music_loop", "f1_car", "yeah", "thumbs_up",
    ]
    private var track: [String] = []
    private var startedAt = 0.0
    private var heardAt = -Double.infinity
    private var antic: (id: String, until: Double)?
    private var nextAnticAt: Double?

    func frame(mood: BuddyFace.Mood, level: CGFloat, at t: Double) -> CGImage? {
        let next = pick(mood: mood, level: level, at: t)
        if next != track { track = next; startedAt = t }
        var elapsed = t - startedAt
        for (index, id) in track.enumerated() {
            guard let clip = FaceClip.named(id) else { return nil }
            if index < track.count - 1 {
                if elapsed < clip.duration { return clip.frame(at: elapsed) }
                elapsed -= clip.duration
            } else {
                return clip.frame(at: id.hasSuffix("_loop") ? elapsed.truncatingRemainder(dividingBy: clip.duration) : elapsed)
            }
        }
        return nil
    }

    private func pick(mood: BuddyFace.Mood, level: CGFloat, at t: Double) -> [String] {
        if mood == .idle && level > 0.5 { heardAt = t }
        guard mood == .idle, t - heardAt > 1.5 else {
            antic = nil
            nextAnticAt = nil
            return mood == .idle ? ["listening_in", "listening_loop"] : Self.tracks[mood, default: []]
        }
        if let antic, t < antic.until { return [antic.id] }
        antic = nil
        guard let due = nextAnticAt else {
            nextAnticAt = t + .random(in: 45...120)
            return ["idle_01_loop"]
        }
        if t >= due, let id = Self.antics.randomElement(), let clip = FaceClip.named(id) {
            antic = (id, t + clip.duration)
            nextAnticAt = nil
            return [id]
        }
        return ["idle_01_loop"]
    }
}

/// One bundled GIF, decoded a frame at a time: a fully decoded idle loop would be ~90 MB.
private final class FaceClip {
    private static var cache: [String: FaceClip] = [:]
    let duration: Double
    private let source: CGImageSource
    private let ends: [Double]

    private init(source: CGImageSource, ends: [Double]) {
        self.source = source
        self.ends = ends
        duration = ends.last ?? 0
    }

    static func named(_ id: String) -> FaceClip? {
        if let clip = cache[id] { return clip }
        guard let url = Bundle.main.url(forResource: id, withExtension: "gif", subdirectory: "taby"),
              let source = CGImageSourceCreateWithURL(url as CFURL, nil), CGImageSourceGetCount(source) > 0 else {
            print("TIBO_UI face_clip_missing id=\(id)")
            return nil
        }
        var t = 0.0
        let ends = (0..<CGImageSourceGetCount(source)).map { index -> Double in
            let props = CGImageSourceCopyPropertiesAtIndex(source, index, nil) as? [CFString: Any]
            let gif = props?[kCGImagePropertyGIFDictionary] as? [CFString: Any]
            let delay = gif?[kCGImagePropertyGIFUnclampedDelayTime] as? Double ?? 0
            t += delay > 0.01 ? delay : 0.05
            return t
        }
        let clip = FaceClip(source: source, ends: ends)
        cache[id] = clip
        return clip
    }

    func frame(at elapsed: Double) -> CGImage? {
        CGImageSourceCreateImageAtIndex(source, ends.firstIndex { $0 > elapsed } ?? ends.count - 1, nil)
    }
}

@MainActor
private final class AppDelegate: NSObject, NSApplicationDelegate {
    private let store = ProfileStore()
    private var notch: NotchController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // pi's rpc stdin is written from here; if pi dies mid-write, fail the write instead of dying.
        signal(SIGPIPE, SIG_IGN)
        // Two instances hear each other's TTS and answer every question twice; the running one wins.
        let me = NSRunningApplication.current
        if NSRunningApplication.runningApplications(withBundleIdentifier: Bundle.main.bundleIdentifier ?? "")
            .contains(where: { $0.processIdentifier != me.processIdentifier && !$0.isTerminated }) {
            print("TIBO_UI already_running; exiting")
            NSApp.terminate(nil)
            return
        }
        NSApp.setActivationPolicy(.accessory)
        if store.profile.onboarded {
            notch = NotchController(store: store)
        } else {
            TiboWindows.showOnboarding(store: store, startNotch: { [weak self] in self?.startNotch() }, onFinish: { [weak self] in self?.startNotch() })
        }
    }

    private func startNotch() {
        if notch == nil { notch = NotchController(store: store) }
        }
    }

@main
struct TiboApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    var body: some Scene { Settings { EmptyView() } }
}
