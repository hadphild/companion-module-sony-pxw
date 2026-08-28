// ssh2 optionally loads two native accelerators — its own sshcrypto.node binding
// and cpu-features. Both requires are wrapped in try/catch in ssh2 and it falls
// back to pure-JS crypto when they are absent, so webpack should leave them
// alone rather than fail trying to parse the .node binaries.
module.exports = {
  externals: [
    function ({ request }, callback) {
      if (/cpu-features/.test(request) || /sshcrypto\.node$/.test(request)) {
        return callback(null, 'commonjs ' + request)
      }
      callback()
    },
  ],
}
