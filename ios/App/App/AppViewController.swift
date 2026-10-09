import AuthenticationServices
import Capacitor
import UIKit

@objc(AppViewController)
class AppViewController: CAPBridgeViewController {
    override func instanceDescriptor() -> InstanceDescriptor {
        let descriptor = super.instanceDescriptor()
        #if DEBUG
        if Bundle.main.bundleIdentifier == "com.jinkim.stockly.dev",
           let url = Bundle.main.object(forInfoDictionaryKey: "StocklyDevServerURL") as? String,
           let parsed = URL(string: url), parsed.scheme == "https", parsed.host?.hasSuffix(".ts.net") == true {
            descriptor.serverURL = url
        }
        #endif
        return descriptor
    }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(FastBarcodeScannerPlugin())
        bridge?.registerPluginInstance(NativeAppConfigurationPlugin())
        bridge?.registerPluginInstance(NativeNfcConfirmationPlugin())
        bridge?.registerPluginInstance(NativeAppleSignInPlugin())
    }
}

@objc(NativeAppConfigurationPlugin)
final class NativeAppConfigurationPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "NativeAppConfigurationPlugin"
    let jsName = "NativeAppConfiguration"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getNativeAuthCallbackUrl", returnType: CAPPluginReturnPromise)
    ]

    @objc func getNativeAuthCallbackUrl(_ call: CAPPluginCall) {
        let bundleIdentifier = Bundle.main.bundleIdentifier ?? "com.jinkim.stockly"
        call.resolve(["url": "\(bundleIdentifier)://auth/callback"])
    }
}

@objc(NativeNfcConfirmationPlugin)
final class NativeNfcConfirmationPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "NativeNfcConfirmationPlugin"
    let jsName = "NativeNfcConfirmation"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "confirmOverwrite", returnType: CAPPluginReturnPromise)
    ]

    @objc func confirmOverwrite(_ call: CAPPluginCall) {
        guard let message = call.getString("message") else {
            call.reject("확인할 NFC 태그 정보가 없습니다.")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self, var presenter = self.bridge?.viewController else {
                call.reject("NFC 확인창을 표시할 수 없습니다.")
                return
            }
            while let presented = presenter.presentedViewController, !presented.isBeingDismissed {
                presenter = presented
            }

            let alert = UIAlertController(title: "기존 NFC 정보", message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "취소", style: .cancel) { _ in
                call.resolve(["confirmed": false])
            })
            alert.addAction(UIAlertAction(title: "삭제하고 계속", style: .destructive) { _ in
                call.resolve(["confirmed": true])
            })
            presenter.present(alert, animated: true)
        }
    }
}

@objc(NativeAppleSignInPlugin)
final class NativeAppleSignInPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "NativeAppleSignInPlugin"
    let jsName = "NativeAppleSignIn"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authorize", returnType: CAPPluginReturnPromise)
    ]

    private var activeCall: CAPPluginCall?
    private var authorizationController: ASAuthorizationController?

    @objc func authorize(_ call: CAPPluginCall) {
        guard let nonce = call.getString("nonce"), !nonce.isEmpty else {
            call.reject("A nonce is required for Apple sign-in.")
            return
        }

        DispatchQueue.main.async { [weak self] in
            self?.beginAuthorization(call, nonce: nonce)
        }
    }

    private func beginAuthorization(_ call: CAPPluginCall, nonce: String) {
        guard activeCall == nil else {
            call.reject("An Apple sign-in request is already in progress.")
            return
        }

        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName, .email]
        request.nonce = nonce

        activeCall = call
        bridge?.saveCall(call)

        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        authorizationController = controller
        controller.performRequests()
    }

    private func complete(_ result: [String: Any]) {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { [weak self] in self?.complete(result) }
            return
        }
        guard let call = activeCall else { return }
        activeCall = nil
        authorizationController = nil
        call.resolve(result)
        bridge?.releaseCall(call)
    }

    private func fail(_ message: String) {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { [weak self] in self?.fail(message) }
            return
        }
        guard let call = activeCall else { return }
        activeCall = nil
        authorizationController = nil
        call.reject(message)
        bridge?.releaseCall(call)
    }
}

extension NativeAppleSignInPlugin: ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let identityTokenData = credential.identityToken,
              let identityToken = String(data: identityTokenData, encoding: .utf8),
              !identityToken.isEmpty else {
            fail("Apple 인증 토큰을 확인하지 못했습니다.")
            return
        }

        var result: [String: Any] = ["identityToken": identityToken]
        if let authorizationCode = credential.authorizationCode.flatMap({ String(data: $0, encoding: .utf8) }) {
            result["authorizationCode"] = authorizationCode
        }
        if let email = credential.email { result["email"] = email }
        if let givenName = credential.fullName?.givenName { result["givenName"] = givenName }
        if let familyName = credential.fullName?.familyName { result["familyName"] = familyName }
        complete(result)
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        if let authorizationError = error as? ASAuthorizationError, authorizationError.code == .canceled {
            complete(["cancelled": true])
            return
        }
        fail("Apple 로그인을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.")
    }
}
