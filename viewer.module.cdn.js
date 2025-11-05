
// viewer.module.cdn.js — impl with robust root resolver + OAuth fallback + ready notification
// three r159 compatible

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

console.log('[viewer-impl] loaded (three r159)');

let _renderer, _scene, _camera, _controls, _rootEl;

function _resolveRoot(arg){
  // Accept CSS selector string / HTMLElement / {root|el|selector}
  try{
    if (!arg) arg = '#stage';
    if (typeof arg === 'string'){
      const el = document.querySelector(arg);
      if (el) return el;
    } else if (arg instanceof HTMLElement){
      return arg;
    } else if (typeof arg === 'object'){
      if (arg.el instanceof HTMLElement) return arg.el;
      if (arg.root instanceof HTMLElement) return arg.root;
      if (typeof arg.selector === 'string'){
        const el = document.querySelector(arg.selector);
        if (el) return el;
      }
    }
  }catch(e){
    console.warn('[viewer] _resolveRoot failed for', arg, e);
  }
  return document.getElementById('stage') || document.body;
}

export function ensureViewer(rootArg){
  _rootEl = _resolveRoot(rootArg);
  // prepare mount
  let mount = _rootEl.querySelector('canvas');
  if (!mount){
    // create renderer
    _renderer = new THREE.WebGLRenderer({antialias:true, alpha:true});
    _renderer.setSize(_rootEl.clientWidth || 800, _rootEl.clientHeight || 600);
    // r159: use outputColorSpace
    _renderer.outputColorSpace = THREE.SRGBColorSpace;
    _rootEl.appendChild(_renderer.domElement);
  } else {
    // reuse old renderer if exists
    if (!_renderer){
      _renderer = new THREE.WebGLRenderer({canvas: mount, antialias:true, alpha:true});
      _renderer.outputColorSpace = THREE.SRGBColorSpace;
    }
  }

  // basic scene/camera
  _scene = new THREE.Scene();
  _camera = new THREE.PerspectiveCamera(45, (_rootEl.clientWidth||800)/(_rootEl.clientHeight||600), 0.1, 1000);
  _camera.position.set(0, 2, 6);
  _controls = new OrbitControls(_camera, _renderer.domElement);

  // animate
  function tick(){
    if (_controls) _controls.update();
    if (_renderer && _scene && _camera) _renderer.render(_scene, _camera);
    requestAnimationFrame(tick);
    // notify hook if exists
    try { window.lm?.onRenderTick?.(); } catch(e){}
  }
  requestAnimationFrame(tick);

  // expose scene getter for bridges
  try {
    // use setter if provided
    if (window.lm && typeof window.lm.__set_lm_scene === 'function'){
      window.lm.__set_lm_scene(()=>_scene);
    } else {
      // fallback expose
      window.lm = window.lm || {};
      window.lm.getScene = ()=>_scene;
    }
  } catch(e){ console.warn('[viewer] expose scene failed', e); }
}

async function _internalGetToken(){
  // Preferred: use app-provided getter
  if (window.lm && typeof window.lm.getAccessToken === 'function'){
    try { const t = await window.lm.getAccessToken(); if (t) return t; } catch(e){}
  }
  // Fallback: create GIS token client here (requires meta client_id)
  const meta = document.querySelector('meta[name="google-oauth-client_id"]');
  const client_id = meta?.getAttribute('content');
  if (!client_id){
    console.warn('[viewer] No OAuth client_id meta found.');
    return null;
  }
  const scopes = 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets.readonly';
  // wait for GIS to be present if boot loaded it
  if (!(window.google && window.google.accounts && window.google.accounts.oauth2)){
    // try to inject GIS
    await new Promise((resolve)=>{
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.onload = resolve;
      document.head.appendChild(s);
    });
  }
  const tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id, scope: scopes, prompt: ''
  });
  const token = await new Promise((resolve)=>{
    tokenClient.callback = (resp)=>{
      if (resp && resp.access_token) resolve(resp.access_token);
      else resolve(null);
    };
    try { tokenClient.requestAccessToken({prompt: ''}); }
    catch(e){ resolve(null); }
  });
  return token;
}

async function authFetch(url, opts={}){
  const token = await _internalGetToken();
  if (!token) throw new Error('No OAuth token; please Sign in.');
  const headers = new Headers(opts.headers || {});
  headers.set('Authorization', 'Bearer ' + token);
  return fetch(url, {...opts, headers});
}

async function _fetchDriveFileBlob(fileId){
  // accept full URL or raw id
  let id = fileId;
  const m = String(fileId).match(/[-\w]{25,}/);
  if (m) id = m[0];
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`;
  const res = await authFetch(url, { method:'GET' });
  if (!res.ok) throw new Error('Drive fetch failed '+res.status);
  return await res.blob();
}

export async function loadGlbFromDrive(fileId){
  if (!_scene) ensureViewer(_rootEl || '#stage');

  const blob = await _fetchDriveFileBlob(fileId);
  const objectURL = URL.createObjectURL(blob);
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(objectURL);

  // clear & add
  while(_scene.children.length) _scene.remove(_scene.children[0]);
  _scene.add(gltf.scene);

  // fit camera
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  _controls.target.copy(center);
  const maxSize = Math.max(size.x, size.y, size.z);
  const fitDist = maxSize * 1.5;
  _camera.position.copy(center.clone().add(new THREE.Vector3(fitDist, fitDist, fitDist)));
  _camera.lookAt(center);

  try {
    window.lm?.__resolveReadyScene?.(_scene);
    window.dispatchEvent(new CustomEvent('pm:scene-deep-ready', {detail:{scene:_scene}}));
  } catch(e){ console.warn('[viewer] ready notify failed', e); }
}

// ---- Stubs to match previous exports (prevent import errors) ----
export function addPinMarker(){}
export function removePinMarker(){}
export function clearPins(){}
export function onCanvasShiftPick(){}
export function onPinSelect(){}
export function onRenderTick(){}
export function setPinSelected(){}
export function projectPoint(){}
export function getScene(){ return _scene; }
