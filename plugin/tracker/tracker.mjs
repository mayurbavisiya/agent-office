import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/ws/lib/constants.js
var require_constants = __commonJS({
  "node_modules/ws/lib/constants.js"(exports, module) {
    "use strict";
    var BINARY_TYPES = ["nodebuffer", "arraybuffer", "fragments"];
    var hasBlob = typeof Blob !== "undefined";
    if (hasBlob) BINARY_TYPES.push("blob");
    module.exports = {
      BINARY_TYPES,
      CLOSE_TIMEOUT: 3e4,
      EMPTY_BUFFER: Buffer.alloc(0),
      GUID: "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
      hasBlob,
      kForOnEventAttribute: /* @__PURE__ */ Symbol("kIsForOnEventAttribute"),
      kListener: /* @__PURE__ */ Symbol("kListener"),
      kStatusCode: /* @__PURE__ */ Symbol("status-code"),
      kWebSocket: /* @__PURE__ */ Symbol("websocket"),
      NOOP: () => {
      }
    };
  }
});

// node_modules/ws/lib/buffer-util.js
var require_buffer_util = __commonJS({
  "node_modules/ws/lib/buffer-util.js"(exports, module) {
    "use strict";
    var { websocketMask, websocketUnmask } = __require("http");
    var { EMPTY_BUFFER } = require_constants();
    var FastBuffer = Buffer[Symbol.species];
    function concat(list, totalLength) {
      if (list.length === 0) return EMPTY_BUFFER;
      if (list.length === 1) return list[0];
      const target = Buffer.allocUnsafe(totalLength);
      let offset = 0;
      for (let i = 0; i < list.length; i++) {
        const buf = list[i];
        target.set(buf, offset);
        offset += buf.length;
      }
      if (offset < totalLength) {
        return new FastBuffer(target.buffer, target.byteOffset, offset);
      }
      return target;
    }
    function _mask(source, mask, output, offset, length) {
      for (let i = 0; i < length; i++) {
        output[offset + i] = source[i] ^ mask[i & 3];
      }
    }
    function _unmask(buffer, mask) {
      for (let i = 0; i < buffer.length; i++) {
        buffer[i] ^= mask[i & 3];
      }
    }
    function toArrayBuffer(buf) {
      if (buf.length === buf.buffer.byteLength) {
        return buf.buffer;
      }
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
    }
    function toBuffer(data) {
      toBuffer.readOnly = true;
      if (Buffer.isBuffer(data)) return data;
      let buf;
      if (data instanceof ArrayBuffer) {
        buf = new FastBuffer(data);
      } else if (ArrayBuffer.isView(data)) {
        buf = new FastBuffer(data.buffer, data.byteOffset, data.byteLength);
      } else {
        buf = Buffer.from(data);
        toBuffer.readOnly = false;
      }
      return buf;
    }
    module.exports = {
      concat,
      mask: _mask,
      toArrayBuffer,
      toBuffer,
      unmask: _unmask
    };
    if (websocketMask) {
      module.exports.mask = function(source, mask, output, offset, length) {
        if (length < 24) _mask(source, mask, output, offset, length);
        else websocketMask(source, mask, output, offset, length);
      };
      module.exports.unmask = function(buffer, mask) {
        if (buffer.length < 24) _unmask(buffer, mask);
        else websocketUnmask(buffer, mask);
      };
    } else if (!process.env.WS_NO_BUFFER_UTIL) {
      try {
        const bufferUtil = __require("bufferutil");
        module.exports.mask = function(source, mask, output, offset, length) {
          if (length < 48) _mask(source, mask, output, offset, length);
          else bufferUtil.mask(source, mask, output, offset, length);
        };
        module.exports.unmask = function(buffer, mask) {
          if (buffer.length < 32) _unmask(buffer, mask);
          else bufferUtil.unmask(buffer, mask);
        };
      } catch (e) {
      }
    }
  }
});

// node_modules/ws/lib/limiter.js
var require_limiter = __commonJS({
  "node_modules/ws/lib/limiter.js"(exports, module) {
    "use strict";
    var kDone = /* @__PURE__ */ Symbol("kDone");
    var kRun = /* @__PURE__ */ Symbol("kRun");
    var Limiter = class {
      /**
       * Creates a new `Limiter`.
       *
       * @param {Number} [concurrency=Infinity] The maximum number of jobs allowed
       *     to run concurrently
       */
      constructor(concurrency) {
        this[kDone] = () => {
          this.pending--;
          this[kRun]();
        };
        this.concurrency = concurrency || Infinity;
        this.jobs = [];
        this.pending = 0;
      }
      /**
       * Adds a job to the queue.
       *
       * @param {Function} job The job to run
       * @public
       */
      add(job) {
        this.jobs.push(job);
        this[kRun]();
      }
      /**
       * Removes a job from the queue and runs it if possible.
       *
       * @private
       */
      [kRun]() {
        if (this.pending === this.concurrency) return;
        if (this.jobs.length) {
          const job = this.jobs.shift();
          this.pending++;
          job(this[kDone]);
        }
      }
    };
    module.exports = Limiter;
  }
});

// node_modules/ws/lib/permessage-deflate.js
var require_permessage_deflate = __commonJS({
  "node_modules/ws/lib/permessage-deflate.js"(exports, module) {
    "use strict";
    var zlib = __require("zlib");
    var bufferUtil = require_buffer_util();
    var Limiter = require_limiter();
    var { kStatusCode } = require_constants();
    var FastBuffer = Buffer[Symbol.species];
    var TRAILER = Buffer.from([0, 0, 255, 255]);
    var kPerMessageDeflate = /* @__PURE__ */ Symbol("permessage-deflate");
    var kTotalLength = /* @__PURE__ */ Symbol("total-length");
    var kCallback = /* @__PURE__ */ Symbol("callback");
    var kBuffers = /* @__PURE__ */ Symbol("buffers");
    var kError = /* @__PURE__ */ Symbol("error");
    var zlibLimiter;
    var PerMessageDeflate2 = class {
      /**
       * Creates a PerMessageDeflate instance.
       *
       * @param {Object} [options] Configuration options
       * @param {(Boolean|Number)} [options.clientMaxWindowBits] Advertise support
       *     for, or request, a custom client window size
       * @param {Boolean} [options.clientNoContextTakeover=false] Advertise/
       *     acknowledge disabling of client context takeover
       * @param {Number} [options.concurrencyLimit=10] The number of concurrent
       *     calls to zlib
       * @param {Boolean} [options.isServer=false] Create the instance in either
       *     server or client mode
       * @param {Number} [options.maxPayload=0] The maximum allowed message length
       * @param {(Boolean|Number)} [options.serverMaxWindowBits] Request/confirm the
       *     use of a custom server window size
       * @param {Boolean} [options.serverNoContextTakeover=false] Request/accept
       *     disabling of server context takeover
       * @param {Number} [options.threshold=1024] Size (in bytes) below which
       *     messages should not be compressed if context takeover is disabled
       * @param {Object} [options.zlibDeflateOptions] Options to pass to zlib on
       *     deflate
       * @param {Object} [options.zlibInflateOptions] Options to pass to zlib on
       *     inflate
       */
      constructor(options) {
        this._options = options || {};
        this._threshold = this._options.threshold !== void 0 ? this._options.threshold : 1024;
        this._maxPayload = this._options.maxPayload | 0;
        this._isServer = !!this._options.isServer;
        this._deflate = null;
        this._inflate = null;
        this.params = null;
        if (!zlibLimiter) {
          const concurrency = this._options.concurrencyLimit !== void 0 ? this._options.concurrencyLimit : 10;
          zlibLimiter = new Limiter(concurrency);
        }
      }
      /**
       * @type {String}
       */
      static get extensionName() {
        return "permessage-deflate";
      }
      /**
       * Create an extension negotiation offer.
       *
       * @return {Object} Extension parameters
       * @public
       */
      offer() {
        const params = {};
        if (this._options.serverNoContextTakeover) {
          params.server_no_context_takeover = true;
        }
        if (this._options.clientNoContextTakeover) {
          params.client_no_context_takeover = true;
        }
        if (this._options.serverMaxWindowBits) {
          params.server_max_window_bits = this._options.serverMaxWindowBits;
        }
        if (this._options.clientMaxWindowBits) {
          params.client_max_window_bits = this._options.clientMaxWindowBits;
        } else if (this._options.clientMaxWindowBits == null) {
          params.client_max_window_bits = true;
        }
        return params;
      }
      /**
       * Accept an extension negotiation offer/response.
       *
       * @param {Array} configurations The extension negotiation offers/reponse
       * @return {Object} Accepted configuration
       * @public
       */
      accept(configurations) {
        configurations = this.normalizeParams(configurations);
        this.params = this._isServer ? this.acceptAsServer(configurations) : this.acceptAsClient(configurations);
        return this.params;
      }
      /**
       * Releases all resources used by the extension.
       *
       * @public
       */
      cleanup() {
        if (this._inflate) {
          this._inflate.close();
          this._inflate = null;
        }
        if (this._deflate) {
          const callback = this._deflate[kCallback];
          this._deflate.close();
          this._deflate = null;
          if (callback) {
            callback(
              new Error(
                "The deflate stream was closed while data was being processed"
              )
            );
          }
        }
      }
      /**
       *  Accept an extension negotiation offer.
       *
       * @param {Array} offers The extension negotiation offers
       * @return {Object} Accepted configuration
       * @private
       */
      acceptAsServer(offers) {
        const opts = this._options;
        const accepted = offers.find((params) => {
          if (opts.serverNoContextTakeover === false && params.server_no_context_takeover || params.server_max_window_bits && (opts.serverMaxWindowBits === false || typeof opts.serverMaxWindowBits === "number" && opts.serverMaxWindowBits > params.server_max_window_bits) || typeof opts.clientMaxWindowBits === "number" && (typeof params.client_max_window_bits === "number" ? opts.clientMaxWindowBits > params.client_max_window_bits : !params.client_max_window_bits)) {
            return false;
          }
          return true;
        });
        if (!accepted) {
          throw new Error("None of the extension offers can be accepted");
        }
        if (opts.serverNoContextTakeover) {
          accepted.server_no_context_takeover = true;
        }
        if (opts.clientNoContextTakeover) {
          accepted.client_no_context_takeover = true;
        }
        if (typeof opts.serverMaxWindowBits === "number") {
          accepted.server_max_window_bits = opts.serverMaxWindowBits;
        }
        if (typeof opts.clientMaxWindowBits === "number") {
          accepted.client_max_window_bits = opts.clientMaxWindowBits;
        } else if (accepted.client_max_window_bits === true || opts.clientMaxWindowBits === false) {
          delete accepted.client_max_window_bits;
        }
        return accepted;
      }
      /**
       * Accept the extension negotiation response.
       *
       * @param {Array} response The extension negotiation response
       * @return {Object} Accepted configuration
       * @private
       */
      acceptAsClient(response) {
        const params = response[0];
        if (this._options.clientNoContextTakeover === false && params.client_no_context_takeover) {
          throw new Error('Unexpected parameter "client_no_context_takeover"');
        }
        if (!params.client_max_window_bits) {
          if (typeof this._options.clientMaxWindowBits === "number") {
            params.client_max_window_bits = this._options.clientMaxWindowBits;
          }
        } else if (this._options.clientMaxWindowBits === false || typeof this._options.clientMaxWindowBits === "number" && params.client_max_window_bits > this._options.clientMaxWindowBits) {
          throw new Error(
            'Unexpected or invalid parameter "client_max_window_bits"'
          );
        }
        return params;
      }
      /**
       * Normalize parameters.
       *
       * @param {Array} configurations The extension negotiation offers/reponse
       * @return {Array} The offers/response with normalized parameters
       * @private
       */
      normalizeParams(configurations) {
        configurations.forEach((params) => {
          Object.keys(params).forEach((key) => {
            let value = params[key];
            if (value.length > 1) {
              throw new Error(`Parameter "${key}" must have only a single value`);
            }
            value = value[0];
            if (key === "client_max_window_bits") {
              if (value !== true) {
                const num3 = +value;
                if (!Number.isInteger(num3) || num3 < 8 || num3 > 15) {
                  throw new TypeError(
                    `Invalid value for parameter "${key}": ${value}`
                  );
                }
                value = num3;
              } else if (!this._isServer) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
            } else if (key === "server_max_window_bits") {
              const num3 = +value;
              if (!Number.isInteger(num3) || num3 < 8 || num3 > 15) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
              value = num3;
            } else if (key === "client_no_context_takeover" || key === "server_no_context_takeover") {
              if (value !== true) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
            } else {
              throw new Error(`Unknown parameter "${key}"`);
            }
            params[key] = value;
          });
        });
        return configurations;
      }
      /**
       * Decompress data. Concurrency limited.
       *
       * @param {Buffer} data Compressed data
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @public
       */
      decompress(data, fin, callback) {
        zlibLimiter.add((done) => {
          this._decompress(data, fin, (err, result) => {
            done();
            callback(err, result);
          });
        });
      }
      /**
       * Compress data. Concurrency limited.
       *
       * @param {(Buffer|String)} data Data to compress
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @public
       */
      compress(data, fin, callback) {
        zlibLimiter.add((done) => {
          this._compress(data, fin, (err, result) => {
            done();
            callback(err, result);
          });
        });
      }
      /**
       * Decompress data.
       *
       * @param {Buffer} data Compressed data
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @private
       */
      _decompress(data, fin, callback) {
        const endpoint = this._isServer ? "client" : "server";
        if (!this._inflate) {
          const key = `${endpoint}_max_window_bits`;
          const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
          this._inflate = zlib.createInflateRaw({
            ...this._options.zlibInflateOptions,
            windowBits
          });
          this._inflate[kPerMessageDeflate] = this;
          this._inflate[kTotalLength] = 0;
          this._inflate[kBuffers] = [];
          this._inflate.on("error", inflateOnError);
          this._inflate.on("data", inflateOnData);
        }
        this._inflate[kCallback] = callback;
        this._inflate.write(data);
        if (fin) this._inflate.write(TRAILER);
        this._inflate.flush(() => {
          const err = this._inflate[kError];
          if (err) {
            this._inflate.close();
            this._inflate = null;
            callback(err);
            return;
          }
          const data2 = bufferUtil.concat(
            this._inflate[kBuffers],
            this._inflate[kTotalLength]
          );
          if (this._inflate._readableState.endEmitted) {
            this._inflate.close();
            this._inflate = null;
          } else {
            this._inflate[kTotalLength] = 0;
            this._inflate[kBuffers] = [];
            if (fin && this.params[`${endpoint}_no_context_takeover`]) {
              this._inflate.reset();
            }
          }
          callback(null, data2);
        });
      }
      /**
       * Compress data.
       *
       * @param {(Buffer|String)} data Data to compress
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @private
       */
      _compress(data, fin, callback) {
        const endpoint = this._isServer ? "server" : "client";
        if (!this._deflate) {
          const key = `${endpoint}_max_window_bits`;
          const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
          this._deflate = zlib.createDeflateRaw({
            ...this._options.zlibDeflateOptions,
            windowBits
          });
          this._deflate[kTotalLength] = 0;
          this._deflate[kBuffers] = [];
          this._deflate.on("data", deflateOnData);
        }
        this._deflate[kCallback] = callback;
        this._deflate.write(data);
        this._deflate.flush(zlib.Z_SYNC_FLUSH, () => {
          if (!this._deflate) {
            return;
          }
          let data2 = bufferUtil.concat(
            this._deflate[kBuffers],
            this._deflate[kTotalLength]
          );
          if (fin) {
            data2 = new FastBuffer(data2.buffer, data2.byteOffset, data2.length - 4);
          }
          this._deflate[kCallback] = null;
          this._deflate[kTotalLength] = 0;
          this._deflate[kBuffers] = [];
          if (fin && this.params[`${endpoint}_no_context_takeover`]) {
            this._deflate.reset();
          }
          callback(null, data2);
        });
      }
    };
    module.exports = PerMessageDeflate2;
    function deflateOnData(chunk) {
      this[kBuffers].push(chunk);
      this[kTotalLength] += chunk.length;
    }
    function inflateOnData(chunk) {
      this[kTotalLength] += chunk.length;
      if (this[kPerMessageDeflate]._maxPayload < 1 || this[kTotalLength] <= this[kPerMessageDeflate]._maxPayload) {
        this[kBuffers].push(chunk);
        return;
      }
      this[kError] = new RangeError("Max payload size exceeded");
      this[kError].code = "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH";
      this[kError][kStatusCode] = 1009;
      this.removeListener("data", inflateOnData);
      this.reset();
    }
    function inflateOnError(err) {
      this[kPerMessageDeflate]._inflate = null;
      if (this[kError]) {
        this[kCallback](this[kError]);
        return;
      }
      err[kStatusCode] = 1007;
      this[kCallback](err);
    }
  }
});

// node_modules/ws/lib/validation.js
var require_validation = __commonJS({
  "node_modules/ws/lib/validation.js"(exports, module) {
    "use strict";
    var { isUtf8 } = __require("buffer");
    var { hasBlob } = require_constants();
    var tokenChars = [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 0 - 15
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 16 - 31
      0,
      1,
      0,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      1,
      1,
      0,
      1,
      1,
      0,
      // 32 - 47
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      // 48 - 63
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      // 64 - 79
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      1,
      1,
      // 80 - 95
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      // 96 - 111
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      1,
      0,
      1,
      0
      // 112 - 127
    ];
    function isValidStatusCode(code) {
      return code >= 1e3 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006 || code >= 3e3 && code <= 4999;
    }
    function _isValidUTF8(buf) {
      const len = buf.length;
      let i = 0;
      while (i < len) {
        if ((buf[i] & 128) === 0) {
          i++;
        } else if ((buf[i] & 224) === 192) {
          if (i + 1 === len || (buf[i + 1] & 192) !== 128 || (buf[i] & 254) === 192) {
            return false;
          }
          i += 2;
        } else if ((buf[i] & 240) === 224) {
          if (i + 2 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || buf[i] === 224 && (buf[i + 1] & 224) === 128 || // Overlong
          buf[i] === 237 && (buf[i + 1] & 224) === 160) {
            return false;
          }
          i += 3;
        } else if ((buf[i] & 248) === 240) {
          if (i + 3 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || (buf[i + 3] & 192) !== 128 || buf[i] === 240 && (buf[i + 1] & 240) === 128 || // Overlong
          buf[i] === 244 && buf[i + 1] > 143 || buf[i] > 244) {
            return false;
          }
          i += 4;
        } else {
          return false;
        }
      }
      return true;
    }
    function isBlob(value) {
      return hasBlob && typeof value === "object" && typeof value.arrayBuffer === "function" && typeof value.type === "string" && typeof value.stream === "function" && (value[Symbol.toStringTag] === "Blob" || value[Symbol.toStringTag] === "File");
    }
    module.exports = {
      isBlob,
      isValidStatusCode,
      isValidUTF8: _isValidUTF8,
      tokenChars
    };
    if (isUtf8) {
      module.exports.isValidUTF8 = function(buf) {
        return buf.length < 24 ? _isValidUTF8(buf) : isUtf8(buf);
      };
    } else if (!process.env.WS_NO_UTF_8_VALIDATE) {
      try {
        const isValidUTF8 = __require("utf-8-validate");
        module.exports.isValidUTF8 = function(buf) {
          return buf.length < 32 ? _isValidUTF8(buf) : isValidUTF8(buf);
        };
      } catch (e) {
      }
    }
  }
});

// node_modules/ws/lib/receiver.js
var require_receiver = __commonJS({
  "node_modules/ws/lib/receiver.js"(exports, module) {
    "use strict";
    var { Writable } = __require("stream");
    var PerMessageDeflate2 = require_permessage_deflate();
    var {
      BINARY_TYPES,
      EMPTY_BUFFER,
      kStatusCode,
      kWebSocket
    } = require_constants();
    var { concat, toArrayBuffer, unmask } = require_buffer_util();
    var { isValidStatusCode, isValidUTF8 } = require_validation();
    var FastBuffer = Buffer[Symbol.species];
    var GET_INFO = 0;
    var GET_PAYLOAD_LENGTH_16 = 1;
    var GET_PAYLOAD_LENGTH_64 = 2;
    var GET_MASK = 3;
    var GET_DATA = 4;
    var INFLATING = 5;
    var DEFER_EVENT = 6;
    var Receiver2 = class extends Writable {
      /**
       * Creates a Receiver instance.
       *
       * @param {Object} [options] Options object
       * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {String} [options.binaryType=nodebuffer] The type for binary data
       * @param {Object} [options.extensions] An object containing the negotiated
       *     extensions
       * @param {Boolean} [options.isServer=false] Specifies whether to operate in
       *     client or server mode
       * @param {Number} [options.maxBufferedChunks=0] The maximum number of
       *     buffered data chunks
       * @param {Number} [options.maxFragments=0] The maximum number of message
       *     fragments
       * @param {Number} [options.maxPayload=0] The maximum allowed message length
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       */
      constructor(options = {}) {
        super();
        this._allowSynchronousEvents = options.allowSynchronousEvents !== void 0 ? options.allowSynchronousEvents : true;
        this._binaryType = options.binaryType || BINARY_TYPES[0];
        this._extensions = options.extensions || {};
        this._isServer = !!options.isServer;
        this._maxBufferedChunks = options.maxBufferedChunks | 0;
        this._maxFragments = options.maxFragments | 0;
        this._maxPayload = options.maxPayload | 0;
        this._skipUTF8Validation = !!options.skipUTF8Validation;
        this[kWebSocket] = void 0;
        this._bufferedBytes = 0;
        this._buffers = [];
        this._compressed = false;
        this._payloadLength = 0;
        this._mask = void 0;
        this._fragmented = 0;
        this._masked = false;
        this._fin = false;
        this._opcode = 0;
        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._numFragments = 0;
        this._fragments = [];
        this._errored = false;
        this._loop = false;
        this._state = GET_INFO;
      }
      /**
       * Implements `Writable.prototype._write()`.
       *
       * @param {Buffer} chunk The chunk of data to write
       * @param {String} encoding The character encoding of `chunk`
       * @param {Function} cb Callback
       * @private
       */
      _write(chunk, encoding, cb) {
        if (this._opcode === 8 && this._state == GET_INFO) return cb();
        if (this._maxBufferedChunks > 0 && this._buffers.length >= this._maxBufferedChunks) {
          cb(
            this.createError(
              RangeError,
              "Too many buffered chunks",
              false,
              1008,
              "WS_ERR_TOO_MANY_BUFFERED_PARTS"
            )
          );
          return;
        }
        this._bufferedBytes += chunk.length;
        this._buffers.push(chunk);
        this.startLoop(cb);
      }
      /**
       * Consumes `n` bytes from the buffered data.
       *
       * @param {Number} n The number of bytes to consume
       * @return {Buffer} The consumed bytes
       * @private
       */
      consume(n) {
        this._bufferedBytes -= n;
        if (n === this._buffers[0].length) return this._buffers.shift();
        if (n < this._buffers[0].length) {
          const buf = this._buffers[0];
          this._buffers[0] = new FastBuffer(
            buf.buffer,
            buf.byteOffset + n,
            buf.length - n
          );
          return new FastBuffer(buf.buffer, buf.byteOffset, n);
        }
        const dst = Buffer.allocUnsafe(n);
        do {
          const buf = this._buffers[0];
          const offset = dst.length - n;
          if (n >= buf.length) {
            dst.set(this._buffers.shift(), offset);
          } else {
            dst.set(new Uint8Array(buf.buffer, buf.byteOffset, n), offset);
            this._buffers[0] = new FastBuffer(
              buf.buffer,
              buf.byteOffset + n,
              buf.length - n
            );
          }
          n -= buf.length;
        } while (n > 0);
        return dst;
      }
      /**
       * Starts the parsing loop.
       *
       * @param {Function} cb Callback
       * @private
       */
      startLoop(cb) {
        this._loop = true;
        do {
          switch (this._state) {
            case GET_INFO:
              this.getInfo(cb);
              break;
            case GET_PAYLOAD_LENGTH_16:
              this.getPayloadLength16(cb);
              break;
            case GET_PAYLOAD_LENGTH_64:
              this.getPayloadLength64(cb);
              break;
            case GET_MASK:
              this.getMask();
              break;
            case GET_DATA:
              this.getData(cb);
              break;
            case INFLATING:
            case DEFER_EVENT:
              this._loop = false;
              return;
          }
        } while (this._loop);
        if (!this._errored) cb();
      }
      /**
       * Reads the first two bytes of a frame.
       *
       * @param {Function} cb Callback
       * @private
       */
      getInfo(cb) {
        if (this._bufferedBytes < 2) {
          this._loop = false;
          return;
        }
        const buf = this.consume(2);
        if ((buf[0] & 48) !== 0) {
          const error = this.createError(
            RangeError,
            "RSV2 and RSV3 must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_RSV_2_3"
          );
          cb(error);
          return;
        }
        const compressed = (buf[0] & 64) === 64;
        if (compressed && !this._extensions[PerMessageDeflate2.extensionName]) {
          const error = this.createError(
            RangeError,
            "RSV1 must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_RSV_1"
          );
          cb(error);
          return;
        }
        this._fin = (buf[0] & 128) === 128;
        this._opcode = buf[0] & 15;
        this._payloadLength = buf[1] & 127;
        if (this._opcode === 0) {
          if (compressed) {
            const error = this.createError(
              RangeError,
              "RSV1 must be clear",
              true,
              1002,
              "WS_ERR_UNEXPECTED_RSV_1"
            );
            cb(error);
            return;
          }
          if (!this._fragmented) {
            const error = this.createError(
              RangeError,
              "invalid opcode 0",
              true,
              1002,
              "WS_ERR_INVALID_OPCODE"
            );
            cb(error);
            return;
          }
          this._opcode = this._fragmented;
        } else if (this._opcode === 1 || this._opcode === 2) {
          if (this._fragmented) {
            const error = this.createError(
              RangeError,
              `invalid opcode ${this._opcode}`,
              true,
              1002,
              "WS_ERR_INVALID_OPCODE"
            );
            cb(error);
            return;
          }
          this._compressed = compressed;
        } else if (this._opcode > 7 && this._opcode < 11) {
          if (!this._fin) {
            const error = this.createError(
              RangeError,
              "FIN must be set",
              true,
              1002,
              "WS_ERR_EXPECTED_FIN"
            );
            cb(error);
            return;
          }
          if (compressed) {
            const error = this.createError(
              RangeError,
              "RSV1 must be clear",
              true,
              1002,
              "WS_ERR_UNEXPECTED_RSV_1"
            );
            cb(error);
            return;
          }
          if (this._payloadLength > 125 || this._opcode === 8 && this._payloadLength === 1) {
            const error = this.createError(
              RangeError,
              `invalid payload length ${this._payloadLength}`,
              true,
              1002,
              "WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH"
            );
            cb(error);
            return;
          }
        } else {
          const error = this.createError(
            RangeError,
            `invalid opcode ${this._opcode}`,
            true,
            1002,
            "WS_ERR_INVALID_OPCODE"
          );
          cb(error);
          return;
        }
        if (!this._fin && !this._fragmented) this._fragmented = this._opcode;
        this._masked = (buf[1] & 128) === 128;
        if (this._isServer) {
          if (!this._masked) {
            const error = this.createError(
              RangeError,
              "MASK must be set",
              true,
              1002,
              "WS_ERR_EXPECTED_MASK"
            );
            cb(error);
            return;
          }
        } else if (this._masked) {
          const error = this.createError(
            RangeError,
            "MASK must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_MASK"
          );
          cb(error);
          return;
        }
        if (this._payloadLength === 126) this._state = GET_PAYLOAD_LENGTH_16;
        else if (this._payloadLength === 127) this._state = GET_PAYLOAD_LENGTH_64;
        else this.haveLength(cb);
      }
      /**
       * Gets extended payload length (7+16).
       *
       * @param {Function} cb Callback
       * @private
       */
      getPayloadLength16(cb) {
        if (this._bufferedBytes < 2) {
          this._loop = false;
          return;
        }
        this._payloadLength = this.consume(2).readUInt16BE(0);
        this.haveLength(cb);
      }
      /**
       * Gets extended payload length (7+64).
       *
       * @param {Function} cb Callback
       * @private
       */
      getPayloadLength64(cb) {
        if (this._bufferedBytes < 8) {
          this._loop = false;
          return;
        }
        const buf = this.consume(8);
        const num3 = buf.readUInt32BE(0);
        if (num3 > Math.pow(2, 53 - 32) - 1) {
          const error = this.createError(
            RangeError,
            "Unsupported WebSocket frame: payload length > 2^53 - 1",
            false,
            1009,
            "WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH"
          );
          cb(error);
          return;
        }
        this._payloadLength = num3 * Math.pow(2, 32) + buf.readUInt32BE(4);
        this.haveLength(cb);
      }
      /**
       * Payload length has been read.
       *
       * @param {Function} cb Callback
       * @private
       */
      haveLength(cb) {
        if (this._payloadLength && this._opcode < 8) {
          this._totalPayloadLength += this._payloadLength;
          if (this._totalPayloadLength > this._maxPayload && this._maxPayload > 0) {
            const error = this.createError(
              RangeError,
              "Max payload size exceeded",
              false,
              1009,
              "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
            );
            cb(error);
            return;
          }
        }
        if (this._masked) this._state = GET_MASK;
        else this._state = GET_DATA;
      }
      /**
       * Reads mask bytes.
       *
       * @private
       */
      getMask() {
        if (this._bufferedBytes < 4) {
          this._loop = false;
          return;
        }
        this._mask = this.consume(4);
        this._state = GET_DATA;
      }
      /**
       * Reads data bytes.
       *
       * @param {Function} cb Callback
       * @private
       */
      getData(cb) {
        let data = EMPTY_BUFFER;
        if (this._payloadLength) {
          if (this._bufferedBytes < this._payloadLength) {
            this._loop = false;
            return;
          }
          data = this.consume(this._payloadLength);
          if (this._masked && (this._mask[0] | this._mask[1] | this._mask[2] | this._mask[3]) !== 0) {
            unmask(data, this._mask);
          }
        }
        this._mask = void 0;
        if (this._opcode > 7) {
          this.controlMessage(data, cb);
          return;
        }
        if (this._maxFragments > 0 && ++this._numFragments > this._maxFragments) {
          const error = this.createError(
            RangeError,
            "Too many message fragments",
            false,
            1008,
            "WS_ERR_TOO_MANY_BUFFERED_PARTS"
          );
          cb(error);
          return;
        }
        if (this._compressed) {
          this._state = INFLATING;
          this.decompress(data, cb);
          return;
        }
        if (data.length) {
          this._messageLength = this._totalPayloadLength;
          this._fragments.push(data);
        }
        this.dataMessage(cb);
      }
      /**
       * Decompresses data.
       *
       * @param {Buffer} data Compressed data
       * @param {Function} cb Callback
       * @private
       */
      decompress(data, cb) {
        const perMessageDeflate = this._extensions[PerMessageDeflate2.extensionName];
        perMessageDeflate.decompress(data, this._fin, (err, buf) => {
          if (err) return cb(err);
          if (buf.length) {
            this._messageLength += buf.length;
            if (this._messageLength > this._maxPayload && this._maxPayload > 0) {
              const error = this.createError(
                RangeError,
                "Max payload size exceeded",
                false,
                1009,
                "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
              );
              cb(error);
              return;
            }
            this._fragments.push(buf);
          }
          this.dataMessage(cb);
          if (this._state === GET_INFO) this.startLoop(cb);
        });
      }
      /**
       * Handles a data message.
       *
       * @param {Function} cb Callback
       * @private
       */
      dataMessage(cb) {
        if (!this._fin) {
          this._state = GET_INFO;
          return;
        }
        const messageLength = this._messageLength;
        const fragments = this._fragments;
        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._fragmented = 0;
        this._numFragments = 0;
        this._fragments = [];
        if (this._opcode === 2) {
          let data;
          if (this._binaryType === "nodebuffer") {
            data = concat(fragments, messageLength);
          } else if (this._binaryType === "arraybuffer") {
            data = toArrayBuffer(concat(fragments, messageLength));
          } else if (this._binaryType === "blob") {
            data = new Blob(fragments);
          } else {
            data = fragments;
          }
          if (this._allowSynchronousEvents) {
            this.emit("message", data, true);
            this._state = GET_INFO;
          } else {
            this._state = DEFER_EVENT;
            setImmediate(() => {
              this.emit("message", data, true);
              this._state = GET_INFO;
              this.startLoop(cb);
            });
          }
        } else {
          const buf = concat(fragments, messageLength);
          if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
            const error = this.createError(
              Error,
              "invalid UTF-8 sequence",
              true,
              1007,
              "WS_ERR_INVALID_UTF8"
            );
            cb(error);
            return;
          }
          if (this._state === INFLATING || this._allowSynchronousEvents) {
            this.emit("message", buf, false);
            this._state = GET_INFO;
          } else {
            this._state = DEFER_EVENT;
            setImmediate(() => {
              this.emit("message", buf, false);
              this._state = GET_INFO;
              this.startLoop(cb);
            });
          }
        }
      }
      /**
       * Handles a control message.
       *
       * @param {Buffer} data Data to handle
       * @return {(Error|RangeError|undefined)} A possible error
       * @private
       */
      controlMessage(data, cb) {
        if (this._opcode === 8) {
          if (data.length === 0) {
            this._loop = false;
            this.emit("conclude", 1005, EMPTY_BUFFER);
            this.end();
          } else {
            const code = data.readUInt16BE(0);
            if (!isValidStatusCode(code)) {
              const error = this.createError(
                RangeError,
                `invalid status code ${code}`,
                true,
                1002,
                "WS_ERR_INVALID_CLOSE_CODE"
              );
              cb(error);
              return;
            }
            const buf = new FastBuffer(
              data.buffer,
              data.byteOffset + 2,
              data.length - 2
            );
            if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
              const error = this.createError(
                Error,
                "invalid UTF-8 sequence",
                true,
                1007,
                "WS_ERR_INVALID_UTF8"
              );
              cb(error);
              return;
            }
            this._loop = false;
            this.emit("conclude", code, buf);
            this.end();
          }
          this._state = GET_INFO;
          return;
        }
        if (this._allowSynchronousEvents) {
          this.emit(this._opcode === 9 ? "ping" : "pong", data);
          this._state = GET_INFO;
        } else {
          this._state = DEFER_EVENT;
          setImmediate(() => {
            this.emit(this._opcode === 9 ? "ping" : "pong", data);
            this._state = GET_INFO;
            this.startLoop(cb);
          });
        }
      }
      /**
       * Builds an error object.
       *
       * @param {function(new:Error|RangeError)} ErrorCtor The error constructor
       * @param {String} message The error message
       * @param {Boolean} prefix Specifies whether or not to add a default prefix to
       *     `message`
       * @param {Number} statusCode The status code
       * @param {String} errorCode The exposed error code
       * @return {(Error|RangeError)} The error
       * @private
       */
      createError(ErrorCtor, message, prefix, statusCode, errorCode) {
        this._loop = false;
        this._errored = true;
        const err = new ErrorCtor(
          prefix ? `Invalid WebSocket frame: ${message}` : message
        );
        Error.captureStackTrace(err, this.createError);
        err.code = errorCode;
        err[kStatusCode] = statusCode;
        return err;
      }
    };
    module.exports = Receiver2;
  }
});

// node_modules/ws/lib/sender.js
var require_sender = __commonJS({
  "node_modules/ws/lib/sender.js"(exports, module) {
    "use strict";
    var { Duplex } = __require("stream");
    var { randomFillSync } = __require("crypto");
    var {
      types: { isUint8Array }
    } = __require("util");
    var PerMessageDeflate2 = require_permessage_deflate();
    var { EMPTY_BUFFER, kWebSocket, NOOP } = require_constants();
    var { isBlob, isValidStatusCode } = require_validation();
    var { mask: applyMask, toBuffer } = require_buffer_util();
    var kByteLength = /* @__PURE__ */ Symbol("kByteLength");
    var maskBuffer = Buffer.alloc(4);
    var RANDOM_POOL_SIZE = 8 * 1024;
    var randomPool;
    var randomPoolPointer = RANDOM_POOL_SIZE;
    var DEFAULT = 0;
    var DEFLATING = 1;
    var GET_BLOB_DATA = 2;
    var Sender2 = class _Sender {
      /**
       * Creates a Sender instance.
       *
       * @param {Duplex} socket The connection socket
       * @param {Object} [extensions] An object containing the negotiated extensions
       * @param {Function} [generateMask] The function used to generate the masking
       *     key
       */
      constructor(socket, extensions, generateMask) {
        this._extensions = extensions || {};
        if (generateMask) {
          this._generateMask = generateMask;
          this._maskBuffer = Buffer.alloc(4);
        }
        this._socket = socket;
        this._firstFragment = true;
        this._compress = false;
        this._bufferedBytes = 0;
        this._queue = [];
        this._state = DEFAULT;
        this.onerror = NOOP;
        this[kWebSocket] = void 0;
      }
      /**
       * Frames a piece of data according to the HyBi WebSocket protocol.
       *
       * @param {(Buffer|String)} data The data to frame
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @return {(Buffer|String)[]} The framed data
       * @public
       */
      static frame(data, options) {
        let mask;
        let merge = false;
        let offset = 2;
        let skipMasking = false;
        if (options.mask) {
          mask = options.maskBuffer || maskBuffer;
          if (options.generateMask) {
            options.generateMask(mask);
          } else {
            if (randomPoolPointer === RANDOM_POOL_SIZE) {
              if (randomPool === void 0) {
                randomPool = Buffer.alloc(RANDOM_POOL_SIZE);
              }
              randomFillSync(randomPool, 0, RANDOM_POOL_SIZE);
              randomPoolPointer = 0;
            }
            mask[0] = randomPool[randomPoolPointer++];
            mask[1] = randomPool[randomPoolPointer++];
            mask[2] = randomPool[randomPoolPointer++];
            mask[3] = randomPool[randomPoolPointer++];
          }
          skipMasking = (mask[0] | mask[1] | mask[2] | mask[3]) === 0;
          offset = 6;
        }
        let dataLength;
        if (typeof data === "string") {
          if ((!options.mask || skipMasking) && options[kByteLength] !== void 0) {
            dataLength = options[kByteLength];
          } else {
            data = Buffer.from(data);
            dataLength = data.length;
          }
        } else {
          dataLength = data.length;
          merge = options.mask && options.readOnly && !skipMasking;
        }
        let payloadLength = dataLength;
        if (dataLength >= 65536) {
          offset += 8;
          payloadLength = 127;
        } else if (dataLength > 125) {
          offset += 2;
          payloadLength = 126;
        }
        const target = Buffer.allocUnsafe(merge ? dataLength + offset : offset);
        target[0] = options.fin ? options.opcode | 128 : options.opcode;
        if (options.rsv1) target[0] |= 64;
        target[1] = payloadLength;
        if (payloadLength === 126) {
          target.writeUInt16BE(dataLength, 2);
        } else if (payloadLength === 127) {
          target[2] = target[3] = 0;
          target.writeUIntBE(dataLength, 4, 6);
        }
        if (!options.mask) {
          return dataLength ? [target, data] : [target];
        }
        target[1] |= 128;
        target[offset - 4] = mask[0];
        target[offset - 3] = mask[1];
        target[offset - 2] = mask[2];
        target[offset - 1] = mask[3];
        if (!dataLength) return [target];
        if (skipMasking) return [target, data];
        if (merge) {
          applyMask(data, mask, target, offset, dataLength);
          return [target];
        }
        applyMask(data, mask, data, 0, dataLength);
        return [target, data];
      }
      /**
       * Sends a close message to the other peer.
       *
       * @param {Number} [code] The status code component of the body
       * @param {(String|Buffer)} [data] The message component of the body
       * @param {Boolean} [mask=false] Specifies whether or not to mask the message
       * @param {Function} [cb] Callback
       * @public
       */
      close(code, data, mask, cb) {
        let buf;
        if (code === void 0) {
          buf = EMPTY_BUFFER;
        } else if (typeof code !== "number" || !isValidStatusCode(code)) {
          throw new TypeError("First argument must be a valid error code number");
        } else if (data === void 0 || !data.length) {
          buf = Buffer.allocUnsafe(2);
          buf.writeUInt16BE(code, 0);
        } else {
          const length = Buffer.byteLength(data);
          if (length > 123) {
            throw new RangeError("The message must not be greater than 123 bytes");
          }
          buf = Buffer.allocUnsafe(2 + length);
          buf.writeUInt16BE(code, 0);
          if (typeof data === "string") {
            buf.write(data, 2);
          } else if (isUint8Array(data)) {
            buf.set(data, 2);
          } else {
            throw new TypeError("Second argument must be a string or a Uint8Array");
          }
        }
        const options = {
          [kByteLength]: buf.length,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 8,
          readOnly: false,
          rsv1: false
        };
        if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, buf, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(buf, options), cb);
        }
      }
      /**
       * Sends a ping message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback
       * @public
       */
      ping(data, mask, cb) {
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (byteLength > 125) {
          throw new RangeError("The data size must not be greater than 125 bytes");
        }
        const options = {
          [kByteLength]: byteLength,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 9,
          readOnly,
          rsv1: false
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, false, options, cb]);
          } else {
            this.getBlobData(data, false, options, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(data, options), cb);
        }
      }
      /**
       * Sends a pong message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback
       * @public
       */
      pong(data, mask, cb) {
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (byteLength > 125) {
          throw new RangeError("The data size must not be greater than 125 bytes");
        }
        const options = {
          [kByteLength]: byteLength,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 10,
          readOnly,
          rsv1: false
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, false, options, cb]);
          } else {
            this.getBlobData(data, false, options, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(data, options), cb);
        }
      }
      /**
       * Sends a data message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Object} options Options object
       * @param {Boolean} [options.binary=false] Specifies whether `data` is binary
       *     or text
       * @param {Boolean} [options.compress=false] Specifies whether or not to
       *     compress `data`
       * @param {Boolean} [options.fin=false] Specifies whether the fragment is the
       *     last one
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Function} [cb] Callback
       * @public
       */
      send(data, options, cb) {
        const perMessageDeflate = this._extensions[PerMessageDeflate2.extensionName];
        let opcode = options.binary ? 2 : 1;
        let rsv1 = options.compress;
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (this._firstFragment) {
          this._firstFragment = false;
          if (rsv1 && perMessageDeflate && perMessageDeflate.params[perMessageDeflate._isServer ? "server_no_context_takeover" : "client_no_context_takeover"]) {
            rsv1 = byteLength >= perMessageDeflate._threshold;
          }
          this._compress = rsv1;
        } else {
          rsv1 = false;
          opcode = 0;
        }
        if (options.fin) this._firstFragment = true;
        const opts = {
          [kByteLength]: byteLength,
          fin: options.fin,
          generateMask: this._generateMask,
          mask: options.mask,
          maskBuffer: this._maskBuffer,
          opcode,
          readOnly,
          rsv1
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, this._compress, opts, cb]);
          } else {
            this.getBlobData(data, this._compress, opts, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, this._compress, opts, cb]);
        } else {
          this.dispatch(data, this._compress, opts, cb);
        }
      }
      /**
       * Gets the contents of a blob as binary data.
       *
       * @param {Blob} blob The blob
       * @param {Boolean} [compress=false] Specifies whether or not to compress
       *     the data
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @param {Function} [cb] Callback
       * @private
       */
      getBlobData(blob, compress, options, cb) {
        this._bufferedBytes += options[kByteLength];
        this._state = GET_BLOB_DATA;
        blob.arrayBuffer().then((arrayBuffer) => {
          if (this._socket.destroyed) {
            const err = new Error(
              "The socket was closed while the blob was being read"
            );
            process.nextTick(callCallbacks, this, err, cb);
            return;
          }
          this._bufferedBytes -= options[kByteLength];
          const data = toBuffer(arrayBuffer);
          if (!compress) {
            this._state = DEFAULT;
            this.sendFrame(_Sender.frame(data, options), cb);
            this.dequeue();
          } else {
            this.dispatch(data, compress, options, cb);
          }
        }).catch((err) => {
          process.nextTick(onError, this, err, cb);
        });
      }
      /**
       * Dispatches a message.
       *
       * @param {(Buffer|String)} data The message to send
       * @param {Boolean} [compress=false] Specifies whether or not to compress
       *     `data`
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @param {Function} [cb] Callback
       * @private
       */
      dispatch(data, compress, options, cb) {
        if (!compress) {
          this.sendFrame(_Sender.frame(data, options), cb);
          return;
        }
        const perMessageDeflate = this._extensions[PerMessageDeflate2.extensionName];
        this._bufferedBytes += options[kByteLength];
        this._state = DEFLATING;
        perMessageDeflate.compress(data, options.fin, (_, buf) => {
          if (this._socket.destroyed) {
            const err = new Error(
              "The socket was closed while data was being compressed"
            );
            callCallbacks(this, err, cb);
            return;
          }
          this._bufferedBytes -= options[kByteLength];
          this._state = DEFAULT;
          options.readOnly = false;
          this.sendFrame(_Sender.frame(buf, options), cb);
          this.dequeue();
        });
      }
      /**
       * Executes queued send operations.
       *
       * @private
       */
      dequeue() {
        while (this._state === DEFAULT && this._queue.length) {
          const params = this._queue.shift();
          this._bufferedBytes -= params[3][kByteLength];
          Reflect.apply(params[0], this, params.slice(1));
        }
      }
      /**
       * Enqueues a send operation.
       *
       * @param {Array} params Send operation parameters.
       * @private
       */
      enqueue(params) {
        this._bufferedBytes += params[3][kByteLength];
        this._queue.push(params);
      }
      /**
       * Sends a frame.
       *
       * @param {(Buffer | String)[]} list The frame to send
       * @param {Function} [cb] Callback
       * @private
       */
      sendFrame(list, cb) {
        if (list.length === 2) {
          this._socket.cork();
          this._socket.write(list[0]);
          this._socket.write(list[1], cb);
          this._socket.uncork();
        } else {
          this._socket.write(list[0], cb);
        }
      }
    };
    module.exports = Sender2;
    function callCallbacks(sender, err, cb) {
      if (typeof cb === "function") cb(err);
      for (let i = 0; i < sender._queue.length; i++) {
        const params = sender._queue[i];
        const callback = params[params.length - 1];
        if (typeof callback === "function") callback(err);
      }
    }
    function onError(sender, err, cb) {
      callCallbacks(sender, err, cb);
      sender.onerror(err);
    }
  }
});

// node_modules/ws/lib/event-target.js
var require_event_target = __commonJS({
  "node_modules/ws/lib/event-target.js"(exports, module) {
    "use strict";
    var { kForOnEventAttribute, kListener } = require_constants();
    var kCode = /* @__PURE__ */ Symbol("kCode");
    var kData = /* @__PURE__ */ Symbol("kData");
    var kError = /* @__PURE__ */ Symbol("kError");
    var kMessage = /* @__PURE__ */ Symbol("kMessage");
    var kReason = /* @__PURE__ */ Symbol("kReason");
    var kTarget = /* @__PURE__ */ Symbol("kTarget");
    var kType = /* @__PURE__ */ Symbol("kType");
    var kWasClean = /* @__PURE__ */ Symbol("kWasClean");
    var Event = class {
      /**
       * Create a new `Event`.
       *
       * @param {String} type The name of the event
       * @throws {TypeError} If the `type` argument is not specified
       */
      constructor(type) {
        this[kTarget] = null;
        this[kType] = type;
      }
      /**
       * @type {*}
       */
      get target() {
        return this[kTarget];
      }
      /**
       * @type {String}
       */
      get type() {
        return this[kType];
      }
    };
    Object.defineProperty(Event.prototype, "target", { enumerable: true });
    Object.defineProperty(Event.prototype, "type", { enumerable: true });
    var CloseEvent = class extends Event {
      /**
       * Create a new `CloseEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {Number} [options.code=0] The status code explaining why the
       *     connection was closed
       * @param {String} [options.reason=''] A human-readable string explaining why
       *     the connection was closed
       * @param {Boolean} [options.wasClean=false] Indicates whether or not the
       *     connection was cleanly closed
       */
      constructor(type, options = {}) {
        super(type);
        this[kCode] = options.code === void 0 ? 0 : options.code;
        this[kReason] = options.reason === void 0 ? "" : options.reason;
        this[kWasClean] = options.wasClean === void 0 ? false : options.wasClean;
      }
      /**
       * @type {Number}
       */
      get code() {
        return this[kCode];
      }
      /**
       * @type {String}
       */
      get reason() {
        return this[kReason];
      }
      /**
       * @type {Boolean}
       */
      get wasClean() {
        return this[kWasClean];
      }
    };
    Object.defineProperty(CloseEvent.prototype, "code", { enumerable: true });
    Object.defineProperty(CloseEvent.prototype, "reason", { enumerable: true });
    Object.defineProperty(CloseEvent.prototype, "wasClean", { enumerable: true });
    var ErrorEvent = class extends Event {
      /**
       * Create a new `ErrorEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {*} [options.error=null] The error that generated this event
       * @param {String} [options.message=''] The error message
       */
      constructor(type, options = {}) {
        super(type);
        this[kError] = options.error === void 0 ? null : options.error;
        this[kMessage] = options.message === void 0 ? "" : options.message;
      }
      /**
       * @type {*}
       */
      get error() {
        return this[kError];
      }
      /**
       * @type {String}
       */
      get message() {
        return this[kMessage];
      }
    };
    Object.defineProperty(ErrorEvent.prototype, "error", { enumerable: true });
    Object.defineProperty(ErrorEvent.prototype, "message", { enumerable: true });
    var MessageEvent = class extends Event {
      /**
       * Create a new `MessageEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {*} [options.data=null] The message content
       */
      constructor(type, options = {}) {
        super(type);
        this[kData] = options.data === void 0 ? null : options.data;
      }
      /**
       * @type {*}
       */
      get data() {
        return this[kData];
      }
    };
    Object.defineProperty(MessageEvent.prototype, "data", { enumerable: true });
    var EventTarget = {
      /**
       * Register an event listener.
       *
       * @param {String} type A string representing the event type to listen for
       * @param {(Function|Object)} handler The listener to add
       * @param {Object} [options] An options object specifies characteristics about
       *     the event listener
       * @param {Boolean} [options.once=false] A `Boolean` indicating that the
       *     listener should be invoked at most once after being added. If `true`,
       *     the listener would be automatically removed when invoked.
       * @public
       */
      addEventListener(type, handler, options = {}) {
        for (const listener of this.listeners(type)) {
          if (!options[kForOnEventAttribute] && listener[kListener] === handler && !listener[kForOnEventAttribute]) {
            return;
          }
        }
        let wrapper;
        if (type === "message") {
          wrapper = function onMessage(data, isBinary) {
            const event = new MessageEvent("message", {
              data: isBinary ? data : data.toString()
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "close") {
          wrapper = function onClose(code, message) {
            const event = new CloseEvent("close", {
              code,
              reason: message.toString(),
              wasClean: this._closeFrameReceived && this._closeFrameSent
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "error") {
          wrapper = function onError(error) {
            const event = new ErrorEvent("error", {
              error,
              message: error.message
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "open") {
          wrapper = function onOpen() {
            const event = new Event("open");
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else {
          return;
        }
        wrapper[kForOnEventAttribute] = !!options[kForOnEventAttribute];
        wrapper[kListener] = handler;
        if (options.once) {
          this.once(type, wrapper);
        } else {
          this.on(type, wrapper);
        }
      },
      /**
       * Remove an event listener.
       *
       * @param {String} type A string representing the event type to remove
       * @param {(Function|Object)} handler The listener to remove
       * @public
       */
      removeEventListener(type, handler) {
        for (const listener of this.listeners(type)) {
          if (listener[kListener] === handler && !listener[kForOnEventAttribute]) {
            this.removeListener(type, listener);
            break;
          }
        }
      }
    };
    module.exports = {
      CloseEvent,
      ErrorEvent,
      Event,
      EventTarget,
      MessageEvent
    };
    function callListener(listener, thisArg, event) {
      if (typeof listener === "object" && listener.handleEvent) {
        listener.handleEvent.call(listener, event);
      } else {
        listener.call(thisArg, event);
      }
    }
  }
});

// node_modules/ws/lib/extension.js
var require_extension = __commonJS({
  "node_modules/ws/lib/extension.js"(exports, module) {
    "use strict";
    var { tokenChars } = require_validation();
    function push(dest, name, elem) {
      if (dest[name] === void 0) dest[name] = [elem];
      else dest[name].push(elem);
    }
    function parse(header) {
      const offers = /* @__PURE__ */ Object.create(null);
      let params = /* @__PURE__ */ Object.create(null);
      let mustUnescape = false;
      let isEscaping = false;
      let inQuotes = false;
      let extensionName;
      let paramName;
      let start = -1;
      let code = -1;
      let end = -1;
      let i = 0;
      for (; i < header.length; i++) {
        code = header.charCodeAt(i);
        if (extensionName === void 0) {
          if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (i !== 0 && (code === 32 || code === 9)) {
            if (end === -1 && start !== -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            const name = header.slice(start, end);
            if (code === 44) {
              push(offers, name, params);
              params = /* @__PURE__ */ Object.create(null);
            } else {
              extensionName = name;
            }
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else if (paramName === void 0) {
          if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (code === 32 || code === 9) {
            if (end === -1 && start !== -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            push(params, header.slice(start, end), true);
            if (code === 44) {
              push(offers, extensionName, params);
              params = /* @__PURE__ */ Object.create(null);
              extensionName = void 0;
            }
            start = end = -1;
          } else if (code === 61 && start !== -1 && end === -1) {
            paramName = header.slice(start, i);
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else {
          if (isEscaping) {
            if (tokenChars[code] !== 1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (start === -1) start = i;
            else if (!mustUnescape) mustUnescape = true;
            isEscaping = false;
          } else if (inQuotes) {
            if (tokenChars[code] === 1) {
              if (start === -1) start = i;
            } else if (code === 34 && start !== -1) {
              inQuotes = false;
              end = i;
            } else if (code === 92) {
              isEscaping = true;
            } else {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
          } else if (code === 34 && header.charCodeAt(i - 1) === 61) {
            inQuotes = true;
          } else if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (start !== -1 && (code === 32 || code === 9)) {
            if (end === -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            let value = header.slice(start, end);
            if (mustUnescape) {
              value = value.replace(/\\/g, "");
              mustUnescape = false;
            }
            push(params, paramName, value);
            if (code === 44) {
              push(offers, extensionName, params);
              params = /* @__PURE__ */ Object.create(null);
              extensionName = void 0;
            }
            paramName = void 0;
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        }
      }
      if (start === -1 || inQuotes || code === 32 || code === 9) {
        throw new SyntaxError("Unexpected end of input");
      }
      if (end === -1) end = i;
      const token = header.slice(start, end);
      if (extensionName === void 0) {
        push(offers, token, params);
      } else {
        if (paramName === void 0) {
          push(params, token, true);
        } else if (mustUnescape) {
          push(params, paramName, token.replace(/\\/g, ""));
        } else {
          push(params, paramName, token);
        }
        push(offers, extensionName, params);
      }
      return offers;
    }
    function format(extensions) {
      return Object.keys(extensions).map((extension2) => {
        let configurations = extensions[extension2];
        if (!Array.isArray(configurations)) configurations = [configurations];
        return configurations.map((params) => {
          return [extension2].concat(
            Object.keys(params).map((k) => {
              let values = params[k];
              if (!Array.isArray(values)) values = [values];
              return values.map((v) => v === true ? k : `${k}=${v}`).join("; ");
            })
          ).join("; ");
        }).join(", ");
      }).join(", ");
    }
    module.exports = { format, parse };
  }
});

// node_modules/ws/lib/websocket.js
var require_websocket = __commonJS({
  "node_modules/ws/lib/websocket.js"(exports, module) {
    "use strict";
    var EventEmitter2 = __require("events");
    var https = __require("https");
    var http = __require("http");
    var net = __require("net");
    var querystring = __require("querystring");
    var tls = __require("tls");
    var { randomBytes: randomBytes2, createHash: createHash2 } = __require("crypto");
    var { Duplex, Readable } = __require("stream");
    var { URL: URL2 } = __require("url");
    var PerMessageDeflate2 = require_permessage_deflate();
    var Receiver2 = require_receiver();
    var Sender2 = require_sender();
    var { isBlob } = require_validation();
    var {
      BINARY_TYPES,
      CLOSE_TIMEOUT,
      EMPTY_BUFFER,
      GUID,
      kForOnEventAttribute,
      kListener,
      kStatusCode,
      kWebSocket,
      NOOP
    } = require_constants();
    var {
      EventTarget: { addEventListener, removeEventListener }
    } = require_event_target();
    var { format, parse } = require_extension();
    var { toBuffer } = require_buffer_util();
    var kAborted = /* @__PURE__ */ Symbol("kAborted");
    var protocolVersions = [8, 13];
    var readyStates = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];
    var subprotocolRegex = /^[!#$%&'*+\-.0-9A-Z^_`|a-z~]+$/;
    var WebSocket2 = class _WebSocket extends EventEmitter2 {
      /**
       * Create a new `WebSocket`.
       *
       * @param {(String|URL)} address The URL to which to connect
       * @param {(String|String[])} [protocols] The subprotocols
       * @param {Object} [options] Connection options
       */
      constructor(address, protocols, options) {
        super();
        this._binaryType = BINARY_TYPES[0];
        this._closeCode = 1006;
        this._closeFrameReceived = false;
        this._closeFrameSent = false;
        this._closeMessage = EMPTY_BUFFER;
        this._closeTimer = null;
        this._errorEmitted = false;
        this._extensions = {};
        this._paused = false;
        this._protocol = "";
        this._readyState = _WebSocket.CONNECTING;
        this._receiver = null;
        this._sender = null;
        this._socket = null;
        if (address !== null) {
          this._bufferedAmount = 0;
          this._isServer = false;
          this._redirects = 0;
          if (protocols === void 0) {
            if (!options || options.protocols === void 0) {
              protocols = [];
            } else if (Array.isArray(options.protocols)) {
              protocols = options.protocols;
            } else {
              protocols = [options.protocols];
            }
          } else if (!Array.isArray(protocols)) {
            if (typeof protocols === "object" && protocols !== null) {
              options = protocols;
              if (options.protocols === void 0) {
                protocols = [];
              } else if (Array.isArray(options.protocols)) {
                protocols = options.protocols;
              } else {
                protocols = [options.protocols];
              }
            } else {
              protocols = [protocols];
            }
          }
          options = initAsClient(this, address, protocols, options);
        } else {
          this._isServer = true;
        }
        if (options.autoPong) {
          this._autoPong = true;
          this._autoPongComplete = () => autoPongComplete(this);
          this._pendingAutoPongs = 0;
          this._maxPendingAutoPongs = options.maxPendingAutoPongs | 0;
        }
        this._closeTimeout = options.closeTimeout;
      }
      /**
       * For historical reasons, the custom "nodebuffer" type is used by the default
       * instead of "blob".
       *
       * @type {String}
       */
      get binaryType() {
        return this._binaryType;
      }
      set binaryType(type) {
        if (!BINARY_TYPES.includes(type)) return;
        this._binaryType = type;
        if (this._receiver) this._receiver._binaryType = type;
      }
      /**
       * @type {Number}
       */
      get bufferedAmount() {
        if (!this._socket) return this._bufferedAmount;
        return this._socket._writableState.length + this._sender._bufferedBytes;
      }
      /**
       * @type {String}
       */
      get extensions() {
        return Object.keys(this._extensions).join();
      }
      /**
       * @type {Boolean}
       */
      get isPaused() {
        return this._paused;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onclose() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onerror() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onopen() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onmessage() {
        return null;
      }
      /**
       * @type {String}
       */
      get protocol() {
        return this._protocol;
      }
      /**
       * @type {Number}
       */
      get readyState() {
        return this._readyState;
      }
      /**
       * @type {String}
       */
      get url() {
        return this._url;
      }
      /**
       * Set up the socket and the internal resources.
       *
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Object} options Options object
       * @param {Boolean} [options.allowSynchronousEvents=false] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Number} [options.maxBufferedChunks=0] The maximum number of
       *     buffered data chunks
       * @param {Number} [options.maxFragments=0] The maximum number of message
       *     fragments
       * @param {Number} [options.maxPayload=0] The maximum allowed message size
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       * @private
       */
      setSocket(socket, head, options) {
        const receiver = new Receiver2({
          allowSynchronousEvents: options.allowSynchronousEvents,
          binaryType: this.binaryType,
          extensions: this._extensions,
          isServer: this._isServer,
          maxBufferedChunks: options.maxBufferedChunks,
          maxFragments: options.maxFragments,
          maxPayload: options.maxPayload,
          skipUTF8Validation: options.skipUTF8Validation
        });
        const sender = new Sender2(socket, this._extensions, options.generateMask);
        this._receiver = receiver;
        this._sender = sender;
        this._socket = socket;
        receiver[kWebSocket] = this;
        sender[kWebSocket] = this;
        socket[kWebSocket] = this;
        receiver.on("conclude", receiverOnConclude);
        receiver.on("drain", receiverOnDrain);
        receiver.on("error", receiverOnError);
        receiver.on("message", receiverOnMessage);
        receiver.on("ping", receiverOnPing);
        receiver.on("pong", receiverOnPong);
        sender.onerror = senderOnError;
        if (socket.setTimeout) socket.setTimeout(0);
        if (socket.setNoDelay) socket.setNoDelay();
        if (head.length > 0) socket.unshift(head);
        socket.on("close", socketOnClose);
        socket.on("data", socketOnData);
        socket.on("end", socketOnEnd);
        socket.on("error", socketOnError);
        this._readyState = _WebSocket.OPEN;
        this.emit("open");
      }
      /**
       * Emit the `'close'` event.
       *
       * @private
       */
      emitClose() {
        if (!this._socket) {
          this._readyState = _WebSocket.CLOSED;
          this.emit("close", this._closeCode, this._closeMessage);
          return;
        }
        if (this._extensions[PerMessageDeflate2.extensionName]) {
          this._extensions[PerMessageDeflate2.extensionName].cleanup();
        }
        this._receiver.removeAllListeners();
        this._readyState = _WebSocket.CLOSED;
        this.emit("close", this._closeCode, this._closeMessage);
      }
      /**
       * Start a closing handshake.
       *
       *          +----------+   +-----------+   +----------+
       *     - - -|ws.close()|-->|close frame|-->|ws.close()|- - -
       *    |     +----------+   +-----------+   +----------+     |
       *          +----------+   +-----------+         |
       * CLOSING  |ws.close()|<--|close frame|<--+-----+       CLOSING
       *          +----------+   +-----------+   |
       *    |           |                        |   +---+        |
       *                +------------------------+-->|fin| - - - -
       *    |         +---+                      |   +---+
       *     - - - - -|fin|<---------------------+
       *              +---+
       *
       * @param {Number} [code] Status code explaining why the connection is closing
       * @param {(String|Buffer)} [data] The reason why the connection is
       *     closing
       * @public
       */
      close(code, data) {
        if (this.readyState === _WebSocket.CLOSED) return;
        if (this.readyState === _WebSocket.CONNECTING) {
          const msg = "WebSocket was closed before the connection was established";
          abortHandshake(this, this._req, msg);
          return;
        }
        if (this.readyState === _WebSocket.CLOSING) {
          if (this._closeFrameSent && (this._closeFrameReceived || this._receiver._writableState.errorEmitted)) {
            this._socket.end();
          }
          return;
        }
        this._sender.close(code, data, !this._isServer, (err) => {
          if (err) return;
          this._closeFrameSent = true;
          if (this._closeFrameReceived || this._receiver._writableState.errorEmitted) {
            this._socket.end();
          }
        });
        this._readyState = _WebSocket.CLOSING;
        setCloseTimer(this);
      }
      /**
       * Pause the socket.
       *
       * @public
       */
      pause() {
        if (this.readyState === _WebSocket.CONNECTING || this.readyState === _WebSocket.CLOSED) {
          return;
        }
        this._paused = true;
        this._socket.pause();
      }
      /**
       * Send a ping.
       *
       * @param {*} [data] The data to send
       * @param {Boolean} [mask] Indicates whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when the ping is sent
       * @public
       */
      ping(data, mask, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof data === "function") {
          cb = data;
          data = mask = void 0;
        } else if (typeof mask === "function") {
          cb = mask;
          mask = void 0;
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        if (mask === void 0) mask = !this._isServer;
        this._sender.ping(data || EMPTY_BUFFER, mask, cb);
      }
      /**
       * Send a pong.
       *
       * @param {*} [data] The data to send
       * @param {Boolean} [mask] Indicates whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when the pong is sent
       * @public
       */
      pong(data, mask, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof data === "function") {
          cb = data;
          data = mask = void 0;
        } else if (typeof mask === "function") {
          cb = mask;
          mask = void 0;
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        if (mask === void 0) mask = !this._isServer;
        this._sender.pong(data || EMPTY_BUFFER, mask, cb);
      }
      /**
       * Resume the socket.
       *
       * @public
       */
      resume() {
        if (this.readyState === _WebSocket.CONNECTING || this.readyState === _WebSocket.CLOSED) {
          return;
        }
        this._paused = false;
        if (!this._receiver._writableState.needDrain) this._socket.resume();
      }
      /**
       * Send a data message.
       *
       * @param {*} data The message to send
       * @param {Object} [options] Options object
       * @param {Boolean} [options.binary] Specifies whether `data` is binary or
       *     text
       * @param {Boolean} [options.compress] Specifies whether or not to compress
       *     `data`
       * @param {Boolean} [options.fin=true] Specifies whether the fragment is the
       *     last one
       * @param {Boolean} [options.mask] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when data is written out
       * @public
       */
      send(data, options, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof options === "function") {
          cb = options;
          options = {};
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        const opts = {
          binary: typeof data !== "string",
          mask: !this._isServer,
          compress: true,
          fin: true,
          ...options
        };
        if (!this._extensions[PerMessageDeflate2.extensionName]) {
          opts.compress = false;
        }
        this._sender.send(data || EMPTY_BUFFER, opts, cb);
      }
      /**
       * Forcibly close the connection.
       *
       * @public
       */
      terminate() {
        if (this.readyState === _WebSocket.CLOSED) return;
        if (this.readyState === _WebSocket.CONNECTING) {
          const msg = "WebSocket was closed before the connection was established";
          abortHandshake(this, this._req, msg);
          return;
        }
        if (this._socket) {
          this._readyState = _WebSocket.CLOSING;
          this._socket.destroy();
        }
      }
    };
    Object.defineProperty(WebSocket2, "CONNECTING", {
      enumerable: true,
      value: readyStates.indexOf("CONNECTING")
    });
    Object.defineProperty(WebSocket2.prototype, "CONNECTING", {
      enumerable: true,
      value: readyStates.indexOf("CONNECTING")
    });
    Object.defineProperty(WebSocket2, "OPEN", {
      enumerable: true,
      value: readyStates.indexOf("OPEN")
    });
    Object.defineProperty(WebSocket2.prototype, "OPEN", {
      enumerable: true,
      value: readyStates.indexOf("OPEN")
    });
    Object.defineProperty(WebSocket2, "CLOSING", {
      enumerable: true,
      value: readyStates.indexOf("CLOSING")
    });
    Object.defineProperty(WebSocket2.prototype, "CLOSING", {
      enumerable: true,
      value: readyStates.indexOf("CLOSING")
    });
    Object.defineProperty(WebSocket2, "CLOSED", {
      enumerable: true,
      value: readyStates.indexOf("CLOSED")
    });
    Object.defineProperty(WebSocket2.prototype, "CLOSED", {
      enumerable: true,
      value: readyStates.indexOf("CLOSED")
    });
    [
      "binaryType",
      "bufferedAmount",
      "extensions",
      "isPaused",
      "protocol",
      "readyState",
      "url"
    ].forEach((property) => {
      Object.defineProperty(WebSocket2.prototype, property, { enumerable: true });
    });
    ["open", "error", "close", "message"].forEach((method) => {
      Object.defineProperty(WebSocket2.prototype, `on${method}`, {
        enumerable: true,
        get() {
          for (const listener of this.listeners(method)) {
            if (listener[kForOnEventAttribute]) return listener[kListener];
          }
          return null;
        },
        set(handler) {
          for (const listener of this.listeners(method)) {
            if (listener[kForOnEventAttribute]) {
              this.removeListener(method, listener);
              break;
            }
          }
          if (typeof handler !== "function") return;
          this.addEventListener(method, handler, {
            [kForOnEventAttribute]: true
          });
        }
      });
    });
    WebSocket2.prototype.addEventListener = addEventListener;
    WebSocket2.prototype.removeEventListener = removeEventListener;
    module.exports = WebSocket2;
    function initAsClient(websocket, address, protocols, options) {
      const opts = {
        allowSynchronousEvents: true,
        autoPong: true,
        closeTimeout: CLOSE_TIMEOUT,
        protocolVersion: protocolVersions[1],
        maxBufferedChunks: 256 * 1024,
        maxFragments: 16 * 1024,
        maxPayload: 100 * 1024 * 1024,
        maxPendingAutoPongs: 60,
        skipUTF8Validation: false,
        perMessageDeflate: true,
        followRedirects: false,
        maxRedirects: 10,
        ...options,
        socketPath: void 0,
        hostname: void 0,
        protocol: void 0,
        protocols: void 0,
        timeout: void 0,
        method: "GET",
        host: void 0,
        path: void 0,
        port: void 0
      };
      if (!protocolVersions.includes(opts.protocolVersion)) {
        throw new RangeError(
          `Unsupported protocol version: ${opts.protocolVersion} (supported versions: ${protocolVersions.join(", ")})`
        );
      }
      let parsedUrl;
      if (address instanceof URL2) {
        parsedUrl = address;
      } else {
        try {
          parsedUrl = new URL2(address);
        } catch {
          throw new SyntaxError(`Invalid URL: ${address}`);
        }
      }
      if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
        parsedUrl = new URL2(parsedUrl);
        parsedUrl.protocol = parsedUrl.protocol === "http:" ? "ws:" : "wss:";
      }
      websocket._url = parsedUrl.href;
      const isSecure = parsedUrl.protocol === "wss:";
      const isIpcUrl = parsedUrl.protocol === "ws+unix:";
      let invalidUrlMessage;
      if (parsedUrl.protocol !== "ws:" && !isSecure && !isIpcUrl) {
        invalidUrlMessage = `The URL's protocol must be one of "ws:", "wss:", "http:", "https:", or "ws+unix:"`;
      } else if (isIpcUrl && !parsedUrl.pathname) {
        invalidUrlMessage = "The URL's pathname is empty";
      } else if (parsedUrl.hash) {
        invalidUrlMessage = "The URL contains a fragment identifier";
      }
      if (invalidUrlMessage) {
        const err = new SyntaxError(invalidUrlMessage);
        if (websocket._redirects === 0) {
          throw err;
        } else {
          emitErrorAndClose(websocket, err);
          return;
        }
      }
      const defaultPort = isSecure ? 443 : 80;
      const key = randomBytes2(16).toString("base64");
      const request = isSecure ? https.request : http.request;
      const protocolSet = /* @__PURE__ */ new Set();
      let perMessageDeflate;
      opts.createConnection = opts.createConnection || (isSecure ? tlsConnect : netConnect);
      opts.defaultPort = opts.defaultPort || defaultPort;
      opts.port = parsedUrl.port || defaultPort;
      opts.host = parsedUrl.hostname.startsWith("[") ? parsedUrl.hostname.slice(1, -1) : parsedUrl.hostname;
      opts.headers = {
        ...opts.headers,
        "Sec-WebSocket-Version": opts.protocolVersion,
        "Sec-WebSocket-Key": key,
        Connection: "Upgrade",
        Upgrade: "websocket"
      };
      opts.path = parsedUrl.pathname + parsedUrl.search;
      opts.timeout = opts.handshakeTimeout;
      if (opts.perMessageDeflate) {
        perMessageDeflate = new PerMessageDeflate2({
          ...opts.perMessageDeflate,
          isServer: false,
          maxPayload: opts.maxPayload
        });
        opts.headers["Sec-WebSocket-Extensions"] = format({
          [PerMessageDeflate2.extensionName]: perMessageDeflate.offer()
        });
      }
      if (protocols.length) {
        for (const protocol of protocols) {
          if (typeof protocol !== "string" || !subprotocolRegex.test(protocol) || protocolSet.has(protocol)) {
            throw new SyntaxError(
              "An invalid or duplicated subprotocol was specified"
            );
          }
          protocolSet.add(protocol);
        }
        opts.headers["Sec-WebSocket-Protocol"] = protocols.join(",");
      }
      if (opts.origin) {
        if (opts.protocolVersion < 13) {
          opts.headers["Sec-WebSocket-Origin"] = opts.origin;
        } else {
          opts.headers.Origin = opts.origin;
        }
      }
      if (parsedUrl.username || parsedUrl.password) {
        const username = querystring.unescape(parsedUrl.username);
        const password = querystring.unescape(parsedUrl.password);
        opts.auth = `${username}:${password}`;
      }
      if (isIpcUrl) {
        const i = opts.path.indexOf(":");
        if (i === -1) {
          opts.socketPath = opts.path;
          opts.path = "";
        } else {
          opts.socketPath = opts.path.slice(0, i);
          opts.path = opts.path.slice(i + 1);
        }
      }
      let req;
      if (opts.followRedirects) {
        if (websocket._redirects === 0) {
          websocket._originalIpc = isIpcUrl;
          websocket._originalSecure = isSecure;
          websocket._originalHostOrSocketPath = isIpcUrl ? opts.socketPath : parsedUrl.host;
          const headers = options && options.headers;
          options = { ...options, headers: {} };
          if (headers) {
            for (const [key2, value] of Object.entries(headers)) {
              options.headers[key2.toLowerCase()] = value;
            }
          }
        } else if (websocket.listenerCount("redirect") === 0) {
          const isSameHost = isIpcUrl ? websocket._originalIpc ? opts.socketPath === websocket._originalHostOrSocketPath : false : websocket._originalIpc ? false : parsedUrl.host === websocket._originalHostOrSocketPath;
          if (!isSameHost || websocket._originalSecure && !isSecure) {
            delete opts.headers.authorization;
            delete opts.headers.cookie;
            if (!isSameHost) delete opts.headers.host;
            opts.auth = void 0;
          }
        }
        if (opts.auth && !options.headers.authorization) {
          options.headers.authorization = "Basic " + Buffer.from(opts.auth).toString("base64");
        }
        req = websocket._req = request(opts);
        if (websocket._redirects) {
          websocket.emit("redirect", websocket.url, req);
        }
      } else {
        req = websocket._req = request(opts);
      }
      if (opts.timeout) {
        req.on("timeout", () => {
          abortHandshake(websocket, req, "Opening handshake has timed out");
        });
      }
      req.on("error", (err) => {
        if (req === null || req[kAborted]) return;
        req = websocket._req = null;
        emitErrorAndClose(websocket, err);
      });
      req.on("response", (res) => {
        const location = res.headers.location;
        const statusCode = res.statusCode;
        if (location && opts.followRedirects && statusCode >= 300 && statusCode < 400) {
          if (++websocket._redirects > opts.maxRedirects) {
            abortHandshake(websocket, req, "Maximum redirects exceeded");
            return;
          }
          req.abort();
          let addr;
          try {
            addr = new URL2(location, address);
          } catch (e) {
            const err = new SyntaxError(`Invalid URL: ${location}`);
            emitErrorAndClose(websocket, err);
            return;
          }
          initAsClient(websocket, addr, protocols, options);
        } else if (!websocket.emit("unexpected-response", req, res)) {
          abortHandshake(
            websocket,
            req,
            `Unexpected server response: ${res.statusCode}`
          );
        }
      });
      req.on("upgrade", (res, socket, head) => {
        websocket.emit("upgrade", res);
        if (websocket.readyState !== WebSocket2.CONNECTING) return;
        req = websocket._req = null;
        const upgrade = res.headers.upgrade;
        if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
          abortHandshake(websocket, socket, "Invalid Upgrade header");
          return;
        }
        const digest2 = createHash2("sha1").update(key + GUID).digest("base64");
        if (res.headers["sec-websocket-accept"] !== digest2) {
          abortHandshake(websocket, socket, "Invalid Sec-WebSocket-Accept header");
          return;
        }
        const serverProt = res.headers["sec-websocket-protocol"];
        let protError;
        if (serverProt !== void 0) {
          if (!protocolSet.size) {
            protError = "Server sent a subprotocol but none was requested";
          } else if (!protocolSet.has(serverProt)) {
            protError = "Server sent an invalid subprotocol";
          }
        } else if (protocolSet.size) {
          protError = "Server sent no subprotocol";
        }
        if (protError) {
          abortHandshake(websocket, socket, protError);
          return;
        }
        if (serverProt) websocket._protocol = serverProt;
        const secWebSocketExtensions = res.headers["sec-websocket-extensions"];
        if (secWebSocketExtensions !== void 0) {
          if (!perMessageDeflate) {
            const message = "Server sent a Sec-WebSocket-Extensions header but no extension was requested";
            abortHandshake(websocket, socket, message);
            return;
          }
          let extensions;
          try {
            extensions = parse(secWebSocketExtensions);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Extensions header";
            abortHandshake(websocket, socket, message);
            return;
          }
          const extensionNames = Object.keys(extensions);
          if (extensionNames.length !== 1 || extensionNames[0] !== PerMessageDeflate2.extensionName) {
            const message = "Server indicated an extension that was not requested";
            abortHandshake(websocket, socket, message);
            return;
          }
          try {
            perMessageDeflate.accept(extensions[PerMessageDeflate2.extensionName]);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Extensions header";
            abortHandshake(websocket, socket, message);
            return;
          }
          websocket._extensions[PerMessageDeflate2.extensionName] = perMessageDeflate;
        }
        websocket.setSocket(socket, head, {
          allowSynchronousEvents: opts.allowSynchronousEvents,
          generateMask: opts.generateMask,
          maxBufferedChunks: opts.maxBufferedChunks,
          maxFragments: opts.maxFragments,
          maxPayload: opts.maxPayload,
          skipUTF8Validation: opts.skipUTF8Validation
        });
      });
      if (opts.finishRequest) {
        opts.finishRequest(req, websocket);
      } else {
        req.end();
      }
      return opts;
    }
    function emitErrorAndClose(websocket, err) {
      websocket._readyState = WebSocket2.CLOSING;
      websocket._errorEmitted = true;
      websocket.emit("error", err);
      websocket.emitClose();
    }
    function netConnect(options) {
      options.path = options.socketPath;
      return net.connect(options);
    }
    function tlsConnect(options) {
      options.path = void 0;
      if (!options.servername && options.servername !== "") {
        options.servername = net.isIP(options.host) ? "" : options.host;
      }
      return tls.connect(options);
    }
    function abortHandshake(websocket, stream, message) {
      websocket._readyState = WebSocket2.CLOSING;
      const err = new Error(message);
      Error.captureStackTrace(err, abortHandshake);
      if (stream.setHeader) {
        stream[kAborted] = true;
        stream.abort();
        if (stream.socket && !stream.socket.destroyed) {
          stream.socket.destroy();
        }
        process.nextTick(emitErrorAndClose, websocket, err);
      } else {
        stream.destroy(err);
        stream.once("error", websocket.emit.bind(websocket, "error"));
        stream.once("close", websocket.emitClose.bind(websocket));
      }
    }
    function sendAfterClose(websocket, data, cb) {
      if (data) {
        const length = isBlob(data) ? data.size : toBuffer(data).length;
        if (websocket._socket) websocket._sender._bufferedBytes += length;
        else websocket._bufferedAmount += length;
      }
      if (cb) {
        const err = new Error(
          `WebSocket is not open: readyState ${websocket.readyState} (${readyStates[websocket.readyState]})`
        );
        process.nextTick(cb, err);
      }
    }
    function receiverOnConclude(code, reason) {
      const websocket = this[kWebSocket];
      websocket._closeFrameReceived = true;
      websocket._closeCode = code;
      if (reason.length === 0) {
        websocket._closeMessage = EMPTY_BUFFER;
      } else {
        websocket._closeMessage = Buffer.allocUnsafeSlow(reason.length);
        websocket._closeMessage.set(reason);
      }
      if (websocket._socket[kWebSocket] === void 0) return;
      websocket._socket.removeListener("data", socketOnData);
      process.nextTick(resume, websocket._socket);
      if (code === 1005) websocket.close();
      else websocket.close(code, reason);
    }
    function receiverOnDrain() {
      const websocket = this[kWebSocket];
      if (!websocket.isPaused) websocket._socket.resume();
    }
    function receiverOnError(err) {
      const websocket = this[kWebSocket];
      if (websocket._socket[kWebSocket] !== void 0) {
        websocket._socket.removeListener("data", socketOnData);
        process.nextTick(resume, websocket._socket);
        websocket.close(err[kStatusCode]);
      }
      if (!websocket._errorEmitted) {
        websocket._errorEmitted = true;
        websocket.emit("error", err);
      }
    }
    function receiverOnFinish() {
      this[kWebSocket].emitClose();
    }
    function receiverOnMessage(data, isBinary) {
      this[kWebSocket].emit("message", data, isBinary);
    }
    function receiverOnPing(data) {
      const websocket = this[kWebSocket];
      if (websocket._autoPong && websocket.readyState === WebSocket2.OPEN) {
        if (websocket._maxPendingAutoPongs > 0 && websocket._pendingAutoPongs >= websocket._maxPendingAutoPongs) {
          websocket.terminate();
        } else {
          websocket._pendingAutoPongs++;
          websocket.pong(data, !this._isServer, websocket._autoPongComplete);
        }
      }
      websocket.emit("ping", data);
    }
    function autoPongComplete(websocket) {
      websocket._pendingAutoPongs--;
    }
    function receiverOnPong(data) {
      this[kWebSocket].emit("pong", data);
    }
    function resume(stream) {
      stream.resume();
    }
    function senderOnError(err) {
      const websocket = this[kWebSocket];
      if (websocket.readyState === WebSocket2.CLOSED) return;
      if (websocket.readyState === WebSocket2.OPEN) {
        websocket._readyState = WebSocket2.CLOSING;
        setCloseTimer(websocket);
      }
      this._socket.end();
      if (!websocket._errorEmitted) {
        websocket._errorEmitted = true;
        websocket.emit("error", err);
      }
    }
    function setCloseTimer(websocket) {
      websocket._closeTimer = setTimeout(
        websocket._socket.destroy.bind(websocket._socket),
        websocket._closeTimeout
      );
    }
    function socketOnClose() {
      const websocket = this[kWebSocket];
      this.removeListener("close", socketOnClose);
      this.removeListener("data", socketOnData);
      this.removeListener("end", socketOnEnd);
      websocket._readyState = WebSocket2.CLOSING;
      if (!this._readableState.endEmitted && !websocket._closeFrameReceived && !websocket._receiver._writableState.errorEmitted && this._readableState.length !== 0) {
        const chunk = this.read(this._readableState.length);
        websocket._receiver.write(chunk);
      }
      websocket._receiver.end();
      this[kWebSocket] = void 0;
      clearTimeout(websocket._closeTimer);
      if (websocket._receiver._writableState.finished || websocket._receiver._writableState.errorEmitted) {
        websocket.emitClose();
      } else {
        websocket._receiver.on("error", receiverOnFinish);
        websocket._receiver.on("finish", receiverOnFinish);
      }
    }
    function socketOnData(chunk) {
      if (!this[kWebSocket]._receiver.write(chunk)) {
        this.pause();
      }
    }
    function socketOnEnd() {
      const websocket = this[kWebSocket];
      websocket._readyState = WebSocket2.CLOSING;
      websocket._receiver.end();
      this.end();
    }
    function socketOnError() {
      const websocket = this[kWebSocket];
      this.removeListener("error", socketOnError);
      this.on("error", NOOP);
      if (websocket) {
        websocket._readyState = WebSocket2.CLOSING;
        this.destroy();
      }
    }
  }
});

// node_modules/ws/lib/stream.js
var require_stream = __commonJS({
  "node_modules/ws/lib/stream.js"(exports, module) {
    "use strict";
    var WebSocket2 = require_websocket();
    var { Duplex } = __require("stream");
    function emitClose(stream) {
      stream.emit("close");
    }
    function duplexOnEnd() {
      if (!this.destroyed && this._writableState.finished) {
        this.destroy();
      }
    }
    function duplexOnError(err) {
      this.removeListener("error", duplexOnError);
      this.destroy();
      if (this.listenerCount("error") === 0) {
        this.emit("error", err);
      }
    }
    function createWebSocketStream2(ws, options) {
      let terminateOnDestroy = true;
      const duplex = new Duplex({
        ...options,
        autoDestroy: false,
        emitClose: false,
        objectMode: false,
        writableObjectMode: false
      });
      ws.on("message", function message(msg, isBinary) {
        const data = !isBinary && duplex._readableState.objectMode ? msg.toString() : msg;
        if (!duplex.push(data)) ws.pause();
      });
      ws.once("error", function error(err) {
        if (duplex.destroyed) return;
        terminateOnDestroy = false;
        duplex.destroy(err);
      });
      ws.once("close", function close() {
        if (duplex.destroyed) return;
        duplex.push(null);
      });
      duplex._destroy = function(err, callback) {
        if (ws.readyState === ws.CLOSED) {
          callback(err);
          process.nextTick(emitClose, duplex);
          return;
        }
        let called = false;
        ws.once("error", function error(err2) {
          called = true;
          callback(err2);
        });
        ws.once("close", function close() {
          if (!called) callback(err);
          process.nextTick(emitClose, duplex);
        });
        if (terminateOnDestroy) ws.terminate();
      };
      duplex._final = function(callback) {
        if (ws.readyState === ws.CONNECTING) {
          ws.once("open", function open3() {
            duplex._final(callback);
          });
          return;
        }
        if (ws._socket === null) return;
        if (ws._socket._writableState.finished) {
          callback();
          if (duplex._readableState.endEmitted) duplex.destroy();
        } else {
          ws._socket.once("finish", function finish() {
            callback();
          });
          ws.close();
        }
      };
      duplex._read = function() {
        if (ws.isPaused) ws.resume();
      };
      duplex._write = function(chunk, encoding, callback) {
        if (ws.readyState === ws.CONNECTING) {
          ws.once("open", function open3() {
            duplex._write(chunk, encoding, callback);
          });
          return;
        }
        ws.send(chunk, callback);
      };
      duplex.on("end", duplexOnEnd);
      duplex.on("error", duplexOnError);
      return duplex;
    }
    module.exports = createWebSocketStream2;
  }
});

// node_modules/ws/lib/subprotocol.js
var require_subprotocol = __commonJS({
  "node_modules/ws/lib/subprotocol.js"(exports, module) {
    "use strict";
    var { tokenChars } = require_validation();
    function parse(header) {
      const protocols = /* @__PURE__ */ new Set();
      let start = -1;
      let end = -1;
      let i = 0;
      for (i; i < header.length; i++) {
        const code = header.charCodeAt(i);
        if (end === -1 && tokenChars[code] === 1) {
          if (start === -1) start = i;
        } else if (i !== 0 && (code === 32 || code === 9)) {
          if (end === -1 && start !== -1) end = i;
        } else if (code === 44) {
          if (start === -1) {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
          if (end === -1) end = i;
          const protocol2 = header.slice(start, end);
          if (protocols.has(protocol2)) {
            throw new SyntaxError(`The "${protocol2}" subprotocol is duplicated`);
          }
          protocols.add(protocol2);
          start = end = -1;
        } else {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
      }
      if (start === -1 || end !== -1) {
        throw new SyntaxError("Unexpected end of input");
      }
      const protocol = header.slice(start, i);
      if (protocols.has(protocol)) {
        throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
      }
      protocols.add(protocol);
      return protocols;
    }
    module.exports = { parse };
  }
});

// node_modules/ws/lib/websocket-server.js
var require_websocket_server = __commonJS({
  "node_modules/ws/lib/websocket-server.js"(exports, module) {
    "use strict";
    var EventEmitter2 = __require("events");
    var http = __require("http");
    var { Duplex } = __require("stream");
    var { createHash: createHash2 } = __require("crypto");
    var extension2 = require_extension();
    var PerMessageDeflate2 = require_permessage_deflate();
    var subprotocol2 = require_subprotocol();
    var WebSocket2 = require_websocket();
    var { CLOSE_TIMEOUT, GUID, kWebSocket } = require_constants();
    var keyRegex = /^[+/0-9A-Za-z]{22}==$/;
    var RUNNING3 = 0;
    var CLOSING = 1;
    var CLOSED = 2;
    var WebSocketServer2 = class extends EventEmitter2 {
      /**
       * Create a `WebSocketServer` instance.
       *
       * @param {Object} options Configuration options
       * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {Boolean} [options.autoPong=true] Specifies whether or not to
       *     automatically send a pong in response to a ping
       * @param {Number} [options.backlog=511] The maximum length of the queue of
       *     pending connections
       * @param {Boolean} [options.clientTracking=true] Specifies whether or not to
       *     track clients
       * @param {Number} [options.closeTimeout=30000] Duration in milliseconds to
       *     wait for the closing handshake to finish after `websocket.close()` is
       *     called
       * @param {Function} [options.handleProtocols] A hook to handle protocols
       * @param {String} [options.host] The hostname where to bind the server
       * @param {Number} [options.maxBufferedChunks=262144] The maximum number of
       *     buffered data chunks
       * @param {Number} [options.maxFragments=16384] The maximum number of message
       *     fragments
       * @param {Number} [options.maxPayload=104857600] The maximum allowed message
       *     size
       * @param {Number} [options.maxPendingAutoPongs=60] The maximum number of
       *     pending automatic pongs
       * @param {Boolean} [options.noServer=false] Enable no server mode
       * @param {String} [options.path] Accept only connections matching this path
       * @param {(Boolean|Object)} [options.perMessageDeflate=false] Enable/disable
       *     permessage-deflate
       * @param {Number} [options.port] The port where to bind the server
       * @param {(http.Server|https.Server)} [options.server] A pre-created HTTP/S
       *     server to use
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       * @param {Function} [options.verifyClient] A hook to reject connections
       * @param {Function} [options.WebSocket=WebSocket] Specifies the `WebSocket`
       *     class to use. It must be the `WebSocket` class or class that extends it
       * @param {Function} [callback] A listener for the `listening` event
       */
      constructor(options, callback) {
        super();
        options = {
          allowSynchronousEvents: true,
          autoPong: true,
          maxBufferedChunks: 256 * 1024,
          maxFragments: 16 * 1024,
          maxPayload: 100 * 1024 * 1024,
          maxPendingAutoPongs: 60,
          skipUTF8Validation: false,
          perMessageDeflate: false,
          handleProtocols: null,
          clientTracking: true,
          closeTimeout: CLOSE_TIMEOUT,
          verifyClient: null,
          noServer: false,
          backlog: null,
          // use default (511 as implemented in net.js)
          server: null,
          host: null,
          path: null,
          port: null,
          WebSocket: WebSocket2,
          ...options
        };
        if (options.port == null && !options.server && !options.noServer || options.port != null && (options.server || options.noServer) || options.server && options.noServer) {
          throw new TypeError(
            'One and only one of the "port", "server", or "noServer" options must be specified'
          );
        }
        if (options.port != null) {
          this._server = http.createServer((req, res) => {
            const body = http.STATUS_CODES[426];
            res.writeHead(426, {
              "Content-Length": body.length,
              "Content-Type": "text/plain"
            });
            res.end(body);
          });
          this._server.listen(
            options.port,
            options.host,
            options.backlog,
            callback
          );
        } else if (options.server) {
          this._server = options.server;
        }
        if (this._server) {
          const emitConnection = this.emit.bind(this, "connection");
          this._removeListeners = addListeners(this._server, {
            listening: this.emit.bind(this, "listening"),
            error: this.emit.bind(this, "error"),
            upgrade: (req, socket, head) => {
              this.handleUpgrade(req, socket, head, emitConnection);
            }
          });
        }
        if (options.perMessageDeflate === true) options.perMessageDeflate = {};
        if (options.clientTracking) {
          this.clients = /* @__PURE__ */ new Set();
          this._shouldEmitClose = false;
        }
        this.options = options;
        this._state = RUNNING3;
      }
      /**
       * Returns the bound address, the address family name, and port of the server
       * as reported by the operating system if listening on an IP socket.
       * If the server is listening on a pipe or UNIX domain socket, the name is
       * returned as a string.
       *
       * @return {(Object|String|null)} The address of the server
       * @public
       */
      address() {
        if (this.options.noServer) {
          throw new Error('The server is operating in "noServer" mode');
        }
        if (!this._server) return null;
        return this._server.address();
      }
      /**
       * Stop the server from accepting new connections and emit the `'close'` event
       * when all existing connections are closed.
       *
       * @param {Function} [cb] A one-time listener for the `'close'` event
       * @public
       */
      close(cb) {
        if (this._state === CLOSED) {
          if (cb) {
            this.once("close", () => {
              cb(new Error("The server is not running"));
            });
          }
          process.nextTick(emitClose, this);
          return;
        }
        if (cb) this.once("close", cb);
        if (this._state === CLOSING) return;
        this._state = CLOSING;
        if (this.options.noServer || this.options.server) {
          if (this._server) {
            this._removeListeners();
            this._removeListeners = this._server = null;
          }
          if (this.clients) {
            if (!this.clients.size) {
              process.nextTick(emitClose, this);
            } else {
              this._shouldEmitClose = true;
            }
          } else {
            process.nextTick(emitClose, this);
          }
        } else {
          const server = this._server;
          this._removeListeners();
          this._removeListeners = this._server = null;
          server.close(() => {
            emitClose(this);
          });
        }
      }
      /**
       * See if a given request should be handled by this server instance.
       *
       * @param {http.IncomingMessage} req Request object to inspect
       * @return {Boolean} `true` if the request is valid, else `false`
       * @public
       */
      shouldHandle(req) {
        if (this.options.path) {
          const index = req.url.indexOf("?");
          const pathname = index !== -1 ? req.url.slice(0, index) : req.url;
          if (pathname !== this.options.path) return false;
        }
        return true;
      }
      /**
       * Handle a HTTP Upgrade request.
       *
       * @param {http.IncomingMessage} req The request object
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Function} cb Callback
       * @public
       */
      handleUpgrade(req, socket, head, cb) {
        socket.on("error", socketOnError);
        const key = req.headers["sec-websocket-key"];
        const upgrade = req.headers.upgrade;
        const version2 = +req.headers["sec-websocket-version"];
        if (req.method !== "GET") {
          const message = "Invalid HTTP method";
          abortHandshakeOrEmitwsClientError(this, req, socket, 405, message);
          return;
        }
        if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
          const message = "Invalid Upgrade header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
        if (key === void 0 || !keyRegex.test(key)) {
          const message = "Missing or invalid Sec-WebSocket-Key header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
        if (version2 !== 13 && version2 !== 8) {
          const message = "Missing or invalid Sec-WebSocket-Version header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message, {
            "Sec-WebSocket-Version": "13, 8"
          });
          return;
        }
        if (!this.shouldHandle(req)) {
          abortHandshake(socket, 400);
          return;
        }
        const secWebSocketProtocol = req.headers["sec-websocket-protocol"];
        let protocols = /* @__PURE__ */ new Set();
        if (secWebSocketProtocol !== void 0) {
          try {
            protocols = subprotocol2.parse(secWebSocketProtocol);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Protocol header";
            abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
            return;
          }
        }
        const secWebSocketExtensions = req.headers["sec-websocket-extensions"];
        const extensions = {};
        if (this.options.perMessageDeflate && secWebSocketExtensions !== void 0) {
          const perMessageDeflate = new PerMessageDeflate2({
            ...this.options.perMessageDeflate,
            isServer: true,
            maxPayload: this.options.maxPayload
          });
          try {
            const offers = extension2.parse(secWebSocketExtensions);
            if (offers[PerMessageDeflate2.extensionName]) {
              perMessageDeflate.accept(offers[PerMessageDeflate2.extensionName]);
              extensions[PerMessageDeflate2.extensionName] = perMessageDeflate;
            }
          } catch (err) {
            const message = "Invalid or unacceptable Sec-WebSocket-Extensions header";
            abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
            return;
          }
        }
        if (this.options.verifyClient) {
          const info = {
            origin: req.headers[`${version2 === 8 ? "sec-websocket-origin" : "origin"}`],
            secure: !!(req.socket.authorized || req.socket.encrypted),
            req
          };
          if (this.options.verifyClient.length === 2) {
            this.options.verifyClient(info, (verified, code, message, headers) => {
              if (!verified) {
                return abortHandshake(socket, code || 401, message, headers);
              }
              this.completeUpgrade(
                extensions,
                key,
                protocols,
                req,
                socket,
                head,
                cb
              );
            });
            return;
          }
          if (!this.options.verifyClient(info)) return abortHandshake(socket, 401);
        }
        this.completeUpgrade(extensions, key, protocols, req, socket, head, cb);
      }
      /**
       * Upgrade the connection to WebSocket.
       *
       * @param {Object} extensions The accepted extensions
       * @param {String} key The value of the `Sec-WebSocket-Key` header
       * @param {Set} protocols The subprotocols
       * @param {http.IncomingMessage} req The request object
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Function} cb Callback
       * @throws {Error} If called more than once with the same socket
       * @private
       */
      completeUpgrade(extensions, key, protocols, req, socket, head, cb) {
        if (!socket.readable || !socket.writable) return socket.destroy();
        if (socket[kWebSocket]) {
          throw new Error(
            "server.handleUpgrade() was called more than once with the same socket, possibly due to a misconfiguration"
          );
        }
        if (this._state > RUNNING3) return abortHandshake(socket, 503);
        const digest2 = createHash2("sha1").update(key + GUID).digest("base64");
        const headers = [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Accept: ${digest2}`
        ];
        const ws = new this.options.WebSocket(null, void 0, this.options);
        if (protocols.size) {
          const protocol = this.options.handleProtocols ? this.options.handleProtocols(protocols, req) : protocols.values().next().value;
          if (protocol) {
            headers.push(`Sec-WebSocket-Protocol: ${protocol}`);
            ws._protocol = protocol;
          }
        }
        if (extensions[PerMessageDeflate2.extensionName]) {
          const params = extensions[PerMessageDeflate2.extensionName].params;
          const value = extension2.format({
            [PerMessageDeflate2.extensionName]: [params]
          });
          headers.push(`Sec-WebSocket-Extensions: ${value}`);
          ws._extensions = extensions;
        }
        this.emit("headers", headers, req);
        socket.write(headers.concat("\r\n").join("\r\n"));
        socket.removeListener("error", socketOnError);
        ws.setSocket(socket, head, {
          allowSynchronousEvents: this.options.allowSynchronousEvents,
          maxBufferedChunks: this.options.maxBufferedChunks,
          maxFragments: this.options.maxFragments,
          maxPayload: this.options.maxPayload,
          skipUTF8Validation: this.options.skipUTF8Validation
        });
        if (this.clients) {
          this.clients.add(ws);
          ws.on("close", () => {
            this.clients.delete(ws);
            if (this._shouldEmitClose && !this.clients.size) {
              process.nextTick(emitClose, this);
            }
          });
        }
        cb(ws, req);
      }
    };
    module.exports = WebSocketServer2;
    function addListeners(server, map) {
      for (const event of Object.keys(map)) server.on(event, map[event]);
      return function removeListeners() {
        for (const event of Object.keys(map)) {
          server.removeListener(event, map[event]);
        }
      };
    }
    function emitClose(server) {
      server._state = CLOSED;
      server.emit("close");
    }
    function socketOnError() {
      this.destroy();
    }
    function abortHandshake(socket, code, message, headers) {
      message = message || http.STATUS_CODES[code];
      headers = {
        Connection: "close",
        "Content-Type": "text/html",
        "Content-Length": Buffer.byteLength(message),
        ...headers
      };
      socket.once("finish", socket.destroy);
      socket.end(
        `HTTP/1.1 ${code} ${http.STATUS_CODES[code]}\r
` + Object.keys(headers).map((h) => `${h}: ${headers[h]}`).join("\r\n") + "\r\n\r\n" + message
      );
    }
    function abortHandshakeOrEmitwsClientError(server, req, socket, code, message, headers) {
      if (server.listenerCount("wsClientError")) {
        const err = new Error(message);
        Error.captureStackTrace(err, abortHandshakeOrEmitwsClientError);
        server.emit("wsClientError", err, socket, req);
      } else {
        abortHandshake(socket, code, message, headers);
      }
    }
  }
});

// src/tracker/main.ts
import { rmSync, writeFileSync as writeFileSync3 } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { dirname as dirname2, join as join7 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// src/core/app.ts
import { join as join5 } from "node:path";
import { fileURLToPath } from "node:url";

// src/shared/config.ts
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
var DEFAULT_PORT = 47821;
var validPort = (p) => typeof p === "number" && Number.isInteger(p) && p > 0 && p <= 65535;
function salvagePort(text, parsed) {
  const p = typeof parsed === "object" && parsed !== null ? parsed.port : void 0;
  if (validPort(p)) return p;
  const m = /"port"\s*:\s*(\d{1,5})(?!\d)/.exec(text);
  const n = m ? Number(m[1]) : NaN;
  return validPort(n) ? n : void 0;
}
function readValid(file) {
  try {
    const p = JSON.parse(readFileSync(file, "utf8"));
    if (p && typeof p === "object" && validPort(p.port) && typeof p.token === "string" && p.token) return { port: p.port, token: p.token };
  } catch {
  }
  return void 0;
}
function createConfigFile(dir2, cfg) {
  const file = join(dir2, "config.json");
  mkdirSync(dir2, { recursive: true, mode: 448 });
  try {
    writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n", { mode: 384, flag: "wx" });
  } catch (err) {
    if (err.code === "EEXIST") return readValid(file);
    throw err;
  }
  chmodSync(file, 384);
  return cfg;
}
function loadOrCreateConfig(dir2 = join(homedir(), ".agent-office")) {
  const file = join(dir2, "config.json");
  let port = DEFAULT_PORT;
  if (!existsSync(file)) {
    const made = createConfigFile(dir2, { port, token: randomBytes(32).toString("hex") });
    if (made) return made;
  }
  let text = "";
  let parsed;
  try {
    text = readFileSync(file, "utf8");
    parsed = JSON.parse(text);
  } catch {
  }
  const p = typeof parsed === "object" && parsed !== null ? parsed : void 0;
  if (p && validPort(p.port) && typeof p.token === "string" && p.token) return { port: p.port, token: p.token };
  port = salvagePort(text, parsed) ?? DEFAULT_PORT;
  const cfg = { port, token: randomBytes(32).toString("hex") };
  mkdirSync(dir2, { recursive: true, mode: 448 });
  writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n", { mode: 384 });
  chmodSync(file, 384);
  return cfg;
}
function claudeDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
}

// src/server/eventServer.ts
import { createServer } from "node:http";

// src/core/usage.ts
import { mkdirSync as mkdirSync2, readdirSync, readFileSync as readFileSync2, renameSync, statSync, writeFileSync as writeFileSync2 } from "node:fs";
import { open } from "node:fs/promises";
import { join as join2 } from "node:path";

// src/core/pricing.ts
var MODELS = {
  "claude-fable-5-2": { inputPerM: 8, outputPerM: 40, cacheReadPerM: 0.2, cacheWritePerM: 16, cacheWrite5mPerM: 10, contextSize: 1e6 },
  "claude-fable-5-1": { inputPerM: 10, outputPerM: 50, cacheReadPerM: 0.25, cacheWritePerM: 20, cacheWrite5mPerM: 12.5, contextSize: 1e6 },
  "claude-opus-5-5": { inputPerM: 4, outputPerM: 20, cacheReadPerM: 0.2, cacheWritePerM: 8, cacheWrite5mPerM: 5, contextSize: 1e6 },
  "claude-sonnet-5-5": { inputPerM: 2, outputPerM: 10, cacheReadPerM: 0.1, cacheWritePerM: 4, cacheWrite5mPerM: 2.5, contextSize: 1e6 },
  "claude-sonnet-4-6": { inputPerM: 3, outputPerM: 15, cacheReadPerM: 0.3, cacheWritePerM: 6, cacheWrite5mPerM: 3.75, contextSize: 1e6 },
  "claude-haiku-5-5": {
    inputPerM: 0.1,
    outputPerM: 0.5,
    cacheReadPerM: 0.01,
    cacheWritePerM: 0.2,
    cacheWrite5mPerM: 0.125,
    contextSize: 1e6,
    long: { over: 1e5, inputPerM: 0.5, outputPerM: 2.5, cacheReadPerM: 0.05, cacheWritePerM: 1, cacheWrite5mPerM: 0.625 }
  }
};
function requestCost(model, u) {
  const m = lookup(model);
  if (!m) return null;
  const prompt = u.input + u.cacheRead + u.write5m + u.write1h;
  const p = m.long && prompt > m.long.over ? m.long : m;
  return (u.input * p.inputPerM + u.output * p.outputPerM + u.cacheRead * p.cacheReadPerM + u.write5m * p.cacheWrite5mPerM + u.write1h * p.cacheWritePerM) / 1e6;
}
var lookup = (model) => model !== void 0 && Object.prototype.hasOwnProperty.call(MODELS, model) ? MODELS[model] : void 0;
function contextSize(model) {
  return lookup(model)?.contextSize;
}

// src/core/usage.ts
var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
var isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var num = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
var pad = (n) => String(n).padStart(2, "0");
function localDay(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
var emptyTotals = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, unpricedTokens: 0, requests: 0 });
var totalTokens = (t) => t.input + t.output + t.cacheRead + t.cacheWrite;
function parseUsageLine(line, dayOf = localDay) {
  if (!line.includes('"usage"')) return null;
  let o;
  try {
    o = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isObj(o) || o.type !== "assistant" || !isObj(o.message) || !isObj(o.message.usage)) return null;
  const msg = o.message;
  const u = msg.usage;
  const model = typeof msg.model === "string" && msg.model ? msg.model : "unknown";
  if (model === "<synthetic>") return null;
  const t = typeof o.timestamp === "string" ? Date.parse(o.timestamp) : NaN;
  if (!Number.isFinite(t)) return null;
  const write = num(u.cache_creation_input_tokens);
  const cc = isObj(u.cache_creation) ? u.cache_creation : {};
  const write1h = Math.min(write, num(cc.ephemeral_1h_input_tokens));
  const rec = {
    day: dayOf(t),
    model,
    u: { input: num(u.input_tokens), output: num(u.output_tokens), cacheRead: num(u.cache_read_input_tokens), write5m: write - write1h, write1h }
  };
  if (typeof msg.id === "string" && msg.id) rec.key = `${msg.id}:${typeof o.requestId === "string" ? o.requestId : ""}`;
  return rec;
}
function addRecord(days, r, sign = 1) {
  const day = days[r.day] ??= {};
  const t = day[r.model] ??= emptyTotals();
  const { input, output, cacheRead, write5m, write1h } = r.u;
  t.input += sign * input;
  t.output += sign * output;
  t.cacheRead += sign * cacheRead;
  t.cacheWrite += sign * (write5m + write1h);
  t.requests += sign;
  const cost = requestCost(r.model, r.u);
  if (cost === null) t.unpricedTokens += sign * (input + output + cacheRead + write5m + write1h);
  else t.cost += sign * cost;
}
var recTokens = (r) => r.u.input + r.u.output + r.u.cacheRead + r.u.write5m + r.u.write1h;
function takeRecord(days, seen, r) {
  if (!r.key) {
    addRecord(days, r);
    return true;
  }
  const prev = seen.get(r.key);
  if (prev && recTokens(r) <= recTokens(prev)) return false;
  if (prev) addRecord(days, prev, -1);
  addRecord(days, r);
  seen.set(r.key, r);
  return true;
}
function mergeDays(saved, scanned) {
  const out = {};
  for (const src of [saved, scanned]) {
    for (const [day, models] of Object.entries(src)) {
      for (const [model, t] of Object.entries(models)) {
        const cur = out[day]?.[model];
        if (!cur || totalTokens(t) > totalTokens(cur)) (out[day] ??= {})[model] = { ...t };
      }
    }
  }
  return out;
}
function addInto(a, b) {
  a.input += b.input;
  a.output += b.output;
  a.cacheRead += b.cacheRead;
  a.cacheWrite += b.cacheWrite;
  a.cost += b.cost;
  a.unpricedTokens += b.unpricedTokens;
  a.requests += b.requests;
}
function summarize(days, from, to) {
  const total = emptyTotals();
  const models = {};
  const rows = [];
  for (const day of Object.keys(days).sort()) {
    if (day < from || day > to) continue;
    const dt = emptyTotals();
    const dm = {};
    for (const [model, t] of Object.entries(days[day])) {
      addInto(dt, t);
      addInto(models[model] ??= emptyTotals(), t);
      dm[model] = { ...t };
    }
    addInto(total, dt);
    rows.push({ day, total: dt, models: dm });
  }
  return { from, to, total, models, days: rows };
}
function parseSaved(text) {
  try {
    const v = JSON.parse(text);
    if (!isObj(v) || !isObj(v.days)) return {};
    const out = {};
    for (const [day, models] of Object.entries(v.days)) {
      if (!DAY_RE.test(day) || !isObj(models)) continue;
      for (const [model, t] of Object.entries(models)) {
        if (!isObj(t)) continue;
        (out[day] ??= {})[model] = {
          input: num(t.input),
          output: num(t.output),
          cacheRead: num(t.cacheRead),
          cacheWrite: num(t.cacheWrite),
          cost: num(t.cost),
          unpricedTokens: num(t.unpricedTokens),
          requests: num(t.requests)
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}
var CHUNK = 4 * 1024 * 1024;
function listLogs(dir2, depth = 8) {
  let names;
  try {
    names = readdirSync(dir2);
  } catch {
    return [];
  }
  const out = [];
  for (const n of names) {
    const p = join2(dir2, n);
    if (n.endsWith(".jsonl")) out.push(p);
    else if (depth > 0 && !n.includes(".")) out.push(...listLogs(p, depth - 1));
  }
  return out;
}
var UsageLedger = class {
  constructor(projectsDir, savePath, pollMs = 3e4) {
    this.projectsDir = projectsDir;
    this.savePath = savePath;
    this.pollMs = pollMs;
    let text = "";
    try {
      text = readFileSync2(savePath, "utf8");
    } catch {
    }
    this.saved = parseSaved(text);
  }
  projectsDir;
  savePath;
  pollMs;
  scanned = {};
  saved;
  offsets = /* @__PURE__ */ new Map();
  seen = /* @__PURE__ */ new Map();
  timer;
  running;
  dirty = false;
  closed = false;
  scanning = true;
  /** Starts the first full read; resolves when it is done. */
  start() {
    const first = this.poll().finally(() => {
      this.scanning = false;
    });
    this.timer = setInterval(() => void this.poll(), this.pollMs);
    this.timer.unref?.();
    return first;
  }
  days() {
    return mergeDays(this.saved, this.scanned);
  }
  summary(from, to) {
    return summarize(this.days(), from, to);
  }
  close() {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    if (this.dirty) this.save();
  }
  /** One pass over the logs; passes never overlap. */
  poll() {
    if (!this.running) {
      this.running = this.pass().finally(() => {
        this.running = void 0;
      });
    }
    return this.running;
  }
  async pass() {
    for (const path of listLogs(this.projectsDir)) {
      if (this.closed) return;
      let size;
      try {
        size = statSync(path).size;
      } catch {
        continue;
      }
      const from = this.offsets.get(path) ?? 0;
      if (size < from) this.offsets.set(path, 0);
      if (size > (this.offsets.get(path) ?? 0)) await this.readFrom(path, this.offsets.get(path) ?? 0, size);
    }
    if (this.dirty) this.save();
  }
  /** Reads complete lines from `start` up to `end`; a partial last line waits for the next pass. */
  async readFrom(path, start, end) {
    let fh;
    try {
      fh = await open(path, "r");
    } catch {
      return;
    }
    try {
      let pos = start;
      let carry = "";
      while (pos < end) {
        const buf = Buffer.alloc(Math.min(CHUNK, end - pos));
        const { bytesRead } = await fh.read(buf, 0, buf.length, pos);
        if (bytesRead <= 0) break;
        pos += bytesRead;
        const text = carry + buf.toString("utf8", 0, bytesRead);
        const lines = text.split("\n");
        carry = lines.pop() ?? "";
        for (const line of lines) this.take(line);
        await new Promise((r) => setImmediate(r));
      }
      this.offsets.set(path, pos - Buffer.byteLength(carry, "utf8"));
    } finally {
      await fh.close();
    }
  }
  take(line) {
    const r = parseUsageLine(line);
    if (!r) return;
    if (takeRecord(this.scanned, this.seen, r)) this.dirty = true;
  }
  save() {
    this.dirty = false;
    try {
      const days = this.days();
      this.saved = days;
      mkdirSync2(join2(this.savePath, ".."), { recursive: true, mode: 448 });
      const tmp = `${this.savePath}.tmp`;
      writeFileSync2(tmp, JSON.stringify({ version: 1, days }), { mode: 384 });
      renameSync(tmp, this.savePath);
    } catch {
    }
  }
};

// src/server/eventServer.ts
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, join as join3, resolve, sep } from "node:path";

// node_modules/ws/wrapper.mjs
var import_stream = __toESM(require_stream(), 1);
var import_extension = __toESM(require_extension(), 1);
var import_permessage_deflate = __toESM(require_permessage_deflate(), 1);
var import_receiver = __toESM(require_receiver(), 1);
var import_sender = __toESM(require_sender(), 1);
var import_subprotocol = __toESM(require_subprotocol(), 1);
var import_websocket = __toESM(require_websocket(), 1);
var import_websocket_server = __toESM(require_websocket_server(), 1);

// src/server/eventServer.ts
var MAX_BODY = 1024 * 1024;
var BROADCAST_MS = 50;
var HOST = "127.0.0.1";
var MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8"
};
var digest = (s) => createHash("sha256").update(s).digest();
var tokenOk = (given2, expected) => typeof given2 === "string" && timingSafeEqual(digest(given2), digest(expected));
function reply(res, status, body = "", headers = {}) {
  res.writeHead(status, { "Cache-Control": "no-store", ...headers });
  res.end(body);
}
function startEventServer(opts) {
  const { port, token, store } = opts;
  const version2 = opts.version ?? "0.0.0";
  const startedBy2 = opts.startedBy ?? "app";
  let seq = 0;
  const startedAt = Date.now();
  const root = resolve(opts.staticDir);
  const wss = new import_websocket_server.default({ noServer: true });
  const clients = /* @__PURE__ */ new Set();
  const send = (ws, msg) => {
    if (ws.readyState === import_websocket.default.OPEN) ws.send(JSON.stringify(msg));
  };
  let queued = [];
  let timer;
  const flush = () => {
    timer = void 0;
    const events = queued;
    queued = [];
    if (clients.size === 0) return;
    const msg = { type: "events", events, state: store.snapshot() };
    for (const ws of clients) send(ws, msg);
  };
  store.onChange((events) => {
    seq++;
    if (clients.size === 0) return;
    queued.push(...events);
    timer ??= setTimeout(flush, BROADCAST_MS);
  });
  function handleEvent(req, res) {
    if (!tokenOk(req.headers["x-agent-office-token"], token)) {
      reply(res, 401, "unauthorized");
      req.resume();
      return;
    }
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > MAX_BODY) {
      reply(res, 413, "payload too large", { Connection: "close" });
      req.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    let rejected = false;
    req.on("data", (c) => {
      if (rejected) return;
      size += c.length;
      if (size > MAX_BODY) {
        rejected = true;
        chunks.length = 0;
        reply(res, 413, "payload too large", { Connection: "close" });
        return;
      }
      chunks.push(c);
    });
    req.on("error", () => void 0);
    req.on("end", () => {
      if (rejected) return;
      let parsed;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        reply(res, 400, "malformed json");
        return;
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || typeof parsed.session_id !== "string") {
        reply(res, 400, "not a hook event");
        return;
      }
      try {
        store.applyHook(parsed, Date.now());
      } catch {
      }
      reply(res, 204);
    });
  }
  function handleState(req, res) {
    if (!tokenOk(req.headers["x-agent-office-token"], token)) return reply(res, 401, "unauthorized");
    const body = { version: version2, startedBy: startedBy2, startedAt, seq, state: store.snapshot() };
    if (opts.usage && !opts.usage.scanning) {
      const day = localDay(Date.now());
      const t = opts.usage.summary(day, day).total;
      body.usage = { today: { cost: t.cost, tokens: totalTokens(t) } };
    }
    reply(res, 200, JSON.stringify(body), { "Content-Type": "application/json; charset=utf-8" });
  }
  function handleUsage(req, res, url) {
    if (!tokenOk(req.headers["x-agent-office-token"], token)) return reply(res, 401, "unauthorized");
    if (!opts.usage) return reply(res, 404, "usage not available");
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";
    if (!DAY_RE.test(from) || !DAY_RE.test(to) || from > to) return reply(res, 400, "from and to must be YYYY-MM-DD, from <= to");
    reply(res, 200, JSON.stringify({ scanning: opts.usage.scanning, ...opts.usage.summary(from, to) }), { "Content-Type": "application/json; charset=utf-8" });
  }
  function handleShutdown(req, res) {
    req.resume();
    if (!tokenOk(req.headers["x-agent-office-token"], token)) return reply(res, 401, "unauthorized");
    if (startedBy2 !== "plugin" || !opts.onShutdown) return reply(res, 409, `started by ${startedBy2}`);
    const onShutdown = opts.onShutdown;
    res.once("finish", () => setImmediate(onShutdown));
    reply(res, 202);
  }
  async function handleStatic(req, res, pathname) {
    let rel;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      return reply(res, 400, "bad path");
    }
    if (rel.includes("\0")) return reply(res, 400, "bad path");
    let file = resolve(join3(root, rel));
    if (file !== root && !file.startsWith(root + sep)) return reply(res, 403, "forbidden");
    try {
      if ((await stat(file)).isDirectory()) file = join3(file, "index.html");
      const data = await readFile(file);
      reply(res, 200, req.method === "HEAD" ? "" : data, { "Content-Type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream" });
    } catch {
      reply(res, 404, "not found");
    }
  }
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${HOST}`);
      if (url.pathname === "/event") {
        if (req.method !== "POST") return reply(res, 405, "method not allowed", { Allow: "POST" });
        return handleEvent(req, res);
      }
      if (url.pathname === "/shutdown") {
        if (req.method !== "POST") return reply(res, 405, "method not allowed", { Allow: "POST" });
        return handleShutdown(req, res);
      }
      if (req.method !== "GET" && req.method !== "HEAD") return reply(res, 405, "method not allowed");
      if (url.pathname === "/state") return handleState(req, res);
      if (url.pathname === "/usage") return handleUsage(req, res, url);
      void handleStatic(req, res, url.pathname);
    } catch {
      if (!res.headersSent) reply(res, 400, "bad request");
    }
  });
  server.on("clientError", (_e, socket) => socket.destroy());
  server.on("upgrade", (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url ?? "/", `http://${HOST}`);
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== "/ws") {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    if (!tokenOk(url.searchParams.get("token"), token)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      clients.add(ws);
      ws.on("close", () => clients.delete(ws));
      ws.on("error", () => clients.delete(ws));
      send(ws, { type: "snapshot", state: store.snapshot() });
    });
  });
  return new Promise((resolveStart, reject) => {
    server.once("error", (err) => {
      reject(err.code === "EADDRINUSE" ? new Error(`port ${port} in use`) : err);
    });
    server.listen(port, HOST, () => {
      server.removeAllListeners("error");
      server.on("error", () => void 0);
      const actual = server.address().port;
      resolveStart({
        url: `http://${HOST}:${actual}`,
        clientCount: () => clients.size,
        close: () => new Promise((done) => {
          if (timer) clearTimeout(timer);
          timer = void 0;
          queued = [];
          for (const ws of clients) ws.terminate();
          clients.clear();
          wss.close();
          server.close(() => done());
          server.closeAllConnections();
        })
      });
    });
  });
}

// src/core/discovery.ts
import { execFileSync } from "node:child_process";
import { closeSync, openSync, readFileSync as readFileSync3, readSync, readdirSync as readdirSync2, statSync as statSync2 } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { basename, dirname, join as join4 } from "node:path";
function subagentLogPath(_claudeDir, transcriptPath, agentId) {
  const sessionDir = join4(dirname(transcriptPath), basename(transcriptPath).replace(/\.jsonl$/, ""));
  return join4(sessionDir, "subagents", `agent-${agentId}.jsonl`);
}
var STALE_AGENT_MS = 6e5;
function readMeta(logPath) {
  const out = { finished: false };
  try {
    const o = JSON.parse(readFileSync3(logPath.replace(/\.jsonl$/, ".meta.json"), "utf8"));
    if (typeof o !== "object" || o === null) return out;
    out.hasMeta = true;
    const m = o;
    if ("finished" in m) out.finished = m.finished === true;
    else {
      try {
        out.finished = Date.now() - statSync2(logPath).mtimeMs >= STALE_AGENT_MS;
      } catch {
        out.finished = false;
      }
    }
    if (typeof m.agentType === "string") out.type = m.agentType;
    if (typeof m.description === "string") out.description = m.description;
    if (typeof m.toolUseId === "string") out.toolUseId = m.toolUseId;
  } catch {
  }
  return out;
}
var safeReaddir = (p) => {
  try {
    return readdirSync2(p);
  } catch {
    return [];
  }
};
function listSubagentFiles(mainLog) {
  const subDir = join4(dirname(mainLog), basename(mainLog).replace(/\.jsonl$/, ""), "subagents");
  return safeReaddir(subDir).map((f) => /^agent-(.+)\.jsonl$/.exec(f)).filter((m) => m !== null).map((m) => ({ agentId: m[1], path: join4(subDir, m[0]) }));
}
var subagentsOf = (mainLog) => listSubagentFiles(mainLog).map((a) => {
  const { hasMeta: _h, ...meta } = readMeta(a.path);
  return { ...a, ...meta };
});
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}
var startCache = /* @__PURE__ */ new Map();
var norm = (s) => s.trim().replace(/\s+/g, " ");
function psStart(pid, tz) {
  try {
    const env = { ...process.env, LC_ALL: "C" };
    if (tz) env.TZ = tz;
    const out = norm(execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { env, timeout: 2e3, stdio: ["ignore", "pipe", "ignore"] }).toString());
    return out || void 0;
  } catch {
    return void 0;
  }
}
function startTimesMatch(psOut, procStart) {
  const a = Date.parse(norm(psOut ?? ""));
  const b = Date.parse(norm(procStart));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
  return Math.abs(a - b) <= 2e3;
}
function procStartMatches(pid, procStart, fresh = false) {
  const key = `${pid}|${procStart}`;
  const hit = fresh ? void 0 : startCache.get(key);
  if (hit !== void 0) return hit;
  const ok = startTimesMatch(psStart(pid, "UTC"), procStart) || startTimesMatch(psStart(pid), procStart);
  startCache.set(key, ok);
  return ok;
}
function forgetPid(pid) {
  const prefix = `${pid}|`;
  for (const k of startCache.keys()) if (k.startsWith(prefix)) startCache.delete(k);
}
function readRegistry(claudeDir2) {
  const dir2 = join4(claudeDir2, "sessions");
  let files;
  try {
    files = readdirSync2(dir2);
  } catch {
    return null;
  }
  const out = [];
  let parsed = 0;
  let wellFormed = 0;
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const o = JSON.parse(readFileSync3(join4(dir2, f), "utf8"));
      parsed++;
      if (typeof o !== "object" || o === null || Array.isArray(o)) continue;
      const m = o;
      const pid = m.pid;
      const sessionId = m.sessionId;
      if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0 || typeof sessionId !== "string" || !sessionId) continue;
      wellFormed++;
      if (m.kind !== void 0 && m.kind !== "interactive") continue;
      if (!pidAlive(pid)) {
        forgetPid(pid);
        continue;
      }
      const procStart = typeof m.procStart === "string" && m.procStart ? m.procStart : void 0;
      if (procStart && !procStartMatches(pid, procStart)) continue;
      const e = { pid, sessionId, formerSessionIds: [] };
      if (procStart) e.procStart = procStart;
      if (typeof m.cwd === "string" && m.cwd) e.cwd = m.cwd;
      if (typeof m.name === "string" && m.name) e.name = m.name;
      if (m.status === "busy" || m.status === "idle") e.status = m.status;
      if (Array.isArray(m.formerNames)) {
        for (const fn of m.formerNames) {
          const id = typeof fn === "object" && fn !== null ? fn.sessionId : void 0;
          if (typeof id === "string" && id && id !== sessionId) e.formerSessionIds.push(id);
        }
      }
      out.push(e);
    } catch {
    }
  }
  return parsed > 0 && wellFormed === 0 ? null : out;
}
function findMainLog(claudeDir2, sessionId, cwd) {
  const projects = join4(claudeDir2, "projects");
  const file = `${sessionId}.jsonl`;
  const isFile = (p) => {
    try {
      return statSync2(p).isFile();
    } catch {
      return false;
    }
  };
  if (cwd) {
    const p = join4(projects, cwd.replace(/[^a-zA-Z0-9]/g, "-"), file);
    if (isFile(p)) return p;
  }
  for (const slug of safeReaddir(projects)) {
    const p = join4(projects, slug, file);
    if (isFile(p)) return p;
  }
  return void 0;
}
function sessionFromRegistry(claudeDir2, r) {
  const mainLog = findMainLog(claudeDir2, r.sessionId, r.cwd) ?? "";
  const s = { sessionId: r.sessionId, mainLog, subagentLogs: mainLog ? subagentsOf(mainLog) : [], pid: r.pid, formerSessionIds: r.formerSessionIds };
  const cwd = r.cwd ?? (mainLog ? findCwd(mainLog) : void 0);
  if (cwd) s.cwd = cwd;
  if (r.name) s.name = r.name;
  if (r.status) s.registryStatus = r.status;
  if (r.procStart) s.procStart = r.procStart;
  return s;
}
function findCwd(file) {
  let fd;
  try {
    fd = openSync(file, "r");
    const buf = Buffer.alloc(64 * 1024);
    let pos = 0;
    let carry = "";
    const dec = new StringDecoder("utf8");
    while (pos < 1024 * 1024) {
      const n = readSync(fd, buf, 0, buf.length, pos);
      if (n === 0) break;
      pos += n;
      const parts = (carry + dec.write(buf.subarray(0, n))).split("\n");
      carry = parts.pop() ?? "";
      for (const l of parts) {
        if (!l.includes('"cwd"')) continue;
        try {
          const o = JSON.parse(l);
          if (typeof o === "object" && o !== null && typeof o.cwd === "string") return o.cwd;
        } catch {
        }
      }
    }
    if (carry.includes('"cwd"')) {
      try {
        const o = JSON.parse(carry);
        if (typeof o.cwd === "string") return o.cwd;
      } catch {
      }
    }
  } catch {
  } finally {
    if (fd !== void 0) closeSync(fd);
  }
  return void 0;
}
function discoverActiveSessions(claudeDir2, now, windowMs = 6e5) {
  const reg = readRegistry(claudeDir2);
  if (reg) return reg.map((r) => sessionFromRegistry(claudeDir2, r));
  return recentMainLogs(claudeDir2, now, windowMs).map((l) => sessionFromLog(l.sessionId, l.mainLog));
}
function sessionFromLog(sessionId, mainLog) {
  const s = { sessionId, mainLog, subagentLogs: subagentsOf(mainLog) };
  const cwd = findCwd(mainLog);
  if (cwd) s.cwd = cwd;
  return s;
}
function recentMainLogs(claudeDir2, now, windowMs = 6e5) {
  const out = [];
  const projects = join4(claudeDir2, "projects");
  for (const slug of safeReaddir(projects)) {
    const projDir = join4(projects, slug);
    for (const name of safeReaddir(projDir)) {
      if (!name.endsWith(".jsonl")) continue;
      const mainLog = join4(projDir, name);
      try {
        const st = statSync2(mainLog);
        if (!st.isFile() || now - st.mtimeMs > windowMs) continue;
      } catch {
        continue;
      }
      out.push({ sessionId: name.slice(0, -".jsonl".length), mainLog });
    }
  }
  return out;
}

// src/core/logWatcher.ts
import { EventEmitter } from "node:events";
import { statSync as statSync3 } from "node:fs";
import { open as open2, stat as stat2 } from "node:fs/promises";
import { StringDecoder as StringDecoder2 } from "node:string_decoder";

// src/core/logParser.ts
var MAX_RECENT = 20;
var MAX_FILES = 200;
var MAX_SEEN = 50;
var isObj2 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var num2 = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
function parseLogLine(line) {
  try {
    if (!line || !line.trim()) return null;
    const obj = JSON.parse(line);
    if (!isObj2(obj) || obj.type !== "assistant" || !isObj2(obj.message)) return null;
    const msg = obj.message;
    const d = { toolUses: [] };
    let relevant = false;
    if (typeof obj.timestamp === "string") {
      const t = Date.parse(obj.timestamp);
      if (Number.isFinite(t)) d.timestamp = t;
    }
    if (typeof obj.gitBranch === "string" && obj.gitBranch) d.gitBranch = obj.gitBranch;
    if (typeof obj.cwd === "string" && obj.cwd) d.cwd = obj.cwd;
    if (typeof msg.model === "string" && msg.model) {
      d.model = msg.model;
      relevant = true;
    }
    if (typeof msg.id === "string" && msg.id) d.messageId = msg.id;
    if (isObj2(msg.usage)) {
      const u = msg.usage;
      if (["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"].some((k) => typeof u[k] === "number")) {
        d.usage = {
          input: num2(u.input_tokens),
          output: num2(u.output_tokens),
          cacheRead: num2(u.cache_read_input_tokens),
          cacheWrite: num2(u.cache_creation_input_tokens)
        };
        relevant = true;
      }
    }
    if (Array.isArray(msg.content)) {
      for (const b of msg.content) {
        if (isObj2(b) && b.type === "tool_use" && typeof b.name === "string") {
          d.toolUses.push({ name: b.name, input: isObj2(b.input) ? b.input : {} });
          relevant = true;
        }
      }
    }
    return relevant ? d : null;
  } catch {
    return null;
  }
}
function emptyStats(now) {
  return { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, tools: {}, files: [], recent: [], lastActivity: now };
}
function applyDelta(stats, d) {
  const s = { ...stats, tools: { ...stats.tools }, files: [...stats.files], recent: [...stats.recent] };
  if (d.model) s.model = d.model;
  if (d.timestamp !== void 0) s.lastActivity = d.timestamp;
  if (d.usage) {
    const seen = stats.seenMessageIds ?? [];
    const dup = d.messageId !== void 0 && seen.includes(d.messageId);
    if (!dup) {
      s.inputTokens += d.usage.input;
      s.outputTokens += d.usage.output;
      s.cacheRead += d.usage.cacheRead;
      s.cacheWrite += d.usage.cacheWrite;
      if (d.messageId !== void 0) s.seenMessageIds = [...seen, d.messageId].slice(-MAX_SEEN);
    }
    s.contextTokens = d.usage.input + d.usage.cacheRead + d.usage.cacheWrite + d.usage.output;
    const size = contextSize(s.model);
    s.contextFill = size ? (d.usage.input + d.usage.cacheRead + d.usage.cacheWrite) / size : void 0;
  }
  for (const t of d.toolUses) {
    s.tools[t.name] = (s.tools[t.name] ?? 0) + 1;
    let target;
    for (const k of ["pattern", "file_path", "path"]) {
      const v = t.input[k];
      if (typeof v === "string" && v) {
        target ??= v;
        const i = s.files.indexOf(v);
        if (i >= 0) s.files.splice(i, 1);
        s.files.push(v);
      }
    }
    s.recent.push(target ? `${t.name} ${target}` : t.name);
  }
  if (s.recent.length > MAX_RECENT) s.recent = s.recent.slice(-MAX_RECENT);
  if (s.files.length > MAX_FILES) s.files = s.files.slice(-MAX_FILES);
  return s;
}

// src/core/logWatcher.ts
var CHUNK2 = 64 * 1024;
var MAX_LINE = 1024 * 1024;
var LogWatcher = class extends EventEmitter {
  constructor(intervalMs = 1e3) {
    super();
    this.intervalMs = intervalMs;
  }
  intervalMs;
  tails = /* @__PURE__ */ new Map();
  timer;
  closed = false;
  /** Default starts at EOF (only newly appended lines emit); `fromStart` replays existing content once. A missing file starts at 0. */
  watch(sessionId, agentId, path, opts) {
    if (this.closed || this.tails.has(path)) return;
    let offset = 0;
    if (!opts?.fromStart) {
      try {
        offset = statSync3(path).size;
      } catch {
        offset = 0;
      }
    }
    const t = { sessionId, agentId, path, offset, decoder: new StringDecoder2("utf8"), leftover: "", skipping: false, busy: false };
    this.tails.set(path, t);
    void this.poll(t);
    this.timer ??= setInterval(() => {
      for (const t2 of this.tails.values()) void this.poll(t2);
    }, this.intervalMs);
  }
  unwatch(path) {
    this.tails.delete(path);
    if (this.tails.size === 0) this.stopTimer();
  }
  /** Paths currently being tailed (for diagnostics and tests). */
  watchedPaths() {
    return [...this.tails.keys()];
  }
  close() {
    this.closed = true;
    this.tails.clear();
    this.stopTimer();
    this.removeAllListeners();
  }
  stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = void 0;
  }
  async poll(t) {
    if (t.busy) return;
    t.busy = true;
    try {
      let size;
      try {
        size = (await stat2(t.path)).size;
      } catch {
        return;
      }
      if (size < t.offset) {
        t.offset = 0;
        t.decoder = new StringDecoder2("utf8");
        t.leftover = "";
        t.skipping = false;
      }
      if (size === t.offset) return;
      const fh = await open2(t.path, "r");
      try {
        const buf = Buffer.alloc(CHUNK2);
        while (t.offset < size && this.tails.get(t.path) === t) {
          const { bytesRead } = await fh.read(buf, 0, Math.min(CHUNK2, size - t.offset), t.offset);
          if (bytesRead === 0) break;
          t.offset += bytesRead;
          this.consume(t, t.decoder.write(buf.subarray(0, bytesRead)));
        }
      } finally {
        await fh.close();
      }
    } catch {
    } finally {
      t.busy = false;
    }
  }
  consume(t, text) {
    let start = 0;
    for (; ; ) {
      const nl = text.indexOf("\n", start);
      if (nl === -1) break;
      const piece = text.slice(start, nl);
      start = nl + 1;
      if (t.skipping) {
        t.skipping = false;
      } else {
        this.emitLine(t, t.leftover + piece);
      }
      t.leftover = "";
    }
    if (!t.skipping) {
      t.leftover += text.slice(start);
      if (t.leftover.length > MAX_LINE) {
        t.leftover = "";
        t.skipping = true;
      }
    }
  }
  emitLine(t, line) {
    if (line.length > MAX_LINE) return;
    const d = parseLogLine(line);
    if (!d) return;
    try {
      this.emit("delta", t.sessionId, t.agentId, d);
    } catch {
    }
  }
};

// src/core/store.ts
var HANDOFF_MS = 6e3;
var LINGER_MS = 6e4;
var SPAWN_MS = 2e3;
var MAX_PENDING = 100;
var MAX_OPEN_TOOLS = 50;
var RUNNING = /* @__PURE__ */ new Set(["spawning", "working", "quiet"]);
var NEEDS_YOU_TYPES = /* @__PURE__ */ new Set(["permission_prompt", "elicitation_dialog"]);
var MAX_REPLACED = 200;
var isObj3 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var str = (v) => typeof v === "string" && v ? v : void 0;
function labelFor(cwd) {
  const parts = cwd.split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "unknown";
}
function findLeadSession(e, sessions) {
  const cwd = str(e.cwd);
  if (!cwd) return null;
  for (const k of ["lead_session_id", "leader_session_id", "parent_session_id"]) {
    const id = str(e[k]);
    if (!id || id === e.session_id) continue;
    const lead = sessions[id];
    if (lead && lead.status === "active" && lead.cwd === cwd) return id;
  }
  return null;
}
function isNeedsYouNotification(e) {
  const t = str(e.notification_type);
  if (t) return NEEDS_YOU_TYPES.has(t);
  return (str(e.message)?.toLowerCase() ?? "").includes("permission");
}
function transitionSession(s, m, input, now, endedMs) {
  const lastSeen = Math.max(s.lastActivity, m.liveAt ?? 0);
  switch (input) {
    case "revive":
      if (s.status !== "ended") return null;
      s.status = "active";
      m.endedAt = void 0;
      m.endedByClear = void 0;
      transitionBoss(s, m, "reset");
      return "session_started";
    case "end":
      if (s.status === "ended") return null;
      s.status = "ended";
      m.endedAt = now;
      transitionBoss(s, m, "reset");
      return "session_ended";
    case "tick":
      if (s.status === "active" && now - lastSeen >= endedMs) return transitionSession(s, m, "end", now, endedMs);
      if (s.status === "ended" && now - (m.endedAt ?? now) >= LINGER_MS) return "prune";
      return null;
  }
}
function transitionAgent(a, input, now, stuckMs) {
  const set = (st) => {
    if (a.status === st) return null;
    a.status = st;
    return "changed";
  };
  switch (input) {
    case "activity":
      if (a.status === "handing_off" || a.status === "gone") return null;
      a.stats.lastActivity = now;
      return set("working");
    case "stop":
      if (a.status === "handing_off" || a.status === "gone") return null;
      a.status = "handing_off";
      a.endedAt = now;
      return "handoff";
    case "tick": {
      const ended = a.endedAt ?? now;
      if (a.status === "gone") return now - ended >= HANDOFF_MS + LINGER_MS ? "prune" : null;
      if (a.status === "handing_off") {
        if (now - ended < HANDOFF_MS) return null;
        a.status = "gone";
        return "left";
      }
      const idle = now - a.stats.lastActivity;
      if ((a.status === "spawning" || a.status === "working") && idle >= stuckMs && !a.waitingOnYou) return set("quiet");
      if (a.status === "spawning" && now - a.startedAt >= SPAWN_MS) return set("working");
      return null;
    }
  }
}
function transitionBoss(s, m, input) {
  switch (input) {
    case "human_prompt":
      m.main = "working";
      m.needsYou = false;
      break;
    case "main_activity":
      m.main = "working";
      break;
    case "answered":
      m.needsYou = false;
      break;
    case "stop":
      m.main = "stopped";
      if (m.needsYouBy == null || !RUNNING.has(s.agents[m.needsYouBy]?.status)) m.needsYou = false;
      break;
    case "needs_you":
      m.needsYou = true;
      break;
    case "reset":
      m.main = "stopped";
      m.needsYou = false;
      break;
    case "recompute":
      break;
  }
  const running = Object.values(s.agents).some((a) => RUNNING.has(a.status));
  const next = m.needsYou ? "needs_you" : m.main === "working" ? running ? "delegating" : "working" : running ? "waiting_on_team" : "idle";
  let changed = s.boss.status !== next;
  s.boss.status = next;
  for (const a of Object.values(s.agents)) {
    const waiting = m.needsYou && m.needsYouBy === a.id && RUNNING.has(a.status);
    if (!!a.waitingOnYou !== waiting) {
      if (waiting) a.waitingOnYou = true;
      else delete a.waitingOnYou;
      changed = true;
    }
    if (waiting && a.status === "quiet") {
      a.status = "working";
      changed = true;
    }
  }
  return changed;
}
var OfficeStore = class {
  stuckMs;
  endedMs;
  sessions = {};
  meta = /* @__PURE__ */ new Map();
  teammates = /* @__PURE__ */ new Map();
  /**
   * Session ids replaced by a takeover (old id → successor), bounded to MAX_REPLACED, oldest dropped.
   * Late hook events and logs for a replaced id are DROPPED, not rerouted: they belong to the old
   * conversation (its SessionEnd/Stop/tool events would wrongly end or idle the successor's room, and
   * its tokens are not the new conversation's). Only an explicit SessionStart(source: resume) for the
   * old id brings it back, as its own session.
   */
  replaced = /* @__PURE__ */ new Map();
  listeners = [];
  constructor(opts = {}) {
    this.stuckMs = opts.stuckMs ?? 18e4;
    this.endedMs = opts.endedMs ?? 18e5;
  }
  onChange(cb) {
    this.listeners.push(cb);
  }
  snapshot() {
    return { sessions: structuredClone(this.sessions) };
  }
  /** The live sessions, uncloned. Read-only: for cheap membership checks; never mutate or keep the result. */
  peek() {
    return this.sessions;
  }
  applyHook(e, now) {
    const out = [];
    if (!isObj3(e)) return out;
    try {
      this.handleHook(e, now, out);
      this.refreshSubLabels();
    } catch {
    }
    this.notify(out);
    return out;
  }
  /** Sets the session's registry name; notifies only on change. */
  setName(sessionId, name) {
    const s = this.sessions[sessionId];
    if (!s || (name ?? void 0) === s.name) return;
    if (name) s.name = name;
    else delete s.name;
    this.notify([]);
  }
  /** The session's process is alive now (session registry): an active session is not timed out while live. */
  markLive(sessionId, now) {
    const m = this.meta.get(sessionId);
    if (m && Number.isFinite(now)) m.liveAt = now;
  }
  applyLog(sessionId, agentId, d, now) {
    const out = [];
    if (!str(sessionId) || !isObj3(d) || this.replaced.has(sessionId)) return;
    try {
      const delta = { ...d, toolUses: Array.isArray(d.toolUses) ? d.toolUses : [] };
      let sid = sessionId;
      let aid = str(agentId) ?? null;
      const link = this.teammates.get(sid);
      if (link) {
        sid = link.leadSessionId;
        aid ??= link.agentId;
      }
      const s = this.ensureSession(sid, str(delta.cwd) ?? void 0, now, out);
      if (str(delta.gitBranch)) s.branch = delta.gitBranch;
      const m = this.meta.get(sid);
      if (aid) {
        const a = this.ensureAgent(s, m, aid, now, out, {});
        if (!a) return;
        a.stats = applyDelta(a.stats, delta);
        a.stats.lastActivity = now;
        if (delta.timestamp !== void 0 && delta.timestamp < a.startedAt) a.startedAt = delta.timestamp;
        transitionAgent(a, "activity", now, this.stuckMs);
      } else {
        s.boss.stats = applyDelta(s.boss.stats, delta);
        s.boss.stats.lastActivity = now;
        if (delta.timestamp !== void 0 && delta.timestamp < s.boss.startedAt) s.boss.startedAt = delta.timestamp;
        if (delta.timestamp !== void 0 && delta.timestamp < (s.floorSince ?? Infinity)) s.floorSince = delta.timestamp;
      }
      s.lastActivity = now;
      transitionBoss(s, m, "recompute");
      this.refreshSubLabels();
    } catch {
    }
    this.notify(out);
  }
  tick(now) {
    const out = [];
    let changed = false;
    try {
      if (!Number.isFinite(now)) return out;
      for (const s of Object.values(this.sessions)) {
        const m = this.meta.get(s.id);
        for (const a of Object.values(s.agents)) {
          const r2 = transitionAgent(a, "tick", now, this.stuckMs);
          if (r2 === "changed") changed = true;
          else if (r2 === "left") out.push({ kind: "left", sessionId: s.id, agentId: a.id });
          else if (r2 === "prune") {
            delete s.agents[a.id];
            m.retired.add(a.id);
            m.pending = m.pending.filter((p) => p.claimedBy !== a.id);
            changed = true;
          }
        }
        if (transitionBoss(s, m, "recompute")) changed = true;
        const r = transitionSession(s, m, "tick", now, this.endedMs);
        if (r === "session_ended") out.push({ kind: "session_ended", sessionId: s.id });
        else if (r === "prune") {
          this.removeSession(s.id);
          changed = true;
        }
      }
      if (out.length || changed) this.refreshSubLabels();
    } catch {
    }
    this.notify(out, changed);
    return out;
  }
  // ------------------------------------------------------------ internals
  notify(events, changed = true) {
    if (!events.length && !changed) return;
    for (const cb of this.listeners) {
      try {
        cb(events);
      } catch {
      }
    }
  }
  handleHook(raw, now, out) {
    let e = raw;
    let name = str(e.hook_event_name);
    const rawSid = str(e.session_id);
    if (!name || !rawSid) return;
    if (this.replaced.has(rawSid)) {
      if (name !== "SessionStart" || e.source !== "resume") return;
      this.replaced.delete(rawSid);
    }
    let link = this.teammates.get(rawSid);
    if (!link && !this.sessions[rawSid]) {
      const lead = findLeadSession(e, this.sessions);
      if (lead) {
        link = { leadSessionId: lead, agentId: rawSid };
        this.teammates.set(rawSid, link);
        const s2 = this.sessions[lead];
        const m2 = this.meta.get(lead);
        this.ensureAgent(s2, m2, rawSid, now, out, {
          status: "spawning",
          type: str(e.agent_type) ?? "teammate",
          name: str(e.agent_name) ?? str(e.teammate_name)
        });
      }
    }
    if (link) {
      const ownEvent = !str(e.agent_id);
      e = { ...e, session_id: link.leadSessionId, agent_id: str(e.agent_id) ?? link.agentId };
      if (ownEvent) {
        if (name === "SessionEnd") name = "SubagentStop";
        else if (name === "UserPromptSubmit") name = "AgentActivity";
        else if (name === "SessionStart" || name === "Stop") name = "Touch";
      }
    }
    const sid = e.session_id;
    const cwd = str(e.cwd);
    const agentId = str(e.agent_id);
    if (name === "SessionStart" && !this.sessions[sid] && e.source === "clear") {
      if (this.takeOver(sid, cwd, str(e.replaces), now, out)) return;
    }
    const s = this.ensureSession(sid, cwd, now, out);
    const m = this.meta.get(sid);
    const title = str(e.session_title);
    if (title) m.title = title;
    if (name !== "SessionEnd") {
      if (transitionSession(s, m, "revive", now, this.endedMs) === "session_started") out.push({ kind: "session_started", sessionId: sid });
    }
    s.lastActivity = now;
    switch (name) {
      case "UserPromptSubmit": {
        const synthetic = (str(e.prompt) ?? "").trimStart().startsWith("<agent-message");
        transitionBoss(s, m, synthetic ? "main_activity" : "human_prompt");
        break;
      }
      case "PreToolUse":
      case "PostToolUse": {
        const tool = str(e.tool_name);
        const caller = agentId ?? null;
        if (m.needsYou && (m.needsYouBy ?? null) === caller) transitionBoss(s, m, "answered");
        this.trackOpenTool(m, name, str(e.tool_use_id), caller);
        if (tool === "SubagentHandback") break;
        if (agentId) this.agentActivity(s, m, agentId, e, now, out);
        else transitionBoss(s, m, "main_activity");
        if (tool === "Agent") {
          if (name === "PreToolUse") this.recordPending(m, e, agentId);
          else this.linkFromPostToolUse(s, m, e, now, out);
        }
        break;
      }
      case "AgentActivity":
        if (agentId) this.agentActivity(s, m, agentId, e, now, out);
        break;
      case "SubagentStart":
        if (agentId) {
          const type = str(e.agent_type);
          const existing = s.agents[agentId];
          if (existing) {
            if (type && existing.type === "unknown") existing.type = type;
            const task = str(e.description);
            if (task && !existing.task) existing.task = task;
          } else {
            this.ensureAgent(s, m, agentId, now, out, { status: "spawning", type, task: str(e.description), claim: true });
          }
        }
        break;
      case "SubagentStop":
        if (agentId) {
          const a = this.ensureAgent(s, m, agentId, now, out, { type: str(e.agent_type) });
          if (m.needsYou && m.needsYouBy === agentId) transitionBoss(s, m, "answered");
          m.openTools = m.openTools.filter((t) => t.agent !== agentId);
          if (a && transitionAgent(a, "stop", now, this.stuckMs) === "handoff") {
            out.push({ kind: "handoff", sessionId: sid, agentId, toId: a.parentId ?? "boss" });
          }
        }
        break;
      case "Stop":
        m.openTools = m.openTools.filter((t) => t.agent !== null);
        transitionBoss(s, m, "stop");
        this.adoptBackgroundTasks(s, m, e, now, out);
        break;
      case "PermissionRequest":
        m.needsYouBy = agentId ?? null;
        transitionBoss(s, m, "needs_you");
        break;
      case "Notification":
        if (isNeedsYouNotification(e)) {
          if (agentId || !m.needsYou || m.needsYouBy == null) m.needsYouBy = agentId ?? m.openTools[m.openTools.length - 1]?.agent ?? null;
          transitionBoss(s, m, "needs_you");
        }
        break;
      case "SessionEnd":
        if (s.status !== "ended") m.endedByClear = e.reason === "clear";
        if (transitionSession(s, m, "end", now, this.endedMs) === "session_ended") out.push({ kind: "session_ended", sessionId: sid });
        break;
      default:
        break;
    }
    transitionBoss(s, m, "recompute");
  }
  ensureSession(sid, cwd, now, out) {
    let s = this.sessions[sid];
    if (!s) {
      s = {
        id: sid,
        cwd: cwd ?? "",
        label: labelFor(cwd ?? ""),
        status: "active",
        boss: { status: "idle", startedAt: now, stats: emptyStats(now) },
        agents: {},
        lastActivity: now,
        floorSince: now
      };
      this.sessions[sid] = s;
      this.meta.set(sid, { main: "stopped", needsYou: false, openTools: [], pending: [], retired: /* @__PURE__ */ new Set() });
      out.push({ kind: "session_started", sessionId: sid });
    } else if (cwd && !s.cwd) {
      s.cwd = cwd;
      s.label = labelFor(cwd);
    }
    return s;
  }
  removeSession(sid) {
    delete this.sessions[sid];
    this.meta.delete(sid);
    for (const [k, l] of this.teammates) if (l.leadSessionId === sid) this.teammates.delete(k);
  }
  /**
   * A SessionStart(clear) with a new id takes over the room of the conversation it replaced (spec: room
   * lifecycle). In order: the explicitly named `replaces` room (the rescan knows it from the registry); else
   * the room in the cwd that most recently ended with SessionEnd(reason: clear); else, when SessionStart(clear)
   * arrives before the old id's SessionEnd, the cwd's only live room if it is idle. With two or more live rooms
   * in the cwd and no ended one, nothing is taken over: two live sessions in one folder keep separate rooms.
   */
  takeOver(sid, cwd, replaces, now, out) {
    let from;
    if (replaces) {
      const t = this.sessions[replaces];
      if (!t || t.id === sid || cwd && t.cwd && t.cwd !== cwd) return false;
      from = t;
    } else {
      if (!cwd) return false;
      const here = Object.values(this.sessions).filter((s2) => s2.cwd === cwd);
      for (const s2 of here) {
        const m = this.meta.get(s2.id);
        if (s2.status !== "ended" || !m.endedByClear) continue;
        if (!from || (m.endedAt ?? 0) > (this.meta.get(from.id).endedAt ?? 0)) from = s2;
      }
      if (!from) {
        const live = here.filter((s2) => s2.status === "active");
        if (live.length === 1 && live[0].boss.status === "idle") from = live[0];
      }
    }
    if (!from) return false;
    this.removeSession(from.id);
    this.replaced.delete(from.id);
    this.replaced.set(from.id, sid);
    if (this.replaced.size > MAX_REPLACED) this.replaced.delete(this.replaced.keys().next().value);
    const sink = [];
    const s = this.ensureSession(sid, cwd ?? from.cwd, now, sink);
    s.branch = from.branch;
    s.floorSince = from.floorSince ?? from.boss.startedAt;
    out.push({ kind: "shift_change", fromSessionId: from.id, toSessionId: sid });
    return true;
  }
  trackOpenTool(m, name, toolUseId, agent) {
    if (name === "PreToolUse") {
      m.openTools.push({ id: toolUseId, agent });
      if (m.openTools.length > MAX_OPEN_TOOLS) m.openTools = m.openTools.slice(-MAX_OPEN_TOOLS);
      return;
    }
    const i = toolUseId ? m.openTools.findIndex((t) => t.id === toolUseId) : m.openTools.findIndex((t) => t.agent === agent);
    if (i >= 0) m.openTools.splice(i, 1);
  }
  /**
   * Returns the agent, creating it on demand (emits `spawned`). Returns undefined for retired agents.
   * `claim` matches the oldest unclaimed PreToolUse(Agent), preferring one whose subagent_type matches.
   */
  ensureAgent(s, m, id, now, out, o) {
    if (m.retired.has(id)) return void 0;
    const existing = s.agents[id];
    if (existing) return existing;
    const p = o.pending ?? (o.claim ? this.claim(m, o.type) : void 0);
    if (p) p.claimedBy = id;
    const parentId = p?.parentId && p.parentId !== id ? p.parentId : null;
    const a = {
      id,
      sessionId: s.id,
      parentId,
      type: o.type ?? p?.subagentType ?? "unknown",
      status: o.status ?? "working",
      startedAt: now,
      stats: emptyStats(now)
    };
    const task = o.task ?? p?.description;
    const name = o.name ?? p?.name;
    if (task) a.task = task;
    if (name) a.name = name;
    s.agents[id] = a;
    out.push({ kind: "spawned", sessionId: s.id, agentId: id });
    return a;
  }
  claim(m, agentType) {
    const open3 = m.pending.filter((p) => !p.claimedBy);
    return open3.find((p) => (p.subagentType ?? "general-purpose") === agentType) ?? open3[0];
  }
  agentActivity(s, m, id, e, now, out) {
    const a = this.ensureAgent(s, m, id, now, out, { type: str(e.agent_type), claim: true });
    if (!a) return;
    transitionAgent(a, "activity", now, this.stuckMs);
  }
  recordPending(m, e, callerId) {
    const toolUseId = str(e.tool_use_id);
    if (!toolUseId || m.pending.some((p) => p.toolUseId === toolUseId)) return;
    const input = isObj3(e.tool_input) ? e.tool_input : {};
    m.pending.push({
      toolUseId,
      parentId: callerId ?? null,
      description: str(input.description),
      subagentType: str(input.subagent_type),
      name: str(input.name)
    });
    if (m.pending.length > MAX_PENDING) m.pending = m.pending.slice(-MAX_PENDING);
  }
  /** PostToolUse(Agent).tool_response.agentId is the authoritative tool_use_id → agent link (hook-notes §2). */
  linkFromPostToolUse(s, m, e, now, out) {
    const resp = e.tool_response;
    const agentId = isObj3(resp) ? str(resp.agentId) : void 0;
    const toolUseId = str(e.tool_use_id);
    if (!agentId || m.retired.has(agentId)) return;
    const p = toolUseId ? m.pending.find((x) => x.toolUseId === toolUseId) : void 0;
    if (!p) {
      this.ensureAgent(s, m, agentId, now, out, {});
      return;
    }
    for (const other of m.pending) if (other !== p && other.claimedBy === agentId) other.claimedBy = void 0;
    const a = s.agents[agentId] ?? this.ensureAgent(s, m, agentId, now, out, { pending: p });
    if (!a) return;
    p.claimedBy = agentId;
    a.parentId = p.parentId && p.parentId !== agentId ? p.parentId : null;
    if (p.description) a.task = p.description;
    if (p.name) a.name = p.name;
    if (p.subagentType && a.type === "unknown") a.type = p.subagentType;
  }
  /** Stop.background_tasks: running subagents the store has not seen yet are created (hook-notes §6). */
  adoptBackgroundTasks(s, m, e, now, out) {
    if (!Array.isArray(e.background_tasks)) return;
    for (const t of e.background_tasks) {
      if (!isObj3(t)) continue;
      const id = str(t.id);
      if (!id || s.agents[id] || t.status !== "running" || t.type !== void 0 && t.type !== "subagent") continue;
      this.ensureAgent(s, m, id, now, out, { type: str(t.agent_type), task: str(t.description) });
    }
  }
  /** Two+ live sessions in one cwd: each gets subLabel = session title or the first 6 chars of its id. */
  refreshSubLabels() {
    const byCwd = /* @__PURE__ */ new Map();
    for (const s of Object.values(this.sessions)) {
      if (s.status !== "active" || !s.cwd) continue;
      byCwd.set(s.cwd, [...byCwd.get(s.cwd) ?? [], s]);
    }
    for (const s of Object.values(this.sessions)) {
      const group = s.status === "active" && s.cwd ? byCwd.get(s.cwd) : void 0;
      if (group && group.length > 1) s.subLabel = this.meta.get(s.id)?.title ?? s.id.slice(0, 6);
      else delete s.subLabel;
    }
  }
};

// src/core/app.ts
var RUNNING2 = /* @__PURE__ */ new Set(["spawning", "working", "quiet"]);
var defaultStaticDir = () => join5(fileURLToPath(new URL("../..", import.meta.url)), "dist", "scene");
async function startApp(opts = {}) {
  const cfg = opts.port !== void 0 && opts.token !== void 0 ? { port: opts.port, token: opts.token } : loadOrCreateConfig(opts.configDir);
  const port = opts.port ?? cfg.port;
  const token = opts.token ?? cfg.token;
  const cdir = opts.claudeDir ?? claudeDir();
  const store = new OfficeStore();
  const watcher = new LogWatcher();
  const tracked = /* @__PURE__ */ new Map();
  const dropped = /* @__PURE__ */ new Set();
  const transcripts = /* @__PURE__ */ new Map();
  watcher.on("delta", (sid, aid, d) => store.applyLog(sid, aid, d, Date.now()));
  const watchLog = (sessionId, agentId, path) => {
    if (!path || tracked.has(path) || dropped.has(path)) return;
    tracked.set(path, { sessionId, agentId, seen: false });
    watcher.watch(sessionId, agentId, path, { fromStart: true });
    syncWatches();
  };
  const seenSessions = /* @__PURE__ */ new Set();
  const syncWatches = () => {
    const sessions = store.peek();
    for (const [path, t] of tracked) {
      const s = sessions[t.sessionId];
      if (s) {
        seenSessions.add(t.sessionId);
        if (!t.agentId || s.agents[t.agentId]) {
          t.seen = true;
          continue;
        }
      }
      if (s ? t.seen : seenSessions.has(t.sessionId)) {
        watcher.unwatch(path);
        tracked.delete(path);
        dropped.add(path);
      }
    }
  };
  store.onChange(syncWatches);
  const rawApply = store.applyHook.bind(store);
  const synth = (e) => {
    rawApply(e, Date.now());
  };
  const hookSessions = /* @__PURE__ */ new Set();
  const known = /* @__PURE__ */ new Map();
  const pids = /* @__PURE__ */ new Map();
  const knownAgents = /* @__PURE__ */ new Map();
  const seedAgent = (sessionId, agentId, path, meta) => {
    knownAgents.set(path, { finished: meta.finished, typed: !!(meta.hasMeta || meta.type || meta.description) });
    if (meta.finished) return;
    const s = store.snapshot().sessions[sessionId];
    if (s && s.status === "active" && !s.agents[agentId]) {
      synth({ hook_event_name: "SubagentStart", session_id: sessionId, agent_id: agentId, agent_type: meta.type, description: meta.description });
    }
    watchLog(sessionId, agentId, path);
  };
  const addSession = (d, started = false) => {
    known.set(d.sessionId, { pid: d.pid, procStart: d.procStart, status: d.registryStatus, name: d.name });
    if (d.pid !== void 0) pids.set(d.pid, d.sessionId);
    const now = Date.now();
    const cur = store.snapshot().sessions[d.sessionId];
    if (!cur || cur.status === "ended" && d.pid !== void 0) {
      synth({ hook_event_name: "SessionStart", source: "discovered", session_id: d.sessionId, cwd: d.cwd });
      started = true;
    }
    if (started && d.registryStatus === "busy" && !hookSessions.has(d.sessionId)) synth({ hook_event_name: "UserPromptSubmit", session_id: d.sessionId });
    if (d.pid !== void 0) store.markLive(d.sessionId, now);
    store.setName(d.sessionId, d.name);
    if (d.mainLog) {
      if (!transcripts.has(d.sessionId)) transcripts.set(d.sessionId, d.mainLog);
      if (started) dropped.delete(d.mainLog);
      watchLog(d.sessionId, null, d.mainLog);
    }
    for (const a of d.subagentLogs) seedAgent(d.sessionId, a.agentId, a.path, a);
  };
  try {
    for (const d of discoverActiveSessions(cdir, Date.now())) addSession(d);
  } catch {
  }
  const rescanAgents = () => {
    const sessions = store.snapshot().sessions;
    for (const [sid, tp] of transcripts) {
      const s = sessions[sid];
      if (!s || s.status !== "active") continue;
      for (const f of listSubagentFiles(tp)) {
        try {
          const k = knownAgents.get(f.path);
          if (k?.finished) continue;
          const meta = readMeta(f.path);
          if (!k) {
            seedAgent(sid, f.agentId, f.path, meta);
            continue;
          }
          const a = s.agents[f.agentId];
          if (!k.typed && meta.hasMeta) {
            k.typed = true;
            if (a && (meta.type || meta.description)) {
              synth({ hook_event_name: "SubagentStart", session_id: sid, agent_id: f.agentId, agent_type: meta.type, description: meta.description });
            }
          }
          if (meta.finished) {
            k.finished = true;
            if (a && RUNNING2.has(a.status)) synth({ hook_event_name: "SubagentStop", session_id: sid, agent_id: f.agentId, agent_type: meta.type });
          }
        } catch {
        }
      }
    }
  };
  let registrySeen = !!readRegistry(cdir)?.length;
  const rescan = () => {
    try {
      const found = readRegistry(cdir);
      if (found?.length) registrySeen = true;
      const reg = found ?? (registrySeen ? [] : null);
      if (!reg) {
        for (const l of recentMainLogs(cdir, Date.now())) if (!known.has(l.sessionId)) addSession(sessionFromLog(l.sessionId, l.mainLog));
      } else {
        const now = Date.now();
        const live = /* @__PURE__ */ new Set();
        for (const r of reg) {
          live.add(r.pid);
          const k = known.get(r.sessionId);
          if (!k) {
            const prev = pids.get(r.pid);
            const old = prev !== void 0 && prev !== r.sessionId ? prev : r.formerSessionIds.find((id) => known.has(id));
            const d = sessionFromRegistry(cdir, r);
            let started = false;
            if (old) {
              const cur = store.snapshot().sessions;
              known.delete(old);
              if (cur[old]?.status === "active") synth({ hook_event_name: "SessionEnd", session_id: old, reason: "clear" });
              if (!cur[r.sessionId]) {
                synth(
                  cur[old] ? { hook_event_name: "SessionStart", source: "clear", replaces: old, session_id: r.sessionId, cwd: d.cwd ?? cur[old].cwd } : { hook_event_name: "SessionStart", source: "discovered", session_id: r.sessionId, cwd: d.cwd }
                );
                started = true;
              }
            }
            addSession(d, started);
            continue;
          }
          store.markLive(r.sessionId, now);
          if (r.procStart) k.procStart = r.procStart;
          if (k.pid !== r.pid) {
            if (k.pid !== void 0 && pids.get(k.pid) === r.sessionId) pids.delete(k.pid);
            k.pid = r.pid;
            pids.set(r.pid, r.sessionId);
          }
          if (k.name !== r.name) {
            k.name = r.name;
            store.setName(r.sessionId, r.name);
          }
          if (r.status && r.status !== k.status) {
            if (!hookSessions.has(r.sessionId) && store.snapshot().sessions[r.sessionId]?.status === "active") {
              synth({ hook_event_name: r.status === "busy" ? "UserPromptSubmit" : "Stop", session_id: r.sessionId });
            }
            k.status = r.status;
          }
          if (!transcripts.has(r.sessionId)) {
            const tp = findMainLog(cdir, r.sessionId, r.cwd);
            if (tp) {
              transcripts.set(r.sessionId, tp);
              watchLog(r.sessionId, null, tp);
            }
          }
        }
        for (const [pid, sid] of pids) {
          if (live.has(pid)) continue;
          const alive = pidAlive(pid);
          if (!alive) forgetPid(pid);
          const ps = known.get(sid)?.procStart;
          if (alive && !(ps && !procStartMatches(pid, ps, true))) continue;
          pids.delete(pid);
          known.delete(sid);
          if (store.snapshot().sessions[sid]?.status === "active") synth({ hook_event_name: "SessionEnd", session_id: sid, reason: "other" });
        }
      }
      rescanAgents();
    } catch {
    }
  };
  const watchFromHook = (e) => {
    try {
      if (typeof e.transcript_path === "string" && e.transcript_path && typeof e.session_id === "string" && !transcripts.has(e.session_id)) {
        transcripts.set(e.session_id, e.transcript_path);
        watchLog(e.session_id, null, e.transcript_path);
      }
      const tp = transcripts.get(e.session_id);
      if (e.hook_event_name === "SubagentStart" && e.agent_id && tp) {
        watchLog(e.session_id, e.agent_id, subagentLogPath(cdir, tp, e.agent_id));
      } else if (e.hook_event_name === "SubagentStop" && e.agent_id) {
        const p = e.agent_transcript_path ?? (tp ? subagentLogPath(cdir, tp, e.agent_id) : void 0);
        watchLog(e.session_id, e.agent_id, p);
      }
    } catch {
    }
  };
  store.applyHook = (e, t) => {
    const out = rawApply(e, t);
    if (e && typeof e.session_id === "string") hookSessions.add(e.session_id);
    watchFromHook(e);
    return out;
  };
  const tick = setInterval(() => store.tick(Date.now()), 1e3);
  const usage = opts.configDir !== void 0 ? new UsageLedger(join5(cdir, "projects"), join5(opts.configDir, "usage.json")) : void 0;
  void usage?.start();
  const rescanTimer = setInterval(rescan, opts.rescanMs ?? 3e3);
  let server;
  try {
    server = await startEventServer({ port, token, store, staticDir: opts.staticDir ?? defaultStaticDir(), version: opts.version, startedBy: opts.startedBy, onShutdown: opts.onShutdown, usage });
  } catch (err) {
    clearInterval(tick);
    clearInterval(rescanTimer);
    usage?.close();
    watcher.close();
    throw err;
  }
  return {
    url: server.url,
    store,
    watchedPaths: () => watcher.watchedPaths(),
    clientCount: () => server.clientCount(),
    async close() {
      clearInterval(tick);
      clearInterval(rescanTimer);
      usage?.close();
      watcher.close();
      await server.close();
    }
  };
}

// src/tracker/idle.ts
function shouldIdleExit(now, lastBusyAt2, idleMin2) {
  return now - lastBusyAt2 >= idleMin2 * 6e4;
}

// src/tracker/log.ts
import { appendFileSync, mkdirSync as mkdirSync3, renameSync as renameSync2, statSync as statSync4 } from "node:fs";
import { join as join6 } from "node:path";
var MAX_LOG_BYTES = 1024 * 1024;
function makeLogger(dir2) {
  const file = join6(dir2, "tracker.log");
  return (...parts) => {
    try {
      mkdirSync3(dir2, { recursive: true, mode: 448 });
      try {
        if (statSync4(file).size >= MAX_LOG_BYTES) renameSync2(file, `${file}.1`);
      } catch {
      }
      appendFileSync(file, `${(/* @__PURE__ */ new Date()).toISOString()} ${parts.map(String).join(" ")}
`, { mode: 384 });
    } catch {
    }
  };
}

// src/tracker/main.ts
var version = true ? "0.1.5" : "0.0.0";
function flag(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : void 0;
}
var dir = process.env.AGENT_OFFICE_DIR || join7(homedir2(), ".agent-office");
var log = makeLogger(dir);
var given = flag("started-by");
var startedBy = given === "plugin" || given === "app" ? given : "serve";
var idleMin = Number(flag("idle-exit-min") ?? 30);
var staticDir = join7(dirname2(fileURLToPath2(import.meta.url)), "scene");
var pidFile = join7(dir, "tracker.pid");
var app;
try {
  app = await startApp({ configDir: dir, staticDir, version, startedBy, onShutdown: () => stop("POST /shutdown") });
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (/in use/.test(msg)) process.exit(0);
  log("startApp failed", msg);
  process.exit(1);
}
writeFileSync3(pidFile, String(process.pid), { mode: 384 });
log(`tracker ${version} started by ${startedBy} at ${app.url}`);
var lastBusyAt = Date.now();
var stopping = false;
var stop = (why) => {
  if (stopping) return;
  stopping = true;
  log("exiting:", why);
  try {
    rmSync(pidFile, { force: true });
  } catch {
  }
  void app.close().finally(() => process.exit(0));
};
if (startedBy === "plugin" && Number.isFinite(idleMin) && idleMin > 0) {
  const timer = setInterval(() => {
    const now = Date.now();
    const sessions = Object.values(app.store.peek());
    if (app.clientCount() > 0 || sessions.some((s) => s.status !== "ended")) lastBusyAt = now;
    else if (shouldIdleExit(now, lastBusyAt, idleMin)) stop(`idle for ${idleMin} min`);
  }, 6e4);
  timer.unref();
}
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
