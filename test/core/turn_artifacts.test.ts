import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTurnArtifactContext, finalizeTurnArtifacts } from '../../src/core/turn_artifacts.js';
import type { TurnArtifactContext } from '../../src/types/core.js';

test('resending a Markdown image copies only the current thread image and removes its local link', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-image-resend-'));
  const previousHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = path.join(dir, 'codex');
  const context = createTurnArtifactContext({ bridgeSessionId: 'session-1', cwd: dir, intent: null });
  const own = path.join(process.env.CODEX_HOME, 'generated_images/thread-1/dog.png');
  const other = path.join(process.env.CODEX_HOME, 'generated_images/thread-2/private.png');
  const outside = path.join(dir, 'private.png');
  for (const p of [own, other, outside]) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'image');
  }
  try {
    const result = finalizeTurnArtifacts({ context, result: {
      threadId: 'thread-1', outputText: `![小狗](${own})\n![别的会话](${other})\n![其他目录](${outside})\n![远程](https://example.com/dog.png)`,
    } });
    assert.equal(result.outputArtifacts.length, 1);
    assert.equal(result.outputArtifacts[0].displayName, '小狗.png');
    assert.equal(fs.readFileSync(result.outputArtifacts[0].path, 'utf8'), 'image');
    assert.ok(!result.outputText.includes(own));
    assert.ok(result.outputText.includes(other));
    assert.ok(result.outputText.includes(outside));
    assert.ok(result.outputText.includes('https://example.com/dog.png'));
  } finally {
    if (previousHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousHome;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a recovered image and its declared copy are delivered once with the explicit filename', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-image-dedupe-'));
  const context = createTurnArtifactContext({ bridgeSessionId: 'session-1', cwd: dir, intent: null });
  fs.mkdirSync(context.artifactDir, { recursive: true });
  const native = path.join(dir, 'generated.png');
  const declared = path.join(context.artifactDir, '小狗.png');
  fs.writeFileSync(native, 'same-image');
  fs.writeFileSync(declared, 'same-image');
  try {
    const result = finalizeTurnArtifacts({ context, result: {
      outputText: `画好了\n\`\`\`codexbridge-artifacts\n${JSON.stringify([{ path: declared, kind: 'file', caption: '小狗' }])}\n\`\`\``,
      outputArtifacts: [{ kind: 'image', path: native }],
    } });
    assert.equal(result.outputArtifacts.length, 1);
    assert.equal(result.outputArtifacts[0].displayName, '小狗.png');
    assert.equal(result.outputArtifacts[0].caption, '小狗');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an image referenced by both Markdown and a manifest is sent once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-image-link-manifest-'));
  const context = createTurnArtifactContext({ bridgeSessionId: 'session-1', cwd: dir, intent: null });
  fs.mkdirSync(context.artifactDir, { recursive: true });
  const imagePath = path.join(context.artifactDir, 'cat.png');
  fs.writeFileSync(imagePath, 'cat-image');
  try {
    const result = finalizeTurnArtifacts({ context, result: {
      outputText: `![小猫](${imagePath})\n\`\`\`codexbridge-artifacts\n${JSON.stringify([{path: imagePath, kind: 'image', caption: '原有说明'}])}\n\`\`\``,
    } });
    assert.equal(result.outputArtifacts.length, 1);
    assert.equal(result.outputArtifacts[0].caption, '原有说明');
    assert.equal(result.outputText.includes(imagePath), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('consecutive turns keep the session attachment directory and isolate delivery spools', () => {
  const first = createTurnArtifactContext({ bridgeSessionId: 'session-1', cwd: '/tmp/project', intent: null });
  const next = createTurnArtifactContext({
    bridgeSessionId: 'session-1', cwd: '/tmp/project', intent: null, artifactDir: first.artifactDir,
  });
  assert.equal(next.artifactDir, first.artifactDir);
  assert.notEqual(next.requestId, first.requestId);
  assert.notEqual(next.spoolDir, first.spoolDir);
});

test('finalizeTurnArtifacts rejects symlinked manifest files that escape the turn artifact directory', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-artifacts-'));
  const artifactDir = path.join(tempDir, 'artifact-dir');
  const spoolDir = path.join(tempDir, 'spool-dir');
  const outsideFile = path.join(tempDir, 'outside.pdf');
  const symlinkPath = path.join(artifactDir, 'report.pdf');
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.mkdirSync(spoolDir, { recursive: true });
  fs.writeFileSync(outsideFile, 'outside');
  fs.symlinkSync(outsideFile, symlinkPath);

  const context: TurnArtifactContext = {
    requestId: 'req-1',
    bridgeSessionId: 'session-1',
    artifactDir,
    spoolDir,
    turnId: null,
    intent: {
      requested: true,
      preferredKind: 'file',
      requestedFormat: 'pdf',
      requestedExtension: '.pdf',
      requestedFileName: 'report.pdf',
      userDescription: '给我一个 PDF',
      requiresClarification: false,
    },
  };

  try {
    const result = finalizeTurnArtifacts({
      result: {
        outputText: `已完成。\n\n\`\`\`codexbridge-artifacts\n${JSON.stringify([{ path: symlinkPath, kind: 'file' }])}\n\`\`\``,
      },
      context,
    });

    assert.equal(result.outputText, '已完成。');
    assert.deepEqual(result.outputArtifacts, []);
    assert.deepEqual(fs.readdirSync(spoolDir), []);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('finalizeTurnArtifacts accepts manifest paths that contain raw Windows backslashes', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-artifacts-'));
  const artifactDir = path.join(tempDir, 'artifact-dir');
  const spoolDir = path.join(tempDir, 'spool-dir');
  const reportPath = path.join(artifactDir, 'summary.docx');
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.mkdirSync(spoolDir, { recursive: true });
  fs.writeFileSync(reportPath, 'word-output');

  try {
    const manifestPath = reportPath.replace(/\//g, '\\');
    const result = finalizeTurnArtifacts({
      result: {
        outputText: `已完成。\n\n\`\`\`codexbridge-artifacts\n[{"path":"${manifestPath}","kind":"file","displayName":"summary.docx"}]\n\`\`\``,
      },
      context: makeContext({
        artifactDir,
        spoolDir,
        requestedFormat: 'docx',
        requestedExtension: '.docx',
        requestedFileName: 'summary.docx',
      }),
    });

    assert.equal(result.outputText, '已完成。');
    assert.equal(result.outputArtifacts?.length, 1);
    assert.equal(result.outputArtifacts?.[0]?.displayName, 'summary.docx');
    assert.equal(result.artifactDelivery?.stage, 'ready');
    assert.equal(result.artifactDelivery?.noticeCode, null);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('finalizeTurnArtifacts reports ambiguous fallback candidates instead of sending multiple files blindly', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-artifacts-'));
  const artifactDir = path.join(tempDir, 'artifact-dir');
  const spoolDir = path.join(tempDir, 'spool-dir');
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.mkdirSync(spoolDir, { recursive: true });
  fs.writeFileSync(path.join(artifactDir, 'report-a.pdf'), 'a');
  fs.writeFileSync(path.join(artifactDir, 'report-b.pdf'), 'b');

  const context = makeContext({
    artifactDir,
    spoolDir,
    requestedFormat: 'pdf',
    requestedExtension: '.pdf',
  });

  try {
    const result = finalizeTurnArtifacts({
      result: {
        outputText: '已完成。',
      },
      context,
    });

    assert.deepEqual(result.outputArtifacts, []);
    assert.equal(result.artifactDelivery?.noticeCode, 'ambiguous_candidates');
    assert.equal(result.artifactDelivery?.stage, 'ambiguous');
    assert.equal(result.artifactDelivery?.scannedCandidateCount, 2);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('finalizeTurnArtifacts enforces artifact count limits and keeps only the highest-priority attachments', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-artifacts-'));
  const artifactDir = path.join(tempDir, 'artifact-dir');
  const spoolDir = path.join(tempDir, 'spool-dir');
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.mkdirSync(spoolDir, { recursive: true });
  const reportPath = path.join(artifactDir, 'changes-summary.pdf');
  const alternatePath = path.join(artifactDir, 'report.pdf');
  fs.writeFileSync(reportPath, 'pdf');
  fs.writeFileSync(alternatePath, 'pdf');

  const previousLimit = process.env.CODEXBRIDGE_MAX_OUTPUT_ARTIFACTS;
  process.env.CODEXBRIDGE_MAX_OUTPUT_ARTIFACTS = '1';
  try {
    const result = finalizeTurnArtifacts({
      result: {
        outputText: `已完成。\n\n\`\`\`codexbridge-artifacts\n${JSON.stringify([
          { path: reportPath, kind: 'file', displayName: 'changes-summary.pdf' },
          { path: alternatePath, kind: 'file', displayName: 'report.pdf' },
        ])}\n\`\`\``,
      },
      context: makeContext({
        artifactDir,
        spoolDir,
        requestedFormat: 'pdf',
        requestedExtension: '.pdf',
        requestedFileName: 'changes-summary.pdf',
      }),
    });

    assert.equal(result.outputArtifacts?.length, 1);
    assert.equal(result.outputArtifacts?.[0]?.displayName, 'changes-summary.pdf');
    assert.equal(result.artifactDelivery?.noticeCode, 'count_limited');
    assert.equal(result.artifactDelivery?.stage, 'limited');
    assert.equal(result.artifactDelivery?.rejectedArtifacts.some((item) => item.reason === 'count_limit'), true);
  } finally {
    restoreEnv('CODEXBRIDGE_MAX_OUTPUT_ARTIFACTS', previousLimit);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('finalizeTurnArtifacts keeps only deliverables that match the requested format when better matches exist', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-artifacts-'));
  const artifactDir = path.join(tempDir, 'artifact-dir');
  const spoolDir = path.join(tempDir, 'spool-dir');
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.mkdirSync(spoolDir, { recursive: true });
  const reportPath = path.join(artifactDir, 'changes-summary.pdf');
  const notesPath = path.join(artifactDir, 'notes.txt');
  fs.writeFileSync(reportPath, 'pdf');
  fs.writeFileSync(notesPath, 'txt');

  try {
    const result = finalizeTurnArtifacts({
      result: {
        outputText: `已完成。\n\n\`\`\`codexbridge-artifacts\n${JSON.stringify([
          { path: reportPath, kind: 'file', displayName: 'changes-summary.pdf' },
          { path: notesPath, kind: 'file', displayName: 'notes.txt' },
        ])}\n\`\`\``,
      },
      context: makeContext({
        artifactDir,
        spoolDir,
        requestedFormat: 'pdf',
        requestedExtension: '.pdf',
        requestedFileName: 'changes-summary.pdf',
      }),
    });

    assert.deepEqual(
      result.outputArtifacts?.map((artifact) => artifact.displayName),
      ['changes-summary.pdf'],
    );
    assert.equal(result.artifactDelivery?.noticeCode, null);
    assert.equal(result.artifactDelivery?.stage, 'ready');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('finalizeTurnArtifacts auto-selects the best fallback candidate when one filename clearly matches the requested deliverable', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-artifacts-'));
  const artifactDir = path.join(tempDir, 'artifact-dir');
  const spoolDir = path.join(tempDir, 'spool-dir');
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.mkdirSync(spoolDir, { recursive: true });
  fs.writeFileSync(path.join(artifactDir, 'changes-summary.pdf'), 'pdf');
  fs.writeFileSync(path.join(artifactDir, 'notes.pdf'), 'pdf');

  try {
    const result = finalizeTurnArtifacts({
      result: {
        outputText: '已完成。',
      },
      context: makeContext({
        artifactDir,
        spoolDir,
        requestedFormat: 'pdf',
        requestedExtension: '.pdf',
        requestedFileName: 'changes-summary.pdf',
      }),
    });

    assert.deepEqual(
      result.outputArtifacts?.map((artifact) => artifact.displayName),
      ['changes-summary.pdf'],
    );
    assert.equal(result.artifactDelivery?.noticeCode, null);
    assert.equal(result.artifactDelivery?.stage, 'fallback_ready');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('finalizeTurnArtifacts rejects oversized deliverables before they are copied into the spool directory', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-artifacts-'));
  const artifactDir = path.join(tempDir, 'artifact-dir');
  const spoolDir = path.join(tempDir, 'spool-dir');
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.mkdirSync(spoolDir, { recursive: true });
  const reportPath = path.join(artifactDir, 'summary.pdf');
  fs.writeFileSync(reportPath, '0123456789');

  const previousLimit = process.env.CODEXBRIDGE_MAX_ARTIFACT_SIZE_BYTES;
  process.env.CODEXBRIDGE_MAX_ARTIFACT_SIZE_BYTES = '4';
  try {
    const result = finalizeTurnArtifacts({
      result: {
        outputText: `已完成。\n\n\`\`\`codexbridge-artifacts\n${JSON.stringify([
          { path: reportPath, kind: 'file', displayName: 'summary.pdf' },
        ])}\n\`\`\``,
      },
      context: makeContext({
        artifactDir,
        spoolDir,
        requestedFormat: 'pdf',
        requestedExtension: '.pdf',
      }),
    });

    assert.deepEqual(result.outputArtifacts, []);
    assert.equal(result.artifactDelivery?.noticeCode, 'size_limited');
    assert.equal(result.artifactDelivery?.stage, 'missing');
    assert.equal(result.artifactDelivery?.rejectedArtifacts.some((item) => item.reason === 'size_limit'), true);
    assert.deepEqual(fs.readdirSync(spoolDir), []);
  } finally {
    restoreEnv('CODEXBRIDGE_MAX_ARTIFACT_SIZE_BYTES', previousLimit);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function makeContext({
  artifactDir,
  spoolDir,
  requestedFormat = 'pdf',
  requestedExtension = '.pdf',
  requestedFileName = null,
}: {
  artifactDir: string;
  spoolDir: string;
  requestedFormat?: string | null;
  requestedExtension?: string | null;
  requestedFileName?: string | null;
}): TurnArtifactContext {
  return {
    requestId: 'req-1',
    bridgeSessionId: 'session-1',
    artifactDir,
    spoolDir,
    turnId: null,
    intent: {
      requested: true,
      preferredKind: 'file',
      requestedFormat,
      requestedExtension,
      requestedFileName,
      userDescription: '请把结果发我',
      requiresClarification: false,
    },
  };
}

function restoreEnv(name: string, value: string | undefined): void {
  if (typeof value === 'string') {
    process.env[name] = value;
    return;
  }
  delete process.env[name];
}
