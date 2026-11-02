# Mikhmon Native Frontend

All MikroTik calls originate from the Android app through `react-native-tcp-socket` and RouterOS TCP API. Runtime router requests do not use the Express backend.

Use the router's LAN IP over a reachable network (default API port `8728`) or connect through a VPN. A public host/port can be entered if externally reachable, but firewall access should be restricted; do not expose RouterOS API to the whole internet. This client uses plain RouterOS API only, not API-SSL, HTTP/REST, or Winbox.

Expo Go is not supported for direct TCP. Build a new native APK after changing native dependencies or Android permissions:

```powershell
npx expo export --platform android
npx eas-cli build --platform android --profile preview
```

Run the protocol mock tests with `npm test`.
