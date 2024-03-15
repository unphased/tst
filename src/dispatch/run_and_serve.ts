import { LaunchTests } from "./runner.js";
import { fileURLToPath } from 'url';
const isProgramLaunchContext = () => {
  return fileURLToPath(import.meta.url) === process.argv[1];
}

isProgramLaunchContext() && void(LaunchTests)('./build', { web_server: true });
