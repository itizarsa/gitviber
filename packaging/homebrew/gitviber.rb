# Template for Casks/gitviber.rb in itizarsa/homebrew-tap. The release workflow fills in
# the version and the .dmg's checksum, drops these comment lines and prints the result.
cask "gitviber" do
  version "__VERSION__"
  sha256 "__SHA256__"

  url "https://github.com/itizarsa/gitviber/releases/download/v#{version}/GitViber_#{version}_universal.dmg"
  name "GitViber"
  desc "Git client for reviewing and committing what coding agents write"
  homepage "https://github.com/itizarsa/gitviber"

  livecheck do
    url :url
    strategy :github_latest
  end

  # This fork has no in-app updater: `brew upgrade` brings new versions.
  auto_updates false
  depends_on macos: :ventura

  app "GitViber.app"
  # The `gitviber` command (src-tauri/resources/gitviber), linked into Homebrew's bin.
  binary "#{appdir}/GitViber.app/Contents/Resources/bin/gitviber"

  # A build without an Apple Developer ID isn't notarized: let Gatekeeper open it anyway.
  postflight do
    system_command "/usr/bin/xattr", args: ["-dr", "com.apple.quarantine", "#{appdir}/GitViber.app"]
  end

  zap trash: [
    "~/Library/Caches/app.gitviber.desktop",
    "~/Library/HTTPStorages/app.gitviber.desktop",
    "~/Library/Logs/app.gitviber.desktop",
    "~/Library/Preferences/app.gitviber.desktop.plist",
    "~/Library/Saved Application State/app.gitviber.desktop.savedState",
    "~/Library/WebKit/app.gitviber.desktop",
  ]
end
