import { SetValueAction } from './history.js';
import {Project} from './project.js';



/**
 * 今回はVue.jsで簡易に済ます
 * @param {Project} project 
 */
export function ui(project){

	new Vue({
		el:"#layers", 
		data:()=>({project}),
		methods:{
			deleteLayer(){
				this.project.selectedLayer?.delete();
			},
			opacityChanged(e, layer){
				this.project.history.push(new SetValueAction(layer, "opacity", Number(e.target.value)));
				layer.redrawProject();
				
			},
			nameChanged(e, layer){
				this.project.history.push(new SetValueAction(layer, "name", e.target.value));
			},
			visibleChanged(e, layer){
				this.project.history.push(new SetValueAction(layer, "visible", !layer.visible));
				layer.redrawProject();
			},
			blendChanged(e, layer){
				this.project.history.push(new SetValueAction(layer, "blend", e.target.value));
				layer.redrawProject();
			},
		},
		template:/*html*/`
			<div>
				<ol>
					<li
						v-for="(layer, index) in project.layers"
						:key="index"
						class="layers__layer"
						:class="{'is-selected':project.selectedLayer === layer}"
						@click="layer.select()"
					>
						<button style="width:3em; height:3em;" @click="visibleChanged($event, layer)">{{layer.visible ? "✔" : ""}}</button>
						<span class="layer__data" style="display:flex; flex-direction:column;">
							<p style="display:flex; flex-direction:row;">
								<select style="width:4em;" :value="layer.blend"  @change="blendChanged($event, layer)">
									<option value="normal">通常</option>
									<option value="multiply">乗算</option>
									<option value="add">加算</option>
									<option value="sub">減算</option>
								</select>
								<input type="range" min="0" max="1" step="0.01" :value="layer.opacity" @change="opacityChanged($event, layer)"/>
							</p>
							<input :value="layer.name" @change="nameChanged($event, layer)"/>
						</span>
						<p class="layer__actions layer-actions" style="display: flex; flex-direction: column;">
							<button style="border-radius: 4px 4px 0 0;" class="layer-actions__up" @click="layer.moveup()">▲</button>
							<button style="border-radius: 0 0 4px 4px;"  class="layer-actions__down" @click="layer.movedown()">▼</button>
						</p>
					</li>
				</ol>
				<p class="layers__actions" style="display: flex; flex-direction:row;">
					<button @click="project.add()">＋</button>
					<button @click="deleteLayer">🗑</button>
				</p>
			</div>
		`,
	});

	new Vue({
		el:"#tool", 
		data:()=>({project}),
		computed:{
			brushColor(){
				const proj = this.project;
				return `rgb(${proj.tool.color[0]}, ${proj.tool.color[1]}, ${proj.tool.color[2]})`;
			},
			brushColorCode(){

				const padding = (value)=>( Array(2).join('0') + value ).slice( -2 );

				const proj = this.project;
				const r = proj.tool.color[0].toString(16);
				const g = proj.tool.color[1].toString(16);
				const b = proj.tool.color[2].toString(16);
				return `#${padding(r)}${padding(g)}${padding(b)}`.toUpperCase();
			},
		},
		template:/*html*/`
			<div>
				<p>
					<button @click="project.history.undo()" style="font-size:26px; padding:0; margin:0;">↩</button>
					{{project.history.index}}/{{project.history.length}}
					<button @click="project.history.redo()" style="font-size:26px; padding:0; margin:0;">↪</button>
				</p>
				<p>
					<button :class="{'is-active':project.tool === project.tools.brush}" @click="project.tool = project.tools.brush">ブラシ</button>
					<button :class="{'is-active':project.tool === project.tools.move}" @click="project.tool = project.tools.move">移動</button>
				</p>
				<template v-if="project.tool === project.tools.brush">
					<div>
						<div style="display:flex; flex-direction:row;">
							<div :style="{'background-color':brushColor}" style="width:2em; height:2em; border-radius:50%;">
							</div>
							<input type="text" :value="brushColorCode" />
						</div>
						<p>
							R:<input type="range" step="1" min="0" max="255" v-model.number="project.tool.color[0]"/>
						</p>
						<p>
							G:<input type="range" step="1" min="0" max="255" v-model.number="project.tool.color[1]"/>
						</p>
						<p>
							B:<input type="range" step="1" min="0" max="255" v-model.number="project.tool.color[2]"/>
						</p>
					</div>
					<p>
						<label>
						筆圧
						<input type="checkbox" v-model.boolean="project.tool.pressure"/>
						</label>
					</p>
					<p>
						<label>
						消しゴム
						<input type="checkbox" v-model.boolean="project.tool.erase"/>
						</label>
					</p>
					<p>
						<label>
							サイズ
							<input type="range" step="1" min="3" max="100" v-model.number="project.tool.brushSize"/>
						</label>
					</p>
					<p>
						<label>
						間隔
						<input type="range" step="0.1" min="0.1" max="5" v-model.number="project.tool.interval"/>
						</label>
					</p>
					<p>
						<label>
							不透明度
							<input type="range" step="0.01" min="0.01" max="1" v-model.number="project.tool.opacity"/>
						</label>
					</p>
				</template>
			</div>
		`,
	});

	new Vue({
		el:"#footer",
		data:()=>({project}),
		template:/*html*/`
			<footer>
				<button @click="project.saveAsPNG()">PNGで保存</button>
			</footer>
		`
	});
}