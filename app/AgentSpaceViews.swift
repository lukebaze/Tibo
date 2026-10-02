import AppKit
import SwiftUI

/// Tokens for the notch; DESIGN.md records the reasoning. The notch is a Taby Island: it stays the
/// hardware's black when it opens, so every color here is tuned for black, in light and dark mode alike.
enum TiboStyle {
    /// The camera housing's black, collapsed and expanded.
    static let island = Color.black
    /// Brandkit paper #F7F5F0: primary text and icons.
    static let text = Color(red: 0.969, green: 0.961, blue: 0.941)
    /// Paper at 62% on black, about 7.4:1.
    static let secondary = text.opacity(0.62)
    /// Brandkit amber #FFB35C: the one action that matters (send, allow), focus and the drop target.
    static let accent = Color(red: 1, green: 0.702, blue: 0.361)
    /// Brandkit ember #FF6A3D: only inside the working light, never a state color.
    static let ember = Color(red: 1, green: 0.416, blue: 0.239)
    /// Brandkit ink #0B0C14 on amber, about 11:1; white on amber would be 1.9:1.
    static let onAccent = Color(red: 0.043, green: 0.047, blue: 0.078)
    /// Tool rows, the composer and the timeline's soft wells.
    static let surface = text.opacity(0.07)
    /// User messages, chips and secondary buttons.
    static let raised = text.opacity(0.12)
    static let hairline = text.opacity(0.14)
    /// System green and red as drawn on dark backgrounds; always paired with an icon shape and text.
    static let success = Color(red: 0.188, green: 0.820, blue: 0.345)
    static let danger = Color(red: 1, green: 0.271, blue: 0.227)
    /// Taby's own voice: the status line and questions the island asks.
    static let voice = Font.system(size: 13, weight: .semibold, design: .rounded)
    static let title = Font.system(size: 15, weight: .semibold, design: .rounded)
    static let body = Font.system(size: 13)
    static let caption = Font.system(size: 12)
    static let label = Font.system(size: 12, weight: .semibold)
    static let mono = Font.system(size: 11.5, design: .monospaced)
    /// Cards inside the 24 pt island; rows and wells step down from it.
    static let radius: CGFloat = 14
    static let rowRadius: CGFloat = 10
    /// Minimum hit target for icon controls (WCAG 2.5.8 asks for 24).
    static let control: CGFloat = 28
}

/// Human wording for a tool call; the raw name and JSON stay one click away.
struct ToolPresentation {
    let title: String
    let detail: String
    let symbol: String
    /// What the user is asked to approve: the complete command/path plus a preview of written content.
    let approvalBody: String

    init(name: String, arguments: String) {
        let args = (try? JSONSerialization.jsonObject(with: Data(arguments.utf8))) as? [String: Any] ?? [:]
        func value(_ key: String) -> String { args[key].map { "\($0)" } ?? "" }
        let entry: (String, String, String)
        switch name {
        case "read_file": entry = ("Đọc tệp", value("path"), "doc.text.magnifyingglass")
        case "list_files": entry = ("Xem thư mục", ["", "."].contains(value("path")) ? "thư mục làm việc" : value("path"), "folder")
        case "search_files": entry = ("Tìm trong tệp", value("query"), "magnifyingglass")
        case "write_file": entry = ("Ghi tệp", value("path"), "square.and.pencil")
        case "shell": entry = ("Chạy lệnh", value("command"), "terminal")
        case "web_fetch": entry = ("Mở trang web", value("url"), "globe")
        case "web_search": entry = ("Tìm trên web", value("query"), "magnifyingglass.circle")
        case "session_search": entry = ("Tìm trong hội thoại cũ", value("query"), "clock.arrow.circlepath")
        case "memory": entry = ("Cập nhật trí nhớ", [value("action"), value("content")].filter { !$0.isEmpty }.joined(separator: ": "), "brain")
        case "skills_read": entry = ("Đọc kỹ năng", value("name"), "book")
        case "skills_save": entry = ("Lưu kỹ năng", value("name"), "book.closed")
        case "mac_read", "mac_write":
            entry = ("Thao tác trên Mac", ([value("command")] + ((args["args"] as? [Any])?.map { "\($0)" } ?? [])).joined(separator: " "), "macwindow")
        default:
            let parts = name.components(separatedBy: "__")
            entry = parts.count == 3 && parts[0] == "mcp" ? ("\(parts[1]) · \(parts[2])", "", "puzzlepiece.extension") : (name, "", "wrench.and.screwdriver")
        }
        title = entry.0
        symbol = entry.2
        detail = entry.1.isEmpty ? String(arguments.prefix(200)) : entry.1
        let written = value("content")
        approvalBody = name == "write_file" && !written.isEmpty ? detail + "\n\n" + String(written.prefix(600)) : (entry.1.isEmpty ? arguments : entry.1)
    }

    /// Runtime failures arrive as `{"error": "..."}` or plain text; show a Vietnamese sentence where the wording is known.
    static func readable(_ result: String) -> String {
        let object = (try? JSONSerialization.jsonObject(with: Data(result.utf8))) as? [String: Any]
        let error = object?["error"] as? String ?? result
        switch error {
        case "approval denied or expired; action was not executed": return "Không chạy: bạn đã từ chối hoặc hết thời gian xác nhận."
        case "cancelled; action was terminated": return "Đã dừng giữa chừng."
        case "interrupted before tool execution; action was not replayed": return "Bị ngắt trước khi chạy; Tibo không tự chạy lại."
        default: break
        }
        guard object?["error"] != nil || result.hasPrefix("HTTP "),
              let match = error.range(of: #"HTTP \d{3}"#, options: .regularExpression) else { return error }
        let code = String(error[match].suffix(3))
        switch code {
        case "401", "403": return "Bị từ chối truy cập (HTTP \(code))."
        case "404": return "Không tìm thấy trang (HTTP 404)."
        case "429": return "Bị giới hạn tần suất; thử lại sau ít phút (HTTP 429)."
        default: return code.hasPrefix("5") ? "Máy chủ đang lỗi (HTTP \(code))." : error
        }
    }
}

enum TimelineEntry: Identifiable {
    case message(AgentMessage)
    /// Consecutive tool steps; one step shows as a plain row, more as a stack.
    case tools([AgentToolCall])

    var id: String {
        switch self {
        case .message(let message): "m-" + message.id.uuidString
        case .tools(let calls): "t-" + (calls.first?.id ?? "")
        }
    }
}

/// Messages and tool steps in the order they happened, so the user sees what Tibo did and why.
/// The header's status line owns "what is happening now", so the timeline never repeats it.
struct AgentTimeline: View {
    let messages: [AgentMessage]
    let tools: [AgentToolCall]
    let error: String?
    /// Offered beside errors that a settings change can fix (key, endpoint, model).
    let openSettings: () -> Void

    /// Messages and tools by time; back-to-back tool steps merge into one group.
    private var entries: [TimelineEntry] {
        let timeline = (messages.map { ($0.timestamp, TimelineEntry.message($0)) } + tools.map { ($0.timestamp, TimelineEntry.tools([$0])) })
            .sorted { $0.0 < $1.0 }.map(\.1)
        return timeline.reduce(into: []) { result, entry in
            if case .tools(let next) = entry, case .tools(let previous)? = result.last {
                result[result.count - 1] = .tools(previous + next)
            } else {
                result.append(entry)
            }
        }
    }

    private var scrollKey: String {
        "\(messages.count)-\(messages.last?.content.count ?? 0)-\(tools.count)-\(tools.filter { $0.result != nil }.count)-\(error ?? "")"
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                // Eager stack: a lazy one estimates heights of wrapped markdown, so "scroll to bottom" stopped short.
                // ponytail: fine for one session's turns; go lazy again if sessions grow to hundreds of entries.
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(entries) { entry in
                        switch entry {
                        case .message(let message): MessageRow(message: message)
                        case .tools(let calls) where calls.count == 1: ToolRow(call: calls[0])
                        case .tools(let calls): ToolStack(calls: calls)
                        }
                    }
                    if let error { ErrorRow(message: ToolPresentation.readable(error), openSettings: ErrorRow.settingsFixable(error) ? openSettings : nil) }
                    // Sized so the last line rests above the bottom fade when scrolled to the end.
                    Color.clear.frame(height: 4).id("bottom")
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
            }
            .scrollIndicators(.never)
            .mask(SoftEdges())
            // On the next turn, after the restored transcript has its real height.
            .onAppear { DispatchQueue.main.async { proxy.scrollTo("bottom", anchor: .bottom) } }
            .onChange(of: scrollKey) { _, _ in proxy.scrollTo("bottom", anchor: .bottom) }
        }
    }
}

/// Content fades into the island at the top and bottom instead of being cut by the header or composer.
private struct SoftEdges: View {
    var body: some View {
        VStack(spacing: 0) {
            LinearGradient(colors: [.clear, .black], startPoint: .top, endPoint: .bottom).frame(height: 12)
            Color.black
            LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom).frame(height: 12)
        }
    }
}

struct ErrorRow: View {
    let message: String
    let openSettings: (() -> Void)?

    /// ponytail: keyword match on the runtime's message; a typed error code from the runtime if this misfires.
    static func settingsFixable(_ message: String) -> Bool {
        let text = message.lowercased()
        return ["api key", "http 401", "http 403", "http 404", "endpoint", "model", "mô hình"].contains { text.contains($0) }
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(TiboStyle.danger)
            Text(message).font(TiboStyle.body).foregroundStyle(TiboStyle.text).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            if let openSettings {
                Button("Mở Cài đặt", action: openSettings)
                    .buttonStyle(NotchButtonStyle(kind: .secondary, radius: TiboStyle.control / 2))
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(TiboStyle.danger.opacity(0.16), in: RoundedRectangle(cornerRadius: TiboStyle.rowRadius, style: .continuous))
        .frame(maxWidth: MessageRow.measure, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Lỗi: \(message)")
    }
}

/// Several steps read as one card: overlapping tool icons, "Đã chạy N bước" and the latest step.
/// Clicking opens the card into the list of steps; the latest step stays live.
struct ToolStack: View {
    let calls: [AgentToolCall]
    @State private var expanded = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let shape = RoundedRectangle(cornerRadius: TiboStyle.radius, style: .continuous)

    private var latest: AgentToolCall { calls[calls.count - 1] }
    private var failed: Int { calls.filter(\.failed).count }
    private var running: Bool { calls.contains { $0.result == nil } }
    private var symbols: [String] {
        var seen: [String] = []
        for call in calls.reversed() {
            let symbol = ToolPresentation(name: call.name, arguments: call.arguments).symbol
            if !seen.contains(symbol) { seen.append(symbol) }
            if seen.count == 3 { break }
        }
        return seen.reversed()
    }

    var body: some View {
        VStack(spacing: 0) {
            Button(action: toggle) { header }
                .buttonStyle(NotchButtonStyle(radius: TiboStyle.radius))
                .accessibilityLabel("\(running ? "Đang chạy" : "Đã chạy") \(calls.count) bước\(failed > 0 ? ", \(failed) lỗi" : "")")
                .accessibilityHint(expanded ? "Thu gọn" : "Xem từng bước")
            if expanded {
                ForEach(calls) { call in
                    Rectangle().fill(TiboStyle.hairline).frame(height: 1).padding(.leading, 12)
                    ToolRow(call: call, grouped: true)
                }
                .transition(.opacity)
            }
        }
        .background(TiboStyle.surface, in: shape)
    }

    private var header: some View {
        let tool = ToolPresentation(name: latest.name, arguments: latest.arguments)
        return HStack(spacing: 10) {
            HStack(spacing: -6) {
                ForEach(symbols, id: \.self) { symbol in
                    Image(systemName: symbol)
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(TiboStyle.text)
                        .frame(width: 22, height: 22)
                        .background(Color(white: 0.16), in: Circle())
                        .overlay(Circle().strokeBorder(TiboStyle.island, lineWidth: 1.5))
                }
            }
            VStack(alignment: .leading, spacing: 1) {
                Text("\(running ? "Đang chạy" : "Đã chạy") \(calls.count) bước").font(TiboStyle.label).foregroundStyle(TiboStyle.text)
                if !expanded {
                    Text("\(tool.title) · \(tool.detail)").font(TiboStyle.caption).foregroundStyle(TiboStyle.secondary)
                        .lineLimit(1).truncationMode(.middle)
                }
            }
            Spacer(minLength: 0)
            if running {
                ProgressView().controlSize(.mini)
            } else if failed > 0 {
                Label("\(failed) lỗi", systemImage: "xmark.circle.fill").font(TiboStyle.label).foregroundStyle(TiboStyle.danger)
            } else {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(TiboStyle.success)
            }
            Image(systemName: "chevron.down")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(TiboStyle.secondary)
                .rotationEffect(.degrees(expanded ? 180 : 0))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .contentShape(Rectangle())
    }

    private func toggle() {
        withAnimation(reduceMotion ? nil : .spring(response: 0.32, dampingFraction: 0.86)) { expanded.toggle() }
    }
}

struct MessageRow: View {
    let message: AgentMessage
    /// About 80 characters per line in the 640 pt island.
    static let measure: CGFloat = 540

    var body: some View {
        if message.role == "user" {
            VStack(alignment: .trailing, spacing: 4) {
                Text(message.displayText)
                    .font(TiboStyle.body)
                    .foregroundStyle(TiboStyle.text)
                    .textSelection(.enabled)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(TiboStyle.raised, in: RoundedRectangle(cornerRadius: TiboStyle.radius, style: .continuous))
                ForEach(message.attachmentNames, id: \.self) { name in
                    Label(name, systemImage: "paperclip")
                        .font(TiboStyle.caption)
                        .foregroundStyle(TiboStyle.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
            .padding(.leading, 120)
            .accessibilityElement(children: .ignore)
            .accessibilityAddTraits(.isStaticText)
            .accessibilityLabel("Bạn: \(message.displayText)" + (message.attachmentNames.isEmpty ? "" : ". Đính kèm: " + message.attachmentNames.joined(separator: ", ")))
        } else {
            MarkdownText(text: message.displayText)
                .frame(maxWidth: Self.measure, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .ignore)
                .accessibilityAddTraits(.isStaticText)
                .accessibilityLabel("Tibo: \(message.displayText)")
        }
    }
}

/// Assistant replies as blocks: paragraphs, bullet and numbered lists, headings and fenced code, with
/// inline markdown (bold, code, links) inside each block. Lists sit tighter than paragraphs.
struct MarkdownText: View {
    let text: String

    enum Block: Equatable {
        case paragraph(String), item(marker: String, text: String), heading(String), code(String)
        var isItem: Bool { if case .item = self { true } else { false } }
    }

    var body: some View {
        let blocks = Self.blocks(text)
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { index, block in
                view(block).padding(.top, index == 0 ? 0 : block.isItem && blocks[index - 1].isItem ? 3 : 8)
            }
        }
        .font(TiboStyle.body)
        .foregroundStyle(TiboStyle.text)
        .tint(TiboStyle.accent)
        .textSelection(.enabled)
    }

    @ViewBuilder private func view(_ block: Block) -> some View {
        switch block {
        case .paragraph(let text):
            Text(Self.inline(text)).fixedSize(horizontal: false, vertical: true)
        case .item(let marker, let text):
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(marker).foregroundStyle(TiboStyle.secondary).frame(minWidth: 10, alignment: .trailing)
                Text(Self.inline(text)).fixedSize(horizontal: false, vertical: true)
            }
        case .heading(let text):
            Text(Self.inline(text)).font(.system(size: 13, weight: .semibold))
        case .code(let text):
            Text(text)
                .font(TiboStyle.mono)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(8)
                .background(TiboStyle.surface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
    }

    static func blocks(_ text: String) -> [Block] {
        var blocks: [Block] = [], paragraph: [String] = [], code: [String]?
        func flush() {
            if !paragraph.isEmpty { blocks.append(.paragraph(paragraph.joined(separator: "\n"))) }
            paragraph = []
        }
        for raw in text.components(separatedBy: "\n") {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("```") {
                if let lines = code { blocks.append(.code(lines.joined(separator: "\n"))); code = nil } else { flush(); code = [] }
            } else if code != nil {
                code?.append(raw)
            } else if line.isEmpty {
                flush()
            } else if let marker = ["- ", "* ", "• "].first(where: line.hasPrefix) {
                flush()
                blocks.append(.item(marker: "•", text: String(line.dropFirst(marker.count))))
            } else if let dot = line.firstIndex(of: "."), dot > line.startIndex, line[..<dot].allSatisfy(\.isNumber),
                      line[line.index(after: dot)...].hasPrefix(" ") {
                flush()
                blocks.append(.item(marker: String(line[...dot]), text: String(line[line.index(dot, offsetBy: 2)...])))
            } else if line.hasPrefix("#") {
                flush()
                blocks.append(.heading(line.drop { $0 == "#" }.trimmingCharacters(in: .whitespaces)))
            } else {
                paragraph.append(line)
            }
        }
        if let code { blocks.append(.code(code.joined(separator: "\n"))) } // still streaming
        flush()
        return blocks
    }

    private static func inline(_ text: String) -> AttributedString {
        (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(text)
    }
}

struct ToolRow: View {
    let call: AgentToolCall
    /// Inside a `ToolStack`: no card of its own, the group draws it.
    var grouped = false
    @State private var expanded = false

    var body: some View {
        let tool = ToolPresentation(name: call.name, arguments: call.arguments)
        VStack(alignment: .leading, spacing: 6) {
            Button { expanded.toggle() } label: {
                HStack(spacing: 8) {
                    statusIcon.frame(width: 16)
                    Image(systemName: tool.symbol).foregroundStyle(TiboStyle.secondary).frame(width: 16)
                    // One line: what, then on what. Details stay one click away.
                    Text(tool.title).font(TiboStyle.label).foregroundStyle(TiboStyle.text).fixedSize()
                    Text(tool.detail).font(TiboStyle.mono).foregroundStyle(TiboStyle.secondary).lineLimit(1).truncationMode(.middle)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(TiboStyle.secondary)
                        .rotationEffect(.degrees(expanded ? 90 : 0))
                }
                .frame(minHeight: TiboStyle.control)
                .contentShape(Rectangle())
            }
            .buttonStyle(NotchButtonStyle(radius: 8))
            .accessibilityLabel("\(tool.title) \(tool.detail), \(statusText)")
            .accessibilityHint(expanded ? "Ẩn chi tiết" : "Xem chi tiết")
            if call.failed, let result = call.result, !expanded {
                Text(ToolPresentation.readable(result)).font(TiboStyle.caption).foregroundStyle(TiboStyle.danger).lineLimit(2)
                    .padding(.leading, 48)
            }
            if expanded {
                ScrollView {
                    Text([call.arguments, call.result.map(ToolPresentation.readable) ?? "Đang chạy…"].filter { !$0.isEmpty }.joined(separator: "\n\n"))
                        .font(TiboStyle.mono)
                        .foregroundStyle(TiboStyle.secondary)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 120)
                .padding(8)
                .background(TiboStyle.island.opacity(0.6), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
        }
        .padding(.horizontal, grouped ? 4 : 8)
        .padding(.vertical, 4)
        .background(grouped ? Color.clear : TiboStyle.surface, in: RoundedRectangle(cornerRadius: TiboStyle.rowRadius, style: .continuous))
    }

    @ViewBuilder private var statusIcon: some View {
        if call.result == nil { ProgressView().controlSize(.mini) }
        else if call.failed { Image(systemName: "xmark.circle.fill").foregroundStyle(TiboStyle.danger) }
        else { Image(systemName: "checkmark.circle.fill").foregroundStyle(TiboStyle.success) }
    }

    private var statusText: String { call.result == nil ? "đang chạy" : call.failed ? "thất bại" : "xong" }
}

/// Consequential actions take the composer's place until decided: what will run, what would be
/// remembered, and the two answers with their keys. Esc denies (fail closed), ⌘↩ allows.
struct ApprovalCard: View {
    let approval: AgentApproval
    let decide: (Bool, Bool) -> Void
    /// Off by default: one approval never silently becomes standing trust.
    @State private var remember = false
    /// The island can open under the pointer mid-click; Allow ignores input for its first half second.
    @State private var shownAt = Date.distantFuture

    var body: some View {
        let tool = ToolPresentation(name: approval.tool, arguments: approval.arguments)
        VStack(alignment: .leading, spacing: 8) {
            Label("Cho phép \(tool.title.lowercased())?", systemImage: "hand.raised.fill")
                .font(TiboStyle.voice)
                .foregroundStyle(TiboStyle.text)
                .labelStyle(AccentIconLabel())
            // Every character of what will run is readable before Allow: long commands scroll, never elide.
            ScrollView {
                Text(tool.approvalBody)
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(TiboStyle.text)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            // Visible even on trackpads, so a command taller than the well shows there is more above Allow.
            .scrollIndicators(.visible)
            .frame(maxHeight: 64)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(TiboStyle.island, in: RoundedRectangle(cornerRadius: TiboStyle.rowRadius, style: .continuous))
            HStack(spacing: 8) {
                // The runtime names the exact prefix it would trust; destructive or chained commands get none.
                if !approval.remember.isEmpty {
                    Toggle(isOn: $remember) {
                        Text("Lần sau tự chạy \(Text(approval.remember).font(.system(size: 12, design: .monospaced))) …")
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    .toggleStyle(.checkbox)
                    .font(TiboStyle.caption)
                    .foregroundStyle(TiboStyle.secondary)
                    .tint(TiboStyle.accent)
                    .help("Lệnh bắt đầu bằng “\(approval.remember)” sẽ không hỏi lại; bỏ trong Cài đặt › Model")
                    .accessibilityLabel("Lần sau tự chạy lệnh bắt đầu bằng \(approval.remember), không hỏi lại")
                }
                Spacer(minLength: 8)
                Button { decide(false, false) } label: { HStack(spacing: 6) { Text("Từ chối"); KeyHint(key: "esc", onAccent: false) } }
                    .buttonStyle(NotchButtonStyle(kind: .secondary, radius: TiboStyle.control / 2))
                    // Window-wide, so Esc denies even though nothing in the card holds focus.
                    .keyboardShortcut(.cancelAction)
                    .accessibilityLabel("Từ chối")
                    .accessibilityHint("Phím Esc")
                Button {
                    guard Date().timeIntervalSince(shownAt) > 0.5 else { return }
                    decide(true, remember)
                } label: { HStack(spacing: 6) { Text("Cho phép"); KeyHint(key: "⌘↩", onAccent: true) } }
                    .buttonStyle(NotchButtonStyle(kind: .primary, radius: TiboStyle.control / 2))
                    .keyboardShortcut(.return, modifiers: .command)
                    .accessibilityLabel("Cho phép")
                    .accessibilityHint("Command Return")
            }
        }
        .padding(12)
        .background(TiboStyle.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: TiboStyle.radius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: TiboStyle.radius, style: .continuous).strokeBorder(TiboStyle.accent.opacity(0.5)))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Yêu cầu xác nhận: \(tool.title). Esc từ chối, Command Return cho phép.")
        .onAppear { shownAt = Date() }
    }
}

/// The hand that marks an approval, in amber; the question stays paper.
private struct AccentIconLabel: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 7) {
            configuration.icon.foregroundStyle(TiboStyle.accent)
            configuration.title
        }
    }
}

/// A visible key reminder inside a button, so ⌘↩ and Esc are learned without hovering for a tooltip.
struct KeyHint: View {
    let key: String
    let onAccent: Bool

    var body: some View {
        Text(key)
            .font(.system(size: 10, weight: .medium, design: .rounded))
            .foregroundStyle((onAccent ? TiboStyle.onAccent : TiboStyle.text).opacity(0.6))
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .overlay(Capsule().strokeBorder((onAccent ? TiboStyle.onAccent : TiboStyle.text).opacity(0.25)))
            .accessibilityHidden(true)
    }
}

struct AttachmentChip: View {
    let attachment: AgentAttachment
    let remove: () -> Void

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: attachment.symbol).foregroundStyle(TiboStyle.secondary)
            Text(attachment.name).lineLimit(1).truncationMode(.middle).frame(maxWidth: 130, alignment: .leading)
            Button(action: remove) {
                Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).frame(width: 24, height: 24).contentShape(Rectangle())
            }
            .buttonStyle(NotchButtonStyle(radius: 12))
            .foregroundStyle(TiboStyle.secondary)
            .accessibilityLabel("Bỏ \(attachment.name)")
            .help("Bỏ tệp này")
        }
        .font(TiboStyle.caption)
        .foregroundStyle(TiboStyle.text)
        .padding(.leading, 9)
        .frame(height: TiboStyle.control)
        .background(TiboStyle.raised, in: Capsule())
    }
}

/// Conversation history inside the island: open, rename (double-click or pencil), delete with a second
/// click to confirm. Row tools show on hover and on the open row; VoiceOver and the context menu always reach them.
struct SessionList: View {
    let sessions: [AgentSession]
    let selected: String?
    let open: (String) -> Void
    let rename: (String, String) -> Void
    let delete: (String) -> Void
    @State private var editing: String?
    @State private var draft = ""
    @State private var confirming: String?
    @State private var hovered: String?
    @FocusState private var fieldFocused: Bool

    var body: some View {
        if sessions.isEmpty {
            Text("Chưa có hội thoại nào.").font(TiboStyle.body).foregroundStyle(TiboStyle.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVStack(spacing: 2) {
                    ForEach(sessions) { row($0) }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
            }
            .scrollIndicators(.never)
            .mask(SoftEdges())
        }
    }

    @ViewBuilder private func row(_ session: AgentSession) -> some View {
        let current = session.id == selected
        let tools = current || hovered == session.id || confirming == session.id
        HStack(spacing: 6) {
            if editing == session.id {
                TextField("Tên phiên", text: $draft)
                    .textFieldStyle(.plain)
                    .font(TiboStyle.body)
                    .foregroundStyle(TiboStyle.text)
                    .focused($fieldFocused)
                    .onSubmit { rename(session.id, draft); editing = nil }
                    .onExitCommand { editing = nil }
                    .accessibilityLabel("Tên mới cho phiên")
                IconButton(symbol: "checkmark", label: "Lưu tên", tint: TiboStyle.accent) { rename(session.id, draft); editing = nil }
            } else {
                Button { open(session.id) } label: {
                    HStack(spacing: 8) {
                        Circle().fill(current ? TiboStyle.text : .clear).frame(width: 6, height: 6)
                        Text(session.displayTitle).font(TiboStyle.body).foregroundStyle(TiboStyle.text)
                            .lineLimit(1).truncationMode(.tail)
                        Spacer(minLength: 8)
                        Text(Self.ago(session.updated)).font(TiboStyle.caption).foregroundStyle(TiboStyle.secondary)
                    }
                    .frame(minHeight: TiboStyle.control)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .simultaneousGesture(TapGesture(count: 2).onEnded { startEditing(session) })
                .accessibilityLabel(session.displayTitle + (current ? ", đang mở" : ""))
                Group {
                    IconButton(symbol: "pencil", label: "Đổi tên") { startEditing(session) }
                    if confirming == session.id {
                        Button { delete(session.id); confirming = nil } label: {
                            Text("Xoá").font(TiboStyle.label).foregroundStyle(.white)
                                .padding(.horizontal, 12).frame(height: TiboStyle.control)
                                .background(TiboStyle.danger, in: Capsule())
                        }
                        .buttonStyle(NotchButtonStyle(radius: TiboStyle.control / 2))
                        .accessibilityLabel("Xác nhận xoá \(session.displayTitle)")
                    } else {
                        IconButton(symbol: "trash", label: "Xoá phiên") { confirming = session.id }
                    }
                }
                .opacity(tools ? 1 : 0)
            }
        }
        .padding(.horizontal, 8)
        .background(current ? TiboStyle.surface : .clear, in: RoundedRectangle(cornerRadius: TiboStyle.rowRadius, style: .continuous))
        .onHover { inside in
            if inside { hovered = session.id } else if hovered == session.id { hovered = nil }
        }
        .contextMenu {
            Button("Đổi tên") { startEditing(session) }
            Button("Xoá…", role: .destructive) { confirming = session.id }
        }
    }

    /// Vietnamese relative time; the system formatter falls back to English because the app ships no vi.lproj.
    static func ago(_ date: Date) -> String {
        let seconds = Date().timeIntervalSince(date)
        if seconds < 60 { return "vừa xong" }
        if seconds < 3600 { return "\(Int(seconds / 60)) phút trước" }
        if Calendar.current.isDateInToday(date) { return "\(Int(seconds / 3600)) giờ trước" }
        if Calendar.current.isDateInYesterday(date) { return "hôm qua" }
        if seconds < 7 * 86400 { return "\(Int(seconds / 86400)) ngày trước" }
        return date.formatted(.dateTime.day().month(.twoDigits))
    }

    private func startEditing(_ session: AgentSession) {
        confirming = nil
        draft = session.displayTitle == "Phiên mới" ? "" : session.title
        editing = session.id
        DispatchQueue.main.async { fieldFocused = true }
    }
}

struct AgentSuggestion: Identifiable {
    let id = UUID()
    let symbol: String
    let title: String
    let action: () -> Void
}

struct AgentEmptyState: View {
    let suggestions: [AgentSuggestion]

    /// Just the shortcuts: the composer placeholder already says you can ask or drop files.
    var body: some View {
        HStack(spacing: 6) {
            ForEach(suggestions) { suggestion in
                Button(action: suggestion.action) {
                    HStack(spacing: 6) {
                        Image(systemName: suggestion.symbol).foregroundStyle(TiboStyle.secondary)
                        Text(suggestion.title).font(TiboStyle.body).foregroundStyle(TiboStyle.text).lineLimit(1)
                    }
                    .padding(.horizontal, 12)
                    .frame(height: TiboStyle.control)
                    .background(TiboStyle.surface, in: Capsule())
                    .contentShape(Capsule())
                }
                .buttonStyle(NotchButtonStyle(radius: TiboStyle.control / 2))
            }
        }
        .padding(.horizontal, 14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
    }
}

struct DropOverlay: View {
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 18, style: .continuous).fill(TiboStyle.island.opacity(0.94))
            RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(TiboStyle.accent, style: StrokeStyle(lineWidth: 1.5, dash: [6, 5]))
            VStack(spacing: 6) {
                Image(systemName: "tray.and.arrow.down.fill").font(.system(size: 26)).foregroundStyle(TiboStyle.accent)
                Text("Thả để đưa cho Tibo").font(TiboStyle.title).foregroundStyle(TiboStyle.text)
                Text("Tệp, thư mục, ảnh hoặc link. Chưa gửi gì cho tới khi bạn nhấn Return.").font(TiboStyle.caption).foregroundStyle(TiboStyle.secondary)
            }
        }
        .padding(8)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

struct IconButton: View {
    let symbol: String
    let label: String
    var tint: Color = TiboStyle.secondary
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(tint)
                .frame(width: TiboStyle.control, height: TiboStyle.control)
                .contentShape(Rectangle())
        }
        .buttonStyle(NotchButtonStyle(radius: 8))
        .help(label)
        .accessibilityLabel(label)
    }
}

/// Feedback shared by every notch control: hover lightens, press sinks slightly (no scale under Reduce Motion).
/// Primary is ink on amber; white on amber would be 1.9:1.
struct NotchButtonStyle: ButtonStyle {
    enum Kind { case plain, primary, secondary }
    var kind: Kind = .plain
    var radius: CGFloat = 10

    func makeBody(configuration: Configuration) -> some View {
        StyledButton(configuration: configuration, kind: kind, radius: radius)
    }

    private struct StyledButton: View {
        let configuration: Configuration
        let kind: Kind
        let radius: CGFloat
        @State private var hovering = false
        @Environment(\.isEnabled) private var enabled
        @Environment(\.accessibilityReduceMotion) private var reduceMotion

        var body: some View {
            let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
            styled
                .background {
                    ZStack {
                        shape.fill(fill)
                        shape.fill((kind == .primary ? Color.white : TiboStyle.text).opacity(hovering && enabled ? 0.1 : 0))
                    }
                }
                .contentShape(shape)
                .scaleEffect(configuration.isPressed && !reduceMotion ? 0.96 : 1)
                .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: configuration.isPressed)
                .animation(reduceMotion ? nil : .easeOut(duration: 0.15), value: hovering)
                .onHover { hovering = $0 }
        }

        @ViewBuilder private var styled: some View {
            switch kind {
            case .plain:
                configuration.label
            case .primary, .secondary:
                configuration.label
                    .font(TiboStyle.label)
                    .foregroundStyle(kind == .primary ? TiboStyle.onAccent : TiboStyle.text)
                    .padding(.horizontal, 12)
                    .frame(height: TiboStyle.control)
            }
        }

        private var fill: Color {
            switch kind {
            case .plain: .clear
            case .primary: TiboStyle.accent
            case .secondary: TiboStyle.raised
            }
        }
    }
}

extension View {
    /// The composer draws its own amber border; the system ring would double it (API exists from macOS 14).
    @ViewBuilder func withoutSystemFocusRing() -> some View {
        if #available(macOS 14.0, *) { focusEffectDisabled() } else { self }
    }
}
