import Foundation
import Capacitor

// iCloud key-value backup of progress (plan 1.1 F). Called from js/cloud.js as Capacitor.Plugins.CloudStore.
// A thin wrapper around NSUbiquitousKeyValueStore: the player's own iCloud, nothing reaches us. All the merging
// happens in JS; this only reads and writes strings, and tells JS when another device changed the store.
// Needs the iCloud capability with "Key-value storage" (App.entitlements: com.apple.developer.ubiquity-kvstore-identifier).
// Not signed in to iCloud (or iCloud Drive off for the app): the store still works, it just stays on this phone.
@objc(CloudStorePlugin)
public class CloudStorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CloudStorePlugin"
    public let jsName = "CloudStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise)
    ]

    private let store = NSUbiquitousKeyValueStore.default

    override public func load() {
        NotificationCenter.default.addObserver(self, selector: #selector(changedExternally(_:)),
            name: NSUbiquitousKeyValueStore.didChangeExternallyNotification, object: store)
        store.synchronize()   // pull down whatever iCloud already has for us
    }

    // {key} -> {value: string or null}. null means nothing stored yet (a first install on a new account).
    @objc func get(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else { call.reject("key needed"); return }
        if let v = store.string(forKey: key) { call.resolve(["value": v]) } else { call.resolve(["value": NSNull()]) }
    }

    // {key, value}: stores one string. iCloud uploads it on its own schedule.
    @objc func set(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), let value = call.getString("value") else { call.reject("key and value needed"); return }
        store.set(value, forKey: key)
        store.synchronize()
        call.resolve(["saved": true])
    }

    // Another device wrote, or the iCloud account changed: JS re-reads and merges ("change" {reason, keys}).
    @objc private func changedExternally(_ note: Notification) {
        let reason = (note.userInfo?[NSUbiquitousKeyValueStoreChangeReasonKey] as? Int) ?? -1
        let keys = (note.userInfo?[NSUbiquitousKeyValueStoreChangedKeysKey] as? [String]) ?? []
        notifyListeners("change", data: ["reason": reason, "keys": keys])
    }
}
