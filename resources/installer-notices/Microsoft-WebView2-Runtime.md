# Microsoft Edge WebView2 Runtime

The Windows x64 setup includes Microsoft's unmodified Evergreen Standalone
Installer for Microsoft Edge WebView2. WebView2 supplies the desktop webview
used by News Terminal. This component comes from Microsoft Corporation and is
governed by Microsoft's WebView2 Runtime license terms, rather than the News
Terminal MIT license. Obtain the current terms from Microsoft's download page:

- [Microsoft WebView2 download page and license terms](https://developer.microsoft.com/en-us/microsoft-edge/webview2/#download-section)
- [Microsoft WebView2 distribution guidance](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)
- [Microsoft Privacy Statement](https://privacy.microsoft.com/en-us/privacystatement)

The setup checks for an existing runtime and installs the bundled prerequisite
when it is missing. The runtime setup does not require an internet download.
The portable ZIP contains no runtime installer and requires WebView2 to be
installed separately. Live feeds still need internet access.

Evergreen is a shared runtime and normally receives updates through Microsoft's
servicing mechanism. Runtime updates and Microsoft's privacy policies are
separate from News Terminal's optional AI-provider settings. No AI model, paid
provider account or paid subscription is supplied or required by this component.

Tauri CLI 2.11.5 selects the x64 Microsoft download for this build. Evergreen
download contents can change. The release inspection records the actual bundled
installer's SHA-256, byte size and validated Microsoft signing certificate in
`docs/evidence/installer-payload.json`. It also compares the extracted installer
with the generated NSIS input. This notice does not claim a fixed runtime
version or repeat historical hashes as evidence for a new build.
