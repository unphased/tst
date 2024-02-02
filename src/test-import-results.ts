// test import metrics are produced at a different point during test launch process than test result metrics.

export type LoadResult = {
  module: string;
  importMs: number;
};

const loadResults: LoadResult[] = [];
export const submitLoadResult = (loadResult: LoadResult) => {
  loadResults.push(loadResult);
};

