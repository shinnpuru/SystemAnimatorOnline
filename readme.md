# MMD Camera · 角色相机

本分支把项目首页改为摄像头实景与 MMD 角色同框的 Web App。当前界面只保留角色导入、动作播放、取景构图、拍照与空间 AR。

## 本地启动

需要 Node.js。在项目文件夹运行：

```sh
node XRA_node_server.js
```

打开 http://localhost:3000/ 或 http://localhost:3000/XR_Animator.html 。无需安装依赖。手机或远程访问需自行使用 HTTPS 服务；摄像头不能在普通 HTTP 远程地址中使用。

## GitHub Pages 发布

网站地址：[https://dance.shinnpuru.site/](https://dance.shinnpuru.site/) 。Pages 从 `master` 分支根目录发布，保留 `.nojekyll`，无需额外构建。推送到 `master` 后，GitHub 自动构建并部署。

根目录 `CNAME` 文件和 Pages 自定义域名设置均为 `dance.shinnpuru.site`，当前 HTTPS 地址可正常访问。后续变更域名时，同步更新 DNS、`CNAME` 文件和 Pages 设置。

## 使用

1. 打开页面自动加载 Alicia 与自然站姿。在「选择角色」中切换 Alicia / 初音未来；也可导入自己的 PMX/PMD 模型。推荐把模型与贴图按原目录结构放入 ZIP，也可选择整个角色文件夹，或同时选择模型和贴图文件。包含多个模型的 ZIP 会让你选择角色。
2. 在「选择动作」中选用 20 段已有动作，分为日常与拍照、移动与跳跃、舞蹈；选中即播放。也可导入 VMD 或包含 VMD 的 ZIP。动作可以先于角色导入；拖放也支持文件与文件夹。当前仅播放角色骨骼及表情动作，相机/灯光专用 VMD 会给出提示。
3. 点击「开启摄像头」，在浏览器中允许权限；默认优先使用后置镜头，后摄不镜像、前摄默认镜像（均可手动更改）。取景栏的翻转按钮可切换前后镜头；「设置 → 输入设备」始终提供前摄/后摄，也能选择浏览器列出的其他镜头。只有单个摄像头的电脑会使用可用镜头。浏览器不会请求麦克风。
4. 调整角色大小、位置和朝向；拖动取景窗口旋转镜头，滚轮缩放，Shift + 拖动平移。触屏支持双指缩放与平移。
5. 时间轴支持播放/暂停、跳转、循环和倍速。选用 16:9、9:16 或 1:1 画幅后，点击「拍一张」，预览并保存 PNG。照片不包含界面、取景角标或水印。

手机和桌面均以取景画面为主，不显示顶栏或常驻侧栏。「角色」「动作」「设置」「拍照」与摄像头、镜头切换、画幅、AR、全屏和光照合并为右上角的悬浮按钮组，窄屏自动换行；动作播放控制悬浮在画面下方。界面不再保留底栏，取景按所选画幅使用全屏的最大可用空间，保持预览与导出照片构图一致。手机竖屏默认使用 9:16，横竖屏切换会保留所选画幅和已导入的角色。

所有角色、动作与照片都在本机浏览器内处理。导入文件不会上传，摄像头不会自动开启；点击关闭或离开页面会释放摄像头。照片按取景比例导出（16:9 为 1920×1080，9:16 为 1080×1920，1:1 为 1920×1920）。

切换前先释放旧摄像头，避免手机不能同时打开前后镜头导致占用失败；驱动尚未释放时短暂等待并重试一次。选中的镜头不可用时尝试重新开启原镜头，并显示错误原因。即使浏览器只枚举出当前设备或不提供设备列表，仍可通过 `facingMode` 切换前后镜头。显式切换使用 `exact`，不会悄悄继续使用错误镜头；首次开启使用 `ideal: environment`，允许只有一个摄像头的设备回退。参见 [MDN 前后摄像头说明](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia#front_and_back_camera)。

## 动漫渲染与画面光照

默认「动漫 · 分层阴影」参考原神式角色的视觉方向：分层明暗、偏冷的暗部、细描边、柔和面部阴影、边缘光和实时自阴影。沿用原 MMD 贴图、透明度、骨骼/表情动画及原仓库的 OutlineEffect，仍可切换回「原始 MMD」。这是通用 PMX/PMD 的风格化处理，不是原神着色器的复刻；没有为每个角色制作的面部 SDF、材质遮罩或光照贴图。边缘光实现也参考 [Unity Toon Shader 文档](https://docs.unity3d.com/Packages/com.unity.toonshader@0.10/manual/Rimlight.html)。

- 调节主光亮度、环境补光、来光方向/高度与色温；高级选项可调阴影层次、边缘光、描边强度和角色曝光。提供棚拍、夕照、月光预设。
- 「导入背景照片」会把照片用于取景背景，并自动估计光照。选择照片会关闭普通摄像头；再次开启摄像头时切换到实景。PNG 导出包含当前背景与同一套角色渲染。
- 「匹配画面光照」分析当前可见的照片裁切或镜像后的摄像头画面，估计亮度、色温、阴影对比与大致来光方向。照片不上传。开启「自动跟随摄像头光照」后每 1.5 秒采样并平滑更新；手动调节或选用预设会停止跟随。
- 单张普通照片不能唯一还原真实三维光源，明亮物体也可能误导估计。界面会提示暗场/均匀光照下的方向不确定，结果适合作为手动调整的起点。此实现不使用云端 AI 或 HDR 环境重建。
- AR 保留进入前的光照设置与相同角色材质。自动估光使用普通摄像头；进入 AR 后暂停，当前未接入 WebXR Light Estimation。

内置角色/动作全部复用仓库已有资源，未新增第三方下载。作者和使用条款仍见各模型压缩包以及原动作目录的 readme；部分动作限制商业使用。舞蹈仅提供动作，不附带音乐。

## 空间 AR

参考原仓库 `MMD.js/MMD_SA.js` 的 `MMD_SA.WebXR` 实现，将 viewer-space hit-test、放置圆环、可选锚点跟踪和会话退出恢复适配到当前相机界面。使用已有的 Three.js r163 WebXR 渲染器与同一套 MMD 模型/动作，不加载原页面的其他功能。

1. 使用自动加载的角色/动作，或在选择列表中切换、导入自己的文件。
2. 点击取景栏的「AR」，允许浏览器开启空间定位。
3. 缓慢移动手机，寻找地面或桌面；看到圆环后点击「放在这里」或轻触画面。墙面、天花板和陡斜面不接受放置。
4. 角色在真实空间中保留放置位置；可调整 20–220 cm 的高度、转向和动作播放，点击「重新放置」更换位置。定位丢失时暂时隐藏角色，恢复后继续显示。
5. 点击「退出 AR」回到相机，已导入的角色、动作和原取景设置会保留。进入 AR 前开启的普通摄像头会在退出后恢复；离开页面则释放全部摄像头和 AR 资源。

需要支持 `immersive-ar`、hit-test 与 DOM Overlay 的浏览器/设备，通过 HTTPS 打开。本机调试可以使用 localhost，手机访问电脑上的普通 HTTP 地址无法开启 AR。目标平台与上游一致：支持 ARCore 的 Android 手机、Chrome 与 Google Play Services for AR，见 [Google WebXR 文档](https://developers.google.com/ar/develop/webxr)。iPhone Safari 当前未提供该 WebXR 能力，页面会提示并保留普通相机叠加，见 [MDN 兼容性数据](https://github.com/mdn/browser-compat-data/blob/main/api/XRSystem.json)。以页面的运行时检测和实际会话请求结果为准。

AR 模式使用浏览器的实景透视，当前请用手机系统截图保存同框画面；普通相机模式仍可导出 PNG。此版本未实现真实物体遮挡或持久化锚点。锚点不可用时使用会话内的 local 空间定位，定位空间重置后需要重新放置。

AR 生命周期、平面过滤、米制缩放、定位恢复、可选锚点和初始化失败有模拟自动测试；界面切换、播放及相机恢复已在模拟环境验证。真实设备的平面识别、定位精度和性能仍需在 ARCore 手机上验证。

## 当前范围

- 提供 Alicia / 初音未来两款内置角色与 20 段动作，沿用项目已有资源。
- 保留骨骼/表情动画、IK 与 grant，首版尚未启用刚体/布料物理、SDEF、材质/UV morph 与动作音频。
- 动捕、VMC、直播、场景编辑等功能不出现在新界面中；原 XR Animator 页面保留为 `XR_Animator_legacy.html`。
- 新界面使用独立的本地 Three.js r163 MMD 运行时，不依赖上游已删除的 MMD 模块，不影响旧页面的运行时。

## 检查

使用 Node.js 18 或更新版本：

```sh
node --test tests/mmd-camera*.test.mjs
```

检查 ZIP/日文文件名、Windows 贴图路径、同名贴图冲突、目录拖入的多批读取，以及照片裁切的一致性；另包含 AR 放置、资源释放、退出恢复与异步取消等检查。

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
