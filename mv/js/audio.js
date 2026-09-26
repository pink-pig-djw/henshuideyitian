/*
 * MV.AudioEngine — decode, playback clock and IndexedDB cache
 * (docs/ARCHITECTURE.md §3.2).
 *
 *   const eng = new MV.AudioEngine();
 *   await eng.loadURL('assets/song.mp3');      // or loadFile(file) / loadArrayBuffer(ab, name)
 *   eng.play();                                 // resumes an autoplay-suspended context
 *   const t = eng.currentTime;                  // audible song position (s)
 *
 * Playback uses one AudioBufferSourceNode at a time; it is recreated on every
 * play / seek / rate change. The clock is the audible context time (what is
 * being heard now): AudioContext.getOutputTimestamp() extrapolated with
 * performance.now() when available (smooth per frame), otherwise
 * ctx.currentTime − (outputLatency || baseLatency). The clock is an input to
 * rendering (t), not part of it — frames stay pure functions of t.
 * While the context is suspended (autoplay policy) the clock holds still and
 * a 'blocked' event tells the UI to ask for a click.
 *
 * Events (eng.on(name, fn) → unsubscribe):
 *   'loaded'  { name, duration, buffer }
 *   'play'    { t }         'pause' { t }        'seek' { t }
 *   'ended'   { t }         'rate'  { rate }     'volume' { volume }
 *   'blocked' { state }     (context still suspended ~0.4 s after play())
 *   'statechange' { state } (AudioContext state)
 *
 * Cache (static, never throws / never hangs):
 *   MV.AudioEngine.cacheSave(name, arrayBuffer) → Promise<boolean>
 *   MV.AudioEngine.cacheLoad()                  → Promise<{ name, arrayBuffer } | null>
 *   MV.AudioEngine.cacheClear()                 → Promise<boolean>
 *   IndexedDB database 'mv-cache', object store 'audio', key 'last'.
 */
(function () {
  'use strict';

  const MV = (window.MV = window.MV || {});

  const DB_NAME = 'mv-cache';
  const DB_STORE = 'audio';
  const DB_KEY = 'last';
  const DB_TIMEOUT_MS = 4000;
  const BLOCKED_CHECK_MS = 400;

  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

  // decodeAudioData with both the promise and the legacy callback forms.
  function decode(ctx, data) {
    return new Promise((resolve, reject) => {
      let done = false;
      const ok = (buf) => {
        if (done) return;
        done = true;
        resolve(buf);
      };
      const fail = (e) => {
        if (done) return;
        done = true;
        const err = new Error('音频解码失败 (could not decode audio)' + (e && e.message ? ': ' + e.message : ''));
        err.cause = e;
        reject(err);
      };
      try {
        const p = ctx.decodeAudioData(data, ok, fail);
        if (p && typeof p.then === 'function') p.then(ok, fail);
      } catch (e) {
        fail(e);
      }
    });
  }

  // XHR fallback for fetch() (some browsers allow it for file:// pages).
  function xhrArrayBuffer(url) {
    return new Promise((resolve, reject) => {
      try {
        const x = new XMLHttpRequest();
        x.open('GET', url, true);
        x.responseType = 'arraybuffer';
        x.onload = () => {
          if ((x.status === 200 || x.status === 0) && x.response && x.response.byteLength) resolve(x.response);
          else reject(new Error('HTTP ' + x.status));
        };
        x.onerror = () => reject(new Error('network error'));
        x.send();
      } catch (e) {
        reject(e);
      }
    });
  }

  function nameFromURL(url) {
    try {
      const last = String(url).split(/[?#]/)[0].split('/').pop();
      return decodeURIComponent(last) || 'audio';
    } catch (e) {
      return 'audio';
    }
  }

  class AudioEngine {
    /** @param {{volume?:number}} [opts] */
    constructor(opts = {}) {
      this.ctx = null;
      this.buffer = null;
      this.name = '';
      /** Last loaded, still-attached ArrayBuffer (decoding uses a copy) — handy for cacheSave. */
      this.arrayBuffer = null;
      this._gain = null;
      this._src = null;
      this._srcToken = 0;
      this._startCtx = 0; // ctx.currentTime when the current source was started
      this._startPos = 0; // song position at that moment
      this._pos = 0; // song position while paused
      this._lastT = 0; // last reported position (monotonic guard)
      this._playing = false;
      this._rate = 1;
      this._volume = opts.volume == null ? 1 : clamp(+opts.volume || 0, 0, 1);
      this._listeners = new Map();
      this._streamDest = null;
      this._blockedTimer = 0;
    }

    /* ---------------- state ---------------- */
    get duration() {
      return this.buffer ? this.buffer.duration : 0;
    }
    get playing() {
      return this._playing;
    }
    get rate() {
      return this._rate;
    }
    get volume() {
      return this._volume;
    }
    /** AudioContext state: 'none' | 'suspended' | 'running' | 'closed'. */
    get state() {
      return this.ctx ? this.ctx.state : 'none';
    }
    /** Output latency compensated by the clock (s). */
    get latency() {
      const c = this.ctx;
      if (!c) return 0;
      const l = c.outputLatency || c.baseLatency || 0;
      return Number.isFinite(l) && l > 0 && l < 1 ? l : 0;
    }
    /**
     * Audible context time (s). Spec formula: ctx.currentTime − output
     * latency. ctx.currentTime only advances once per audio callback (8–20 ms
     * steps in Chrome), which makes per-frame deltas uneven; when the context
     * is running and getOutputTimestamp() is valid we instead extrapolate the
     * browser's own "sample being heard now" timestamp, which is smooth.
     */
    _audibleCtxTime(perfNowMs) {
      const ctx = this.ctx;
      const base = ctx.currentTime - this.latency;
      if (ctx.state !== 'running' || typeof ctx.getOutputTimestamp !== 'function' || typeof performance === 'undefined') return base;
      let o = null;
      try {
        o = ctx.getOutputTimestamp();
      } catch (e) {
        o = null;
      }
      if (!o || !(o.contextTime > 0) || !(o.performanceTime > 0)) return base;
      const now = perfNowMs == null ? performance.now() : perfNowMs;
      const t = o.contextTime + (now - o.performanceTime) / 1000;
      // Sanity: must lie within [currentTime − 0.5 s, currentTime + 0.1 s].
      return t <= ctx.currentTime + 0.1 && t > ctx.currentTime - 0.5 ? t : base;
    }

    /**
     * Audible song position at a performance.now() timestamp (ms), e.g. the
     * requestAnimationFrame timestamp, for vsync-aligned frame times. Not
     * monotonic-guarded; clamped to [0, duration].
     */
    timeAt(perfNowMs) {
      const d = this.duration;
      if (!this._playing || !this.ctx) return clamp(this._pos, 0, d);
      const el = (this._audibleCtxTime(perfNowMs) - this._startCtx) * this._rate;
      return clamp(this._startPos + Math.max(0, el), 0, d);
    }

    /** Audible song position (s), clamped to [0, duration]; monotonic while playing. */
    get currentTime() {
      const d = this.duration;
      if (!this._playing || !this.ctx) return clamp(this._pos, 0, d);
      const el = (this._audibleCtxTime() - this._startCtx) * this._rate;
      let t = clamp(this._startPos + Math.max(0, el), 0, d);
      // Never step backwards by jitter within one playback segment.
      if (t < this._lastT && this._lastT - t < 0.05) t = this._lastT;
      this._lastT = t;
      return t;
    }

    /* ---------------- events ---------------- */
    /** Subscribe; returns an unsubscribe function. */
    on(ev, fn) {
      if (typeof fn !== 'function') return () => {};
      if (!this._listeners.has(ev)) this._listeners.set(ev, new Set());
      this._listeners.get(ev).add(fn);
      return () => this.off(ev, fn);
    }
    off(ev, fn) {
      const s = this._listeners.get(ev);
      if (s) s.delete(fn);
    }
    _emit(ev, data) {
      const s = this._listeners.get(ev);
      if (!s) return;
      Array.from(s).forEach((fn) => {
        try {
          fn(data);
        } catch (e) {
          console.error('[MV.AudioEngine]', ev, e);
        }
      });
    }

    /* ---------------- context ---------------- */
    _ensureCtx() {
      if (this.ctx && this.ctx.state !== 'closed') return this.ctx;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      let ctx = null;
      try {
        ctx = new AC();
      } catch (e) {
        return null;
      }
      this.ctx = ctx;
      this._gain = ctx.createGain();
      this._gain.gain.value = this._volume;
      this._gain.connect(ctx.destination);
      this._streamDest = null;
      try {
        ctx.onstatechange = () => this._emit('statechange', { state: ctx.state });
      } catch (e) {
        /* ignore */
      }
      return ctx;
    }

    /**
     * Resume a suspended context (call from a user gesture to unlock audio).
     * Resolves true when running, false otherwise (never hangs > timeoutMs).
     */
    unlock(timeoutMs = 1500) {
      const ctx = this._ensureCtx();
      if (!ctx) return Promise.resolve(false);
      if (ctx.state === 'running') return Promise.resolve(true);
      return new Promise((resolve) => {
        const t = setTimeout(() => resolve(ctx.state === 'running'), timeoutMs);
        let p = null;
        try {
          p = ctx.resume();
        } catch (e) {
          p = null;
        }
        Promise.resolve(p)
          .then(() => {
            clearTimeout(t);
            resolve(ctx.state === 'running');
          })
          .catch(() => {
            clearTimeout(t);
            resolve(false);
          });
      });
    }

    _resumeForPlay() {
      const ctx = this.ctx;
      if (!ctx || ctx.state === 'running') return;
      try {
        const p = ctx.resume();
        if (p && p.catch) p.catch(() => {});
      } catch (e) {
        /* ignore */
      }
      clearTimeout(this._blockedTimer);
      this._blockedTimer = setTimeout(() => {
        if (this._playing && this.ctx && this.ctx.state === 'suspended') this._emit('blocked', { state: this.ctx.state });
      }, BLOCKED_CHECK_MS);
    }

    /* ---------------- loading ---------------- */
    /**
     * Decode an ArrayBuffer (a copy is decoded; `ab` stays usable for caching).
     * @returns {Promise<AudioBuffer>}
     */
    async loadArrayBuffer(ab, name = 'audio') {
      if (!ab || !ab.byteLength) throw new Error('音频数据为空 (empty audio data)');
      const ctx = this._ensureCtx();
      if (!ctx) throw new Error('浏览器不支持 Web Audio (Web Audio API unavailable)');
      const buffer = await decode(ctx, ab.slice(0));
      const wasPlaying = this._playing;
      this._stopSource();
      this._playing = false;
      this._pos = 0;
      if (wasPlaying) this._emit('pause', { t: 0 });
      this.buffer = buffer;
      this.name = String(name || 'audio');
      this.arrayBuffer = ab;
      this._emit('loaded', { name: this.name, duration: buffer.duration, buffer });
      return buffer;
    }

    /** @param {File|Blob} file @returns {Promise<AudioBuffer>} */
    async loadFile(file) {
      if (!file) throw new Error('没有文件 (no file)');
      let ab;
      if (typeof file.arrayBuffer === 'function') ab = await file.arrayBuffer();
      else {
        ab = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = () => reject(r.error || new Error('read failed'));
          r.readAsArrayBuffer(file);
        });
      }
      return this.loadArrayBuffer(ab, file.name || 'audio');
    }

    /** Fetch (XHR fallback) and decode. @returns {Promise<AudioBuffer>} */
    async loadURL(url, name) {
      let ab = null, firstErr = null;
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        ab = await res.arrayBuffer();
      } catch (e) {
        firstErr = e;
      }
      if (!ab || !ab.byteLength) {
        try {
          ab = await xhrArrayBuffer(url);
        } catch (e) {
          const err = new Error('无法加载音频 (could not load audio): ' + url + ' — ' + ((firstErr && firstErr.message) || e.message));
          err.cause = firstErr || e;
          throw err;
        }
      }
      return this.loadArrayBuffer(ab, name || nameFromURL(url));
    }

    /* ---------------- transport ---------------- */
    _stopSource() {
      const src = this._src;
      this._src = null;
      this._srcToken++;
      if (!src) return;
      try {
        src.onended = null;
      } catch (e) {
        /* ignore */
      }
      try {
        src.stop();
      } catch (e) {
        /* already stopped */
      }
      try {
        src.disconnect();
      } catch (e) {
        /* ignore */
      }
    }

    _startSource(pos) {
      const ctx = this.ctx;
      this._stopSource();
      const src = ctx.createBufferSource();
      src.buffer = this.buffer;
      try {
        src.playbackRate.value = this._rate;
      } catch (e) {
        /* ignore */
      }
      src.connect(this._gain);
      const token = this._srcToken;
      src.onended = () => {
        if (token !== this._srcToken || !this._playing) return;
        this._src = null;
        this._playing = false;
        this._pos = this.duration;
        this._emit('ended', { t: this._pos });
      };
      this._startCtx = ctx.currentTime;
      this._startPos = pos;
      this._lastT = pos;
      src.start(0, clamp(pos, 0, Math.max(0, this.duration - 1e-4)));
      this._src = src;
    }

    /**
     * Start playback (from `from` seconds, or the paused position; restarts
     * from 0 when at the end). Returns false when nothing is loaded.
     */
    play(from) {
      if (!this.buffer) return false;
      const ctx = this._ensureCtx();
      if (!ctx) return false;
      const hasFrom = from != null && Number.isFinite(+from);
      if (this._playing) {
        if (hasFrom) this.seek(+from);
        this._resumeForPlay();
        return true;
      }
      let pos = hasFrom ? +from : this._pos;
      if (!hasFrom && pos >= this.duration - 1e-3) pos = 0;
      pos = clamp(pos, 0, this.duration);
      try {
        this._startSource(pos);
      } catch (e) {
        console.error('[MV.AudioEngine] play failed', e);
        return false;
      }
      this._pos = pos;
      this._playing = true;
      this._resumeForPlay();
      this._emit('play', { t: pos });
      return true;
    }

    pause() {
      if (!this._playing) return;
      this._pos = this.currentTime;
      this._stopSource();
      this._playing = false;
      clearTimeout(this._blockedTimer);
      this._emit('pause', { t: this._pos });
    }

    toggle() {
      if (this._playing) this.pause();
      else this.play();
      return this._playing;
    }

    /** Jump to `t` seconds (keeps playing if playing). */
    seek(t) {
      if (!this.buffer) return;
      const pos = clamp(+t || 0, 0, this.duration);
      if (this._playing && this.ctx) {
        try {
          this._startSource(pos);
        } catch (e) {
          console.error('[MV.AudioEngine] seek failed', e);
        }
      }
      this._pos = pos;
      this._emit('seek', { t: pos });
    }

    /** Volume 0..1 (short ramp, no clicks). */
    setVolume(v) {
      this._volume = clamp(+v || 0, 0, 1);
      if (this._gain && this.ctx) {
        try {
          this._gain.gain.cancelScheduledValues(this.ctx.currentTime);
          this._gain.gain.setTargetAtTime(this._volume, this.ctx.currentTime, 0.015);
        } catch (e) {
          this._gain.gain.value = this._volume;
        }
      }
      this._emit('volume', { volume: this._volume });
    }

    /** Playback rate 0.25..4 (pitch follows; the source restarts). */
    setRate(r) {
      const rate = clamp(+r || 1, 0.25, 4);
      if (rate === this._rate) return;
      if (this._playing && this.ctx) {
        const pos = this.currentTime;
        this._rate = rate;
        try {
          this._startSource(pos);
        } catch (e) {
          console.error('[MV.AudioEngine] rate change failed', e);
        }
      } else this._rate = rate;
      this._emit('rate', { rate });
    }

    /**
     * MediaStream carrying the output (for MediaRecorder export); audio keeps
     * going to the speakers too. Lazily created; null when unsupported.
     * @returns {MediaStream|null}
     */
    streamDestination() {
      const ctx = this._ensureCtx();
      if (!ctx) return null;
      if (!this._streamDest) {
        try {
          this._streamDest = ctx.createMediaStreamDestination();
          this._gain.connect(this._streamDest);
        } catch (e) {
          this._streamDest = null;
          return null;
        }
      }
      return this._streamDest.stream;
    }

    /** Stop playback and release the AudioContext. */
    dispose() {
      this._stopSource();
      this._playing = false;
      clearTimeout(this._blockedTimer);
      const ctx = this.ctx;
      this.ctx = null;
      this._gain = null;
      this._streamDest = null;
      if (ctx && ctx.close) {
        try {
          const p = ctx.close();
          if (p && p.catch) p.catch(() => {});
        } catch (e) {
          /* ignore */
        }
      }
      this._listeners.clear();
    }
  }

  /* ------------------------------------------------------------------ */
  /* IndexedDB cache (never throws, never hangs)                         */
  /* ------------------------------------------------------------------ */
  function withTimeout(promise, ms, fallback) {
    return new Promise((resolve) => {
      let done = false;
      const t = setTimeout(() => {
        if (!done) {
          done = true;
          resolve(fallback);
        }
      }, ms);
      promise.then(
        (v) => {
          if (!done) {
            done = true;
            clearTimeout(t);
            resolve(v);
          }
        },
        () => {
          if (!done) {
            done = true;
            clearTimeout(t);
            resolve(fallback);
          }
        }
      );
    });
  }

  function openDB() {
    return new Promise((resolve, reject) => {
      let idb = null;
      try {
        idb = window.indexedDB;
      } catch (e) {
        idb = null; // SecurityError on some file:// / sandboxed contexts
      }
      if (!idb) return reject(new Error('no IndexedDB'));
      let req;
      try {
        req = idb.open(DB_NAME, 1);
      } catch (e) {
        return reject(e);
      }
      req.onupgradeneeded = () => {
        try {
          const db = req.result;
          if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
        } catch (e) {
          /* ignore */
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('open failed'));
      req.onblocked = () => reject(new Error('blocked'));
    });
  }

  function dbRequest(mode, fn) {
    const job = openDB().then(
      (db) =>
        new Promise((resolve, reject) => {
          let tx, result;
          const close = () => {
            try {
              db.close();
            } catch (e) {
              /* ignore */
            }
          };
          try {
            tx = db.transaction(DB_STORE, mode);
          } catch (e) {
            close();
            return reject(e);
          }
          tx.oncomplete = () => {
            close();
            resolve(result);
          };
          tx.onerror = tx.onabort = () => {
            close();
            reject(tx.error || new Error('transaction failed'));
          };
          try {
            const req = fn(tx.objectStore(DB_STORE));
            if (req) req.onsuccess = () => (result = req.result);
          } catch (e) {
            try {
              tx.abort();
            } catch (e2) {
              /* ignore */
            }
            close();
            reject(e);
          }
        })
    );
    return job;
  }

  /**
   * Save the last used audio file. Accepts an ArrayBuffer (or Blob/File).
   * @returns {Promise<boolean>} true on success; never throws.
   */
  AudioEngine.cacheSave = function (name, data) {
    const run = async () => {
      let ab = data;
      if (ab && typeof ab.arrayBuffer === 'function' && !(ab instanceof ArrayBuffer)) ab = await ab.arrayBuffer();
      if (!ab || !ab.byteLength) return false;
      await dbRequest('readwrite', (store) => store.put({ name: String(name || 'audio'), arrayBuffer: ab, size: ab.byteLength }, DB_KEY));
      return true;
    };
    let p;
    try {
      p = run();
    } catch (e) {
      return Promise.resolve(false);
    }
    return withTimeout(p, DB_TIMEOUT_MS * 3, false);
  };

  /**
   * Load the cached audio file.
   * @returns {Promise<{name:string, arrayBuffer:ArrayBuffer}|null>} never throws.
   */
  AudioEngine.cacheLoad = function () {
    let p;
    try {
      p = dbRequest('readonly', (store) => store.get(DB_KEY)).then((rec) =>
        rec && rec.arrayBuffer && rec.arrayBuffer.byteLength ? { name: rec.name || 'audio', arrayBuffer: rec.arrayBuffer } : null
      );
    } catch (e) {
      return Promise.resolve(null);
    }
    return withTimeout(p, DB_TIMEOUT_MS, null);
  };

  /** Remove the cached file. @returns {Promise<boolean>} never throws. */
  AudioEngine.cacheClear = function () {
    let p;
    try {
      p = dbRequest('readwrite', (store) => store.delete(DB_KEY)).then(() => true);
    } catch (e) {
      return Promise.resolve(false);
    }
    return withTimeout(p, DB_TIMEOUT_MS, false);
  };

  MV.AudioEngine = AudioEngine;
})();
