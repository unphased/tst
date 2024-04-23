// data has been seeded above with a json literal: a list of plots to make.
// Also, legendFn has also been surgically injected into it.

// set up the uPlot hooks so we can obtain mouse x and s coords, and implement the click event handler.

window.data.forEach((d) => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  let curIdx = null;
  let curSid = null;
  uplot({ ...d.opts, hooks: d.mappingX || d.mappingSX ? {
    setCursor: [(u) => {
      curIdx = u.cursor.idx;
    }],
    setSeries: [(u, sid) => {
      curSid = sid;
    }],
    ready: [(u) => {
      const el = u.over;
      el.addEventListener('click', (e) => {
        // sid will be null unless hovering a datapoint
        if (curSid === null) return;
        // perform mapping
        // console.log(curIdx, curSid, d.mappingX, d.mappingSX);
        let mapping;
        if (d.mappingSX[curSid-1]) {
          mapping = d.mappingSX[curSid-1][curIdx];
          console.log('mapped sx', mapping);
        } else if (d.mappingX) {
          mapping = d.mappingX[curIdx];
          console.log('mapped x', mapping);
        }
        if (mapping) {
          console.log("currently on", location.href, "redirecting to", mapping, `with href suffix translation "${d.targetNavGroupId}"`);
          const targetURL = (d.targetNavGroupId ? location.href.replace(/:%20.*$/, ':%20' + encodeURI(d.targetNavGroupId)) : location.href) + '#' + mapping;
          console.log('targetURL', targetURL);
          location.href = targetURL;
        }
      });
    }],
  } : {}}, d.data, el);
});
