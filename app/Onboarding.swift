import AppKit
@preconcurrency import AVFoundation
import Speech
import SwiftUI

@MainActor
enum TiboWindows {
    private static var onboardingWindow: NSWindow?
    private static var settingsWindow: NSWindow?

    /// `startNotch` runs when onboarding reaches the try-it step (idempotent on the caller side).
    static func showOnboarding(store: ProfileStore, startNotch: @escaping () -> Void, onFinish: @escaping () -> Void) {
        if let window = onboardingWindow {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }
        let root = OnboardingView(store: store, startNotch: startNotch, onFinish: {
            onboardingWindow?.close()
            onboardingWindow = nil
            onFinish()
        })
        let window = makeWindow(title: "Thiết lập Tibo", root: root)
        onboardingWindow = window
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    static func showSettings(store: ProfileStore) {
        if let window = settingsWindow {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }
        let window = makeWindow(title: "Cài đặt Tibo", root: SettingsRootView(store: store))
        settingsWindow = window
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    /// Dropping the window means the next open rebuilds the draft from the saved profile.
    static func closeSettings() {
        settingsWindow?.close()
        settingsWindow = nil
    }

    private static func makeWindow<Content: View>(title: String, root: Content) -> NSWindow {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 640, height: 520),
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = title
        window.isReleasedWhenClosed = false
        window.contentViewController = NSHostingController(rootView: root)
        window.center()
        return window
    }
}

private struct VoicePack: Identifiable {
    let id: String
    let label: String
    let installed: Bool
    var filename: String
}

private struct VoicePackInfo: Decodable {
    let label: String
    let filename: String
}

private enum OnboardingPage: Int, CaseIterable, Identifiable {
    case welcome, profile, assistant, agent, tts, stt, listen, permissions, tryIt, finish
    var id: Int { rawValue }
    var title: String {
        switch self {
        case .welcome: "Chào mừng"
        case .profile: "Hồ sơ"
        case .assistant: "Tên gọi"
        case .agent: "Bộ não AI"
        case .tts: "Giọng nói"
        case .stt: "Nhận dạng giọng nói"
        case .listen: "Nghe, nói và notch"
        case .permissions: "Quyền truy cập"
        case .tryIt: "Thử ngay"
        case .finish: "Hoàn tất"
        }
    }
    /// Settings sidebar icon.
    var symbol: String {
        switch self {
        case .profile: "person.crop.circle"
        case .assistant: "character.bubble"
        case .agent: "brain"
        case .tts: "speaker.wave.2"
        case .stt: "mic"
        case .listen: "ear"
        default: "circle"
        }
    }
}

private struct OnboardingView: View {
    @ObservedObject private var store: ProfileStore
    @ObservedObject private var downloader = ModelDownloader.shared
    @State private var draft: Profile
    @State private var page: OnboardingPage = .welcome
    @State private var errorMessage = ""
    @State private var hovered = false
    @State private var woke = false
    @State private var sample = "Hôm nay là thứ mấy? Gợi ý cho tôi một cách dùng Tibo."
    private let startNotch: () -> Void
    private let onFinish: () -> Void

    init(store: ProfileStore, startNotch: @escaping () -> Void, onFinish: @escaping () -> Void) {
        _store = ObservedObject(wrappedValue: store)
        _draft = State(initialValue: store.profile)
        self.startNotch = startNotch
        self.onFinish = onFinish
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(page.title).font(.system(size: 24, weight: .semibold, design: .rounded))
                Spacer()
                Text("\(page.rawValue + 1) / \(OnboardingPage.allCases.count)")
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("Trang \(page.rawValue + 1) trên \(OnboardingPage.allCases.count)")
            }
            .padding(.horizontal, 28)
            .padding(.top, 22)
            ProgressView(value: Double(page.rawValue), total: Double(OnboardingPage.allCases.count - 1))
                .padding(.horizontal, 28)
                .padding(.top, 12)

            ScrollView {
                pageView
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(28)
            }

            if !errorMessage.isEmpty {
                Text(errorMessage).foregroundStyle(.red).font(.callout)
                    .padding(.horizontal, 28)
                    .accessibilityLabel("Lỗi: \(errorMessage)")
            }
            HStack {
                Button("Quay lại") { page = OnboardingPage(rawValue: page.rawValue - 1) ?? .welcome }
                    .disabled(page == .welcome)
                Spacer()
                if page == .finish {
                    Button("Bắt đầu") { finish() }
                        .buttonStyle(.borderedProminent)
                } else {
                    // Model downloads keep running while the user moves on; the button shows how far along they are.
                    Button(downloader.active == nil ? "Tiếp" : "Tiếp · đang tải \(Int(downloader.progress * 100))%") { next() }
                        .buttonStyle(.borderedProminent)
                }
            }
            .padding(20)
        }
        .frame(minWidth: 640, minHeight: 520)
    
    }

    @ViewBuilder private var pageView: some View {
        switch page {
        case .welcome:
            VStack(spacing: 16) {
                BuddyFace(mood: .happy, level: 0.7).frame(width: 260, height: 150)
                    .background(.black).clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
                    .accessibilityElement().accessibilityLabel("Tibo vui vẻ")
                Text("Xin chào! Mình là Tibo.").font(.title2.bold())
                Text("Mình sẽ lắng nghe, giúp bạn làm việc và nói chuyện bằng tiếng Việt. Hãy dành một phút để cá nhân hóa Tibo.")
                    .multilineTextAlignment(.center).foregroundStyle(.secondary)
            }.frame(maxWidth: .infinity)
        case .profile: ProfilePageView(draft: $draft)
        case .assistant: AssistantPageView(draft: $draft, store: store)
        case .agent: AgentPageView(draft: $draft)
        case .tts: TtsPageView(draft: $draft)
        case .stt: SttPageView(draft: $draft)
        case .listen: ListenPageView(draft: $draft)
        case .permissions: PermissionsPageView(store: store)
        case .tryIt: TryItPageView(draft: draft, hovered: $hovered, woke: $woke)
        case .finish: finishView
        }
    }

    private var finishView: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("\(draft.assistantName) đã sẵn sàng.").font(.title3.weight(.semibold))
            Text("Câu hỏi đầu tiên").padding(.top, 4)
            TextField("Câu hỏi đầu tiên", text: $sample, prompt: Text("Để trống nếu chưa muốn hỏi"))
                .textFieldStyle(.roundedBorder).labelsHidden()
            Text("\(draft.assistantName) sẽ trả lời câu này ngay khi bạn bấm Bắt đầu.").font(.caption).foregroundStyle(.secondary)
            Divider().padding(.vertical, 6)
            summaryRow("Gọi bằng", ([draft.assistantName] + draft.wakeWords).joined(separator: ", "))
            summaryRow("Bộ não AI", draft.agent == .pi && !draft.agentModel.isEmpty ? "pi · \(draft.agentModel)" : draft.agent.title)
            summaryRow("Giọng nói", TtsPageView.voiceLabel(draft))
            summaryRow("Nhận dạng", SttPageView.summary(draft) + (downloader.active == nil ? "" : " (đang tải \(Int(downloader.progress * 100))%)"))
            summaryRow("Cách nghe", draft.voiceMode.title)
            Text("Mọi lựa chọn đều đổi được trong Cài đặt.").font(.caption).foregroundStyle(.secondary).padding(.top, 6)
        }
    }

    private func summaryRow(_ label: String, _ value: String) -> some View { HStack { Text(label).foregroundStyle(.secondary); Spacer(); Text(value) } }

    private func next() {
        errorMessage = ""
        if page == .profile && draft.userName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { errorMessage = "Nhập tên của bạn để tiếp tục."; return }
        if page == .assistant {
            draft.assistantName = draft.assistantName.trimmingCharacters(in: .whitespacesAndNewlines)
            draft.wakeWords = draft.wakeWords.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
            if draft.assistantName.isEmpty { errorMessage = "Nhập tên trợ lý để tiếp tục."; return }
        }
        if page == .stt && draft.sttEngine == .whisper && downloader.active == nil
            && !FileManager.default.fileExists(atPath: ProfileStore.modelsDir.appendingPathComponent(draft.whisperModel).path) {
            errorMessage = "Tải một mô hình Whisper, hoặc chọn Apple Speech để dùng ngay."
            return
        }
        if page == .tryIt && !hovered { errorMessage = "Đưa chuột lên notch ở đỉnh màn hình để tiếp tục."; return }
        page = OnboardingPage(rawValue: page.rawValue + 1) ?? .finish
        if page == .tryIt {
            // The live notch reads the stored profile, so persist the choices (still not onboarded) before starting it.
            store.save(draft)
            startNotch()
        }
    }

    private func finish() {
        draft.onboarded = true
        draft.assistantName = draft.assistantName.trimmingCharacters(in: .whitespacesAndNewlines)
        draft.wakeWords = draft.wakeWords.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        store.save(draft)
        onFinish()
        let question = sample.trimmingCharacters(in: .whitespacesAndNewlines)
        if !question.isEmpty { NotificationCenter.default.post(name: .tiboSubmit, object: question) }
    }
}

// MARK: - Pages shared by onboarding and Settings

private struct ProfilePageView: View {
    @Binding var draft: Profile
    var body: some View {
        Form {
            Section("Tên của bạn") {
                TextField("Tên", text: $draft.userName, prompt: Text("Ví dụ: Huy"))
                    .accessibilityLabel("Tên của bạn")
            }
        }.formStyle(.grouped)
    }
}

/// Name, extra wake words and voice training on one page: training learns how the user says the name.
private struct AssistantPageView: View {
    @Binding var draft: Profile
    let store: ProfileStore
    var body: some View {
        Form {
            Section("Tên trợ lý") {
                TextField("Tên", text: $draft.assistantName, prompt: Text("Tibo"))
                Text("Nói “\(draft.assistantName.isEmpty ? "Tibo" : draft.assistantName) ơi …” để gọi")
                    .font(.callout).foregroundStyle(.secondary)
            }
            Section("Từ gọi thêm") {
                ForEach(Array(draft.wakeWords.enumerated()), id: \.offset) { index, word in
                    HStack {
                        TextField("Từ gọi", text: Binding(get: { draft.wakeWords[index] }, set: { draft.wakeWords[index] = $0 }), prompt: Text("Ví dụ: Ti bô"))
                            .labelsHidden()
                        Button { draft.wakeWords.remove(at: index) } label: { Image(systemName: "minus.circle") }
                            .buttonStyle(.borderless).accessibilityLabel("Xóa từ gọi \(word)")
                    }
                }
                Button("Thêm từ gọi") { draft.wakeWords.append("") }
            }
            TrainingSections(draft: $draft, store: store)
        }.formStyle(.grouped)
    }
}

private struct AgentPageView: View {
    @Binding var draft: Profile
    var body: some View {
        Form {
            Section("Chọn chương trình trả lời") {
                ForEach(Profile.Agent.allCases, id: \.id) { agent in
                    let path = AgentCLI.resolve(agent)
                    let selected = draft.agent == agent
                    HStack {
                        Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                            .foregroundStyle(selected ? Color.accentColor : Color.secondary)
                        VStack(alignment: .leading) {
                            Text(agent.title)
                            Text(path?.path ?? "chưa cài").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                    }
                    .contentShape(Rectangle())
                    .onTapGesture { if path != nil { draft.agent = agent } }
                    .opacity(path == nil ? 0.5 : 1)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("\(agent.title), \(path == nil ? "chưa cài" : "đã cài")")
                    .accessibilityAddTraits(selected ? .isSelected : [])
                    .accessibilityAction { if path != nil { draft.agent = agent } }
                }
            }
            if draft.agent == .pi {
                Section("Model của pi") {
                    TextField("Model", text: $draft.agentModel, prompt: Text("opencode-go/deepseek-v4.1-flash"))
                    Text("Để trống để dùng model mặc định của pi.").font(.caption).foregroundStyle(.secondary)
                }
            }
        }.formStyle(.grouped)
        // pi is the default brain; if it isn't installed here, don't leave an unusable choice selected.
        .onAppear {
            if AgentCLI.resolve(draft.agent) == nil, let installed = Profile.Agent.allCases.first(where: { AgentCLI.resolve($0) != nil }) {
                draft.agent = installed
            }
        }
    }
}

private struct TtsPageView: View {
    @Binding var draft: Profile
    @State private var previewRunning = false

    var body: some View {
        Form {
            Section("Động cơ đọc") {
                Picker("Động cơ", selection: $draft.ttsEngine) {
                    Text(Self.kokoroVoices().contains(where: \.installed) ? "Kokoro tiếng Việt (offline)" : "Kokoro tiếng Việt (chưa cài trên máy này)")
                        .tag(Profile.TtsEngine.kokoro)
                        .disabled(!Self.kokoroVoices().contains(where: \.installed))
                    Text("Giọng hệ thống macOS").tag(Profile.TtsEngine.system)
                }
                .pickerStyle(.radioGroup)
                .labelsHidden()
                Picker("Giọng", selection: $draft.ttsVoice) {
                    if draft.ttsEngine == .kokoro {
                        ForEach(Self.kokoroVoices()) { voice in
                            Text(voice.installed ? voice.label : "\(voice.label) (chưa tải)")
                                .tag(voice.id).disabled(!voice.installed)
                        }
                    } else {
                        ForEach(Self.systemVoices(), id: \.self) { Text($0).tag($0) }
                    }
                }
                Button(previewRunning ? "Đang phát…" : "Nghe thử") { preview() }
                    .disabled(previewRunning)
            }
        }.formStyle(.grouped)
        .onAppear { chooseValidVoice() }
        .onChange(of: draft.ttsEngine) { _, _ in chooseValidVoice() }
    }

    static func voiceLabel(_ profile: Profile) -> String {
        guard profile.ttsEngine == .kokoro else { return "\(profile.ttsVoice) (macOS)" }
        return kokoroVoices().first { $0.id == profile.ttsVoice }?.label ?? profile.ttsVoice
    }

    private func chooseValidVoice() {
        if draft.ttsEngine == .kokoro && !Self.kokoroVoices().contains(where: \.installed) { draft.ttsEngine = .system }
        let valid = draft.ttsEngine == .kokoro ? Self.kokoroVoices().filter(\.installed).map(\.id) : Self.systemVoices()
        if !valid.contains(draft.ttsVoice), let first = valid.first { draft.ttsVoice = first }
    }

    private func preview() {
        previewRunning = true
        var env = AgentCLI.environment()
        env["TIBO_TTS_ENGINE"] = draft.ttsEngine.rawValue
        env["TIBO_TTS_VOICE"] = draft.ttsVoice
        let text = "Xin chào, mình là \(draft.assistantName)."
        DispatchQueue.global(qos: .userInitiated).async {
            _ = TiboProcess.run(arguments: ["--say", text], environment: env)
            Task { @MainActor in previewRunning = false }
        }
    }

    private static func kokoroVoices() -> [VoicePack] {
        let dir = ProfileStore.modelsDir.appendingPathComponent("kokoro-vi")
        guard let data = try? Data(contentsOf: dir.appendingPathComponent("voices.json")),
              let values = try? JSONDecoder().decode([String: VoicePackInfo].self, from: data) else { return [] }
        // voices.json filenames are relative to kokoro-vi/ and already include "voicepacks/".
        return values.keys.sorted().map { id in
            let info = values[id]!
            let installed = FileManager.default.fileExists(atPath: dir.appendingPathComponent(info.filename).path)
            return VoicePack(id: id, label: info.label, installed: installed, filename: info.filename)
        }
    }

    private static func systemVoices() -> [String] {
        let voices = AVSpeechSynthesisVoice.speechVoices().filter { $0.language.lowercased().hasPrefix("vi") }.map(\.name)
        return voices.isEmpty ? AVSpeechSynthesisVoice.speechVoices().map(\.name) : voices
    }
}

private struct SttPageView: View {
    @Binding var draft: Profile
    @ObservedObject private var downloader = ModelDownloader.shared

    var body: some View {
        Form {
            Section("Động cơ nhận dạng") {
                Picker("Động cơ", selection: $draft.sttEngine) {
                    ForEach(Profile.SttEngine.allCases) { engine in
                        Text(Self.title(engine)).tag(engine).disabled(engine == .vietasr && !Self.vietASRAvailable)
                    }
                }.pickerStyle(.radioGroup).labelsHidden()
            }
            if draft.sttEngine == .whisper {
                Section("Mô hình Whisper") {
                    let recommended = WhisperCatalog.recommended()
                    ForEach(WhisperCatalog.entries) { entry in
                        let path = WhisperCatalog.installed(entry)
                        let selected = path != nil ? draft.whisperModel == path : draft.whisperModel.hasSuffix("/\(entry.file)")
                        HStack {
                            Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                                .foregroundStyle(selected ? Color.accentColor : Color.secondary)
                            VStack(alignment: .leading) {
                                Text(entry.label + (entry.id == recommended.id ? " · Đề xuất cho máy này" : ""))
                                Text(ByteCountFormatter.string(fromByteCount: entry.bytes, countStyle: .file) + (path == nil ? " · chưa tải" : " · đã có"))
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if downloader.active?.id == entry.id {
                                ProgressView(value: downloader.progress).frame(width: 90)
                            } else if path == nil {
                                if entry.id == recommended.id {
                                    Button("Tải về") { download(entry) }.buttonStyle(.borderedProminent).disabled(downloader.active != nil)
                                } else {
                                    Button("Tải về") { download(entry) }.disabled(downloader.active != nil)
                                }
                            }
                        }
                        .contentShape(Rectangle())
                        .onTapGesture { if let path { draft.whisperModel = path } }
                        .accessibilityElement(children: .combine)
                        .accessibilityAddTraits(selected ? .isSelected : [])
                    }
                    Text(WhisperCatalog.machineSummary()).font(.caption).foregroundStyle(.secondary)
                    if !downloader.error.isEmpty { Text(downloader.error).font(.caption).foregroundStyle(.red) }
                }
            }
        }.formStyle(.grouped)
        .onAppear {
            if !Self.vietASRAvailable && draft.sttEngine == .vietasr { draft.sttEngine = .apple }
            // Whisper without a model can't hear anything. Use an installed model if there is one, otherwise
            // start on Apple Speech; downloading a model (hundreds of MB) is the user's call.
            let current = FileManager.default.fileExists(atPath: ProfileStore.modelsDir.appendingPathComponent(draft.whisperModel).path)
            if draft.sttEngine == .whisper && !current && downloader.active == nil {
                if let installed = WhisperCatalog.entries.lazy.compactMap(WhisperCatalog.installed).first {
                    draft.whisperModel = installed
                } else {
                    draft.sttEngine = .apple
                }
            }
        }
    }

    private func download(_ entry: WhisperCatalog.Entry) {
        downloader.download(entry) { draft.whisperModel = $0 }
    }

    static func title(_ engine: Profile.SttEngine) -> String {
        switch engine {
        case .whisper: "Whisper – chính xác, offline"
        case .apple: "Apple Speech – nhanh"
        case .vietasr: "VietASR"
        }
    }

    static func summary(_ profile: Profile) -> String {
        guard profile.sttEngine == .whisper else { return title(profile.sttEngine) }
        let model = WhisperCatalog.entries.first { profile.whisperModel.hasSuffix($0.file) }?.label ?? profile.whisperModel
        return "Whisper · \(model)"
    }

    private static var vietASRAvailable: Bool {
        FileManager.default.fileExists(atPath: ProfileStore.modelsDir.appendingPathComponent("vietasr").path)
            && FileManager.default.fileExists(atPath: ProfileStore.dataDir.appendingPathComponent("asr-venv").path)
    }
}

private enum TiboProcess {
    static func run(arguments: [String], environment: [String: String]) -> String {
        guard let executable = Bundle.main.resourceURL?.appendingPathComponent("tibo") else { return "Không tìm thấy backend tibo" }
        let process = Process(); process.executableURL = executable; process.arguments = arguments; process.environment = environment
        let pipe = Pipe(); let errorPipe = Pipe(); process.standardOutput = pipe; process.standardError = errorPipe
        do {
            try process.run(); process.waitUntilExit()
            let output = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !output.isEmpty { return output }
            return String(data: errorPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        } catch { return error.localizedDescription }
    }
}

/// Voice training as Form sections, shown under the name and wake words on the "Tên gọi" page.
private struct TrainingSections: View {
    @ObservedObject private var store: ProfileStore
    @Binding var draft: Profile
    @StateObject private var recorder = VoiceRecorder()
    @State private var wakeTakes: [RecognitionPair] = []
    @State private var vocabularyWord = ""
    @State private var vocabularyTakes: [RecognitionPair] = []
    @State private var vocabularyRecording = false
    @State private var errorMessage = ""

    init(draft: Binding<Profile>, store: ProfileStore) {
        _draft = draft
        _store = ObservedObject(wrappedValue: store)
    }

    private var name: String { draft.assistantName.isEmpty ? "Tibo" : draft.assistantName }

    var body: some View {
        Section {
            recordButton(title: "Ghi từ gọi (\(wakeTakes.count)/3)", active: recorder.recording) { recordWake() }
            if recorder.recording { ProgressView(value: recorder.level).tint(.orange).accessibilityLabel("Mức âm thanh") }
            ForEach(Array(wakeTakes.enumerated()), id: \.offset) { index, take in
                LabeledContent("Lần \(index + 1)") {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(take.backend.isEmpty ? "không nhận được" : take.backend)
                        Text("Apple: \(take.apple.isEmpty ? "không nhận được" : take.apple)").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        } header: {
            Text("Luyện giọng")
        } footer: {
            Text("Đọc “\(name)” ba lần; cách \(name) nghe thấy được thêm vào từ gọi.").font(.caption).foregroundStyle(.secondary)
        }
        .onDisappear { recorder.stop() }
        Section {
            HStack {
                TextField("Từ", text: $vocabularyWord, prompt: Text("Ví dụ: Claude Code")).labelsHidden()
                Button("Ghi 2 lần") { recordVocabulary() }
                    .disabled(vocabularyWord.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || recorder.recording || vocabularyRecording)
            }
            ForEach(Array(draft.vocabulary.enumerated()), id: \.element) { index, term in
                HStack {
                    Text(term.word); Spacer(); Text(term.heard.joined(separator: ", ")).foregroundStyle(.secondary)
                    Button { draft.vocabulary.remove(at: index) } label: { Image(systemName: "trash") }.buttonStyle(.borderless).accessibilityLabel("Xóa \(term.word)")
                }
            }
            if !vocabularyTakes.isEmpty { Text("Đã ghi \(vocabularyTakes.count)/2 lần cho “\(vocabularyWord)”").foregroundStyle(.secondary) }
            if !errorMessage.isEmpty { Text(errorMessage).foregroundStyle(.red) }
        } header: {
            Text("Từ vựng riêng")
        } footer: {
            Text("Tên riêng hay bị nghe nhầm: gõ từ rồi đọc hai lần để \(name) học cách bạn nói.").font(.caption).foregroundStyle(.secondary)
        }
    }

    private func recordButton(title: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) { Label(active ? "Dừng ghi" : title, systemImage: active ? "stop.circle.fill" : "record.circle").frame(maxWidth: .infinity) }
            .buttonStyle(.borderedProminent).tint(active ? .red : .accentColor).accessibilityLabel(active ? "Dừng ghi âm" : title)
    }

    private func recordWake() {
        if recorder.recording { recorder.stop(); return }; guard wakeTakes.count < 3 else { return }
        let name = draft.assistantName.isEmpty ? "Tibo" : draft.assistantName
        startRecording { url in transcribe(url: url, context: [name] + draft.vocabulary.map(\.word)) { pair in
            wakeTakes.append(pair); addLearnedVariant(pair.backend); addLearnedVariant(pair.apple)
        }}
    }

    private func recordVocabulary() {
        if recorder.recording { recorder.stop(); return }; guard vocabularyTakes.count < 2 else { return }
        vocabularyRecording = true; let word = vocabularyWord.trimmingCharacters(in: .whitespacesAndNewlines)
        startRecording { url in transcribe(url: url, context: [draft.assistantName, word]) { pair in
            vocabularyTakes.append(pair)
            if vocabularyTakes.count >= 2 {
                let heard = vocabularyTakes.flatMap { [$0.backend, $0.apple] }.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty && !same($0, word) }
                draft.vocabulary.append(Profile.Term(word: word, heard: Array(Set(heard))))
                vocabularyTakes.removeAll(); vocabularyWord = ""; vocabularyRecording = false
            } else { vocabularyRecording = false }
        }}
    }

    private func startRecording(completion: @escaping (URL) -> Void) {
        store.trainingActive = true
        do {
            try recorder.start { [weak store] url in Task { @MainActor in
                guard let store else { return }; store.trainingActive = true; completion(url)
            }}
        } catch { store.trainingActive = false; errorMessage = "Không thể ghi âm: \(error.localizedDescription)" }
    }

    private func transcribe(url: URL, context: [String], completion: @escaping (RecognitionPair) -> Void) {
        let lock = NSLock(); var backend = ""; var apple = ""; var remaining = 2
        func finish(_ kind: Int, _ value: String) {
            lock.lock(); if kind == 0 { backend = value } else { apple = value }; remaining -= 1; let done = remaining == 0; lock.unlock()
            if done { Task { @MainActor in store.trainingActive = false; completion(RecognitionPair(backend: backend, apple: apple)); try? FileManager.default.removeItem(at: url) } }
        }
        DispatchQueue.global(qos: .userInitiated).async { finish(0, TiboProcess.run(arguments: ["--transcribe", url.path], environment: AgentCLI.environment())) }
        Self.runAppleSpeech(url: url, context: context) { finish(1, $0) }
    }

    private func addLearnedVariant(_ transcript: String) {
        let value = transcript.trimmingCharacters(in: CharacterSet.punctuationCharacters.union(.whitespacesAndNewlines)); var words = value.split(whereSeparator: { $0.isWhitespace }).map(String.init)
        if words.last.map({ same($0, "ơi") }) == true { words.removeLast() }; guard !words.isEmpty, words.count <= 4 else { return }
        let variant = words.joined(separator: " "); guard !same(variant, draft.assistantName), !draft.wakeWords.contains(where: { same($0, variant) }) else { return }; draft.wakeWords.append(variant)
    }

    private func same(_ lhs: String, _ rhs: String) -> Bool {
        lhs.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "vi")).trimmingCharacters(in: .whitespacesAndNewlines) == rhs.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "vi")).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func runAppleSpeech(url: URL, context: [String], completion: @escaping (String) -> Void) {
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "vi-VN")), recognizer.isAvailable else { completion(""); return }
        let request = SFSpeechURLRecognitionRequest(url: url); request.contextualStrings = context; var completed = false
        recognizer.recognitionTask(with: request) { result, _ in guard !completed else { return }; if let result, result.isFinal { completed = true; completion(result.bestTranscription.formattedString) } }
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { if !completed { completed = true; completion("") } }
    }
}

private struct PermissionsPageView: View {
    @ObservedObject private var store: ProfileStore
    @State private var refresh = 0
    init(store: ProfileStore) { _store = ObservedObject(wrappedValue: store) }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            PermissionRow(title: "Microphone", status: microphoneStatus) { AVCaptureDevice.requestAccess(for: .audio) { _ in Task { @MainActor in refresh += 1 } } }
            PermissionRow(title: "Nhận dạng giọng nói", status: speechStatus) { SFSpeechRecognizer.requestAuthorization { _ in Task { @MainActor in refresh += 1 } } }
            // Neither API has a completion callback; the rows refresh when the user comes back from System Settings.
            PermissionRow(title: "Ghi màn hình (đọc màn hình)", status: screenStatus) { CGRequestScreenCaptureAccess(); refresh += 1 }
            PermissionRow(title: "Trợ năng (điều khiển máy)", status: accessibilityStatus) {
                AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue(): true] as CFDictionary)
                refresh += 1
            }
            PermissionRow(title: "Lời nhắc, Lịch, Ghi chú (quy trình trợ lý)", status: automationStatus) {
                Self.requestAutomation { refresh += 1 }
            }
            Divider()
            DoctorView()
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in refresh += 1 }
    }
    private var microphoneStatus: String { _ = refresh; switch AVCaptureDevice.authorizationStatus(for: .audio) { case .authorized: return "Đã cấp"; case .denied: return "Đã từ chối — mở Cài đặt hệ thống để cấp lại"; case .restricted: return "Bị giới hạn"; default: return "Chưa hỏi" } }
    private var speechStatus: String { _ = refresh; switch SFSpeechRecognizer.authorizationStatus() { case .authorized: return "Đã cấp"; case .denied: return "Đã từ chối — mở Cài đặt hệ thống để cấp lại"; case .restricted: return "Bị giới hạn"; default: return "Chưa hỏi" } }
    private var screenStatus: String { _ = refresh; return CGPreflightScreenCaptureAccess() ? "Đã cấp" : "Chưa cấp — bật Tibo trong Cài đặt hệ thống, rồi mở lại Tibo" }
    private var accessibilityStatus: String { _ = refresh; return AXIsProcessTrusted() ? "Đã cấp" : "Chưa cấp — bật Tibo trong Cài đặt hệ thống › Trợ năng" }

    private static let automationTargets = ["com.apple.reminders", "com.apple.iCal", "com.apple.Notes"]
    private var automationStatus: String {
        _ = refresh
        let codes = Self.automationTargets.map { Self.automationPermission($0, ask: false) }
        if codes.allSatisfy({ $0 == noErr }) { return "Đã cấp" }
        if codes.contains(OSStatus(errAEEventNotPermitted)) { return "Đã từ chối — bật Tibo trong Cài đặt hệ thống › Quyền riêng tư › Tự động hoá" }
        return "Chưa hỏi"
    }
    /// `procNotFound` when the app isn't running, so a denied/unknown answer needs the target open.
    nonisolated private static func automationPermission(_ bundleID: String, ask: Bool) -> OSStatus {
        let target = NSAppleEventDescriptor(bundleIdentifier: bundleID)
        return AEDeterminePermissionToAutomateTarget(target.aeDesc, typeWildCard, typeWildCard, ask)
    }
    /// Opens each app hidden, then asks; the system prompt blocks, so this runs off the main thread.
    private static func requestAutomation(done: @escaping @MainActor () -> Void) {
        let group = DispatchGroup()
        for id in automationTargets {
            guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: id) else { continue }
            let config = NSWorkspace.OpenConfiguration()
            config.activates = false
            config.hides = true
            group.enter()
            NSWorkspace.shared.openApplication(at: url, configuration: config) { _, _ in group.leave() }
        }
        group.notify(queue: .global(qos: .userInitiated)) {
            for id in automationTargets { _ = automationPermission(id, ask: true) }
            Task { @MainActor in done() }
        }
    }
}

private struct DoctorView: View {
    @State private var output = ""
    @State private var running = false
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack { Button(running ? "Đang kiểm tra…" : "Kiểm tra hệ thống") { run() }.disabled(running); if running { ProgressView().controlSize(.small) } }
            if !output.isEmpty { Text(output).font(.system(.caption, design: .monospaced)).textSelection(.enabled) }
        }
    }
    private func run() { running = true; output = ""; DispatchQueue.global(qos: .userInitiated).async { let result = TiboProcess.run(arguments: ["--doctor"], environment: AgentCLI.environment()); Task { @MainActor in output = result; running = false } } }
}

private struct ListenPageView: View {
    @Binding var draft: Profile
    var body: some View {
        Form {
            Section("Cách gọi \(draft.assistantName)") {
                Picker("Cách gọi", selection: $draft.voiceMode) {
                    ForEach(Profile.VoiceMode.allCases) { Text($0 == .wake ? "Gọi tên “\(draft.assistantName)”, luôn lắng nghe" : $0.title).tag($0) }
                }.pickerStyle(.radioGroup).labelsHidden()
                Text("Hai chế độ bấm mic dùng nút mic trên notch và không cần gọi tên.").font(.caption).foregroundStyle(.secondary)
            }
            Section("Trả lời bằng giọng") {
                Toggle("Cho \(draft.assistantName) nói", isOn: $draft.speakReplies)
                Toggle("Đọc to mọi câu trả lời, kể cả khi hỏi bằng cách gõ", isOn: $draft.readEveryAnswer).disabled(!draft.speakReplies)
                Text("Khi không đọc, câu trả lời hiện chữ trên notch.").font(.caption).foregroundStyle(.secondary)
            }
            Section("Trí nhớ") {
                Toggle("Cho \(draft.assistantName) nhớ các cuộc trò chuyện", isOn: $draft.memoryEnabled)
                Text("Lưu trong ~/.local/share/tibo/memory trên máy này. Nói “quên hết” để xoá.").font(.caption).foregroundStyle(.secondary)
            }
            NotchSections(draft: $draft)
        }.formStyle(.grouped)
    }
}

/// Notch placement and hover tuning, shown on the "Nghe, nói và notch" page.
private struct NotchSections: View {
    @Binding var draft: Profile
    var body: some View {
        Group {
            Section("Vị trí") {
                Picker("Vị trí", selection: $draft.notchPosition) {
                    ForEach(Profile.NotchPosition.allCases) { Text($0.title).tag($0) }
                }.pickerStyle(.segmented).labelsHidden()
            }
            Section("Cách mở khi rê chuột") {
                Picker("Cách mở", selection: $draft.notchOpen) {
                    ForEach(Profile.NotchOpen.allCases) { Text($0.title).tag($0) }
                }.pickerStyle(.radioGroup).labelsHidden()
            }
            Section("Tinh chỉnh") {
                LabeledContent("Nới vùng rê chuột: \(Int(draft.hoverMargin)) pt") { Slider(value: $draft.hoverMargin, in: 0...80, step: 2) }
                LabeledContent(String(format: "Tự thu lại sau %.1f giây", draft.collapseDelay)) { Slider(value: $draft.collapseDelay, in: 0.3...5, step: 0.1) }
                Button("Hiện vùng rê chuột") { NotificationCenter.default.post(name: .tiboShowHoverZone, object: nil) }
                Text("Vùng hiện theo cài đặt đã lưu, trong 3 giây, khi notch đang chạy.").font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}

/// Onboarding step that makes the user use the real notch once before finishing.
private struct TryItPageView: View {
    let draft: Profile
    @Binding var hovered: Bool
    @Binding var woke: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Làm thử một lần để chắc \(draft.assistantName) chạy đúng trên máy bạn.")
            check(hovered, "Đưa chuột lên notch ở đỉnh màn hình")
            check(woke, draft.voiceMode == .wake ? "Nói “\(draft.assistantName)” kèm một câu, ví dụ “\(draft.assistantName) ơi, mấy giờ rồi”" : "Bấm nút mic trên notch rồi nói một câu")
            BuddyFace(mood: woke ? .happy : hovered ? .surprised : .idle, level: 0.5)
                .frame(width: 208, height: 120)
                .background(.black).clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                .frame(maxWidth: .infinity)
                .accessibilityHidden(true)
            if hovered && !woke { Text("Phần giọng nói có thể bỏ qua nếu bạn đang ở chỗ ồn.").font(.caption).foregroundStyle(.secondary) }
        }
        .onReceive(NotificationCenter.default.publisher(for: .tiboNotchOpened)) { _ in hovered = true }
        .onReceive(NotificationCenter.default.publisher(for: .tiboWakeHeard)) { _ in woke = true }
    }
    private func check(_ done: Bool, _ text: String) -> some View {
        Label(text, systemImage: done ? "checkmark.circle.fill" : "circle")
            .foregroundStyle(done ? Color.green : Color.primary)
            .accessibilityLabel("\(text): \(done ? "xong" : "chưa")")
    }
}

/// Whisper models fetched from ggerganov/whisper.cpp on Hugging Face (MIT), stored as
/// `models/whisper-<variant>/<revision>/ggml-<variant>.bin` with a LICENSE next to it.
@MainActor
enum WhisperCatalog {
    struct Entry: Identifiable {
        let variant: String
        let label: String
        let bytes: Int64
        var id: String { variant }
        var file: String { "ggml-\(variant).bin" }
    }

    static let entries = [
        Entry(variant: "base", label: "Base – nhẹ, kém chính xác", bytes: 147_951_465),
        Entry(variant: "small", label: "Small – cân bằng", bytes: 487_601_967),
        Entry(variant: "large-v3-turbo-q5_0", label: "Large v3 Turbo (nén) – chính xác nhất", bytes: 574_041_195),
    ]

    /// Models-relative path of an installed copy: the legacy flat file or any downloaded revision.
    static func installed(_ entry: Entry) -> String? {
        let fm = FileManager.default
        let dir = ProfileStore.modelsDir
        if fm.fileExists(atPath: dir.appendingPathComponent(entry.file).path) { return entry.file }
        let base = "whisper-\(entry.variant)"
        let revisions = (try? fm.contentsOfDirectory(atPath: dir.appendingPathComponent(base).path)) ?? []
        return revisions.sorted().map { "\(base)/\($0)/\(entry.file)" }.first { fm.fileExists(atPath: dir.appendingPathComponent($0).path) }
    }

    private static var ramGB: UInt64 { ProcessInfo.processInfo.physicalMemory >> 30 }
    private static var freeGB: Int64 {
        let values = try? FileManager.default.homeDirectoryForCurrentUser.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        return (values?.volumeAvailableCapacityForImportantUsage ?? 0) >> 30
    }

    /// ponytail: RAM/disk thresholds are rough; large-v3-turbo needs ~1.5 GB resident, small ~0.8 GB.
    static func recommended() -> Entry {
        if ramGB >= 16 && freeGB >= 4 { return entries[2] }
        if ramGB >= 8 && freeGB >= 2 { return entries[1] }
        return entries[0]
    }

    static func machineSummary() -> String { "Máy có \(ramGB) GB RAM, ổ còn trống \(freeGB) GB." }
}

@MainActor
final class ModelDownloader: NSObject, ObservableObject, URLSessionTaskDelegate {
    static let shared = ModelDownloader()
    @Published private(set) var active: WhisperCatalog.Entry?
    @Published private(set) var progress = 0.0
    @Published private(set) var error = ""
    private var observation: NSKeyValueObservation?
    private static let repo = "ggerganov/whisper.cpp"

    /// Resolves the current repo revision, reports the final models-relative path through `onPath` (so the
    /// profile can point at it before the bytes arrive), then downloads in the background and posts `.tiboModelReady`.
    func download(_ entry: WhisperCatalog.Entry, onPath: @escaping (String) -> Void) {
        guard active == nil else { return }
        active = entry
        progress = 0
        error = ""
        Task {
            do {
                let (meta, _) = try await URLSession.shared.data(from: URL(string: "https://huggingface.co/api/models/\(Self.repo)")!)
                guard let sha = (try JSONSerialization.jsonObject(with: meta) as? [String: Any])?["sha"] as? String else { throw URLError(.badServerResponse) }
                let relative = "whisper-\(entry.variant)/\(sha.prefix(7))/\(entry.file)"
                onPath(relative)
                let destination = ProfileStore.modelsDir.appendingPathComponent(relative)
                let folder = destination.deletingLastPathComponent()
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                let source = URL(string: "https://huggingface.co/\(Self.repo)/resolve/\(sha)/\(entry.file)")!
                let (temp, response) = try await URLSession.shared.download(from: source, delegate: self)
                guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
                try? FileManager.default.removeItem(at: destination)
                try FileManager.default.moveItem(at: temp, to: destination)
                let mit = (try? await URLSession.shared.data(from: URL(string: "https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/LICENSE")!))
                    .flatMap { String(data: $0.0, encoding: .utf8) } ?? "MIT License"
                let notice = "\(entry.file): OpenAI Whisper weights converted to ggml by whisper.cpp.\nSource: \(source.absoluteString)\nLicense: MIT (model card of huggingface.co/\(Self.repo); weights MIT per github.com/openai/whisper).\n\n\(mit)"
                try notice.write(to: folder.appendingPathComponent("LICENSE"), atomically: true, encoding: .utf8)
                print("TIBO_MODEL downloaded \(relative)")
                observation = nil
                active = nil
                NotificationCenter.default.post(name: .tiboModelReady, object: relative)
            } catch {
                self.error = "Tải \(entry.label) lỗi: \(error.localizedDescription)"
                observation = nil
                active = nil
            }
        }
    }

    nonisolated func urlSession(_ session: URLSession, didCreateTask task: URLSessionTask) {
        let observation = task.progress.observe(\.fractionCompleted) { progress, _ in
            let value = progress.fractionCompleted
            Task { @MainActor in ModelDownloader.shared.progress = value }
        }
        Task { @MainActor in ModelDownloader.shared.observation = observation }
    }
}

private struct RecognitionPair { let backend: String; let apple: String }

private struct PermissionRow: View {
    let title: String; let status: String; let action: () -> Void
    var body: some View {
        HStack {
            VStack(alignment: .leading) { Text(title); Text(status).font(.caption).foregroundStyle(.secondary) }
            Spacer()
            if status == "Đã cấp" {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(.green).accessibilityLabel("Đã cấp")
            } else {
                Button("Yêu cầu quyền", action: action)
            }
        }
    }
}

private struct SettingsRootView: View {
    @ObservedObject private var store: ProfileStore
    @State private var selection: OnboardingPage? = .profile
    @State private var draft: Profile
    @AppStorage("projectRoot") private var projectRoot = FileManager.default.homeDirectoryForCurrentUser.path
    @AppStorage("typesafeApiKey") private var typesafeApiKey = ""

    init(store: ProfileStore) { _store = ObservedObject(wrappedValue: store); _draft = State(initialValue: store.profile) }

    var body: some View {
        HStack(spacing: 0) {
            List(selection: $selection) {
                ForEach([OnboardingPage.profile, .assistant, .agent, .tts, .stt, .listen], id: \.self) { page in
                    Label(page.title, systemImage: page.symbol).tag(Optional(page))
                }
                Label("Nâng cao", systemImage: "gearshape.2").tag(Optional<OnboardingPage>.none)
            }
            .listStyle(.sidebar)
            .frame(width: 190)
            Divider()
            ScrollView { detail.padding(28) }
        }
        .safeAreaInset(edge: .bottom) {
            HStack { Spacer(); Button("Lưu") { draft.onboarded = true; store.save(draft); TiboWindows.closeSettings() }.buttonStyle(.borderedProminent) }.padding(.horizontal, 22).padding(.vertical, 14)
        }
        .frame(minWidth: 640, minHeight: 520)
    }

    @ViewBuilder private var detail: some View {
        switch selection {
        case .some(.profile): ProfilePageView(draft: $draft)
        case .some(.assistant): AssistantPageView(draft: $draft, store: store)
        case .some(.agent): AgentPageView(draft: $draft)
        case .some(.tts): TtsPageView(draft: $draft)
        case .some(.stt): SttPageView(draft: $draft)
        case .some(.listen): ListenPageView(draft: $draft)
        case nil: advanced
        default: EmptyView()
        }
    }

    private var advanced: some View {
        Form {
            Section("Nâng cao") { TextField("Project root", text: $projectRoot); SecureField("TypeSafe API key", text: $typesafeApiKey) }
            Section("Chẩn đoán") { DoctorView() }
        }.formStyle(.grouped)
    }
}

private final class OnboardingWavWriter {
    let url: URL
    private let file: AVAudioFile
    init() throws {
        url = FileManager.default.temporaryDirectory.appendingPathComponent("tibo-training-\(UUID().uuidString).wav")
        let format = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16_000, channels: 1, interleaved: false)!
        file = try AVAudioFile(forWriting: url, settings: format.settings, commonFormat: .pcmFormatInt16, interleaved: false)
    }
    func write(_ buffer: AVAudioPCMBuffer) throws { try file.write(from: buffer) }
}

@MainActor private final class VoiceRecorder: ObservableObject {
    @Published var recording = false
    @Published var level: Double = 0
    private let engine = AVAudioEngine()
    private let queue = DispatchQueue(label: "tibo.onboarding.audio")
    private var writer: OnboardingWavWriter?
    private var converter: AVAudioConverter?
    private var timer: DispatchWorkItem?
    private var completion: ((URL) -> Void)?

    func start(completion: @escaping (URL) -> Void) throws {
        guard !recording else { return }
        let input = engine.inputNode; let source = input.inputFormat(forBus: 0)
        guard source.sampleRate > 0, source.channelCount > 0 else { throw NSError(domain: "Tibo", code: 1, userInfo: [NSLocalizedDescriptionKey: "Không tìm thấy microphone"]) }
        let target = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16_000, channels: 1, interleaved: false)!
        let newWriter = try OnboardingWavWriter(); writer = newWriter; converter = AVAudioConverter(from: source, to: target); self.completion = completion
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: source) { [weak self, weak newWriter] buffer, _ in
            guard let self, let newWriter, let converter = self.converter else { return }
            let capacity = AVAudioFrameCount(Double(buffer.frameLength) * target.sampleRate / source.sampleRate) + 1
            guard let converted = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return }
            var supplied = false; var error: NSError?
            converter.convert(to: converted, error: &error) { _, status in if supplied { status.pointee = .noDataNow; return nil }; supplied = true; status.pointee = .haveData; return buffer }
            guard error == nil else { return }
            self.queue.async {
                try? newWriter.write(converted)
                let value = Self.rms(buffer)
                Task { @MainActor in self.level = min(1, max(0, Double((value + 60) / 60))) }
            }
        }
        try engine.start(); recording = true
        let stop = DispatchWorkItem { [weak self] in Task { @MainActor in self?.stop() } }; timer = stop; DispatchQueue.main.asyncAfter(deadline: .now() + 2.5, execute: stop)
    }

    func stop() {
        guard recording || writer != nil else { return }
        timer?.cancel(); timer = nil; engine.inputNode.removeTap(onBus: 0); engine.stop(); queue.sync {}
        let url = writer?.url; let callback = completion
        writer = nil; converter = nil; completion = nil; recording = false; level = 0
        if let url { callback?(url) }
    }

    nonisolated private static func rms(_ buffer: AVAudioPCMBuffer) -> Float {
        guard let channels = buffer.floatChannelData else { return -60 }; let count = Int(buffer.frameLength); guard count > 0 else { return -60 }
        var sum: Float = 0; for index in 0..<count { let value = channels[0][index]; sum += value * value }; return max(-60, 20 * log10(sqrt(sum / Float(count)) + 0.000001))
    }
}
