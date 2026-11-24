// swift-tools-version: 6.0

import PackageDescription

let package = Package(
  name: "Melo",
  platforms: [.macOS(.v14)],
  targets: [
    .executableTarget(name: "Melo", resources: [.copy("Resources")]),
    .testTarget(name: "MeloTests", dependencies: ["Melo"]),
  ]
)
