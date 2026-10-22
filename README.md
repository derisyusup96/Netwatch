# Mikhmon Native Frontend

Expo React Native app that connects directly from the device to the MikroTik RouterOS API over TCP or API-SSL. The APK does not need the Express backend to access a router. Local addresses work when the phone and router share a reachable network; DDNS/public host and its forwarded API port work from outside.

The configured port must forward to a RouterOS API service (normally API `8728` or API-SSL `8729`). A Winbox service port such as `8291` is a different protocol and cannot serve API commands unless the public port is forwarded to API/API-SSL instead. Newer RouterOS login is supported; legacy challenge-response login is not yet supported.

`react-native-tcp-socket` includes native code, so Expo Go cannot run router connections. After adding/updating this package, create and install a new APK: `npx eas-cli build --platform android --profile preview`. An existing APK or Expo Go app will report `NativeModules.TcpSockets is undefined`; restarting Metro does not fix that because the native code must be compiled into the app binary. `npx expo start` alone is not sufficient for testing TCP connections.
