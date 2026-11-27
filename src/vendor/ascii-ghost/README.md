# ascii-ghost

`scene.js`、`wraith.js`、`util.js` 取自 [Ethan2258/ascii-ghost](https://github.com/Ethan2258/ascii-ghost)
的提交 `1d3217dac590bd0e02ee48d3f29aee6ef0e9133f`，原样未改，许可证见同目录的 `LICENSE`（MIT）。

`scene.d.ts` 是本主题为它写的类型声明，不属于上游。用法在 `src/lib/realm.ts`：
本主题传 `leftTree: false`（不画左边那棵小枯树，免得它长在左对齐的读数上）、`fps: 30`，
以及在手机（粗指针或窄于 640px）上取 1 的 `maxDpr`。

以前 `fps` 和 `maxDpr` 是本主题打在 `scene.js` 上的补丁，现在是上游的正式选项（同样的代码和默认值），
所以升级时把上游 `src/` 里的三个文件覆盖过来、改掉上面的提交号即可，不用再打补丁。
