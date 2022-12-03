import { Brush } from './brush.js';
import { SpliceArrayAction } from './history.js';
import {Project} from './project.js';
import { cropImageData, debugPreview, drawImage, expandedRect, imageDataToURL, initTexture, texToImgData } from './util.js';


/**
 * 
 * @param {Uint8Array} pixels 
 * @param {number} width 
 * @param {number} height 
 * @param {number} direction 
 * @param {"width"|"height"} key 
 * @returns 
 */
function trimAlpha(pixels, width, height, direction, key){
	const horizontal = key === "width" ? width : height; //レイに対して水平
	const vertical = key === "width" ? height : width; //レイに対して垂直
	
	const halfVertical = parseInt(vertical / 2);

	const channel = 3;

	const index = (key === "width") ? (
		(h, v)=>{
			return ( ( v * width ) + h ) * 4 + channel;
		}
	) : (
		(v, h)=>{
			return ( ( v * width ) + h ) * 4 + channel;
		}
	)

	let depth = 0;
	for ( let ray = 0; ray < horizontal; ++ray ) {
		const i = ( direction > 0 ) ? ray : (horizontal - ray - 1);
		
		const alpha = pixels[index( i, halfVertical )];
		depth = ray - 1;
		if (alpha !== 0) break;
	}

	for (let back = depth; back > 0; --back ) {
		for (let ray = 0;ray < halfVertical;++ray) {
			const i = ( direction > 0 ) ? back : (horizontal - back);
			const alpha = 
				pixels[index( i, halfVertical - ray )] + 
				pixels[index( i, halfVertical + ray )];
			if (alpha > 0) {
				depth = back - 1;
				break;
			}
		}
	}
	return Math.max( depth, 0 );
}


export class Layer {
	x = 0;
	y = 0;
	width = 0;
	height = 0;
	visible = true;
	opacity = 1.0;
	
	/** @type {ImageData|undefined} */
	image = void(0);

	/** @type {"normal"|"multiply"|"add"|"sub"} */
	blend = "normal";

	/**
	 * 
	 * @param {Project} project 
	 */
	constructor(project){
		this.name = "新規レイヤー";
		this.project = project;
	}
	get gl(){ return this.project.gl; }
	get index(){ return this.project.layers.indexOf(this); }

	/**
	 * レイヤー移動
	 * @param {number} x 
	 * @param {number} y 
	 */
	move(x, y){
		this.x += x;
		this.y += y;
	}

	/**
	 * テクスチャにレイヤーを書き込み
	 * @param {WebGLTexture|null} target
	 * @param {DOMRect} rect
	 */
	drawTo(target, rect){
		rect ||= {width:this.width, height:this.height, x:this.x, y:this.y};
		const project = this.project;
		this.getTexture();
		drawImage(
			project.gl,
			project.blends[this.blend],
			{
				texture:target || project.texture,
				width:project.width,
				height:project.height,
			},
			this,
			{
				opacity:this.opacity,
			},
			rect.x - this.x, rect.y - this.y, rect.width, rect.height,
			rect.x, rect.y, rect.width, rect.height,
		);
		if (project.selectedLayer?.index < this.index) this.getImage();
	}

	/**
	 * topに指定したレイヤーまで順番にテクスチャに描画する
	 * @param {WebGLTexture} target 対象テクスチャ
	 * @param {DOMRect} rect 描画範囲
	 * @param {Layer} top 
	 */
	drawChain(target, rect, top){
		rect ||= {width:this.width, height:this.height, x:this.x, y:this.y};
		if (this.visible) {
			this.drawTo(target, rect);
		}
		const proj = this.project;

		const index = this.index;
		const next = proj.layers[index - 1];
		if (target === proj.texture && index === 0) {
			// 一番上のレイヤーならスクリーンを更新
			proj.redraw(rect);
		} else if (next && top !== next){
			// 一つ上のレイヤーを更新
			next.drawChain(target, rect, top);
		}
	}

	/**
	 * レイヤーを削除
	 */
	delete(){
		// GPUにテクスチャが乗っていればImageData化してメインメモリに回す
		// あくまでも削除はヒストリに参照が残る
		// ヒストリからも消した時にメインメモリからちゃんとGCで消せるから
		// (テクスチャ状態でもGCがかかるらしいけどかなり疑わしい)
		this.getImage();
		this.project.history.push(new SpliceArrayAction(this.project.layers, this.index, 1));
		this.project.redrawAll();
	}

	/**
	 * スクリーン更新を挿入
	 * @param {DOMRect} rect 再描画範囲
	 */
	redrawProject(rect){
		const proj = this.project;
		const index = this.index;
		rect ||= {width:this.width, height:this.height, x:this.x, y:this.y};

		const redrawRect = proj.redrawRect || {x:rect.x, y:rect.y, width:rect.width, height:rect.height};
		const expRect = redrawRect ? expandedRect(redrawRect, rect) : rect;
		redrawRect.x = expRect.x;
		redrawRect.y = expRect.y;
		redrawRect.width  = expRect.width;
		redrawRect.height = expRect.height;


		//再描画のリクエスト発生済なら
		if (proj.redrawLayer && proj.redrawLayer.index > index) {
			return;
		}

		proj.redrawRect = redrawRect;
		proj.redrawLayer = this;
		
		requestAnimationFrame(()=>{
			if (proj.redrawLayer && proj.redrawLayer.index > index) {
				return;
			}
			const cacheTex = this.getCacheTexture();
			if (cacheTex) {
				drawImage(
					this.gl,
					proj.screenPatchShader,
					proj,
					{
						texture:cacheTex,
						width:proj.width,
						height:proj.height,
					},
					Object.create(null),
					redrawRect.x, redrawRect.y, redrawRect.width, redrawRect.height,
					redrawRect.x, redrawRect.y, redrawRect.width, redrawRect.height,
				);
			} else {
				drawImage(
					this.gl,
					proj.clearShader,
					proj,
					{ texture:null, width:0, height:0, },
					Object.create(null),
					redrawRect.x, redrawRect.y, redrawRect.width, redrawRect.height,
					redrawRect.x, redrawRect.y, redrawRect.width, redrawRect.height,
				);
			}
			this.drawChain(proj.texture, redrawRect);
		});
	}

	/**
	 * キャッシュテクスチャを作成 
	 * @type {WebGLTexture|undefined}
	 * */
	_cacheTexture = void(0);
	getCacheTexture(){
		if (this._cacheTexture) return this._cacheTexture;

		const proj = this.project;
		const gl = this.gl;
		const texture = this._cacheTexture = gl.createTexture();
		if (!texture) throw new Error("failed create cache texture.");

		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, texture);
		initTexture(gl);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, proj.width, proj.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
		gl.bindTexture(gl.TEXTURE_2D, null);
		
		const bottomLayer = proj.layers[proj.layers.length - 1];
		
		//一番下が無いか自身であればスキップ
		if (!bottomLayer || bottomLayer === this) return;
		
		bottomLayer.drawChain(texture, {
			x:0, y:0, width:proj.width, height:proj.height
		}, this);

		return this._cacheTexture;
	}

	/**
	 * レイヤーのテクスチャをキャンバスサイズに足りるように拡大する
	 */
	expand(){
		const proj = this.project;
		const gl = proj.gl;
		const prevWidth = this.width;
		const prevHeight = this.height;
		
		const oldTex = this.getTexture();

		const x = this.x;
		const y = this.y;

		const rect = expandedRect(
			{ x:0, y:0, width:proj.width, height:proj.height },
			{ x, y, width:prevWidth, height:prevHeight }
		);

		const width = rect.width;
		const height = rect.height;
		
		const newTex = gl.createTexture();
		
		gl.bindTexture(gl.TEXTURE_2D, newTex);
		initTexture(gl);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
		gl.bindTexture(gl.TEXTURE_2D, null);
		if (prevWidth > 0 && prevHeight > 0){
			const srcFrameBuffer = gl.createFramebuffer();
			gl.bindFramebuffer(gl.FRAMEBUFFER, srcFrameBuffer);
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, oldTex, 0);
			
			const dstFrameBuffer = gl.createFramebuffer();
			gl.bindFramebuffer(gl.FRAMEBUFFER, dstFrameBuffer);
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, newTex, 0);
		
			gl.bindFramebuffer(gl.READ_FRAMEBUFFER, srcFrameBuffer);
			gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dstFrameBuffer);
			
			gl.blitFramebuffer(
				0,
				0,
				prevWidth,
				prevHeight,
				Math.max(x, 0),
				height - Math.max(y, 0) - prevHeight,
				prevWidth + Math.max(x, 0),
				height - Math.max(y, 0),
				gl.COLOR_BUFFER_BIT, gl.LINEAR);

			gl.deleteFramebuffer(srcFrameBuffer);
			gl.deleteFramebuffer(dstFrameBuffer);
		}

		gl.deleteTexture(oldTex);
		this.texture = newTex;
		this.width = width;
		this.height = height;
		this.x = Math.min(x, 0);
		this.y = Math.min(y, 0);
	}
	getTexture(){
		if (this.texture) return this.texture;

		const gl = this.gl;
		const tex = this.texture = gl.createTexture();
		
		gl.bindTexture(gl.TEXTURE_2D, tex);
		initTexture(gl);
		if (this.image) {
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.image);
			this.image = void(0);
		} else {
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.project.width, this.project.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
		}
		gl.bindTexture(gl.TEXTURE_2D, null);
		
		return tex;
	}
	/** テクスチャのレイヤー画像のアルファ部分を切り抜いてImageData化
	 * GPUは側は開放する
	 */
	getImage(){
		if (this.image) return this.image;
		if (!this.texture) return new ImageData(1, 1);
		if (!this.width || !this.height) return;
		
		const img = texToImgData(this.gl, this.texture, this.width, this.height);
		this.gl.deleteTexture(this.texture);
		this.texture = void(0);
		
		const top    = trimAlpha(img.data, this.width, this.height,  1, "height");
		const bottom = trimAlpha(img.data, this.width, this.height, -1, "height");
		const left   = trimAlpha(img.data, this.width, this.height,  1, "width");
		const right  = trimAlpha(img.data, this.width, this.height, -1, "width");
		

		this.width = img.width - right - left;
		this.height = img.height - bottom - top;

		this.image = cropImageData(img, left, top, this.width, this.height, false);

		this.x += left;
		this.y += top;

		return this.image;
	}
	get isSelected(){ return this.project.selectedLayer === this; }
	select(){
		if (!this.isSelected) {
			this.project.selectedLayer?.deselect();
		}

		this.project.selectedLayer = this;
		this.getCacheTexture();
		this.getTexture();
		this.expand();
	}
	deselect(){
		this._deleteCacheTexture();
		this.getImage();
	}
	/** キャッシュ削除 */
	_deleteCacheTexture(){
		if (!this._cacheTexture) return;
		const gl = this.gl;
		gl.deleteTexture(this._cacheTexture);
		this._cacheTexture = void(0);
	}
	moveup(){
		const index = this.index;
		if (index === 0) return;
		const proj = this.project;
		proj.history.group(()=>{
			proj.history.push(new SpliceArrayAction(proj.layers, index, 1));
			proj.history.push(new SpliceArrayAction(proj.layers, index - 1, 0, this));
		});
		this._deleteCacheTexture();
		this.redrawProject();
		proj.layers[index]._deleteCacheTexture();
		proj.layers[index].redrawProject();
	}
	movedown(){
		const index = this.index;
		const proj = this.project;
		if (index === (proj.layers.length - 1)) return;
		proj.history.group(()=>{
			proj.history.push(new SpliceArrayAction(proj.layers, index, 1));
			proj.history.push(new SpliceArrayAction(proj.layers, index + 1, 0, this));
		});
		this._deleteCacheTexture();
		this.redrawProject();
		proj.layers[index]._deleteCacheTexture();
		proj.layers[index].redrawProject();
	}
}