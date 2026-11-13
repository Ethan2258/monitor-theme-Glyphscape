// Packs the built theme into theme.tar.gz, the file a hub installs: dist/,
// theme.json and preview.png, which unpack to exactly the directory a hub reads a
// theme from. Run with `npm run pack`, which builds first.
//
// The archive is written here rather than by the system's tar. A hub accepts
// regular files and directories and nothing else, and what a tar program adds on
// its own initiative varies: bsdtar, which is what `tar` is on Windows and
// macOS, writes extended-header entries for some names. This writes plain ustar
// entries only, the same bytes on every platform.
//
// Before writing, it checks what a hub checks on install, so a package that
// would be refused is refused here, with the reason.
import { createHash } from "node:crypto"
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { gunzipSync, gzipSync } from "node:zlib"

const root = join(import.meta.dirname, "..")
const MiB = 1024 * 1024
// The hub's limits, from the theme development guide.
const LIMIT = { archive: 32 * MiB, unpacked: 64 * MiB, file: 8 * MiB, entries: 2000 }

const fail = (why) => {
  console.error(`✗ ${why}`)
  process.exit(1)
}

// theme.json: six string fields, the first two non-empty, and a version that
// agrees with package.json -- a release tag is held to the same value, and a
// hub offers an update for as long as the two differ.
const theme = JSON.parse(readFileSync(join(root, "theme.json"), "utf8"))
for (const key of ["name", "short", "description", "version", "author", "url"]) {
  if (typeof theme[key] !== "string") fail(`theme.json: ${key} 要是字符串`)
}
if (!theme.name || !/^[A-Za-z0-9_-]+$/.test(theme.short)) fail("theme.json: name 不能为空，short 限字母、数字、- 和 _")
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
if (pkg.version !== theme.version) fail(`版本不一致：package.json ${pkg.version}，theme.json ${theme.version}`)

// Every setting the panel would not draw is a setting an operator cannot change.
const keys = new Set()
for (const field of theme.config ?? []) {
  if (field.type === "title") continue
  const at = `theme.json: 设置 ${field.key}`
  if (typeof field.key !== "string" || keys.has(field.key)) fail(`${at} 的 key 缺失或重复`)
  keys.add(field.key)
  const ok =
    field.type === "boolean" ? typeof field.default === "boolean"
    : field.type === "number" ? typeof field.default === "number"
        && field.default >= (field.min ?? -Infinity) && field.default <= (field.max ?? Infinity)
    : field.type === "select" ? Array.isArray(field.options) && field.options.some((o) => o.value === field.default)
    : (field.type === "string" || field.type === "text") && typeof field.default === "string"
  if (!ok) fail(`${at} 的 type 与 default 对不上`)
}

// What goes in: the build, the manifest, the thumbnail.
const files = []
const dirs = []
const walk = (dir) => {
  dirs.push(`${dir}/`)
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) walk(path)
    else if (entry.isFile()) files.push(path)
    else fail(`${path} 不是普通文件`)
  }
}
try {
  statSync(join(root, "dist/index.html"))
} catch {
  fail("没有 dist/index.html，先运行 npm run build")
}
walk("dist")
files.push("theme.json", "preview.png")

let unpacked = 0
for (const path of files) {
  const { size } = statSync(join(root, path))
  if (size > LIMIT.file) fail(`${path} 有 ${(size / MiB).toFixed(1)} MiB，单个文件上限 8 MiB`)
  unpacked += size
}
if (unpacked > LIMIT.unpacked) fail(`解压后共 ${(unpacked / MiB).toFixed(1)} MiB，上限 64 MiB`)
if (files.length + dirs.length > LIMIT.entries) fail(`共 ${files.length + dirs.length} 个文件和目录，上限 2000`)

// One ustar header: a 512-byte block naming the entry that follows.
function header(path, size, directory) {
  const block = Buffer.alloc(512)
  // A name past 100 bytes is split at a slash into the prefix field.
  let name = path, prefix = ""
  if (Buffer.byteLength(name) > 100) {
    const cut = name.indexOf("/", Buffer.byteLength(name) - 101)
    if (cut < 0 || Buffer.byteLength(name.slice(0, cut)) > 155) fail(`路径太长：${path}`)
    prefix = name.slice(0, cut)
    name = name.slice(cut + 1)
  }
  const octal = (value, width) => value.toString(8).padStart(width - 1, "0") + "\0"
  block.write(name, 0)
  block.write(octal(directory ? 0o755 : 0o644, 8), 100)
  block.write(octal(0, 8), 108)
  block.write(octal(0, 8), 116)
  block.write(octal(size, 12), 124)
  block.write(octal(Math.floor(Date.now() / 1000), 12), 136)
  block.write("        ", 148)
  block.write(directory ? "5" : "0", 156)
  block.write("ustar\0" + "00", 257)
  block.write(prefix, 345)
  let sum = 0
  for (const byte of block) sum += byte
  block.write(sum.toString(8).padStart(6, "0") + "\0 ", 148)
  return block
}

const blocks = []
for (const dir of dirs) blocks.push(header(dir, 0, true))
for (const path of files) {
  const body = readFileSync(join(root, path))
  blocks.push(header(path, body.length, false), body, Buffer.alloc((512 - (body.length % 512)) % 512))
}
// Two empty blocks end the archive.
blocks.push(Buffer.alloc(1024))

const archive = gzipSync(Buffer.concat(blocks), { level: 9 })
if (archive.length > LIMIT.archive) fail(`压缩包有 ${(archive.length / MiB).toFixed(1)} MiB，上限 32 MiB`)
// Read back whole: the hub checks the gzip trailer and refuses a stream cut short.
if (gunzipSync(archive).length !== blocks.reduce((n, b) => n + b.length, 0)) fail("压缩包读回来与写入的不一致")

writeFileSync(join(root, "theme.tar.gz"), archive)
const sha256 = createHash("sha256").update(archive).digest("hex")
writeFileSync(join(root, "theme.tar.gz.sha256"), `${sha256}\n`)

console.log(`theme.tar.gz  ${theme.name} ${theme.version}`)
console.log(`  ${files.length} 个文件，解压后 ${(unpacked / MiB).toFixed(2)} MiB，压缩后 ${(archive.length / MiB).toFixed(2)} MiB`)
console.log(`  sha256 ${sha256}`)
if (!theme.url) console.log("  提示：theme.json 的 url 还是空的。填上 GitHub 仓库地址后，面板才能一键更新。")
