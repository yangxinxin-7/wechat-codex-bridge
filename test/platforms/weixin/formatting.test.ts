import assert from 'node:assert/strict';
import test from 'node:test';
import { formatWeixinText, splitWeixinText } from '../../../src/platforms/weixin/formatting.js';

test('formatWeixinText applies official markdown filtering before local heading rewrite', () => {
  const formatted = formatWeixinText('# 标题\n\n![alt](https://example.com/a.png)\n\n中文*强调*和English *italic*');

  assert.equal(formatted, '【标题】\n\n中文强调和English *italic*');
});

test('formatWeixinText keeps fenced code blocks intact while rewriting headings outside fences', () => {
  const formatted = formatWeixinText('# 外部标题\n\n```md\n# 内部标题\n```\n\n## 次标题');

  assert.equal(formatted, '【外部标题】\n\n```md\n# 内部标题\n```\n\n**次标题**');
});

test('splitWeixinText keeps short paragraphs and sentences in one message', () => {
  const text = '第一段。第二句。\n\n第二段。\n第三行。';
  assert.deepEqual(splitWeixinText(text), [text]);
  assert.deepEqual(splitWeixinText('猫'.repeat(682)), ['猫'.repeat(682)]);
});

test('splitWeixinText splits only oversized replies within the UTF-8 delivery limit', () => {
  const text = '猫'.repeat(1400);
  const chunks = splitWeixinText(text);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.join(''), text);
  assert.ok(chunks.every(chunk => Buffer.byteLength(chunk, 'utf8') <= 2048));
});

test('splitWeixinText preserves emoji when forced to split a long final tail', () => {
  const text = '前缀' + '🐱'.repeat(1400) + '尾段。';
  const chunks = splitWeixinText(text);
  assert.equal(chunks.join(''), text);
  assert.ok(chunks.every(chunk => Buffer.byteLength(chunk, 'utf8') <= 2048));
  assert.ok(chunks.every(chunk => !/[\uD800-\uDBFF]$/u.test(chunk) && !/^[\uDC00-\uDFFF]/u.test(chunk)));
});
