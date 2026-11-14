import SwiftUI

@main
struct LookaboutApp: App {
    @StateObject private var store = AppStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .preferredColorScheme(store.colorScheme)
        }
    }
}

/// A device runs as either a camera or a viewer.
struct RootView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        switch store.settings.role {
        case .none:
            StartView()
        case .camera:
            NavigationStack { CameraFlowView() }
        case .viewer:
            ViewerView()
        }
    }
}
