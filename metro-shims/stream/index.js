'use strict';
class Stream {
  on() { return this; }
  once() { return this; }
  emit() { return false; }
  removeListener() { return this; }
  pipe(dest) { return dest; }
}
class Readable extends Stream {}
class Writable extends Stream {}
class Duplex extends Stream {}
class Transform extends Stream {}
class PassThrough extends Stream {}
module.exports = Stream;
module.exports.Stream = Stream;
module.exports.Readable = Readable;
module.exports.Writable = Writable;
module.exports.Duplex = Duplex;
module.exports.Transform = Transform;
module.exports.PassThrough = PassThrough;
