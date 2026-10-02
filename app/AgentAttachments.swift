import AppKit
import ImageIO
import PDFKit
import UniformTypeIdentifiers
import Vision

/// Something the user handed to Tibo by dropping it on the notch or choosing it with the attach button.
/// Only what the user explicitly hands over is read; the runtime receives extracted text, never a grant
/// to browse outside its workspace.
struct AgentAttachment: Identifiable, Equatable {
    enum Kind: String { case file, folder, image, link }

    /// Separates the typed request from the attachment block in a stored user message.
    /// `scripts/tibo_agent.py` writes the same marker; the notch shows only the text before it.
    static let marker = "\n\n[Tệp đính kèm]"
    static let limit = 10
    private static let textLimit = 30_000
    private static let readLimit = 5_000_000

    let id = UUID()
    let url: URL
    let kind: Kind

    init?(url: URL) {
        if url.isFileURL {
            var isDirectory: ObjCBool = false
            guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) else { return nil }
            let type = UTType(filenameExtension: url.pathExtension)
            self.url = url.standardizedFileURL
            if isDirectory.boolValue && type?.conforms(to: .package) != true { kind = .folder }
            else if type?.conforms(to: .image) == true { kind = .image }
            else { kind = .file }
        } else if let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https", url.host != nil {
            self.url = url
            kind = .link
        } else {
            return nil
        }
    }

    var name: String { kind == .link ? (url.host ?? url.absoluteString) : url.lastPathComponent }

    var symbol: String {
        switch kind {
        case .file: "doc.text"
        case .folder: "folder"
        case .image: "photo"
        case .link: "link"
        }
    }

    /// The `attachments` field of a runtime `prompt` command. Runs off the main thread: PDFs, Office
    /// documents and OCR can take a moment. Images become a downscaled JPEG in the temporary directory,
    /// returned in `temporary` so the caller deletes them after the run.
    nonisolated static func payload(for items: [AgentAttachment]) -> (attachments: [[String: Any]], temporary: [URL]) {
        var temporary: [URL] = []
        let attachments = items.prefix(limit).map { item -> [String: Any] in
            var entry: [String: Any] = ["kind": item.kind.rawValue, "name": item.name,
                                        "path": item.kind == .link ? item.url.absoluteString : item.url.path]
            var text: String?
            switch item.kind {
            case .link:
                break
            case .folder:
                let children = (try? FileManager.default.contentsOfDirectory(at: item.url, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles])) ?? []
                text = children.map { $0.lastPathComponent + (($0.hasDirectoryPath) ? "/" : "") }.sorted().prefix(200).joined(separator: "\n")
            case .image:
                let jpeg = FileManager.default.temporaryDirectory.appendingPathComponent("tibo-attachment-\(UUID().uuidString).jpg")
                if let image = thumbnail(of: item.url), write(image, to: jpeg) {
                    temporary.append(jpeg)
                    entry["image"] = jpeg.path
                    text = recognizeText(in: image).joined(separator: "\n")
                }
            case .file:
                text = extractText(from: item.url)
            }
            if let text, !text.isEmpty {
                entry["text"] = String(text.prefix(textLimit))
                if text.count > textLimit { entry["truncated"] = true }
            }
            return entry
        }
        return (attachments, temporary)
    }

    /// PDF via PDFKit, Word/RTF/OpenDocument via AppKit's importers, everything else only if it is UTF-8 text.
    /// Returns nil for binaries; the runtime then sees the name and path only.
    nonisolated private static func extractText(from url: URL) -> String? {
        let ext = url.pathExtension.lowercased()
        if ext == "pdf" { return PDFDocument(url: url)?.string }
        if ["doc", "docx", "rtf", "rtfd", "odt"].contains(ext) {
            return (try? NSAttributedString(url: url, options: [:], documentAttributes: nil))?.string
        }
        guard let size = (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize, size <= readLimit,
              let data = try? Data(contentsOf: url), !data.contains(0),
              let text = String(data: data, encoding: .utf8) else { return nil }
        return text
    }

    nonisolated static func thumbnail(of url: URL) -> CGImage? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
        let options = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true,
                       kCGImageSourceThumbnailMaxPixelSize: 1600] as CFDictionary
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options)
    }

    /// OCR keeps images useful for text-only models; the JPEG still goes to models with vision.
    nonisolated static func recognizeText(in image: CGImage) -> [String] {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["vi-VT", "en-US"]
        try? VNImageRequestHandler(cgImage: image).perform([request])
        return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
    }

    nonisolated private static func write(_ image: CGImage, to url: URL) -> Bool {
        guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else { return false }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.8] as CFDictionary)
        return CGImageDestinationFinalize(destination)
    }
}
