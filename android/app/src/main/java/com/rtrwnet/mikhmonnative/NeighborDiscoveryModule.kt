package com.rtrwnet.mikhmonnative

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.SocketTimeoutException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.charset.Charset
import java.util.concurrent.Executors

class NeighborDiscoveryModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val executor = Executors.newSingleThreadExecutor()

  override fun getName() = "NeighborDiscovery"

  @ReactMethod
  fun scan(durationMs: Double, promise: Promise) {
    executor.execute {
      var socket: DatagramSocket? = null
      try {
        val devices = linkedMapOf<String, MutableMap<String, String>>()
        socket = DatagramSocket(null)
        socket.reuseAddress = true
        socket.broadcast = true
        socket.bind(InetSocketAddress(5678))
        socket.soTimeout = 250

        // MNDP's empty discovery request prompts nearby RouterOS devices to announce themselves.
        val request = DatagramPacket(byteArrayOf(0, 0, 0, 0), 4, InetAddress.getByName("255.255.255.255"), 5678)
        socket.send(request)

        val deadline = System.currentTimeMillis() + durationMs.toLong().coerceIn(1000L, 15000L)
        val buffer = ByteArray(2048)
        while (System.currentTimeMillis() < deadline) {
          val packet = DatagramPacket(buffer, buffer.size)
          try {
            socket.receive(packet)
          } catch (_: SocketTimeoutException) {
            continue
          }
          val fields = parseMndp(packet.data, packet.length) ?: continue
          val mac = fields["macAddress"] ?: continue
          val entry = devices.getOrPut(mac) { mutableMapOf("macAddress" to mac) }
          fields.forEach { (key, value) -> if (value.isNotBlank()) entry[key] = value }
          if (entry["address"].isNullOrBlank()) entry["address"] = packet.address.hostAddress ?: ""
        }

        val result = Arguments.createArray()
        devices.values.forEach { entry ->
          val map = Arguments.createMap()
          entry.forEach { (key, value) -> map.putString(key, value) }
          result.pushMap(map)
        }
        promise.resolve(result)
      } catch (error: Exception) {
        promise.reject("NEIGHBOR_DISCOVERY_ERROR", error.message ?: "Gagal mencari Neighbor di jaringan lokal.", error)
      } finally {
        socket?.close()
      }
    }
  }

  private fun parseMndp(data: ByteArray, length: Int): MutableMap<String, String>? {
    if (length < 8) return null
    val result = mutableMapOf<String, String>()
    var offset = 4 // MNDP header: unknown(2), sequence number(2)
    while (offset + 4 <= length) {
      val type = ((data[offset].toInt() and 0xff) shl 8) or (data[offset + 1].toInt() and 0xff)
      val size = ((data[offset + 2].toInt() and 0xff) shl 8) or (data[offset + 3].toInt() and 0xff)
      offset += 4
      if (size < 0 || offset + size > length) return null
      val value = data.copyOfRange(offset, offset + size)
      offset += size
      when (type) {
        1 -> if (size == 6) result["macAddress"] = value.joinToString(":") { "%02X".format(it.toInt() and 0xff) }
        5 -> result["identity"] = value.toString(Charset.forName("UTF-8")).trimEnd('\u0000')
        7 -> result["version"] = value.toString(Charset.forName("UTF-8")).trimEnd('\u0000')
        8 -> result["platform"] = value.toString(Charset.forName("UTF-8")).trimEnd('\u0000')
        10 -> if (size == 4) {
          val seconds = ByteBuffer.wrap(value).order(ByteOrder.LITTLE_ENDIAN).int.toLong() and 0xffffffffL
          result["uptime"] = "${seconds / 86400}d ${String.format("%02d:%02d:%02d", (seconds % 86400) / 3600, (seconds % 3600) / 60, seconds % 60)}"
        }
        12 -> result["board"] = value.toString(Charset.forName("UTF-8")).trimEnd('\u0000')
        16 -> result["interface"] = value.toString(Charset.forName("UTF-8")).trimEnd('\u0000')
        17 -> if (size == 4) result["address"] = value.joinToString(".") { (it.toInt() and 0xff).toString() }
      }
    }
    return result.takeIf { it.isNotEmpty() }
  }
}

class NeighborDiscoveryPackage : com.facebook.react.ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext) = listOf(NeighborDiscoveryModule(context))
  override fun createViewManagers(context: ReactApplicationContext) = emptyList<com.facebook.react.uimanager.ViewManager<*, *>>()
}
