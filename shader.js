
const _patchShaders = new WeakMap();
/**
 * 一時テクスチャからベーステクスチャにコピーするシェーダー
 * @param {WebGL2RenderingContext} gl 
 * @returns {WebGLProgram}
 */
export function getPatchShader(gl){
	if (_patchShaders.has(gl)) return _patchShaders.get(gl);

	const program = gl.createProgram();

	initShader(
		gl, program,
		/*glsl*/`#version 300 es
		precision mediump float;
		precision mediump int;
		in vec2 a_Position;
		out vec2 v_Texcoord;
		uniform mat4 u_DstMatrix;
		uniform vec2 u_BaseTexSize;
		uniform vec2 u_PasteTexSize;
		void main() {
			gl_Position = vec4(a_Position, 0.0, 1.0) * u_DstMatrix;

			v_Texcoord = gl_Position.xy;
			v_Texcoord.x += 1.0;
			v_Texcoord.y  = 1.0 - v_Texcoord.y;
			v_Texcoord *= u_BaseTexSize / u_PasteTexSize / 2.0;
			v_Texcoord.y  = 1.0 - v_Texcoord.y;

		}`,
		/*glsl*/`#version 300 es
		precision mediump float;
		precision mediump int;
		in vec2 v_Texcoord;
		out vec4 fragColor;
		uniform sampler2D u_PasteTex;
		void main() {
			fragColor = texture(u_PasteTex, v_Texcoord);
		}`);
	_patchShaders.set(gl, program);
	return program;
}



/**
 * 
 * @param {WebGL2RenderingContext} gl 
 * @param {"VERTEX_SHADER"|"FRAGMENT_SHADER"} shadertype 
 * @param {string} source 
 * @returns 
 */
 function compileShader(gl, shadertype, source){
	const type = gl[shadertype];
	const shader = gl.createShader(type);
	if (!shader) {
		throw new Error();
	}

	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	
	// コンパイル結果を検査する
	const compiled = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
	if (!compiled) {
		const log = gl.getShaderInfoLog(shader);
		console.error('コンパイルエラー\n' + log);
		
		if (log) {
			throw new Error(log);
		}
		gl.deleteShader(shader);
		return null;
	}
	return shader;
}

const _elementBuffers = new WeakMap();
/**
 * 描画用の矩形を取得
 * @param {WebGL2RenderingContext} gl
 * @returns {{index:WebGLBuffer, position:WebGLBuffer, texcoord:WebGLBuffer}}
 */
function getElementBuffer(gl){
	if (_elementBuffers.has(gl)) return _elementBuffers.get(gl);

	const positionBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
	gl.bufferData( gl.ARRAY_BUFFER, new Float32Array([
			-1,  -1,
			 1,  -1,
			-1,   1,
			 1,   1,
		]), gl.STATIC_DRAW
	);

	const indexBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
	gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Int16Array([
			0, 1, 2, 
			1, 2, 3
		]), gl.STATIC_DRAW
	);

	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
	gl.enable(gl.BLEND);
	gl.blendFunc( gl.ONE,gl.ZERO);
	
	const buffers = {
		index:indexBuffer,
		position:positionBuffer,
	};

	_elementBuffers.set(gl, buffers);
	return buffers;
}

/**
 * 
 * @param {WebGL2RenderingContext} gl 
 * @param {WebGLProgram} program 
 */
function linkShader(gl, program, data){
	gl.linkProgram(program);

	const linkStatus = gl.getProgramParameter(program, gl.LINK_STATUS);
	if( !linkStatus ) {
		const log = gl.getProgramInfoLog(program);
		throw new Error('Failed to link a program\n' + log);
	}

	const buffers = getElementBuffer(gl);
	
	const positionLoc = gl.getAttribLocation(program, "a_Position");
	if (positionLoc >= 0) {
		gl.enableVertexAttribArray(positionLoc);
		gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
		gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);
	}
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.index);
}

/**
 * 
 * @param {WebGL2RenderingContext} gl 
 * @param {WebGLProgram} prog 
 * @param {string} vert 
 * @param {string} frag 
 * @returns {WebGLProgram}
 */
export function initShader(gl, prog, vert, frag){
	try {
		const vShader = compileShader(gl, "VERTEX_SHADER", vert);
		if (vShader) {
			gl.attachShader( prog, vShader );
			gl.deleteShader(vShader);
		}
	} catch(e) {
		const err = new Error("頂点シェーダーのコンパイルエラー");
		err.log = e.message;
		throw err;
	}
	try {
		const fShader = compileShader(gl, "FRAGMENT_SHADER", frag);
		if (fShader) {
			gl.attachShader( prog, fShader );
			gl.deleteShader(fShader);
		}
	} catch(e) {
		const err = new Error("フラグメントシェーダーのコンパイルエラー");
		err.log = e;
		throw err;
	}
		
	linkShader(gl, prog, vert);

	return prog;
}

