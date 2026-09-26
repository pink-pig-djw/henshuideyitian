/*
 * MV.Post — full-frame post-processing (ARCHITECTURE §3.7).
 *
 *   const post = new MV.Post(outputCanvas, { preserveDrawingBuffer: true, prefer: 'auto' });
 *   post.resize(w, h);
 *   post.render(sourceCanvas, { rgbShift, glitch, glitchSeed, grain, vignette, flash,
 *                               redFlash, invert, scanlines, time });   // → true if drawn
 *   post.isWebGL; post.mode ('webgl2' | 'webgl' | '2d' | 'none'); post.dispose();
 *   post.isNeutral(params) / MV.Post.isNeutral(params) → true when render() is a plain copy
 *
 * WebGL2 → WebGL1 → Canvas2D fallback. One fullscreen fragment pass samples the
 * source canvas as a texture. Program choice per frame: neutral params → bare
 * copy; glitch / invert → FULL shader; anything else → lite shader. Every
 * effect is palette-safe (red / black / white only — no hue inversion, no
 * cyan / magenta channel fringes). Parameters (all optional, missing = 0):
 *   rgbShift   px (logical 1920-wide units) — P5-style misregistration: a red-tinted
 *              ghost offset down-right behind bright shapes + a faint white ghost
 *              leading (the name is kept for API compatibility; no RGB split)
 *   glitch     0..1 — horizontal slice offsets, torn rows with a wider red ghost,
 *              and palette-safe slabs (red↔black swap, solid red / white / ink,
 *              halftone dots, palette negative)
 *   glitchSeed number — picks the glitch pattern (change it to re-roll)
 *   grain      0..1 — hash noise, re-rolled 24× per second of `time`
 *   vignette   0..1 — frame-shaped (rounded-rectangle) edge darkening — never a circular disc
 *   flash      0..1 — mix towards white
 *   redFlash   0..1 — mix towards MV.C.red (highlights stay white; 2D fallback: screen)
 *   invert     0..1 — mix towards the palette negative: black ↔ white, red stays
 *              red (the Canvas2D fallback approximates it as a monochrome negative)
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
  // Palette discipline: every operation only mixes towards the house triad
  // (red #E60012 / black / white) or darkens / lightens what is already there.
  // Nothing inverts hue, so red can never turn cyan and there are no RGB
  // (cyan / magenta) fringes.
  // Two variants are compiled from this source: FULL (glitch + invert) and a
  // lite one (ghost / vignette / scanlines / grain / flashes) for the common
  // frame — SwiftShader & weak GPUs pay per instruction, even for skipped branches.
  const FRAG_BODY = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    'varying vec2 vUv;',
    'uniform sampler2D uTex;',
    'uniform vec2 uRes;',
    'uniform float uShift, uGlitch, uSeed, uGrain, uVig, uFlash, uRed, uInv, uScan, uTime;',
    'const vec3 RED = vec3(0.902, 0.0, 0.071);',
    'const vec3 INK = vec3(0.039);',
    'const vec3 LUMA = vec3(0.299, 0.587, 0.114);',
    'float hash(vec2 p) {',
    '  vec3 p3 = fract(vec3(p.xyx) * 0.1031);',
    '  p3 += dot(p3, p3.yzx + 33.33);',
    '  return fract((p3.x + p3.y) * p3.z);',
    '}',
    '#ifdef FULL',
    // How much of the pixel is "red ink" (1 for the house red, 0 for greys / navy).
    'float redInk(vec3 c) { return clamp((c.r - max(c.g, c.b)) / 0.831, 0.0, 1.0); }',
    // Palette negative: black <-> white, red ink stays red (never cyan).
    'vec3 palNegative(vec3 c) {',
    '  float v = max(c.r, max(c.g, c.b));',
    '  return mix(vec3(1.0 - v), RED, redInk(c));',
    '}',
    // Red <-> black swap, white stays white (pixel = white + red ink + black).
    'vec3 redSwap(vec3 c) {',
    '  float w = min(c.r, min(c.g, c.b));',
    '  float r = redInk(c);',
    '  return vec3(w) + clamp(1.0 - w - r, 0.0, 1.0) * RED;',
    '}',
    '#endif',
    'void main() {',
    '  vec2 uv = vUv;',
    '  float k = uRes.x / 1920.0;',
    '  float shL = uShift;', // logical px
    '#ifdef FULL',
    '  float ys = 1.0 - uv.y;',              // 0 at the top
    '  float blk = -1.0;',
    '  if (uGlitch > 0.001) {',
    '    float sd = floor(uSeed);',
    '    float rowsA = 7.0 + floor(hash(vec2(sd, 1.7)) * 9.0);',
    '    float rowsB = 28.0 + floor(hash(vec2(sd, 3.1)) * 36.0);',
    '    float ra = floor(ys * rowsA), rb = floor(ys * rowsB);',
    '    float ha = hash(vec2(ra, sd + 11.0)), hb = hash(vec2(rb, sd + 23.0));',
    '    float d = 0.0;',
    '    if (ha < uGlitch * 0.35) d += (hash(vec2(ra, sd + 5.0)) - 0.5) * 0.22 * uGlitch;',
    // torn rows: extra slice offset and a wider red ghost
    '    if (hb < uGlitch * 0.5) { d += (hash(vec2(rb, sd + 9.0)) - 0.5) * 0.12 * uGlitch; shL += uGlitch * 14.0; }',
    '    uv.x = fract(uv.x + d);',              // horizontal slice offsets
    // at most one palette-safe slab per thin row (screen space)
    '    if (hash(vec2(rb, sd + 41.0)) < uGlitch * 0.3) {',
    '      float x0 = hash(vec2(rb, sd + 43.0)) * 1.1 - 0.1;',
    '      float bw = 0.035 + 0.3 * hash(vec2(rb, sd + 47.0)) * hash(vec2(rb, sd + 49.0));',
    '      if (vUv.x > x0 && vUv.x < x0 + bw) blk = floor(hash(vec2(rb, sd + 53.0)) * 6.0);',
    '    }',
    '  }',
    '#endif',
    '  vec3 col = texture2D(uTex, uv).rgb;',
    // P5-style misregistration: a red-tinted copy sits behind the image, offset
    // down-right along the house angle; it only shows where the frame is darker
    // than the ghost (so white text stays white). A faint white ghost leads.
    '  if (shL > 0.2) {',
    '    vec2 off = vec2(shL * k / uRes.x, -shL * k * 0.21 / uRes.y);',
    '    float l0 = dot(col, LUMA);',
    '    float a = smoothstep(0.2, 3.0, shL);',
    '    float gr = dot(texture2D(uTex, uv - off).rgb, LUMA);',
    '    float gw = dot(texture2D(uTex, uv + off * 0.55).rgb, LUMA);',
    '    float rr = clamp((gr - l0) * 1.8, 0.0, 1.0) * a;',
    '    col = mix(col, RED, rr);',
    '    col = mix(col, vec3(1.0), clamp(gw - l0, 0.0, 1.0) * 0.3 * a * (1.0 - rr));',
    '  }',
    '#ifdef FULL',
    '  if (blk > -0.5) {',
    '    if (blk < 0.5) col = redSwap(col);',
    '    else if (blk < 1.5) col = RED;',
    '    else if (blk < 2.5) col = vec3(1.0);',
    '    else if (blk < 3.5) {',               // halftone slab: black dots on red, dot size = darkness
    '      float cell = max(5.0, 11.0 * k);',
    '      vec2 fc = gl_FragCoord.xy;',
    '      vec2 q = mod(vec2(fc.x + fc.y, fc.x - fc.y) * 0.70711, cell) - 0.5 * cell;',
    '      float rad = cell * 0.62 * sqrt(clamp(1.0 - dot(col, LUMA), 0.0, 1.0));',
    '      col = mix(RED, INK, step(length(q), rad));',
    '    }',
    '    else if (blk < 4.5) col = palNegative(col);',
    '    else col = INK;',
    '  }',
    '  if (uInv > 0.001) col = mix(col, palNegative(col), min(uInv, 1.0));',
    '#endif',
    // frame-shaped (rounded-rectangle, L4-norm) vignette: darkens edges and corners
    // without ever drawing a circular "disc" on flat red frames
    '  if (uVig > 0.001) {',
    '    vec2 q = abs(vUv - 0.5) * 2.0;',
    '    q *= q;',
    '    float v = smoothstep(0.62, 1.25, sqrt(sqrt(dot(q, q))));',
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
    // red flash, hue-locked: darks and mid-tones go to the house red, highlights stay
    // white (a 'screen' with red would tint navy purple)
    '  if (uRed > 0.001) col = mix(col, mix(RED, vec3(1.0), smoothstep(0.55, 1.0, dot(col, LUMA))), min(uRed, 1.0));',
    '  if (uFlash > 0.001) col = mix(col, vec3(1.0), min(uFlash, 1.0));',
    '  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);',
    '}',
  ].join('\n');
  const FRAG = '#define FULL 1\n' + FRAG_BODY;
  const FRAG_LITE = FRAG_BODY;

  // Plain copy for neutral frames (all effects ≈ 0): cheapest possible pass.
  const FRAG_COPY = [
    'precision mediump float;',
    'varying vec2 vUv;',
    'uniform sampler2D uTex;',
    'void main() { gl_FragColor = vec4(texture2D(uTex, vUv).rgb, 1.0); }',
  ].join('\n');

  const UNIFORMS = ['uTex', 'uRes', 'uShift', 'uGlitch', 'uSeed', 'uGrain', 'uVig', 'uFlash', 'uRed', 'uInv', 'uScan', 'uTime'];
  const EPS = 1e-3;
  const SHIFT_EPS = 0.2; // logical px below which the red ghost is invisible
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
  /**
   * True when `params` would leave the frame unchanged (every effect ≈ 0), i.e.
   * render() degenerates to a plain copy. Stage may use it to skip work.
   * @param {object} [P] Post params
   * @returns {boolean}
   */
  /** Glitch / invert need the FULL shader variant; everything else runs on the lite one. */
  const needsFull = (P) => num(P.glitch) > EPS || num(P.invert) > EPS;
  const isNeutral = (P) => {
    P = P || {};
    return !(num(P.rgbShift) > SHIFT_EPS || num(P.glitch) > EPS || num(P.grain) > EPS || num(P.vignette) > EPS ||
      num(P.flash) > EPS || num(P.redFlash) > EPS || num(P.invert) > EPS || num(P.scanlines) > EPS);
  };

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
    const lite = link(FRAG_LITE);
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
    const loc = {}, locLite = {};
    UNIFORMS.forEach((u) => {
      loc[u] = gl.getUniformLocation(prog, u);
      locLite[u] = gl.getUniformLocation(lite, u);
    });
    this._res = { prog, lite, copy, copyTex: gl.getUniformLocation(copy, 'uTex'), buf, tex, loc, locLite };
    this._texW = this._texH = 0;
  };

  /** Resize the output canvas (backing pixels). */
  Post.prototype.resize = function (w, h) {
    w = Math.max(1, Math.round(w || 1));
    h = Math.max(1, Math.round(h || 1));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  };

  /**
   * True when these params leave the frame untouched (render() is a plain copy).
   * @param {object} [params]
   * @returns {boolean}
   */
  Post.prototype.isNeutral = function (params) {
    return isNeutral(params);
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
    const full = !neutral && needsFull(P);
    gl.viewport(0, 0, w, h);
    gl.useProgram(neutral ? r.copy : full ? r.prog : r.lite);
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
    const L = full ? r.loc : r.locLite;
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
    // frame-shaped vignette sprite (black, transparent centre) — same L4-norm
    // rounded-rectangle falloff as the shader, computed at 1/10 size and upscaled
    const v = MV.makeCanvas(w, h);
    const lw = 192, lh = 108;
    const lo = MV.makeCanvas(lw, lh);
    const img = lo.ctx.createImageData(lw, lh);
    for (let y = 0; y < lh; y++) {
      for (let x = 0; x < lw; x++) {
        const qx = Math.abs((x + 0.5) / lw - 0.5) * 2, qy = Math.abs((y + 0.5) / lh - 0.5) * 2;
        const r = Math.pow(qx * qx * qx * qx + qy * qy * qy * qy, 0.25);
        img.data[(y * lw + x) * 4 + 3] = Math.round(MV.smoothstep(0.62, 1.25, r) * 255);
      }
    }
    lo.ctx.putImageData(img, 0, 0);
    v.ctx.imageSmoothingEnabled = true;
    v.ctx.drawImage(lo.canvas, 0, 0, w, h);
    // scanline tile (every 4 logical px → 2 dark)
    const k = Math.max(1, Math.round(h / 1080));
    const sl = MV.makeCanvas(64, 64 * k);
    sl.ctx.fillStyle = 'rgba(0,0,0,1)';
    for (let y = 0; y < 64 * k; y += 4 * k) sl.ctx.fillRect(0, y + 2 * k, 64, 2 * k);
    // full-resolution scratch for the red misregistration ghost (same size → the
    // 'lighten' composite at an integer offset is a fast unscaled blit)
    const gh = MV.makeCanvas(w, h);
    this._fb = { w, h, vig: v.canvas, scan: null, scanTile: sl.canvas, ghost: gh, dots: null };
    return this._fb;
  };

  /** Red-tinted copy of `src` (white → red, red → red, dark → dark) at output resolution. */
  function tintRed(fb, src) {
    // min(src, red) per channel: white → red, red → red, dark → dark
    const gc = fb.ghost.ctx, gw = fb.ghost.canvas.width, gh = fb.ghost.canvas.height;
    gc.globalAlpha = 1;
    gc.globalCompositeOperation = 'source-over';
    gc.fillStyle = MV.C.red;
    gc.fillRect(0, 0, gw, gh);
    gc.globalCompositeOperation = 'darken';
    gc.drawImage(src, 0, 0, gw, gh);
    gc.globalCompositeOperation = 'source-over';
    return fb.ghost.canvas;
  }

  Post.prototype._render2D = function (src, P) {
    const ctx = this.ctx2d;
    const w = this.canvas.width, h = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(src, 0, 0, w, h);
    if (isNeutral(P)) return true; // plain copy
    const fb = this._fallbackCache(w, h);
    const k = w / 1920;
    const C = MV.C;
    const gl = MV.clamp(num(P.glitch));
    // Red misregistration ghost: the red-tinted copy is composited with
    // 'lighten', so it only shows where the frame is darker (white stays white).
    const shiftL = Math.max(0, num(P.rgbShift));
    const a = MV.smoothstep(SHIFT_EPS, 3, shiftL);
    // CPU fallback: skip the faint 1 px ghosts between beats (≈ 9 ms of full-frame
    // blending each); the beat hits (rgbShift ≳ 1.2 px) still get the red ghost
    const useGhost = a >= 0.25;
    let ghost = null;
    if (useGhost || gl > 0.001) ghost = tintRed(fb, src);
    if (useGhost) {
      // integer offsets keep every blit unfiltered (fractional / scaled draws cost 3–5×)
      const s = Math.max(1, Math.round(shiftL * k));
      ctx.globalCompositeOperation = 'lighten';
      ctx.globalAlpha = a;
      ctx.drawImage(ghost, s, Math.round(s * 0.21));
      if (shiftL >= 3) {
        // faint white ghost leading the other way (strong hits only — it costs a full-frame blend)
        const s2 = Math.max(1, Math.round(s * 0.55));
        ctx.globalAlpha = 0.3 * a;
        ctx.drawImage(src, 0, 0, src.width, src.height, -s2, -Math.round(s2 * 0.21), w, h);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    // glitch: displaced row bands (torn rows carry a wider red ghost) + palette-safe slabs
    if (gl > 0.001) {
      const sd = Math.floor(num(P.glitchSeed));
      const rows = 28 + Math.floor(MV.rand(sd, 3) * 36);
      const sh = src.height / h;
      const rowY = (i) => Math.round((i * h) / rows); // integer row bounds → unfiltered blits
      for (let i = 0; i < rows; i++) {
        if (MV.rand(sd, i, 23) >= gl * 0.5) continue;
        const dx = Math.round((MV.rand(sd, i, 9) - 0.5) * 0.24 * gl * w);
        const y = rowY(i), rh = rowY(i + 1) - y;
        if (rh <= 0) continue;
        ctx.drawImage(src, 0, y * sh, src.width, rh * sh, dx, y, w, rh);
        ctx.drawImage(src, 0, y * sh, src.width, rh * sh, dx - Math.sign(dx) * w, y, w, rh);
        ctx.globalCompositeOperation = 'lighten'; // torn row: wider red ghost
        ctx.drawImage(ghost, 0, y, w, rh, dx + Math.round(14 * gl * k), y, w, rh);
        ctx.globalCompositeOperation = 'source-over';
      }
      for (let i = 0; i < rows; i++) {
        if (MV.rand(sd, i, 41) >= gl * 0.3) continue;
        const x0 = Math.round((MV.rand(sd, i, 43) * 1.1 - 0.1) * w);
        const bw = Math.round((0.035 + 0.3 * MV.rand(sd, i, 47) * MV.rand(sd, i, 49)) * w);
        const y = rowY(i), rh = rowY(i + 1) - y;
        const type = Math.floor(MV.rand(sd, i, 53) * 6);
        if (type === 0) {
          ctx.globalCompositeOperation = 'lighten'; // darks → red (red / black swap feel)
          ctx.fillStyle = C.red;
        } else if (type === 4) {
          ctx.globalCompositeOperation = 'multiply'; // lights → red (red / black duotone)
          ctx.fillStyle = C.red;
        } else ctx.fillStyle = type === 1 || type === 3 ? C.red : type === 2 ? C.white : C.black;
        ctx.fillRect(x0, y, bw, rh);
        ctx.globalCompositeOperation = 'source-over';
        if (type === 3) {
          if (!fb.dots) fb.dots = MV.patterns.dots(ctx, { cell: Math.max(6, Math.round(11 * k)), radius: 0.36, color: C.black });
          ctx.fillStyle = fb.dots;
          ctx.fillRect(x0, y, bw, rh);
        }
      }
    }
    // palette negative (2D approximation: monochrome negative — black ↔ white, no cyan)
    const inv = MV.clamp(num(P.invert));
    if (inv > 0.001) {
      ctx.globalAlpha = inv;
      ctx.globalCompositeOperation = 'difference';
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'saturation';
      ctx.fillStyle = '#808080';
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
      // light grain (the Director's 0.07–0.1): plain source-over specks, cheapest.
      // Heavy grain: 'multiply' so specks only darken and red never washes out to pink / grey.
      const fr = Math.floor(num(P.time) * 24);
      const heavy = grain > 0.15;
      ctx.globalCompositeOperation = heavy ? 'multiply' : 'source-over';
      ctx.globalAlpha = Math.min(1, grain * (heavy ? 2.2 : 1.6));
      ctx.fillStyle = MV.patterns.grain(ctx, MV.mod(fr, 8), 0.35);
      ctx.save();
      ctx.translate(-MV.mod(fr * 37, 256), -MV.mod(fr * 91, 256));
      ctx.fillRect(0, 0, w + 256, h + 256);
      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    const red = MV.clamp(num(P.redFlash));
    if (red > 0.001) {
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = red;
      ctx.fillStyle = C.red;
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
          gl.deleteProgram(this._res.lite);
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

  Post.isNeutral = isNeutral;
  MV.Post = Post;
})();
