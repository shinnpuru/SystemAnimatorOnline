# MMD Camera runtime

This isolated runtime pins Three.js to r163, the last-generation runtime already
present in this project's `bfa04cc` revision. The camera app needs the MMD loader,
IK solver and animation helper that have been removed from the upstream r177 tree.
It does not change the runtime used by the preserved XR Animator app.

- `three.module.min.js`, `TGALoader`, the parser and animation helpers are copied
  from this repository at `bfa04cc`. Imports point to this local pinned runtime.
- `MMDLoader` and `MMDToonShader` come from the official Three.js
  [r163 tag](https://github.com/mrdoob/three.js/tree/r163/examples/jsm).
  The project's older custom shader was incompatible with r163 lighting.
- Three.js is MIT licensed. The bundled mmd-parser is authored by Takahiro and
  distributed by Three.js. Existing author and license headers are retained.
- Runtime assets are served locally; no CDN or package installation is needed.
- `effects/OutlineEffect.js` is ported from this repository's existing Three.js
  effect, with the import redirected to r163 and expired cache materials disposed.
  It preserves upstream's mesh visibility restriction and XR-compatible pass.

The camera edition currently enables skeletal animation, IK, grants and morph
animation. Rigid-body physics is disabled. `MMDPhysics.js` is retained as a static
dependency of `MMDAnimationHelper` but is not instantiated.
