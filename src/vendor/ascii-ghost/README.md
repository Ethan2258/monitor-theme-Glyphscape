# ascii-ghost

`scene.js`、`wraith.js`、`util.js` 取自 [Ethan2258/ascii-ghost](https://github.com/Ethan2258/ascii-ghost)
的提交 `05f6731d12ff0a53a6557089ac2b7de256556953`，许可证见同目录的 `LICENSE`（MIT）。`scene.js` 有下面几处本主题的改动，每处都标了 `[patch]` 注释，其余两个文件原样。

`scene.d.ts` 是本主题为它写的类型声明，不属于上游。用法在 `src/lib/realm.ts`：
本主题传 `leftTree: false`，不画左边那棵小枯树，免得它长在左对齐的读数上。

## 本主题的改动（`[patch]`）

`scene.js`：

- 新选项 `fps`：每秒最多画几帧，不传为跟随屏幕刷新。本主题传 30，离上一帧不到 31 ms 的帧跳过，时间计入下一步。
- 新选项 `maxDpr`：最高像素密度，数字或每次 resize 时调用的函数，默认 2。本主题在手机（粗指针或窄于 640px）上取 1。

升级时覆盖三个文件、改提交号，再按这份清单把 `[patch]` 重新打上。
