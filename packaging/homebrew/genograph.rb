# Homebrew formula for Genograph.
#
# This is a TEMPLATE for a Homebrew tap (e.g. github.com/genograph/homebrew-tap).
# To publish:
#   1. `npm publish` the package (or build a release tarball).
#   2. Set `url` to the published tarball and fill in its `sha256`
#      (`brew fetch --build-from-source ./genograph.rb` prints the checksum,
#       or `shasum -a 256 <tarball>`).
#   3. Commit this file to your tap repo under `Formula/`.
# Users then run:  brew install genograph/tap/genograph
class Genograph < Formula
  desc "Offline, private family-tree browser & editor that runs in your browser"
  homepage "https://github.com/genograph/genograph.github.io"
  url "https://registry.npmjs.org/genograph/-/genograph-1.0.0.tgz"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match "Genograph", shell_output("#{bin}/genograph --help")
    assert_match version.to_s, shell_output("#{bin}/genograph --version")
  end
end
