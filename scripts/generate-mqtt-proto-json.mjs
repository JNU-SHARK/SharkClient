import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import protobuf from 'protobufjs';

const repoRoot = process.cwd();
const protoPath = path.join(repoRoot, 'UDP-MQTT Server', 'proto', 'messages.proto');
const outputPath = path.join(repoRoot, 'src', 'generated', 'mqtt-proto.json');

const source = fs.readFileSync(protoPath, 'utf8').replace(/\r\n/g, '\n');
const root = protobuf.parse(source).root;
const json = root.toJSON();

// Flatten: if there's a single package, hoist its contents to the top level
// so the frontend can lookup by plain message name.
let nested = json.nested ?? {};
const packages = Object.keys(nested);
if (packages.length === 1 && nested[packages[0]].nested) {
  nested = nested[packages[0]].nested;
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(
  outputPath,
  `${JSON.stringify({ nested }, null, 2)}\n`,
  'utf8'
);

console.log(`Generated ${path.relative(repoRoot, outputPath)} (${Object.keys(nested).length} messages)`);
