#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(PaykitLinkModule, NSObject)

RCT_EXTERN_METHOD(generateReceiverKey:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getReceiverPublicKey:(NSString *)receiverAlias
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(startAuthFlow:(NSString *)capabilities
                  relayUrl:(id)relayUrl
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(awaitAuthApproval:(NSString *)flowId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(signinWithSecret:(NSString *)identitySecretHex
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(signupWithSecret:(NSString *)identitySecretHex
                  homeserverPublicKey:(NSString *)homeserverPublicKey
                  signupToken:(id)signupToken
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(restoreSession:(NSString *)sessionAlias
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(signOutSession:(NSString *)sessionAlias
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(clearAllNativeSecrets:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(publishReceiverMarker:(NSString *)sessionAlias
                  receiverAlias:(NSString *)receiverAlias
                  receiverPath:(NSString *)receiverPath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getReceiverMarker:(NSString *)peerPubky
                  receiverPath:(NSString *)receiverPath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(removeReceiverMarker:(NSString *)sessionAlias
                  receiverPath:(NSString *)receiverPath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(initiateLink:(NSString *)sessionAlias
                  receiverAlias:(NSString *)receiverAlias
                  peerPubky:(NSString *)peerPubky
                  peerNoisePublicKey:(NSString *)peerNoisePublicKey
                  localReceiverPath:(NSString *)localReceiverPath
                  remoteReceiverPath:(NSString *)remoteReceiverPath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(probeInboundLink:(NSString *)sessionAlias
                  receiverAlias:(NSString *)receiverAlias
                  peerPubky:(NSString *)peerPubky
                  peerNoisePublicKey:(NSString *)peerNoisePublicKey
                  localReceiverPath:(NSString *)localReceiverPath
                  remoteReceiverPath:(NSString *)remoteReceiverPath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(advanceHandshake:(NSString *)linkId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(restoreHandshake:(NSString *)sessionAlias
                  receiverAlias:(NSString *)receiverAlias
                  peerPubky:(NSString *)peerPubky
                  peerNoisePublicKey:(NSString *)peerNoisePublicKey
                  localReceiverPath:(NSString *)localReceiverPath
                  remoteReceiverPath:(NSString *)remoteReceiverPath
                  snapshot:(NSString *)snapshot
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(restoreLink:(NSString *)sessionAlias
                  receiverAlias:(NSString *)receiverAlias
                  peerPubky:(NSString *)peerPubky
                  peerNoisePublicKey:(NSString *)peerNoisePublicKey
                  localReceiverPath:(NSString *)localReceiverPath
                  remoteReceiverPath:(NSString *)remoteReceiverPath
                  snapshot:(NSString *)snapshot
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(sendPrivateMessageJson:(NSString *)linkId
                  rawJson:(NSString *)rawJson
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(receivePrivateMessages:(NSString *)linkId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(clearLinkOutbox:(NSString *)sessionAlias
                  receiverAlias:(NSString *)receiverAlias
                  peerPubky:(NSString *)peerPubky
                  peerNoisePublicKey:(NSString *)peerNoisePublicKey
                  localReceiverPath:(NSString *)localReceiverPath
                  remoteReceiverPath:(NSString *)remoteReceiverPath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(closeLink:(NSString *)linkId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(generateAttachmentKey:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(attachmentEncrypt:(NSString *)plaintextB64
                  keyB64:(NSString *)keyB64
                  aad:(id)aad
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(attachmentDecrypt:(NSString *)ciphertextB64
                  keyB64:(NSString *)keyB64
                  nonceB64:(NSString *)nonceB64
                  aad:(id)aad
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
