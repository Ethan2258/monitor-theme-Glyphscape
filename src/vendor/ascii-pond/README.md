# ascii-pond

`pond.js`、`koi.js`、`util.js` 原样取自 [stqfdyr/ascii-pond](https://github.com/stqfdyr/ascii-pond)
的提交 `b52e6e45a36247c1b6afa87859b1b87c6d596217`，没有改动，许可证见同目录的 `LICENSE`（MIT）。

`pond.d.ts` 是本主题为它写的类型声明，不属于上游。

升级时把上游 `src/` 里的三个文件覆盖过来，再把上面的提交号改掉。本主题只用到 `mount()` 和它返回的
`renderer.setDimBoxes`、`renderer.reveal`，用法在 `src/lib/pond.ts`。
