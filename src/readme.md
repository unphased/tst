# tst
A lightweight all-powerful TypeScript test library

## concept

A low friction test framework that allows you to achieve sub-500ms test iteration cycles. Built in data visualization
tools, parallel and distributed test execution, data-driven multimodal output, and more.

The goal of this tool is to empower you to iterate on your software as quickly as possible. All features are built with this goal in mind.

## features, goals, roadmap

- [x] full TypeScript support for streamlined development workflow
- [x] terminal-friendly colorized test reporting
- [x] consistent and simple JSON test result output format
<!-- more for checking how it ran -->
- [x] streamlined test reporting web interface with simple and consistent programming interface
<!-- more about looking at results -->
   - [ ] live reload
   - [x] modular renderers for plots via uPlot, plotly, etc. Embed graphs in result pages. Consistent interface
   - [ ] stay focused on the same location while tests rerun
- [ ] parallel test execution and scheduling scales across threads and machines
- [x] powerful async process management interface enables complex orchestration of processes for integration testing
- [x] built-in test assertions with friendly errors
   - [ ] also render input assertion expression into assertion error messages via source code reading
- [ ] lin-log runtime tree diff powers delta-workflows (reasoning about changes across versions, between
  expectation/result) with no limit on input size or complexity
- [ ] transparent compression of results
