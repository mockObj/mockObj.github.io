import { FIELD_GEOMETRY } from './field-layout.js';

/** WebGL1 eye field. Coordinates and crop UVs start at the top left; time is in milliseconds. */
export class EyeFieldGL {
  constructor(canvas, invalidate = () => {}) {
    this.canvas = canvas;
    this.invalidate = typeof invalidate === 'function' ? invalidate : () => {};
    this.valid = false;
    this.width = 1; this.height = 1; this.dpr = 1;
    this._disposed = false; this._lost = false;
    this._textures = new Map();
    this._buffer = null; this._background = null; this._art = null;
    const options = { alpha: false, antialias: true, premultipliedAlpha: false, preserveDrawingBuffer: false, depth: false, stencil: false };
    this.gl = canvas.getContext('webgl', options) || canvas.getContext('experimental-webgl', options);
    if (!this.gl) throw new Error('WebGL is unavailable.');
    this._buildResources();
    this.valid = true;
    this._onLost = event => {
      event.preventDefault(); this._lost = true; this.valid = false; this.invalidate();
    };
    this._onRestored = () => {
      if (this._disposed) return;
      this._lost = false;
      this._buffer = null; this._background = null; this._art = null;
      for (const record of this._textures.values()) record.texture = null;
      try {
        this._buildResources(); this.valid = true;
        for (const [key, record] of this._textures) this.setTexture(key, record.source);
      } catch { this.valid = false; }
      this.invalidate();
    };
    canvas.addEventListener('webglcontextlost', this._onLost, false);
    canvas.addEventListener('webglcontextrestored', this._onRestored, false);
  }

  _program(vertexSource, fragmentSource, names) {
    const gl = this.gl;
    let vertex = null, fragment = null, program = null;
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('Unable to allocate a WebGL shader.');
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader) || 'Shader compilation failed.';
        gl.deleteShader(shader); throw new Error(message);
      }
      return shader;
    };
    try {
      vertex = compile(gl.VERTEX_SHADER, vertexSource);
      fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
      program = gl.createProgram();
      if (!program) throw new Error('Unable to allocate a WebGL program.');
      gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'Shader linking failed.');
      const position = gl.getAttribLocation(program, 'aPosition');
      const uniforms = {};
      for (const name of names) {
        uniforms[name] = gl.getUniformLocation(program, name);
        if (uniforms[name] === null) throw new Error(`Missing WebGL uniform: ${name}`);
      }
      if (position < 0) throw new Error('Missing WebGL position attribute.');
      return { program, position, uniforms };
    } catch (error) { if (program) gl.deleteProgram(program); throw error; }
    finally { if (vertex) gl.deleteShader(vertex); if (fragment) gl.deleteShader(fragment); }
  }

  _buildResources() {
    const gl = this.gl;
    const precision = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;
    const grain = `
float paperHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * .1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float paperNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(paperHash(i), paperHash(i + vec2(1.0,0.0)), f.x),
             mix(paperHash(i + vec2(0.0,1.0)), paperHash(i + vec2(1.0)), f.x), f.y);
}
`;
    const backgroundVertex = `
attribute vec2 aPosition;
varying mediump vec2 vUv;
void main() { vUv = (aPosition + 1.0) * .5; gl_Position = vec4(aPosition.x, -aPosition.y, 0.0, 1.0); }
`;
    const backgroundFragment = precision + `
varying mediump vec2 vUv;
uniform vec2 uViewport, uPan;
uniform float uTime, uMotion;
` + grain + `
void main() {
  vec2 world = vUv * uViewport - uPan;
  float broad = paperNoise(world * .007);
  float middle = paperNoise(world * .085);
  float fine = paperHash(floor(world * 1.13));
  vec2 drift = vec2(sin(uTime * .035), cos(uTime * .028)) * .008 * uMotion;
  vec2 vignette = (vUv - .5 - drift) * vec2(min(uViewport.x / uViewport.y, 1.7), 1.0);
  float gray = .057 + (broad - .5) * .010 + (middle - .5) * .003 + (fine - .5) * .003;
  gray -= smoothstep(.18, .85, length(vignette)) * .007;
  gl_FragColor = vec4(vec3(clamp(gray, .045, .07)), 1.0);
}
`;
    const artVertex = `
attribute vec2 aPosition;
uniform vec2 uViewport, uCenter;
uniform mediump float uSide;
uniform float uDepth, uFocal;
varying mediump vec2 vUv;
void main() {
  vUv = (aPosition + 1.0) * .5;
  vec3 p = vec3(aPosition * uSide * .5, uDepth);
  float w = max(.5, (uFocal - p.z) / uFocal);
  vec2 screen = uCenter + p.xy / w;
  vec2 clip = screen / uViewport * vec2(2.0, -2.0) + vec2(-1.0, 1.0);
  gl_Position = vec4(clip * w, 0.0, w);
}
`;
    const artFragment = precision + `
varying mediump vec2 vUv;
uniform sampler2D uTexture;
uniform vec4 uCrop;
uniform vec2 uImageShift;
uniform float uSymbol;
void main() {
  vec2 sourceUv = uCrop.xy + (vUv - .5 - uImageShift) * uCrop.zw;
  vec4 source = texture2D(uTexture, clamp(sourceUv, vec2(0.0), vec2(1.0)));
  float inside = step(0.0, sourceUv.x) * step(sourceUv.x, 1.0) * step(0.0, sourceUv.y) * step(sourceUv.y, 1.0);
  vec2 rounded = abs(vUv - .5) * 2.0;
  float outline = pow(pow(rounded.x, 4.0) + pow(rounded.y, 4.0), .25);
  float photoAlpha = 1.0 - smoothstep(.72, 1.0, outline);
  // Preserve source RGB; only the fixed photo aperture changes transparency.
  float aperture = uSymbol > .5 ? 1.0 : photoAlpha;
  gl_FragColor = vec4(source.rgb, source.a * aperture * inside);
}
`;
    try {
      this._background = this._program(backgroundVertex, backgroundFragment, ['uViewport', 'uPan', 'uTime', 'uMotion']);
      this._art = this._program(artVertex, artFragment, ['uViewport', 'uCenter', 'uSide', 'uDepth', 'uFocal', 'uTexture', 'uCrop', 'uImageShift', 'uSymbol']);
      this._buffer = gl.createBuffer();
      if (!this._buffer) throw new Error('Unable to allocate WebGL resources.');
      gl.bindBuffer(gl.ARRAY_BUFFER, this._buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
      this._maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    } catch (error) { this._deleteResources(); throw error; }
  }

  _textureParameters() {
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  resize(width, height, dpr = 1.5) {
    this.width = Math.max(1, Number(width) || 1); this.height = Math.max(1, Number(height) || 1);
    this.dpr = Math.max(.5, Math.min(3, Number(dpr) || 1.5));
    const pixelWidth = Math.max(1, Math.round(this.width * this.dpr));
    const pixelHeight = Math.max(1, Math.round(this.height * this.dpr));
    if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
    if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;
    this.canvas.style.width = `${this.width}px`; this.canvas.style.height = `${this.height}px`;
    if (this.valid) this.gl.viewport(0, 0, pixelWidth, pixelHeight);
  }

  setTexture(key, source) {
    if (this._disposed) return false;
    const gl = this.gl, previous = this._textures.get(key);
    if (previous?.texture && !this._lost) gl.deleteTexture(previous.texture);
    const record = { source, texture: null }; this._textures.set(key, record);
    if (!this.valid || !source) return false;
    const width = source.naturalWidth || source.videoWidth || source.width;
    const height = source.naturalHeight || source.videoHeight || source.height;
    if (!(width > 0 && height > 0) || width > this._maxTexture || height > this._maxTexture) return false;
    let texture = null;
    try {
      for (let count = 0; count < 4 && gl.getError() !== gl.NO_ERROR; count++) {}
      texture = gl.createTexture();
      if (!texture) return false;
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
      // DOM image rows and our UVs both run from top to bottom.
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      this._textureParameters();
      if (gl.getError() !== gl.NO_ERROR || gl.isContextLost()) throw new Error('Texture upload failed.');
      record.texture = texture; return true;
    } catch { if (texture) gl.deleteTexture(texture); return false; }
  }

  hasTexture(key) { return this.valid && Boolean(this._textures.get(key)?.texture); }

  removeTexture(key) {
    const record = this._textures.get(key);
    if (record?.texture && !this._lost) this.gl.deleteTexture(record.texture);
    this._textures.delete(key);
  }

  _use(program) {
    const gl = this.gl;
    gl.useProgram(program.program); gl.bindBuffer(gl.ARRAY_BUFFER, this._buffer);
    gl.enableVertexAttribArray(program.position);
    gl.vertexAttribPointer(program.position, 2, gl.FLOAT, false, 0, 0);
  }

  render(tiles, scene = {}) {
    if (!this.valid || this._disposed || this.gl.isContextLost()) return false;
    const gl = this.gl, width = Math.max(1, Number(scene.width) || this.width), height = Math.max(1, Number(scene.height) || this.height);
    const panX = Number(scene.panX) || 0, panY = Number(scene.panY) || 0;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
    gl.clearColor(.052, .052, .052, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    this._use(this._background);
    let u = this._background.uniforms;
    gl.uniform2f(u.uViewport, width, height); gl.uniform2f(u.uPan, panX, panY);
    gl.uniform1f(u.uTime, (Number(scene.time) || 0) * .001); gl.uniform1f(u.uMotion, scene.reduceMotion ? 0 : 1);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this._use(this._art); u = this._art.uniforms;
    gl.uniform2f(u.uViewport, width, height); gl.uniform1f(u.uFocal, Math.max(width, height) * 1.7);
    gl.activeTexture(gl.TEXTURE0); gl.uniform1i(u.uTexture, 0);
    const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
    const visible = (tiles || []).filter(tile => {
      if (!(tile.size > 0)) return false;
      const centerX = tile.x + tile.size * .5;
      const centerY = tile.y + tile.size * .5;
      const radius = number(tile.boundsRadius) || tile.size * .5 + Math.abs(number(tile.depth)) + 8;
      return centerX + radius > 0 && centerY + radius > 0 && centerX - radius < width && centerY - radius < height;
    });
    const draw = tile => {
      const texture = this._textures.get(tile.textureKey)?.texture;
      if (!texture) return;
      const side = tile.size * FIELD_GEOMETRY.artFraction;
      const centerX = tile.x + tile.size * .5;
      const centerY = tile.y + tile.size * .5;
      const crop = tile.crop?.length === 4 ? tile.crop : [.5, .5, 1, 1];
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform2f(u.uCenter, centerX, centerY); gl.uniform1f(u.uSide, side);
      gl.uniform1f(u.uDepth, number(tile.depth));
      gl.uniform4f(u.uCrop, crop[0], crop[1], crop[2], crop[3]);
      gl.uniform2f(u.uImageShift, number(tile.imageX) / side, number(tile.imageY) / side);
      gl.uniform1f(u.uSymbol, tile.symbol ? 1 : 0); gl.drawArrays(gl.TRIANGLES, 0, 6);
    };
    // Each clip stays on its grid cell; only source UVs move inside it.
    for (const tile of visible) draw(tile);
    return true;
  }

  _deleteResources() {
    const gl = this.gl;
    if (this._background) gl.deleteProgram(this._background.program);
    if (this._art) gl.deleteProgram(this._art.program);
    if (this._buffer) gl.deleteBuffer(this._buffer);
    this._background = null; this._art = null; this._buffer = null;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true; this.valid = false;
    this.canvas.removeEventListener('webglcontextlost', this._onLost);
    this.canvas.removeEventListener('webglcontextrestored', this._onRestored);
    for (const record of this._textures.values()) if (record.texture) this.gl.deleteTexture(record.texture);
    this._textures.clear(); this._deleteResources();
  }
}
