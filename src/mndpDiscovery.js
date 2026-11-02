import {NativeModules, Platform} from 'react-native';

export async function scanMikrotikNeighbors(durationMs = 6000) {
  if (Platform.OS !== 'android' || !NativeModules.NeighborDiscovery?.scan) {
    throw new Error('Pencarian Neighbor lokal tersedia di aplikasi Android.');
  }
  return NativeModules.NeighborDiscovery.scan(durationMs);
}
