import AuthenticationServices
import Capacitor
import UIKit

@objc(AppViewController)
class AppViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(FastBarcodeScannerPlugin())
        bridge?.registerPluginInstance(NativeAppConfigurationPlugin())
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
