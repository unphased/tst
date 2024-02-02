import { test } from '../index.js';
import { getConfig } from '../config.js';

export const shared_structure = test('config', ({ a: { eq } }) => {
  const configA = getConfig();
  eq(configA.get('test_remote_assignment_config_key'), undefined);
  const configB = getConfig();
  configB.set('test_remote_assignment_config_key', 'test_remote_assignment_config_value');
  eq(configA.get('test_remote_assignment_config_key'), 'test_remote_assignment_config_value');
  configA.set('test_remote_assignment_config_key', undefined); // should clear it out
  eq(configB.get('test_remote_assignment_config_key'), undefined);
});

