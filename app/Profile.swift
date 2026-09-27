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
        case claude, omp, codex, pi
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

    var onboarded = false
    var userName = ""
    var assistantName = "Tibo"
    /// Spoken forms that wake the assistant (besides `assistantName`), including voice-learned variants.
    var wakeWords: [String] = ["Ti bo"]
    var vocabulary: [Term] = []
    var agent: Agent = .claude
    var ttsEngine: TtsEngine = .kokoro
    /// Kokoro voicepack id (e.g. "ngoc_huyen") or a macOS `say -v` voice name (e.g. "Linh").
    var ttsVoice = "ngoc_huyen"
    var sttEngine: SttEngine = .whisper
    /// File name inside `ProfileStore.modelsDir`.
    var whisperModel = "ggml-large-v3-turbo-q5_0.bin"
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
        if let data = try? Data(contentsOf: Self.url), let decoded = try? Self.decoder.decode(Profile.self, from: data) {
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
