import AppKit
import Carbon
import SwiftUI
import Combine

@MainActor
func announceAccessibility(_ message: String, priority: NSAccessibilityPriorityLevel = .medium) {
    NSAccessibility.post(
        element: NSApp as Any,
        notification: .announcementRequested,
        userInfo: [.announcement: message, .priority: priority.rawValue]
    )
}


private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}

/// Taby-style notch: a pill hugging the camera housing that widens into a short work strip when
/// clicked, on the profile hotkey (⌃⌥Space by default), on a file drag, or while Tibo is busy; it tucks away once it loses focus.
private final class NotchPanel: NSPanel {
    override var canBecomeKey: Bool { true }
}

/// Tibo never activates on click, so without this the first click on the pill or a button only
/// focuses the panel and is swallowed. Except while an approval waits: the island can open on its own
/// over the app you are clicking in, and a click meant for that app must not land on Allow. Then the
/// first click only focuses the island and a second, deliberate click acts.
private final class FirstClickHostingView<Content: View>: NSHostingView<Content> {
    var consentPending: () -> Bool = { false }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { !consentPending() }
}

@MainActor
private final class NotchController: ObservableObject {
    /// Window size: room for the widest expanded strip. The visible notch is drawn inside it.
    static let panelSize = NSSize(width: 680, height: 280)
    /// Expanded with a conversation: wide rather than tall, so it reads as the notch growing sideways.
    static let expandedWidth: CGFloat = 640
    static let expandedHeight: CGFloat = 200
    /// Expanded with nothing to show yet: just the shortcuts and the composer.
    static let compactHeight: CGFloat = 92
    /// An approval takes the composer's place and needs a little more room than it.
    static let approvalExtra: CGFloat = 36
    /// Visible strip beside a hardware notch: the collapsed face and status live here, not under the camera.
    static let wing: CGFloat = 40
    @Published private(set) var expanded = false
    @Published private(set) var barHeight: CGFloat = 32
    @Published private(set) var pillWidth: CGFloat = 250
    @Published private(set) var popupWidth: CGFloat = expandedWidth
    @Published private(set) var position: Profile.NotchPosition = .center
    /// Width of the camera housing on this screen (0 without one); expanded controls keep clear of it.
    @Published private(set) var cameraGap: CGFloat = 0
    /// True while a file/link drag hovers the notch; the face reacts before the drop.
    @Published private(set) var dragging = false
    /// The composer has attachments waiting; the compact strip grows by one row for the tray.
    @Published var trayVisible = false
    /// The strip shows the session list instead of the conversation.
    @Published var showingHistory = false
    let store: ProfileStore
    let agent: AgentController
    let voice: VoiceController
    private let panel = NotchPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    private var lastActive = Date.distantPast
    private var observers: Set<AnyCancellable> = []
    private var timer: Timer?
    private var manuallyCollapsed = false
    private var hotKey: EventHotKeyRef?
    private var registeredHotkey: Profile.Hotkey?
    private var dragBaseline = NSPasteboard(name: .drag).changeCount
    private var screen: NSScreen?

    init(store: ProfileStore) {
        self.store = store
        agent = AgentController(store: store)
        voice = VoiceController(store: store, agent: agent)
        panel.level = .statusBar
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.ignoresMouseEvents = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        let host = FirstClickHostingView(rootView: ContentView(voice: voice, notch: self, agent: agent))
        host.consentPending = { [weak self] in self?.agent.approval != nil }
        panel.contentView = host
        installHotKeyHandler()
        // Settings drops a remembered command prefix; the agent owns the list and the file.
        NotificationCenter.default.publisher(for: .tiboForgetTrusted).sink { [weak self] note in
            guard let prefix = note.object as? String else { return }
            self?.agent.forgetTrusted(prefix)
        }.store(in: &observers)
        tick()
        panel.orderFrontRegardless()
        // ponytail: 10 Hz pointer poll instead of global mouse monitors; no Accessibility permission needed.
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
    }

    func toggle() {
        if expanded && panel.isKeyWindow { collapse(); return }
        present()
    }

    /// Opens and focuses the notch, e.g. after a drop or when returning from the attach panel.
    /// `activate`: after a drop the source app (Finder) is still active and keeps the keyboard, so the
    /// notch must activate Tibo for Return to reach the composer. The hotkey path does not need it.
    func present(activate: Bool = false) {
        manuallyCollapsed = false
        let opening = !expanded
        setExpanded(true)
        if activate { if #available(macOS 14.0, *) { NSApp.activate() } else { NSApp.activate(ignoringOtherApps: true) } }
        panel.makeKeyAndOrderFront(nil)
        if opening { NotificationCenter.default.post(name: .tiboNotchOpened, object: nil) }
    }

    func collapse() {
        manuallyCollapsed = true
        showingHistory = false
        panel.orderOut(nil) // drops key status so the auto-hide rule applies again
        panel.orderFrontRegardless()
        lastActive = .distantPast
        setExpanded(false)
    }
    func shutdown() {
        voice.shutdown()
        agent.stop()
        timer?.invalidate()
    }

    private func setExpanded(_ value: Bool) {
        guard expanded != value else { return }
        lastActive = Date()
        expanded = value
        panel.ignoresMouseEvents = !value
        print("TIBO_UI expanded=\(value) state=\(voice.state) key=\(panel.isKeyWindow)")
    }

    private func tick() {
        // Follow the pointer's screen while collapsed. `NSScreen.main` is the screen of Tibo's own key
        // window, so once the notch had focus it stayed on that display. Expanded, it stays put.
        let pointer = NSEvent.mouseLocation
        if !expanded, let under = NSScreen.screens.first(where: { NSMouseInRect(pointer, $0.frame, false) }) { self.screen = under }
        let screen = self.screen ?? NSScreen.main ?? NSScreen.screens[0]
        let profile = store.profile
        if profile.hotkey != registeredHotkey { registerHotKey(profile.hotkey) }
        let bar = max(24, screen.safeAreaInsets.top, screen.frame.maxY - screen.visibleFrame.maxY)
        let hardwareNotchWidth: CGFloat? = if let left = screen.auxiliaryTopLeftArea, let right = screen.auxiliaryTopRightArea {
            screen.frame.width - left.width - right.width
        } else {
            nil
        }
        // Collapsed: hardware notch plus a visible wing each side; without a notch, a small pill holding
        // just the face and the status. Expanded agent content needs room.
        let centered = profile.notchPosition == .center
        let pill = centered ? hardwareNotchWidth.map { $0 + 2 * Self.wing } ?? 2 * Self.wing + 64 : 100
        let popup = centered ? max(hardwareNotchWidth ?? Self.expandedWidth, Self.expandedWidth) : Self.expandedWidth
        if barHeight != bar { barHeight = bar }
        let gap = centered ? hardwareNotchWidth ?? 0 : 0
        if cameraGap != gap { cameraGap = gap }
        if pillWidth != pill { pillWidth = pill }
        if popupWidth != popup { popupWidth = popup }
        if position != profile.notchPosition { position = profile.notchPosition }
        let top = screen.frame
        let size = Self.panelSize
        let frame = NSRect(x: x(width: size.width, in: top), y: top.maxY - size.height, width: size.width, height: size.height)
        if panel.frame != frame { panel.setFrame(frame, display: true) }

        let visible = expanded ? NSSize(width: popupWidth, height: barHeight + bodyHeight) : NSSize(width: pillWidth, height: barHeight)
        let hotRect = NSRect(x: x(width: visible.width, in: top), y: top.maxY - visible.height, width: visible.width, height: visible.height)
        let hovering = hotRect.contains(NSEvent.mouseLocation)
        // Collapsed, the panel takes clicks only while the pointer is over the pill, so the rest of the
        // menu bar stays clickable; a click on the pill opens the notch (hover alone never does).
        if panel.ignoresMouseEvents == (expanded || hovering) { panel.ignoresMouseEvents = !(expanded || hovering) }
        // A drag writes the drag pasteboard when it starts; window moves and text selection do not.
        // The collapsed panel ignores mouse events, so it must open before the pointer can drop.
        let dragCount = NSPasteboard(name: .drag).changeCount
        let mouseDown = NSEvent.pressedMouseButtons & 1 != 0
        if !mouseDown { dragBaseline = dragCount }
        let draggingHere = mouseDown && dragCount != dragBaseline && hovering
        if dragging != draggingHere { dragging = draggingHere }
        if draggingHere { manuallyCollapsed = false }
        let busy = agent.state == .running || agent.state == .waitingApproval || voice.inputError != nil || voice.state == .speaking || voice.engaged
        if !busy && !hovering { manuallyCollapsed = false }
        if hovering || (busy && !manuallyCollapsed) || panel.isKeyWindow { lastActive = Date() }
        if !expanded && !manuallyCollapsed && (busy || draggingHere) {
            setExpanded(true)
        } else if expanded && Date().timeIntervalSince(lastActive) > profile.collapseDelay {
            setExpanded(false)
        }
    }

    /// Panel/pill origin for the chosen position; side positions keep a small gap from the screen edge.
    private func x(width: CGFloat, in top: NSRect) -> CGFloat {
        switch position {
        case .left: top.minX + 8
        case .center: top.midX - width / 2
        case .right: top.maxX - width - 8
        }
    }

    /// Height below the menu-bar band (fixed per state so the hit rect matches what is drawn):
    /// compact until there is a conversation to show.
    var bodyHeight: CGFloat {
        if showingHistory { return Self.expandedHeight }
        if agent.approval != nil { return Self.expandedHeight + Self.approvalExtra }
        let empty = agent.messages.isEmpty && agent.tools.isEmpty && agent.error == nil && !agent.isBusy
        return empty ? Self.compactHeight + (trayVisible ? 40 : 0) : Self.expandedHeight
    }

    private func installHotKeyHandler() {
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, _, context in
            guard let context else { return noErr }
            let notch = Unmanaged<NotchController>.fromOpaque(context).takeUnretainedValue()
            MainActor.assumeIsolated { notch.toggle() }
            return noErr
        }, 1, &spec, Unmanaged.passUnretained(self).toOpaque(), nil)
    }

    /// Called from `tick` whenever Settings saves a different shortcut.
    private func registerHotKey(_ key: Profile.Hotkey) {
        if let hotKey { UnregisterEventHotKey(hotKey); self.hotKey = nil }
        registeredHotkey = key
        let id = EventHotKeyID(signature: 0x4752_5A56, id: 1) // "GRZV"
        let status = RegisterEventHotKey(key.keyCode, key.modifiers, id, GetApplicationEventTarget(), 0, &hotKey)
        if status != noErr { print("TIBO_UI hotkey_register_failed key=\(key.label) status=\(status)") }
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

/// Taby's working light: sunset along the island's lower edge, like the brandkit's lit bezel. Amber
/// and ember sweep back and forth while Tibo works or listens; it holds still under Reduce Motion.
private struct EmberHorizon: View {
    let shape: NotchShape
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30, paused: reduceMotion)) { context in
            let phase = reduceMotion ? 0.5 : 0.5 + 0.35 * sin(context.date.timeIntervalSinceReferenceDate * 1.6)
            let light = LinearGradient(stops: [
                .init(color: TiboStyle.ember.opacity(0), location: 0),
                .init(color: TiboStyle.ember, location: max(0.01, phase - 0.3)),
                .init(color: TiboStyle.accent, location: phase),
                .init(color: TiboStyle.ember, location: min(0.99, phase + 0.3)),
                .init(color: TiboStyle.ember.opacity(0), location: 1),
            ], startPoint: .leading, endPoint: .trailing)
            ZStack {
                shape.stroke(light, lineWidth: 10).blur(radius: 10).opacity(0.7)
                shape.stroke(light, lineWidth: 1.5)
            }
            // Rises from the bottom edge and fades up the sides, so the light reads as a horizon, not a frame.
            .mask(LinearGradient(colors: [.clear, .clear, .black], startPoint: .top, endPoint: .bottom))
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

private struct ContentView: View {
    @ObservedObject var voice: VoiceController
    @ObservedObject var notch: NotchController
    @ObservedObject var agent: AgentController
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var reaction: BuddyFace.Mood?
    @State private var reactionID = 0
    @State private var draft = ""
    @State private var attachments: [AgentAttachment] = []
    @State private var dropTargeted = false
    @FocusState private var inputFocused: Bool

    var body: some View {
        let shape = NotchShape(radius: notch.expanded ? 24 : 10)
        ZStack(alignment: .top) {
            if notch.expanded { expandedView.transition(.opacity) } else { collapsedView.transition(.opacity) }
            if dropTargeted { DropOverlay().transition(.opacity) }
        }
        .frame(width: notch.expanded ? notch.popupWidth : notch.pillWidth,
               height: notch.barHeight + (notch.expanded ? notch.bodyHeight : 0), alignment: .top)
        // The island stays the hardware's black when it opens, whatever the system appearance.
        .background { shape.fill(TiboStyle.island) }
        .overlay { if notch.expanded && (agent.isBusy || voice.capturing) { EmberHorizon(shape: shape) } }
        .clipShape(shape)
        .dropDestination(for: URL.self) { urls, _ in accept(urls) } isTargeted: { dropTargeted = $0 }
        .contextMenu {
            Button(voice.micEnabled ? "Tắt microphone" : "Bật microphone", action: voice.toggleMicrophone)
            Button("Cài đặt…", action: openSettings)
            Divider()
            Button("Thoát Tibo") { NSApp.terminate(nil) }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: notch.position == .left ? .topLeading : notch.position == .right ? .topTrailing : .top)
        .environment(\.colorScheme, .dark)
        .animation(reduceMotion ? nil : .spring(response: 0.38, dampingFraction: 0.8), value: notch.expanded)
        .animation(reduceMotion ? nil : .easeOut(duration: 0.15), value: dropTargeted)
        .onChange(of: agent.error) { _, value in if let value { announceAccessibility("Lỗi: \(value)", priority: .high) } }
        .onChange(of: agent.state) { old, value in
            announceAccessibility(value.label)
            // Taby celebrates a finished run; a cancelled one ("Đã dừng") stays quiet.
            if old != .idle && value == .idle && agent.progress == "Hoàn tất" { react(.happy) }
        }
        .animation(reduceMotion ? nil : .easeOut(duration: 0.15), value: agent.approval)
        .onChange(of: agent.approval) { _, value in
            if let value { announceAccessibility("Tibo cần bạn cho phép: \(ToolPresentation(name: value.tool, arguments: value.arguments).title)", priority: .high) }
        }
        // Opening by click or hotkey lands in the composer, ready to type. The field only exists after
        // this render, so focus it on the next run-loop turn.
        .onChange(of: notch.expanded) { _, open in if open { DispatchQueue.main.async { inputFocused = true } } }
        .onChange(of: attachments.isEmpty) { _, empty in notch.trayVisible = !empty }
        .animation(reduceMotion ? nil : .spring(response: 0.3, dampingFraction: 0.85), value: notch.bodyHeight)
    }

    /// Face in the left wing, live status in the right wing; the middle stays clear of the camera housing.
    private var collapsedView: some View {
        HStack(spacing: 0) {
            BuddyFace(mood: mood, hearing: voice.hearing)
                .frame(width: NotchController.wing, height: notch.barHeight * 0.8)
            Spacer(minLength: 0)
            statusGlyph.frame(width: NotchController.wing)
        }
        .frame(height: notch.barHeight)
        .contentShape(Rectangle())
        .onTapGesture { notch.toggle() }
        .help("Bấm để mở \(name) (\(notch.store.profile.hotkey.label))")
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(name): \(statusLine)")
        .accessibilityHint("Bấm để mở. Phím tắt \(notch.store.profile.hotkey.spoken). Có thể thả tệp hoặc link vào đây.")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { notch.toggle() }
    }

    @ViewBuilder private var statusGlyph: some View {
        if agent.approval != nil {
            Image(systemName: "hand.raised.fill").font(.system(size: 11)).foregroundStyle(TiboStyle.accent)
        } else if agent.isBusy {
            ProgressView().controlSize(.mini)
        } else if agent.state == .failed {
            Image(systemName: "exclamationmark.circle.fill").font(.system(size: 11)).foregroundStyle(TiboStyle.danger)
        } else if !attachments.isEmpty {
            Text("\(attachments.count)")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(TiboStyle.onAccent)
                .frame(minWidth: 16, minHeight: 16)
                .background(TiboStyle.accent, in: Capsule())
        } else if voice.micEnabled {
            Image(systemName: "mic.fill").font(.system(size: 10)).foregroundStyle(TiboStyle.secondary)
        }
    }

    /// Wide and short: face, status and session controls sit in the menu-bar band either side of the
    /// camera housing, so the island below is all work area. An approval takes the composer's place.
    private var expandedView: some View {
        VStack(spacing: 8) {
            Group {
                if notch.showingHistory {
                    SessionList(sessions: agent.sessions, selected: agent.selectedSessionID,
                                open: { agent.loadSession($0); notch.showingHistory = false },
                                rename: agent.renameSession, delete: agent.deleteSession)
                } else if agent.messages.isEmpty && agent.tools.isEmpty && agent.error == nil && !agent.isBusy {
                    AgentEmptyState(suggestions: suggestions)
                } else {
                    // While an approval is open the card already shows the pending call; don't repeat it.
                    AgentTimeline(messages: agent.messages, tools: agent.approval == nil ? agent.tools : agent.tools.filter { $0.result != nil },
                                  error: agent.error, openSettings: openSettings)
                }
            }
            .frame(maxHeight: .infinity)
            if let approval = agent.approval {
                // Each approval gets fresh state: "remember" never carries over to the next request.
                ApprovalCard(approval: approval, decide: agent.approve)
                    .id(approval.id)
                    .padding(.horizontal, 10)
                    .transition(.opacity)
            } else {
                composer
            }
        }
        .padding(.top, notch.barHeight)
        .padding(.bottom, 10)
        .overlay(alignment: .top) { header }
        // Esc denies a pending approval (fail closed); otherwise it tucks the notch away.
        .onExitCommand {
            if agent.approval != nil { agent.approve(false) }
            else if notch.showingHistory { notch.showingHistory = false }
            else { notch.collapse() }
        }
    }

    /// Two halves around the camera housing so nothing is drawn under it. Taby's face sits straight on the
    /// island's black and the status line is Taby speaking.
    private var header: some View {
        HStack(spacing: 0) {
            HStack(spacing: 8) {
                BuddyFace(mood: mood, hearing: voice.hearing, zoom: 1.1)
                    .frame(width: 58, height: notch.barHeight - 2)
                Text(statusLine).font(TiboStyle.voice).foregroundStyle(statusColor).lineLimit(1).truncationMode(.tail)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .ignore)
            .accessibilityAddTraits(.isStaticText)
            .accessibilityLabel("\(name), \(statusLine)")
            Color.clear.frame(width: notch.cameraGap + 16)
            HStack(spacing: 2) {
                if voice.state == .speaking { IconButton(symbol: "speaker.slash.fill", label: "Ngắt giọng nói", action: voice.stopPlayback) }
                IconButton(symbol: "clock.arrow.circlepath", label: notch.showingHistory ? "Đóng lịch sử" : "Lịch sử hội thoại",
                           tint: notch.showingHistory ? TiboStyle.text : TiboStyle.secondary) {
                    if !notch.showingHistory { agent.refreshSessions() }
                    notch.showingHistory.toggle()
                }
                .disabled(agent.isBusy)
                IconButton(symbol: "square.and.pencil", label: "Phiên mới") {
                    agent.newSession()
                    notch.showingHistory = false
                    inputFocused = true
                }
                .disabled(agent.isBusy)
                IconButton(symbol: "chevron.up", label: "Thu gọn (Esc)", action: notch.collapse)
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(.leading, 12)
        .padding(.trailing, 10)
        .frame(height: notch.barHeight)
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !attachments.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(attachments) { attachment in
                            AttachmentChip(attachment: attachment) { attachments.removeAll { $0.id == attachment.id } }
                        }
                    }
                }
                .accessibilityLabel("Tệp đính kèm")
            }
            HStack(alignment: .bottom, spacing: 4) {
                Menu {
                    Button("Đính kèm tệp hoặc thư mục…", systemImage: "paperclip", action: chooseFiles)
                    Button("Đọc màn hình", systemImage: "text.viewfinder") { agent.readScreen(question: "Hãy đọc và giải thích màn hình hiện tại.") }
                } label: {
                    Image(systemName: "plus").font(.system(size: 14, weight: .semibold)).foregroundStyle(TiboStyle.secondary)
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                .fixedSize()
                .frame(width: TiboStyle.control, height: TiboStyle.control)
                .help("Đính kèm tệp hoặc đọc màn hình")
                .accessibilityLabel("Đính kèm tệp hoặc đọc màn hình")
                TextField(placeholder, text: $draft, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(TiboStyle.body)
                    .foregroundStyle(TiboStyle.text)
                    .lineLimit(1...4)
                    .focused($inputFocused)
                    .withoutSystemFocusRing()
                    .padding(.vertical, 4)
                    .onSubmit(send)
                    .accessibilityLabel("Tin nhắn cho Tibo")
                // Wake mode listens all the time, so the button toggles the mic; tap modes arm one turn
                // (the context menu still turns the mic off).
                let tapToTalk = voice.micEnabled && voice.voiceMode != .wake
                IconButton(symbol: voice.micEnabled ? "mic.fill" : "mic.slash",
                           label: tapToTalk ? "Bấm để nói" : voice.micEnabled ? "Tắt microphone" : "Bật microphone",
                           tint: voice.micEnabled ? TiboStyle.text : TiboStyle.secondary,
                           action: tapToTalk ? voice.tapMic : voice.toggleMicrophone)
                if agent.isBusy {
                    Button(action: agent.cancel) {
                        Image(systemName: "stop.fill")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(TiboStyle.text)
                            .frame(width: TiboStyle.control, height: TiboStyle.control)
                            .background(TiboStyle.raised, in: Circle())
                    }
                    .buttonStyle(NotchButtonStyle(radius: TiboStyle.control / 2))
                    .keyboardShortcut(".", modifiers: .command)
                    .help("Dừng tác vụ (⌘.)")
                    .accessibilityLabel("Dừng tác vụ agent")
                } else {
                    Button(action: send) {
                        Image(systemName: "arrow.up")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(canSend ? TiboStyle.onAccent : TiboStyle.secondary)
                            .frame(width: TiboStyle.control, height: TiboStyle.control)
                            .background(canSend ? TiboStyle.accent : TiboStyle.surface, in: Circle())
                    }
                    .buttonStyle(NotchButtonStyle(radius: TiboStyle.control / 2))
                    .disabled(!canSend)
                    // Return sends even when the field lost focus (e.g. right after a drop).
                    .keyboardShortcut(.defaultAction)
                    .help("Gửi (Return)")
                    .accessibilityLabel("Gửi")
                }
            }
            .padding(2)
            .background(TiboStyle.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(inputFocused ? TiboStyle.accent.opacity(0.6) : TiboStyle.hairline))
        }
        .padding(.horizontal, 10)
    }

    private var name: String { notch.store.profile.assistantName.isEmpty ? "Tibo" : notch.store.profile.assistantName }

    private var placeholder: String {
        if agent.isBusy { return "\(name) đang làm việc… ⌘. để dừng" }
        return attachments.isEmpty ? "Hỏi \(name) hoặc thả tệp vào đây" : "Muốn \(name) làm gì? Return để xem nhanh"
    }

    /// Read screen is built in; the user's quick prompts (Settings › Notch) follow it. Attaching lives in +.
    private var suggestions: [AgentSuggestion] {
        [AgentSuggestion(symbol: "text.viewfinder", title: "Đọc màn hình") { agent.readScreen(question: "Hãy đọc và giải thích màn hình hiện tại.") }]
            + notch.store.profile.quickPrompts.prefix(Profile.maxQuickPrompts).map { item in
                AgentSuggestion(symbol: "text.bubble", title: item.title) { agent.prompt(item.prompt) }
            }
    }

    private func openSettings() {
        notch.collapse()
        TiboWindows.showSettings(store: notch.store)
    }

    private var canSend: Bool {
        !agent.isBusy && (!draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty)
    }

    private func send() {
        guard canSend else { return }
        let text = draft, files = attachments
        draft = ""
        attachments = []
        agent.prompt(text, attachments: files)
    }

    /// Drop and the attach panel share this path: dedupe, cap, focus the composer, never auto-send.
    /// Sending stays an explicit Return because the content goes to the configured model provider.
    private func accept(_ urls: [URL]) -> Bool {
        let added = urls.compactMap(AgentAttachment.init(url:)).filter { new in !attachments.contains { $0.url == new.url } }
        guard !added.isEmpty else { return false }
        attachments = Array((attachments + added).prefix(AgentAttachment.limit))
        // A drop arrives while the source app still owns the drag; taking key status inside the
        // callback is ignored, so focus on the next run-loop turn. Reset first: a stale `true`
        // would make the assignment a no-op while the field is not actually first responder.
        inputFocused = false
        DispatchQueue.main.async {
            notch.present(activate: true)
            inputFocused = true
        }
        react(.happy)
        announceAccessibility("Đã đính kèm \(added.count) mục. Nhập yêu cầu hoặc nhấn Return để Tibo xem.")
        return true
    }

    /// Non-drag alternative to dropping (WCAG 2.5.7).
    private func chooseFiles() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = true
        panel.prompt = "Đính kèm"
        panel.message = "Chọn tệp hoặc thư mục để Tibo xem"
        // Tibo is a menu-bar agent whose notch never activates the app; a panel that hides on
        // deactivation would stay invisible while blocking. Non-modal keeps the notch responsive.
        panel.hidesOnDeactivate = false
        panel.level = .floating
        if #available(macOS 14.0, *) { NSApp.activate() } else { NSApp.activate(ignoringOtherApps: true) }
        panel.begin { response in
            if response == .OK { _ = accept(panel.urls) } else { notch.present() }
        }
    }

    private func react(_ value: BuddyFace.Mood) {
        reactionID += 1
        let id = reactionID
        reaction = value
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { if reactionID == id { reaction = nil } }
    }

    private var statusLine: String {
        if agent.approval != nil { return "Chờ bạn cho phép" }
        if agent.state == .failed { return "Gặp lỗi" }
        if agent.isBusy { return agent.progress.isEmpty ? agent.state.label : agent.progress }
        if voice.state == .speaking { return "Đang nói" }
        if agent.progress == "Đã dừng" { return "Đã dừng" }
        if voice.micEnabled { return voice.state.rawValue }
        return "Ở ngay đây"
    }

    /// Paper, or red when Tibo failed; the face carries the rest. Amber stays on the action itself.
    private var statusColor: Color {
        agent.state == .failed ? TiboStyle.danger : TiboStyle.text
    }

    private var mood: BuddyFace.Mood {
        if dropTargeted || notch.dragging { return .surprised }
        if let reaction { return reaction }
        if agent.approval != nil { return .asking }
        if agent.state == .failed { return .failed }
        if agent.state == .running { return .thinking }
        if voice.state == .speaking { return .talking }
        return .idle
    }
}
/// Taby's face from the firmware-taby 1.64 pack (TRIIIS-LABS/firmware-taby@3681c7f, bundled in
/// Resources/taby). The artwork stays Taby's under the Taby Artwork Terms in Resources/taby/LICENSE.
struct BuddyFace: View {
    enum Mood: Equatable { case idle, thinking, talking, asking, sleeping, happy, surprised, failed }
    let mood: Mood
    /// The mic heard a voice in the last 1.5 s: idle turns attentive.
    let hearing: Bool
    /// Above 1 the clip's black margin is cropped so the face itself fills a short band (the header).
    var zoom: CGFloat = 1
    @State private var player = FacePlayer()

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 20)) { context in
            Canvas { ctx, size in
                guard let frame = player.frame(mood: mood, hearing: hearing, at: context.date.timeIntervalSinceReferenceDate) else { return }
                // Frames are 280×456 with the face turned clockwise for the portrait panel: turn it back, aspect-fit.
                let scale = min(size.width / CGFloat(frame.height), size.height / CGFloat(frame.width)) * zoom
                let w = CGFloat(frame.width) * scale, h = CGFloat(frame.height) * scale
                ctx.clip(to: Path(CGRect(origin: .zero, size: size)))
                ctx.translateBy(x: size.width / 2, y: size.height / 2)
                ctx.rotate(by: .degrees(-90))
                ctx.draw(Image(decorative: frame, scale: 1), in: CGRect(x: -w / 2, y: -h / 2, width: w, height: h))
            }
        }
    }
}

/// Picks the clip sequence for a mood and plays it: intros once, a trailing `_loop` clip loops,
/// any other trailing clip holds its last frame. Idle turns attentive while the mic hears a voice
/// and now and then plays an ambient antic.
private final class FacePlayer {
    private static let tracks: [BuddyFace.Mood: [String]] = [
        .idle: ["idle_01_loop"],
        .thinking: ["claude_in", "claude_loop"],
        .talking: ["talking_default_loop"],
        .asking: ["taby_response_ready_in", "taby_response_ready_loop"],
        .sleeping: ["sleeping_loop"],
        .happy: ["confirmation"],
        .surprised: ["wow"],
        .failed: ["disappointed"],
    ]
    private static let antics = [
        "idle_02_loop", "idle_variation_loop", "blush", "stretching", "drink_water", "posture_check",
        "flower_grow", "fishing_short", "fishing_long", "basketball_throw", "basketball_dunk", "boxing",
        "love_01", "relaxing_01_loop", "listening_music_loop", "f1_car", "yeah", "thumbs_up",
    ]
    private var track: [String] = []
    private var startedAt = 0.0
    private var antic: (id: String, until: Double)?
    private var nextAnticAt: Double?

    func frame(mood: BuddyFace.Mood, hearing: Bool, at t: Double) -> CGImage? {
        let next = pick(mood: mood, hearing: hearing, at: t)
        if next != track { track = next; startedAt = t }
        var elapsed = t - startedAt
        for (index, id) in track.enumerated() {
            guard let clip = FaceClip.named(id) else { return nil }
            if index < track.count - 1 {
                if elapsed < clip.duration { return clip.frame(at: elapsed) }
                elapsed -= clip.duration
            } else {
                return clip.frame(at: id.hasSuffix("_loop") ? elapsed.truncatingRemainder(dividingBy: clip.duration) : elapsed)
            }
        }
        return nil
    }

    private func pick(mood: BuddyFace.Mood, hearing: Bool, at t: Double) -> [String] {
        guard mood == .idle, !hearing else {
            antic = nil
            nextAnticAt = nil
            return mood == .idle ? ["listening_in", "listening_loop"] : Self.tracks[mood, default: []]
        }
        if let antic, t < antic.until { return [antic.id] }
        antic = nil
        guard let due = nextAnticAt else {
            nextAnticAt = t + .random(in: 45...120)
            return ["idle_01_loop"]
        }
        if t >= due, let id = Self.antics.randomElement(), let clip = FaceClip.named(id) {
            antic = (id, t + clip.duration)
            nextAnticAt = nil
            return [id]
        }
        return ["idle_01_loop"]
    }
}

/// One bundled GIF, decoded a frame at a time: a fully decoded idle loop would be ~90 MB.
private final class FaceClip {
    private static var cache: [String: FaceClip] = [:]
    let duration: Double
    private let source: CGImageSource
    private let ends: [Double]

    private init(source: CGImageSource, ends: [Double]) {
        self.source = source
        self.ends = ends
        duration = ends.last ?? 0
    }

    static func named(_ id: String) -> FaceClip? {
        if let clip = cache[id] { return clip }
        guard let url = Bundle.main.url(forResource: id, withExtension: "gif", subdirectory: "taby"),
              let source = CGImageSourceCreateWithURL(url as CFURL, nil), CGImageSourceGetCount(source) > 0 else {
            print("TIBO_UI face_clip_missing id=\(id)")
            return nil
        }
        var t = 0.0
        let ends = (0..<CGImageSourceGetCount(source)).map { index -> Double in
            let props = CGImageSourceCopyPropertiesAtIndex(source, index, nil) as? [CFString: Any]
            let gif = props?[kCGImagePropertyGIFDictionary] as? [CFString: Any]
            let delay = gif?[kCGImagePropertyGIFUnclampedDelayTime] as? Double ?? 0
            t += delay > 0.01 ? delay : 0.05
            return t
        }
        let clip = FaceClip(source: source, ends: ends)
        cache[id] = clip
        return clip
    }

    func frame(at elapsed: Double) -> CGImage? {
        CGImageSourceCreateImageAtIndex(source, ends.firstIndex { $0 > elapsed } ?? ends.count - 1, nil)
    }
}

@MainActor
private final class AppDelegate: NSObject, NSApplicationDelegate {
    private let store = ProfileStore()
    private var notch: NotchController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // The JSONL agent runtime writes to a pipe; ignore SIGPIPE during shutdown.
        signal(SIGPIPE, SIG_IGN)
        // Finder launches send stdout to /dev/null, and a redirected stdout is block-buffered, so turn
        // traces (STAGE, TIBO_JEV, TIBO_ROUTE…) were lost. Keep a line-buffered log, reset past 5 MB.
        if isatty(STDOUT_FILENO) == 0 {
            let logs = ProfileStore.dataDir.appendingPathComponent("logs")
            try? FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true)
            let path = logs.appendingPathComponent("app.log").path
            if let size = (try? FileManager.default.attributesOfItem(atPath: path))?[.size] as? Int, size > 5_000_000 {
                try? FileManager.default.removeItem(atPath: path)
            }
            freopen(path, "a", stdout)
        }
        setvbuf(stdout, nil, _IOLBF, 0)
        // Two instances hear each other's TTS and answer every question twice; the running one wins.
        let me = NSRunningApplication.current
        if NSRunningApplication.runningApplications(withBundleIdentifier: Bundle.main.bundleIdentifier ?? "")
            .contains(where: { $0.processIdentifier != me.processIdentifier && !$0.isTerminated }) {
            print("TIBO_UI already_running; exiting")
            NSApp.terminate(nil)
            return
        }
        NSApp.setActivationPolicy(.accessory)
        if store.profile.onboarded {
            notch = NotchController(store: store)
        } else {
            TiboWindows.showOnboarding(store: store, startNotch: { [weak self] in self?.startNotch() }, onFinish: { [weak self] in self?.startNotch() })
        }
    }
    func applicationWillTerminate(_ notification: Notification) {
        notch?.shutdown()
    }

    private func startNotch() {
        if notch == nil { notch = NotchController(store: store) }
        }
    }

@main
struct TiboApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    var body: some Scene { Settings { EmptyView() } }
}
