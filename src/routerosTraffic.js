export function parseTrafficCounters(response, interfaceName) {
  if (!Array.isArray(response)) throw new Error("Format respons interface RouterOS tidak valid.");
  const item = response.find((entry) => entry.name === interfaceName);
  if (!item) throw new Error(`Interface ${interfaceName} tidak ditemukan pada router.`);
  const rxBytes = Number(item["rx-byte"]);
  const txBytes = Number(item["tx-byte"]);
  if (!Number.isFinite(rxBytes) || !Number.isFinite(txBytes)) {
    throw new Error(`Counter trafik RX/TX tidak tersedia untuk interface ${interfaceName}.`);
  }
  return { interfaceName, rxBytes, txBytes, sampledAt: Date.now() };
}

export function calculateTrafficRate(previous, current) {
  if (!previous || !current || current.sampledAt <= previous.sampledAt) return null;
  const elapsedSeconds = (current.sampledAt - previous.sampledAt) / 1000;
  return {
    rx: Math.max(0, current.rxBytes - previous.rxBytes) * 8 / elapsedSeconds,
    tx: Math.max(0, current.txBytes - previous.txBytes) * 8 / elapsedSeconds,
  };
}

export function formatTrafficRate(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  const bits = Number(value);
  if (bits >= 1_000_000) return `${(bits / 1_000_000).toFixed(1)} Mbps`;
  if (bits >= 1_000) return `${(bits / 1_000).toFixed(0)} Kbps`;
  return `${bits.toFixed(0)} bps`;
}

export function trafficInterfaceOptions(interfaces) {
  return (Array.isArray(interfaces) ? interfaces : [])
    .filter((item) => typeof item.name === "string" && item.name.length > 0)
    .map((item) => ({ value: item.name, label: item.name }));
}

export function trafficLineSegments(history, key, width, height, max) {
  if (!Array.isArray(history) || history.length < 2 || width <= 0 || height <= 0) return [];
  const points = history.map((point, index) => ({
    x: index / (history.length - 1) * width,
    y: height - 3 - Math.min(1, Math.max(0, (Number(point[key]) || 0) / max)) * (height - 8),
  }));
  return points.slice(1).map((point, index) => {
    const previous = points[index];
    const dx = point.x - previous.x;
    const dy = point.y - previous.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    return {
      left: (previous.x + point.x) / 2 - length / 2,
      top: (previous.y + point.y) / 2 - 1,
      width: length,
      angle: `${Math.atan2(dy, dx)}rad`,
    };
  });
}

export function startSerialPolling(poll, intervalMs = 1000) {
  let stopped = false;
  let timer = null;
  const run = async () => {
    try {
      await poll();
    } finally {
      if (!stopped) timer = setTimeout(run, intervalMs);
    }
  };
  run();
  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
  };
}
