import UIKit
import GameKit
import Capacitor

// The app's own view controller: Capacitor's bridge, plus the plugins that live in this app instead of in npm.
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(GameCenterPlugin())
        bridge?.registerPluginInstance(AppAudioPlugin())
    }
}

// Game Center for Crumble (plan 5.3). Called from js/native.js as Capacitor.Plugins.GameCenter.
// Quiet on purpose: sign-in never pops a sheet at launch. A player already signed in to Game Center in Settings
// is picked up silently; anyone else plays exactly as before and nothing is sent.
@objc(GameCenterPlugin)
public class GameCenterPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GameCenterPlugin"
    public let jsName = "GameCenter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "submitScore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unlock", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "show", returnType: CAPPluginReturnPromise)
    ]

    private var started = false

    // Resolves {signedIn}. Safe to call more than once; the handler is installed once and Game Center
    // calls it again by itself whenever the player signs in or out in Settings: each later call is sent
    // to JS as a "change" event {signedIn}.
    @objc func signIn(_ call: CAPPluginCall) {
        if started { call.resolve(["signedIn": GKLocalPlayer.local.isAuthenticated]); return }
        started = true
        var answered = false
        GKLocalPlayer.local.authenticateHandler = { [weak self] _, _ in
            // A sign-in view controller, if offered, is ignored: no sheet at launch.
            let on = GKLocalPlayer.local.isAuthenticated
            if !answered { answered = true; call.resolve(["signedIn": on]) }
            else { self?.notifyListeners("change", data: ["signedIn": on]) }
        }
    }

    // {signedIn} right now, for a check when the app comes back to the front.
    @objc func status(_ call: CAPPluginCall) {
        call.resolve(["signedIn": GKLocalPlayer.local.isAuthenticated])
    }

    // {id, score}: one score to one leaderboard. Game Center keeps the best per period itself.
    @objc func submitScore(_ call: CAPPluginCall) {
        guard GKLocalPlayer.local.isAuthenticated else { call.resolve(["sent": false]); return }
        guard let id = call.getString("id"), let score = call.getInt("score") else { call.reject("id and score needed"); return }
        GKLeaderboard.submitScore(score, context: 0, player: GKLocalPlayer.local, leaderboardIDs: [id]) { error in
            if let error = error { call.reject(error.localizedDescription) } else { call.resolve(["sent": true]) }
        }
    }

    // {ids: [...]}: achievements reached, each reported at 100%. Reporting one already earned does nothing.
    @objc func unlock(_ call: CAPPluginCall) {
        guard GKLocalPlayer.local.isAuthenticated else { call.resolve(["sent": false]); return }
        let ids = (call.getArray("ids") as? [String]) ?? []
        if ids.isEmpty { call.resolve(["sent": false]); return }
        let list = ids.map { id -> GKAchievement in
            let a = GKAchievement(identifier: id); a.percentComplete = 100; a.showsCompletionBanner = false; return a
        }
        GKAchievement.report(list) { error in
            if let error = error { call.reject(error.localizedDescription) } else { call.resolve(["sent": true]) }
        }
    }

    // Opens Game Center's own dashboard (leaderboards and achievements). Not wired to any button yet.
    @objc func show(_ call: CAPPluginCall) {
        guard GKLocalPlayer.local.isAuthenticated else { call.resolve(["shown": false]); return }
        DispatchQueue.main.async {
            GKAccessPoint.shared.trigger(state: .dashboard) {}
            call.resolve(["shown": true])
        }
    }
}
