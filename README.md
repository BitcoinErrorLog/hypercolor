# Hypercolor

## Android release signing

Release builds must use a release keystore kept outside this repository. For
local builds, copy `android/keystore.properties.example` to
`android/keystore.properties` and set the real keystore path and credentials.
CI can provide the same four values through the `HYPERCOLOR_RELEASE_*`
environment variables. The release build fails closed when neither source is
configured and never uses `android/app/debug.keystore`.

An APK signed with the old debug key must be uninstalled before installing a
properly signed release APK. Restore the identity through Pubky Ring after
installing the properly signed build.
