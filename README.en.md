# Headless Model Tool

English | [中文](README.md)

A headless 3D asset inspection tool for AI agents and developers. It runs an isolated Electron renderer and produces machine-readable JSON reports and PNG snapshots without opening a game or a 3D editor.

Extracted from [Wolf of Tarkov](https://github.com/eojnus/wolf-of-tarkov). This standalone edition does not include game-specific character or physics adapters.

## Features

- Inspect meshes, materials, textures, skeletons, animations, bounds and resource loading in GLB, glTF and USDZ assets.
- Render a snapshot at a selected animation clip, time and yaw.
- Trim and rename supported GLB/glTF animation clips and optionally export a derived GLB with explicit confirmation.
- Report candidate mappings and risks between skeletons; animation transfer is not implemented.
- Return JSON status and diagnostics; inputs are read-only and existing outputs are not overwritten.

## Quick start

Requires Node.js **20.19+ on the 20.x line or 22.12+** and npm. Windows is tested; other platforms have not been verified. Run in Windows PowerShell:

```powershell
git clone https://github.com/eojnus/headless-model-tool.git
cd headless-model-tool
npm ci
npm run build
node tools/model-tool/cli.mjs capabilities

$model = (Resolve-Path examples/triangle/model.gltf).Path
$outRoot = Join-Path (Get-Location).Path 'output'
node tools/model-tool/cli.mjs inspect --input $model --out (Join-Path $outRoot 'inspect')
node tools/model-tool/cli.mjs snapshot --input $model --out (Join-Path $outRoot 'snapshot')
```

The snapshot directory contains a PNG and `report.json`. Replace `--input` with the absolute path of your own model. Inputs and outputs must be absolute paths; outputs must stay within this repository. Use a fresh output directory for each invocation.

Use `node tools/model-tool/cli.mjs <command> --help` for options. Commands are `capabilities`, `inspect`, `snapshot`, `animation-edit`, and `retarget`. CLI help and some diagnostics are currently in Chinese.

## Agent contract

The CLI writes one JSON object to stdout and progress to stderr. Every command except `capabilities` and `--help` starts an isolated Electron process.

- `ok` / exit 0: the task completed, not a guarantee of visual quality or full asset support.
- `partial` / exit 6: the result is incomplete; inspect `diagnostics` and `data.resourceIntegrity`.
- `error`: task failed. Other exit codes: 2 argument, 3 unsupported, 4 path/permission, 5 processing.

Inspect `data.resources` for declared, loaded, failed and unknown resources. A screenshot with missing textures is for diagnosis only. `null` means unknown, not zero.

## Limitations

USDZ is read-only. Animation editing supports LINEAR/STEP only; CUBICSPLINE and other special interpolations are rejected, and export reserializes the asset without a lossless guarantee. Retargeting produces a mapping report only, and both models must be in the same directory. Remote resources are not downloaded; glTF dependencies must remain within the model directory. Snapshots do not prove animation quality or runtime performance.

## License

[MIT](LICENSE). Third-party dependencies have their own licenses. Ensure you have rights to any model or texture you process.
