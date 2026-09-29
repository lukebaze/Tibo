import Foundation

/// Everything the user picks in onboarding. Persisted as snake_case JSON at `ProfileStore.url`;
/// the Rust backend (`src/profile.rs`) reads the same file, so keys and enum raw values are a contract.
struct Profile: Codable, Equatable {
    /// A word the user taught by voice: `heard` holds what the recognizers produced for it.
    struct Term: Codable, Equatable, Hashable {
        var word: String
        var heard: [String] = []
    }

    enum Agent: String, Codable, CaseIterable, Identifiable {
        case pi, claude, omp, codex
        var id: String { rawValue }
        var title: String {
            switch self {
            case .claude: "Claude Code"
            case .omp: "omp"
            case .codex: "Codex"
            case .pi: "pi"
            }
        }
        var executable: String { self == .claude ? "claude" : rawValue }
    }

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

    /// everyday: browsers wait 0.5 s and games/full-screen apps 0.8 s before hover opens the notch. quick: always instant.
    enum NotchOpen: String, Codable, CaseIterable, Identifiable {
        case everyday, quick
        var id: String { rawValue }
        var title: String { self == .everyday ? "Hằng ngày (trễ hơn trên trình duyệt, game)" : "Mở nhanh (luôn mở ngay)" }
    }

    var onboarded = false
    var userName = ""
    var assistantName = "Tibo"
    /// Spoken forms that wake the assistant (besides `assistantName`), including voice-learned variants.
    var wakeWords: [String] = ["Ti bo"]
    var vocabulary: [Term] = []
    var agent: Agent = .pi
    /// `--model` for pi; empty = pi's own default. `qwen-token-plan/deepseek-v4.1-flash` returns empty replies.
    var agentModel = "opencode-go/deepseek-v4.1-flash"
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
    var notchOpen: NotchOpen = .everyday
    /// Extra hover margin around the collapsed pill, in points.
    var hoverMargin: Double = 6
    /// Seconds the expanded notch stays open after the pointer leaves.
    var collapseDelay: Double = 1.2
    /// Tibo's own memory (`src/memory.rs`): off = no turn log, no facts, no memory in the prompt.
    var memoryEnabled = true
}

@MainActor
final class ProfileStore: ObservableObject {
    static let dataDir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".local/share/tibo")
    static let modelsDir = dataDir.appendingPathComponent("models")
    static let url = dataDir.appendingPathComponent("profile.json")

    @Published private(set) var profile: Profile
    /// True while onboarding/settings records training takes; the live listener must ignore the mic meanwhile.
    @Published var trainingActive = false

    init() {
        // Merge the file over the defaults so a profile written by an older build (missing newer keys)
        // keeps its values instead of failing to decode and resetting onboarding.
        let defaults = (try? JSONSerialization.jsonObject(with: Self.encoder.encode(Profile()))) as? [String: Any] ?? [:]
        if let data = try? Data(contentsOf: Self.url),
           let stored = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
           let merged = try? JSONSerialization.data(withJSONObject: defaults.merging(stored) { $1 }),
           let decoded = try? Self.decoder.decode(Profile.self, from: merged) {
            profile = decoded
        } else {
            profile = Profile()
        }
    }

    func save(_ updated: Profile) {
        profile = updated
        do {
            try FileManager.default.createDirectory(at: Self.dataDir, withIntermediateDirectories: true)
            try Self.encoder.encode(updated).write(to: Self.url, options: .atomic)
        } catch {
            print("TIBO_PROFILE save_failed \(error.localizedDescription)")
        }
    }

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return encoder
    }()

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }()
}

/// Finds agent CLIs even when Tibo is launched from Finder (launchd PATH is only /usr/bin:/bin:/usr/sbin:/sbin).
enum AgentCLI {
    private static let home = FileManager.default.homeDirectoryForCurrentUser.path

    /// Directories searched in order; nvm node bins are included because `pi` is a `#!/usr/bin/env node` script.
    static var searchPath: [String] {
        var dirs = ["\(home)/.local/bin", "/opt/homebrew/bin", "/usr/local/bin", "\(home)/.bun/bin", "\(home)/.cargo/bin"]
        let nvm = "\(home)/.nvm/versions/node"
        if let versions = try? FileManager.default.contentsOfDirectory(atPath: nvm) {
            dirs += versions.sorted { $0.compare($1, options: .numeric) == .orderedDescending }.map { "\(nvm)/\($0)/bin" }
        }
        return dirs + ["/usr/bin", "/bin", "/usr/sbin", "/sbin"]
    }

    static func resolve(_ agent: Profile.Agent) -> URL? {
        if let override = ProcessInfo.processInfo.environment["TIBO_\(agent.rawValue.uppercased())"] {
            return URL(fileURLWithPath: override)
        }
        return searchPath.lazy
            .map { URL(fileURLWithPath: $0).appendingPathComponent(agent.executable) }
            .first { FileManager.default.isExecutableFile(atPath: $0.path) }
    }

    /// Environment for spawned agents: inherited env with `searchPath` prepended to PATH.
    static func environment() -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        environment["PATH"] = (searchPath + [environment["PATH"] ?? ""]).joined(separator: ":")
        return environment
    }
}

extension Notification.Name {
    /// A downloaded Whisper model is in place; restart whisper-server.
    static let tiboModelReady = Notification.Name("TiboModelReady")
    static let tiboNotchOpened = Notification.Name("TiboNotchOpened")
    static let tiboWakeHeard = Notification.Name("TiboWakeHeard")
    /// Flash the notch hover zone on screen for a few seconds.
    static let tiboShowHoverZone = Notification.Name("TiboShowHoverZone")
}
