import * as http from 'http';
import express from 'express';

// test results will be transformed from the standard test output format (which is a json structure and will in future
// be temporally tree-diffable) into webpages. This can happen on demand or automatically.

// we define different types of html fragments. compatible ones can be rendered into one page and incompatible ones can
// be put into one page by using frames or iframes.

let expressServer: http.Server | null = null;
export const stopServer = () => {
    expressServer?.close();
};

const testResultPages: Map<string, string> = new Map();
export const pushTestResultPage = (name: string, content: string) => {
  if (testResultPages.has(name)) {
    throw new Error(`Page with name ${name} already exists. Throwing in an abundance of caution as this is never an intended scenario. (Right now the reason for this to take place would be if we have two html full page embeddings sharing a groupid)`);
  }
  testResultPages.set(name, content);
};
export const clearTestResultPages = () => {
  testResultPages.clear();
};

import * as os from 'os';
import { execSync } from 'child_process';

function getDefaultInterface() {
  let defaultInterface = '';

  try {
    if (os.platform() === 'darwin') {
      // macOS
      defaultInterface = execSync('route -n get default | grep interface | awk \'{print $2}\'', {
        encoding: 'utf8',
      }).trim();
    } else if (os.platform() === 'linux') {
      // Linux
      const routeOutput = execSync('ip route', { encoding: 'utf8' });
      const routes = routeOutput.split('\n');

      let lowestMetric = Infinity;
      for (const route of routes) {
        if (route.includes('default')) {
          const metric = parseInt(route.split('metric ')[1].trim(), 10);
          if (metric < lowestMetric) {
            lowestMetric = metric;
            defaultInterface = route.split(' ')[4];
          }
        }
      }
    }
  } catch (error) {
    console.error('Error retrieving default interface:', error);
  }

  return defaultInterface;
}

function getLocalLANIPAddress() {
  const defaultInterface = getDefaultInterface();
  const interfaces = os.networkInterfaces();

  if (defaultInterface && interfaces[defaultInterface]) {
    const iface = interfaces[defaultInterface];

    for (const alias of iface) {
      if (alias.family === 'IPv4' && !alias.internal) {
        return alias.address;
      }
    }
  }

  return null;
}

export function startServer(port = 4000) {
  // Set up Express
  const app = express();

  app.get('/', (_req, res) => {
    res.redirect('/index.html');
  });
  app.get('/index.html', (_req, res) => {
    res.send(`
      <html>
        <head>
          <title>TST Results</title>
          <style>
            a { text-decoration: none; }
            a:hover { background-color: #e0e0e0; }
            * { font-family: sans-serif; }
          </style>
        </head>
        <body>
          <h1>Test Results</h1>
          <ul>
            ${Array.from(testResultPages.keys()).map((page) => `<li><a href="/${page}">${page}</a></li>`).join('')}
          </ul>
        </body>
      </html>
    `);
  });

  // cache of resources to serve locally. Need to periodically sync this from real cdn.
  // fs.readdirSync('cache')
  // app.get('/local/:item', (req, res) => {
  //   const item = req.params.item;
  //   if (fs.)
  //   res.send(content)
  // });

  app.get('/:page', (req, res) => {
    const page = req.params.page;
    const content = testResultPages.get(page);
    if (content) {
      res.send(content);
    } else {
      res.status(404).send('Not found');
    }
  });

  expressServer = app.listen(port, () => {
    // getLocalLANIPAddress().then(ip => {
      console.error(`Server listening at http://${getLocalLANIPAddress()}:${port}`);
    // }, (reason: any) => {
      // throw reason;
    // });
  }).on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is in use, trying with port ${port + 1}`);
      startServer(port + 1);
    } else {
      console.error('Unhandled error in express app listen:', err);
    }
  }).on('close', () => {
    console.error("express server closed");
  });
}
