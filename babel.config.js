export default {
  "presets": [
    ["@babel/preset-env", {
      "targets": {
        "node": "16"
      },
      "modules": false,
      "debug": true,
    }],
    "@babel/preset-typescript"
  ],
  "ignore": [ "src/**/payload" ],
  // "highlightCode": true,
  "sourceMaps": "inline",
  // "plugins": [
  //   ["module-resolver", {
  //     "root": ["./"],
  //     "alias": {
  //       "ts-utils/terminal": "../instrumenter/build/utils/terminal.js",
  //       "ts-utils": "../instrumenter/build/utils/utils.js"
  //     }
  //   }]
  // ]
};
