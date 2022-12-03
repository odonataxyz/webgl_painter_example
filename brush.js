import { cropTexture, debugPreview, drawImage, imageDataToURL, imgToTex, initTexture, texToImgData } from "./util.js";
import { Project } from "./project.js";
import { Layer } from "./layer.js";
import { RenderTextureAction, SetValueAction } from "./history.js";

/**
 * 距離計測
 * @param {{x:number, y:number}} a 
 * @param {{x:number, y:number}} b 
 * @returns 
 */
function distance(a, b) {
	return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
}

class Stroke {
	/** @type {{x:number, y:number, pressure:number}[]} */
	path = [];
	_lastDistance = 0;

	/**
	 * 
	 * @param {Brush} brush 
	 * @param {Layer} layer 
	 * @param {number} x 
	 * @param {number} y 
	 * @param {number} pressure
	 */
	constructor(brush, layer, x, y, pressure) {
		pressure ||= 1.0;
		this.layer = layer;
		this.brush = brush;
		this.path.push({x, y, pressure});
		this._draw(x, y, pressure);
	}

	/**
	 * 位置を追加して必要な分ストロークを引く
	 * @param {number} x 
	 * @param {number} y 
	 * @param {number} pressure
	 */
	add(x, y, pressure) {
		pressure ||= 1.0;
		const brush = this.brush;
		
		const prev = this.path[this.path.length - 1];
		const dist = distance(prev, {x, y});

		const len = this._lastDistance + dist;
		const dir = {x:(x - prev.x) / dist, y:(y - prev.y) / dist};
		const pixSize = brush.brushSize * pressure;
		const pixInterval = Math.max(pixSize * brush.interval / 2, 2);
		const cnt = Math.floor(len / pixInterval);

		const margin = pixInterval - this._lastDistance;
		
		for (let i = 0; i < cnt; i++) {

			this._draw(
				prev.x + dir.x * (pixInterval * i + margin),
				prev.y + dir.y * (pixInterval * i + margin),
				pixSize
			);
		}
		
		this._lastDistance = len % pixInterval;
		
		this.path.push({x, y});
	}

	/**
	 * 実際の描画関数
	 * @param {number} x 
	 * @param {number} y 
	 * @param {number} size 
	 */
	_draw(x, y, size) {
		const brush = this.brush;
		const layer = this.layer;
		const proj = brush.project;
		const drawX = x - size / 2;
		const drawY = y - size / 2;
		
		// キャンバス画面外にはみ出るブラシ描画はカットしておく
		const borderLeft = Math.abs(Math.min(drawX, 0));
		const borderTop = Math.abs(Math.min(drawY, 0));
		const borderRight = Math.abs(Math.min(proj.width - ( drawX + size ), 0));
		const borderBottom = Math.abs(Math.min(proj.height - ( drawY + size ), 0));
		
		drawImage(
			proj.gl,
			brush.erase ? proj.blends.erase : proj.blends.normal,
			layer,
			{
				texture:brush.texture,
				width:size,
				height:size,
			},
			{
				opacity:brush.opacity,
				color:brush.color.map(c=>c/255),
			},
			borderLeft,
			borderLeft,
			size - borderRight,
			size - borderBottom,
			drawX - layer.x + borderLeft,
			drawY - layer.y + borderTop,
			size - borderRight,
			size - borderBottom,
		);

		layer.redrawProject({
			x:drawX, y:drawY,
			width:size,
			height:size,
		});
	}
}

export class Brush {
	pressure = true;
	erase = false;
	brushSize = 50;
	interval = 0.1;
	opacity = 1;
	/** ブラシの色(0-255) */
	color = [0, 0, 0];

	/**
	 * @param {Project} project 
	 * @param {number} size 
	 */
	constructor(project, size){

		const proj = this.project = project;
		this.size = size;

		
		// レイヤーの前の状態を保存しておくための一時テクスチャを作っておく
		const gl = proj.gl;
		this.temp = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, this.temp);
		initTexture(gl);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, proj.width, proj.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
		gl.bindTexture(gl.TEXTURE_2D, null);


		const brushImage = new Image(size, size);
		const halfSize = size / 2;
		
		// 今回のブラシ画像はSVGのグラデーション円から作成する
		// デフォルトっぽいのが作れる
		brushImage.src = "data:image/svg+xml;base64," + 
		btoa(/*xml*/`<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${-halfSize} ${-halfSize} ${size} ${size}">
			<defs>
				<radialGradient id="grad">
					<stop offset="0%" stop-color="white" stop-opacity="1"/>
					<stop offset="100%" stop-color="white" stop-opacity="0"/>
				</radialGradient>
			</defs>
			<circle fill="url(#grad)" r="${halfSize}"/>
		</svg>`);
		brushImage.onload = ()=>{
			this.texture = imgToTex(proj.gl, brushImage);
		}
	}
	/**
	 * @param {PointerEvent} e 
	 */
	pointerup(e){
		const stroke = this.stroke;
		if (!stroke) return;

		const xs = stroke.path.map(p=>p.x);
		const ys = stroke.path.map(p=>p.y);
		const size = this.brushSize / 2;

		// ブラシが描画したパスとブラシサイズから描画した範囲を求める
		const x = Math.floor(Math.min(...xs) - size) ;
		const width = Math.ceil(Math.max(...xs) - x + size);
		const y = Math.floor(Math.min(...ys) - size);
		const height = Math.ceil(Math.max(...ys) - y + size);
		
		const proj = this.project;
		const layer = proj.selectedLayer;

		// レイヤーの前の状態と後のテクスチャのブラシ描画範囲を抜き出して
		// ImageData化する(GPUに載せとくのは無駄なので)
		const before = cropTexture(proj.gl, { texture:this.temp, width:proj.width, height:proj.height}, x, y, width, height);
		const after = cropTexture(proj.gl, layer, x - layer.x, y - layer.y, width, height);
		
		proj.history.push(new RenderTextureAction(layer, 
			texToImgData(proj.gl, before, width, height),
			texToImgData(proj.gl, after, width, height),
			x, y
		));

		proj.gl.deleteTexture(before);
		proj.gl.deleteTexture(after);
	}
	/**
	 * @param {PointerEvent} e
	 * @param {number} x
	 * @param {number} y 
	 */
	pointermove(e, x, y){
		this.stroke?.add(x, y, this.pressure ? e.pressure : 1);
	}
	/**
	 * @param {PointerEvent} e
	 * @param {number} x
	 * @param {number} y 
	 */
	pointerdown(e, x, y){

		{ // レイヤーの前の状態を一時テクスチャに保存
			const proj = this.project;
			const layer = proj.selectedLayer;
			const gl = proj.gl;
			
			const srcFrameBuffer = gl.createFramebuffer();
			gl.bindFramebuffer(gl.FRAMEBUFFER, srcFrameBuffer);
			const tex = layer.getTexture();
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
			
			const dstFrameBuffer = gl.createFramebuffer();
			gl.bindFramebuffer(gl.FRAMEBUFFER, dstFrameBuffer);
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.temp, 0);

			gl.bindFramebuffer(gl.READ_FRAMEBUFFER, srcFrameBuffer);
			gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dstFrameBuffer);

			const offsetY = layer.height - proj.height + layer.y;
			gl.blitFramebuffer(
				-layer.x, offsetY,
				proj.width  - layer.x,
				proj.height + offsetY,
				0, 0,
				proj.width,
				proj.height,
				gl.COLOR_BUFFER_BIT,
				gl.NEAREST
			);
			
			gl.deleteFramebuffer(srcFrameBuffer);
			gl.deleteFramebuffer(dstFrameBuffer);
		}

		//ストローク開始
		this.stroke = new Stroke(this, this.project.selectedLayer, x, y, this.pressure ? e.pressure : 1);
	}
}


export class Move {
	layerX = 0;
	layerY = 0;
	mouseX = 0;
	mouseY = 0;
	
	/**
	 * @param {Project} project
	 */
	constructor(project){
		this.project = project;
	}

	/**
	 * @param {PointerEvent} e
	 * @param {number} x
	 * @param {number} y 
	 */
	pointerup(e, x, y){
		const proj = this.project;
		const layer = proj.selectedLayer;
		
		// マウスを上げたらヒストリーに位置を保存する
		proj.history.group(()=>{
			layer.x = this.layerX;
			layer.y = this.layerY;
			layer.redrawProject();
			layer.expand();
			proj.history.push(new SetValueAction(layer, "x", Math.round(x - this.mouseX), true));
			proj.history.push(new SetValueAction(layer, "y", Math.round(y - this.mouseY), true));
			layer.redrawProject();
		});
	}
	
	/**
	 * @param {PointerEvent} e
	 * @param {number} x
	 * @param {number} y 
	 */
	pointermove(e, x, y){
		const layer = this.project.selectedLayer;
		layer.redrawProject();
		layer.x = Math.round(this.layerX + x - this.mouseX);
		layer.y = Math.round(this.layerY + y - this.mouseY);
		layer.redrawProject();
	}

	/**
	 * @param {PointerEvent} e
	 * @param {number} x
	 * @param {number} y 
	 */
	pointerdown(e, x, y){
		this.layerX = this.project.selectedLayer.x;
		this.layerY = this.project.selectedLayer.y;
		this.mouseX = x;
		this.mouseY = y;
	}
}