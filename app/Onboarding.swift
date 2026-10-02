import AppKit
@preconcurrency import AVFoundation
import Carbon
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
            contentRect: NSRect(x: 0, y: 0, width: 720, height: 560),
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

private extension View {
    /// The setup windows' primary action: ink on Taby amber, since white on amber is 1.9:1. Only primary
    /// actions and onboarding progress take amber; other controls stay system-native.
    func tiboProminent() -> some View { buttonStyle(.borderedProminent).tint(TiboStyle.accent).foregroundStyle(TiboStyle.onAccent) }
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

private enum OnboardingPage {
    case welcome, persona, agent, customize, voice, tts, stt, notch, tools, permissions, tryIt, finish
    var title: String {
        switch self {
        case .welcome: "Chào mừng"
        case .persona: "Hồ sơ & tính cách"
        case .agent: "Model"
        case .customize: "Tùy chỉnh (không bắt buộc)"
        case .voice: "Giọng nói & từ gọi"
        case .tts: "Giọng đọc"
        case .stt: "Nhận dạng giọng nói"
        case .notch: "Notch & phím tắt"
        case .tools: "Quyền của agent"
        case .permissions: "Quyền hệ thống"
        case .tryIt: "Thử ngay"
        case .finish: "Hoàn tất"
        }
    }
    /// Settings sidebar icon.
    var symbol: String {
        switch self {
        case .persona: "person.crop.circle"
        case .agent: "brain"
        case .notch: "menubar.rectangle"
        case .tools: "lock.shield"
        case .voice: "mic"
        case .tts: "speaker.wave.2"
        case .stt: "waveform"
        case .permissions: "checkmark.shield"
        default: "circle"
        }
    }
    static let settings: [OnboardingPage] = [.persona, .agent, .notch, .tools, .voice, .tts, .stt, .permissions]
}

/// HTTPS, or HTTP only on loopback; no credentials in the URL. Mirrors `validate_base_url` in the runtime.
private func agentEndpoint(_ value: String) -> URL? {
    guard let url = URL(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
          let scheme = url.scheme?.lowercased(),
          scheme == "https" || (scheme == "http" && ["localhost", "127.0.0.1", "::1"].contains(url.host ?? "")),
          url.host != nil, url.user == nil, url.password == nil else { return nil }
    return url
}

/// Trims what the user typed and drops empty rows; returns the first problem that blocks saving.
/// Shared by onboarding and Settings so both persist the same shape.
private func validate(_ draft: inout Profile) -> String? {
    func trim(_ value: String) -> String { value.trimmingCharacters(in: .whitespacesAndNewlines) }
    draft.userName = trim(draft.userName)
    draft.assistantName = trim(draft.assistantName).isEmpty ? "Tibo" : trim(draft.assistantName)
    draft.pronounSelf = trim(draft.pronounSelf).isEmpty ? "mình" : trim(draft.pronounSelf)
    draft.pronounUser = trim(draft.pronounUser).isEmpty ? "bạn" : trim(draft.pronounUser)
    draft.wakeWords = draft.wakeWords.filter { !trim($0).isEmpty }
    draft.customInstructions = trim(draft.customInstructions)
    draft.quickPrompts = draft.quickPrompts.compactMap { item in
        let prompt = trim(item.prompt)
        guard !prompt.isEmpty else { return nil }
        return Profile.QuickPrompt(id: item.id, title: trim(item.title).isEmpty ? String(prompt.prefix(20)) : trim(item.title), prompt: prompt)
    }
    guard agentEndpoint(draft.agentBaseURL) != nil else { return "Nhập endpoint API hợp lệ, ví dụ https://api.openai.com/v1." }
    guard !trim(draft.agentModel).isEmpty else { return "Nhập tên model trước khi tiếp tục." }
    let env = trim(draft.agentAPIKeyEnv)
    guard env.range(of: "^[A-Za-z_][A-Za-z0-9_]*$", options: .regularExpression) != nil else {
        return "Tên biến môi trường API key chỉ dùng chữ ASCII, số và dấu gạch dưới; không bắt đầu bằng số."
    }
    draft.agentBaseURL = trim(draft.agentBaseURL)
    draft.agentModel = trim(draft.agentModel)
    draft.agentAPIKeyEnv = env
    return nil
}

private struct OnboardingView: View {
    @ObservedObject private var store: ProfileStore
    @ObservedObject private var downloader = ModelDownloader.shared
    @State private var draft: Profile
    @State private var page: OnboardingPage = .welcome
    @State private var errorMessage = ""
    @AccessibilityFocusState private var errorFocused: Bool
    @State private var hovered = false
    @State private var woke = false
    private let startNotch: () -> Void
    private let onFinish: () -> Void
    /// Required steps stay short; everything optional lives on `.customize`, voice steps only with the mic on.
    private var pages: [OnboardingPage] {
        [.welcome, .persona, .agent, .customize] + (draft.microphoneEnabled ? [.voice, .tts, .stt] : []) + [.permissions, .tryIt, .finish]
    }

    private var pageIndex: Int { pages.firstIndex(of: page) ?? 0 }

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
                Text("\(pageIndex + 1) / \(pages.count)")
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("Trang \(pageIndex + 1) trên \(pages.count)")
            }
            .padding(.horizontal, 28)
            .padding(.top, 22)
            ProgressView(value: Double(pageIndex), total: Double(max(1, pages.count - 1))).tint(TiboStyle.accent)
                .padding(.horizontal, 28)
                .padding(.top, 12)

            ScrollView {
                pageView
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(28)
            }
            .id(page) // each step starts at the top, not at the previous step's scroll offset

            if !errorMessage.isEmpty {
                Text(errorMessage).foregroundStyle(.red).font(.callout)
                    .padding(.horizontal, 28)
                    .accessibilityLabel("Lỗi: \(errorMessage)")
                    .accessibilityFocused($errorFocused)
            }
            HStack {
                Button("Quay lại") {
                    guard let index = pages.firstIndex(of: page), index > 0 else { return }
                    page = pages[index - 1]
                }
                    .disabled(pageIndex == 0)
                Spacer()
                if page == .finish {
                    Button("Bắt đầu") { finish() }
                        .tiboProminent()
                } else {
                    // Model downloads keep running while the user moves on; the button shows how far along they are.
                    Button(downloader.active == nil ? "Tiếp" : "Tiếp · đang tải \(Int(downloader.progress * 100))%") { next() }
                        .tiboProminent()
                }
            }
            .padding(20)
        }
        .frame(minWidth: 640, minHeight: 560)
    }

    @ViewBuilder private var pageView: some View {
        switch page {
        case .welcome:
            VStack(spacing: 16) {
                // Taby on the ink screen inside the app icon's amber bezel.
                BuddyFace(mood: .happy, hearing: false).frame(width: 240, height: 138)
                    .background(TiboStyle.onAccent).clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                    .padding(10)
                    .background(LinearGradient(colors: [TiboStyle.accent, TiboStyle.ember], startPoint: .topLeading, endPoint: .bottomTrailing),
                                in: RoundedRectangle(cornerRadius: 34, style: .continuous))
                    .accessibilityElement().accessibilityLabel("Tibo vui vẻ")
                Text("Chào bạn, mình là Tibo.").font(.system(size: 22, weight: .bold, design: .rounded))
                Text("Chỉ cần ba thứ: tên của bạn, model và thử notch. Các trang còn lại bấm Tiếp để đi qua; xưng hô, cách trả lời, phím tắt và quyền của agent chỉnh lại lúc nào cũng được trong Cài đặt.")
                    .multilineTextAlignment(.center).foregroundStyle(.secondary).frame(maxWidth: 460)
            }.frame(maxWidth: .infinity)
        case .tryIt: TryItPageView(draft: draft, hovered: $hovered, woke: $woke)
        case .finish: finishView
        default: SetupPageView(page: page, draft: $draft, store: store, onboarding: true)
        }
    }

    private var finishView: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("\(draft.assistantName) đã sẵn sàng.").font(.title3.weight(.semibold))
            Divider().padding(.vertical, 6)
            summaryRow("Xưng hô", "\(draft.pronounSelf) – \(draft.pronounUser)")
            summaryRow("Trả lời", "\(draft.replyLength.title) · \(draft.tone.title)")
            summaryRow("Model", draft.agentModel.isEmpty ? "Chưa cấu hình" : "\(draft.agentModel) · \(URL(string: draft.agentBaseURL)?.host ?? draft.agentBaseURL)")
            summaryRow("Phím tắt", draft.hotkey.label)
            summaryRow("Thư mục làm việc", ToolSections.workspaceLabel(draft))
            summaryRow("Công cụ tắt", ToolSections.disabledSummary(draft))
            if draft.microphoneEnabled {
                summaryRow("Gọi bằng", ([draft.assistantName] + draft.wakeWords).joined(separator: ", "))
                summaryRow("Giọng nói", TtsPageView.voiceLabel(draft))
                summaryRow("Nhận dạng", SttPageView.summary(draft) + (downloader.active == nil ? "" : " (đang tải \(Int(downloader.progress * 100))%)"))
                summaryRow("Cách nghe", draft.voiceMode.title)
            } else {
                summaryRow("Micro", "Tắt · chế độ văn bản")
            }
            Text("Mọi lựa chọn đều đổi được trong Cài đặt.").font(.caption).foregroundStyle(.secondary).padding(.top, 6)
        }
    }

    private func summaryRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) { Text(label).foregroundStyle(.secondary); Spacer(); Text(value).multilineTextAlignment(.trailing) }
    }

    private func next() {
        errorMessage = ""
        errorFocused = false
        if page == .persona && draft.userName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            showError("Nhập tên của bạn để tiếp tục.")
            return
        }
        if page == .agent, let problem = validate(&draft) {
            showError(problem)
            return
        }
        if page == .stt && draft.microphoneEnabled && draft.sttEngine == .whisper && downloader.active == nil
            && !FileManager.default.fileExists(atPath: ProfileStore.modelsDir.appendingPathComponent(draft.whisperModel).path) {
            showError("Tải một mô hình Whisper, hoặc chọn Apple Speech để dùng ngay.")
            return
        }
        if page == .tryIt && !hovered {
            showError("Bấm vào notch ở đỉnh màn hình (hoặc nhấn \(draft.hotkey.label)) để tiếp tục.")
            return
        }
        guard let index = pages.firstIndex(of: page), index + 1 < pages.count else { return }
        page = pages[index + 1]
        if page == .tryIt {
            // The live notch reads the stored profile, so persist the choices (still not onboarded) before starting it.
            _ = validate(&draft)
            store.save(draft)
            guard store.persistenceError.isEmpty else {
                showError("Không thể lưu profile: \(store.persistenceError)")
                return
            }
            startNotch()
        }
    }

    private func showError(_ message: String) {
        errorMessage = message
        announceAccessibility(message, priority: .high)
        DispatchQueue.main.async { errorFocused = true }
    }

    private func finish() {
        if let problem = validate(&draft) {
            showError(problem)
            return
        }
        draft.onboarded = true
        store.save(draft)
        guard store.persistenceError.isEmpty else {
            draft.onboarded = false
            showError("Không thể lưu profile: \(store.persistenceError)")
            return
        }
        onFinish()
    }
}

// MARK: - Pages shared by onboarding and Settings

/// One setup page. Onboarding splits the essentials from the optional customize step; Settings shows one topic per page.
private struct SetupPageView: View {
    let page: OnboardingPage
    @Binding var draft: Profile
    let store: ProfileStore
    let onboarding: Bool

    var body: some View {
        switch page {
        case .persona:
            Form {
                IdentitySections(draft: $draft)
                if onboarding { MicSection(draft: $draft) } else { StyleSections(draft: $draft) }
            }.formStyle(.grouped)
        case .agent: AgentPageView(draft: $draft, store: store)
        case .customize:
            Form {
                Section {
                    Text("Mặc định đã dùng tốt. Chỉnh những gì bạn muốn, hoặc bấm Tiếp để bỏ qua; mọi thứ ở đây đều có trong Cài đặt.")
                        .font(.callout).foregroundStyle(.secondary)
                }
                StyleSections(draft: $draft)
                NotchSections(draft: $draft)
                ToolSections(draft: $draft)
            }.formStyle(.grouped)
        case .notch: Form { NotchSections(draft: $draft) }.formStyle(.grouped)
        case .tools: Form { ToolSections(draft: $draft) }.formStyle(.grouped)
        case .voice:
            Form {
                if !onboarding { MicSection(draft: $draft) }
                if draft.microphoneEnabled { VoiceSections(draft: $draft, store: store) }
            }.formStyle(.grouped)
        case .tts: TtsPageView(draft: $draft)
        case .stt: SttPageView(draft: $draft)
        case .permissions: PermissionsPageView(store: store, microphone: draft.microphoneEnabled)
        default: EmptyView()
        }
    }
}

/// Names and how the assistant and the user address each other in Vietnamese.
private struct IdentitySections: View {
    @Binding var draft: Profile
    private static let addresses = [["mình", "bạn"], ["tôi", "bạn"], ["em", "anh"], ["em", "chị"], ["tớ", "cậu"]]

    var body: some View {
        Section("Bạn") {
            TextField("Tên của bạn", text: $draft.userName, prompt: Text("Ví dụ: Huy"))
        }
        Section {
            TextField("Tên trợ lý", text: $draft.assistantName, prompt: Text("Tibo"))
            HStack {
                TextField("Xưng hô", text: $draft.pronounSelf, prompt: Text("mình"))
                Text("–").foregroundStyle(.secondary)
                TextField("Gọi bạn là", text: $draft.pronounUser, prompt: Text("bạn")).labelsHidden()
                Menu("Mẫu") {
                    ForEach(Self.addresses, id: \.self) { pair in
                        Button(pair.joined(separator: " – ")) { draft.pronounSelf = pair[0]; draft.pronounUser = pair[1] }
                    }
                }
                .fixedSize()
                .accessibilityLabel("Chọn cách xưng hô có sẵn")
            }
        } header: {
            Text("Trợ lý")
        } footer: {
            Text("Ví dụ: “\(draft.pronounSelf.capitalized) đã thêm lịch họp cho \(draft.pronounUser) rồi.”")
                .font(.caption).foregroundStyle(.secondary)
        }
    }
}

private struct MicSection: View {
    @Binding var draft: Profile
    var body: some View {
        Section("Đầu vào") {
            Toggle("Bật microphone và điều khiển bằng giọng nói", isOn: $draft.microphoneEnabled)
            Text(draft.microphoneEnabled
                 ? "Từ gọi, luyện giọng, giọng đọc và nhận dạng được cấu hình ở các bước giọng nói."
                 : "Tắt để dùng \(draft.assistantName) bằng chữ; các bước giọng nói, tải model và quyền micro được bỏ qua.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }
}

/// How the agent answers: length, tone, standing instructions and memory.
private struct StyleSections: View {
    @Binding var draft: Profile
    private static let instructionLimit = 2000

    var body: some View {
        Section("Cách trả lời") {
            Picker("Độ dài", selection: $draft.replyLength) {
                ForEach(Profile.ReplyLength.allCases) { Text($0.title).tag($0) }
            }.pickerStyle(.segmented)
            Picker("Giọng điệu", selection: $draft.tone) {
                ForEach(Profile.Tone.allCases) { Text($0.title).tag($0) }
            }.pickerStyle(.segmented)
        }
        Section {
            TextEditor(text: $draft.customInstructions)
                .font(.body)
                .frame(minHeight: 72)
                .accessibilityLabel("Hướng dẫn riêng cho \(draft.assistantName)")
                .onChange(of: draft.customInstructions) { _, value in
                    if value.count > Self.instructionLimit { draft.customInstructions = String(value.prefix(Self.instructionLimit)) }
                }
        } header: {
            Text("Hướng dẫn riêng")
        } footer: {
            Text("Điều \(draft.assistantName) luôn cần biết, ví dụ: “Mình là dev iOS; đổi giá sang VND; trả lời có dấu.” Tối đa \(Self.instructionLimit) ký tự, còn \(Self.instructionLimit - draft.customInstructions.count).")
                .font(.caption).foregroundStyle(.secondary)
        }
        Section("Trí nhớ") {
            Toggle("Cho \(draft.assistantName) nhớ các cuộc trò chuyện", isOn: $draft.memoryEnabled)
            Text("Lưu trong ~/.local/share/tibo/memory trên máy này. Bảo \(draft.assistantName) “quên …” để xoá.").font(.caption).foregroundStyle(.secondary)
        }
    }
}

/// Tool groups the agent may use and the folder its file tools work in.
private struct ToolSections: View {
    @Binding var draft: Profile

    static func workspaceLabel(_ profile: Profile) -> String {
        profile.workspace.isEmpty ? "Mặc định (~/.local/share/tibo/workspace)" : (profile.workspace as NSString).abbreviatingWithTildeInPath
    }

    static func disabledSummary(_ profile: Profile) -> String {
        let off = [(profile.allowShell, "shell"), (profile.allowWeb, "web"), (profile.allowFileWrite, "ghi file"), (profile.allowMac, "ứng dụng Mac"), (profile.allowMCP, "MCP")]
            .filter { !$0.0 }.map(\.1)
        return off.isEmpty ? "Không" : off.joined(separator: ", ")
    }

    var body: some View {
        Section {
            Toggle("Chạy lệnh shell", isOn: $draft.allowShell)
            Toggle("Tìm kiếm và đọc trang web", isOn: $draft.allowWeb)
            Toggle("Ghi file trong thư mục làm việc", isOn: $draft.allowFileWrite)
            Toggle("Lịch, Lời nhắc, Ghi chú, hẹn giờ, nháp thư", isOn: $draft.allowMac)
            Toggle("Công cụ MCP (mcp.json)", isOn: $draft.allowMCP)
        } header: {
            Text("Công cụ được dùng")
        } footer: {
            Text("Đọc, liệt kê và tìm file trong thư mục làm việc luôn bật. Lệnh shell, ghi file, MCP và mọi thao tác thay đổi vẫn hỏi bạn trước mỗi lần.")
                .font(.caption).foregroundStyle(.secondary)
        }
        Section {
            LabeledContent("Thư mục") {
                Text(Self.workspaceLabel(draft)).lineLimit(1).truncationMode(.middle).textSelection(.enabled)
            }
            HStack {
                Button("Chọn thư mục…") { chooseFolder() }
                Button("Dùng mặc định") { draft.workspace = "" }.disabled(draft.workspace.isEmpty)
            }
            if draft.workspace == FileManager.default.homeDirectoryForCurrentUser.path {
                Text("Cả thư mục home: \(draft.assistantName) đọc được mọi tài liệu của bạn mà không hỏi.")
                    .font(.caption).foregroundStyle(.orange)
            }
        } header: {
            Text("Thư mục làm việc")
        } footer: {
            Text("File tools chỉ chạy trong thư mục này. ~/.ssh, ~/.aws, Keychains và file .env luôn bị chặn.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private func chooseFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.prompt = "Chọn"
        panel.message = "Thư mục \(draft.assistantName) được làm việc"
        if panel.runModal() == .OK, let url = panel.url { draft.workspace = url.path }
    }
}

/// Any OpenAI-compatible `/chat/completions` endpoint; presets fill the URL, the list and test call the endpoint itself.
private struct AgentPageView: View {
    @Binding var draft: Profile
    let store: ProfileStore
    @State private var keyInput = ""
    @State private var keyStatus = ""
    @State private var keyError = ""
    @State private var models: [String] = []
    @State private var probing = false
    @State private var probeResult = ""
    @State private var probeError = ""
    @State private var trusted: [String] = []

    private static let providers: [(name: String, url: String)] = [
        ("OpenAI", "https://api.openai.com/v1"),
        ("OpenRouter", "https://openrouter.ai/api/v1"),
        ("Google Gemini", "https://generativelanguage.googleapis.com/v1beta/openai"),
        ("Groq", "https://api.groq.com/openai/v1"),
        ("opencode Go", "https://opencode.ai/zen/go/v1"),
        ("Ollama (trên máy này)", "http://localhost:11434/v1"),
        ("LM Studio (trên máy này)", "http://localhost:1234/v1"),
    ]

    private var endpoint: URL? { agentEndpoint(draft.agentBaseURL) }

    /// The key a test call uses: one typed but not saved yet, then Keychain, then the environment variable.
    private var probeKey: String? {
        if !keyInput.isEmpty { return keyInput }
        if let endpoint, let saved = TiboCredentials.load(baseURL: endpoint) { return saved }
        return ProcessInfo.processInfo.environment[draft.agentAPIKeyEnv.trimmingCharacters(in: .whitespacesAndNewlines)]
    }

    var body: some View {
        Form {
            Section {
                Picker("Nhà cung cấp", selection: Binding(
                    get: {
                        let current = draft.agentBaseURL.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: "/")))
                        return Self.providers.first { $0.url == current }?.url ?? ""
                    },
                    set: { if !$0.isEmpty { draft.agentBaseURL = $0 } })) {
                    ForEach(Self.providers, id: \.url) { Text($0.name).tag($0.url) }
                    Text("Tùy chỉnh").tag("")
                }
                TextField("Endpoint API", text: $draft.agentBaseURL, prompt: Text("Dán URL, ví dụ https://…/v1"))
                    .textContentType(.URL)
                    .accessibilityLabel("Endpoint API của Tibo Agent")
            } header: {
                Text("Nhà cung cấp")
            } footer: {
                Text("Bất kỳ endpoint tương thích OpenAI. Ollama và LM Studio chạy trên máy này, thường không cần key.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section {
                SecureField("API key mới", text: $keyInput)
                    .textContentType(.password)
                    .accessibilityLabel("API key mới")
                HStack {
                    Button("Lưu key") { saveKey() }.disabled(endpoint == nil || keyInput.isEmpty)
                    Button("Xoá key", role: .destructive) { deleteKey() }.disabled(endpoint == nil)
                }
                if !keyStatus.isEmpty {
                    Text(keyStatus).font(.caption).foregroundStyle(.secondary)
                }
                if !keyError.isEmpty {
                    Text(keyError).font(.caption).foregroundStyle(.red)
                        .accessibilityLabel("Lỗi: \(keyError)")
                }
                TextField("Hoặc đọc từ biến môi trường", text: $draft.agentAPIKeyEnv, prompt: Text("TIBO_API_KEY"))
                    .accessibilityLabel("Tên biến môi trường API key")
            } header: {
                Text("API key")
            } footer: {
                Text("Key lưu trong Chuỗi khóa theo từng endpoint, không nằm trong profile.").font(.caption).foregroundStyle(.secondary)
            }
            Section("Model") {
                HStack {
                    TextField("Tên model", text: $draft.agentModel, prompt: Text("Ví dụ: gpt-4o-mini"))
                        .accessibilityLabel("Tên model")
                    Menu("Chọn") {
                        ForEach(models, id: \.self) { model in Button(model) { draft.agentModel = model } }
                    }
                    .fixedSize()
                    .disabled(models.isEmpty)
                    .help(models.isEmpty ? "Bấm Tải danh sách model trước" : "\(models.count) model")
                    .accessibilityLabel("Chọn model từ danh sách")
                }
                HStack {
                    Button("Tải danh sách model") { Task { await loadModels() } }
                        .disabled(endpoint == nil || probing)
                    Button("Kiểm tra kết nối") { Task { await testConnection() } }
                        .disabled(endpoint == nil || draft.agentModel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || probing)
                    if probing { ProgressView().controlSize(.small).accessibilityLabel("Đang kiểm tra") }
                }
                if !probeResult.isEmpty {
                    Label(probeResult, systemImage: "checkmark.circle.fill").font(.caption).foregroundStyle(.green)
                }
                if !probeError.isEmpty {
                    Label(probeError, systemImage: "exclamationmark.triangle.fill").font(.caption).foregroundStyle(.red)
                        .accessibilityLabel("Lỗi: \(probeError)")
                }
            }
            Section {
                if trusted.isEmpty {
                    Text("Chưa nhớ lệnh nào. Khi Tibo xin phép chạy lệnh, tick “Nhớ lệnh này” để lần sau không hỏi lại.")
                        .font(.caption).foregroundStyle(.secondary)
                } else {
                    ForEach(trusted, id: \.self) { prefix in
                        HStack {
                            Text(prefix).font(.system(size: 11, design: .monospaced)).lineLimit(2).textSelection(.enabled)
                            Spacer()
                            Button("Quên") {
                                trusted.removeAll { $0 == prefix }
                                NotificationCenter.default.post(name: .tiboForgetTrusted, object: prefix)
                            }
                            .accessibilityLabel("Quên lệnh \(prefix)")
                        }
                    }
                }
            } header: {
                Text("Lệnh đã nhớ")
            } footer: {
                Text("Lưu trong ~/.local/share/tibo/trusted.json. “Quên” thì lần sau Tibo hỏi lại.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .onAppear {
            refreshKeyStatus()
            reloadTrusted()
            if !store.credentialMigrationError.isEmpty {
                keyError = store.credentialMigrationError
            }
        }
        .onChange(of: draft.agentBaseURL) { _, _ in
            refreshKeyStatus()
            models = []
            probeResult = ""
            probeError = ""
        }
    }

    /// The agent owns trusted.json; Settings only reads it and asks the agent to drop entries.
    private func reloadTrusted() {
        let url = ProfileStore.dataDir.appendingPathComponent("trusted.json")
        guard let data = try? Data(contentsOf: url),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { trusted = []; return }
        trusted = (object["shell"] as? [String]) ?? []
    }

    private func loadModels() async {
        guard let endpoint else { return }
        probing = true; probeResult = ""; probeError = ""
        defer { probing = false }
        do {
            models = try await ModelProbe.models(base: endpoint, key: probeKey)
            probeResult = models.isEmpty ? "Endpoint không trả về model nào; nhập tên model bằng tay." : "Tìm thấy \(models.count) model. Bấm Chọn để chọn."
            announceAccessibility(probeResult)
        } catch {
            probeError = ModelProbe.message(error)
            announceAccessibility(probeError, priority: .high)
        }
    }

    private func testConnection() async {
        guard let endpoint else { return }
        let model = draft.agentModel.trimmingCharacters(in: .whitespacesAndNewlines)
        probing = true; probeResult = ""; probeError = ""
        defer { probing = false }
        let started = Date()
        do {
            try await ModelProbe.ping(base: endpoint, model: model, key: probeKey)
            probeResult = String(format: "Kết nối được: %@ trả lời sau %.1f giây.", model, Date().timeIntervalSince(started))
            announceAccessibility(probeResult)
        } catch {
            probeError = ModelProbe.message(error)
            announceAccessibility(probeError, priority: .high)
        }
    }

    private func refreshKeyStatus() {
        keyError = ""
        guard let endpoint else { keyStatus = ""; return }
        keyStatus = TiboCredentials.load(baseURL: endpoint) == nil ? "Chưa có key cho endpoint này." : "Đã có key trong Chuỗi khóa."
    }

    private func saveKey() {
        guard let endpoint else { keyError = "Nhập endpoint hợp lệ trước khi lưu key."; return }
        do {
            try TiboCredentials.save(key: keyInput, baseURL: endpoint)
            store.credentialsChanged()
            keyInput = ""
            keyStatus = "Đã lưu key trong Chuỗi khóa."
            keyError = ""
        } catch { keyError = error.localizedDescription }
    }

    private func deleteKey() {
        guard let endpoint else { return }
        do {
            try TiboCredentials.delete(baseURL: endpoint)
            store.credentialsChanged()
            keyInput = ""
            keyStatus = "Đã xóa key khỏi Chuỗi khóa."
            keyError = ""
        } catch { keyError = error.localizedDescription }
    }
}

/// Direct calls to the configured endpoint from the setup UI; the runtime makes the real requests.
private enum ModelProbe {
    struct HTTPError: Error { let status: Int; let detail: String }

    static func models(base: URL, key: String?) async throws -> [String] {
        let data = try await send(base.appendingPathComponent("models"), key: key)
        let rows = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["data"] as? [[String: Any]] ?? []
        return rows.compactMap { $0["id"] as? String }.sorted()
    }

    /// One tiny non-streaming completion: proves endpoint, key and model name together.
    static func ping(base: URL, model: String, key: String?) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["model": model, "stream": false, "messages": [["role": "user", "content": "Reply with OK."]]])
        _ = try await send(base.appendingPathComponent("chat/completions"), key: key, body: body)
    }

    static func message(_ error: Error) -> String {
        guard let error = error as? HTTPError else { return "Không kết nối được: \(error.localizedDescription)" }
        let reason = switch error.status {
        case 401, 403: "Key sai, thiếu key hoặc không có quyền"
        case 404: "Không thấy endpoint hoặc model này"
        case 429: "Bị giới hạn tốc độ hoặc hết hạn mức"
        default: "Máy chủ trả lỗi"
        }
        return "\(reason) (HTTP \(error.status))" + (error.detail.isEmpty ? "." : ": \(error.detail)")
    }

    private static func send(_ url: URL, key: String?, body: Data? = nil) async throws -> Data {
        var request = URLRequest(url: url, timeoutInterval: 30)
        if let key, !key.isEmpty { request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.httpMethod = "POST"
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            let detail = (json?["error"] as? [String: Any])?["message"] as? String ?? json?["error"] as? String ?? ""
            throw HTTPError(status: status, detail: String(detail.prefix(160)))
        }
        return data
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
        var env = RuntimeEnvironment.environment()
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
    @AccessibilityFocusState private var downloadErrorFocused: Bool

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
                        if let path {
                            Button {
                                draft.whisperModel = path
                            } label: {
                                HStack {
                                    modelLabel(entry, selected: selected, recommended: recommended)
                                    Spacer()
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(modelAccessibilityLabel(entry, installed: true, recommended: recommended))
                            .accessibilityValue(selected ? "Đã chọn" : "Chưa chọn")
                            .accessibilityAddTraits(selected ? .isSelected : [])
                        } else {
                            HStack {
                                modelLabel(entry, selected: selected, recommended: recommended)
                                Spacer()
                                if downloader.active?.id == entry.id {
                                    ProgressView(value: downloader.progress)
                                        .frame(width: 90)
                                        .accessibilityLabel("Đang tải \(entry.label)")
                                        .accessibilityValue("\(Int(downloader.progress * 100)) phần trăm")
                                } else if entry.id == recommended.id {
                                    Button("Tải về") { download(entry) }
                                        .tiboProminent()
                                        .disabled(downloader.active != nil)
                                } else {
                                    Button("Tải về") { download(entry) }
                                        .disabled(downloader.active != nil)
                                }
                            }
                        }
                    }
                    Text(WhisperCatalog.machineSummary()).font(.caption).foregroundStyle(.secondary)
                    if !downloader.error.isEmpty {
                        Text(downloader.error)
                            .font(.caption)
                            .foregroundStyle(.red)
                            .accessibilityLabel("Lỗi: \(downloader.error)")
                            .accessibilityFocused($downloadErrorFocused)
                    }
                }
            }
        }.formStyle(.grouped)
        .onChange(of: downloader.error) { _, error in
            guard !error.isEmpty else { return }
            announceAccessibility(error, priority: .high)
            downloadErrorFocused = true
        }
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

    private func modelLabel(_ entry: WhisperCatalog.Entry, selected: Bool, recommended: WhisperCatalog.Entry) -> some View {
        HStack {
            Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                .foregroundStyle(selected ? Color.accentColor : Color.secondary)
            VStack(alignment: .leading) {
                Text(entry.label + (entry.id == recommended.id ? " · Đề xuất cho máy này" : ""))
                Text(ByteCountFormatter.string(fromByteCount: entry.bytes, countStyle: .file) + (WhisperCatalog.installed(entry) == nil ? " · chưa tải" : " · đã có"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func modelAccessibilityLabel(_ entry: WhisperCatalog.Entry, installed: Bool, recommended: WhisperCatalog.Entry) -> String {
        "\(entry.label), \(entry.id == recommended.id ? "đề xuất, " : "")\(installed ? "đã có" : "chưa tải")"
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

/// Voice training as Form sections, shown under the wake words on the voice page.
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
                    Button { draft.vocabulary.remove(at: index) } label: { Image(systemName: "trash") }.buttonStyle(.borderless).accessibilityLabel("Xoá \(term.word)")
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
            .buttonStyle(.borderedProminent).tint(active ? .red : TiboStyle.accent).foregroundStyle(active ? .white : TiboStyle.onAccent)
            .accessibilityLabel(active ? "Dừng ghi âm" : title)
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
        DispatchQueue.global(qos: .userInitiated).async { finish(0, TiboProcess.run(arguments: ["--transcribe", url.path], environment: RuntimeEnvironment.environment())) }
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
    private let microphone: Bool
    init(store: ProfileStore, microphone: Bool) { _store = ObservedObject(wrappedValue: store); self.microphone = microphone }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if microphone {
                PermissionRow(title: "Microphone", status: microphoneStatus) { AVCaptureDevice.requestAccess(for: .audio) { _ in Task { @MainActor in refresh += 1 } } }
                PermissionRow(title: "Nhận dạng giọng nói", status: speechStatus) { SFSpeechRecognizer.requestAuthorization { _ in Task { @MainActor in refresh += 1 } } }
            }
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
    private func run() { running = true; output = ""; DispatchQueue.global(qos: .userInitiated).async { let result = TiboProcess.run(arguments: ["--doctor"], environment: RuntimeEnvironment.environment()); Task { @MainActor in output = result; running = false } } }
}

/// Wake words, voice training, listening mode and spoken replies; only shown with the microphone on.
private struct VoiceSections: View {
    @Binding var draft: Profile
    let store: ProfileStore
    var body: some View {
        Section {
            ForEach(Array(draft.wakeWords.enumerated()), id: \.offset) { index, word in
                HStack {
                    TextField("Từ gọi", text: Binding(get: { draft.wakeWords.indices.contains(index) ? draft.wakeWords[index] : "" },
                                                      set: { if draft.wakeWords.indices.contains(index) { draft.wakeWords[index] = $0 } }),
                              prompt: Text("Ví dụ: Ti bô"))
                        .labelsHidden()
                    Button { draft.wakeWords.remove(at: index) } label: {
                        Image(systemName: "minus.circle").frame(width: 28, height: 28).contentShape(Rectangle())
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Xoá từ gọi \(word)")
                }
            }
            Button("Thêm từ gọi") { draft.wakeWords.append("") }
        } header: {
            Text("Từ gọi thêm")
        } footer: {
            Text("Nói “\(draft.assistantName) ơi …” để gọi; các từ ở đây cũng đánh thức \(draft.assistantName).").font(.caption).foregroundStyle(.secondary)
        }
        TrainingSections(draft: $draft, store: store)
        Section("Cách gọi \(draft.assistantName)") {
            Picker("Cách gọi", selection: $draft.voiceMode) {
                ForEach(Profile.VoiceMode.allCases) { Text($0 == .wake ? "Gọi tên “\(draft.assistantName)”, luôn lắng nghe" : $0.title).tag($0) }
            }.pickerStyle(.radioGroup).labelsHidden()
            Text("Hai chế độ bấm mic dùng nút mic trên notch và không cần gọi tên.").font(.caption).foregroundStyle(.secondary)
        }
        Section("Trả lời bằng giọng") {
            Toggle("Cho \(draft.assistantName) nói", isOn: $draft.speakReplies)
            Text("Khi không đọc, câu trả lời hiện chữ trên notch.").font(.caption).foregroundStyle(.secondary)
        }
    }
}

/// Placement, global shortcut, shortcut chips and auto-collapse delay.
private struct NotchSections: View {
    @Binding var draft: Profile
    var body: some View {
        Section("Vị trí") {
            Picker("Vị trí", selection: $draft.notchPosition) {
                ForEach(Profile.NotchPosition.allCases) { Text($0.title).tag($0) }
            }.pickerStyle(.segmented).labelsHidden()
            LabeledContent(String(format: "Tự thu lại sau %.1f giây khi không dùng", draft.collapseDelay)) { Slider(value: $draft.collapseDelay, in: 0.3...5, step: 0.1) }
        }
        Section {
            HotkeyRecorder(hotkey: $draft.hotkey)
        } header: {
            Text("Phím tắt")
        } footer: {
            Text("Mở hoặc thu notch từ bất kỳ ứng dụng nào. Cần ít nhất một phím ⌃, ⌥ hoặc ⌘; Esc để hủy.").font(.caption).foregroundStyle(.secondary)
        }
        Section {
            ForEach($draft.quickPrompts) { $item in
                HStack {
                    TextField("Nhãn", text: $item.title, prompt: Text("Lịch hôm nay"))
                        .labelsHidden().frame(width: 140)
                        .accessibilityLabel("Nhãn gợi ý")
                    TextField("Câu gửi đi", text: $item.prompt, prompt: Text("Hôm nay mình có lịch gì?"))
                        .labelsHidden()
                        .accessibilityLabel("Câu gửi khi bấm gợi ý \(item.title)")
                    Button { draft.quickPrompts.removeAll { $0.id == item.id } } label: {
                        Image(systemName: "minus.circle").frame(width: 28, height: 28).contentShape(Rectangle())
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Xoá gợi ý \(item.title)")
                }
            }
            Button("Thêm gợi ý") { draft.quickPrompts.append(.init(title: "", prompt: "")) }
                .disabled(draft.quickPrompts.count >= Profile.maxQuickPrompts)
        } header: {
            Text("Gợi ý nhanh")
        } footer: {
            Text("Tối đa \(Profile.maxQuickPrompts) nút trên notch trống, cạnh Đọc màn hình và Đính kèm tệp. Bấm là gửi câu đó.").font(.caption).foregroundStyle(.secondary)
        }
    }
}

/// Click, then press the new combination. The local monitor only sees keys while this window is key.
private struct HotkeyRecorder: View {
    @Binding var hotkey: Profile.Hotkey
    @State private var monitor: Any?
    private static let keyNames: [Int: String] = [kVK_Space: "Space", kVK_Return: "↩"]

    var body: some View {
        LabeledContent("Mở notch") {
            HStack {
                Button(monitor == nil ? hotkey.label : "Nhấn tổ hợp phím…") { monitor == nil ? start() : stop() }
                    .accessibilityLabel(monitor == nil ? "Phím tắt mở notch: \(hotkey.spoken). Bấm để đổi" : "Đang chờ tổ hợp phím mới")
                Button("Mặc định") { hotkey = Profile.Hotkey() }
                    .disabled(hotkey == Profile.Hotkey())
            }
        }
        .onDisappear { stop() }
    }

    private func start() {
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            if Int(event.keyCode) == kVK_Escape { stop(); return nil }
            let flags = event.modifierFlags.intersection([.control, .option, .shift, .command])
            guard !flags.subtracting(.shift).isEmpty else { NSSound.beep(); return nil }
            var carbon: UInt32 = 0
            if flags.contains(.control) { carbon |= UInt32(controlKey) }
            if flags.contains(.option) { carbon |= UInt32(optionKey) }
            if flags.contains(.shift) { carbon |= UInt32(shiftKey) }
            if flags.contains(.command) { carbon |= UInt32(cmdKey) }
            let name = Self.keyNames[Int(event.keyCode)] ?? event.charactersIgnoringModifiers?.uppercased() ?? "?"
            hotkey = Profile.Hotkey(keyCode: UInt32(event.keyCode), modifiers: carbon, key: name)
            announceAccessibility("Phím tắt mới: \(hotkey.spoken)")
            stop()
            return nil
        }
    }

    private func stop() {
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
    }
}

/// Onboarding step that makes the user use the real notch once before finishing.
private struct TryItPageView: View {
    let draft: Profile
    @Binding var hovered: Bool
    @Binding var woke: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(draft.microphoneEnabled
                 ? "Làm thử một lần để chắc Tibo Agent và notch chạy đúng trên máy bạn."
                 : "Mở notch và gửi một tin nhắn chữ để thử Tibo Agent.")
            check(hovered, "Bấm vào notch ở đỉnh màn hình, hoặc nhấn \(draft.hotkey.label)")
            if draft.microphoneEnabled {
                check(woke, draft.voiceMode == .wake ? "Nói “\(draft.assistantName)” kèm một câu" : "Bấm nút mic trên notch rồi nói một câu")
            } else {
                Text("Khi notch mở, nhập câu hỏi vào ô văn bản rồi gửi. Bạn có thể bật microphone sau trong Cài đặt.")
                    .font(.callout).foregroundStyle(.secondary)
            }
            BuddyFace(mood: woke ? .happy : hovered ? .surprised : .idle, hearing: false)
                .frame(width: 208, height: 120)
                .background(.black).clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                .frame(maxWidth: .infinity)
                .accessibilityHidden(true)
            if draft.microphoneEnabled && hovered && !woke {
                Text("Phần giọng nói có thể bỏ qua nếu bạn đang ở chỗ ồn.").font(.caption).foregroundStyle(.secondary)
            }
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
    @State private var selection: OnboardingPage? = .persona
    @State private var draft: Profile
    @State private var saveError = ""

    init(store: ProfileStore) { _store = ObservedObject(wrappedValue: store); _draft = State(initialValue: store.profile) }

    var body: some View {
        HStack(spacing: 0) {
            List(selection: $selection) {
                ForEach(OnboardingPage.settings, id: \.self) { page in
                    Label(page.title, systemImage: page.symbol).tag(Optional(page))
                }
            }
            .listStyle(.sidebar)
            .frame(width: 200)
            Divider()
            VStack(spacing: 0) {
                ScrollView { SetupPageView(page: selection ?? .persona, draft: $draft, store: store, onboarding: false).padding(28) }
                    .id(selection)
                Divider()
                VStack(alignment: .trailing, spacing: 6) {
                    if !saveError.isEmpty {
                        Text(saveError).font(.caption).foregroundStyle(.red).accessibilityLabel("Lỗi: \(saveError)")
                    }
                    HStack { Spacer(); Button("Lưu") { saveSettings() }.tiboProminent() }
                }
                .padding(.horizontal, 22).padding(.vertical, 14)
            }
        }
        .frame(minWidth: 720, minHeight: 560)
    }

    private func saveSettings() {
        if let problem = validate(&draft) {
            saveError = problem
            return
        }
        draft.onboarded = true
        store.save(draft)
        if store.persistenceError.isEmpty {
            TiboWindows.closeSettings()
        } else {
            saveError = "Không thể lưu profile: \(store.persistenceError)"
        }
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
