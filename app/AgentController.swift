import Foundation
import AppKit
import Combine

struct AgentMessage: Identifiable, Equatable {
    let id: UUID
    let role: String
    var content: String
    var timestamp: Date

    init(id: UUID = UUID(), role: String, content: String, timestamp: Date = Date()) {
        self.id = id
        self.role = role
        self.content = content
        self.timestamp = timestamp
    }

    /// The typed request without the attachment block the runtime appends for the model.
    var displayText: String { content.components(separatedBy: AgentAttachment.marker).first ?? content }

    /// `### name` headings of the attachment block, skipping lines inside the `~~~~` content fences.
    var attachmentNames: [String] {
        guard let range = content.range(of: AgentAttachment.marker) else { return [] }
        var fence: Substring?
        return content[range.upperBound...].split(separator: "\n", omittingEmptySubsequences: false).compactMap { line in
            if let open = fence { if line == open { fence = nil }; return nil }
            if line.hasPrefix("~~~~") { fence = line; return nil }
            return line.hasPrefix("### ") ? String(line.dropFirst(4)) : nil
        }
    }
}

struct AgentSession: Identifiable, Equatable {
    let id: String
    var title: String
    var updated: Date

    /// The runtime's placeholder before the first request names the session.
    var displayTitle: String { title == "New session" || title.isEmpty ? "Phiên mới" : title }
}

struct AgentToolCall: Identifiable, Equatable {
    let id: String
    let name: String
    var arguments: String
    var result: String?
    var failed = false
    var timestamp = Date()
}

struct AgentApproval: Equatable {
    let id: String
    let tool: String
    let arguments: String
    /// What "remember" would trust from now on, as the runtime computes it; empty = cannot be remembered.
    var remember = ""
}

private final class AgentLineReader {
    private var buffer = Data()
    private let handler: (String) -> Void

    init(handler: @escaping (String) -> Void) { self.handler = handler }

    func feed(_ data: Data) {
        if data.isEmpty {
            if !buffer.isEmpty { handler(String(decoding: buffer, as: UTF8.self)); buffer.removeAll() }
            return
        }
        buffer.append(data)
        while let newline = buffer.firstIndex(of: 0x0A) {
            handler(String(decoding: buffer[..<newline], as: UTF8.self))
            buffer.removeSubrange(...newline)
        }
    }
}

/// The notch's single owner for the Tibo Agent process. The child is a persistent JSONL server;
/// sessions and tool history live in the Python runtime, not in Swift UI state.
@MainActor
final class AgentController: NSObject, ObservableObject {
    enum State: String {
        case idle, running, waitingApproval = "waiting_approval", failed

        var label: String {
            switch self {
            case .idle: "Sẵn sàng"
            case .running: "Đang làm việc…"
            case .waitingApproval: "Chờ xác nhận"
            case .failed: "Lỗi agent"
            }
        }
    }

    @Published private(set) var state: State = .idle
    @Published private(set) var sessions: [AgentSession] = []
    @Published private(set) var messages: [AgentMessage] = []
    @Published private(set) var tools: [AgentToolCall] = []
    @Published private(set) var approval: AgentApproval?
    @Published private(set) var progress = ""
    @Published private(set) var error: String?
    @Published private(set) var selectedSessionID: String?
    /// Shell commands the user approved with "remember"; they no longer ask.
    @Published private(set) var trusted: [String] = []

    /// Voice uses this adapter only for playback; it never owns cancellation or agent lifecycle.
    var onAssistantText: ((String, Bool) -> Void)?

    private let store: ProfileStore
    private var profile: Profile
    private var profileSubscription: AnyCancellable?
    private var credentialSubscription: AnyCancellable?
    private static let runTypes: Set<String> = ["status", "delta", "message", "tool_start", "tool_result", "approval", "error", "done"]
    var isBusy: Bool { state == .running || state == .waitingApproval || currentRunID != nil }
    private var process: Process?
    private var input: FileHandle?
    private var stdoutReader: AgentLineReader?
    private var stderrReader: AgentLineReader?
    private var currentRunID: String?
    private var response = ""
    private var responseMessageID: UUID?
    private var terminalFailure = false
    private var isStopping = false
    /// Set while attachments are read off the main thread; Stop clears it so the turn is never sent.
    private var preparingAttachments: UUID?
    private var attachmentFiles: [URL] = []

    init(store: ProfileStore) {
        self.store = store
        profile = store.profile
        super.init()
        profileSubscription = store.$profile.sink { [weak self] next in
            Task { @MainActor in self?.profileChanged(next) }
        }
        credentialSubscription = store.$credentialRevision.dropFirst().sink { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.stop()
                self.isStopping = false
                self.start()
            }
        }
        start()
    }

    deinit {
        input?.closeFile()
        if let process { process.terminate() }
    }

    /// Sends one user turn. Attachments are read off the main thread before the command goes out.
    func prompt(_ text: String, attachments: [AgentAttachment] = [], sessionID: String? = nil, context: String? = nil) {
        var value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty && !attachments.isEmpty { value = "Xem giúp mình các tệp đính kèm." }
        guard !value.isEmpty else { return }
        guard !isBusy else {
            error = "Tác vụ đang chạy; hãy dừng hoặc chờ hoàn tất."
            return
        }
        guard ensureRunning(), process?.isRunning == true, input != nil else {
            error = error ?? "Agent chưa sẵn sàng."
            state = .failed
            return
        }
        let sid = sessionID ?? selectedSessionID
        if selectedSessionID == nil { selectedSessionID = sid }
        let names = attachments.prefix(AgentAttachment.limit).map { "### " + $0.name }
        messages.append(AgentMessage(role: "user", content: names.isEmpty ? value : value + AgentAttachment.marker + "\n" + names.joined(separator: "\n")))
        response = ""
        responseMessageID = nil
        currentRunID = nil
        terminalFailure = false
        approval = nil
        error = nil
        state = .running
        progress = "Đang làm việc…"
        var command: [String: Any] = ["type": "prompt", "text": value]
        if let sid { command["session_id"] = sid }
        if let context, !context.isEmpty { command["context"] = context }
        guard !attachments.isEmpty else { send(command); return }
        progress = "Đang đọc tệp đính kèm…"
        let token = UUID(), base = command
        preparingAttachments = token
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let payload = AgentAttachment.payload(for: attachments)
            Task { @MainActor in
                guard let self, self.preparingAttachments == token else {
                    payload.temporary.forEach { try? FileManager.default.removeItem(at: $0) }
                    return
                }
                self.preparingAttachments = nil
                self.attachmentFiles += payload.temporary
                var ready = base
                ready["attachments"] = payload.attachments
                self.send(ready)
            }
        }
    }

    func newSession() {
        guard !isBusy else {
            error = "Tác vụ đang chạy; hãy dừng hoặc chờ hoàn tất."
            return
        }
        guard ensureRunning() else { return }
        messages = []
        tools = []
        approval = nil
        response = ""
        responseMessageID = nil
        selectedSessionID = nil
        send(["type": "new"])
    }

    func loadSession(_ id: String) {
        guard !isBusy else {
            error = "Tác vụ đang chạy; hãy dừng hoặc chờ hoàn tất."
            return
        }
        guard ensureRunning() else { return }
        selectedSessionID = id
        messages = []
        tools = []
        approval = nil
        send(["type": "load", "session_id": id])
    }

    func renameSession(_ id: String, to title: String) {
        let value = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, ensureRunning() else { return }
        if let index = sessions.firstIndex(where: { $0.id == id }) { sessions[index].title = value }
        send(["type": "rename", "session_id": id, "title": value])
    }

    /// Deletes a session and its history; deleting the open one leaves an empty conversation.
    func deleteSession(_ id: String) {
        guard !isBusy else {
            error = "Tác vụ đang chạy; hãy dừng hoặc chờ hoàn tất."
            return
        }
        guard ensureRunning() else { return }
        sessions.removeAll { $0.id == id }
        if selectedSessionID == id {
            selectedSessionID = nil
            messages = []
            tools = []
        }
        send(["type": "delete", "session_id": id])
    }

    func refreshSessions() {
        guard ensureRunning() else { return }
        send(["type": "sessions"])
    }

    /// Explicit cancellation is separate from stopping TTS and from collapsing the notch.
    func cancel() {
        if preparingAttachments != nil {
            preparingAttachments = nil
            state = .idle
            progress = "Đã dừng"
            return
        }
        guard state == .running || state == .waitingApproval else { return }
        send(["type": "cancel"])
    }

    func approve(_ allow: Bool, remember: Bool = false) {
        guard let approval else { return }
        var command: [String: Any] = ["type": "approve", "approval_id": approval.id, "allow": allow]
        if remember { command["remember"] = true }
        send(command)
        self.approval = nil
        state = .running
    }

    func refreshTrusted() {
        guard ensureRunning() else { return }
        send(["type": "trusted"])
    }

    func forgetTrusted(_ prefix: String) {
        guard ensureRunning() else { return }
        trusted.removeAll { $0 == prefix }
        send(["type": "forget", "prefix": prefix])
    }

    /// Captures the screen and hands it over like a dropped image: the question stays the visible message,
    /// the capture becomes an attachment (JPEG for vision models, OCR text for the rest).
    func readScreen(question: String = "Hãy mô tả màn hình hiện tại.") {
        guard CGPreflightScreenCaptureAccess() else {
            CGRequestScreenCaptureAccess()
            error = "Cần quyền Ghi màn hình trong Cài đặt hệ thống."
            return
        }
        guard !isBusy else {
            error = "Tác vụ đang chạy; hãy dừng hoặc chờ hoàn tất."
            return
        }
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("tibo-screen-\(UUID().uuidString)")
        let url = folder.appendingPathComponent("Màn hình.jpg")
        let app = NSWorkspace.shared.frontmostApplication?.localizedName ?? ""
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let captured = Self.capture(to: url)
            Task { @MainActor in
                guard let self, captured, let attachment = AgentAttachment(url: url) else {
                    try? FileManager.default.removeItem(at: folder)
                    self?.error = "Không chụp được màn hình."
                    return
                }
                self.prompt(question, attachments: [attachment], context: app.isEmpty ? nil : "Ứng dụng đang dùng: \(app)")
                if self.state == .running { self.attachmentFiles.append(folder) } else { try? FileManager.default.removeItem(at: folder) }
            }
        }
    }

    func stop() {
        isStopping = true
        if process?.isRunning == true { send(["type": "shutdown"]) }
        input?.closeFile()
        input = nil
        stdoutReader = nil
        stderrReader = nil
        approval = nil
        finishAttachments()
        currentRunID = nil
        response = ""
        responseMessageID = nil
        terminalFailure = false
        state = .idle
        onAssistantText?("", true)
        if let process { process.terminate() }
        self.process = nil
    }

    private func start() {
        guard process == nil else { return }
        guard let script = scriptURL(), let python = pythonURL() else {
            error = "Không tìm thấy Python hoặc scripts/tibo_agent.py."
            terminalFailure = true
            state = .failed
            return
        }
        let process = Process()
        let stdin = Pipe(), stdout = Pipe(), stderr = Pipe()
        process.executableURL = python
        process.arguments = [script.path, "--serve", "--data-dir", ProfileStore.dataDir.path]
        var environment = RuntimeEnvironment.environment()
        environment["TIBO_BASE_URL"] = profile.agentBaseURL
        environment["TIBO_MODEL"] = profile.agentModel
        let keyName = profile.agentAPIKeyEnv.nilIfEmpty ?? "TIBO_API_KEY"
        if environment[keyName] == nil, let baseURL = URL(string: profile.agentBaseURL), let key = TiboCredentials.load(baseURL: baseURL) {
            environment[keyName] = key
        }
        process.environment = environment
        process.standardInput = stdin
        process.standardOutput = stdout
        process.standardError = stderr
        let reader = AgentLineReader { [weak self, weak process] line in
            DispatchQueue.main.async {
                guard let self, let process, self.process === process else { return }
                self.handle(line)
            }
        }
        let stderrReader = AgentLineReader { line in
            guard !line.isEmpty else { return }
            print("TIBO_AGENT stderr_received")
        }
        stdout.fileHandleForReading.readabilityHandler = { reader.feed($0.availableData) }
        stderr.fileHandleForReading.readabilityHandler = { stderrReader.feed($0.availableData) }
        process.terminationHandler = { [weak self] ended in
            stdout.fileHandleForReading.readabilityHandler = nil
            stderr.fileHandleForReading.readabilityHandler = nil
            DispatchQueue.main.async {
                guard let self, self.process === ended else { return }
                self.process = nil
                self.input = nil
                self.stdoutReader = nil
                self.stderrReader = nil
                self.finishAttachments()
                self.approval = nil
                if !self.isStopping {
                    self.terminalFailure = true
                    self.state = .failed
                    self.error = "Agent đã dừng (mã \(ended.terminationStatus))."
                    self.onAssistantText?("", true)
                }
                self.isStopping = false
            }
        }
        do {
            try process.run()
            self.process = process
            input = stdin.fileHandleForWriting
            stdoutReader = reader
            self.stderrReader = stderrReader
        } catch {
            self.error = "Không khởi chạy được agent."
            terminalFailure = true
            state = .failed
        }
    }

    private func ensureRunning() -> Bool {
        if process?.isRunning != true { isStopping = false; start() }
        return process?.isRunning == true
    }

    private func profileChanged(_ next: Profile) {
        let changed = next.agentSettings != profile.agentSettings
        profile = next
        if changed {
            stop()
            isStopping = false
            start()
        }
    }

    private func scriptURL() -> URL? {
        let env = ProcessInfo.processInfo.environment
        if let override = env["TIBO_AGENT_SCRIPT"], !override.isEmpty { return URL(fileURLWithPath: override) }
        let candidates = [
            Bundle.main.resourceURL?.appendingPathComponent("tibo_agent.py"),
            URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent("scripts/tibo_agent.py"),
            ProfileStore.dataDir.appendingPathComponent("runtime/tibo_agent.py")
        ].compactMap { $0 }
        return candidates.first { FileManager.default.fileExists(atPath: $0.path) }
    }

    private func pythonURL() -> URL? {
        let paths = RuntimeEnvironment.searchPath
        let names = ["python3"]
        for directory in paths {
            for name in names {
                let url = URL(fileURLWithPath: directory).appendingPathComponent(name)
                if FileManager.default.isExecutableFile(atPath: url.path) { return url }
            }
        }
        return ["/usr/bin/python3", "/opt/homebrew/bin/python3", "/usr/local/bin/python3"].lazy.map(URL.init(fileURLWithPath:)).first { FileManager.default.isExecutableFile(atPath: $0.path) }
    }

    private func send(_ command: [String: Any]) {
        guard process?.isRunning == true, let input else {
            error = "Agent chưa sẵn sàng để nhận lệnh."
            terminalFailure = true
            state = .failed
            return
        }
        guard var data = try? JSONSerialization.data(withJSONObject: command) else {
            error = "Lệnh agent không hợp lệ."
            terminalFailure = true
            state = .failed
            return
        }
        data.append(0x0A)
        do {
            try input.write(contentsOf: data)
        } catch {
            self.error = "Không gửi được lệnh cho agent."
            terminalFailure = true
            state = .failed
        }
    }

    private func handle(_ line: String) {
        guard let data = line.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = object["type"] as? String else { return }
        // The runtime opened a fresh conversation for this prompt (idle > 4 h or a new day): follow it.
        if type == "status", object["new_session"] as? Bool == true, currentRunID == nil, state == .running,
           let sid = object["session_id"] as? String {
            selectedSessionID = sid
            messages = Array(messages.suffix(1))
            tools = []
        }
        if type != "ready" && type != "sessions", let sid = object["session_id"] as? String {
            if let selected = selectedSessionID, sid != selected { return }
            selectedSessionID = sid
        }
        if type == "session", state == .running || state == .waitingApproval { return }
        if Self.runTypes.contains(type), let runID = object["run_id"] as? String {
            if let currentRunID, currentRunID != runID { return }
            currentRunID = runID
        }
        guard !terminalFailure || type == "ready" || type == "session" || type == "sessions" || type == "done" else { return }
        switch type {
        case "ready", "session":
            if state == .running || state == .waitingApproval {
                if let values = object["sessions"] as? [[String: Any]] { sessions = values.compactMap { session($0) } }
                return
            }
            if let sid = object["session_id"] as? String { selectedSessionID = sid }
            if let values = object["sessions"] as? [[String: Any]] { sessions = values.compactMap { session($0) } }
            if let values = object["messages"] as? [[String: Any]] { restore(values) }
            state = .idle
            terminalFailure = false
            send(["type": "sessions"])
        case "sessions":
            if let values = object["sessions"] as? [[String: Any]] ?? object["items"] as? [[String: Any]] { sessions = values.compactMap { session($0) } }
        case "trusted":
            trusted = (object["shell"] as? [String]) ?? []
        case "status":
            let raw = object["status"] as? String ?? "idle"
            if raw == "idle", currentRunID != nil { return }
            state = State(rawValue: raw) ?? .idle
            progress = object["message"] as? String ?? progress
        case "delta":
            let text = object["text"] as? String ?? ""
            guard !text.isEmpty else { return }
            response += text
            progress = "Đang trả lời…"
            if let id = responseMessageID, let index = messages.firstIndex(where: { $0.id == id }) { messages[index].content += text }
            else { let message = AgentMessage(role: "assistant", content: text); responseMessageID = message.id; messages.append(message) }
            onAssistantText?(text, false)
        case "message":
            let role = object["role"] as? String ?? "assistant"
            let content = object["content"] as? String ?? ""
            if role == "assistant", !content.isEmpty, responseMessageID == nil {
                messages.append(AgentMessage(role: role, content: content))
                response = content
            }
        case "tool_start":
            let call = AgentToolCall(id: object["call_id"] as? String ?? UUID().uuidString, name: object["name"] as? String ?? "tool", arguments: printable(object["arguments"]))
            tools.append(call)
            // Text after this tool step is a new message, so the timeline keeps the real order.
            responseMessageID = nil
            progress = "Đang gọi công cụ: \(ToolPresentation(name: call.name, arguments: call.arguments).title)…"
        case "tool_result":
            let id = object["call_id"] as? String ?? ""
            if let index = tools.firstIndex(where: { $0.id == id }) {
                tools[index].result = printable(object["content"])
                tools[index].failed = object["failed"] as? Bool ?? false
            }
            progress = "Đang suy nghĩ…"
        case "approval":
            approval = AgentApproval(id: object["approval_id"] as? String ?? "", tool: object["tool"] as? String ?? "tool",
                                     arguments: printable(object["arguments"]), remember: object["remember"] as? String ?? "")
            state = .waitingApproval
            progress = "Chờ xác nhận thao tác"
        case "error":
            terminalFailure = true
            error = object["message"] as? String ?? "Agent gặp lỗi."
            state = .failed
            approval = nil
            onAssistantText?("", true)
            response = ""
            responseMessageID = nil
            finishAttachments()
        case "done":
            let raw = object["status"] as? String ?? "completed"
            let failed = raw != "completed"
            if raw == "cancelled" { progress = "Đã dừng"; error = nil }
            else if raw == "failed" { progress = "Thất bại" }
            else { progress = "Hoàn tất" }
            approval = nil
            state = raw == "failed" ? .failed : .idle
            if failed { terminalFailure = true; onAssistantText?("", true) }
            else { onAssistantText?(response, true) }
            response = ""
            responseMessageID = nil
            currentRunID = nil
            finishAttachments()
            send(["type": "sessions"])
        default: break
        }
    }

    private func finishAttachments() {
        attachmentFiles.forEach { try? FileManager.default.removeItem(at: $0) }
        attachmentFiles = []
    }


    private func session(_ object: [String: Any]) -> AgentSession? {
        guard let id = object["id"] as? String ?? object["session_id"] as? String else { return nil }
        return AgentSession(id: id, title: object["title"] as? String ?? "", updated: Date(timeIntervalSince1970: object["updated"] as? Double ?? 0))
    }

    /// Rebuilds the transcript from runtime history: tool calls become timeline steps carrying their
    /// results; tool output never appears as a chat message.
    private func restore(_ history: [[String: Any]]) {
        var restored: [AgentMessage] = [], calls: [AgentToolCall] = []
        var clock = Date(timeIntervalSinceReferenceDate: 0)
        func next() -> Date { clock += 1; return clock }
        for item in history {
            let role = item["role"] as? String ?? ""
            if role == "tool" {
                if let id = item["tool_call_id"] as? String, let index = calls.firstIndex(where: { $0.id == id }) {
                    let result = printable(item["content"])
                    calls[index].result = result
                    calls[index].failed = result.hasPrefix("{\"error\"")
                }
                continue
            }
            if role == "user" || role == "assistant", let content = item["content"] as? String, !content.isEmpty {
                restored.append(AgentMessage(role: role, content: content, timestamp: next()))
            }
            for call in item["tool_calls"] as? [[String: Any]] ?? [] {
                let function = call["function"] as? [String: Any]
                calls.append(AgentToolCall(id: call["id"] as? String ?? UUID().uuidString, name: function?["name"] as? String ?? "tool",
                                           arguments: function?["arguments"] as? String ?? "", timestamp: next()))
            }
        }
        messages = restored
        tools = calls
    }

    private func printable(_ value: Any?) -> String {
        guard let value else { return "" }
        if let text = value as? String { return text }
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.withoutEscapingSlashes]), let text = String(data: data, encoding: .utf8) else { return String(describing: value) }
        return text
    }


    nonisolated private static func capture(to url: URL) -> Bool {
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let capture = Process()
        capture.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        capture.arguments = ["-x", "-m", "-t", "jpg", url.path]
        guard (try? capture.run()) != nil else { return false }
        capture.waitUntilExit()
        return capture.terminationStatus == 0
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
