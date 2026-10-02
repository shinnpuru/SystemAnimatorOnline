# MMD Camera · 角色相机

本分支把项目首页改为摄像头实景与 MMD 角色同框的 Web App。当前界面只保留角色导入、动作播放、取景构图与拍照。

## 本地启动

需要 Node.js。在项目文件夹运行：

```sh
node XRA_node_server.js
```

打开 http://localhost:3000/ 或 http://localhost:3000/XR_Animator.html 。无需安装依赖。手机或远程访问需自行使用 HTTPS 服务；摄像头不能在普通 HTTP 远程地址中使用。

## 使用

1. 导入 PMX/PMD 模型。推荐把模型与贴图按原目录结构放入 ZIP，也可选择整个角色文件夹，或同时选择模型和贴图文件。包含多个模型的 ZIP 会让你选择角色。
2. 导入 VMD 动作，或包含 VMD 的 ZIP。动作可以先于角色导入；拖放也支持文件与文件夹。当前仅播放角色骨骼及表情动作，相机/灯光专用 VMD 会给出提示。
3. 点击「开启摄像头」，在浏览器中允许权限；可切换设备，或只对实景画面开启镜像。浏览器不会请求麦克风。
4. 调整角色大小、位置和朝向；拖动取景窗口旋转镜头，滚轮缩放，Shift + 拖动平移。触屏支持双指缩放与平移。
5. 时间轴支持播放/暂停、跳转、循环和倍速。选用 16:9、9:16 或 1:1 画幅后，点击「拍一张」，预览并保存 PNG。照片不包含界面、取景角标或水印。

手机竖屏默认使用 9:16 取景，底部「角色」「动作」「设置」打开相应面板，拍照按钮始终位于底部。取景栏的摄像头按钮可快速开关实景；横竖屏切换会保留所选画幅和已导入的角色。

所有角色、动作与照片都在本机浏览器内处理。导入文件不会上传，摄像头不会自动开启；点击关闭或离开页面会释放摄像头。照片按取景比例导出（16:9 为 1920×1080，9:16 为 1080×1920，1:1 为 1920×1920）。

## 当前范围

- 提供内置 Alicia 角色与站姿动作供试用，沿用项目已有资源。
- 保留骨骼/表情动画、IK 与 grant，首版尚未启用刚体/布料物理、SDEF、材质/UV morph 与动作音频。
- 动捕、VMC、直播、场景编辑等功能不出现在新界面中；原 XR Animator 页面保留为 `XR_Animator_legacy.html`。
- 新界面使用独立的本地 Three.js r163 MMD 运行时，不依赖上游已删除的 MMD 模块，不影响旧页面的运行时。

## 检查

使用 Node.js 18 或更新版本：

```sh
node --test tests/mmd-camera.test.mjs
```

检查 ZIP/日文文件名、Windows 贴图路径、同名贴图冲突、目录拖入的多批读取，以及照片裁切的一致性。

---

以下保留原项目说明。

﻿# XR Animator

### Full-body, real-time motion tracking with a single webcam, on your PC and web browser

<p align="center">
  <img width="640" height="360" title="XR Animator" src="https://github.com/ButzYung/SystemAnimatorOnline/raw/master/images/XR_Animator_thumbnail01.png">
</p>

<ins>***XR Animator***</ins>, inherited from my previous desktop gadget project known as System Animator, is a video/webcam-based AI motion capture application designed for VTubing and the metaverse era. It uses the machine learning (ML) solution from [Google MediaPipe](https://github.com/google/mediapipe) to detect the 3D poses from a live webcam video, which is then used to drive the 3D avatar (VRM/MMD model) as if you are controlling it with your body. It can be used for VTubing and various XR/3D purposes.

It has a variety of motion tracking options. You can choose to track the face, full body, or something in between (any combination of face/body/hands).

The web app version works on all major web browsers both on desktop and smartphone. On browsers supporting both web worker and OffscreenCanvas (e.g. Chrome), it can achieve 60fps visual rendering and 30fps body pose detection on a mediocre PC. On smartphones with limited processing power, you may want to use limit its usage on face tracking.

### 🌐[XR Animator - Web app version](https://sao.animetheme.com/XR_Animator.html)

The Windows/Linux/macOS app version (powered by [Electron](https://www.electronjs.org/)) is also availabe for download, which provides a few extra features (e.g. VMC-protocol, transparent background) available only in a native-OS environment.

### 🖥️[XR Animator - Windows/Linux/macOS app version](https://github.com/ButzYung/SystemAnimatorOnline/releases)

# Features

- Support full-body AI motion tracking using a single webcam or media file (image/video)

- Support "Perfect Sync"/ARKit-compatible 52 blendshapes for realistic face tracking

- Support using any VRM/MMD model as your 3D avatar

- Record mocap motion and export it to VMD/BVH/glTF motion format

- Support loading VMD/FBX/BVH/VRMA format 3D motions

- Export FBX/BVH/VRMA motions to VMD format

- Support VMC-protocol to animate a 3D model elsewhere in other VMC-enabled applications such as VSeeFace, VNyan and Warudo (Electron mode only)

- Customize the background and 3D scene with 2D image/video, 3D panorama and 3D objects (.x/.glb format)

- Support 2D image as 3D backdrop by assigning an auto AI-generated depth map [(video demo)](https://www.youtube.com/watch?v=rrQo76al8pk), as well as optionally running independently on Windows background (Electron mode) as 3D wallpaper gadget [(video demo)](https://www.youtube.com/watch?v=0iufChshAkE&t=63s), and web app mode as a [2D-to-3D image viewer](https://sao.animetheme.com/SystemAnimator_online.html?cmd_line=demo21)

- Support webcam object tracking, mapping tracked IRL objects to 3D props [(video demo)](https://www.youtube.com/watch?v=Da4UKNbhmYY)

- Support frameless window with transparent background on video capture apps such as OBS (Electron mode only)

- Support AR (Augmented Reality) on Android Chrome browser

**_Check out these [video demos and tutorials](https://youtube.com/playlist?list=PLLpwhHMvOCSt3i7NQcyJq1fFhoMiSmm5H) and watch XR Animator in action!_**

# Performance

XR Animator has relatively low system requirements, making it usable on a wide range of devices, including laptops and even smartphones. On an entry-level PC with GTX1650-class GPU running XR Animator with full body mocap, you can expect 20+ fps on pose/fingers tracking, 40+ fps (capped at 30) on face tracking, and 60fps on 3D rendering.

However, if you are using a laptop but you are experiencing lower-than-expected frame rate, the app may be using the slower integrated GPU. This may happen on laptops with a dual-GPU setup. In such a case, configure your graphics card settings and make sure that the faster dedicated GPU is used. Check out the article below if you don't know how.

[How to Force Windows to Use Dedicated Graphics](https://techcult.com/how-to-force-windows-to-use-dedicated-graphics/)

# Augmented Reality (AR)

<p align="center">
  <img width="720" height="440" title="XR Animator in AR" src="https://github.com/ButzYung/SystemAnimatorOnline/raw/master/images/XR_Animator_thumbnail02.png">
</p>

XR Animator and some other demos of System Animator Online support the "Augmented Reality" (AR) mode on mobile phones, which renders the 3D models that appear as if they exist in the real world. The AR mode requires mobile phones that support Google's ARCore technology, Chrome browser and the new WebXR API. Follow the steps below.

1. [Check here for a list of ARCore-supported devices](https://developers.google.com/ar/discover/supported-devices) and see if your device is supported.

2. Install [Google Play Services for AR](https://play.google.com/store/apps/details?id=com.google.ar.core) (ARCore) on Google Play.

3. Install Chrome browser for Android.

Are you ready for the AR experience? [Check out the online version of XR Animator](https://sao.animetheme.com/XR_Animator.html) on your Android Chrome browser!

After the page has been fully loaded, click on the little phone button on the top-left (or bottom-left) menu to activate the AR mode. Once the AR mode is enabled, you will see what your phone's camera is showing. Move your camera around the ground where you want to place the 3D model, and a white circle should apppear. Double-tap on the screen, and the 3D model will be placed over the white circle. Double-tab again to re-summon the white circle if you want to place the model elsewhere.

[Check out these YouTube videos](https://www.youtube.com/playlist?list=PLLpwhHMvOCSt_9k1zDMKHc7X1nBUwnU8l) for demonstration.

# ❤️Support this project

The future of XR Animator relies on your support🙇 Some IRL family issues have significantly increased my financial burden. While it was fun to develop the app, financial return was next to minimal. Reality forces me to evaluate the sustainability of this project, or soon I will have to give up...😢

If you like XR Animator, please consider making a donation🙇 Or even better, join my membership with perks such as ***EARLY ACCESS to the latest version XR Animator*** (at least 9 months ahead of the public release on GitHub), insider stories/tips and other benefits🎁 Sponsor us, and help keep this project free and sustainable🙏

- ☕[Ko-fi (Membership)](https://ko-fi.com/butzyung/tiers)
- 🎁[FANBOX (メンバーシップ)](https://xra.fanbox.cc/)
- ☕[Buy Me a Coffee](https://ko-fi.com/butzyung)
- 🙏[Donate via PayPal](https://www.paypal.me/AnimeThemeGadgets)

XR Animator is currently sponsored by the following people❤️

- **NewruGuru, Kai, Nymph, KuraiNoOni, LouLi Lou, skeh, Swoonifer, Nyaarium, Kyonko_VT, ObsidianMaker, Catt, ARON, Stimmchen, CoCoNo**
- Other supporters

# About System Animator

<p align="center">
  <img width="720" height="450" title="System Animator" src="https://www.animetheme.com/sidebar/sc_sidebar_04.jpg">
</p>

System Animator was originally a desktop gadget project, born more than 10 years ago. The latest version, System Animator Online, is a major version advancement with focus on working as a web app instead of being just a desktop gadget. It fully supports MikuMikuDance (MMD) models and motions, as well as the latest VRM models and FBX/BVH motions, to create an immersive 3D environment.

Although the desktop gadget version of System Animator is somewhat obsolete now, you can still visit its website to know more about it.
https://www.animetheme.com/sidebar/

### 📖Background Story

System Animator was born more than 10 years ago as a personal and tiny 100-line-ish JavaScript desktop gadget project for Windows Vista which shows an animated rocket Anime girl as a CPU meter (the animation is still in XR Animator).

As time goes by, I decided to add more features, multi-purpose system meter, music visualizer, 3D/MMD support, animated wallpaper engine, RPG engine and eventually what you see in XR Animator. The codebase has grown exponentially while the core is still an Internet-Explorer-based JavaScript gadget, and things were becoming more and more clumsy, to a point when I had to decide whether to rewrite everything from scratch to match the modern coding standard (open source, module based, etc). However, I gave up and decided to carry on with what I have written, as a total restart would require too much time and efforts, probably not worthy as a personal project. Besides, as the rule of programming says, "If it works, don't touch it" LOL

Eventually, I decided to put the project on Github for my own convenience, but technically speaking you can consider it open source, though I have to admit that some of the codes are outdated, clumsy and confusing. Everything is fine if you are just an end-user of XR Animator/System Animator as an app, but if you want to build your own things from my codes, be warned that they can be pretty incomprehensible LOL

# Other demos based on System Animator Online

- [3D Miku The Dancer](https://sao.animetheme.com/) (drop any MP3 and she will dance for you)

- [3D Miku RPG](https://sao.animetheme.com/?cmd_line=/TEMP/DEMO/miku_rpg01)

- [3D Vocaloid Fighters - Miku vs Teto](https://sao.animetheme.com/?cmd_line=/TEMP/DEMO/miku_battle_arena01)

- [3D Multiplayer RPG](https://sao.animetheme.com/SystemAnimator_online_multiplayer.html) (up to 3 players)

All demos support the use of custom MMD (MikuMikuDance) model. Drop a zip of your favorite MMD model at the beginning, press the START button, and the demo will proceed with your model instead of the default one.

# Copyright/License/Credits

### General license:
- License (CC BY-NC-SA 4.0) - http://creativecommons.org/licenses/by-nc-sa/4.0/
  - This license applies if you are adapting XR Animator's source code for your own purpose, such as building another software or service.
  - This license does not cover any third-party assets which may have incompatible licenses of their own.
  - This license does not apply to content generated from the functionality of XR Animator, such as video content generated from the motion capture feature of XR Animator using your own assets. <ins>***XR Animator claims no right or responsibility over such content.***</ins>

### Core apps/libraries:

- System Animator © Butz Yung/Anime Theme
  - Disclaimer:
    http://www.animetheme.com/system_animator_online/docs/disclaimer.txt

- [Electron](https://www.electronjs.org/)

- [three.js](https://threejs.org/)

- [three-vrm](https://github.com/pixiv/three-vrm)

- [jThree v2](https://github.com/GrimoireGL/GrimoireJS) (NOTE: jThree has been discontinued. Its successor is known as "Grimoire.js")

- [ammo.js](https://github.com/kripken/ammo.js), a port of Bullet Physics to JavaScript, zlib licensed

- [JSZip](https://stuk.github.io/jszip/) (used under MIT license)

- [MediaPipe](https://github.com/google/mediapipe)

- [Transformers.js](https://github.com/huggingface/transformers.js)

- [bvh2vrma](https://github.com/vrm-c/bvh2vrma)

- [osc-js](https://github.com/adzialocha/osc-js)

- [electron-as-wallpaper](https://github.com/meslzy/electron-as-wallpaper)

- [PeerJS](https://peerjs.com/)

- [TensorFlow.js](https://github.com/tensorflow/tfjs)

### Other third-party assests

- ["ニコニ立体ちゃん" 3D Model](http://3d.nicovideo.jp/alicia/)

- "Appearance Miku" MMD Model - [Readme/License](http://www.animetheme.com/system_animator_online/jThree/model/Appearance%20Miku/Readme.txt)

- [ローポリ雑魚敵 by 黒胡椒 さん](http://www.nicovideo.jp/watch/sm11196123)

- [気休めモーション配布 by モコキッカー さん](http://www.nicovideo.jp/watch/sm24249428)

- [格闘シーン簡易作成用モーション by spinach さん](http://www.nicovideo.jp/watch/sm29537433)

- Some texture/image/icon sources
    https://3dtextures.me/
    https://opengameart.org/content/rpg-inventory
    https://opengameart.org/content/fantasy-icon-pack-by-ravenmore-0
    https://opengameart.org/content/potion-bottles
    https://www.flaticon.com/
    https://www.iconfinder.com/
    https://icon-icons.com/en/pack/Social-Distancing/2274
    https://github.com/icons8/flat-color-icons
    https://www.behance.net/gallery/41818673/FREE-SPORT-ICONS

- [3D skydome textures by Ryntaro Nukata/額田倫太郎](http://ryntaro-n.anime.coocan.jp/MMD.htm)

- Simple Explosion by Bleed
    https://remusprites.carbonmade.com/
    https://opengameart.org/content/simple-explosion-bleeds-game-art

- [Cartoon_Punch_02.wav by RSilveira_88](https://freesound.org/people/RSilveira_88/sounds/216198/)

- Various 3D background effects ported and modified from codes found on [Shadertoy](https://www.shadertoy.com/)

- Some icons and backgrounds from [Freepik](https://www.freepik.com/)

- For some other third-party programming libraries/3D data/assets used in System Animator, please refer to the corresponding script/readme for license and terms (can be found on the downloadable/Github version of System Animator).

### Other third-party assests used in some demos

- もぐ式りょう/りく/りょく/りん by Mogg
    https://3d.nicovideo.jp/works/td55798
    https://3d.nicovideo.jp/works/td55973
    https://3d.nicovideo.jp/works/td56074
    https://3d.nicovideo.jp/works/td56604

- "Stranger Things" - A Remix ft. Michael Jobity
    https://soundcloud.com/foreignmachine/stranger-remix

- Dragon Ball Super I Ultra Instinct OST I Clash of Gods Remix I Hip Hop Instrumental I @AndrezoWorks
    https://www.youtube.com/watch?v=KJ71dY4mkNo

- Credits are given to the authors of any other image/media files used in System Animator.

# Contacts

- YouTube:
  https://www.youtube.com/user/AnimeThemeGadget

- X/Twitter:
  https://twitter.com/butz_yung

- Discord:
  https://discord.gg/Xs4YEMVtkx

- Ko-fi:
  https://ko-fi.com/butzyung

- FANBOX:
  https://xra.fanbox.cc/

- Homepage (System Animator):
  https://www.animetheme.com/sidebar/

- Email:
  webmaster@animetheme.com
