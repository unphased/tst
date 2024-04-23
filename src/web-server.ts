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
    throw new Error(`Page with name ${name} already exists. Throwing in an abundance of caution as this is never an intended scenario.`);
  }
  testResultPages.set(name, content);
};
export const clearTestResultPages = () => {
  testResultPages.clear();
};

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
          <title>Test Results</title>
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
    console.error(`Server listening at http://localhost:${port}`);
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
