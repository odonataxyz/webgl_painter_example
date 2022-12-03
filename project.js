import { Brush, Move } from './brush.js';
import { Layer } from './layer.js';
import { initShader } from './shader.js';
import { ui } from './interface.js';
import { History, SpliceArrayAction } from './history.js';
import { debugPreview, drawImage, imageDataToURL, imgToTex, initTexture, texToImgData } from './util.js';

/** 汎用頂点シェーダー */
const VERT_SHADER = /*glsl*/`#version 300 es
precision mediump float;
precision mediump int;

in vec2 a_Position;
uniform vec4 u_Texcoord0_ST;
uniform mat4 u_DstMatrix;
 
out vec2 v_DstTexcoord;
out vec2 v_SrcTexcoord;
void main() {
	gl_Position = vec4(a_Position, 0.0, 1.0) * u_DstMatrix;
	v_DstTexcoord = (a_Position + 1.0) / 2.0;
	v_DstTexcoord.y = 1.0 - v_DstTexcoord.y;
	v_DstTexcoord = v_DstTexcoord * u_Texcoord0_ST.xy + u_Texcoord0_ST.zw;
	v_DstTexcoord.y = 1.0 - v_DstTexcoord.y;
	
	v_SrcTexcoord = ( gl_Position.xy + 1.0 ) / 2.0;
}`;

/**
 * ブレンドシェーダー作成
 * @param {string} blended 
 * @returns 
 */
function blendFragShader(blended){
	return /*glsl*/`#version 300 es
	precision mediump float;
	precision mediump int;
	
	in vec2 v_DstTexcoord;
	in vec2 v_SrcTexcoord;
	out vec4 fragColor;
	
	uniform float u_Opacity;
	uniform vec3 u_Color;
	uniform sampler2D u_DstTex;
	uniform sampler2D u_SrcTex;

	vec4 blend(vec4 base, vec4 paste, vec3 blended){
		float deltaPasteAlpha = paste.a * (1.0 - base.a);
		float alpha = base.a + deltaPasteAlpha;
		float alphaCutout = (alpha == 0.0) ? 0.0 : (1.0 / alpha);
		return vec4(
			(
				  (1.0 - paste.a) * base.a * base.rgb
				+ (1.0- base.a) * paste.a * paste.rgb
				+ base.a * paste.a * blended * (1.0 + base.a - base.a)
			) * alphaCutout,
			base.a + paste.a * (1.0 - base.a)
		);
	}

	void main() {
		vec4 baseColor = texture(u_SrcTex, v_SrcTexcoord);
		vec4 pasteColor = texture(u_DstTex, v_DstTexcoord) * float((0.0 <= v_DstTexcoord.x) && (v_DstTexcoord.x <= 1.0) && (0.0 <= v_DstTexcoord.y) && (v_DstTexcoord.y <= 1.0));
		pasteColor.rgb *= u_Color;
		pasteColor.a *= u_Opacity;
		fragColor = blend(baseColor, pasteColor, ${blended});
	}`;
}

export class Project {
	/** @type {Layer[]} */
	layers = [];
	/** @type {Layer} */
	selectedLayer = null;
	/**
	 * @param {HTMLCanvasElement} canvas 
	 */
	constructor(canvas){
		this.width = canvas.width;
		this.height = canvas.height;

		this.history = new History(this);
		
		this.canvas = canvas;
		
		const gl = this.gl = canvas.getContext("webgl2", {
			preserveDrawingBuffer:true,
			premultipliedAlpha: false,
		});
		this.initGL();

		this.tools = {
			move:new Move(this),
			brush:new Brush(this, 30),
		};
		this.tool = this.tools.brush;

		const eraseShader = initShader(gl, gl.createProgram(),
			VERT_SHADER,
			/*glsl*/`#version 300 es
			precision mediump float;
			precision mediump int;
			
			in vec2 v_DstTexcoord;
			in vec2 v_SrcTexcoord;
			out vec4 fragColor;
			
			uniform float u_Opacity;
			uniform sampler2D u_DstTex;
			uniform sampler2D u_SrcTex;

			void main() {
				vec4 baseColor = texture(u_SrcTex, v_SrcTexcoord);
				vec4 pasteColor = texture(u_DstTex, v_DstTexcoord) * float((0.0 <= v_DstTexcoord.x) && (v_DstTexcoord.x <= 1.0) && (0.0 <= v_DstTexcoord.y) && (v_DstTexcoord.y <= 1.0));
				baseColor.a -= pasteColor.a;
				fragColor = baseColor;
			}`
		);
		this.blends = {
			/** 通常合成 */
			normal:initShader(gl, gl.createProgram(),
				VERT_SHADER,
				blendFragShader("pasteColor.rgb")
			),
			/** 乗算合成 */
			multiply:initShader(gl, gl.createProgram(),
				VERT_SHADER,
				blendFragShader("baseColor.rgb * pasteColor.rgb")
			),
			/** 加算合成 */
			add:initShader(gl, gl.createProgram(),
				VERT_SHADER,
				blendFragShader("baseColor.rgb + pasteColor.rgb")
			),
			/** 減算合成 */
			sub:initShader(gl, gl.createProgram(),
				VERT_SHADER,
				blendFragShader("baseColor.rgb - pasteColor.rgb")
			),
			/** 消去(消しゴム用) */
			erase:eraseShader
		};
		
		this.screenPatchShader = initShader(gl, gl.createProgram(),
			/*glsl*/`#version 300 es
			precision mediump float;
			precision mediump int;
			in vec2 a_Position;
			uniform mat4 u_DstMatrix;
			out vec2 v_DstTexcoord;
			uniform vec4 u_Texcoord0_ST;
			void main() {
				gl_Position = vec4(a_Position, 0.0, 1.0) * u_DstMatrix;
				gl_Position.z = 0.0;
				v_DstTexcoord = (a_Position + 1.0) / 2.0;
				v_DstTexcoord.y = 1.0 - v_DstTexcoord.y;
				v_DstTexcoord = v_DstTexcoord * u_Texcoord0_ST.xy + u_Texcoord0_ST.zw;
				v_DstTexcoord.y = 1.0 - v_DstTexcoord.y;
			}`,
			/*glsl*/`#version 300 es
			precision mediump float;
			precision mediump int;
			in vec2 v_DstTexcoord;
			uniform sampler2D u_DstTex;
			uniform sampler2D u_PasteTex;
			out vec4 fragColor;
			void main() {
				fragColor = texture(u_DstTex, v_DstTexcoord) * float((0.0 <= v_DstTexcoord.x) && (v_DstTexcoord.x <= 1.0) && (0.0 <= v_DstTexcoord.y) && (v_DstTexcoord.y <= 1.0));
			}`
		);
		this.clearShader = initShader(gl, gl.createProgram(),
			/*glsl*/`#version 300 es
			precision mediump float;
			precision mediump int;
			in vec2 a_Position;
			uniform mat4 u_DstMatrix;
			void main() {
				gl_Position = vec4(a_Position, 0.0, 1.0) * u_DstMatrix;
				gl_Position.z = 0.0;
			}`,
			/*glsl*/`#version 300 es
			precision mediump float;
			precision mediump int;
			out vec4 fragColor; 
			void main() { fragColor = vec4(0.0, 0.0, 0.0, 0.0); }`
		);


		const test = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, test);
		initTexture(gl);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
		gl.bindTexture(gl.TEXTURE_2D, null);

		
		{ // サンプルレイヤーを読み込み
			this.add().name = "レイヤー3";
			this.add().name = "レイヤー2";
			this.add().name = "レイヤー1";

			const img1 = new Image();
			img1.src = "data:image/svg+xml;base64," + 
			btoa(/*xml*/`
			<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
				<text x="0" y="35" style="font-size:35" fill="red">Layer1</text>
			</svg>`);
			img1.onload = ()=>{	
				const layer1 = this.layers[0];
				layer1.opacity = 0.3;
				layer1.x = layer1.y = 25;
				layer1.texture = imgToTex(gl, img1);
				layer1.width = img1.width;
				layer1.height = img1.height;
	
				const img2 = new Image();
				img2.src = "data:image/svg+xml;base64," + 
				btoa(/*xml*/`
				<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
					<text x="0" y="35" style="font-size:35" fill="green">Layer2</text>
				</svg>`);
				img2.onload = ()=>{	
					const layer2 = this.layers[1];
					layer2.opacity = 0.7;
					layer2.x = layer2.y = 80;
					layer2.texture = imgToTex(gl, img2);
					layer2.width = img2.width;
					layer2.height = img2.height;
		
					const img3 = new Image();
					img3.src = "data:image/svg+xml;base64," + 
					btoa(/*xml*/`
					<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
						<text x="0" y="35" style="font-size:35" fill="blue">Layer2</text>
					</svg>`);
					img3.onload = ()=>{	
						const layer3 = this.layers[2];
						layer3.x = layer3.y = 130;
						layer3.texture = imgToTex(gl, img3);
						layer3.width = img3.width;
						layer3.height = img3.height;
						this.layers[this.layers.length - 1].redrawProject({x:0, y:0, width:this.width, height:this.height});
					}
				}
			}

		}

		this.history.clear();
		

		ui(this);
		
		canvas.addEventListener('pointerdown', (e)=>{
			const rect = e.target.getBoundingClientRect();
			if (!this.selectedLayer) throw new Error("レイヤー選択されていません");

			if (typeof(this.tool.pointerdown) === "function") {
				this.tool.pointerdown(
					e,
					e.clientX - rect.x,
					e.clientY - rect.y
				);
			}
			const moveHandler = (e)=>{ 
				if (typeof(this.tool.pointermove) === "function") {
					this.tool.pointermove(
						e,
						e.clientX - rect.x,
						e.clientY - rect.y
					);
				}
			}
			canvas.addEventListener('pointermove', moveHandler);
			document.addEventListener('pointerup', (e)=>{
				if (typeof(this.tool.pointerup) === "function") {
					this.tool.pointerup(
						e,
						e.clientX - rect.x,
						e.clientY - rect.y
					);
				}
				canvas.removeEventListener('pointermove', moveHandler);
			}, {once:true});
		});

		console.log(`project[${this.width}x${this.height}] is`, this);
	}
	initGL(){
		const gl = this.gl;

		gl.enable(gl.BLEND);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
		gl.blendFunc(gl.ONE, gl.ZERO);

		this.texture = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, this.texture);
		initTexture(gl);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
		gl.bindTexture(gl.TEXTURE_2D, null);
	}
	add(){
		return this.history.group(()=>{
			const layer = new Layer(this);
			const index = this.selectedLayer?.index || 0;
			this.history.push(new SpliceArrayAction(this.layers, index, 0, layer));
			return layer;
		});
	}

	/** @type {Layer|undefined} */
	redrawLayer = void(0);
	/** @type {{x:number, y:number, width:number, height:number}|undefined} */
	redrawRect = void(0);

	/**
	 * 全て再描画する
	 */
	redrawAll(){
		this.layers[this.layers.length - 1].redrawProject({x:0, y:0, width:this.width, height:this.height});
	}
	redraw(rect){
		rect ||= {
			x:0,
			y:0,
			width:this.width,
			height:this.height,
		}

		const gl = this.gl;
		
		const x = Math.floor( rect.x - 1.0 );
		const y = Math.floor( rect.y - 1.0 );
		const width = Math.floor( rect.width + 2.0 );
		const height = Math.floor( rect.height + 2.0 );

		drawImage(
			gl,
			this.screenPatchShader,
			{
				texture:null,
				width:this.width,
				height:this.height
			},
			this,
			Object.create(null),
			
			x,
			y,
			width,
			height,

			x, y, width, height,
		);
		this.redrawRect = void(0);
		this.redrawLayer = void(0)
	}
	saveAsPNG(){
		const img = texToImgData(this.gl, this.texture, this.width, this.height);
		const canvas = document.createElement("canvas");
		canvas.width = this.width;
		canvas.height = this.height;
		const ctx = canvas.getContext("2d");
		ctx.putImageData(img, 0, 0);
		canvas.toBlob((blob)=>{
			const a = document.createElement('a');
			a.href = typeof(blob) === 'string' ? blob : URL.createObjectURL(blob);
			a.download = "canvas.png";
			a.style.display = 'none';
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
		}, "image/png");
	}
}
