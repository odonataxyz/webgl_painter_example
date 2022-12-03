import { getPatchShader } from "./shader.js";

/**
 * 
 * @param {number} a 
 * @param {number} b 
 * @param {number} t 
 * @returns 
 */
export function lerp(a, b, t){
	return a + (b-a) * t;
}

export function imgToTex(gl, source){
	const texture = gl.createTexture();

	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
	gl.bindTexture(gl.TEXTURE_2D, null);

	return texture;
}

/**
 * ImageDataをDataURL化
 * @param {ImageData} img 
 * @returns {string} DataURL
 */
export function imageDataToURL(img){
	const canvas = document.createElement("canvas");
	canvas.width = img.width;
	canvas.height = img.height;
	const ctx = canvas.getContext("2d");
    ctx.putImageData(img, 0, 0);

	return canvas.toDataURL("image/png");
}

/**
 * テクスチャをImageDataに変換
 * @param {WebGL2RenderingContext} gl 
 * @param {WebGLTexture} texture 
 * @param {number} width 
 * @param {number} height 
 * @returns {ImageData} ImageData化したテクスチャ
 */
export function texToImgData(gl, texture, width, height){
	const framebuffer = gl.createFramebuffer();
	const length = width * height * 4;
	const data = new Uint8Array(length);

	gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
	
	gl.readPixels( 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
	
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	gl.deleteFramebuffer(framebuffer);
	const img = new ImageData(width, height);
	
	const row = width * 4;
	const end = (height - 1) * row;
	for (let i = 0; i < length; i += row) {
		img.data.set(data.subarray(i, i + row), end - i);
	}
	return img;
}


/**
 * 
 * @param {WebGL2RenderingContext} gl 
 * @param {WebGLTexture} texture 
 * @param {number} width 
 * @param {number} height 
 */
export function debugPreview(gl, texture, width, height, id = "debug-preview") {
	const p = document.querySelector("#" + id) || 
	document.createElement("img");
	p.src = imageDataToURL(texToImgData(gl, texture, width, height));
	document.body.appendChild(p);
	p.id = id;
	p.classList.add("debug-preview");
	p.title = id;
}


/**
 * @param {WebGL2RenderingContext} gl
 * @param {WebGLProgram} shader
 * @param {...{name:string, value:number[]|WebGLTexture, type:keyof WebGL2RenderingContext, index?:number}} uniforms 
 */
function registerUniform(gl, shader, ...uniforms){
	for (const uniform of uniforms) {
		const location = gl.getUniformLocation(shader, uniform.name);
		const value = uniform.value;
		
		if (!value || !location) continue;

		if (uniform.type.startsWith('uniformMatrix')) { //matrix
			gl[uniform.type](location, false, value);
		} else if (value instanceof WebGLTexture) {
			const texIndex = uniform.index || 0;
			gl.activeTexture(gl.TEXTURE0 + texIndex);
			gl.bindTexture(gl.TEXTURE_2D, value);
			gl.uniform1i(location, texIndex);
		} else {
			gl[uniform.type](location, ...value);
		}
	}
}


const _temporaryTexture = new WeakMap();
/**
 * 描画テクスチャを作成
 * @param {WebGL2RenderingContext} gl 
 * @param {number} width 
 * @param {number} height 
 * @returns {{texture:WebGLTexture, width:number, height:number}}
 */
function getTemporaryTexture(gl, width, height){
	const temporaryTexture = _temporaryTexture.get(gl) || {texture:gl.createTexture(), width:0, height:0};
	_temporaryTexture.set(gl, temporaryTexture);
	
	const tempWidth = temporaryTexture.width;
	const tempHeight = temporaryTexture.height;
	if (width > tempWidth || height > tempHeight) { //テクスチャを拡大
		const newWidth = Math.ceil(Math.max(width, tempWidth) / 1024) * 1024;
		const newHeight = Math.ceil(Math.max(height, tempHeight) / 1024) * 1024;
		
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, temporaryTexture.texture);
		
		initTexture(gl);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, newWidth, newHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
		
		temporaryTexture.width = newWidth;
		temporaryTexture.height = newHeight;
	}


	return temporaryTexture;
}



/**
 * 画像を別な画像に描画する
 * @param {WebGL2RenderingContext} gl 
 * @param {WebGLShader} shader 
 * @param {{texture:WebGLTexture, width:number, height:number}} baseTex 
 * @param {{texture:WebGLTexture, width:number, height:number}} pasteTex 
 * @param {{opacity?:number, debug?:boolean}} opt 
 * @param {number} sx 
 * @param {number} sy 
 * @param {number} sw 
 * @param {number} sh 
 * @param {number?} dx
 * @param {number?} dy 
 * @param {number?} dw 
 * @param {number?} dh 
 */
export function drawImage(
	gl, shader, 
	baseTex, pasteTex,
	opt,
	sx, sy, sw, sh, dx, dy, dw, dh
	) {
	
	gl.useProgram(shader);

	const _dx = typeof dx === 'number' ? dx : sx;
	const _dy = typeof dy === 'number' ? dy : sy;
	const _dw = typeof dw === 'number' ? dw : typeof sw === 'number' ? sw : pasteTex.width;
	const _dh = typeof dh === 'number' ? dh : typeof sh === 'number' ? sh : pasteTex.height;

	const _sx = typeof dx === 'number' && typeof sx === 'number' ? sx : 0 ;
	const _sy = typeof dy === 'number' && typeof sy === 'number' ? sy : 0 ;
	const _sw = typeof dw === 'number' && typeof sw === 'number' ? sw : pasteTex.width ;
	const _sh = typeof dh === 'number' && typeof sh === 'number' ? sh : pasteTex.height ;

	const temporaryTexture = getTemporaryTexture(gl, baseTex.width, baseTex.height);
	
	const framebuffer = gl.createFramebuffer();
	gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, temporaryTexture.texture, 0);
	
	gl.viewport(0, temporaryTexture.height - baseTex.height, baseTex.width, baseTex.height);
	gl.blendFunc( gl.ONE, gl.ZERO );
	
	const dstMatrix = [
		_dw / baseTex.width,	0,						0,		lerp(-1, 1, (_dx + _dw / 2) / baseTex.width),
		0,						_dh / baseTex.height,	0,		lerp(-1, 1, 1 - (_dy + _dh / 2) / baseTex.height),
		0,						0,						1,		0,
		0,						0,						0,		1
	];
	registerUniform(gl, shader,
		{name:"u_SrcTex",		type:"uniform1i", index:0, value:baseTex.texture },
		{name:"u_DstTex",		type:"uniform1i", index:1, value:pasteTex.texture },
		{name:"u_Texcoord0_ST",	type:"uniform4f", value:[
			_sw / pasteTex.width,
			_sh / pasteTex.height,
			_sx / pasteTex.width,
			_sy / pasteTex.height,
		]},
		{name:"u_Opacity",		type:"uniform1f", value:[typeof opt.opacity === "number" ? opt.opacity : 1.0] },
		{name:"u_Color",		type:"uniform3f", value:opt.color || [1, 1, 1] },
		{name:"u_DstMatrix",	type:"uniformMatrix4fv", value:dstMatrix},
		...(opt.uniforms || []),
	);

	gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
	gl.flush();
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);

	{
		const patchShader = getPatchShader(gl);
		gl.useProgram(patchShader);
		gl.blendFunc( gl.ONE, gl.ZERO );
		gl.viewport(0, 0, baseTex.width, baseTex.height );
		
		if (baseTex.texture) {
			gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, baseTex.texture, 0);
		} else {
			gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		}
		
		registerUniform(gl, patchShader,
			{name:"u_DstMatrix",	type:"uniformMatrix4fv", value:dstMatrix},
			{name:"u_PasteTex",		type:"uniform1i", value:temporaryTexture.texture, index:2},
			{name:"u_BaseTexSize",	type:"uniform2f", value:[baseTex.width, baseTex.height]},
			{name:"u_PasteTexSize",	type:"uniform2f", value:[temporaryTexture.width, temporaryTexture.height]}
		);

		gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
		gl.flush();
	}

	if (opt.debug) {
		debugPreview(gl, temporaryTexture.texture, temporaryTexture.width, temporaryTexture.height, "temp");
		debugPreview(gl, baseTex.texture, baseTex.width, baseTex.height, "base");
		debugPreview(gl, pasteTex.texture, pasteTex.width, pasteTex.height, "paste");
	}
	
	gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, temporaryTexture.texture, 0);
	gl.clearColor(0.0, 0.0, 0.0, 0.0);
	gl.clear(gl.COLOR_BUFFER_BIT);

	gl.deleteFramebuffer(framebuffer);

}


/**
 * テクスチャのパラメーターを設定
 * @param {WebGL2RenderingContext} gl
 */
export function initTexture(gl){
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
}


/**
 * 2つの矩形を合体した矩形
 * @param {DOMRect} a 
 * @param {DOMRect} b 
 * @returns {DOMRect}
 */
export function expandedRect(a, b){
	const x = Math.min(a.x, b.x);
	const y = Math.min(a.y, b.y);
	return {
		x, y,
		width:Math.max(a.x + a.width, b.x + b.width) - x,
		height:Math.max(a.y + a.height, b.y + b.height) - y,
	};
}


/**
 * 
 * @param {ImageData} src 
 * @param {number} x 
 * @param {number} y 
 * @param {number} width 
 * @param {number} height 
 * @param {boolean} flipY 
 * @returns {ImageData}
 */
export function cropImageData(src, x = 0, y = 0, width = src.width, height = src.height, flipY = true){
	
	const srcWidth = src.width;
	const srcHeight = src.height;

	const dst = new ImageData(width, height);

	if ( x === 0 && y === 0 && width === src.width && height === src.height ) {
		dst.data.set(src.data);
		return dst;
	}
	
	const maxX = Math.max(x, 0);
	const maxY = Math.max(y, 0);
	const minX = Math.min(x, 0);
	const minY = Math.min(y, 0);
	
	const scanWidth = Math.min(srcWidth, width, Math.max(srcWidth, width) - maxX);
	const scanHeight = Math.min(srcHeight, height, Math.max(srcHeight, height) - maxY);

	if ( scanWidth > 0 && scanHeight > 0 ) {

		const offsetY = flipY ? srcHeight - scanHeight : 0;
		for ( let h = 0; h < scanHeight; h++ ) {
			
			const readY = h + maxY + offsetY;
			const readX = maxX;

			const writeY =  flipY ? ( scanHeight - minY - h - 1 ) : ( h - minY);
			const writeX = -minX;


			const sliced = 
				src.data.subarray(
					( readY * srcWidth + readX         ) * 4,
					( readY * srcWidth + readX + scanWidth  ) * 4
				);
				
			
			dst.data.set(
				sliced, 
				( 
					writeY * width +
					writeX
				) * 4
			); 
		}
	}
	
	return dst;
}


/**
 * 
 * @param {WebGL2RenderingContext} gl 
 * @param {WebGLTexture} src 
 * @param {number} x 
 * @param {number} y 
 * @param {number} width 
 * @param {number} height
 * @returns {WebGLTexture}
 */
export function cropTexture(gl, src, x, y, width, height){

	const dst = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, dst);
	initTexture(gl);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
	gl.bindTexture(gl.TEXTURE_2D, null);
	
	const srcFrameBuffer = gl.createFramebuffer();
	gl.bindFramebuffer(gl.FRAMEBUFFER, srcFrameBuffer);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, src.texture, 0);
	
	const dstFrameBuffer = gl.createFramebuffer();
	gl.bindFramebuffer(gl.FRAMEBUFFER, dstFrameBuffer);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dst, 0);

	gl.bindFramebuffer(gl.READ_FRAMEBUFFER, srcFrameBuffer);
	gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dstFrameBuffer);

	gl.blitFramebuffer(
		x, src.height - (y + height),
		x + width,
		src.height - y,
		0, 0,
		width,
		height,
		gl.COLOR_BUFFER_BIT,
		gl.NEAREST
	);

	gl.deleteFramebuffer(srcFrameBuffer);
	gl.deleteFramebuffer(dstFrameBuffer);	
	return dst;
}