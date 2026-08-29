package expo.modules.meshtransport

import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.os.Build
import android.os.ParcelUuid
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import java.security.MessageDigest
import java.util.*
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

// ─── Constants ────────────────────────────────────────────────────────────────

private val SERVICE_UUID: UUID = UUID.fromString("6BA7B810-9DAD-11D1-80B4-00C04FD430C8")
private val WRITE_CHAR_UUID: UUID = UUID.fromString("6BA7B811-9DAD-11D1-80B4-00C04FD430C8")
private val NOTIFY_CHAR_UUID: UUID = UUID.fromString("6BA7B812-9DAD-11D1-80B4-00C04FD430C8")
private val CLIENT_CONFIG_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

// Fragment header: 4-byte id hash, 2-byte fragment index (LE), 2-byte total (LE), 1 reserved
private const val HEADER_SIZE = 9

/**
 * MeshTransportModule for Android.
 *
 * Manages BluetoothLeAdvertiser (peripheral mode), BluetoothLeScanner (central mode),
 * BluetoothGattServer (GATT server for incoming writes), and BluetoothGatt clients
 * for connecting to discovered peers.
 *
 * Required permissions (declared in AndroidManifest.xml via Expo config plugin):
 *   - android.permission.BLUETOOTH_ADVERTISE (API 31+)
 *   - android.permission.BLUETOOTH_CONNECT  (API 31+)
 *   - android.permission.BLUETOOTH_SCAN     (API 31+)
 *   - android.permission.ACCESS_FINE_LOCATION (API < 31)
 */
class MeshTransportModule : Module() {

  private val executor = Executors.newCachedThreadPool()

  private var bluetoothManager: BluetoothManager? = null
  private var adapter: BluetoothAdapter? = null
  private var advertiser: BluetoothLeAdvertiser? = null
  private var scanner: BluetoothLeScanner? = null
  private var gattServer: BluetoothGattServer? = null

  // Connected GATT clients: deviceAddress → BluetoothGatt
  private val gattClients = ConcurrentHashMap<String, BluetoothGatt>()
  // Write characteristics per client
  private val writeChars = ConcurrentHashMap<String, BluetoothGattCharacteristic>()

  // Reassembly buffers: deviceAddress → messageIdHex → fragmentIndex → bytes
  private val reassemblyBuffers = ConcurrentHashMap<String, ConcurrentHashMap<String, ConcurrentHashMap<Int, ByteArray>>>()
  private val expectedFragCounts = ConcurrentHashMap<String, ConcurrentHashMap<String, Int>>()

  // pubky hash → device address lookup after discovery
  private val hashToAddress = ConcurrentHashMap<String, String>()

  private var localPubkyHash: String = ""
  private var isAdvertising = false

  // ── Module definition ──────────────────────────────────────────────────────

  override fun definition() = ModuleDefinition {
    Name("MeshTransport")

    Events("onPeerDiscovered", "onPeerLost", "onMessageReceived")

    AsyncFunction("startAdvertising") { pubkyHashHex: String, promise: Promise ->
      executor.submit {
        runCatching {
          localPubkyHash = pubkyHashHex
          initBluetooth()
          startGattServer()
          startScanning(withAdvertising = true)
        }
          .onSuccess { promise.resolve(null) }
          .onFailure { promise.reject("BLE_ERROR", it.message ?: "BLE init failed", it) }
      }
    }

    AsyncFunction("startScanning") { promise: Promise ->
      executor.submit {
        runCatching {
          initBluetooth()
          startScanning(withAdvertising = false)
        }
          .onSuccess { promise.resolve(null) }
          .onFailure { promise.reject("BLE_ERROR", it.message ?: "BLE scan failed", it) }
      }
    }

    AsyncFunction("stopAll") { promise: Promise ->
      executor.submit {
        runCatching {
          if (isAdvertising) {
            advertiser?.stopAdvertising(advertiseCallback)
            isAdvertising = false
          }
          scanner?.stopScan(scanCallback)
          gattServer?.close()
          gattClients.values.forEach { it.close() }
          gattClients.clear()
        }
          .onSuccess { promise.resolve(null) }
          .onFailure { promise.reject("BLE_ERROR", it.message ?: "BLE stop failed", it) }
      }
    }

    AsyncFunction("sendToPeer") { pubkyHashHex: String, payloadBase64: String, promise: Promise ->
      executor.submit {
        runCatching {
          val address = hashToAddress[pubkyHashHex]
          val gatt = address?.let { gattClients[it] }
          val writeChar = address?.let { writeChars[it] }
          if (gatt == null || writeChar == null) {
            false
          } else {
            val payload = android.util.Base64.decode(payloadBase64, android.util.Base64.DEFAULT)
            sendFragmented(gatt, writeChar, payload)
            true
          }
        }
          .onSuccess { promise.resolve(it) }
          .onFailure { promise.reject("BLE_ERROR", it.message ?: "Send failed", it) }
      }
    }

    AsyncFunction("getConnectedPeers") { promise: Promise ->
      promise.resolve(hashToAddress.keys.toList())
    }
  }

  // ── Bluetooth init ─────────────────────────────────────────────────────────

  private fun initBluetooth() {
    val ctx = appContext.reactContext ?: throw IllegalStateException("No context")
    bluetoothManager = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    adapter = bluetoothManager!!.adapter
      ?: throw IllegalStateException("Bluetooth not available on this device")
    advertiser = adapter!!.bluetoothLeAdvertiser
    scanner = adapter!!.bluetoothLeScanner
  }

  // ── GATT Server (incoming writes) ─────────────────────────────────────────

  private fun startGattServer() {
    val ctx = appContext.reactContext ?: return
    gattServer = bluetoothManager!!.openGattServer(ctx, gattServerCallback)

    val writeChar = BluetoothGattCharacteristic(
      WRITE_CHAR_UUID,
      BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
      BluetoothGattCharacteristic.PERMISSION_WRITE,
    )
    val notifyChar = BluetoothGattCharacteristic(
      NOTIFY_CHAR_UUID,
      BluetoothGattCharacteristic.PROPERTY_NOTIFY,
      BluetoothGattCharacteristic.PERMISSION_READ,
    )
    val cccd = BluetoothGattDescriptor(
      CLIENT_CONFIG_UUID,
      BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE,
    )
    notifyChar.addDescriptor(cccd)

    val service = BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)
    service.addCharacteristic(writeChar)
    service.addCharacteristic(notifyChar)
    gattServer!!.addService(service)
  }

  private val gattServerCallback = object : BluetoothGattServerCallback() {
    override fun onCharacteristicWriteRequest(
      device: BluetoothDevice,
      requestId: Int,
      characteristic: BluetoothGattCharacteristic,
      preparedWrite: Boolean,
      responseNeeded: Boolean,
      offset: Int,
      value: ByteArray?,
    ) {
      if (responseNeeded) {
        gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
      }
      value?.let { handleIncomingFragment(it, device.address, null) }
    }
  }

  // ── BLE Scanning ──────────────────────────────────────────────────────────

  private fun startScanning(withAdvertising: Boolean) {
    val filter = ScanFilter.Builder()
      .setServiceUuid(ParcelUuid(SERVICE_UUID))
      .build()
    val settings = ScanSettings.Builder()
      .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
      .build()
    scanner?.startScan(listOf(filter), settings, scanCallback)

    if (withAdvertising) startAdvertising()
  }

  private val scanCallback = object : ScanCallback() {
    override fun onScanResult(callbackType: Int, result: ScanResult) {
      val serviceData = result.scanRecord?.getServiceData(ParcelUuid(SERVICE_UUID))
      val pubkyHashHex = serviceData?.toHex() ?: return
      if (pubkyHashHex == localPubkyHash || pubkyHashHex.isEmpty()) return

      hashToAddress[pubkyHashHex] = result.device.address

      sendEvent("onPeerDiscovered", mapOf(
        "pubkyHash" to pubkyHashHex,
        "rssi" to result.rssi,
      ))

      val ctx = appContext.reactContext ?: return
      if (gattClients[result.device.address] == null) {
        result.device.connectGatt(ctx, false, gattClientCallback, BluetoothDevice.TRANSPORT_LE)
      }
    }

    override fun onScanFailed(errorCode: Int) {
      // Transient scan failures are expected; log but do not crash
    }
  }

  // ── BLE Advertising ───────────────────────────────────────────────────────

  private fun startAdvertising() {
    val hashBytes = localPubkyHash.hexToByteArray() ?: return
    val data = AdvertiseData.Builder()
      .addServiceUuid(ParcelUuid(SERVICE_UUID))
      .addServiceData(ParcelUuid(SERVICE_UUID), hashBytes)
      .setIncludeDeviceName(false)
      .build()
    val settings = AdvertiseSettings.Builder()
      .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
      .setConnectable(true)
      .build()
    advertiser?.startAdvertising(settings, data, advertiseCallback)
    isAdvertising = true
  }

  private val advertiseCallback = object : AdvertiseCallback() {
    override fun onStartFailure(errorCode: Int) {
      isAdvertising = false
    }
  }

  // ── GATT Client ──────────────────────────────────────────────────────────

  private val gattClientCallback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
      when (newState) {
        BluetoothProfile.STATE_CONNECTED -> {
          gattClients[gatt.device.address] = gatt
          gatt.discoverServices()
        }
        BluetoothProfile.STATE_DISCONNECTED -> {
          gattClients.remove(gatt.device.address)
          writeChars.remove(gatt.device.address)
          val hash = hashToAddress.entries.firstOrNull { it.value == gatt.device.address }?.key
          hash?.let {
            hashToAddress.remove(it)
            sendEvent("onPeerLost", mapOf("pubkyHash" to it))
          }
        }
      }
    }

    override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
      if (status != BluetoothGatt.GATT_SUCCESS) return
      val service = gatt.getService(SERVICE_UUID) ?: return
      val writeChar = service.getCharacteristic(WRITE_CHAR_UUID) ?: return
      val notifyChar = service.getCharacteristic(NOTIFY_CHAR_UUID) ?: return

      writeChars[gatt.device.address] = writeChar
      gatt.setCharacteristicNotification(notifyChar, true)
      val cccd = notifyChar.getDescriptor(CLIENT_CONFIG_UUID)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        gatt.writeDescriptor(cccd, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
      } else {
        @Suppress("DEPRECATION")
        cccd.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
        @Suppress("DEPRECATION")
        gatt.writeDescriptor(cccd)
      }
    }

    override fun onCharacteristicChanged(
      gatt: BluetoothGatt,
      characteristic: BluetoothGattCharacteristic,
      value: ByteArray,
    ) {
      val hash = hashToAddress.entries.firstOrNull { it.value == gatt.device.address }?.key
      handleIncomingFragment(value, gatt.device.address, hash)
    }

    @Suppress("DEPRECATION")
    override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
      val value = characteristic.value ?: return
      val hash = hashToAddress.entries.firstOrNull { it.value == gatt.device.address }?.key
      handleIncomingFragment(value, gatt.device.address, hash)
    }
  }

  // ── Fragmentation ──────────────────────────────────────────────────────────

  private fun sendFragmented(
    gatt: BluetoothGatt,
    characteristic: BluetoothGattCharacteristic,
    payload: ByteArray,
  ) {
    val mtu = gatt.requestMtu(512).let { 512 } // use 512 as conservative max; actual negotiated later
    val chunkSize = mtu - HEADER_SIZE
    val idHash = MessageDigest.getInstance("SHA-256").digest(payload).take(4).toByteArray()
    val chunks = payload.toList().chunked(chunkSize).map { it.toByteArray() }
    val totalFrags = chunks.size

    chunks.forEachIndexed { index, chunk ->
      val packet = ByteArray(HEADER_SIZE + chunk.size)
      System.arraycopy(idHash, 0, packet, 0, 4)
      packet[4] = (index and 0xFF).toByte()
      packet[5] = ((index shr 8) and 0xFF).toByte()
      packet[6] = (totalFrags and 0xFF).toByte()
      packet[7] = ((totalFrags shr 8) and 0xFF).toByte()
      packet[8] = 0
      System.arraycopy(chunk, 0, packet, HEADER_SIZE, chunk.size)

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        gatt.writeCharacteristic(characteristic, packet, BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE)
      } else {
        @Suppress("DEPRECATION")
        characteristic.value = packet
        @Suppress("DEPRECATION")
        characteristic.writeType = BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
        @Suppress("DEPRECATION")
        gatt.writeCharacteristic(characteristic)
      }
    }
  }

  private fun handleIncomingFragment(data: ByteArray, deviceAddress: String, pubkyHash: String?) {
    if (data.size < HEADER_SIZE) return

    val idHash = data.take(4).toByteArray()
    val idHex = idHash.toHex()
    val fragIndex = (data[4].toInt() and 0xFF) or ((data[5].toInt() and 0xFF) shl 8)
    val totalFrags = (data[6].toInt() and 0xFF) or ((data[7].toInt() and 0xFF) shl 8)
    val payload = data.drop(HEADER_SIZE).toByteArray()

    reassemblyBuffers.getOrPut(deviceAddress) { ConcurrentHashMap() }
      .getOrPut(idHex) { ConcurrentHashMap() }[fragIndex] = payload
    expectedFragCounts.getOrPut(deviceAddress) { ConcurrentHashMap() }[idHex] = totalFrags

    val frags = reassemblyBuffers[deviceAddress]!![idHex]!!
    if (frags.size == totalFrags) {
      val assembled = (0 until totalFrags).flatMap { i -> frags[i]!!.toList() }.toByteArray()
      reassemblyBuffers[deviceAddress]!!.remove(idHex)
      expectedFragCounts[deviceAddress]?.remove(idHex)

      sendEvent("onMessageReceived", mapOf(
        "pubkyHash" to (pubkyHash ?: ""),
        "payloadBase64" to android.util.Base64.encodeToString(assembled, android.util.Base64.NO_WRAP),
      ))
    }
  }
}

// ─── Extensions ───────────────────────────────────────────────────────────────

private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

private fun String.hexToByteArray(): ByteArray? {
  if (length % 2 != 0) return null
  return try {
    ByteArray(length / 2) { i ->
      substring(2 * i, 2 * i + 2).toInt(16).toByte()
    }
  } catch (_: NumberFormatException) {
    null
  }
}
