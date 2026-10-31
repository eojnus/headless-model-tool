# Headless Model Tool

[English](README.en.md) | 中文

一个面向 AI Agent 和开发者的无头 3D 模型检查工具。它通过隔离的 Electron 渲染进程读取资产，输出机器可读的 JSON 报告和 PNG 截图，无需启动游戏或手动操作 3D 编辑器。

从 [《塔科夫之狼》](https://github.com/eojnus/wolf-of-tarkov) 的模型工具中提取。本仓库是独立的通用版本，不包含该游戏专用的角色动作和碰撞场景适配。

## 功能

- 检查 GLB、glTF、USDZ 的网格、材质、纹理、骨骼、动画、包围盒和资源加载情况。
- 按动画片段、时间与方向生成 PNG 截图，方便 Agent 查看资产和贴图。
- 对支持的 GLB/glTF 动画裁剪、重命名，并可显式确认导出派生 GLB。
- 报告两套骨架的映射候选与风险；当前不生成跨模型动作。
- 输出 JSON、明确状态与错误码；输入默认只读，产物不覆盖已有文件。

## 安装与运行

需要 Node.js **20.19+（20.x）或 22.12+** 和 npm。以下命令在 Windows PowerShell 中执行；Windows 已验证，其他平台尚未验证。

```powershell
git clone https://github.com/eojnus/headless-model-tool.git
cd headless-model-tool
npm ci
npm run build

# 查看功能清单
node tools/model-tool/cli.mjs capabilities

# 使用仓库自带的 glTF + 贴图样例
$model = (Resolve-Path examples/triangle/model.gltf).Path
$outRoot = Join-Path (Get-Location).Path 'output'
node tools/model-tool/cli.mjs inspect --input $model --out (Join-Path $outRoot 'inspect')
node tools/model-tool/cli.mjs snapshot --input $model --out (Join-Path $outRoot 'snapshot')
```

`output/snapshot/` 中包含 PNG 和 `report.json`。要分析自己的模型，将 `--input` 换成 GLB、glTF 或 USDZ 文件的绝对路径。所有输入、输出路径必须是绝对路径；输出只能放在本仓库目录内，每次使用一个新的输出目录。

命令帮助与部分诊断目前为中文。查看完整参数：

```powershell
node tools/model-tool/cli.mjs --help
node tools/model-tool/cli.mjs snapshot --help
node tools/model-tool/cli.mjs animation-edit --help
node tools/model-tool/cli.mjs retarget --help
```

## 给 Agent 的结果约定

直接调用 `node tools/model-tool/cli.mjs ...`：标准输出是一个 JSON 对象，进度写入标准错误。除 `capabilities` 和 `--help` 外，每次命令启动一个独立 Electron 进程。

- `ok` / 退出码 0：任务完成，不代表所有模型特性或视觉效果已验证。
- `partial` / 退出码 6：结果不完整；查看 `diagnostics` 和 `data.resourceIntegrity`。
- `error`：任务失败；其他退出码为 2 参数、3 不支持、4 路径/权限、5 处理失败。

贴图加载失败时生成的截图仅供排查，不能证明材质正确。`data.resources` 将文件声明、实际加载、失败和未知项分开；`null` 不代表 0。

## 限制

- USDZ 只读，不支持编辑或写回；资源清单无法完整枚举。
- 动作编辑仅支持 LINEAR/STEP；CUBICSPLINE、Smooth 和未知自定义插值会被拒绝。导出是重新序列化，不保证无损。
- `retarget` 仅输出映射报告，不生成可播放动画；源模型和目标模型必须位于同一目录。游戏专用角色驱动和碰撞快照不包含在独立版中。
- 不下载远程资源；glTF 外部依赖需位于模型目录内。截图不证明游戏手感、动画自然度或性能。

## 许可

本仓库代码采用 [MIT License](LICENSE)；第三方依赖使用各自的许可证。请自行确认所分析模型及纹理的使用权限。
