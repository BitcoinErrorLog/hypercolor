#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(PaykitSdkModule, NSObject)

RCT_EXTERN_METHOD(bindOwner:(NSString *)ownerPubky
                  sessionAlias:(NSString *)sessionAlias
                  receiverAlias:(NSString *)receiverAlias
                  receiverPath:(NSString *)receiverPath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(ensureLinkWithPeer:(NSString *)ownerPubky
                  peerPubky:(NSString *)peerPubky
                  receiverPath:(NSString *)receiverPath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(observeEncryptedLinkRecoveryMarker:(NSString *)ownerPubky
                  peerPubky:(NSString *)peerPubky
                  receiverPath:(NSString *)receiverPath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(enqueueOpaquePrivateApplicationMessageJson:(NSString *)ownerPubky
                  peerPubky:(NSString *)peerPubky
                  receiverPath:(NSString *)receiverPath
                  rawJson:(NSString *)rawJson
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(processOutboundPrivateMessages:(NSString *)ownerPubky
                  peerPubky:(NSString *)peerPubky
                  receiverPath:(NSString *)receiverPath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(receivePrivateMessages:(NSString *)ownerPubky
                  peerPubky:(NSString *)peerPubky
                  receiverPath:(NSString *)receiverPath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(privateStreamItems:(NSString *)ownerPubky
                  rawIds:(NSArray *)rawIds
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(deleteOwnerState:(NSString *)ownerPubky
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
