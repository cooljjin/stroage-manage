import AVFoundation
import AudioToolbox
import Capacitor
import UIKit

@objc(FastBarcodeScannerPlugin)
public class FastBarcodeScannerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FastBarcodeScannerPlugin"
    public let jsName = "FastBarcodeScanner"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise)
    ]

    private var activeScanner: FastBarcodeScannerViewController?

    @objc public func scan(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.requestCameraPermissionIfNeeded { granted in
                guard granted else {
                    call.reject("camera permission denied")
                    return
                }
                self.presentScanner(call)
            }
        }
    }

    private func requestCameraPermissionIfNeeded(completion: @escaping (Bool) -> Void) {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            completion(true)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                DispatchQueue.main.async {
                    completion(granted)
                }
            }
        default:
            completion(false)
        }
    }

    private func presentScanner(_ call: CAPPluginCall) {
        guard activeScanner == nil else {
            call.reject("scanner already active")
            return
        }

        let formats = call.getArray("formats", String.self) ?? []
        let zoomFactor = call.getDouble("zoomFactor") ?? 1.25
        let scanner = FastBarcodeScannerViewController(
            formats: Self.metadataObjectTypes(for: formats),
            zoomFactor: CGFloat(zoomFactor),
            onBarcode: { [weak self] barcode in
                self?.activeScanner = nil
                call.resolve([
                    "barcode": barcode,
                    "rawValue": barcode
                ])
            },
            onRegister: { [weak self] in
                self?.activeScanner = nil
                call.resolve([
                    "action": "register"
                ])
            },
            onCancel: { [weak self] in
                self?.activeScanner = nil
                call.resolve([
                    "cancelled": true
                ])
            },
            onError: { [weak self] message in
                self?.activeScanner = nil
                call.reject(message)
            }
        )
        scanner.modalPresentationStyle = .fullScreen
        activeScanner = scanner
        bridge?.viewController?.present(scanner, animated: false)
    }

    private static func metadataObjectTypes(for formats: [String]) -> [AVMetadataObject.ObjectType] {
        let requested = formats.isEmpty ? ["EAN_13", "EAN_8", "UPC_A", "UPC_E", "CODE_128", "CODE_39", "CODE_93", "ITF", "CODABAR"] : formats
        var types: [AVMetadataObject.ObjectType] = []

        for format in requested {
            switch format {
            case "EAN_13", "UPC_A":
                types.append(.ean13)
            case "EAN_8":
                types.append(.ean8)
            case "UPC_E":
                types.append(.upce)
            case "CODE_128":
                types.append(.code128)
            case "CODE_39":
                types.append(.code39)
            case "CODE_93":
                types.append(.code93)
            case "ITF":
                types.append(.interleaved2of5)
                types.append(.itf14)
            case "CODABAR":
                types.append(.codabar)
            default:
                break
            }
        }

        return Array(Set(types))
    }
}

private final class FastBarcodeScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    private let formats: [AVMetadataObject.ObjectType]
    private let zoomFactor: CGFloat
    private let onBarcode: (String) -> Void
    private let onRegister: () -> Void
    private let onCancel: () -> Void
    private let onError: (String) -> Void

    private let captureSession = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "FastBarcodeScanner.SessionQueue")
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var hasCompleted = false
    private var isConfiguringSession = false

    init(
        formats: [AVMetadataObject.ObjectType],
        zoomFactor: CGFloat,
        onBarcode: @escaping (String) -> Void,
        onRegister: @escaping () -> Void,
        onCancel: @escaping () -> Void,
        onError: @escaping (String) -> Void
    ) {
        self.formats = formats
        self.zoomFactor = zoomFactor
        self.onBarcode = onBarcode
        self.onRegister = onRegister
        self.onCancel = onCancel
        self.onError = onError
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        configurePreview()
        addControls()
        configureCaptureSession()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        stopSession()
    }

    private func configurePreview() {
        let layer = AVCaptureVideoPreviewLayer(session: captureSession)
        layer.videoGravity = .resizeAspectFill
        layer.frame = view.bounds
        view.layer.insertSublayer(layer, at: 0)
        previewLayer = layer
    }

    private func addControls() {
        let closeButton = UIButton(type: .system)
        closeButton.translatesAutoresizingMaskIntoConstraints = false
        closeButton.backgroundColor = UIColor.black.withAlphaComponent(0.55)
        closeButton.tintColor = .white
        closeButton.layer.cornerRadius = 26
        closeButton.setImage(UIImage(systemName: "xmark"), for: .normal)
        closeButton.addTarget(self, action: #selector(cancelScan), for: .touchUpInside)

        let registerButton = UIButton(type: .system)
        registerButton.translatesAutoresizingMaskIntoConstraints = false
        registerButton.backgroundColor = UIColor.systemTeal.withAlphaComponent(0.92)
        registerButton.tintColor = .white
        registerButton.layer.cornerRadius = 26
        registerButton.titleLabel?.font = .systemFont(ofSize: 17, weight: .bold)
        registerButton.setTitle("상품등록", for: .normal)
        registerButton.addTarget(self, action: #selector(registerProduct), for: .touchUpInside)

        let buttonStack = UIStackView(arrangedSubviews: [closeButton, registerButton])
        buttonStack.translatesAutoresizingMaskIntoConstraints = false
        buttonStack.axis = .horizontal
        buttonStack.alignment = .center
        buttonStack.distribution = .fill
        buttonStack.spacing = 12
        view.addSubview(buttonStack)

        NSLayoutConstraint.activate([
            buttonStack.centerXAnchor.constraint(equalTo: view.safeAreaLayoutGuide.centerXAnchor),
            buttonStack.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -18),
            closeButton.widthAnchor.constraint(equalToConstant: 52),
            closeButton.heightAnchor.constraint(equalToConstant: 52),
            registerButton.widthAnchor.constraint(equalToConstant: 132),
            registerButton.heightAnchor.constraint(equalToConstant: 52)
        ])
    }

    private func configureCaptureSession() {
        sessionQueue.async {
            self.captureSession.beginConfiguration()
            self.isConfiguringSession = true
            self.captureSession.sessionPreset = .hd1280x720

            guard let device = self.makeCaptureDevice() else {
                self.fail("camera unavailable")
                return
            }

            do {
                let input = try AVCaptureDeviceInput(device: device)
                guard self.captureSession.canAddInput(input) else {
                    self.fail("cannot add camera input")
                    return
                }
                self.captureSession.addInput(input)
                self.configureDevice(device)

                let output = AVCaptureMetadataOutput()
                guard self.captureSession.canAddOutput(output) else {
                    self.fail("cannot add metadata output")
                    return
                }
                self.captureSession.addOutput(output)

                let availableTypes = Set(output.availableMetadataObjectTypes)
                let targetTypes = self.formats.filter { availableTypes.contains($0) }
                output.metadataObjectTypes = targetTypes.isEmpty ? Array(availableTypes) : targetTypes
                output.setMetadataObjectsDelegate(self, queue: DispatchQueue.main)

                self.captureSession.commitConfiguration()
                self.isConfiguringSession = false
                self.captureSession.startRunning()
            } catch {
                self.fail(error.localizedDescription)
            }
        }
    }

    private func makeCaptureDevice() -> AVCaptureDevice? {
        let discoverySession = AVCaptureDevice.DiscoverySession(
            deviceTypes: [
                .builtInTripleCamera,
                .builtInDualWideCamera,
                .builtInDualCamera,
                .builtInWideAngleCamera
            ],
            mediaType: .video,
            position: .back
        )

        if let virtualDevice = discoverySession.devices.first(where: { !$0.virtualDeviceSwitchOverVideoZoomFactors.isEmpty }) {
            return virtualDevice
        }

        if let discoveredDevice = discoverySession.devices.first {
            return discoveredDevice
        }

        if let wide = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) {
            return wide
        }
        return AVCaptureDevice.default(for: .video)
    }

    private func configureDevice(_ device: AVCaptureDevice) {
        do {
            try device.lockForConfiguration()
            defer {
                device.unlockForConfiguration()
            }

            if device.isFocusModeSupported(.continuousAutoFocus) {
                device.focusMode = .continuousAutoFocus
            }
            if device.isAutoFocusRangeRestrictionSupported {
                device.autoFocusRangeRestriction = .near
            }
            if device.isExposureModeSupported(.continuousAutoExposure) {
                device.exposureMode = .continuousAutoExposure
            }

            let minZoom = device.minAvailableVideoZoomFactor
            let maxZoom = min(device.maxAvailableVideoZoomFactor, 3.0)
            let preferredZoom = preferredInitialZoom(for: device)
            device.videoZoomFactor = min(max(preferredZoom, minZoom), maxZoom)
        } catch {
            return
        }
    }

    private func preferredInitialZoom(for device: AVCaptureDevice) -> CGFloat {
        let switchOverFactors = device.virtualDeviceSwitchOverVideoZoomFactors
            .map { CGFloat(truncating: $0) }
            .filter { $0 > 1.0 }
            .sorted()

        if let firstOpticalSwitchOver = switchOverFactors.first {
            return min(max(zoomFactor, firstOpticalSwitchOver), firstOpticalSwitchOver + 0.05)
        }

        return zoomFactor
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard !hasCompleted else { return }
        guard let metadataObject = metadataObjects.compactMap({ $0 as? AVMetadataMachineReadableCodeObject }).first else { return }
        guard let barcode = metadataObject.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines), !barcode.isEmpty else { return }

        hasCompleted = true
        AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
        stopSession()
        dismiss(animated: false) {
            self.onBarcode(barcode)
        }
    }

    @objc private func cancelScan() {
        guard !hasCompleted else { return }
        hasCompleted = true
        stopSession()
        dismiss(animated: false) {
            self.onCancel()
        }
    }

    @objc private func registerProduct() {
        guard !hasCompleted else { return }
        hasCompleted = true
        stopSession()
        dismiss(animated: false) {
            self.onRegister()
        }
    }

    private func stopSession() {
        sessionQueue.async {
            if self.captureSession.isRunning {
                self.captureSession.stopRunning()
            }
        }
    }

    private func fail(_ message: String) {
        DispatchQueue.main.async {
            guard !self.hasCompleted else { return }
            self.hasCompleted = true
            self.sessionQueue.async {
                if self.isConfiguringSession {
                    self.captureSession.commitConfiguration()
                    self.isConfiguringSession = false
                }
            }
            self.dismiss(animated: false) {
                self.onError(message)
            }
        }
    }
}
