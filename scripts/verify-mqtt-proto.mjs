// Verify all MQTT topics/messageTypes used in the codebase resolve against the generated proto JSON.
import fs from 'node:fs';
import path from 'node:path';
import protobuf from 'protobufjs';

const repoRoot = process.cwd();
const jsonPath = path.join(repoRoot, 'src', 'generated', 'mqtt-proto.json');
const protoJson = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const root = protobuf.Root.fromJSON(protoJson);

const allMessages = Object.keys(protoJson.nested);
console.log(`[proto] ${allMessages.length} messages available in flat namespace:`);
console.log('   ' + allMessages.join(', '));

// Scan source files for topic/messageType usages
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'target') continue;
      out.push(...walk(p));
    } else if (/\.(ts|vue)$/.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

const srcFiles = walk(path.join(repoRoot, 'src'));
// Matches:
//   topic: 'X'
//   messageType: 'X'
//   sendMqttCommand('X', 'X', ...)
//   lookupType('X'), lookupType("X")
const patterns = [
  /(?:topic|messageType)\s*:\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g,
  /sendMqttCommand\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*,\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g,
  /lookupType\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\)/g,
];
const used = new Map(); // name -> Set<file>

for (const f of srcFiles) {
  const text = fs.readFileSync(f, 'utf8');
  for (const regex of patterns) {
    let m;
    while ((m = regex.exec(text)) !== null) {
      for (let i = 1; i < m.length; i++) {
        if (!m[i]) continue;
        const name = m[i];
        if (!used.has(name)) used.set(name, new Set());
        used.get(name).add(path.relative(repoRoot, f));
      }
    }
  }
}

console.log(`\n[scan] Found ${used.size} unique topic/messageType literals:\n`);

const missing = [];
const ok = [];
for (const [name, files] of used) {
  try {
    root.lookupType(name);
    ok.push(name);
  } catch {
    // It may not be an actual proto type (e.g., a generic topic path). Only flag if
    // it looks like a proto type name (PascalCase without separators).
    if (/^[A-Z][A-Za-z0-9]+$/.test(name)) {
      missing.push({ name, files: [...files] });
    }
  }
}

console.log(`  OK (${ok.length}): ${ok.sort().join(', ')}`);
if (missing.length) {
  console.log(`\n  MISSING (${missing.length}):`);
  for (const { name, files } of missing) {
    console.log(`   - ${name}  (in ${files.join(', ')})`);
  }
  process.exitCode = 1;
} else {
  console.log('\nAll proto-like topic/messageType literals are resolvable ✅');
}

// Also check: are there any proto messages NOT referenced from the frontend?
const unused = allMessages.filter((m) => !used.has(m));
if (unused.length) {
  console.log(`\n[info] Proto messages with no frontend topic literal (may be subscribed via dynamic path):`);
  console.log('   ' + unused.join(', '));
}

// Verify DEFAULT_MQTT_CONFIG.topics (subscriptions) all resolve to proto types.
const constantsPath = path.join(repoRoot, 'src', 'components', 'Dashboard', 'constants.ts');
if (fs.existsSync(constantsPath)) {
  const text = fs.readFileSync(constantsPath, 'utf8');
  const defaultConfigMatch = text.match(/DEFAULT_MQTT_CONFIG[\s\S]*?topics:\s*\[([\s\S]*?)\]/);
  if (defaultConfigMatch) {
    const topicList = [...defaultConfigMatch[1].matchAll(/['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g)].map((m) => m[1]);
    const missingSubs = topicList.filter((t) => !allMessages.includes(t));
    console.log(`\n[subscriptions] DEFAULT_MQTT_CONFIG.topics: ${topicList.length} entries`);
    if (missingSubs.length) {
      console.log(`   MISSING proto types: ${missingSubs.join(', ')}`);
      process.exitCode = 1;
    } else {
      console.log('   All subscription topics resolve to proto types ✅');
    }
  }
}
