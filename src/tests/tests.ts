import { test } from '../index.js';
import { getConfig } from '../config.js';
import { stdoutColorizer } from '../process.js';
import { Readable, Writable } from 'stream';

export const shared_structure = test('config', ({ a: { eq } }) => {
  const configA = getConfig();
  eq(configA.get('test_remote_assignment_config_key'), undefined);
  const configB = getConfig();
  configB.set('test_remote_assignment_config_key', 'test_remote_assignment_config_value');
  eq(configA.get('test_remote_assignment_config_key'), 'test_remote_assignment_config_value');
  configA.set('test_remote_assignment_config_key', undefined); // should clear it out
  eq(configB.get('test_remote_assignment_config_key'), undefined);
});

export const simple_transform = test('transform stream', async ({ a: { eqO } }) => {
  // Readable stream
  const readStream = Readable.from(['hello world\nfoo bar baz\n']);

  // Writable stream
  const output: string[] = [];
  const writeStream = new Writable({
    write(chunk, encoding, callback) {
      output.push(chunk.toString());
      callback();
    }
  });

  // Pipe them together
  readStream.pipe(stdoutColorizer()).pipe(writeStream);

  // Verify output
  const x = await new Promise((resolve, _reject) => {
    writeStream.on('finish', () => {
      resolve(output);
    });
  });
  eqO(x, ['\x1b[48;5;19mhello world\x1b[0K\n\x1b[48;5;19mfoo bar baz\x1b[0K\n\x1b[m']);
});

