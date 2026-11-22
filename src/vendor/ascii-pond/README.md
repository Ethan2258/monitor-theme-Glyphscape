# ascii-pond

`pond.js`、`koi.js`、`util.js` 取自 [stqfdyr/ascii-pond](https://github.com/stqfdyr/ascii-pond)
的提交 `b52e6e45a36247c1b6afa87859b1b87c6d596217`，许可证见同目录的 `LICENSE`（MIT）。`pond.js` 有下面几处本主题的改动，每处都标了 `[patch]` 注释，其余两个文件原样。

`pond.d.ts` 是本主题为它写的类型声明，不属于上游。

## 本主题的改动（`[patch]`）

`pond.js`：

- 新选项 `fps`：每秒最多画几帧，0 为跟随屏幕刷新。本主题传 30，离上一帧不到 31 ms 的帧跳过。
- 新选项 `maxDpr`：最高像素密度，数字或每次 resize 时调用的函数，默认 2。本主题在手机（粗指针或窄于 640px）上取 1。
- 新选项 `autoMeasure`：false 时不监听滚动、不每 30 帧重新测量，由宿主自己调用 `measure()`。本主题在 `src/lib/pond.ts` 的 `followLayout` 里按页头的尺寸和内容变化测量。
- 滚出视野时整个循环停下（不再模拟、不再申请帧），回到视野时从离开处继续；上游是看不见时仍在模拟。`destroy()` 同时取消待执行的帧。

升级时把上游 `src/` 里的三个文件覆盖过来，再把上面的提交号改掉，然后按上面的清单把 `[patch]` 重新打上。本主题只用到 `mount()` 和它返回的
`renderer.setDimBoxes`、`renderer.reveal`，用法在 `src/lib/pond.ts`。
