import Foundation
import Security

/// Everything the user picks in onboarding. Persisted as snake_case JSON at `ProfileStore.url`;
/// direct agent endpoint/model keys and voice settings are shared with the runtime.
struct Profile: Codable, Equatable {
    /// A word the user taught by voice: `heard` holds what the recognizers produced for it.
    struct Term: Codable, Equatable, Hashable {
        var word: String
        var heard: [String] = []
    }

    var agentBaseURL = ""
    var agentModel = ""
    var agentAPIKeyEnv = "TIBO_API_KEY"

    enum TtsEngine: String, Codable, CaseIterable, Identifiable {
        case kokoro, system
        var id: String { rawValue }
    }

    /// whisper: resident whisper-server transcribes each turn (Apple Speech only for partials/fallback).
    /// apple: Apple Speech final transcript, no whisper-server. vietasr: backend sherpa-onnx VietASR.
    enum SttEngine: String, Codable, CaseIterable, Identifiable {
        case whisper, apple, vietasr
        var id: String { rawValue }
    }

    /// wake: always listening for the assistant's name. smart: tap the mic, the turn ends when you stop talking.
    /// startStop: tap to start, tap again to send.
    enum VoiceMode: String, Codable, CaseIterable, Identifiable {
        case wake, smart, startStop = "start_stop"
        var id: String { rawValue }
        var title: String {
            switch self {
            case .wake: "Gọi tên"
            case .smart: "Bấm mic, ngừng nói là gửi"
            case .startStop: "Bấm để bắt đầu, bấm lại để gửi"
            }
        }
    }

    enum NotchPosition: String, Codable, CaseIterable, Identifiable {
        case left, center, right
        var id: String { rawValue }
        var title: String { switch self { case .left: "Trái"; case .center: "Giữa"; case .right: "Phải" } }
    }

    enum ReplyLength: String, Codable, CaseIterable, Identifiable {
        case short, normal, detailed
        var id: String { rawValue }
        var title: String { switch self { case .short: "Ngắn gọn"; case .normal: "Vừa đủ"; case .detailed: "Chi tiết" } }
    }

    enum Tone: String, Codable, CaseIterable, Identifiable {
        case friendly, professional, playful
        var id: String { rawValue }
        var title: String { switch self { case .friendly: "Thân thiện"; case .professional: "Chuyên nghiệp"; case .playful: "Vui vẻ, hài hước" } }
    }

    /// Global shortcut that toggles the notch; Carbon key code and modifier mask (`cmdKey`, `controlKey`…).
    struct Hotkey: Codable, Equatable {
        var keyCode: UInt32 = 49 // kVK_Space
        var modifiers: UInt32 = 0x1000 | 0x0800 // controlKey | optionKey
        /// Key name as shown, e.g. "Space" or "K".
        var key = "Space"

        private static let names: [(UInt32, String, String)] = [(0x1000, "⌃", "Control"), (0x0800, "⌥", "Option"), (0x0200, "⇧", "Shift"), (0x0100, "⌘", "Command")]
        var label: String { Self.names.filter { modifiers & $0.0 != 0 }.map(\.1).joined() + key }
        /// What VoiceOver reads: "Control Option Space".
        var spoken: String { (Self.names.filter { modifiers & $0.0 != 0 }.map(\.2) + [key]).joined(separator: " ") }

        enum CodingKeys: String, CodingKey {
            case keyCode = "key_code"
            case modifiers, key
        }
    }

    /// A shortcut chip on the empty notch that sends `prompt`.
    struct QuickPrompt: Codable, Equatable, Identifiable {
        /// In-memory only, so the Settings rows keep focus while typing; ignored by `==`.
        var id = UUID()
        var title: String
        var prompt: String
        enum CodingKeys: String, CodingKey { case title, prompt }
        static func == (lhs: Self, rhs: Self) -> Bool { lhs.title == rhs.title && lhs.prompt == rhs.prompt }
    }

    /// The notch fits two custom chips beside "Đọc màn hình" and "Đính kèm tệp".
    static let maxQuickPrompts = 2

    var onboarded = false
    var userName = ""
    var assistantName = "Tibo"
    /// Spoken forms that wake the assistant (besides `assistantName`), including voice-learned variants.
    var wakeWords: [String] = ["Ti bo"]
    var vocabulary: [Term] = []
    /// Whether microphone input and voice-specific setup are enabled.
    var microphoneEnabled = false
    var ttsEngine: TtsEngine = .kokoro
    /// Kokoro voicepack id (e.g. "ngoc_huyen") or a macOS `say -v` voice name (e.g. "Linh").
    var ttsVoice = "ngoc_huyen"
    var sttEngine: SttEngine = .whisper
    /// File name inside `ProfileStore.modelsDir`.
    var whisperModel = "ggml-large-v3-turbo-q5_0.bin"
    var voiceMode: VoiceMode = .wake
    /// Master switch for spoken replies.
    var speakReplies = true
    var notchPosition: NotchPosition = .center
    /// Seconds an auto-opened notch stays open once Tibo is idle and the notch is not focused.
    var collapseDelay: Double = 1.2
    /// Agent memory (USER.md/MEMORY.md): off = no `memory` tool and no memory in the prompt.
    var memoryEnabled = true
    var pronounSelf = "mình"
    var pronounUser = "bạn"
    var replyLength: ReplyLength = .normal
    var tone: Tone = .friendly
    /// Free-form standing instructions appended to the agent prompt.
    var customInstructions = ""
    /// Folder the agent's file tools work in; empty = `dataDir/workspace`.
    var workspace = ""
    /// Tool groups the agent may use; an off group is hidden from the model and refused by the runtime.
    var allowShell = true
    var allowWeb = true
    var allowFileWrite = true
    var allowMac = true
    var allowMCP = true
    var hotkey = Hotkey()
    var quickPrompts = [QuickPrompt(title: "Lịch hôm nay", prompt: "Hôm nay mình có lịch gì?")]

    /// Fields the agent runtime reads at start; a change restarts it.
    var agentSettings: [String] {
        [agentBaseURL, agentModel, agentAPIKeyEnv, userName, assistantName, pronounSelf, pronounUser, replyLength.rawValue, tone.rawValue,
         customInstructions, workspace, "\(memoryEnabled)\(allowShell)\(allowWeb)\(allowFileWrite)\(allowMac)\(allowMCP)"]
    }

    // Explicit keys keep URL/API acronyms compatible with the persisted snake_case contract.
    enum CodingKeys: String, CodingKey {
        case agentBaseURL = "agent_base_url"
        case agentModel = "agent_model"
        case agentAPIKeyEnv = "agent_api_key_env"
        case onboarded, vocabulary
        case userName = "user_name"
        case assistantName = "assistant_name"
        case wakeWords = "wake_words"
        case microphoneEnabled = "microphone_enabled"
        case ttsEngine = "tts_engine"
        case ttsVoice = "tts_voice"
        case sttEngine = "stt_engine"
        case whisperModel = "whisper_model"
        case voiceMode = "voice_mode"
        case speakReplies = "speak_replies"
        case notchPosition = "notch_position"
        case collapseDelay = "collapse_delay"
        case memoryEnabled = "memory_enabled"
        case pronounSelf = "pronoun_self"
        case pronounUser = "pronoun_user"
        case replyLength = "reply_length"
        case tone
        case customInstructions = "custom_instructions"
        case workspace
        case allowShell = "allow_shell"
        case allowWeb = "allow_web"
        case allowFileWrite = "allow_file_write"
        case allowMac = "allow_mac"
        case allowMCP = "allow_mcp"
        case hotkey
        case quickPrompts = "quick_prompts"
    }
}

@MainActor
final class ProfileStore: ObservableObject {
    static let dataDir: URL = {
        let value = ProcessInfo.processInfo.environment["TIBO_DATA_DIR"]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return value.isEmpty
            ? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".local/share/tibo")
            : URL(fileURLWithPath: value)
    }()
    static let modelsDir = dataDir.appendingPathComponent("models")
    static let url: URL = {
        let value = ProcessInfo.processInfo.environment["TIBO_PROFILE"]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return value.isEmpty ? dataDir.appendingPathComponent("profile.json") : URL(fileURLWithPath: value)
    }()

    @Published private(set) var profile: Profile
    /// True while onboarding/settings records training takes; the live listener must ignore the mic meanwhile.
    @Published var trainingActive = false
    @Published private(set) var persistenceError = ""
    @Published private(set) var credentialMigrationError = ""
    @Published private(set) var credentialRevision = 0

    init() {
        var migrationError = ""
        var migrated = false
        // Merge the file over the defaults so a profile written by an older build (missing newer keys)
        // keeps its values instead of failing to decode and resetting onboarding.
        let defaults = (try? JSONSerialization.jsonObject(with: Self.encoder.encode(Profile()))) as? [String: Any] ?? [:]
        if let data = try? Data(contentsOf: Self.url),
           let stored = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
            var values = defaults.merging(stored) { $1 }
            // The old `agent` enum selected an external CLI. Keep the one known provider usable,
            // but never reinterpret an unknown CLI/model pair as a direct endpoint.
            if stored["agent_base_url"] == nil {
                if stored["agent"] as? String == "pi",
                   let oldModel = stored["agent_model"] as? String,
                   oldModel.hasPrefix("opencode-go/") {
                    values["agent_base_url"] = "https://opencode.ai/zen/go/v1"
                    values["agent_model"] = String(oldModel.dropFirst("opencode-go/".count))
                    migrationError = Self.importLegacyCredentialIfNeeded() ?? ""
                } else if stored["agent"] != nil || stored["agent_model"] != nil {
                    values["agent_base_url"] = ""
                    values["agent_model"] = ""
                }
            }
            migrated = stored["agent"] != nil
            // Settings used to keep the agent workspace in UserDefaults ("projectRoot").
            if stored["workspace"] == nil, let root = UserDefaults.standard.string(forKey: "projectRoot"), !root.isEmpty {
                values["workspace"] = root
                migrated = true
            }
            if let merged = try? JSONSerialization.data(withJSONObject: values),
               let decoded = try? Self.decoder.decode(Profile.self, from: merged) {
                profile = decoded
            } else {
                profile = Profile()
                migrated = false
                persistenceError = "Không thể đọc profile; giữ nguyên file để tránh mất cấu hình."
            }
        } else {
            profile = Profile()
        }
        credentialMigrationError = migrationError
        if migrated { save(profile) }
    }

    private static func importLegacyCredentialIfNeeded() -> String? {
        guard let endpoint = URL(string: "https://opencode.ai/zen/go/v1"),
              TiboCredentials.load(baseURL: endpoint) == nil else { return nil }
        let authURL = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".pi/agent/auth.json")
        guard let data = try? Data(contentsOf: authURL),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let provider = root["opencode-go"] as? [String: Any],
              provider["type"] as? String == "api_key",
              let key = provider["key"] as? String, !key.isEmpty else { return nil }
        do {
            try TiboCredentials.save(key: key, baseURL: endpoint)
            return nil
        } catch {
            return "Không thể chuyển API key opencode-go vào Chuỗi khóa: \(error.localizedDescription)"
        }
    }

    func save(_ updated: Profile) {
        persistenceError = ""
        do {
            try FileManager.default.createDirectory(at: Self.dataDir, withIntermediateDirectories: true)
            try Self.encoder.encode(updated).write(to: Self.url, options: .atomic)
            profile = updated
        } catch {
            persistenceError = error.localizedDescription
            print("TIBO_PROFILE save_failed \(error.localizedDescription)")
        }
    }

    func credentialsChanged() { credentialRevision += 1 }

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return encoder
    }()

    private static let decoder = JSONDecoder()
}

/// Runtime environment helpers shared by the voice/native adapters and the Tibo Agent.
enum RuntimeEnvironment {
    private static let home = FileManager.default.homeDirectoryForCurrentUser.path

    /// Directories searched in order when Finder/launchd provides a minimal PATH.
    static var searchPath: [String] {
        var dirs = ["\(home)/.local/bin", "/opt/homebrew/bin", "/usr/local/bin", "\(home)/.bun/bin", "\(home)/.cargo/bin"]
        let nvm = "\(home)/.nvm/versions/node"
        if let versions = try? FileManager.default.contentsOfDirectory(atPath: nvm) {
            dirs += versions.sorted { $0.compare($1, options: .numeric) == .orderedDescending }.map { "\(nvm)/\($0)/bin" }
        }
        return dirs + ["/usr/bin", "/bin", "/usr/sbin", "/sbin"]
    }

    /// Environment for spawned helpers: inherited env with searchPath prepended to PATH.
    static func environment() -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        environment["PATH"] = (searchPath + [environment["PATH"] ?? ""]).joined(separator: ":")
        return environment
    }
}

enum TiboCredentials {
    private static let service = "com.tibo.agent.api-key"

    static func load(baseURL: URL) -> String? {
        var query = baseQuery(baseURL: baseURL)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func save(key: String, baseURL: URL) throws {
        let data = Data(key.utf8)
        let query = baseQuery(baseURL: baseURL)
        let attributes: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var item = query
            item.merge(attributes) { _, new in new }
            let addStatus = SecItemAdd(item as CFDictionary, nil)
            guard addStatus == errSecSuccess else {
                throw NSError(domain: NSOSStatusErrorDomain, code: Int(addStatus), userInfo: [NSLocalizedDescriptionKey: "Không thể lưu khóa API trong Chuỗi khóa"])
            }
        } else if status != errSecSuccess {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(status), userInfo: [NSLocalizedDescriptionKey: "Không thể lưu khóa API trong Chuỗi khóa"])
        }
    }

    static func delete(baseURL: URL) throws {
        let status = SecItemDelete(baseQuery(baseURL: baseURL) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(status), userInfo: [NSLocalizedDescriptionKey: "Không thể xóa khóa API khỏi Chuỗi khóa"])
        }
    }

    private static func baseQuery(baseURL: URL) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: normalized(baseURL)]
    }

    private static func normalized(_ baseURL: URL) -> String {
        baseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }
}

extension Notification.Name {
    /// A downloaded Whisper model is in place; restart whisper-server.
    static let tiboModelReady = Notification.Name("TiboModelReady")
    static let tiboNotchOpened = Notification.Name("TiboNotchOpened")
    static let tiboWakeHeard = Notification.Name("TiboWakeHeard")
    /// Settings asks the agent to drop a remembered command prefix (`object` is the prefix).
    static let tiboForgetTrusted = Notification.Name("TiboForgetTrusted")
}
