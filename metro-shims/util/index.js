'use strict';
function inherits(ctor, superCtor) {
  if (superCtor) {
    ctor.super_ = superCtor;
    Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
  }
}
function promisify(fn) {
  return function promisified(...args) {
    return new Promise((resolve, reject) => {
      fn.call(this, ...args, (err, result) => (err ? reject(err) : resolve(result)));
    });
  };
}
module.exports = {
  inherits,
  promisify,
  inspect: String,
  deprecate: fn => fn,
  format: (...a) => a.map(String).join(' '),
};
