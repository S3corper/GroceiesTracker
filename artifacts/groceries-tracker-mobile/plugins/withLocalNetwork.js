const { withAndroidManifest, withInfoPlist } = require('expo/config-plugins');

module.exports = function withLocalNetwork(config) {
  config = withAndroidManifest(config, (mod) => {
    const application = mod.modResults.manifest.application?.[0];
    if (application) application.$['android:usesCleartextTraffic'] = 'true';
    return mod;
  });
  return withInfoPlist(config, (mod) => {
    mod.modResults.NSAppTransportSecurity = {
      ...(mod.modResults.NSAppTransportSecurity ?? {}),
      NSAllowsLocalNetworking: true,
    };
    return mod;
  });
};
