#!/usr/bin/env node
// 模型工具命令行入口：参数解析、路径校验、envelope 组装、退出码。
// stdout 只输出一个完整 JSON；日志一律走 stderr。
import { stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT, ToolError, envelope, diagnostic } from './lib/schema.mjs';
import { validateRequest } from './lib/contract.mjs';
import { describeGlbDeclared } from './lib/glb.mjs';
import {
  AUTHORIZED_OUTPUT_ROOT,
  modelRootOf,
  prepareOutDir,
  resolveInputFile,
  resolveOutFile,
  sha256File,
  writeNewFile,
} from './lib/paths.mjs';
import { renderRunCount, runRendererTask } from './lib/runner.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..', '..');
const TOOL_VERSION = '0.1.0';
const EXAMPLE_CHARACTER_DIR = join(PROJECT_ROOT, 'examples', 'triangle');
const exampleOut = (name) => `"${join(AUTHORIZED_OUTPUT_ROOT, 'output', name)}"`;
const exampleModel = (name) => `"${join(EXAMPLE_CHARACTER_DIR, name)}"`;

const SUPPORTED_EXT = ['.glb', '.gltf', '.usdz'];

function log(message) {
  process.stderr.write(`[model-tool] ${message}\n`);
}

/* ------------------------------------------------------------------ 参数 */

const COMMANDS = {
  capabilities: {
    summary: '列出各格式与各命令的真实支持情况（不启动渲染进程）',
    args: [],
    example: 'node tools/model-tool/cli.mjs capabilities',
  },
  inspect: {
    summary: '只读检查模型：网格、材质、骨骼、片段、依赖、包围盒',
    args: [
      ['input', 'path', true, '模型绝对路径（.glb / .gltf / .usdz）'],
      ['out', 'path', true, '输出目录绝对路径（不存在则创建）'],
    ],
    example:
      `node tools/model-tool/cli.mjs inspect --input ${exampleModel('model.gltf')} --out ${exampleOut('inspect')}`,
  },
  snapshot: {
    summary: '按资产内片段与时间点渲染一张 PNG 与参数报告',
    args: [
      ['input', 'path', true, '模型绝对路径'],
      ['out', 'path', true, '输出目录绝对路径'],
      ['clip', 'string', false, '片段名；省略则截静止姿态'],
      ['time', 'number', false, '片段内秒数（默认 0，超出会被夹紧并诊断）'],
      ['yaw', 'number', false, '模型绕 Y 轴旋转角度（默认 0）'],
      ['width', 'number', false, '画布宽（默认 800）'],
      ['height', 'number', false, '画布高（默认 1000）'],
    ],
    example:
      `node tools/model-tool/cli.mjs snapshot --input ${exampleModel('model.gltf')} --out ${exampleOut('shot')} --time 0 --yaw 90`,
  },

  'animation-edit': {
    summary: '按秒裁剪/重命名片段并预览；仅 LINEAR/STEP，CUBICSPLINE 明确拒绝（C 包）',
    args: [
      ['input', 'path', true, 'glb/gltf 绝对路径（USDZ 明确不支持写回）'],
      ['out', 'path', true, '输出目录绝对路径'],
      ['clip', 'string', true, '源片段名'],
      ['rename', 'string', false, '新片段名'],
      ['start', 'number', false, '裁剪起点秒'],
      ['end', 'number', false, '裁剪终点秒'],
      ['write-glb', 'string', false, '派生 GLB 的相对输出路径，必须以 .glb 结尾'],
      ['confirm-write', 'flag', false, '确认写出派生资产（缺省只给计划）'],
    ],
    example:
      `node tools/model-tool/cli.mjs animation-edit --input "<animated-model.glb>" --out ${exampleOut('edit')} --clip "<clip-name>" --start 0.2 --end 0.8`,
  },
  retarget: {
    summary: '报告两套骨架的映射候选与风险，不导出动画（C 包）',
    args: [
      ['source', 'path', true, '源模型绝对路径（作为 input）'],
      ['target', 'path', true, '目标模型绝对路径，必须与 source 同目录'],
      ['out', 'path', true, '输出目录绝对路径'],
      ['map', 'string', false, '显式映射 "srcBone=dstBone,..."'],
    ],
    example:
      `node tools/model-tool/cli.mjs retarget --source ${exampleModel('model.gltf')} --target ${exampleModel('model.gltf')} --out ${exampleOut('retarget')}`,
  },


};

const GLOBAL_HELP = `model-tool ${TOOL_VERSION} —— 无头模型检查与受控渲染

用法：
  node tools/model-tool/cli.mjs <command> [--key value ...]
  node tools/model-tool/cli.mjs <command> --help

命令：
${Object.entries(COMMANDS)
  .map(([name, spec]) => `  ${name.padEnd(24)} ${spec.summary}`)
  .join('\n')}

通用规则：
  - 所有路径必须是绝对路径；支持空格与中文路径（参数按数组传给进程，不拼 shell）
  - --out 必须位于授权工作区内：${AUTHORIZED_OUTPUT_ROOT}
  - --out 必须显式给出；已存在同名产物会失败，不隐式覆盖
  - stdout 只有一个 JSON envelope；进度写 stderr
  - 退出码：0 成功 / 2 参数 / 3 不支持 / 4 输入输出 / 5 处理失败 / 6 结果不完整
  - 输入只读；不访问网络；不接触游戏进程或玩家存档
`;

function commandHelp(name) {
  const spec = COMMANDS[name];
  const rows = spec.args
    .map(([key, type, required, desc]) => {
      const flag = type === 'flag' ? `--${key}` : `--${key} <${type}>`;
      return `  ${flag.padEnd(26)} ${required ? '必填' : '可选'}  ${desc}`;
    })
    .join('\n');
  return `用法：node tools/model-tool/cli.mjs ${name} [参数]

${spec.summary}

参数：
${rows || '  （无参数）'}

示例：
  ${spec.example}

输出：单个 JSON envelope（schemaVersion 1），产物写在 --out 目录；
      报告为 report.json，退出码见 --help 全局说明。
`;
}

function parseArgs(argv) {
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      throw new ToolError('ARG_UNEXPECTED', `无法识别的参数：${token}`, EXIT.BAD_ARGUMENTS);
    }
    const body = token.slice(2);
    const eq = body.indexOf('=');
    if (eq >= 0) {
      values.set(body.slice(0, eq), body.slice(eq + 1));
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      flags.add(body);
      continue;
    }
    values.set(body, next);
    index += 1;
  }
  return { values, flags };
}

function coerceArgs(name, parsed) {
  const spec = COMMANDS[name];
  const args = {};
  const known = new Map(spec.args.map((item) => [item[0], item]));
  for (const key of [...parsed.values.keys(), ...parsed.flags]) {
    if (!known.has(key)) {
      throw new ToolError('ARG_UNKNOWN', `未知参数 --${key}（见 ${name} --help）`, EXIT.BAD_ARGUMENTS);
    }
  }
  for (const [key, type, required] of spec.args) {
    if (type === 'flag') {
      if (required && !parsed.flags.has(key)) {
        throw new ToolError('ARG_REQUIRED', `缺少必填参数 --${key}`, EXIT.BAD_ARGUMENTS);
      }
      if (parsed.flags.has(key)) args[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = true;
      continue;
    }
    const raw = parsed.values.get(key);
    if (raw === undefined) {
      if (required) throw new ToolError('ARG_REQUIRED', `缺少必填参数 --${key}`, EXIT.BAD_ARGUMENTS);
      continue;
    }
    if (type === 'number') {
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        throw new ToolError('ARG_NUMBER', `--${key} 必须是数字：${raw}`, EXIT.BAD_ARGUMENTS);
      }
      args[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    } else {
      args[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = raw;
    }
  }
  return args;
}

/* -------------------------------------------------------------- 能力矩阵 */

function capabilities() {
  return {
    formats: {
      glb: { read: 'supported', snapshot: 'supported', animationEdit: 'LINEAR/STEP only; GLB export reserializes' },
      gltf: { read: 'supported', snapshot: 'supported', animationEdit: 'LINEAR/STEP only; exports GLB' },
      usdz: { read: 'supported', snapshot: 'supported', animationEdit: 'unsupported; read-only' },
    },
    commands: [
      { command: 'capabilities', spawnsRenderer: false },
      { command: 'inspect', spawnsRenderer: true },
      { command: 'snapshot', spawnsRenderer: true },
      { command: 'animation-edit', spawnsRenderer: true },
      { command: 'retarget', spawnsRenderer: true, note: 'mapping report only; no animation transfer' },
    ],
    runtime: { renderer: 'Electron hidden window', isolation: 'sandbox + contextIsolation + nodeIntegration=false' },
    unsupported: [
      'USDZ writing', 'CUBICSPLINE and other special interpolation editing',
      'animation retarget export', 'remote resources', 'game-specific character or physics adapters',
    ],
  };
}

/* ------------------------------------------------------------------ 主流程 */

async function buildRequest(command, args) {
  const out = args.out;
  if (typeof out !== 'string') {
    throw new ToolError('ARG_REQUIRED', '缺少必填参数 --out', EXIT.BAD_ARGUMENTS);
  }
  const outDir = await prepareOutDir(out);

  let input = null;
  let inputSha256 = null;
  let inputSize = null;
  let allowedRoot = null;
  let declaredResources = null;

  const needsInput = command === 'inspect' || command === 'snapshot' || command === 'animation-edit';
  const inputValue = command === 'retarget' ? args.source : args.input;

  if (needsInput || command === 'retarget') {
    const resolved = await resolveInputFile(command === 'retarget' ? '--source' : '--input', inputValue);
    const ext = resolved.realPath.slice(resolved.realPath.lastIndexOf('.')).toLowerCase();
    if (!SUPPORTED_EXT.includes(ext)) {
      throw new ToolError(
        'FORMAT_UNSUPPORTED',
        `不支持的模型扩展名：${ext || '(无扩展名)'}；当前只读取 ${SUPPORTED_EXT.join(' / ')}`,
        EXIT.UNSUPPORTED,
      );
    }
    input = resolved.realPath;
    inputSize = resolved.size;
    inputSha256 = await sha256File(resolved.realPath);
    allowedRoot = modelRootOf(resolved.realPath);

    // GLB 的「声明资源」在 Node 侧只读头 + JSON chunk 得出，不把模型字节复制进渲染进程。
    // .gltf 由渲染页读取自身 JSON；.usdz 无法可靠枚举，保持 unavailable。
    if (command !== 'retarget' && input.toLowerCase().endsWith('.glb')) {
      declaredResources = await describeGlbDeclared(input);
      if (declaredResources.source === 'unavailable') {
        log(`GLB 声明资源不可用：${declaredResources.notes[0] ?? '未知原因'}`);
      }
    }
  }

  if (command === 'retarget') {
    if (typeof args.target !== 'string') {
      throw new ToolError('ARG_REQUIRED', '缺少必填参数 --target', EXIT.BAD_ARGUMENTS);
    }
    const target = await resolveInputFile('--target', args.target);
    const targetDir = modelRootOf(target.realPath);
    if (targetDir !== allowedRoot) {
      throw new ToolError(
        'RETARGET_DIR_MISMATCH',
        '--target 必须与 --source 在同一目录（工具只授权模型所在目录）',
        EXIT.IO,
        { sourceDir: allowedRoot, targetDir },
      );
    }
    const ext = target.realPath.slice(target.realPath.lastIndexOf('.')).toLowerCase();
    if (!SUPPORTED_EXT.includes(ext)) {
      throw new ToolError('FORMAT_UNSUPPORTED', `--target 扩展名不支持：${ext}`, EXIT.UNSUPPORTED);
    }
    args.target = target.realPath;
  }

  // 报告名冲突检查：提前失败，避免白跑一次渲染进程。
  await resolveOutFile(outDir.realPath, 'report.json', outDir.authorizedRootReal).then(async (target) => {
    const info = await stat(target.absolute).catch(() => null);
    if (info) {
      throw new ToolError('OUTPUT_EXISTS', `输出目录已有 report.json，拒绝覆盖：${target.absolute}`, EXIT.IO);
    }
  });

  return {
    outDir,
    request: {
      schemaVersion: 1,
      command,
      input,
      inputSha256,
      inputSize,
      outDir: outDir.realPath,
      args,
      allowedRoot,
      authorizedRoot: outDir.authorizedRootReal,
      declaredResources,
      toolVersion: TOOL_VERSION,
      projectRoot: PROJECT_ROOT,
    },
  };
}

async function runCommand(command, argv) {
  const parsed = parseArgs(argv);
  const args = coerceArgs(command, parsed);
  const startedAt = Date.now();
  const { outDir, request } = await buildRequest(command, args);
  validateRequest(request);
  log(`启动隔离渲染进程：${command}（第 ${renderRunCount() + 1} 次）`);

  const { result, durationMs, stderrTail } = await runRendererTask({ request });
  if (stderrTail.trim() !== '' && result.status !== 'ok') {
    log(`渲染进程 stderr 尾部：\n${stderrTail.slice(-1200)}`);
  }

  // outputs 只列出真实写出的文件：渲染进程回报的写入来自主进程 `wx` 落盘，
  // 报告只有在本进程成功写完后才追加。
  const outputs = [...(result.outputs ?? [])];
  const reportTarget = await resolveOutFile(
    outDir.realPath,
    'report.json',
    outDir.authorizedRootReal,
  );

  const exitCode =
    result.status === 'ok'
      ? EXIT.OK
      : result.status === 'partial'
        ? EXIT.PARTIAL
        : result.error?.exitCode ?? EXIT.FAILED;

  const diagnostics = [...(result.diagnostics ?? [])];
  const metadata = {
    toolVersion: TOOL_VERSION,
    node: process.version,
    rendererRuns: 1,
    durationMs: Date.now() - startedAt,
    rendererDurationMs: durationMs,
    ...(result.metadata ?? {}),
  };
  const inputs = {
    input: request.input,
    inputSha256: request.inputSha256,
    inputSize: request.inputSize,
    outDir: request.outDir,
    args,
  };
  const buildBody = (status, outs, diags, data) =>
    envelope({ command, status, inputs, outputs: outs, diagnostics: diags, metadata, data });

  let body;
  if (exitCode === EXIT.OK || exitCode === EXIT.PARTIAL) {
    const reportEntry = { path: reportTarget.absolute, type: 'report', sha256: null };
    const withReport = [...outputs, reportEntry];
    const text = `${JSON.stringify(buildBody(result.status, withReport, diagnostics, result.data), null, 2)}\n`;
    try {
      await writeNewFile(reportTarget.absolute, text);
    } catch (error) {
      // 报告没写出来就不能把 ok/partial 交出去，也不能声称报告路径存在。
      const failure = error instanceof ToolError ? error : null;
      const message = failure ? failure.message : String(error?.message ?? error);
      const failureBody = buildBody(
        'error',
        outputs,
        [...diagnostics, diagnostic('REPORT_WRITE_FAILED', 'error', `报告写入失败：${message}`, {
          path: reportTarget.absolute,
        })],
        null,
      );
      log(`报告写入失败：${message}`);
      process.stdout.write(`${JSON.stringify(failureBody)}\n`);
      return failure ? failure.exitCode : EXIT.FAILED;
    }
    body = buildBody(result.status, withReport, diagnostics, result.data);
  } else {
    // error：不写报告，也不把不存在的 report.json 加入 outputs。
    body = buildBody(result.status, outputs, diagnostics, result.data);
  }

  process.stdout.write(`${JSON.stringify(body)}\n`);
  return exitCode;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === 'help') {
    process.stdout.write(GLOBAL_HELP);
    return EXIT.OK;
  }
  const command = argv[0];
  if (!Object.prototype.hasOwnProperty.call(COMMANDS, command)) {
    throw new ToolError('COMMAND_UNKNOWN', `未知命令：${command}`, EXIT.BAD_ARGUMENTS);
  }
  if (argv.includes('--help')) {
    process.stdout.write(commandHelp(command));
    return EXIT.OK;
  }
  if (command === 'capabilities') {
    const body = envelope({
      command,
      status: 'ok',
      inputs: {},
      outputs: [],
      diagnostics: [
        diagnostic('CAPABILITIES_STATIC', 'info', '能力清单为静态声明；verified 字段表示是否已在本机实际跑通'),
      ],
      metadata: { toolVersion: TOOL_VERSION, node: process.version, rendererRuns: 0 },
      data: capabilities(),
    });
    process.stdout.write(`${JSON.stringify(body)}\n`);
    return EXIT.OK;
  }
  return runCommand(command, argv.slice(1));
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    if (error instanceof ToolError) {
      const body = envelope({
        command: process.argv[2] ?? null,
        status: 'error',
        inputs: {},
        outputs: [],
        diagnostics: [
          diagnostic(error.code, 'error', error.message, error.details ?? undefined),
        ],
        metadata: { toolVersion: TOOL_VERSION, node: process.version },
        data: null,
      });
      process.stderr.write(`${error.message}\n`);
      process.stdout.write(`${JSON.stringify(body)}\n`);
      process.exitCode = error.exitCode;
      return;
    }
    log(`未捕获异常：${error && error.stack ? error.stack : String(error)}`);
    process.exitCode = EXIT.FAILED;
  });
