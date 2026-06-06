import UIKit
import UniformTypeIdentifiers

class ShareViewController: UIViewController {

    private let appGroupId = "group.com.habitat.app"
    private let urlScheme = "habitat"

    override func viewDidLoad() {
        super.viewDidLoad()
        handleSharedContent()
    }

    private func handleSharedContent() {
        guard let extensionItems = extensionContext?.inputItems as? [NSExtensionItem] else {
            complete()
            return
        }

        let group = DispatchGroup()
        var sharedItems: [[String: String]] = []

        for item in extensionItems {
            guard let attachments = item.attachments else { continue }

            for provider in attachments {
                if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    group.enter()
                    provider.loadItem(forTypeIdentifier: UTType.url.identifier) { data, _ in
                        defer { group.leave() }
                        guard let url = data as? URL else { return }
                        let title = item.attributedContentText?.string ?? url.host ?? ""
                        sharedItems.append([
                            "type": "url",
                            "url": url.absoluteString,
                            "title": title
                        ])
                    }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    group.enter()
                    provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) { data, _ in
                        defer { group.leave() }
                        guard let text = data as? String else { return }
                        let title = String(text.prefix(50))
                        sharedItems.append([
                            "type": "text",
                            "text": text,
                            "title": title
                        ])
                    }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                    group.enter()
                    provider.loadItem(forTypeIdentifier: UTType.image.identifier) { data, _ in
                        defer { group.leave() }
                        var imagePath: String?
                        if let url = data as? URL {
                            imagePath = url.path
                        } else if let image = data as? UIImage,
                                  let imageData = image.pngData() {
                            let tempURL = FileManager.default.containerURL(
                                forSecurityApplicationGroupIdentifier: self.appGroupId
                            )?.appendingPathComponent("shared-image-\(UUID().uuidString).png")
                            if let tempURL = tempURL {
                                try? imageData.write(to: tempURL)
                                imagePath = tempURL.path
                            }
                        }
                        if let path = imagePath {
                            sharedItems.append([
                                "type": "image",
                                "path": path,
                                "filename": URL(fileURLWithPath: path).lastPathComponent
                            ])
                        }
                    }
                }
            }
        }

        group.notify(queue: .main) { [weak self] in
            guard let self = self else { return }
            self.saveAndOpen(items: sharedItems)
        }
    }

    private func saveAndOpen(items: [[String: String]]) {
        guard !items.isEmpty,
              let defaults = UserDefaults(suiteName: appGroupId) else {
            complete()
            return
        }

        if let existing = defaults.array(forKey: "share-target-data") as? [[String: String]] {
            defaults.set(existing + items, forKey: "share-target-data")
        } else {
            defaults.set(items, forKey: "share-target-data")
        }

        triggerHaptic()
        openMainApp()
        complete()
    }

    private func triggerHaptic() {
        let generator = UINotificationFeedbackGenerator()
        generator.prepare()
        generator.notificationOccurred(.success)
    }

    private func openMainApp() {
        guard let url = URL(string: "\(urlScheme)://share-ingest") else { return }
        var responder: UIResponder? = self
        while let r = responder {
            if let application = r as? UIApplication {
                application.open(url, options: [:], completionHandler: nil)
                return
            }
            responder = r.next
        }
        extensionContext?.open(url, completionHandler: nil)
    }

    private func complete() {
        extensionContext?.completeRequest(returningItems: nil)
    }
}
