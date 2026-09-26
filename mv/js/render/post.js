/*
 * MV.Post — full-frame post-processing (ARCHITECTURE §3.7).
 *
 *   const post = new MV.Post(outputCanvas, { preserveDrawingBuffer: true, prefer: 'auto' });
 *   post.resize(w, h);
 *   post.render(sourceCanvas, { rgbShift, glitch, glitchSeed, grain, vignette, flash,
 *                               redFlash, invert, scanlines, time });   // → true if drawn
 *   post.isWebGL; post.mode ('webgl2' | 'webgl' | '2d' | 'none'); post.dispose();
 *
 * WebGL2 → WebGL1 → Canvas2D fallback. One fullscreen fragment pass samples the
 * source canvas as a texture. Parameters (all optional, missing = 0):
 *   rgbShift   px (logical 1920-wide units) — red/blue channels pushed apart
 *   glitch     0..1 — block-row displacement + occasional inverted blocks
 *   glitchSeed number — picks the glitch pattern (change it to re-roll)
 *   grain      0..1 — hash noise, re-rolled 24× per second of `time`
 *   vignette   0..1 — radial darkening
 *   flash      0..1 — screen-blend towards white
 *   redFlash   0..1 — screen-blend towards MV.C.red
 *   invert     0..1 — mix towards the negative
 *   scanlines  0..1 — darkened lines every 4 logical px
 *   time       seconds (song time; drives the grain)
 * Output is a pure function of (source pixels, params) — no clocks, no Math.random.
 *
 * Context loss: rendering is skipped (render → false) while the GL context is
 * lost; resources are rebuilt on 'webglcontextrestored'. A canvas that already
 * owns a 2D context can't get WebGL — the 2D fallback is used automatically.
 * `prefer: 'webgl1' | '2d'` forces a lower tier (for tests).
 */
(function () {
  'use strict';
  const MV = window.MV;
  if (!MV) return;

  const VERT = [
    'attribute vec2 aPos;',
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = aPos * 0.5 + 0.5;',
    '  gl_Position = vec4(aPos, 0.0, 1.0);',
    '}',
  ].join('\n');

  // GLSL ES 1.00 — valid in both WebGL1 and WebGL2 contexts.
  const FRAG = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    'varying vec2 vUv;',
    'uniform sampler2D uTex;',
    'uniform vec2 uRes;',
    'uniform float uShift, uGlitch, uSeed, uGrain, uVig, uFlash, uRed, uInv, uScan, uTime;',
    'float hash(vec2 p) {',
    '  vec3 p3 = fract(vec3(p.xyx) * 0.1031);',
    '  p3 += dot(p3, p3.yzx + 33.33);',
    '  return fract((p3.x + p3.y) * p3.z);',
    '}',
    'void main() {',
    '  vec2 uv = vUv;',
    '  float ys = 1.0 - uv.y;',              // 0 at the top
    '  float inv = 0.0;',
    '  float tear = 0.0;',
    '  if (uGlitch > 0.001) {',
    '    float sd = floor(uSeed);',
    '    float rowsA = 7.0 + floor(hash(vec2(sd, 1.7)) * 9.0);',
    '    float rowsB = 28.0 + floor(hash(vec2(sd, 3.1)) * 36.0);',
    '    float ra = floor(ys * rowsA), rb = floor(ys * rowsB);',
    '    float ha = hash(vec2(ra, sd + 11.0)), hb = hash(vec2(rb, sd + 23.0));',
    '    float d = 0.0;',
    '    if (ha < uGlitch * 0.35) d += (hash(vec2(ra, sd + 5.0)) - 0.5) * 0.22 * uGlitch;',
    '    if (hb < uGlitch * 0.5) { d += (hash(vec2(rb, sd + 9.0)) - 0.5) * 0.12 * uGlitch; tear = 1.0; }',
    '    uv.x = fract(uv.x + d);',
    '    vec2 cell = floor(vec2(uv.x * 12.0, ys * rowsB));',
    '    if (hash(cell + vec2(sd * 0.37, sd * 0.11 + 41.0)) < uGlitch * 0.045) inv = 1.0;',
    '  }',
    '  float k = uRes.x / 1920.0;',
    '  float sh = (uShift + tear * uGlitch * 14.0) * k;',
    '  vec2 off = vec2(sh / uRes.x, -sh * 0.21 / uRes.y);', // along the −12° house angle
    '  vec4 c0 = texture2D(uTex, uv);',
    '  vec3 col = c0.rgb;',
    '  if (sh > 0.01) {',
    '    col.r = texture2D(uTex, uv + off).r;',
    '    col.b = texture2D(uTex, uv - off).b;',
    '  }',
    '  col = mix(col, 1.0 - col, clamp(max(uInv, inv), 0.0, 1.0));',
    '  if (uVig > 0.001) {',
    '    vec2 q = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);',
    '    float v = smoothstep(0.42, 1.12, length(q) * 1.18);',
    '    col *= 1.0 - clamp(uVig, 0.0, 1.0) * v;',
    '  }',
    '  if (uScan > 0.001) {',
    '    float ly = mod(floor(gl_FragCoord.y / max(1.0, uRes.y / 1080.0)), 4.0);',
    '    col *= 1.0 - uScan * 0.32 * step(2.0, ly);',
    '  }',
    '  if (uGrain > 0.001) {',
    '    float fr = floor(uTime * 24.0);',
    '    float n = hash(gl_FragCoord.xy + vec2(mod(fr * 37.0, 911.0), mod(fr * 71.0, 577.0)));',
    '    col += (n - 0.5) * uGrain * 0.28;',
    '  }',
    '  col = 1.0 - (1.0 - col) * (1.0 - clamp(uRed, 0.0, 1.0) * vec3(0.902, 0.0, 0.071));',
    '  col = mix(col, vec3(1.0), clamp(uFlash, 0.0, 1.0));',
    '  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);',
    '}',
  ].join('\n');

  // Plain copy for neutral frames (all effects ≈ 0): cheapest possible pass.
  const FRAG_COPY = [
    'precision mediump float;',
    'varying vec2 vUv;',
    'uniform sampler2D uTex;',
    'void main() { gl_FragColor = vec4(texture2D(uTex, vUv).rgb, 1.0); }',
  ].join('\n');

  const UNIFORMS = ['uTex', 'uRes', 'uShift', 'uGlitch', 'uSeed', 'uGrain', 'uVig', 'uFlash', 'uRed', 'uInv', 'uScan', 'uTime'];
  const EPS = 1e-3;
  const isNeutral = (P) =>
    !(num(P.rgbShift) > 0.01 || num(P.glitch) > EPS || num(P.grain) > EPS || num(P.vignette) > EPS || num(P.flash) > EPS ||
      num(P.redFlash) > EPS || num(P.invert) > EPS || num(P.scanlines) > EPS);
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);

  /**
   * @param {HTMLCanvasElement} canvas output canvas (Post owns its context)
   * @param {{preserveDrawingBuffer?: boolean, prefer?: 'auto'|'webgl2'|'webgl1'|'2d'}} [opts]
   */
  function Post(canvas, opts) {
    this.canvas = canvas;
    this.opts = Object.assign({ preserveDrawingBuffer: true, prefer: 'auto' }, opts || {});
    this.mode = 'none';
    this.gl = null;
    this.ctx2d = null;
    this.lost = false;
    this.error = null;
    this._res = null;
    this._texW = 0;
    this._texH = 0;
    this._fb = null; // 2D-fallback caches
    this._onLost = (e) => {
      try { e.preventDefault(); } catch (err) { /* ignore */ }
      this.lost = true;
      this._res = null;
      this._texW = this._texH = 0;
    };
    this._onRestored = () => {
      this.lost = false;
      try {
        this._initGL();
      } catch (err) {
        this.error = String(err && err.message || err);
        MV.log && MV.log('Post: restore failed', this.error);
      }
    };
    this._init();
  }

  Post.prototype._init = function () {
    const c = this.canvas;
    const prefer = this.opts.prefer;
    const attrs = {
      alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: !!this.opts.preserveDrawingBuffer,
      powerPreference: 'high-performance',
    };
    const tryGL = (kind) => {
      try {
        const gl = c.getContext(kind, attrs);
        if (!gl) return false;
        this.gl = gl;
        this.mode = kind === 'webgl2' ? 'webgl2' : 'webgl';
        this._initGL();
        return true;
      } catch (err) {
        this.error = String(err && err.message || err);
        this.gl = null;
        this.mode = 'none';
        return false;
      }
    };
    let ok = false;
    if (prefer !== '2d') {
      if (prefer !== 'webgl1') ok = tryGL('webgl2');
      if (!ok) ok = tryGL('webgl') || tryGL('experimental-webgl');
    }
    if (ok) {
      c.addEventListener('webglcontextlost', this._onLost, false);
      c.addEventListener('webglcontextrestored', this._onRestored, false);
      return;
    }
    try {
      this.ctx2d = c.getContext('2d');
      this.mode = this.ctx2d ? '2d' : 'none';
    } catch (err) {
      this.mode = 'none';
    }
  };

  Post.prototype._initGL = function () {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        const log = gl.getShaderInfoLog(s);
        gl.deleteShader(s);
        throw new Error('Post shader: ' + log);
      }
      return s;
    };
    const link = (fsrc) => {
      const vs = sh(gl.VERTEX_SHADER, VERT);
      const fs = sh(gl.FRAGMENT_SHADER, fsrc);
      const pr = gl.createProgram();
      gl.attachShader(pr, vs);
      gl.attachShader(pr, fs);
      gl.bindAttribLocation(pr, 0, 'aPos');
      gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error('Post link: ' + gl.getProgramInfoLog(pr));
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return pr;
    };
    const prog = link(FRAG);
    const copy = link(FRAG_COPY);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); // one big triangle
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const loc = {};
    UNIFORMS.forEach((u) => (loc[u] = gl.getUniformLocation(prog, u)));
    this._res = { prog, copy, copyTex: gl.getUniformLocation(copy, 'uTex'), buf, tex, loc };
    this._texW = this._texH = 0;
  };

  /** Resize the output canvas (backing pixels). */
  Post.prototype.resize = function (w, h) {
    w = Math.max(1, Math.round(w || 1));
    h = Math.max(1, Math.round(h || 1));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  };

  /** True while a WebGL path is active. */
  Object.defineProperty(Post.prototype, 'isWebGL', {
    get() {
      return this.mode === 'webgl2' || this.mode === 'webgl';
    },
  });

  /**
   * Composite `src` into the output canvas with the given effect params.
   * @returns {boolean} false if nothing could be drawn (e.g. context lost).
   */
  Post.prototype.render = function (src, params) {
    if (!src || !(src.width > 0) || !(src.height > 0)) return false;
    const P = params || {};
    if (this.isWebGL) return this._renderGL(src, P);
    if (this.mode === '2d') return this._render2D(src, P);
    return false;
  };

  Post.prototype._renderGL = function (src, P) {
    const gl = this.gl;
    if (this.lost || !this._res || gl.isContextLost()) return false;
    const r = this._res;
    const w = this.canvas.width, h = this.canvas.height;
    const neutral = isNeutral(P);
    gl.viewport(0, 0, w, h);
    gl.useProgram(neutral ? r.copy : r.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, r.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    try {
      if (src.width !== this._texW || src.height !== this._texH) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
        this._texW = src.width;
        this._texH = src.height;
      } else {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
      }
    } catch (err) {
      this.error = String(err && err.message || err);
      return false;
    }
    const L = r.loc;
    if (neutral) {
      gl.uniform1i(r.copyTex, 0);
    } else {
      gl.uniform1i(L.uTex, 0);
      gl.uniform2f(L.uRes, w, h);
      gl.uniform1f(L.uShift, Math.max(0, num(P.rgbShift)));
      gl.uniform1f(L.uGlitch, MV.clamp(num(P.glitch)));
      gl.uniform1f(L.uSeed, MV.mod(Math.floor(num(P.glitchSeed)), 65521));
      gl.uniform1f(L.uGrain, MV.clamp(num(P.grain)));
      gl.uniform1f(L.uVig, MV.clamp(num(P.vignette)));
      gl.uniform1f(L.uFlash, MV.clamp(num(P.flash)));
      gl.uniform1f(L.uRed, MV.clamp(num(P.redFlash)));
      gl.uniform1f(L.uInv, MV.clamp(num(P.invert)));
      gl.uniform1f(L.uScan, MV.clamp(num(P.scanlines)));
      gl.uniform1f(L.uTime, MV.mod(num(P.time), 3600));
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, r.buf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  };

  // --- Canvas2D fallback: drawImage + cheap overlays -------------------------
  Post.prototype._fallbackCache = function (w, h) {
    const fb = this._fb;
    if (fb && fb.w === w && fb.h === h) return fb;
    // radial vignette sprite (black, transparent centre)
    const v = MV.makeCanvas(w, h);
    const g = v.ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.34, w / 2, h / 2, Math.hypot(w, h) * 0.56);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,1)');
    v.ctx.fillStyle = g;
    v.ctx.fillRect(0, 0, w, h);
    // scanline tile (every 4 logical px → 2 dark)
    const k = Math.max(1, Math.round(h / 1080));
    const sl = MV.makeCanvas(64, 64 * k);
    sl.ctx.fillStyle = 'rgba(0,0,0,1)';
    for (let y = 0; y < 64 * k; y += 4 * k) sl.ctx.fillRect(0, y + 2 * k, 64, 2 * k);
    this._fb = { w, h, vig: v.canvas, scan: null, scanTile: sl.canvas };
    return this._fb;
  };

  Post.prototype._render2D = function (src, P) {
    const ctx = this.ctx2d;
    const w = this.canvas.width, h = this.canvas.height;
    const fb = this._fallbackCache(w, h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(src, 0, 0, w, h);
    const k = w / 1920;
    // rgbShift: cheap double-image approximation (source-over ghost)
    const shift = Math.max(0, num(P.rgbShift)) * k;
    if (shift > 0.5) {
      ctx.globalAlpha = 0.3;
      ctx.drawImage(src, Math.round(shift), -Math.round(shift * 0.21), w, h); // integer offset → unfiltered blit
      ctx.globalAlpha = 1;
    }
    // glitch: displaced row bands + a few inverted blocks
    const gl = MV.clamp(num(P.glitch));
    if (gl > 0.001) {
      const sd = Math.floor(num(P.glitchSeed));
      const rows = 28 + Math.floor(MV.rand(sd, 3) * 36);
      const sh = src.height / h;
      const rh = h / rows;
      for (let i = 0; i < rows; i++) {
        if (MV.rand(sd, i, 23) >= gl * 0.5) continue;
        const dx = (MV.rand(sd, i, 9) - 0.5) * 0.24 * gl * w;
        const y = i * rh;
        ctx.drawImage(src, 0, y * sh, src.width, rh * sh, dx, y, w, rh);
        ctx.drawImage(src, 0, y * sh, src.width, rh * sh, dx - Math.sign(dx) * w, y, w, rh);
      }
      ctx.globalCompositeOperation = 'difference';
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 12 * rows; i++) {
        if (MV.rand(sd, i, 41) >= gl * 0.045) continue;
        const cx = i % 12, cy = Math.floor(i / 12);
        ctx.fillRect((cx * w) / 12, cy * rh, w / 12, rh);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    const inv = MV.clamp(num(P.invert));
    if (inv > 0.001) {
      ctx.globalCompositeOperation = 'difference';
      ctx.globalAlpha = inv;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    const vig = MV.clamp(num(P.vignette));
    if (vig > 0.001) {
      ctx.globalAlpha = vig;
      ctx.drawImage(fb.vig, 0, 0);
      ctx.globalAlpha = 1;
    }
    const scan = MV.clamp(num(P.scanlines));
    if (scan > 0.001) {
      if (!fb.scan) fb.scan = ctx.createPattern(fb.scanTile, 'repeat');
      ctx.globalAlpha = scan * 0.32;
      ctx.fillStyle = fb.scan;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }
    const grain = MV.clamp(num(P.grain));
    if (grain > 0.001 && MV.patterns && MV.patterns.grain) {
      const fr = Math.floor(num(P.time) * 24);
      ctx.globalAlpha = Math.min(1, grain * 1.6);
      ctx.fillStyle = MV.patterns.grain(ctx, MV.mod(fr, 8), 0.35);
      ctx.save();
      ctx.translate(-MV.mod(fr * 37, 256), -MV.mod(fr * 91, 256));
      ctx.fillRect(0, 0, w + 256, h + 256);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    const red = MV.clamp(num(P.redFlash));
    if (red > 0.001) {
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = red;
      ctx.fillStyle = MV.C.red;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    const fl = MV.clamp(num(P.flash));
    if (fl > 0.001) {
      ctx.globalAlpha = fl;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }
    return true;
  };

  /** Release GPU resources and listeners (the canvas itself is left alone). */
  Post.prototype.dispose = function () {
    const gl = this.gl;
    if (gl) {
      try {
        if (this._res && !gl.isContextLost()) {
          gl.deleteProgram(this._res.prog);
          gl.deleteProgram(this._res.copy);
          gl.deleteBuffer(this._res.buf);
          gl.deleteTexture(this._res.tex);
        }
      } catch (err) { /* ignore */ }
      this.canvas.removeEventListener('webglcontextlost', this._onLost, false);
      this.canvas.removeEventListener('webglcontextrestored', this._onRestored, false);
    }
    this._res = null;
    this._fb = null;
    this.gl = null;
    this.ctx2d = null;
    this.mode = 'none';
  };

  /** Neutral parameter set (everything off). */
  Post.defaults = function () {
    return { rgbShift: 0, glitch: 0, glitchSeed: 0, grain: 0, vignette: 0, flash: 0, redFlash: 0, invert: 0, scanlines: 0, time: 0 };
  };

  MV.Post = Post;
})();
