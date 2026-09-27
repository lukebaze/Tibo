@preconcurrency import AVFoundation
import AppKit
import Carbon
import SoundAnalysis
import Speech
import SwiftUI

private enum VoiceState: String {
    case listening = "Đang nghe"
    case processing = "Đang xử lý"
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
private final class VoiceController: NSObject, ObservableObject, AVAudioPlayerDelegate {
    @Published var state: VoiceState = .listening
    @Published var transcript = "Nói “Tibo” để bắt đầu"
    @Published var summary = "Sẵn sàng"
    @Published var task = ""
    @Published var power: Float = -60
    @Published var micEnabled = true
    @Published var showSettings = false

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
    private var claudeProcess: Process?
    private var claudeReaders: [LineReader] = []
    private var claudeReceivedText = false
    private var claudeFinalSent = false
    private var claudeStartedAt = Date.distantPast
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

    override init() {
        super.init()
        loadTask()
        startTtsServer()
        startWhisperServer()
        requestPermissions()
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

    func submitTyped(_ raw: String) {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
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
        turnID += 1
        turnStartedAt = Date()
        loggedFirstAudio = false
        stateAfterPlayback = micEnabled ? .listening : .stopped
        submit(transcript: text, turn: turnID, capturedURL: nil)
    }

    private var isResponding: Bool {
        backendProcess?.isRunning == true
            || claudeProcess?.isRunning == true
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
                    self.summary = "Microphone không được cấp quyền"
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
            summary = "Không tìm thấy microphone"
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
            summary = "Không thể mở microphone: \(error.localizedDescription)"
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
        if writer == nil && speechConfirmed && now.timeIntervalSince(lastSustainedOnset) < 0.6 {
            let prerollMs = Int(Double(preRollFrames) / targetFormat.sampleRate * 1000)
            let oldTurn = turnID
            let wasResponding = isResponding
            cancelForeground(turn: oldTurn, markInterrupted: wasResponding)
            interrupted = wasResponding
            turnID += 1
            turnStartedAt = now
            loggedFirstAudio = false
            stateAfterPlayback = .listening
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
                startedNow = true
                print(String(format: "TIBO_MIC speech_started turn_id=%d threshold=%.1f noise=%.1f preroll_ms=%d", turnID, threshold, noiseFloor, prerollMs))
            } catch {
                summary = "Không thể ghi âm: \(error.localizedDescription)"
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
            if silenceDuration >= silenceLimit || recordingDuration >= 15 {
                self.writer = nil
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
            // Whisper with the domain prompt is the final transcript; Apple Speech mangles
            // "Tibo" and English terms ("agent" → "ai lớn"). Apple stays for live partials
            // and as fallback when the server is down.
            if whisperServer?.isRunning == true {
                submitFallback(url, turn: id)
            } else {
                finishRecognition(turn: id, fallbackURL: url)
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
        request.contextualStrings = ["Tibo", "OMP", "Claude Code", "Codex", "Eva", "agent", "review", "benchmark", "commit", "diff", "Safari", "GitHub"]
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
        if let prefixTranscript { arguments += ["--prefix-transcript", prefixTranscript] }
        process.arguments = arguments
        var environment = ProcessInfo.processInfo.environment
        let defaults = UserDefaults.standard
        environment["TIBO_PROJECT_ROOT"] = defaults.string(forKey: "projectRoot")?.nilIfEmpty ?? FileManager.default.homeDirectoryForCurrentUser.path
        if environment["TYPESAFE_API_KEY"] == nil, let key = defaults.string(forKey: "typesafeApiKey")?.nilIfEmpty { environment["TYPESAFE_API_KEY"] = key }
        if whisperServer?.isRunning == true { environment["TIBO_WHISPER_URL"] = "http://127.0.0.1:\(whisperPort)/inference" }
        process.environment = environment
        process.standardOutput = output
        process.standardError = error
        let stdoutReader = LineReader { [weak self] line in
            DispatchQueue.main.async {
                guard let self, id == self.turnID else { return }
                self.parseBackendLine(line, turn: id)
            }
        }
        let stderrReader = LineReader { _ in
            print("TIBO_BACKEND stderr_received turn_id=\(id)")
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
                    if self.state == .processing && self.claudeProcess == nil { self.state = .listening }
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
            summary = "Không mở được backend: \(error.localizedDescription)"
        }
    }

    private func parseBackendLine(_ line: String, turn id: Int) {
        if line.hasPrefix("TRANSCRIPT: ") {
            transcript = String(line.dropFirst("TRANSCRIPT: ".count))
            print("TIBO_STT turn_id=\(id) text=\(transcript)")
        } else if line == "WAKE" {
            print("TIBO_BACKEND WAKE turn_id=\(id)")
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
            guard let prompt = try? JSONDecoder().decode(String.self, from: Data(payload.utf8)) else {
                print("TIBO_LLM_REQUEST malformed JSON ignored")
                return
            }
            startClaude(prompt: prompt, turn: id)
        }
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

    private func startClaude(prompt: String, turn id: Int) {
        let process = Process()
        let output = Pipe()
        let error = Pipe()
        let fallback = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".nvm/versions/node/v26.2.0/bin/claude")
        process.executableURL = URL(fileURLWithPath: ProcessInfo.processInfo.environment["TIBO_CLAUDE"] ?? fallback.path)
        process.arguments = [
            "-p", prompt,
            "--output-format", "stream-json",
            "--verbose", // required by the CLI for stream-json in print mode; without it claude exits 1 with no text
            "--include-partial-messages",
            "--setting-sources", "local", // skip user hooks/plugins: they need `node` on PATH and add seconds per turn
            "--permission-mode", "plan",
            "--no-session-persistence",
            "--tools", "",
            "--system-prompt", "Bạn là Tibo, trợ lý giọng nói trên macOS. Trả lời bằng tiếng Việt tự nhiên, không Markdown, tối đa ba câu trừ khi người dùng yêu cầu chi tiết. Không tuyên bố đã thao tác trên máy; thao tác được xử lý bởi nhánh computer-use riêng."
        ]
        process.standardOutput = output
        process.standardError = error
        claudeReceivedText = false
        claudeFinalSent = false
        claudeStartedAt = Date()
        summary = ""
        state = .processing
        let stdoutReader = LineReader { [weak self] line in
            DispatchQueue.main.async {
                guard let self, id == self.turnID else { return }
                self.parseClaudeLine(line, turn: id)
            }
        }
        let stderrReader = LineReader { _ in
            print("TIBO_CLAUDE stderr_received turn_id=\(id)")
        }
        claudeReaders = [stdoutReader, stderrReader]
        output.fileHandleForReading.readabilityHandler = { stdoutReader.feed($0.availableData) }
        error.fileHandleForReading.readabilityHandler = { stderrReader.feed($0.availableData) }
        process.terminationHandler = { [weak self] process in
            DispatchQueue.main.async {
                output.fileHandleForReading.readabilityHandler = nil
                error.fileHandleForReading.readabilityHandler = nil
                guard let self else { return }
                if id == self.turnID {
                    self.finishClaude(turn: id, failed: process.terminationStatus != 0)
                    self.claudeProcess = nil
                    self.claudeReaders.removeAll()
                }
                print("TIBO_CLAUDE exit turn_id=\(id) status=\(process.terminationStatus)")
            }
        }
        do {
            try process.run()
            claudeProcess = process
            print("TIBO_CLAUDE launch turn_id=\(id)")
        } catch {
            summary = "Tôi chưa thể trả lời lúc này."
            sendTts(text: summary, final: true, turn: id)
            state = .listening
        }
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
           let text = delta["text"] as? String,
           !text.isEmpty {
            if !claudeReceivedText {
                claudeReceivedText = true
                let ms = Int(Date().timeIntervalSince(claudeStartedAt) * 1000)
                print("TIBO_LATENCY turn_id=\(id) llm_first_delta_ms=\(ms)")
            }
            summary += text
            sendTts(text: text, final: false, turn: id)
        } else if type == "result" {
            finishClaude(turn: id, failed: false)
        }
    }

    private func finishClaude(turn id: Int, failed: Bool) {
        guard id == turnID, !claudeFinalSent else { return }
        claudeFinalSent = true
        if !claudeReceivedText && failed {
            summary = "Tôi chưa thể trả lời lúc này."
            sendTts(text: summary, final: true, turn: id)
        } else {
            sendTts(text: "", final: true, turn: id)
            if !claudeReceivedText { state = .listening }
        }
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
                self.summary = "Kokoro không khả dụng"
            }
        }
        do {
            try process.run()
            ttsProcess = process
            ttsInput = input.fileHandleForWriting
            print("TIBO_TTS server_started")
        } catch {
            summary = "Không mở được Kokoro: \(error.localizedDescription)"
        }
    }

    /// Resident whisper-server keeps the model loaded: ~1.4 s per utterance vs ~3 s for a
    /// cold whisper-cli run. The backend posts to it via TIBO_WHISPER_URL.
    private func startWhisperServer() {
        let environment = ProcessInfo.processInfo.environment
        let server = environment["TIBO_WHISPER_SERVER"] ?? "/opt/homebrew/bin/whisper-server"
        let model = environment["TIBO_WHISPER_MODEL"]
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".local/share/tibo/models/ggml-large-v3-turbo-q5_0.bin").path
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
        claudeProcess?.terminate()
        claudeProcess = nil
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
        guard let ttsInput else {
            summary = "Kokoro không khả dụng"
            return
        }
        let message: [String: Any] = ["type": "delta", "turn_id": id, "text": text, "final": final]
        ttsResponsePending = true
        guard var data = try? JSONSerialization.data(withJSONObject: message) else { return }
        data.append(0x0A)
        do {
            try ttsInput.write(contentsOf: data)
        } catch {
            summary = "Kokoro không khả dụng"
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
            summary = "Không tổng hợp được giọng nói: \(event.message)"
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
            summary = "Không phát được phản hồi"
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
    /// Window size: room for the tallest expanded state plus the settings sheet. The visible notch is drawn inside it.
    static let panelSize = NSSize(width: 440, height: 320)
    static let expandedWidth: CGFloat = 380
    @Published private(set) var expanded = false
    @Published private(set) var typing = false
    @Published private(set) var barHeight: CGFloat = 32
    @Published private(set) var pillWidth: CGFloat = 280
    let voice = VoiceController()
    private let panel = NotchPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    private var lastActive = Date.distantPast
    private var timer: Timer?
    private var hotKey: EventHotKeyRef?

    init() {
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
        let bar = max(24, screen.safeAreaInsets.top, screen.frame.maxY - screen.visibleFrame.maxY)
        var notch: CGFloat = 170
        if let left = screen.auxiliaryTopLeftArea, let right = screen.auxiliaryTopRightArea {
            notch = screen.frame.width - left.width - right.width
        }
        if barHeight != bar { barHeight = bar }
        if pillWidth != notch + 110 { pillWidth = notch + 110 }
        if typing != panel.isKeyWindow { typing = panel.isKeyWindow }
        let top = screen.frame
        let size = Self.panelSize
        let frame = NSRect(x: top.midX - size.width / 2, y: top.maxY - size.height, width: size.width, height: size.height)
        if panel.frame != frame { panel.setFrame(frame, display: true) }

        let visible = expanded ? NSSize(width: Self.expandedWidth, height: barHeight + (typing ? 240 : 190)) : NSSize(width: pillWidth, height: barHeight)
        let hot = NSRect(x: top.midX - visible.width / 2, y: top.maxY - visible.height, width: visible.width, height: visible.height).insetBy(dx: -6, dy: -6)
        let hovering = hot.contains(NSEvent.mouseLocation)
        let busy = voice.state == .processing || voice.state == .speaking || voice.state == .approval
        if hovering || busy || voice.showSettings || panel.isKeyWindow { lastActive = Date() }
        if !expanded && (hovering || busy) {
            setExpanded(true)
        } else if expanded && Date().timeIntervalSince(lastActive) > 1.2 {
            setExpanded(false)
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
        let shape = NotchShape(radius: notch.expanded ? 32 : 12)
        ZStack(alignment: .top) {
            if notch.expanded { expandedView.transition(.opacity) } else { collapsedView.transition(.opacity) }
        }
        .frame(width: notch.expanded ? NotchController.expandedWidth : notch.pillWidth, alignment: .top)
        .background(.black, in: shape)
        .clipShape(shape)
        .contextMenu {
            Button(voice.micEnabled ? "Tắt microphone" : "Bật microphone", action: voice.toggleMicrophone)
            Button("Ngắt giọng nói", action: voice.stopPlayback)
            Button("Cài đặt…") { voice.showSettings = true }
            Divider()
            Button("Thoát Tibo") { NSApp.terminate(nil) }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .environment(\.colorScheme, .dark)
        .animation(.spring(response: 0.38, dampingFraction: 0.8), value: notch.expanded)
        .animation(.spring(response: 0.3, dampingFraction: 0.85), value: notch.typing)
        .animation(.easeInOut(duration: 0.2), value: showCaption)
        .sheet(isPresented: $voice.showSettings) { SettingsView() }
        .onChange(of: notch.typing) { _, typing in inputFocused = typing }
        .onChange(of: voice.state) { old, new in
            if old == .speaking && new != .speaking { react(.happy, for: 2.2) }
        }
        .onChange(of: notch.expanded) { _, expanded in
            if expanded && voice.state == .listening { react(.surprised, for: 0.8) }
        }
    }

    private var collapsedView: some View {
        HStack(spacing: 0) {
            BuddyFace(mood: mood, level: level).frame(width: notch.barHeight * 1.25, height: notch.barHeight * 0.62)
            Spacer(minLength: 0)
        }
        .padding(.leading, 12)
        .frame(height: notch.barHeight)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Tibo: \(voice.state.rawValue)")
    }

    private var expandedView: some View {
        VStack(spacing: 6) {
            BuddyFace(mood: mood, level: level)
                .frame(width: 250, height: 128)
                .accessibilityElement()
                .accessibilityLabel("Tibo: \(voice.state.rawValue)")
            if showCaption {
                Text(voice.summary)
                    .font(.system(size: 13, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.72))
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .padding(.horizontal, 28)
                    .transition(.opacity)
            }
            if notch.typing {
                TextField("Hỏi Tibo…", text: $draft)
                    .textFieldStyle(.plain)
                    .font(.system(size: 14, design: .rounded))
                    .foregroundStyle(.white)
                    .focused($inputFocused)
                    .onSubmit {
                        voice.submitTyped(draft)
                        draft = ""
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(.white.opacity(0.1), in: Capsule())
                    .padding(.horizontal, 22)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .accessibilityLabel("Nhập yêu cầu")
            }
        }
        .padding(.top, notch.barHeight)
        .padding(.bottom, 18)
        .onExitCommand { notch.collapse() }
    }

    private var showCaption: Bool {
        (voice.state == .speaking || voice.state == .approval) && !voice.summary.isEmpty
    }

    private var level: CGFloat { max(0, min(1, CGFloat((voice.power + 60) / 60))) }

    private var mood: BuddyFace.Mood {
        if let reaction { return reaction }
        switch voice.state {
        case .listening: return .idle
        case .processing: return .thinking
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

/// Taby-style mascot: white squircle eyes and a thin mouth. Every frame blends toward the
/// current mood's pose, then layers idle antics (glances, tilts, winks, hearts, yawns) and blinks.
private struct BuddyFace: View {
    enum Mood: Equatable { case idle, thinking, talking, asking, sleeping, happy, surprised }
    let mood: Mood
    let level: CGFloat
    @State private var animator = FaceAnimator()

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            Canvas { ctx, size in
                let pose = animator.pose(mood: mood, level: level, at: t)
                FaceRenderer.draw(pose, mood: mood, extras: animator.extrasAlpha(at: t), in: &ctx, size: size, t: t)
            }
        }
    }
}

private struct FacePose {
    var lookX: CGFloat = 0, lookY: CGFloat = 0, tilt: CGFloat = 0, lift: CGFloat = 0, squash: CGFloat = 0
    var eyeL: CGFloat = 1, eyeR: CGFloat = 1, openL: CGFloat = 1, openR: CGFloat = 1
    var arcsL: CGFloat = 0, arcsR: CGFloat = 0, hearts: CGFloat = 0
    var mouthCurve: CGFloat = 0.6, mouthWidth: CGFloat = 1, mouthOpen: CGFloat = 0, tongue: CGFloat = 0
    var brows: CGFloat = 0, browRaise: CGFloat = 0, browTilt: CGFloat = 0, blush: CGFloat = 0

    private static let fields: [WritableKeyPath<FacePose, CGFloat>] = [
        \.lookX, \.lookY, \.tilt, \.lift, \.squash, \.eyeL, \.eyeR, \.openL, \.openR, \.arcsL, \.arcsR, \.hearts,
        \.mouthCurve, \.mouthWidth, \.mouthOpen, \.tongue, \.brows, \.browRaise, \.browTilt, \.blush,
    ]

    func mixed(_ other: FacePose, _ k: CGFloat) -> FacePose {
        var result = self
        for field in Self.fields { result[keyPath: field] += (other[keyPath: field] - self[keyPath: field]) * k }
        return result
    }

    static func target(_ mood: BuddyFace.Mood, t: Double, level: CGFloat) -> FacePose {
        let s = { (f: Double) in CGFloat(sin(t * f)) }
        var p = FacePose()
        p.squash = s(1.7) * 0.025
        switch mood {
        case .idle:
            let (action, weight, local) = IdleAction.current(t)
            p = p.mixed(action.pose(p, local: local), weight)
            // leans in while hearing a voice: bigger eyes, raised brows, small "o"
            let hear = min(1, max(0, (level - 0.35) / 0.35))
            p.eyeL += hear * 0.18
            p.eyeR += hear * 0.18
            p.brows = max(p.brows, hear)
            p.browRaise += hear * 0.5
            p.mouthOpen = max(p.mouthOpen, hear * 0.3)
            p.mouthCurve -= hear * 0.3
            p.mouthWidth -= hear * 0.3
        case .thinking:
            p.lookX = 0.55 + s(1.9) * 0.2
            p.lookY = -0.7
            p.tilt = 0.07
            p.eyeL = 0.92; p.eyeR = 1.05; p.openL = 0.8; p.openR = 0.85
            p.brows = 1; p.browRaise = 0.2; p.browTilt = -0.6
            p.mouthCurve = -0.15; p.mouthWidth = 0.55
        case .talking:
            let beat = abs(s(9.5)) * (0.6 + 0.4 * abs(s(2.3)))
            p.mouthOpen = 0.2 + 0.7 * beat; p.mouthCurve = 0.7; p.mouthWidth = 0.9; p.tongue = 0.8
            p.brows = 0.7; p.browRaise = 0.2 + 0.3 * abs(s(2.3))
            p.lookX = s(0.9) * 0.25; p.tilt = s(1.3) * 0.05; p.lift = s(4.7) * 0.02
        case .asking:
            p.tilt = 0.2; p.eyeL = 1.15; p.eyeR = 0.85
            p.brows = 1; p.browTilt = 0.7; p.browRaise = 0.3
            p.mouthCurve = -0.1; p.mouthWidth = 0.5; p.lookX = 0.2; p.lookY = -0.2
        case .sleeping:
            p.openL = 0; p.openR = 0; p.lookY = 0.4; p.tilt = -0.08 + s(0.8) * 0.03
            p.mouthCurve = 0.2; p.mouthWidth = 0.45; p.mouthOpen = 0.12 + 0.08 * s(1.2)
            p.squash = s(1.2) * 0.05; p.lift = 0.05
        case .happy:
            p.arcsL = 1; p.arcsR = 1; p.blush = 1
            p.mouthOpen = 0.75; p.mouthCurve = 1; p.tongue = 1
            p.brows = 0.8; p.browRaise = 0.5
            p.lift = -abs(s(7)) * 0.06; p.tilt = s(3.5) * 0.06
        case .surprised:
            p.eyeL = 1.3; p.eyeR = 1.3; p.brows = 1; p.browRaise = 1
            p.mouthOpen = 0.6; p.mouthWidth = 0.45; p.mouthCurve = 0; p.lift = -0.04
        }
        return p
    }
}

private enum IdleAction {
    case none, glanceLeft, glanceRight, lookUp, tiltLeft, tiltRight, content, wink, tongue, love, yawn, lookAround, curious

    static let period = 4.5
    private static let pool: [IdleAction] = [
        .none, .glanceLeft, .glanceRight, .none, .lookUp, .tiltLeft, .tiltRight, .content,
        .wink, .tongue, .glanceLeft, .glanceRight, .love, .yawn, .lookAround, .curious,
    ]

    /// Deterministic "random" antic per 4.5 s slot, eased in and out inside the slot.
    static func current(_ t: Double) -> (IdleAction, CGFloat, Double) {
        let slot = Int((t / period).rounded(.down))
        let local = t - Double(slot) * period
        let action = pool[Int(hash(slot) % UInt64(pool.count))]
        let weight = smoothstep(local, 1.0, 1.35) * (1 - smoothstep(local, 3.1, 3.5))
        return (action, weight, local)
    }

    static func hash(_ n: Int) -> UInt64 {
        var z = UInt64(bitPattern: Int64(n)) &+ 0x9E37_79B9_7F4A_7C15
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }

    static func smoothstep(_ x: Double, _ a: Double, _ b: Double) -> CGFloat {
        let k = min(1, max(0, (x - a) / (b - a)))
        return CGFloat(k * k * (3 - 2 * k))
    }

    func pose(_ base: FacePose, local: Double) -> FacePose {
        var p = base
        switch self {
        case .none: break
        case .glanceLeft: p.lookX = -1
        case .glanceRight: p.lookX = 1
        case .lookUp: p.lookY = -1; p.brows = 0.6; p.browRaise = 0.4
        case .tiltLeft: p.tilt = -0.16; p.lookX = -0.3; p.mouthCurve = 0.8
        case .tiltRight: p.tilt = 0.16; p.lookX = 0.3; p.mouthCurve = 0.8
        case .content: p.arcsL = 1; p.arcsR = 1; p.blush = 0.7; p.mouthCurve = 1
        case .wink: p.arcsR = 1; p.tilt = 0.08; p.mouthOpen = 0.2; p.tongue = 1; p.mouthCurve = 0.9; p.brows = 0.6
        case .tongue: p.mouthOpen = 0.25; p.tongue = 1; p.mouthCurve = 0.8; p.lookX = -0.2
        case .love: p.hearts = 1; p.blush = 1; p.mouthCurve = 1; p.mouthOpen = 0.3; p.lift = -0.03
        case .yawn: p.openL = 0.15; p.openR = 0.15; p.mouthOpen = 1; p.mouthWidth = 0.6; p.mouthCurve = 0; p.tilt = -0.06; p.lift = -0.03
        case .lookAround: p.lookX = CGFloat(sin((local - 1) * 3)); p.lookY = -0.2
        case .curious: p.eyeL = 1.2; p.eyeR = 0.9; p.tilt = -0.12; p.brows = 1; p.browTilt = 0.5
        }
        return p
    }
}

/// Per-face animation memory: remembers the last drawn pose so mood switches glide instead of snap.
private final class FaceAnimator {
    private var mood: BuddyFace.Mood?
    private var from = FacePose()
    private var last = FacePose()
    private var changedAt = 0.0
    private var level: CGFloat = 0

    func pose(mood: BuddyFace.Mood, level target: CGFloat, at t: Double) -> FacePose {
        level += (target - level) * 0.15
        if mood != self.mood {
            from = last
            changedAt = self.mood == nil ? t - 1 : t
            self.mood = mood
        }
        last = from.mixed(FacePose.target(mood, t: t, level: level), extrasAlpha(at: t))
        var shown = last
        let blink = Self.blink(t)
        shown.openL *= blink
        shown.openR *= blink
        return shown
    }

    func extrasAlpha(at t: Double) -> CGFloat { IdleAction.smoothstep(t - changedAt, 0, 0.3) }

    private static func blink(_ t: Double) -> CGFloat {
        let period = 2.9
        let slot = Int((t / period).rounded(.down))
        guard IdleAction.hash(slot &+ 7919) % 3 != 0 else { return 1 }
        let phase = t - Double(slot) * period - 0.4
        guard phase >= 0, phase < 0.18 else { return 1 }
        return CGFloat(abs(phase - 0.09) / 0.09)
    }
}

private enum FaceRenderer {
    static let ink = Color(red: 0.97, green: 0.97, blue: 0.96)
    static let blush = Color(red: 1, green: 0.6, blue: 0.68)
    static let tongue = Color(red: 0.95, green: 0.5, blue: 0.45)

    static func draw(_ p: FacePose, mood: BuddyFace.Mood, extras: CGFloat, in ctx: inout GraphicsContext, size: CGSize, t: Double) {
        let unit = min(size.height * 0.8, size.width / 1.9)
        let eyeH = unit * 0.46, eyeW = eyeH * 0.64, spread = unit * 0.5
        let line = max(1.2, unit * 0.045)
        let ink = GraphicsContext.Shading.color(Self.ink)
        let center = CGPoint(x: size.width / 2, y: size.height * 0.52 + p.lift * unit)
        var face = ctx
        face.translateBy(x: center.x, y: center.y)
        face.rotate(by: .radians(Double(p.tilt)))
        face.scaleBy(x: 1 - p.squash, y: 1 + p.squash)

        let eyeDX = p.lookX * unit * 0.14, eyeDY = p.lookY * unit * 0.09
        for (side, scale, open, arc) in [(CGFloat(-1), p.eyeL, p.openL, p.arcsL), (1, p.eyeR, p.openR, p.arcsR)] {
            let x = side * spread + eyeDX, y = eyeDY
            let w = eyeW * scale, fullH = eyeH * scale
            let solid = (1 - arc) * (1 - p.hearts)
            if solid > 0.01 {
                var e = face
                e.opacity = solid
                let h = max(fullH * 0.09, fullH * open)
                e.fill(Path(roundedRect: CGRect(x: x - w / 2, y: y - h / 2, width: w, height: h), cornerRadius: min(w, h) * 0.45, style: .continuous), with: ink)
            }
            if arc > 0.01 {
                var e = face
                e.opacity = arc
                var a = Path()
                a.move(to: CGPoint(x: x - w * 0.62, y: y + fullH * 0.08))
                a.addQuadCurve(to: CGPoint(x: x + w * 0.62, y: y + fullH * 0.08), control: CGPoint(x: x, y: y - fullH * 0.42))
                e.stroke(a, with: ink, style: StrokeStyle(lineWidth: line * 1.5, lineCap: .round))
            }
            if p.hearts > 0.01 {
                var e = face
                e.opacity = p.hearts
                e.fill(heart(CGPoint(x: x, y: y), w * 1.3 * (1 + 0.08 * CGFloat(sin(t * 8)))), with: .color(Self.blush))
            }
            if p.brows > 0.01 {
                var b = face
                b.opacity = min(1, p.brows * 1.6)
                let by = y - fullH * 0.72 - p.browRaise * fullH * 0.18 + side * p.browTilt * fullH * 0.12
                var brow = Path()
                brow.move(to: CGPoint(x: x - w * 0.5, y: by + fullH * 0.05))
                brow.addQuadCurve(to: CGPoint(x: x + w * 0.5, y: by + fullH * 0.05), control: CGPoint(x: x, y: by - fullH * 0.12))
                b.stroke(brow, with: ink, style: StrokeStyle(lineWidth: line * 1.4, lineCap: .round))
            }
            if p.blush > 0.01 {
                var b = face
                b.opacity = p.blush * 0.85
                b.fill(Path(ellipseIn: CGRect(x: x + side * w * 0.35 - w * 0.55, y: y + fullH * 0.42, width: w * 1.1, height: fullH * 0.2)), with: .color(Self.blush))
            }
        }

        let mx = p.lookX * unit * 0.08, my = eyeH * 0.42 + p.lookY * unit * 0.04
        let mw = unit * 0.4 * p.mouthWidth
        let left = CGPoint(x: mx - mw / 2, y: my), right = CGPoint(x: mx + mw / 2, y: my)
        if p.mouthOpen < 0.06 {
            var m = Path()
            m.move(to: left)
            m.addQuadCurve(to: right, control: CGPoint(x: mx, y: my + p.mouthCurve * unit * 0.14))
            face.stroke(m, with: ink, style: StrokeStyle(lineWidth: line, lineCap: .round))
        } else {
            let open = p.mouthOpen * unit * 0.4
            var m = Path()
            m.move(to: left)
            m.addQuadCurve(to: right, control: CGPoint(x: mx, y: my + p.mouthCurve * unit * 0.03 - open * (1 - p.mouthCurve) * 0.5))
            m.addQuadCurve(to: left, control: CGPoint(x: mx, y: my + p.mouthCurve * unit * 0.12 + open))
            m.closeSubpath()
            face.fill(m, with: .color(Color(white: 0.08)))
            if p.tongue > 0.01 {
                var tg = face
                tg.clip(to: m)
                tg.opacity = p.tongue
                let depth = (p.mouthCurve * unit * 0.12 + open) / 2 // quad-curve apex sits halfway to its control point
                tg.fill(Path(ellipseIn: CGRect(x: mx - mw * 0.28, y: my + depth * 0.3, width: mw * 0.56, height: depth * 1.2)), with: .color(Self.tongue))
            }
            face.stroke(m, with: ink, style: StrokeStyle(lineWidth: line, lineCap: .round, lineJoin: .round))
        }

        // Floating glyphs only on the big face; unreadable at pill size.
        guard unit >= 30, extras > 0.01 else { return }
        let corner = CGPoint(x: center.x + spread + eyeW * 1.3, y: center.y - eyeH * 0.7)
        func glyph(_ s: String, _ at: CGPoint, _ scale: CGFloat, alpha: CGFloat = 1) {
            var g = ctx
            g.opacity = extras * alpha
            g.draw(Text(s).font(.system(size: unit * scale, weight: .heavy, design: .rounded)).foregroundColor(Self.ink), at: at)
        }
        switch mood {
        case .thinking:
            for i in 0..<3 {
                let r = unit * (0.03 + 0.02 * CGFloat(i))
                let c = CGPoint(x: corner.x - unit * 0.1 + CGFloat(i) * unit * 0.1, y: corner.y + unit * 0.1 - CGFloat(i) * unit * 0.12)
                var d = ctx
                d.opacity = extras * (0.35 + 0.65 * (0.5 + 0.5 * sin(t * 4 - Double(i))))
                d.fill(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)), with: ink)
            }
        case .asking:
            glyph("?", CGPoint(x: corner.x, y: corner.y + CGFloat(sin(t * 5)) * unit * 0.04), 0.34)
        case .surprised:
            glyph("!", corner, 0.36)
        case .sleeping:
            for i in 0..<3 {
                let ph = (t * 0.6 + Double(i) / 3).truncatingRemainder(dividingBy: 1)
                let pt = CGPoint(x: corner.x - unit * 0.1 + CGFloat(ph) * unit * 0.25, y: corner.y + unit * 0.3 - CGFloat(ph) * unit * 0.45)
                glyph("z", pt, 0.14 + 0.14 * CGFloat(ph), alpha: CGFloat(sin(ph * .pi)))
            }
        case .happy:
            let spots: [(CGFloat, CGFloat)] = [(-1.35, -0.55), (1.3, -0.6), (-1.1, 0.45), (1.2, 0.35)]
            for (i, spot) in spots.enumerated() {
                let r = unit * 0.1 * (0.6 + 0.4 * CGFloat(sin(t * 6 + Double(i) * 1.7)))
                var sp = ctx
                sp.opacity = extras
                sp.fill(sparkle(CGPoint(x: center.x + spot.0 * spread, y: center.y + spot.1 * unit), r), with: ink)
            }
        default:
            break
        }
    }

    private static func heart(_ c: CGPoint, _ s: CGFloat) -> Path {
        let r = s * 0.27
        var p = Path()
        p.addEllipse(in: CGRect(x: c.x - r * 1.95, y: c.y - r * 1.3, width: r * 2, height: r * 2))
        p.addEllipse(in: CGRect(x: c.x - r * 0.05, y: c.y - r * 1.3, width: r * 2, height: r * 2))
        p.move(to: CGPoint(x: c.x - r * 1.9, y: c.y - r * 0.05))
        p.addLine(to: CGPoint(x: c.x + r * 1.9, y: c.y - r * 0.05))
        p.addLine(to: CGPoint(x: c.x, y: c.y + s * 0.5))
        p.closeSubpath()
        return p
    }

    private static func sparkle(_ c: CGPoint, _ r: CGFloat) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: c.x, y: c.y - r))
        p.addQuadCurve(to: CGPoint(x: c.x + r, y: c.y), control: c)
        p.addQuadCurve(to: CGPoint(x: c.x, y: c.y + r), control: c)
        p.addQuadCurve(to: CGPoint(x: c.x - r, y: c.y), control: c)
        p.addQuadCurve(to: CGPoint(x: c.x, y: c.y - r), control: c)
        return p
    }
}

private struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @AppStorage("projectRoot") private var projectRoot = FileManager.default.homeDirectoryForCurrentUser.path
    @AppStorage("typesafeApiKey") private var typesafeApiKey = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Cài đặt").font(.title2.bold())
            TextField("Thư mục dự án", text: $projectRoot).textFieldStyle(.roundedBorder).accessibilityLabel("Thư mục dự án")
            SecureField("TypeSafe API key", text: $typesafeApiKey).textFieldStyle(.roundedBorder).accessibilityLabel("TypeSafe API key")
            HStack { Spacer(); Button("Xong") { dismiss() }.keyboardShortcut(.defaultAction) }
        }
        .padding(24).frame(width: 420)
    }
}

private final class AppDelegate: NSObject, NSApplicationDelegate {
    private var notch: NotchController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        notch = NotchController()
    }
}

@main
struct TiboApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    var body: some Scene { Settings { SettingsView() } }
}
