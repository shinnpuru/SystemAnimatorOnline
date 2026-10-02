// Reuse the models and motions distributed with System Animator.
export const models = [
  { id: 'alicia', label: 'Alicia', path: 'jThree/model/alicia.min.zip', entry: 'Alicia_solid_v02.pmx' },
  { id: 'miku', label: '初音未来 · Appearance Miku', path: 'jThree/model/Appearance Miku.min.zip', entry: 'Appearance Miku_BDEF_mod-v05.pmx' }
];

export const motions = [
  ['stand', '自然站姿', '日常与拍照', 'standmix2_modified.vmd'],
  ['pose', '模特摆姿', '日常与拍照', 'model/gal_model_motion_with_legs-2_loop_v01.vmd'],
  ['appeal1', '镜头互动 01', '日常与拍照', 'model/camera_appeal01.vmd'],
  ['appeal2', '镜头互动 02', '日常与拍照', 'model/camera_appeal02.vmd'],
  ['appeal3', '镜头互动 03', '日常与拍照', 'model/camera_appeal03.vmd'],
  ['talk', '聊天手势', '日常与拍照', 'talk/xs-talk8-west-negotiate.vmd'],
  ['walk', '轻快走路', '移动与跳跃', 'walk_n_run/walk_A01_f0-40_s9.85.vmd'],
  ['walk2', '悠闲走路', '移动与跳跃', 'walk_n_run/walk_A04_f0-40_s13.44.vmd'],
  ['run', '跑步', '移动与跳跃', 'walk_n_run/run_H01_f0-24.vmd'],
  ['jump', '轻轻一跳', '移动与跳跃', 'tsuna/tsuna_small_jump.vmd'],
  ['magic-jump', '魔法跳跃', '移动与跳跃', 'landing/05_magical_jump_v01.vmd'],
  ['suki', '好き！雪！本気マジック', '舞蹈', 'demo/suki_yuki_maji_magic/suki_yuki_maji_magic.vmd'],
  ['galaxias', 'galaxias!', '舞蹈', 'demo/galaxias_motion/galaxias_miku_v2.vmd'],
  ['lupin', 'Lupin', '舞蹈', 'demo/lupin/lupin.vmd'],
  ['xyz', 'XYZ 的魔法', '舞蹈', 'demo/magic_of_xyz/magic_of_xyz.vmd'],
  ['wave', 'Wavefile', '舞蹈', 'demo/wavefile_motion/wavefile_lat.vmd'],
  ['stride', '放课后 Stride', '舞蹈', 'demo/after_school_stride/after_school_stride.vmd'],
  ['step', 'STEP', '舞蹈', 'demo/STEP/1_step-motion1.vmd'],
  ['spring', 'Spring Shower', '舞蹈', 'demo/SpringShower/SpringShowerL.vmd'],
  ['black-gold', 'Black & Gold', '舞蹈', 'demo/mozuya/black_n_gold.vmd']
].map(([id, label, group, file]) => ({ id, label, group, path: `MMD.js/motion/${file}` }));

const downloads = new Map();
export async function bundledAsset(path) {
  if (!downloads.has(path)) downloads.set(path, (async () => {
    const response = await fetch(path.split('/').map(encodeURIComponent).join('/'));
    if (!response.ok) throw new Error(`Bundled asset unavailable: ${path}`);
    return response.blob();
  })().catch(error => { downloads.delete(path); throw error; }));
  return downloads.get(path);
}
