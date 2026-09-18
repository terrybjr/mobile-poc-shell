import Capacitor
import ImageIO
import UIKit
import Vision

@objc(MobileVisionTextRecognitionPlugin)
public final class MobileVisionTextRecognitionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MobileVisionTextRecognitionPlugin"
    public let jsName = "MobileVisionTextRecognition"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "detectText", returnType: CAPPluginReturnPromise)
    ]

    @objc func detectText(_ call: CAPPluginCall) {
        guard let encodedImage = call.getString("base64Image"),
              let imageData = Data(base64Encoded: encodedImage, options: .ignoreUnknownCharacters),
              let image = UIImage(data: imageData),
              let cgImage = image.cgImage else {
            call.reject("Unable to decode the captured image", "MOBILE_VISION_INVALID_IMAGE")
            return
        }

        let orientation = Self.cgImageOrientation(for: image.imageOrientation)
        DispatchQueue.global(qos: .userInitiated).async {
            let request = VNRecognizeTextRequest { request, error in
                if let error {
                    DispatchQueue.main.async {
                        call.reject(error.localizedDescription, "MOBILE_VISION_RECOGNITION_FAILED")
                    }
                    return
                }

                let observations = (request.results as? [VNRecognizedTextObservation] ?? [])
                    .sorted {
                        if abs($0.boundingBox.midY - $1.boundingBox.midY) > 0.02 {
                            return $0.boundingBox.midY > $1.boundingBox.midY
                        }
                        return $0.boundingBox.minX < $1.boundingBox.minX
                    }
                let text = observations.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")

                DispatchQueue.main.async {
                    call.resolve(["text": text])
                }
            }
            request.recognitionLevel = .accurate
            request.recognitionLanguages = ["en-US"]
            request.usesLanguageCorrection = true

            do {
                let handler = VNImageRequestHandler(cgImage: cgImage, orientation: orientation, options: [:])
                try handler.perform([request])
            } catch {
                DispatchQueue.main.async {
                    call.reject(error.localizedDescription, "MOBILE_VISION_RECOGNITION_FAILED")
                }
            }
        }
    }

    private static func cgImageOrientation(for orientation: UIImage.Orientation) -> CGImagePropertyOrientation {
        switch orientation {
        case .up: return .up
        case .upMirrored: return .upMirrored
        case .down: return .down
        case .downMirrored: return .downMirrored
        case .left: return .left
        case .leftMirrored: return .leftMirrored
        case .right: return .right
        case .rightMirrored: return .rightMirrored
        @unknown default: return .up
        }
    }
}
