import { Layer } from './layer.js';
import { Project } from './project.js';
import { drawImage, imgToTex } from './util.js';

class Action {
	undo(){throw new Error("no implement method.")}
	redo(){throw new Error("no implement method.")}
}

/** プロパティ代入のヒストリアクション */
export class SetValueAction extends Action {
	/**
	 * 
	 * @param {*} target 
	 * @param {string|number} key 
	 * @param {*} value 
	 * @param {boolean} delta 
	 */
	constructor(target, key, value, delta = false) {
		super();
		this.target = target;
		this.delta = delta;
		this.key = key;
		this.oldValue = target[key];
		this.newValue = value;
		this.redo();
	}
	undo(){
		if (this.delta) {
			this.target[this.key] -= this.newValue;
		} else {
			this.target[this.key] = this.oldValue;
		}
	}
	redo(){
		if (this.delta) {
			this.target[this.key] += this.newValue;
		} else {		
			this.target[this.key] = this.newValue;
		}
	}
}

/** 配列操作のヒストリアクション */
export class SpliceArrayAction extends Action {
	/**
	 * 
	 * @param {Array} target 
	 * @param {number} index 
	 * @param {number} deleteLength 
	 * @param {Array} inserts 
	 */
	constructor(target, index, deleteLength, ...inserts) {
		super();
		this.target = target;
		this.index = index;
		this.oldValues = target.slice(index, index + deleteLength);
		this.newValues = inserts;
		this.redo();
	}
	undo(){
		this.target.splice(this.index, this.newValues.length, ...this.oldValues);
	}
	redo(){
		this.target.splice(this.index, this.oldValues.length, ...this.newValues);
	}
}

/**
 * @deprecated
 * 不要になりましたんや
 */
export class ResizeTextureAction extends Action {}

/** レイヤー描画のヒストリアクション */
export class RenderTextureAction extends Action {
	/**
	 * 
	 * @param {Layer} target 
	 * @param {ImageData} before 
	 * @param {ImageData} after 
	 * @param {number} x
	 * @param {number} y
	 */
	constructor(target, before, after, x, y) {
		super();
		this.target = target;
		this.before = before;
		this.after = after;
		this.x = x;
		this.y = y;
	}
	undo(){
		const layer = this.target;
		const gl = layer.gl;
		const texture = imgToTex(gl, this.before);
		drawImage(gl, layer.project.screenPatchShader, layer, {
			texture,
			width:this.before.width,
			height:this.before.height,
		}, {}, this.x - layer.x, this.y - layer.y);

		gl.deleteTexture(texture);
	}
	redo(){
		const layer = this.target;
		const gl = layer.gl;
		const texture = imgToTex(gl, this.after);
		drawImage(gl, layer.project.screenPatchShader, layer, {
			texture,
			width:this.after.width,
			height:this.after.height,
		}, {}, this.x - layer.x, this.y - layer.y);

		gl.deleteTexture(texture);
	}
}

/**
 * ヒストリ管理クラス
 * 保持するヒストリ数に上限は設けていないが、普通は持った方がいい（メモリ的に）
 */
export class History {
	histories = [];
	index = 0;
	/**
	 * @param {Project} project 
	 */
	constructor(project){
		this.project = project;
	}

	/** @type {Action[]|undefined} */
	_currentGroup = void(0);
	/**
	 * コールバック中だけ追加するヒストリの内容をグループ化する
	 * グループ化したヒストリで一度でアンドゥしたりリドゥしたりできる
	 * @param {()=>any} cb 
	 * @returns {any}
	 */
	group(cb){
		const currengGrp = this._currentGroup;
		this._currentGroup = [];
		(currengGrp || this.histories).push(this._currentGroup);
		const ret = cb();
		this._currentGroup = currengGrp;
		return ret;
	}
	undo(){
		const action = this.histories[this.histories.length - 1 - this.index];
		if (!action) return;
		// 再帰的にアンドゥする
		(function recursiveUndo(act){
			if (Array.isArray(act)) {
				for (let i = act.length - 1; i >= 0; i--) {
					recursiveUndo(act[i]);
				}
			} else {
				act.undo();
			}
		})(action);
		this.index ++;
		this.project.redrawAll();
	}
	redo(){
		const action = this.histories[this.histories.length - this.index];
		if (!action) return;
		// 再帰的にリドゥする
		(function recursiveRedo(act){
			if (Array.isArray(act)) {
				for (let i = 0; i < act.length; i++) {
					recursiveRedo(act[i]);
				}
			} else {
				act.redo();
			}
		})(action);
		this.index --;
		this.project.redrawAll();
	}
	/**
	 * 
	 * @param  {...Action} actions 
	 */
	push(...actions) {
		if (this.index > 0) { //ヒストリ追加時にアンドゥしている分は削除する
			this.histories.splice(this.histories.length - this.index, this.histories.length);
			this.index = 0;
		}
		(this._currentGroup || this.histories).push(...actions);
	}
	clear(){
		this.histories.length = 0;
	}
	get length(){ return this.histories.length; }
}