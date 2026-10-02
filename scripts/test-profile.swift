import SwiftUI

@main
struct ProfileContractCheck {
    @MainActor static func main() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        setenv("TIBO_DATA_DIR", root.path, 1)
        setenv("TIBO_PROFILE", root.appendingPathComponent("profile.json").path, 1)
        let input: [String: Any] = [
            "onboarded": true, "agent_base_url": "https://example.com/v1",
            "agent_model": "chosen-model", "agent_api_key_env": "MY_MODEL_KEY",
            "microphone_enabled": false, "stt_engine": "apple", "tts_engine": "system"
        ]
        try JSONSerialization.data(withJSONObject: input).write(to: ProfileStore.url)
        // An older Settings kept the workspace in UserDefaults; the profile must take it over.
        UserDefaults.standard.set("/tmp/old-root", forKey: "projectRoot")
        defer { UserDefaults.standard.removeObject(forKey: "projectRoot") }
        let store = ProfileStore()
        precondition(store.profile.onboarded && store.profile.agentBaseURL == "https://example.com/v1")
        precondition(store.profile.agentModel == "chosen-model" && store.profile.agentAPIKeyEnv == "MY_MODEL_KEY")
        precondition(store.profile.workspace == "/tmp/old-root")
        let migratedFile = try JSONSerialization.jsonObject(with: Data(contentsOf: ProfileStore.url)) as! [String: Any]
        precondition(migratedFile["workspace"] as? String == "/tmp/old-root")
        var profile = store.profile
        profile.userName = "Contract check"
        store.save(profile)
        precondition(store.persistenceError.isEmpty)
        let saved = try JSONSerialization.jsonObject(with: Data(contentsOf: ProfileStore.url)) as! [String: Any]
        precondition(saved["agent_base_url"] as? String == "https://example.com/v1")
        precondition(saved["agent_api_key_env"] as? String == "MY_MODEL_KEY")
        precondition(saved["agent"] == nil && saved["api_key"] == nil)
        let reopened = ProfileStore()
        precondition(reopened.profile == profile)
        let invalid: [String: Any] = ["agent": "unknown-cli", "onboarded": true, "stt_engine": NSNull()]
        let invalidData = try JSONSerialization.data(withJSONObject: invalid)
        try invalidData.write(to: ProfileStore.url)
        let failedMigration = ProfileStore()
        precondition(!failedMigration.persistenceError.isEmpty)
        let preserved = try Data(contentsOf: ProfileStore.url)
        precondition(preserved == invalidData)
        print("Profile model/provider round-trip and clean cutover passed")
    }
}
