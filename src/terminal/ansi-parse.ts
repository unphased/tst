// lite utility version of the ansi -> html parser.
// for extracting escape sequence positioning out of an ansi string,
// also outputs string without the codes, none of this requires actual ansi semantic parsing.
export const lexAnsi = (ansi: string) => {
  const cleaned_a: string[] = [];
  const index_a: number[][] = []; // start locations of escape sequences
  const len_a: number[][] = []; // lengths of escape sequences. use these to reconstruct modifications done based on math on cleaned string for raw input (or html) string.
  ansi.split('\n').forEach((line) => {
    let match: RegExpExecArray | null;
    let cleaned = '';
    let idx = 0;
    const indexs: number[] = [];
    const lens: number[] = [];

    for (const escapeRE = /\x1b\[([0-9;:]*)m/g; match = escapeRE.exec(line);) {
      const index = escapeRE.lastIndex;
      const len = match[0].length;
      const start = index - len;
      const source_segment = line.slice(idx, start);
      cleaned += source_segment;
      indexs.push(start);
      lens.push(len);
      // the actual escape sequence semantics can be parsed from here
      // const colorCode = match[1];
      idx = index;
    }

    // this handles the last segment that comes after the last escape sequence, or the entire line when no escape
    // sequences are present.
    const final_source_segment = line.slice(idx);
    cleaned += final_source_segment;
    index_a.push(indexs);
    len_a.push(lens);
    cleaned_a.push(cleaned);
  });
  return { cleaned:cleaned_a, idxs: index_a, lens: len_a };
};

