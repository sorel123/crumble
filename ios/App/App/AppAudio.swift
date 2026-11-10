import AVFoundation
import UIKit
import Capacitor

// The app's audio session, set up the way games do it (plan 5.x audio fixes).
// .ambient: mixes with other apps' audio (her music or a podcast keeps playing), follows the silent switch,
// and never shows Now Playing controls in Control Center. The Safari build's silent-loop trick is skipped in the
// app (js/audio.js), because inside the app iOS treated that loop as media and fought other apps for the speaker.
// Silent switch (Jay, 2026-11-10): with headphones or AirPods in, the game plays even on silent (.playback, still mixing
// with other apps); on the phone's own speaker it keeps following the switch (.ambient). The category is re-chosen
// whenever the route changes, and JS hears a "route" event so WebKit's own audioSession type matches.
// When an interruption ends (a call, Siri, another app's video) or the app comes back to the front, the session
// is reactivated and JS gets a "resume" event so it can bring its AudioContext back (audioRevive in js/audio.js).
@objc(AppAudioPlugin)
public class AppAudioPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppAudioPlugin"
    public let jsName = "AppAudio"
    public let pluginMethods: [CAPPluginMethod] = []

    override public func load() {
        AppAudioPlugin.activate()
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(interrupted(_:)), name: AVAudioSession.interruptionNotification, object: nil)
        nc.addObserver(self, selector: #selector(becameActive), name: UIApplication.didBecomeActiveNotification, object: nil)
        nc.addObserver(self, selector: #selector(becameActive), name: AVAudioSession.mediaServicesWereResetNotification, object: nil)
        nc.addObserver(self, selector: #selector(routeChanged), name: AVAudioSession.routeChangeNotification, object: nil)
    }

    static let headphonePorts: Set<AVAudioSession.Port> = [.headphones, .bluetoothA2DP, .bluetoothLE, .bluetoothHFP, .usbAudio, .carAudio, .airPlay]
    static func onHeadphones() -> Bool {
        AVAudioSession.sharedInstance().currentRoute.outputs.contains { headphonePorts.contains($0.portType) }
    }

    static func activate() {
        let s = AVAudioSession.sharedInstance()
        if onHeadphones() {
            try? s.setCategory(.playback, mode: .default, options: [.mixWithOthers])   // plays on silent; her music keeps going
        } else {
            try? s.setCategory(.ambient, mode: .default, options: [])                 // the speaker follows the silent switch
        }
        try? s.setActive(true)
    }

    @objc func routeChanged(_ n: Notification) {
        let want: AVAudioSession.Category = AppAudioPlugin.onHeadphones() ? .playback : .ambient
        if AVAudioSession.sharedInstance().category != want { resume() }
    }

    @objc func interrupted(_ n: Notification) {
        guard let raw = n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              AVAudioSession.InterruptionType(rawValue: raw) == .ended else { return }
        resume()
    }

    @objc func becameActive() { resume() }

    private func resume() {
        AppAudioPlugin.activate()
        let phones = AppAudioPlugin.onHeadphones()
        DispatchQueue.main.async {
            self.notifyListeners("route", data: ["headphones": phones])
            self.notifyListeners("resume", data: [:])
        }
    }
}
