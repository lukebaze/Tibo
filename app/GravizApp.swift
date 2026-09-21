@preconcurrency import AVFoundation
import AppKit
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

private final class WavWriter {
    let url: URL
    private let file: AVAudioFile

    init() throws {
        url = FileManager.default.temporaryDirectory.appendingPathComponent("graviz-mic-\(Int(Date().timeIntervalSince1970 * 1000)).wav")
        let format = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16_000, channels: 1, interleaved: false)!
        file = try AVAudioFile(forWriting: url, settings: format.settings, commonFormat: .pcmFormatInt16, interleaved: false)
    }

    func write(_ buffer: AVAudioPCMBuffer) throws { try file.write(from: buffer) }
}

@MainActor
private final class VoiceController: NSObject, ObservableObject, AVAudioPlayerDelegate {
    @Published var state: VoiceState = .listening
    @Published var transcript = "Nói “Graviz” để bắt đầu"
    @Published var summary = "Sẵn sàng"
    @Published var task = ""
    @Published var power: Float = -60
    @Published var micEnabled = true
    @Published var showSettings = false

    private let engine = AVAudioEngine()
    private let audioQueue = DispatchQueue(label: "local.graviz.audio")
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
    private var player: AVAudioPlayer?
    private var playbackStarted = Date.distantPast
    private var backendRunning = false
    private let vadMargin = Float(ProcessInfo.processInfo.environment["GRAVIZ_VAD_MARGIN_DB"] ?? "8") ?? 8

    override init() {
        super.init()
        loadTask()
        startMicrophone()
    }

    func toggleMicrophone() {
        micEnabled.toggle()
        if micEnabled {
            state = .listening
            summary = "Mic đã bật"
            if !engine.isRunning { startMicrophone() }
        } else {
            state = .stopped
            summary = "Mic đã tắt"
        }
    }

    func stopPlayback() {
        player?.stop()
        player = nil
        state = .listening
        summary = "Đã ngắt giọng nói"
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
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            guard let self else { return }
            let copied = self.copy(buffer)
            self.audioQueue.async { [weak self] in self?.process(copied) }
        }
        do {
            try engine.start()
            print("GRAVIZ_MIC recorder_started sample_rate=16000 channels=1 metering=true")
            print("GRAVIZ_MIC metering_started interval_ms=50")
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
            guard let self, self.micEnabled, !self.backendRunning else { return }
            self.consume(buffer)
        }
    }

    private func consume(_ buffer: AVAudioPCMBuffer) {
        let db = rms(buffer)
        power = db
        let now = Date()
        let speaking = player?.isPlaying == true
        if speaking && now.timeIntervalSince(playbackStarted) < 0.25 { return }
        let threshold: Float = speaking ? max(-32, noiseFloor + 12) : min(-25, max(-48, noiseFloor + vadMargin))
        if now.timeIntervalSince(lastMeterLog) >= 0.05 {
            print(String(format: "GRAVIZ_MIC meter power=%.1f threshold=%.1f noise=%.1f", db, threshold, noiseFloor))
            lastMeterLog = now
        }
        let duration = Double(buffer.frameLength) / buffer.format.sampleRate
        guard let converted = convert(buffer) else { return }
        if writer == nil {
            preRoll.append(converted)
            preRollFrames += converted.frameLength
            let limit = AVAudioFrameCount(targetFormat.sampleRate * 0.45)
            while preRollFrames > limit, preRoll.count > 1 {
                preRollFrames -= preRoll.removeFirst().frameLength
            }
            if !speaking && db < threshold {
                noiseFloor = (noiseFloor * 0.98) + (db * 0.02)
            }
        }
        if db > threshold {
            onsetDuration += duration
            silenceDuration = 0
            lastOnset = now
        } else {
            onsetDuration = 0
            if writer != nil { silenceDuration += duration }
        }
        var startedNow = false
        if writer == nil && onsetDuration >= 0.10 {
            if speaking {
                player?.stop()
                player = nil
                interrupted = true
                print("GRAVIZ_MIC barge_in")
            }
            do {
                let newWriter = try WavWriter()
                for buffered in preRoll { try newWriter.write(buffered) }
                writer = newWriter
                recordingDuration = Double(preRollFrames) / targetFormat.sampleRate
                preRoll.removeAll(keepingCapacity: true)
                preRollFrames = 0
                state = .listening
                startedNow = true
                print(String(format: "GRAVIZ_MIC speech_started threshold=%.1f noise=%.1f preroll_ms=450", threshold, noiseFloor))
            } catch {
                summary = "Không thể ghi âm: \(error.localizedDescription)"
                return
            }
        }
        if let writer {
            if !startedNow { try? writer.write(converted); recordingDuration += duration }
            let silenceLimit = awaitingMore ? 1.2 : 0.65
            if silenceDuration >= silenceLimit || recordingDuration >= 15 {
                self.writer = nil
                let url = writer.url
                onsetDuration = 0
                silenceDuration = 0
                submit(url)
            }
        }
        if writer == nil && now.timeIntervalSince(lastOnset) >= 20 {
            print("GRAVIZ_MIC vad_restart reason=no_onset")
            lastOnset = now
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

    private func submit(_ url: URL) {
        backendRunning = true
        state = .processing
        summary = "Đang hiểu yêu cầu…"
        let process = Process()
        let output = Pipe()
        let error = Pipe()
        process.executableURL = Bundle.main.resourceURL?.appendingPathComponent("graviz")
        var arguments = ["--voice", "--audio", url.path, "--emit-wav"]
        if interrupted { arguments.append("--interrupted") }
        if let prefixTranscript { arguments += ["--prefix-transcript", prefixTranscript] }
        process.arguments = arguments
        var environment = ProcessInfo.processInfo.environment
        let defaults = UserDefaults.standard
        environment["GRAVIZ_PROJECT_ROOT"] = defaults.string(forKey: "projectRoot")?.nilIfEmpty ?? FileManager.default.homeDirectoryForCurrentUser.path
        if environment["TYPESAFE_API_KEY"] == nil, let key = defaults.string(forKey: "typesafeApiKey")?.nilIfEmpty { environment["TYPESAFE_API_KEY"] = key }
        process.environment = environment
        process.standardOutput = output
        process.standardError = error
        print("GRAVIZ_BACKEND launch mode=voice")
        do { try process.run() } catch {
            backendRunning = false
            state = .listening
            summary = "Không mở được backend: \(error.localizedDescription)"
            return
        }
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let stdout = output.fileHandleForReading.readDataToEndOfFile()
            let stderr = error.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            let text = String(decoding: stdout, as: UTF8.self)
            let errors = String(decoding: stderr, as: UTF8.self)
            DispatchQueue.main.async {
                guard let self else { return }
                for line in errors.split(separator: "\n") { print("GRAVIZ_BACKEND stderr \(line)") }
                self.parse(text)
                self.backendRunning = false
                self.interrupted = false
                print("GRAVIZ_BACKEND exit status=\(process.terminationStatus)")
                if self.state == .processing { self.state = .listening }
                try? FileManager.default.removeItem(at: url)
            }
        }
    }

    private func parse(_ output: String) {
        var wav: URL?
        var incomplete = false
        for rawLine in output.split(separator: "\n", omittingEmptySubsequences: true) {
            let line = String(rawLine)
            if line.hasPrefix("TRANSCRIPT: ") {
                transcript = String(line.dropFirst("TRANSCRIPT: ".count))
            } else if line == "WAKE" {
                print("GRAVIZ_BACKEND WAKE")
            } else if line.hasPrefix("STAGE ") {
                print("GRAVIZ_BACKEND \(line)")
            } else if line == "GRAVIZ_TURN incomplete" {
                incomplete = true
                awaitingMore = true
                prefixTranscript = transcript
                summary = "Tôi đang nghe tiếp…"
                state = .listening
            } else if line.hasPrefix("GRAVIZ_ROUTE_RESULT ") {
                let payload = line.dropFirst("GRAVIZ_ROUTE_RESULT ".count)
                do {
                    let result = try JSONDecoder().decode(RouteResult.self, from: Data(payload.utf8))
                    summary = result.summary
                    if result.command == "coding_task" { task = transcript }
                    if result.status == "approval_required" {
                        state = .approval
                        awaitingMore = false
                        prefixTranscript = nil
                    }
                } catch {
                    print("GRAVIZ_ROUTE_RESULT malformed JSON ignored")
                }
            } else if line.hasPrefix("GRAVIZ_TTS_WAV ") {
                wav = URL(fileURLWithPath: String(line.dropFirst("GRAVIZ_TTS_WAV ".count)))
                print(line)
            }
        }
        if incomplete { return }
        awaitingMore = false
        prefixTranscript = nil
        if let wav { play(wav) } else if state != .approval { state = .listening }
    }

    private func play(_ url: URL) {
        do {
            player = try AVAudioPlayer(contentsOf: url)
            player?.delegate = self
            playbackStarted = Date()
            state = .speaking
            player?.play()
        } catch {
            summary = "Không phát được phản hồi"
            state = .listening
        }
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor [weak self] in self?.state = .listening; self?.player = nil }
    }

    private func loadTask() {
        let url = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".local/share/graviz/session.json")
        guard let data = try? Data(contentsOf: url), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any], object["active"] as? Bool == true else { return }
        task = object["task"] as? String ?? ""
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}

private struct ContentView: View {
    @StateObject var voice = VoiceController()

    var body: some View {
        ZStack {
            VisualEffect(material: .hudWindow, blendingMode: .behindWindow)
            VStack(alignment: .leading, spacing: 24) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("GRAVIZ").font(.system(size: 13, weight: .bold, design: .rounded)).tracking(2)
                        Text(voice.state.rawValue).font(.system(size: 28, weight: .semibold, design: .rounded))
                            .accessibilityLabel("Trạng thái: \(voice.state.rawValue)")
                    }
                    Spacer()
                    Circle().fill(statusColor).frame(width: 12, height: 12).accessibilityHidden(true)
                }
                meter
                card("Bạn vừa nói", voice.transcript, icon: "waveform")
                card("Phản hồi", voice.summary, icon: "sparkles")
                if !voice.task.isEmpty { card("Tác vụ đang chạy", voice.task, icon: "terminal") }
                Spacer()
                HStack(spacing: 12) {
                    iconButton(voice.micEnabled ? "mic.fill" : "mic.slash", label: voice.micEnabled ? "Tắt microphone" : "Bật microphone", action: voice.toggleMicrophone)
                    iconButton("speaker.slash.fill", label: "Ngắt giọng nói", action: voice.stopPlayback)
                    Spacer()
                    iconButton("gearshape.fill", label: "Cài đặt", action: { voice.showSettings = true })
                }
            }
            .padding(28)
        }
        .frame(minWidth: 440, idealWidth: 440, minHeight: 672, idealHeight: 672)
        .sheet(isPresented: $voice.showSettings) { SettingsView() }
    }

    private var meter: some View {
        GeometryReader { geometry in
            let fraction = max(0.03, min(1, CGFloat((voice.power + 60) / 60)))
            ZStack(alignment: .leading) {
                Capsule().fill(.white.opacity(0.08))
                Capsule().fill(statusColor).frame(width: geometry.size.width * fraction)
            }
        }
        .frame(height: 8)
        .accessibilityLabel("Mức microphone")
        .accessibilityValue("\(Int(voice.power)) decibel")
    }

    private func card(_ title: String, _ text: String, icon: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: icon).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            Text(text).font(.system(size: 16, weight: .medium, design: .rounded)).lineLimit(4).frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(18).background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func iconButton(_ icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: icon).font(.system(size: 16, weight: .semibold)).frame(width: 44, height: 44) }
            .buttonStyle(.plain).background(.white.opacity(0.09), in: Circle()).help(label).accessibilityLabel(label)
    }

    private var statusColor: Color {
        switch voice.state { case .listening: .mint; case .processing: .orange; case .speaking: .cyan; case .approval: .yellow; case .stopped: .gray }
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

private struct VisualEffect: NSViewRepresentable {
    let material: NSVisualEffectView.Material
    let blendingMode: NSVisualEffectView.BlendingMode
    func makeNSView(context: Context) -> NSVisualEffectView { let view = NSVisualEffectView(); view.material = material; view.blendingMode = blendingMode; view.state = .active; return view }
    func updateNSView(_ view: NSVisualEffectView, context: Context) {}
}

private final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        DispatchQueue.main.async {
            guard let window = NSApp.windows.first else { return }
            window.setContentSize(NSSize(width: 440, height: 672))
            window.minSize = NSSize(width: 440, height: 672)
            window.isOpaque = false
            window.backgroundColor = .clear
            window.titlebarAppearsTransparent = true
            window.styleMask.insert(.fullSizeContentView)
            window.collectionBehavior.insert(.moveToActiveSpace)
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
    }
}

@main
struct GravizApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    var body: some Scene { WindowGroup { ContentView() }.windowStyle(.hiddenTitleBar) }
}
