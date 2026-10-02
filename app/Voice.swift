@preconcurrency import AVFoundation
import AppKit
import Combine
import SoundAnalysis
import Speech

// Optional voice channel: microphone, transcription and spoken replies. The agent and notch never
// depend on it; servers start only after the user enables the microphone.

enum VoiceState: String {
    case listening = "Đang nghe"
    case processing = "Đang xử lý"
    case transcribing = "Đang chuyển thành chữ…"
    case speaking = "Đang nói"
    case approval = "Chờ xác nhận"
    case stopped = "Đã tắt mic"
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
final class VoiceController: NSObject, ObservableObject, AVAudioPlayerDelegate {
    @Published var state: VoiceState = .listening
    @Published private(set) var progress = ""
    /// A loud sound (> -30 dBFS) within the last 1.5 s; the idle face turns attentive. Published only on
    /// change: the mic delivers ~47 buffers/s and every publish re-renders the whole notch.
    @Published private(set) var hearing = false
    private var lastLoudAt = Date.distantPast
    /// A mic-button turn (smart / start-stop mode) is waiting for speech.
    @Published private(set) var armed = false
    /// Recording an utterance right now.
    @Published private(set) var capturing = false
    /// A mic button or approval button addresses the turn without a wake word.
    @Published private(set) var addressedTurn = false
    /// Visible error beneath the face, also announced to assistive technology.
    @Published private(set) var inputError: String?
    /// Replies that were not spoken stay on screen for a while.
    @Published private(set) var showAnswer = false
    private var endRequested = false
    private var observers: Set<AnyCancellable> = []

    private let store: ProfileStore
    private let agent: AgentController
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
    private var lastMeterLog = Date.distantPast
    private var lastOnset = Date()
    private var lastSustainedOnset = Date.distantPast
    private var speechGate: SpeechGate?
    private var lastSpeechAt = Date.distantPast
    private var player: AVAudioPlayer?
    private var playbackEnded = Date.distantPast
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
    private var fallbackSubmittedID: Int?
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
    private var turnStartedAt = Date.distantPast
    private var loggedFirstAudio = false
    private var ttsResponsePending = false
    private var replyTurnActive = false
    private var stateAfterPlayback: VoiceState = .listening
    private var whisperServer: Process?
    private var whisperInput: FileHandle?
    private let whisperPort = 8177

    @Published var micEnabled = false

    init(store: ProfileStore, agent: AgentController) {
        self.store = store
        self.agent = agent
        self.currentProfile = store.profile
        super.init()
        micEnabled = currentProfile.microphoneEnabled
        // Text chat must not start native voice servers. They start only after the user enables mic.
        profileSubscription = store.$profile.sink { [weak self] profile in self?.profileChanged(profile) }
        NotificationCenter.default.publisher(for: .tiboModelReady).sink { [weak self] _ in
            guard let self, self.effectiveSttEngine == .whisper, self.micEnabled else { return }
            self.stopWhisperServer()
            self.startWhisperServer()
        }.store(in: &observers)
        agent.onAssistantText = { [weak self] text, final in
            guard let self else { return }
            if final && text.isEmpty { self.stopPlayback(); self.replyTurnActive = false; return }
            let first = !self.replyTurnActive
            if first && !text.isEmpty {
                self.stopPlayback()
                self.turnID += 1
                self.turnStartedAt = Date()
                self.loggedFirstAudio = false
                self.replyTurnActive = true
            }
            self.sendTts(text: final && !first ? "" : text, final: final, turn: self.turnID)
            if final { self.replyTurnActive = false; self.state = self.micEnabled ? .listening : .stopped }
        }
        if micEnabled { requestPermissions() }
    }

    var voiceMode: Profile.VoiceMode { currentProfile.voiceMode }

    /// Mic button for smart / start-stop modes: first tap arms one turn, a tap while recording sends it.
    func tapMic() {
        if !micEnabled { toggleMicrophone(); return }
        if writer != nil { endRequested = true; return }
        if player?.isPlaying == true || !queuedAudio.isEmpty { stopPlayback() }
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
            if !engine.isRunning { requestPermissions() }
        } else {
            stopVoice()
            state = .stopped
        }
    }

    /// Mic off: stop capture and the voice servers (whisper-server alone holds ~600 MB); mic on restarts them.
    private func stopVoice() {
        engine.stop()
        recognitionTask?.cancel()
        recognitionTask = nil
        recognitionRequest = nil
        writer = nil
        capturing = false
        hearing = false
        stopTtsServer()
        stopWhisperServer()
    }

    /// Stops only spoken audio. Agent work continues and remains in the transcript.
    func stopPlayback() {
        sendTtsCancel(turn: turnID)
        queuedAudio.values.forEach { try? FileManager.default.removeItem(at: $0) }
        queuedAudio.removeAll()
        nextAudioSequence = 0
        if let playingURL { try? FileManager.default.removeItem(at: playingURL) }
        playingURL = nil
        player?.stop()
        player = nil
        ttsResponsePending = false
        state = micEnabled ? .listening : .stopped
    }

    private func fail(_ message: String) {
        inputError = message
        let id = turnID
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
            if self?.turnID == id, self?.inputError == message { self?.inputError = nil }
        }
    }

    private func revealAnswer() {
        showAnswer = true
        let id = turnID
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in
            if self?.turnID == id { self?.showAnswer = false }
        }
    }


    private var isResponding: Bool {
        backendProcess?.isRunning == true
            || agent.state == .running
            || agent.state == .waitingApproval
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
                        if self.ttsProcess == nil { self.startTtsServer() }
                        if self.effectiveSttEngine == .whisper && self.whisperServer == nil { self.startWhisperServer() }
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
        let now = Date()
        if db > -30 { lastLoudAt = now }
        if (now.timeIntervalSince(lastLoudAt) < 1.5) != hearing { hearing.toggle() }
        guard !store.trainingActive else { return }
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
        if now.timeIntervalSince(lastMeterLog) >= 1 {
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
        if writer == nil && (mode == .wake || armed)
            && !agent.isBusy
            && (tapStart || (speechConfirmed && now.timeIntervalSince(lastSustainedOnset) < 0.6)) {
            let prerollMs = Int(Double(preRollFrames) / targetFormat.sampleRate * 1000)
            turnID += 1
            turnStartedAt = now
            loggedFirstAudio = false
            stateAfterPlayback = .listening
            addressedTurn = mode != .wake
            armed = false
            inputError = nil
            progress = "Đang nghe…"
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
        recognitionTask?.cancel()
        recognitionTask = nil
        recognitionRequest = nil
        state = .processing
        progress = "Đang làm việc…"
        forwardVoiceTranscript(transcript)
        if let capturedURL { try? FileManager.default.removeItem(at: capturedURL) }
    }

    private func submitFallback(_ url: URL, turn id: Int) {
        submittedTurnID = id
        fallbackSubmittedID = nil
        recognitionTask?.cancel()
        recognitionTask = nil
        recognitionRequest = nil
        progress = "Đang nhận dạng…"
        state = .transcribing
        let process = Process()
        let output = Pipe()
        let error = Pipe()
        process.executableURL = Bundle.main.resourceURL?.appendingPathComponent("tibo")
        process.arguments = ["--transcribe", url.path]
        process.environment = backendEnvironment()
        process.standardOutput = output
        process.standardError = error
        let reader = LineReader { [weak self] line in
            DispatchQueue.main.async { self?.parseBackendLine(line, turn: id) }
        }
        output.fileHandleForReading.readabilityHandler = { reader.feed($0.availableData) }
        error.fileHandleForReading.readabilityHandler = { _ = $0.availableData }
        process.terminationHandler = { [weak self] ended in
            output.fileHandleForReading.readabilityHandler = nil
            error.fileHandleForReading.readabilityHandler = nil
            DispatchQueue.main.async {
                guard let self, id == self.turnID else { return }
                self.backendProcess = nil
                if ended.terminationStatus != 0 && self.state == .transcribing { self.fail("Không nhận dạng được giọng nói.") }
                try? FileManager.default.removeItem(at: url)
            }
        }
        do {
            try process.run()
            backendProcess = process
        } catch {
            try? FileManager.default.removeItem(at: url)
            fail("Không mở được bộ nhận dạng giọng nói.")
        }
    }

    private func parseBackendLine(_ line: String, turn id: Int) {
        guard id == turnID, fallbackSubmittedID != id else { return }
        let text = (line.hasPrefix("TRANSCRIPT: ") ? String(line.dropFirst("TRANSCRIPT: ".count)) : line)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        fallbackSubmittedID = id
        state = .processing
        progress = "Đang làm việc…"
        forwardVoiceTranscript(text)
    }

    private func forwardVoiceTranscript(_ text: String) {
        if currentProfile.voiceMode == .wake && !addressedTurn {
            let addressed = ([currentProfile.assistantName] + currentProfile.wakeWords).contains { name in
                let phrase = name.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !phrase.isEmpty else { return false }
                let pattern = "(?<![\\p{L}\\p{N}])" + NSRegularExpression.escapedPattern(for: phrase) + "(?![\\p{L}\\p{N}])"
                return text.folding(options: [.diacriticInsensitive], locale: nil)
                    .range(of: pattern.folding(options: [.diacriticInsensitive], locale: nil), options: [.regularExpression, .caseInsensitive]) != nil
            }
            guard addressed else { state = .listening; return }
        }
        agent.prompt(text)
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
        if next.microphoneEnabled != micEnabled {
            micEnabled = next.microphoneEnabled
            if micEnabled { requestPermissions() }
            else { stopVoice() }
        }
        if next.voiceMode == .wake { armed = false }
        if previous.ttsEngine != next.ttsEngine || previous.ttsVoice != next.ttsVoice {
            stopTtsServer()
            if micEnabled { startTtsServer() }
        }
        if previous.sttEngine != next.sttEngine || previous.whisperModel != next.whisperModel {
            stopWhisperServer()
            if effectiveSttEngine == .whisper && micEnabled { startWhisperServer() }
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


    private func sendTtsCancel(turn id: Int) {
        guard let ttsInput else { return }
        let message: [String: Any] = ["type": "cancel", "turn_id": id]
        guard var data = try? JSONSerialization.data(withJSONObject: message) else { return }
        data.append(0x0A)
        try? ttsInput.write(contentsOf: data)
    }

    private func sendTts(text: String, final: Bool, turn id: Int) {
        if final { progress = "Đang tạo giọng nói…" }
        guard currentProfile.speakReplies && micEnabled else {
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

    func shutdown() {
        stopVoice()
        backendProcess?.terminate()
    }
}

