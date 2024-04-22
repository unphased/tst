export default {
  "presets": [
    ["@babel/preset-env", {
      "targets": {
        "node": "16"
      },
      "modules": false, // this just means it wont transform modules to cjs or anything, which is what we want (full esm in and out)
      "debug": true,
    }],
    "@babel/preset-typescript"
  ],
  "ignore": [ "src/**/payload", "src/**/static" ],
  // "highlightCode": true,
  "sourceMaps": "inline",
  "plugins": [
    "./code-inline-babel-plugin.js"
  ]
};
