import ExpoModulesCore
import CoreBluetooth
import CommonCrypto

// ─── Constants ───────────────────────────────────────────────────────────────

private let kServiceUUID      = CBUUID(string: "6BA7B810-9DAD-11D1-80B4-00C04FD430C8")
private let kWriteCharUUID    = CBUUID(string: "6BA7B811-9DAD-11D1-80B4-00C04FD430C8")
private let kNotifyCharUUID   = CBUUID(string: "6BA7B812-9DAD-11D1-80B4-00C04FD430C8")

// Fragment header layout (9 bytes):
//   [0..3]  message_id_hash (4 bytes)
//   [4..5]  fragment_index  (UInt16 LE)
//   [6..7]  total_fragments (UInt16 LE)
//   [8]     reserved (0)
private let kHeaderSize = 9

// ─── BLE Delegate Helper ───────────────────────────────────────────────────

/// NSObject subclass that handles CoreBluetooth delegate callbacks.
/// MeshTransportModule cannot itself conform to CBCentralManagerDelegate because
/// ExpoModulesCore.Module does not inherit from NSObject.
final class MeshBLEDelegate: NSObject,
    CBCentralManagerDelegate,
    CBPeripheralManagerDelegate,
    CBPeripheralDelegate {

  // Callbacks into the module
  var onPeerDiscovered: ((_ pubkyHash: String, _ rssi: Int) -> Void)?
  var onPeerLost: ((_ pubkyHash: String) -> Void)?
  var onMessageReceived: ((_ pubkyHash: String, _ payloadBase64: String) -> Void)?

  private var centralManager: CBCentralManager?
  private var peripheralManager: CBPeripheralManager?

  private var discoveredPeripherals: [UUID: CBPeripheral] = [:]
  private var writeCharacteristics: [UUID: CBCharacteristic] = [:]
  private var notifyCharacteristics: [UUID: CBCharacteristic] = [:]

  private var reassemblyBuffers: [UUID: [String: [Int: Data]]] = [:]
  private var expectedFragmentCounts: [UUID: [String: Int]] = [:]

  private(set) var localPubkyHash: String = ""
  private var pendingSends: [UUID: [Data]] = [:]

  private var notifyCharacteristic: CBMutableCharacteristic?
  private var subscribedCentrals: [CBCentral] = []

  // ── Control ──────────────────────────────────────────────────────────────

  func startAdvertising(pubkyHashHex: String) {
    localPubkyHash = pubkyHashHex
    initPeripheralManager()
    initCentralManager()
  }

  func startScanning() {
    initCentralManager()
  }

  func stopAll() {
    peripheralManager?.stopAdvertising()
    centralManager?.stopScan()
  }

  func sendToPeer(pubkyHashHex: String, payloadBase64: String) -> Bool {
    guard let payload = Data(base64Encoded: payloadBase64) else { return false }
    let target = discoveredPeripherals.values.first { p in
      p.state == .connected && p.name == pubkyHashHex
    }
    guard let peripheral = target,
          let writeChar = writeCharacteristics[peripheral.identifier] else {
      return false
    }
    sendFragmented(peripheral: peripheral, characteristic: writeChar, payload: payload)
    return true
  }

  func getConnectedPeers() -> [String] {
    return discoveredPeripherals.values
      .filter { $0.state == .connected }
      .compactMap { $0.name }
  }

  // ── Peripheral Manager (advertising) ─────────────────────────────────────

  private func initPeripheralManager() {
    guard peripheralManager == nil else { return }
    peripheralManager = CBPeripheralManager(
      delegate: self,
      queue: nil,
      options: [CBPeripheralManagerOptionRestoreIdentifierKey: "hypercolor.mesh.peripheral"]
    )
  }

  func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
    guard peripheral.state == .poweredOn else { return }
    let writeChar = CBMutableCharacteristic(
      type: kWriteCharUUID,
      properties: [.writeWithoutResponse, .write],
      value: nil,
      permissions: [.writeable]
    )
    let notifyChar = CBMutableCharacteristic(
      type: kNotifyCharUUID,
      properties: [.notify],
      value: nil,
      permissions: [.readable]
    )
    notifyCharacteristic = notifyChar
    let service = CBMutableService(type: kServiceUUID, primary: true)
    service.characteristics = [writeChar, notifyChar]
    peripheral.add(service)
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
    guard error == nil else { return }
    let hashData = Data(hexString: localPubkyHash) ?? Data()
    peripheral.startAdvertising([
      CBAdvertisementDataServiceUUIDsKey: [kServiceUUID],
      CBAdvertisementDataLocalNameKey: localPubkyHash,
      CBAdvertisementDataServiceDataKey: [kServiceUUID: hashData],
    ])
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
    for request in requests {
      if let data = request.value {
        handleIncomingFragment(data: data, from: nil)
      }
      peripheral.respond(to: request, withResult: .success)
    }
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didSubscribeTo characteristic: CBCharacteristic) {
    if !subscribedCentrals.contains(where: { $0.identifier == central.identifier }) {
      subscribedCentrals.append(central)
    }
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didUnsubscribeFrom characteristic: CBCharacteristic) {
    subscribedCentrals.removeAll { $0.identifier == central.identifier }
  }

  func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) {}

  // ── Central Manager (scanning + GATT client) ──────────────────────────────

  private func initCentralManager() {
    guard centralManager == nil else { return }
    centralManager = CBCentralManager(
      delegate: self,
      queue: nil,
      options: [CBCentralManagerOptionRestoreIdentifierKey: "hypercolor.mesh.central"]
    )
  }

  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    guard central.state == .poweredOn else { return }
    central.scanForPeripherals(withServices: [kServiceUUID],
                               options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
  }

  func centralManager(_ central: CBCentralManager,
                      didDiscover peripheral: CBPeripheral,
                      advertisementData: [String: Any],
                      rssi RSSI: NSNumber) {
    let serviceData = advertisementData[CBAdvertisementDataServiceDataKey] as? [CBUUID: Data]
    let hashData = serviceData?[kServiceUUID]
    let pubkyHashHex = hashData?.hexString ?? (advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? "")
    guard !pubkyHashHex.isEmpty, pubkyHashHex != localPubkyHash else { return }

    discoveredPeripherals[peripheral.identifier] = peripheral
    peripheral.delegate = self
    onPeerDiscovered?(pubkyHashHex, RSSI.intValue)

    if peripheral.state == .disconnected {
      central.connect(peripheral, options: nil)
    }
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    peripheral.discoverServices([kServiceUUID])
  }

  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
    writeCharacteristics.removeValue(forKey: peripheral.identifier)
    notifyCharacteristics.removeValue(forKey: peripheral.identifier)
    reassemblyBuffers.removeValue(forKey: peripheral.identifier)
    expectedFragmentCounts.removeValue(forKey: peripheral.identifier)
    let pubkyHash = peripheral.name ?? ""
    onPeerLost?(pubkyHash)
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    guard let service = peripheral.services?.first(where: { $0.uuid == kServiceUUID }) else { return }
    peripheral.discoverCharacteristics([kWriteCharUUID, kNotifyCharUUID], for: service)
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    for char in service.characteristics ?? [] {
      if char.uuid == kWriteCharUUID {
        writeCharacteristics[peripheral.identifier] = char
        if let pending = pendingSends.removeValue(forKey: peripheral.identifier) {
          for payload in pending {
            sendFragmented(peripheral: peripheral, characteristic: char, payload: payload)
          }
        }
      } else if char.uuid == kNotifyCharUUID {
        notifyCharacteristics[peripheral.identifier] = char
        peripheral.setNotifyValue(true, for: char)
      }
    }
  }

  func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
    guard let data = characteristic.value else { return }
    handleIncomingFragment(data: data, from: peripheral)
  }

  // ── Fragmentation ─────────────────────────────────────────────────────────

  private func sendFragmented(peripheral: CBPeripheral, characteristic: CBCharacteristic, payload: Data) {
    let mtu = peripheral.maximumWriteValueLength(for: .withoutResponse)
    let chunkSize = max(1, mtu - kHeaderSize)
    let idHash = Data(payload.sha256().prefix(4))
    let chunks = stride(from: 0, to: payload.count, by: chunkSize).map { offset in
      payload[offset..<min(offset + chunkSize, payload.count)]
    }
    let totalFragments = chunks.count
    for (index, chunk) in chunks.enumerated() {
      var header = Data(count: kHeaderSize)
      header[0..<4] = idHash
      withUnsafeBytes(of: UInt16(index).littleEndian) { header[4..<6] = Data($0) }
      withUnsafeBytes(of: UInt16(totalFragments).littleEndian) { header[6..<8] = Data($0) }
      header[8] = 0
      var packet = header
      packet.append(contentsOf: chunk)
      peripheral.writeValue(
        packet,
        for: characteristic,
        type: characteristic.properties.contains(.writeWithoutResponse) ? .withoutResponse : .withResponse
      )
    }
  }

  private func handleIncomingFragment(data: Data, from peripheral: CBPeripheral?) {
    guard data.count >= kHeaderSize else { return }
    let idHash = data[0..<4]
    let idHex = idHash.hexString
    let fragIndex = Int(UInt16(littleEndian: data[4..<6].withUnsafeBytes { $0.load(as: UInt16.self) }))
    let totalFrags = Int(UInt16(littleEndian: data[6..<8].withUnsafeBytes { $0.load(as: UInt16.self) }))
    let payload = data[kHeaderSize...]
    let peerKey = peripheral?.identifier ?? UUID()
    if reassemblyBuffers[peerKey] == nil { reassemblyBuffers[peerKey] = [:] }
    if reassemblyBuffers[peerKey]![idHex] == nil { reassemblyBuffers[peerKey]![idHex] = [:] }
    reassemblyBuffers[peerKey]![idHex]![fragIndex] = payload
    expectedFragmentCounts[peerKey, default: [:]][idHex] = totalFrags
    if reassemblyBuffers[peerKey]![idHex]!.count == totalFrags {
      var assembled = Data()
      for i in 0..<totalFrags {
        if let frag = reassemblyBuffers[peerKey]![idHex]![i] { assembled.append(frag) }
      }
      reassemblyBuffers[peerKey]!.removeValue(forKey: idHex)
      expectedFragmentCounts[peerKey]?.removeValue(forKey: idHex)
      let pubkyHash = peripheral?.name ?? ""
      onMessageReceived?(pubkyHash, assembled.base64EncodedString())
    }
  }

  // ── State restoration ─────────────────────────────────────────────────────

  func centralManager(_ central: CBCentralManager, willRestoreState dict: [String: Any]) {
    if let peripherals = dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral] {
      for p in peripherals {
        discoveredPeripherals[p.identifier] = p
        p.delegate = self
      }
    }
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, willRestoreState dict: [String: Any]) {
    if let services = dict[CBPeripheralManagerRestoredStateServicesKey] as? [CBMutableService] {
      for service in services {
        for char in service.characteristics ?? [] {
          if char.uuid == kNotifyCharUUID, let mchar = char as? CBMutableCharacteristic {
            notifyCharacteristic = mchar
          }
        }
      }
    }
  }
}

// ─── Expo Module ──────────────────────────────────────────────────────────────

public class MeshTransportModule: Module {

  private let ble = MeshBLEDelegate()

  public func definition() -> ModuleDefinition {
    Name("MeshTransport")

    Events("onPeerDiscovered", "onPeerLost", "onMessageReceived")

    OnCreate {
      self.ble.onPeerDiscovered = { [weak self] pubkyHash, rssi in
        self?.sendEvent("onPeerDiscovered", ["pubkyHash": pubkyHash, "rssi": rssi])
      }
      self.ble.onPeerLost = { [weak self] pubkyHash in
        self?.sendEvent("onPeerLost", ["pubkyHash": pubkyHash])
      }
      self.ble.onMessageReceived = { [weak self] pubkyHash, payloadBase64 in
        self?.sendEvent("onMessageReceived", ["pubkyHash": pubkyHash, "payloadBase64": payloadBase64])
      }
    }

    AsyncFunction("startAdvertising") { (pubkyHashHex: String) in
      self.ble.startAdvertising(pubkyHashHex: pubkyHashHex)
    }

    AsyncFunction("startScanning") {
      self.ble.startScanning()
    }

    AsyncFunction("stopAll") {
      self.ble.stopAll()
    }

    AsyncFunction("sendToPeer") { (pubkyHashHex: String, payloadBase64: String) -> Bool in
      return self.ble.sendToPeer(pubkyHashHex: pubkyHashHex, payloadBase64: payloadBase64)
    }

    AsyncFunction("getConnectedPeers") { () -> [String] in
      return self.ble.getConnectedPeers()
    }
  }
}

// ─── Data / String extensions ─────────────────────────────────────────────────

private extension Data {
  var hexString: String {
    map { String(format: "%02x", $0) }.joined()
  }

  func sha256() -> Data {
    var digest = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
    withUnsafeBytes { CC_SHA256($0.baseAddress, CC_LONG(count), &digest) }
    return Data(digest)
  }

  init?(hexString: String) {
    let len = hexString.count / 2
    var data = Data(capacity: len)
    var index = hexString.startIndex
    for _ in 0..<len {
      let nextIndex = hexString.index(index, offsetBy: 2)
      if let byte = UInt8(hexString[index..<nextIndex], radix: 16) {
        data.append(byte)
      } else { return nil }
      index = nextIndex
    }
    self = data
  }
}
